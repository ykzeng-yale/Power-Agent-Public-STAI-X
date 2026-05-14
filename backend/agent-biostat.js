import path from 'path';
import fs from 'fs';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import RProcessPool from './r-process-pool.js';
import { Storage } from '@google-cloud/storage';
import { routeQuery, formatCodingResult } from './pi-agent.js';
import { supabase, createSession, updateSessionStatus, saveMessage, saveWorkflowStep, trackGeneratedFile, getSessionFiles } from './supabase-client.js';
import { getBiostatSystemPrompt } from './biostat-agent-prompt.js';
import { parseFile, detectFileType } from './file-parser-improved.js';
import chatbotDomainExpert from './chatbot-domain-expert.js';
import { generateReport } from './report-generator.js';
import { generatePdfReport } from './pdf-report-generator.js';
import { authenticateUser, requireCredits, deductCredits, recordAnonymousUsage, getUserCredits } from './auth-middleware.js';
import cookieParser from 'cookie-parser';

dotenv.config();

// Workspace base directory (same logic as r-process-pool.js)
const WORKSPACE_BASE = process.env.WORKSPACE_BASE_DIR ||
  (fs.existsSync('/workspace') ? '/workspace' : path.join(process.env.TMPDIR || '/tmp', 'r-workspace'));
const WORKSPACE_OUTPUT = path.join(WORKSPACE_BASE, 'output');

const app = express();
const port = process.env.PORT || 3005;

app.use(cors());
app.use(cookieParser());
app.use(express.json({ limit: '50mb' }));

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * Call Anthropic API with retry logic for 529 overloaded errors
 */
async function callAnthropicWithRetry(params, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await anthropic.messages.create(params);
    } catch (error) {
      const isOverloaded = error.status === 529 ||
        (error.message && error.message.includes('overloaded'));

      if (isOverloaded && attempt < maxRetries) {
        const waitTime = Math.pow(2, attempt) * 5000; // 5s, 10s, 20s
        console.log(`[BIOSTAT-AGENT] API overloaded, retry ${attempt + 1}/${maxRetries} in ${waitTime/1000}s`);
        await new Promise(r => setTimeout(r, waitTime));
        continue;
      }
      throw error;
    }
  }
}

/**
 * Perform web search using Tavily API
 * @param {Object} params - Search parameters
 * @returns {Object} Search results
 */
async function performTavilySearch(params) {
  const { query, search_depth = 'basic', max_results = 5 } = params;

  if (!process.env.TAVILY_API_KEY) {
    console.error('❌ TAVILY_API_KEY not configured');
    return { error: 'Web search not available - Tavily API key not configured' };
  }

  try {
    console.log(`🔍 Performing Tavily search: "${query}"`);

    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query: query,
        search_depth: search_depth,
        max_results: max_results,
        include_domains: [
          'cran.r-project.org',
          'rdocumentation.org',
          'rdrr.io',
          'stackoverflow.com',
          'github.com',
          'bookdown.org',
          'stats.stackexchange.com'
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`Tavily API error: ${response.status} ${response.statusText}`);
    }

    const results = await response.json();

    console.log(`✅ Tavily search completed: ${results.results?.length || 0} results`);

    // Format results for Claude
    const formattedResults = results.results?.map(r => ({
      title: r.title,
      url: r.url,
      content: r.content,
      score: r.score
    })) || [];

    return {
      success: true,
      query: query,
      results: formattedResults,
      answer: results.answer || null
    };

  } catch (error) {
    console.error('❌ Tavily search error:', error);
    return {
      success: false,
      error: error.message,
      query: query
    };
  }
}

/**
 * Validate simr results to detect fabrication
 * When user asks for simr power analysis, we MUST verify the R output contains actual simr results
 * This prevents LLM from fabricating power percentages without running actual Monte Carlo simulations
 *
 * @param {string} query - User's original query
 * @param {string} rOutput - R execution output
 * @param {string} rCode - The R code that was executed
 * @param {number} executionTimeMs - How long R execution took
 * @returns {{isValid: boolean, reason: string}} Validation result
 */
function validateSimrResults(query, rOutput, rCode, executionTimeMs) {
  const queryLower = query.toLowerCase();

  // Check if query explicitly asks for simr
  const asksForSimr = queryLower.includes('simr') ||
                      queryLower.includes('powersim') ||
                      queryLower.includes('powercurve') ||
                      (queryLower.includes('simulation') && queryLower.includes('power') && queryLower.includes('monte carlo'));

  if (!asksForSimr) {
    // Not a simr query, skip validation
    return { isValid: true, reason: 'Not a simr query' };
  }

  console.log('[SIMR-VALIDATION] Checking simr results...');
  console.log(`[SIMR-VALIDATION] Execution time: ${executionTimeMs}ms`);
  console.log(`[SIMR-VALIDATION] Output length: ${rOutput?.length || 0} chars`);

  // Simr Monte Carlo simulations should take significant time (at least 10 seconds for small sims)
  // 500 iterations typically take 5-15 minutes
  if (executionTimeMs < 5000) {
    console.warn(`[SIMR-VALIDATION] ⚠️ SUSPICIOUS: Execution completed in ${executionTimeMs}ms - too fast for simr Monte Carlo`);
  }

  // Check if R code actually contains simr library call
  const codeHasSimr = rCode && (
    rCode.includes('library(simr)') ||
    rCode.includes('require(simr)') ||
    rCode.includes('simr::')
  );

  if (!codeHasSimr) {
    console.error('[SIMR-VALIDATION] ❌ FABRICATION DETECTED: Code does not load simr package');
    return {
      isValid: false,
      reason: 'Code does not include library(simr) - simr package was never loaded. You MUST use the simr package for simulation-based power analysis.'
    };
  }

  // Check if output contains actual simr results
  // simr::powerSim output contains specific patterns like:
  // - "Power for predictor 'x'" or similar
  // - Percentage format like "XX.XX% (YY.YY, ZZ.ZZ)"
  // - "based on X simulations"
  const simrOutputPatterns = [
    /Power for predictor/i,
    /\d+\.\d+%\s*\(\s*\d+\.\d+\s*,\s*\d+\.\d+\s*\)/,  // Power percentage with CI
    /based on \d+ simulations/i,
    /powerSim|powerCurve/i,
    /Simulation time/i,
    /Effect size for/i,
    /successes\s*=\s*\d+/i,
    /trials\s*=\s*\d+/i
  ];

  const hasSimrOutput = simrOutputPatterns.some(pattern => pattern.test(rOutput || ''));

  // Check for error indicators
  const hasError = rOutput && (
    rOutput.includes('Error in') ||
    rOutput.includes('💾 Saving workspace after error') ||
    rOutput.includes('could not find function') ||
    rOutput.includes('there is no package called')
  );

  if (hasError) {
    console.error('[SIMR-VALIDATION] ❌ R execution errored - simr results are fabricated');
    return {
      isValid: false,
      reason: 'R code execution errored. The simr package may not be installed or the code has errors. You must fix the code and re-run simr::powerSim() or simr::powerCurve() to get actual results.'
    };
  }

  if (!hasSimrOutput && executionTimeMs < 30000) {
    console.error('[SIMR-VALIDATION] ❌ FABRICATION DETECTED: No simr output patterns found and execution was fast');
    return {
      isValid: false,
      reason: 'The R output does not contain actual simr powerSim/powerCurve results. You must run simr::powerSim() or simr::powerCurve() with real Monte Carlo simulations. Do not fabricate power percentages.'
    };
  }

  console.log('[SIMR-VALIDATION] ✅ simr results appear valid');
  return { isValid: true, reason: 'Valid simr output detected' };
}

/**
 * CLAUDE MODEL STRATEGY (Updated: Oct 15, 2025)
 *
 * This application uses different Claude models optimally:
 *
 * 1. Main Biostatistics Agent: claude-opus-4-6
 *    - Full reasoning power for complex R code generation
 *    - Iterative error fixing and package debugging
 *    - Critical for quality - KEEP Sonnet 4.6
 *
 * 2. Preliminary File Analysis: claude-opus-4-6
 *    - Fast, efficient text analysis of uploaded files
 *    - Perfect for simple document/data inspection
 *
 * 3. PI Routing Agent: claude-opus-4-6
 *    - Smart query routing (direct answer vs coding)
 *    - High quality decision-making
 *    - See pi-agent.js
 */

// Initialize Google Cloud Storage for datasets
const storage = new Storage({
  projectId: process.env.GCP_PROJECT || 'power-agent-476822'
});
const datasetBucket = storage.bucket('power-agent-datasets-476822');

// Initialize R Process Pool
// This replaces NotebookExecutor for 1000x performance improvement
const rPool = new RProcessPool(10);  // Pool of 10 R processes - reduced from 30 to prevent OOM kills on Cloud Run

// Track pool readiness
let poolReady = false;

// Initialize pool and wait for it to be ready before starting server
async function initializeRPool() {
  try {
    console.log('🔄 Initializing R Process Pool...');
    await rPool.initialize();
    poolReady = true;
    console.log('✅ R Process Pool initialized successfully');
    return true;
  } catch (error) {
    console.error('❌ Failed to initialize R Process Pool:', error);
    console.warn('⚠️  Pool will be initialized on first request (may cause slower first response)');
    return false;
  }
}

// ============================================
// AUTH & CREDIT ENDPOINTS
// ============================================

// Sign up with email/password
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, password, full_name } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: full_name || '' }
    });

    if (error) return res.status(400).json({ error: error.message });

    // Sign in immediately to get session token
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) return res.status(400).json({ error: signInError.message });

    const profile = await getUserCredits(data.user.id);
    res.json({ user: data.user, session: signInData.session, profile });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Signup failed' });
  }
});

// Sign in
app.post('/api/auth/signin', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return res.status(400).json({ error: error.message });

    const profile = await getUserCredits(data.user.id);
    res.json({ user: data.user, session: data.session, profile });
  } catch (err) {
    console.error('Signin error:', err);
    res.status(500).json({ error: 'Sign in failed' });
  }
});

// Get current user profile + credits
app.get('/api/auth/me', authenticateUser, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    const profile = await getUserCredits(req.user.id);
    res.json({ user: req.user, profile });
  } catch (err) {
    console.error('Get profile error:', err);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

// Anonymous status check
app.get('/api/auth/anon-status', authenticateUser, async (req, res) => {
  try {
    if (req.user) {
      const profile = await getUserCredits(req.user.id);
      return res.json({ authenticated: true, profile });
    }

    const fp = req.anonFingerprint;
    const { data } = await supabase.from('anonymous_usage').select('*').eq('fingerprint', fp).single();

    if (data) {
      res.json({ authenticated: false, analyses_used: data.analyses_used, max_allowed: data.max_allowed, fingerprint: fp });
    } else {
      res.json({ authenticated: false, analyses_used: 0, max_allowed: 1, fingerprint: fp });
    }
  } catch (err) {
    console.error('Anon status error:', err);
    res.json({ authenticated: false, analyses_used: 0, max_allowed: 1 });
  }
});

// Credit history
app.get('/api/credits/history', authenticateUser, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    const { data, error } = await supabase
      .from('credit_transactions')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ transactions: data });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get history' });
  }
});

// Purchase placeholder
app.post('/api/credits/purchase', authenticateUser, async (req, res) => {
  res.json({
    message: 'Payment system coming soon. Contact yukang.zeng@yale.edu for credits.',
    contact: 'yukang.zeng@yale.edu',
    pricing: { actual_cost_per_task: '$5', academic_price: '$2' }
  });
});

/**
 * BIOSTATISTICS AGENT with NOTEBOOK EXECUTOR
 * Specialized for R-based biostatistical analysis with auto-iteration
 */
app.post('/api/analyze-biostat', authenticateUser, requireCredits(5), async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');  // CRITICAL: Disable buffering for Cloud Run/nginx proxies

  // CRITICAL: Keep SSE connection alive during long operations (simr can take 10+ minutes)
  // Without this, connections timeout during thinking/reasoning phases when no events are sent
  // Must flush after write to ensure keepalive reaches client through Cloud Run proxy
  const keepAliveInterval = setInterval(() => {
    try {
      res.write(`: keepalive\n\n`);  // SSE comment line for keepalive
      if (res.flush && typeof res.flush === 'function') res.flush();
    } catch (e) { /* connection already closed */ }
  }, 10000);  // Send keepalive every 10 seconds (was 15s, reduced for QUIC compatibility)

  // Clean up keepalive on connection close
  req.on('close', () => {
    clearInterval(keepAliveInterval);
  });

  // Get sessionId early so it's available for sendStep
  const sessionId = req.body.sessionId;

  // Database session UUID (for foreign key constraints)
  let dbSessionId = null;

  // Sequence number for workflow steps
  let workflowSequenceNumber = 0;
  let currentIteration = 0;

  // Enhanced sendStep that also persists to database
  async function sendStep(step, data) {
    // Send to client via SSE (use dbSessionId if available, fallback to sessionId)
    const sessionIdToSend = dbSessionId || sessionId;
    res.write(`data: ${JSON.stringify({ step, timestamp: Date.now(), sessionId: sessionIdToSend, ...data })}\n\n`);

    // CRITICAL: Flush the response to ensure SSE events are sent immediately
    // Without this, events get buffered and don't reach the client in real-time
    if (res.flush && typeof res.flush === 'function') {
      res.flush();
    }

    // Also save to database for session restoration using dbSessionId (UUID)
    // CRITICAL FIX: Now using await to ensure steps are persisted before continuing
    // This prevents data loss when user refreshes during execution
    if (dbSessionId) {
      try {
        await saveWorkflowStep(
          dbSessionId,  // Use UUID from database, not string from client
          data.iteration || currentIteration,
          step,
          ++workflowSequenceNumber,
          {
            title: data.title,
            status: data.status,
            message: data.message,
            code: data.code,
            output: data.output,
            reasoning: data.reasoning,
            error: data.error,
            decision: data.decision,
            confidence: data.confidence,
            content: data.content,
            fullCode: data.fullCode,
            executionOutput: data.executionOutput,
            files: data.files,
            webSearchUsed: data.webSearchUsed,
            iterations: data.iterations,
            totalIterations: data.totalIterations
          },
          data.status || 'completed'
        );
      } catch (dbError) {
        // Log but don't break execution if workflow step saving fails
        console.warn(`⚠️  Could not save workflow step to database: ${dbError.message}`);
      }
    }
  }

  try {
    const { query, data, dataset, mode = 'full_analysis', sessionFiles: requestSessionFiles } = req.body;

    if (!query) {
      await sendStep('error', { message: 'Query is required' });
      clearInterval(keepAliveInterval);
      return res.end();
    }

    console.log(`\n🧬 Starting Biostatistics Analysis [${mode}]: ${query.substring(0, 60)}...`);

    // ===========================
    // CREATE/RETRIEVE SESSION FIRST (needed for saving workflow steps)
    // Always create/retrieve session even if sessionId is null
    // ===========================
    if (sessionId && !sessionId.startsWith('local-')) {
      try {
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId);

        if (isUUID) {
          const { data: existingSession } = await supabase
            .from('chat_sessions')
            .select('session_id')
            .eq('session_id', sessionId)
            .single();

          if (existingSession) {
            dbSessionId = existingSession.session_id;
            console.log(`✅ Using existing session: ${dbSessionId}`);
          }
        }
      } catch (sessionError) {
        console.warn('Error retrieving session:', sessionError.message);
      }
    }

    // Create new session if we don't have one yet
    if (!dbSessionId) {
      try {
        const newSession = await createSession(null);
        dbSessionId = newSession.session_id;

        // Update session title with query
        await supabase
          .from('chat_sessions')
          .update({
            title: query.substring(0, 100),
            status: 'running',
            last_activity: new Date().toISOString(),
            agent_type: 'single-agent'
          })
          .eq('session_id', dbSessionId);

        console.log(`✅ Created new session in database: ${dbSessionId}`);
      } catch (sessionError) {
        console.warn('Error creating session:', sessionError.message);
      }
    }

    // Deduct credits
    if (req.user) {
      const creditResult = await deductCredits(req.user.id, 5, sessionId);
      console.log(`💳 Credits deducted for ${req.user.email}: ${creditResult.credits_remaining} remaining`);
    } else if (req.anonFingerprint) {
      await recordAnonymousUsage(req.anonFingerprint, req.ip);
      console.log(`👤 Anonymous usage recorded: ${req.anonFingerprint}`);
    }

    // CRITICAL: Save user message to database for conversation context
    if (dbSessionId) {
      try {
        await saveMessage(dbSessionId, 'user', query, {
          agent_type: 'biostat',
          mode: mode
        });
        console.log(`✅ Saved user message to session for context`);
      } catch (msgError) {
        console.warn('⚠️  Could not save user message (non-critical):', msgError.message);
      }
    }

    // ===========================
    // PREPARE SESSION FILES CONTEXT (needed for intro chatbot)
    // ===========================
    let sessionFilesContext = '';
    const allSessionFiles = [];

    // 1. Get files from database (with preliminary analysis AND full_content)
    if (dbSessionId) {
      try {
        const dbFiles = await getSessionFiles(dbSessionId);
        if (dbFiles && dbFiles.length > 0) {
          console.log(`📁 Found ${dbFiles.length} file(s) in database`);
          
          // DEBUG: Verify full_content is present
          dbFiles.forEach((f, idx) => {
            const hasFullContent = !!f.full_content;
            const contentLength = f.full_content?.length || 0;
            console.log(`  [DB ${idx}] ${f.file_name}:`);
            console.log(`      - full_content: ${hasFullContent ? 'YES' : 'MISSING'} (${contentLength} chars)`);
            console.log(`      - analysis_summary: ${f.analysis_summary ? 'YES' : 'MISSING'} (${f.analysis_summary?.length || 0} chars)`);
          });
          
          allSessionFiles.push(...dbFiles);
        }
      } catch (fileError) {
        console.warn('⚠️  Error fetching session files from database:', fileError.message);
      }
    }

    // 2. Get files from request body (recently uploaded, may not be in DB yet)
    if (requestSessionFiles && requestSessionFiles.length > 0) {
      console.log(`📁 Found ${requestSessionFiles.length} file(s) in request`);

      // DEBUG: Log what we received from frontend
      requestSessionFiles.forEach((f, idx) => {
        console.log(`  [Request ${idx}] ${f.name}:`);
        console.log(`      - type: ${f.type}`);
        console.log(`      - size: ${f.size}`);
        console.log(`      - download_url: ${f.download_url ? 'present' : 'missing'}`);
        console.log(`      - full_content: ${f.full_content ? 'YES' : 'MISSING'} (${f.full_content?.length || 0} chars)`);
        if (f.preliminary_analysis) {
          console.log(`      - preliminary_analysis keys: ${JSON.stringify(Object.keys(f.preliminary_analysis))}`);
          console.log(`      - preliminary_analysis.analysis length: ${f.preliminary_analysis.analysis?.length || 0} chars`);
          console.log(`      - preliminary_analysis.full_content: ${f.preliminary_analysis.full_content ? 'YES' : 'MISSING'} (${f.preliminary_analysis.full_content?.length || 0} chars)`);
          if (f.preliminary_analysis.analysis) {
            console.log(`      - preliminary_analysis.analysis preview: ${f.preliminary_analysis.analysis.substring(0, 100)}...`);
          }
        } else {
          console.log(`      - preliminary_analysis: MISSING`);
        }
      });

      // Only add files not already in database (by name)
      const dbFileNames = new Set(allSessionFiles.map(f => f.file_name));
      const newFiles = requestSessionFiles.filter(f => !dbFileNames.has(f.name));
      if (newFiles.length > 0) {
        console.log(`📁 Adding ${newFiles.length} new file(s) from request`);
        // Convert request file format to database format
        allSessionFiles.push(...newFiles.map(f => ({
          file_name: f.name,
          file_type: f.type || 'unknown',
          analysis_summary: f.preliminary_analysis?.analysis || null,
          full_content: f.full_content || f.preliminary_analysis?.full_content || null,  // CRITICAL: Include full content for domain expert
          storage_url: f.download_url || f.storage_url || null,  // CRITICAL: Include download URL
          file_size: f.size || null
        })));
      }
    }

    // 3. Download files from Supabase Storage to local temp directory
    const sessionTempDir = `/tmp/session-${sessionId || Date.now()}`;
    if (allSessionFiles.length > 0) {
      console.log(`📁 Total ${allSessionFiles.length} session file(s) available`);

      // Create temp directory for this session
      if (!fs.existsSync(sessionTempDir)) {
        fs.mkdirSync(sessionTempDir, { recursive: true });
        console.log(`📂 Created temp directory: ${sessionTempDir}`);
      }

      // Download each file from Supabase Storage
      for (const file of allSessionFiles) {
        if (file.storage_url && file.storage_url.includes('supabase')) {
          try {
            // Extract the file path from the storage URL
            // URL format: https://{project}.supabase.co/storage/v1/object/public/user-uploads/{sessionId}/{filename}
            const urlParts = file.storage_url.split('/user-uploads/');
            if (urlParts.length > 1) {
              const storagePath = urlParts[1]; // e.g., "session123/file.csv"

              console.log(`📥 Downloading file from Supabase Storage...`);
              console.log(`   - File name: ${file.file_name}`);
              console.log(`   - File type: ${file.file_type}`);
              console.log(`   - Storage path: ${storagePath}`);
              console.log(`   - File size: ${(file.file_size / 1024).toFixed(2)} KB`);

              // Download file from Supabase Storage
              const { data: fileData, error: downloadError } = await supabase.storage
                .from('user-uploads')
                .download(storagePath);

              if (downloadError) {
                console.error(`❌ Download failed for ${file.file_name}: ${downloadError.message}`);
                console.error(`   - Storage path attempted: ${storagePath}`);
                continue;
              }

              // Save to local temp directory
              const localPath = path.join(sessionTempDir, file.file_name);
              const buffer = Buffer.from(await fileData.arrayBuffer());
              fs.writeFileSync(localPath, buffer);

              console.log(`✅ Downloaded successfully: ${file.file_name}`);
              console.log(`   - Local path: ${localPath}`);
              console.log(`   - Downloaded size: ${(buffer.length / 1024).toFixed(2)} KB`);

              // Store local path in file object for R code to use
              file.local_path = localPath;
            }
          } catch (downloadError) {
            console.error(`❌ Exception downloading ${file.file_name}:`, downloadError.message);
            console.error(`   - Stack trace:`, downloadError.stack);
          }
        }

        // Fallback: if download failed but full_content is available, write text files to disk
        if (!file.local_path && file.full_content) {
          const fileExt = file.file_name.split('.').pop().toLowerCase();
          const binaryExts = ['xlsx', 'xls', 'sav', 'dta', 'rds', 'rda', 'rdata', 'sas7bdat', 'por', 'xpt', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'bmp', 'tiff', 'tif', 'pptx', 'ppt', 'zip', '7z', 'tar', 'gz', 'rar', 'feather', 'parquet', 'arrow', 'fst', 'h5', 'hdf5', 'nc', 'sqlite', 'db', 'pkl', 'pickle', 'npy', 'npz', 'mat'];
          if (binaryExts.includes(fileExt)) {
            console.warn(`⚠️ Cannot restore binary file ${file.file_name} from text full_content — binary data requires Supabase Storage download`);
          } else {
            const localPath = path.join(sessionTempDir, file.file_name);
            fs.writeFileSync(localPath, file.full_content);
            file.local_path = localPath;
            console.log(`📝 Wrote file from full_content: ${file.file_name} (${file.full_content.length} chars) -> ${localPath}`);
          }
        }
      }
    }

    // 4. Build context string with local file paths and full preliminary analysis
    if (allSessionFiles.length > 0) {
      sessionFilesContext = '\n\n**Files Available in This Session:**\n';

      // Separate data files from non-data files
      const dataFileExtensions = ['csv', 'xlsx', 'xls', 'tsv', 'txt', 'dat', 'rda', 'rds'];

      for (const file of allSessionFiles) {
        const fileExt = file.file_name.split('.').pop().toLowerCase();
        const isDataFile = dataFileExtensions.includes(fileExt);

        sessionFilesContext += `\n### ${file.file_name} (${file.file_type})`;

        // For data files: provide local path for R code
        if (isDataFile && file.local_path) {
          sessionFilesContext += `\n**Local Path:** "${file.local_path}"`;
          sessionFilesContext += `\n**Usage:** Use this path in your R code to read the data file.`;
          sessionFilesContext += `\n  Example: \`data <- read.csv("${file.local_path}")\``;
        }

        // CRITICAL: Include FULL preliminary analysis (not truncated)
        // For non-data files, this contains the extracted content
        // For data files, this contains data structure and preview
        if (file.analysis_summary) {
          sessionFilesContext += `\n\n**Preliminary Analysis:**\n${file.analysis_summary}`;

          // For non-data files, clarify that content is already extracted
          if (!isDataFile) {
            sessionFilesContext += `\n\n**Note:** The content above has been extracted from the file. You can reference this information directly without needing to download or re-parse the file.`;
          }
        }

        // CRITICAL: Add full document content for domain expert (PDF/DOCX files)
        // This ensures domain expert has access to complete extracted text
        if (file.full_content && !isDataFile) {
          const contentLength = file.full_content.length;
          console.log(`   ✅ Including full_content for ${file.file_name}: ${contentLength} chars`);
          
          // Include up to 50k chars (≈12,500 tokens) - enough for full papers including results/discussion
          // This ensures Domain Expert has maximum context to answer content questions
          const maxContentLength = 50000;
          const truncatedContent = file.full_content.length > maxContentLength
            ? file.full_content.substring(0, maxContentLength)
            : file.full_content;

          sessionFilesContext += `\n\n**Full Document Content (${contentLength} chars, showing first ${truncatedContent.length}):**\n`;
          sessionFilesContext += `\`\`\`\n${truncatedContent}\n\`\`\``;

          if (contentLength > maxContentLength) {
            // For very long documents, try to include end section too (methods/results often at end)
            const remainingChars = contentLength - maxContentLength;
            if (remainingChars > 5000) {
              // Include a sample from the end (often has key results)
              const endSample = file.full_content.substring(contentLength - 5000, contentLength);
              sessionFilesContext += `\n\n**Document End (last 5000 chars):**\n`;
              sessionFilesContext += `\`\`\`\n${endSample}\n\`\`\``;
            }
            sessionFilesContext += `\n\n*(Showing first ${maxContentLength} of ${contentLength} characters. This includes the full abstract, methods, results, and discussion sections. Full document has ${contentLength} characters total)*`;
          }
        } else if (!isDataFile) {
          // WARNING: Full content is missing for a document file
          console.warn(`   ⚠️  WARNING: full_content MISSING for ${file.file_name} (document file but no full_content)`);
        }

        sessionFilesContext += '\n';
      }

      // Add general instructions at the end
      if (allSessionFiles.some(f => {
        const ext = f.file_name.split('.').pop().toLowerCase();
        return dataFileExtensions.includes(ext) && f.local_path;
      })) {
        sessionFilesContext += `\n**Data Files Location:** ${sessionTempDir}/\n`;
        sessionFilesContext += 'Use the Local Path provided for each data file in your R code.\n';
      }

      // DEBUG: Log the sessionFilesContext being built
      console.log(`\n📋 SESSION FILES CONTEXT (${sessionFilesContext.length} chars):`);
      console.log(sessionFilesContext.substring(0, 500) + '...');
    }

    // Hoisted for use in document correction phase later
    let extractedDocText = null;

    // ===========================
    // PHASE 1: CHATBOT INTRO (Stream friendly explanation of what we'll do)
    // ===========================
    console.log('💬 Chatbot: Streaming intro...');
    await sendStep('chatbot_intro_start', {
      title: 'Understanding Your Request',
      status: 'running',
      message: 'Analyzing your question...'
    });

    try {
      // Build dataset context if present - include more details about the dataset
      let datasetContext = '';
      if (dataset) {
        datasetContext = `\n\n**Dataset Provided:** ${dataset.name}`;
        if (dataset.type) {
          datasetContext += ` (${dataset.type})`;
        }
        if (dataset.size) {
          datasetContext += ` - ${(dataset.size / 1024).toFixed(1)} KB`;
        }
        // If there's preliminary analysis from the frontend, include it
        if (dataset.preliminaryAnalysis) {
          datasetContext += `\n  Analysis Summary: ${dataset.preliminaryAnalysis}`;
        }

        // For document files, extract text content NOW so the intro and agent can see it
        const datasetExt = (dataset.name || '').split('.').pop().toLowerCase();
        const isDocFile = ['pdf', 'docx', 'doc', 'txt', 'md', 'rtf'].includes(datasetExt);
        if (isDocFile && dataset.content) {
          try {
            const buffer = Buffer.from(dataset.content, 'base64');
            extractedDocText = null;  // Reset (hoisted above)

            if (datasetExt === 'docx' || datasetExt === 'doc') {
              console.log(`   📄 Extracting DOCX text for agent context...`);
              const mammoth = await import('mammoth');
              const result = await mammoth.extractRawText({ buffer: buffer });
              extractedDocText = result.value;
            } else if (datasetExt === 'pdf') {
              console.log(`   📄 Extracting PDF text for agent context...`);
              const pdfParse = (await import('pdf-parse')).default;
              const pdfData = await pdfParse(buffer);
              extractedDocText = pdfData.text;
            } else {
              extractedDocText = buffer.toString('utf-8');
            }

            if (extractedDocText && extractedDocText.trim().length > 0) {
              const maxLen = 50000;
              const truncated = extractedDocText.length > maxLen
                ? extractedDocText.substring(0, maxLen) + `\n\n... [Truncated: ${extractedDocText.length} total chars]`
                : extractedDocText;
              datasetContext += `\n\n**Full Document Content:**\n\`\`\`\n${truncated}\n\`\`\``;
              // Also add to sessionFilesContext for the agent loop
              sessionFilesContext += `\n\n### Uploaded Document: ${dataset.name}\n`;
              sessionFilesContext += `**Full Document Content (${extractedDocText.length} chars):**\n`;
              sessionFilesContext += `\`\`\`\n${truncated}\n\`\`\``;
              sessionFilesContext += `\n\n**Note:** Use this document content directly. No need to download or re-parse the file.`;
              console.log(`   ✅ Document text extracted for context: ${extractedDocText.length} chars`);
            }
          } catch (extractErr) {
            console.warn(`   ⚠️  Early document extraction failed: ${extractErr.message}`);
          }
        }

        if (!isDocFile) {
          datasetContext += '\n  The data has been uploaded and will be available for your R analysis.';
        }
      }

      // Build a BRIEF context for the intro (file names only, no full content)
      let introFileContext = '';
      if (allSessionFiles && allSessionFiles.length > 0) {
        const fileNames = allSessionFiles.map(f => f.file_name).join(', ');
        introFileContext = `\n\nAttached files: ${fileNames}`;
      }
      if (datasetContext) {
        // Only include first line of dataset context (the name/type)
        const firstLine = datasetContext.split('\n').find(l => l.trim()) || '';
        if (firstLine && !introFileContext.includes(firstLine.trim())) {
          introFileContext += `\nDataset: ${firstLine.trim()}`;
        }
      }

      // Use Claude Sonnet 4.6 for intro streaming
      const introStream = await anthropic.messages.stream({
        model: 'claude-opus-4-6',  // Sonnet 4.6 for simple text
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: `You are a professional biostatistics consultant providing expert analysis services.

A client requested: "${query}"${introFileContext}

Provide a BRIEF professional acknowledgment (3-5 sentences MAX) that:
1. Confirms understanding of their statistical request
2. States what calculation/analysis you will perform
3. Indicates analysis will proceed now

CRITICAL RULES - YOU MUST FOLLOW:
- Output EXACTLY 3-5 plain sentences. Nothing more.
- DO NOT analyze or summarize the uploaded document content.
- DO NOT include tables, bullet points, headers, or markdown formatting.
- DO NOT list parameters, criteria, or assumptions from the document.
- DO NOT provide any calculations, formulas, or methodology details.
- Just acknowledge the request in plain prose and say you'll proceed.

Good example: "I understand you need to re-evaluate all sample size calculations and power analyses in the attached DOR thumbtack needle RCT Statistical Analysis Plan. I will systematically verify the primary sample size calculation, check all statistical assumptions and effect sizes, and evaluate power for all secondary endpoints. Proceeding with the comprehensive re-evaluation now."

Bad example (TOO LONG/DETAILED): "Based on your request... The primary sample size is n=240... Alpha=0.05... Effect size of 0.10... [table of issues]..." - This is WRONG. Never do this.`
        }]
      });

      // Stream intro text to client
      let introText = '';
      introStream.on('text', async (text) => {
        introText += text;
        await sendStep('chatbot_intro_stream', {
          text: text,
          fullText: introText
        });
      });

      // Wait for intro to complete
      await introStream.finalMessage();

      await sendStep('chatbot_intro_complete', {
        title: 'Understanding Your Request',
        status: 'completed',
        message: introText
      });

      console.log(`   ✅ Chatbot intro streamed (${introText.length} chars)`);
    } catch (introError) {
      console.warn('⚠️  Chatbot intro failed, continuing with analysis:', introError.message);
      // Continue with analysis even if intro fails
    }

    // Small delay to let frontend show intro before starting heavy work
    await new Promise(resolve => setTimeout(resolve, 500));

    // Session already created/retrieved at the start (line 223-263)
    // This ensures dbSessionId is set before any workflow steps are saved

    // ===========================
    // PHASE 2: DOMAIN EXPERT ANALYSIS (Check completeness & provide consultation)
    // ===========================

    // Allow bypassing domain expert for testing or when explicitly requested
    // REMOVED FIX #8 (Nov 2, 2025): PDF bypass no longer needed
    // Domain Expert has been enhanced to correctly distinguish content questions from calculation requests

    const skipDomainExpert = req.body.bypassDomainExpert ||
                            query.toLowerCase().includes('test tavily') ||
                            query.toLowerCase().includes('create a histogram') ||
                            query.toLowerCase().includes('ggplot') ||
                            query.toLowerCase().includes('ggplot2') ||
                            query.toLowerCase().includes('search for ggplot');
                            // REMOVED: (hasPDFFile && isPowerCalculationRequest) - Domain Expert now handles this

    if (!skipDomainExpert) {
      console.log('🧠 Domain Expert: Analyzing query completeness...');
      await sendStep('domain_expert_analysis', {
        title: 'Domain Expert: Analyzing Request',
        status: 'running',
        message: 'Checking if all necessary information is provided...'
      });

      try {
      // Load session context for context-aware analysis (optional - may not have messages table)
      let sessionContext = [];
      try {
        sessionContext = await chatbotDomainExpert.loadSessionContext(dbSessionId);
      } catch (contextError) {
        console.log('Note: Could not load session context (non-critical), proceeding without it');
      }

      // Analyze query with domain expertise (include session files context)
      const domainAnalysis = await chatbotDomainExpert.analyzeQuery(query, sessionContext, sessionFilesContext);

      // 🔍 DEBUG: Log Domain Expert decision
      console.log('\n🧠 ═══════════════════════════════════════════════════════');
      console.log('🧠 DOMAIN EXPERT DECISION:');
      console.log('🧠 ═══════════════════════════════════════════════════════');
      console.log(`   Mode: ${domainAnalysis.mode}`);
      console.log(`   Reasoning: ${domainAnalysis.reasoning}`);
      console.log(`   Has PDF Context: ${sessionFilesContext.length > 0 ? 'YES' : 'NO'} (${sessionFilesContext.length} chars)`);
      console.log(`   Web Search Used: ${domainAnalysis.web_search_used ? 'YES' : 'NO'}`);
      console.log('🧠 ═══════════════════════════════════════════════════════\n');

      await sendStep('domain_expert_analysis', {
        title: 'Domain Expert: Analysis Complete',
        status: 'completed',
        mode: domainAnalysis.mode,
        reasoning: domainAnalysis.reasoning,
        webSearchUsed: domainAnalysis.web_search_used,
        hasPDFContext: sessionFilesContext.length > 0,
        pdfContextLength: sessionFilesContext.length
      });

      // Handle different modes
      switch (domainAnalysis.mode) {
        case 'needs_info':
          console.log('⚠️  Domain Expert: Missing information - asking user');

          const needsInfoResponse = chatbotDomainExpert.generateChatbotResponse(domainAnalysis);

          await sendStep('needs_info', {
            title: 'Need More Information',
            status: 'needs_info',
            content: needsInfoResponse,
            missing_parameters: domainAnalysis.missing_info,
            context: domainAnalysis.context_summary
          });

          // Stream as chatbot conclusion so it shows in the chat UI
          console.log('💬 Chatbot: Streaming needs_info conclusion...');
          await sendStep('chatbot_conclusion_start', {
            title: 'Additional Information Needed',
            status: 'running',
            message: 'Preparing request...'
          });

          try {
            const needsInfoStream = await anthropic.messages.stream({
              model: 'claude-opus-4-6',
              max_tokens: 800,
              messages: [{
                role: 'user',
                content: `You are a professional biostatistics consultant. The user's question is missing some information needed for analysis. Present this request in a professional, clear, and helpful manner.

**USER'S ORIGINAL QUESTION:**
"${query}"

**WHAT'S NEEDED:**
${needsInfoResponse}

${domainAnalysis.missing_info ? `**MISSING PARAMETERS:**\n${JSON.stringify(domainAnalysis.missing_info)}` : ''}

YOUR TASK: Write 3-5 professional sentences that:
1. Acknowledge the user's question
2. Explain what specific information is missing and why it's needed
3. Provide guidance on what to include in their follow-up

Use a professional biostatistician consulting tone.`
              }]
            });

            let needsInfoConclusion = '';
            needsInfoStream.on('text', async (text) => {
              needsInfoConclusion += text;
              await sendStep('chatbot_conclusion_stream', {
                text: text,
                fullText: needsInfoConclusion
              });
            });

            await needsInfoStream.finalMessage();

            await sendStep('chatbot_conclusion_complete', {
              title: 'Additional Information Needed',
              status: 'completed',
              message: needsInfoConclusion
            });

            console.log(`   ✅ Needs-info conclusion streamed (${needsInfoConclusion.length} chars)`);

            const needsInfoTextForDb = needsInfoConclusion || needsInfoResponse;

            if (dbSessionId) {
              try {
                await saveMessage(dbSessionId, 'assistant', needsInfoTextForDb, {
                  agent_type: 'domain_expert',
                  analysis_mode: 'needs_info',
                  missing_info: domainAnalysis.missing_info
                });

                await updateSessionStatus(dbSessionId, 'needs_info', {
                  current_step: 'Waiting for user input',
                  domain_expert_mode: 'needs_info',
                  missing_parameters: domainAnalysis.missing_info?.length || 0
                });
              } catch (saveError) {
                console.log('Note: Could not update session status (non-critical):', saveError.message);
              }
            }
          } catch (needsInfoStreamError) {
            console.warn('⚠️  Needs-info conclusion streaming failed:', needsInfoStreamError.message);
            await sendStep('chatbot_conclusion_complete', {
              title: 'Additional Information Needed',
              status: 'completed',
              message: needsInfoResponse
            });

            if (dbSessionId) {
              try {
                await saveMessage(dbSessionId, 'assistant', needsInfoResponse, {
                  agent_type: 'domain_expert',
                  analysis_mode: 'needs_info',
                  missing_info: domainAnalysis.missing_info
                });
                await updateSessionStatus(dbSessionId, 'needs_info', {
                  current_step: 'Waiting for user input',
                  domain_expert_mode: 'needs_info',
                  missing_parameters: domainAnalysis.missing_info?.length || 0
                });
              } catch (saveError) {
                console.log('Note: Could not update session status (non-critical):', saveError.message);
              }
            }
          }

          await sendStep('complete', {
            type: 'needs_info',
            requires_user_input: true,
            iterations: 0,
            conversationLength: 0
          });

          clearInterval(keepAliveInterval);
          return res.end();

        case 'consultation':
          console.log('💡 Domain Expert: Providing consultation (no calculation needed)');

          const consultResponse = chatbotDomainExpert.generateChatbotResponse(domainAnalysis);
          console.log('💡 Generated consultation response length:', consultResponse?.length || 0);

          await sendStep('consultation', {
            title: 'Expert Consultation',
            status: 'completed',
            content: consultResponse || domainAnalysis.reasoning || domainAnalysis.summary || 'I can provide consultation based on the uploaded paper content.',
            recommendations: domainAnalysis.recommendations,
            follow_up: domainAnalysis.follow_up,
            reasoning: domainAnalysis.reasoning
          });

          // Stream the consultation as a chatbot conclusion so it shows in the chat UI
          console.log('💬 Chatbot: Streaming consultation conclusion...');
          await sendStep('chatbot_conclusion_start', {
            title: 'Expert Consultation',
            status: 'running',
            message: 'Preparing consultation summary...'
          });

          try {
            const consultStream = await anthropic.messages.stream({
              model: 'claude-opus-4-6',
              max_tokens: 800,
              messages: [{
                role: 'user',
                content: `You are a professional biostatistics consultant providing expert guidance. Present the following consultation response in a professional, clear manner.

**USER'S ORIGINAL QUESTION:**
"${query}"

**EXPERT CONSULTATION RESPONSE:**
${consultResponse}

${domainAnalysis.recommendations ? `**RECOMMENDATIONS:**\n${JSON.stringify(domainAnalysis.recommendations)}` : ''}

YOUR TASK: Write 3-5 professional sentences summarizing the consultation. Be specific and use a professional biostatistician consulting tone.`
              }]
            });

            let consultConclusion = '';
            consultStream.on('text', async (text) => {
              consultConclusion += text;
              await sendStep('chatbot_conclusion_stream', {
                text: text,
                fullText: consultConclusion
              });
            });

            await consultStream.finalMessage();

            await sendStep('chatbot_conclusion_complete', {
              title: 'Expert Consultation',
              status: 'completed',
              message: consultConclusion
            });

            console.log(`   ✅ Consultation conclusion streamed (${consultConclusion.length} chars)`);

            const consultTextForDb = consultConclusion || consultResponse;

            if (dbSessionId) {
              try {
                await saveMessage(dbSessionId, 'assistant', consultTextForDb, {
                  agent_type: 'domain_expert',
                  analysis_mode: 'consultation',
                  recommendations: domainAnalysis.recommendations,
                  follow_up: domainAnalysis.follow_up
                });

                await updateSessionStatus(dbSessionId, 'completed', {
                  current_step: 'Consultation provided',
                  agent: 'domain_expert',
                  domain_expert_mode: 'consultation'
                });
              } catch (saveError) {
                console.log('Note: Could not update session status (non-critical):', saveError.message);
              }
            }
          } catch (consultStreamError) {
            console.warn('⚠️  Consultation conclusion streaming failed:', consultStreamError.message);
            await sendStep('chatbot_conclusion_complete', {
              title: 'Expert Consultation',
              status: 'completed',
              message: consultResponse
            });

            if (dbSessionId) {
              try {
                await saveMessage(dbSessionId, 'assistant', consultResponse, {
                  agent_type: 'domain_expert',
                  analysis_mode: 'consultation',
                  recommendations: domainAnalysis.recommendations,
                  follow_up: domainAnalysis.follow_up
                });
                await updateSessionStatus(dbSessionId, 'completed', {
                  current_step: 'Consultation provided',
                  agent: 'domain_expert',
                  domain_expert_mode: 'consultation'
                });
              } catch (saveError) {
                console.log('Note: Could not update session status (non-critical):', saveError.message);
              }
            }
          }

          await sendStep('complete', {
            type: 'consultation',
            can_proceed_to_calculation: domainAnalysis.can_proceed_to_calculation || false,
            iterations: 0,
            conversationLength: 0
          });

          clearInterval(keepAliveInterval);
          return res.end();

        case 'research':
          console.log('🔍 Domain Expert: Research/literature question - providing evidence-based answer');

          const researchResponse = chatbotDomainExpert.generateChatbotResponse(domainAnalysis);
          console.log('🔍 Generated research response length:', researchResponse?.length || 0);

          await sendStep('consultation', {  // Use 'consultation' type for consistency with frontend
            title: 'Literature Research',
            status: 'completed',
            content: researchResponse || domainAnalysis.reasoning || 'Research findings based on literature search.',
            reasoning: domainAnalysis.reasoning,
            summary: domainAnalysis.summary,
            web_search_used: domainAnalysis.web_search_used,
            search_query: domainAnalysis.search_query,
            recommendations: domainAnalysis.recommendations
          });

          // Stream the research response as a chatbot conclusion
          console.log('💬 Chatbot: Streaming research conclusion...');
          await sendStep('chatbot_conclusion_start', {
            title: 'Literature Research',
            status: 'running',
            message: 'Preparing research summary...'
          });

          try {
            const researchStream = await anthropic.messages.stream({
              model: 'claude-opus-4-6',
              max_tokens: 800,
              messages: [{
                role: 'user',
                content: `You are a professional biostatistics consultant providing evidence-based guidance. Present the following research findings in a professional, clear manner.

**USER'S ORIGINAL QUESTION:**
"${query}"

**RESEARCH FINDINGS:**
${researchResponse}

${domainAnalysis.web_search_used ? '**Note:** Web search was used to find relevant literature.' : ''}

YOUR TASK: Write 3-5 professional sentences summarizing the key findings. Be specific about evidence and recommendations. Use a professional biostatistician consulting tone.`
              }]
            });

            let researchConclusion = '';
            researchStream.on('text', async (text) => {
              researchConclusion += text;
              await sendStep('chatbot_conclusion_stream', {
                text: text,
                fullText: researchConclusion
              });
            });

            await researchStream.finalMessage();

            await sendStep('chatbot_conclusion_complete', {
              title: 'Literature Research',
              status: 'completed',
              message: researchConclusion
            });

            console.log(`   ✅ Research conclusion streamed (${researchConclusion.length} chars)`);

            const researchTextForDb = researchConclusion || researchResponse;

            if (dbSessionId) {
              try {
                await saveMessage(dbSessionId, 'assistant', researchTextForDb, {
                  agent_type: 'domain_expert',
                  analysis_mode: 'research',
                  web_search_used: domainAnalysis.web_search_used,
                  search_query: domainAnalysis.search_query,
                  recommendations: domainAnalysis.recommendations
                });

                await updateSessionStatus(dbSessionId, 'completed', {
                  current_step: 'Literature research provided',
                  agent: 'domain_expert',
                  domain_expert_mode: 'research',
                  web_search_used: domainAnalysis.web_search_used
                });
              } catch (saveError) {
                console.log('Note: Could not update session status (non-critical):', saveError.message);
              }
            }
          } catch (researchStreamError) {
            console.warn('⚠️  Research conclusion streaming failed:', researchStreamError.message);
            await sendStep('chatbot_conclusion_complete', {
              title: 'Literature Research',
              status: 'completed',
              message: researchResponse
            });

            if (dbSessionId) {
              try {
                await saveMessage(dbSessionId, 'assistant', researchResponse, {
                  agent_type: 'domain_expert',
                  analysis_mode: 'research',
                  web_search_used: domainAnalysis.web_search_used,
                  search_query: domainAnalysis.search_query,
                  recommendations: domainAnalysis.recommendations
                });
                await updateSessionStatus(dbSessionId, 'completed', {
                  current_step: 'Literature research provided',
                  agent: 'domain_expert',
                  domain_expert_mode: 'research',
                  web_search_used: domainAnalysis.web_search_used
                });
              } catch (saveError) {
                console.log('Note: Could not update session status (non-critical):', saveError.message);
              }
            }
          }

          await sendStep('complete', {
            type: 'research',
            web_search_used: domainAnalysis.web_search_used,
            iterations: 0,
            conversationLength: 0
          });

          clearInterval(keepAliveInterval);
          return res.end();

        case 'clarification':
          console.log('❓ Domain Expert: Request needs clarification');

          const clarifyResponse = chatbotDomainExpert.generateChatbotResponse(domainAnalysis);

          await sendStep('clarification', {
            title: 'Clarification Needed',
            status: 'needs_clarification',
            content: clarifyResponse,
            interpretations: domainAnalysis.interpretations,
            reasoning: domainAnalysis.reasoning
          });

          // Stream the clarification as a chatbot conclusion so it shows in the chat UI
          console.log('💬 Chatbot: Streaming clarification conclusion...');
          await sendStep('chatbot_conclusion_start', {
            title: 'Clarification Needed',
            status: 'running',
            message: 'Preparing clarification...'
          });

          try {
            const clarifyStream = await anthropic.messages.stream({
              model: 'claude-opus-4-6',
              max_tokens: 800,
              messages: [{
                role: 'user',
                content: `You are a professional biostatistics consultant. The user's question needs clarification before analysis can proceed. Present the clarification request in a professional, clear, and helpful manner.

**USER'S ORIGINAL QUESTION:**
"${query}"

**DOMAIN EXPERT'S ASSESSMENT:**
${clarifyResponse}

${domainAnalysis.interpretations ? `**POSSIBLE INTERPRETATIONS:**\n${JSON.stringify(domainAnalysis.interpretations)}` : ''}

YOUR TASK: Write 3-5 professional sentences that:
1. Acknowledge the user's question
2. Explain what specific information is needed and why
3. Suggest what details would help proceed with the analysis

Use a professional biostatistician consulting tone. Be specific about what's needed.`
              }]
            });

            let clarifyConclusion = '';
            clarifyStream.on('text', async (text) => {
              clarifyConclusion += text;
              await sendStep('chatbot_conclusion_stream', {
                text: text,
                fullText: clarifyConclusion
              });
            });

            await clarifyStream.finalMessage();

            await sendStep('chatbot_conclusion_complete', {
              title: 'Clarification Needed',
              status: 'completed',
              message: clarifyConclusion
            });

            console.log(`   ✅ Clarification conclusion streamed (${clarifyConclusion.length} chars)`);

            // Use streamed text for DB save
            const clarifyTextForDb = clarifyConclusion || clarifyResponse;

            if (dbSessionId) {
              try {
                await saveMessage(dbSessionId, 'assistant', clarifyTextForDb, {
                  agent_type: 'domain_expert',
                  analysis_mode: 'clarification',
                  interpretations: domainAnalysis.interpretations
                });

                await updateSessionStatus(dbSessionId, 'needs_clarification', {
                  domain_expert_mode: 'clarification'
                });
              } catch (saveError) {
                console.log('Note: Could not update session status (non-critical):', saveError.message);
              }
            }
          } catch (clarifyStreamError) {
            console.warn('⚠️  Clarification conclusion streaming failed:', clarifyStreamError.message);
            // Fallback: send the static response as a complete conclusion
            await sendStep('chatbot_conclusion_complete', {
              title: 'Clarification Needed',
              status: 'completed',
              message: clarifyResponse
            });

            if (dbSessionId) {
              try {
                await saveMessage(dbSessionId, 'assistant', clarifyResponse, {
                  agent_type: 'domain_expert',
                  analysis_mode: 'clarification',
                  interpretations: domainAnalysis.interpretations
                });
                await updateSessionStatus(dbSessionId, 'needs_clarification', {
                  domain_expert_mode: 'clarification'
                });
              } catch (saveError) {
                console.log('Note: Could not update session status (non-critical):', saveError.message);
              }
            }
          }

          await sendStep('complete', {
            type: 'clarification',
            requires_user_input: true,
            iterations: 0,
            conversationLength: 0
          });

          clearInterval(keepAliveInterval);
          return res.end();

        case 'ready_for_calculation':
          console.log('✅ Domain Expert: All information present, proceeding to calculation');

          const readyResponse = chatbotDomainExpert.generateChatbotResponse(domainAnalysis);

          await sendStep('domain_expert_ready', {
            title: 'Domain Expert: Ready for Analysis',
            status: 'completed',
            content: readyResponse,
            confirmed_parameters: domainAnalysis.confirmed_parameters
          });

          // Continue to PI routing...
          break;

        default:
          console.warn('⚠️  Unknown domain expert mode, proceeding with analysis');
          // Continue to PI routing...
      }

      } catch (domainExpertError) {
        console.error('❌ Domain expert analysis failed:', domainExpertError.message);
        console.error('❌ Error stack:', domainExpertError.stack);
        
        // CRITICAL: Send error details to frontend so user knows what happened
        await sendStep('domain_expert_analysis', {
          title: 'Domain Expert: Analysis Failed',
          status: 'error',
          mode: 'error',
          reasoning: `Domain expert analysis encountered an error: ${domainExpertError.message}`,
          error: domainExpertError.message,
          hasPDFContext: sessionFilesContext.length > 0,
          pdfContextLength: sessionFilesContext.length
        });
        
        // HONEST ERROR HANDLING - No fallback suppression
        // If domain expert fails, we should know about it immediately
        console.error('❌ CRITICAL: Domain expert failed!');
        console.error('❌ Query:', query);
        console.error('❌ Session files context length:', sessionFilesContext.length);
        console.error('❌ Error details:', domainExpertError);

        // RE-THROW the error so we know there's a problem
        // Don't silently continue - let the system fail honestly
        throw new Error(`Domain Expert Analysis Failed: ${domainExpertError.message}`);
      }
    } else {
      console.log('⏩ Bypassing domain expert analysis for this query');
    }

    // Small delay to let frontend show domain expert feedback
    await new Promise(resolve => setTimeout(resolve, 300));

    // CRITICAL: Load conversation history BEFORE PI routing
    // This ensures PI Agent has context from previous messages
    const conversationHistory = [];

    if (dbSessionId) {
      try {
        console.log(`📜 Loading previous conversation history for session: ${dbSessionId}`);
        const { data: previousMessages, error: messagesError } = await supabase
          .from('chat_messages')
          .select('role, content, created_at')
          .eq('session_id', dbSessionId)
          .order('sequence_number', { ascending: true });

        if (messagesError) {
          console.error(`❌ Error loading conversation history: ${messagesError.message}`);
        } else if (previousMessages && previousMessages.length > 0) {
          console.log(`✅ Loaded ${previousMessages.length} previous messages`);

          // Add previous messages to conversation history
          for (const msg of previousMessages) {
            conversationHistory.push({
              role: msg.role,
              content: msg.content
            });
          }

          console.log(`📝 Conversation history initialized with ${conversationHistory.length} messages`);
        } else {
          console.log(`📝 No previous messages found - starting fresh conversation`);
        }
      } catch (loadError) {
        console.error(`❌ Failed to load conversation history: ${loadError.message}`);
        // Continue with empty history if loading fails
      }
    }

    // STEP 1: PI AGENT ROUTING DECISION (Skip for preliminary_analysis mode)
    let routingDecision;

    if (mode === 'preliminary_analysis') {
      // Preliminary analysis always goes to coding agent (no PI routing needed)
      console.log('📊 Preliminary Analysis Mode: Skipping PI routing, going directly to coding agent');
      routingDecision = {
        decision: 'needs_coding',
        reasoning: 'Preliminary data analysis requires R code execution',
        confidence: 1.0,
        requires: ['R']
      };
    } else {
      // Full analysis: Use PI agent for routing WITH conversation history AND session files
      console.log('🧠 PI Agent: Analyzing query to determine routing...');
      console.log(`   - Conversation history: ${conversationHistory.length} messages`);
      console.log(`   - Session files context: ${sessionFilesContext.length} chars`);
      await sendStep('pi_routing', {
        title: 'PI Agent: Analyzing Request',
        status: 'running',
        message: 'Determining if direct answer or coding execution is needed...'
      });

      routingDecision = await routeQuery(query, conversationHistory, sessionFilesContext);
    }

    await sendStep('pi_routing', {
      title: 'PI Agent: Routing Decision',
      status: 'completed',
      decision: routingDecision.decision,
      reasoning: routingDecision.reasoning,
      confidence: routingDecision.confidence
    });

    // If dbSessionId available, save PI routing decision to database
    if (dbSessionId) {
      try {
        await saveMessage(dbSessionId, 'assistant', `Analyzing your request...`, {
          agent_type: 'pi',
          routing_decision: routingDecision
        });
      } catch (dbError) {
        console.warn('Could not save PI routing to database:', dbError.message);
      }
    }

    // If PI agent decides to answer directly, return immediately
    if (routingDecision.decision === 'direct_answer') {
      console.log('✅ PI Agent: Providing direct answer (no coding needed)');

      await sendStep('pi_answer', {
        title: 'PI Agent: Direct Answer',
        status: 'completed',
        content: routingDecision.response
      });

      // Save direct answer to database if dbSessionId available
      if (dbSessionId) {
        try {
          await saveMessage(dbSessionId, 'assistant', routingDecision.response, {
            agent_type: 'pi',
            needs_coding: false
          });
          await updateSessionStatus(dbSessionId, 'completed', {
            agent: 'pi',
            completed_at: new Date().toISOString()
          });
        } catch (dbError) {
          console.warn('Could not save direct answer to database:', dbError.message);
        }
      }

      await sendStep('complete', {
        iterations: 0,
        type: 'direct_answer'
      });

      clearInterval(keepAliveInterval);
      return res.end();
    }

    // Otherwise, proceed with coding agent
    console.log(`🔧 PI Agent: Routing to coding agent (${(routingDecision.requires && routingDecision.requires.join(', ')) || 'R'})`);

    await sendStep('pi_routing', {
      title: 'PI Agent: Calling Coding Agent',
      status: 'completed',
      message: `Routing to ${(routingDecision.requires && routingDecision.requires.join('/')) || 'R'} coding agent...`,
      coding_plan: routingDecision.coding_plan
    });

    // Update session status to running
    if (dbSessionId) {
      try {
        await updateSessionStatus(dbSessionId, 'running', {
          current_step: 'Starting coding agent',
          agent: 'coding',
          started_at: new Date().toISOString()
        });
      } catch (dbError) {
        console.warn('Could not update session status:', dbError.message);
      }
    }

    // Handle dataset upload if provided
    let datasetInfo = null;
    if (dataset) {
      console.log(`📁 Dataset provided: ${dataset.name || 'unnamed'}`);

      try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const uploadSessionId = `session-${timestamp}`;
        let gcsPath;

        if (dataset.gcsPath) {
          // Dataset already in GCS (e.g., benchmark datasets)
          gcsPath = dataset.gcsPath;
          console.log(`   Using existing GCS path: ${gcsPath}`);
        } else if (dataset.content) {
          // New upload - decode base64 and upload to GCS
          const buffer = Buffer.from(dataset.content, 'base64');
          const filename = dataset.name || `dataset-${timestamp}.csv`;
          gcsPath = `user-uploads/${uploadSessionId}/${filename}`;

          console.log(`   Uploading to GCS: ${gcsPath} (${buffer.length} bytes)`);

          const file = datasetBucket.file(gcsPath);
          await file.save(buffer, {
            contentType: dataset.contentType || 'text/csv',
            metadata: {
              originalName: filename,
              uploadTimestamp: timestamp,
              query: query.substring(0, 100)
            }
          });

          console.log(`   ✅ Dataset uploaded successfully`);
          // Note: Document text extraction now happens earlier (in datasetContext building)
        } else {
          throw new Error('Dataset must have either "content" (base64) or "gcsPath"');
        }

        datasetInfo = {
          name: dataset.name || 'dataset.csv',
          gcsPath: gcsPath,
          gcsBucket: 'power-agent-datasets-476822',
          localPath: `/workspace/data/${dataset.name || 'dataset.csv'}`
        };

      } catch (uploadError) {
        console.error(`❌ Dataset upload error: ${uploadError.message}`);
        await sendStep('error', { message: `Dataset upload failed: ${uploadError.message}` });
        clearInterval(keepAliveInterval);
        return res.end();
      }
    }

    // Note: sessionFilesContext was already built earlier (before intro chatbot)

    await sendStep('init', {
      title: 'Initializing Biostatistics Agent',
      status: 'running',
      message: 'Preparing R analysis environment...',
    });

    // Note: conversationHistory already loaded earlier (before PI routing)
    // This ensures both PI Agent and Coding Agent have full conversation context

    let iteration = 0;

    // ADAPTIVE MAX_ITERATIONS based on mode and complexity
    let maxIterations;

    if (mode === 'preliminary_analysis') {
      // Preliminary analysis: Fast, simplified (5 iterations max)
      maxIterations = 5;
      console.log(`📊 Preliminary Analysis Mode: Max iterations: ${maxIterations}`);
    } else {
      // Full analysis: Generous limits to allow for complexity
      // Increased limits to accommodate:
      // - On-demand package installation (may need retries)
      // - Complex statistical procedures requiring multiple attempts
      // - Error correction and refinement
      // - Multiple visualizations and analyses
      const queryLower = query.toLowerCase();
      const isComplexQuery =
        queryLower.includes('bayesian') ||
        queryLower.includes('zero-inflated') ||
        queryLower.includes('ordinal') ||
        queryLower.includes('probit') ||
        queryLower.includes('interrupted time') ||
        queryLower.includes('functional data') ||
        queryLower.includes('stepped wedge') ||
        queryLower.includes('mixed effect') ||
        queryLower.includes('hierarchical') ||
        queryLower.includes('multi') ||
        queryLower.includes('longitudinal') ||
        query.length > 200;  // Long queries are typically complex

      // Significantly increased limits based on testing needs
      // Simple: 10 iterations (was 5) - allows for package installation + analysis
      // Complex: 15 iterations (was 8) - allows for multiple attempts and refinements
      maxIterations = isComplexQuery ? 15 : 10;
      console.log(`📊 Query complexity: ${isComplexQuery ? 'COMPLEX' : 'SIMPLE'} → Max iterations: ${maxIterations}`);
    }

    let isComplete = false;
    const allExecutedCode = [];  // Track all R code that was successfully executed
    const allExecutionOutputs = [];  // Track all actual R outputs for verification
    let lastExecution = null;  // Track last execution to access output_files after loop

    // System prompt for biostatistics (using shared module for consistency with multi-agent)
    const systemPrompt = getBiostatSystemPrompt(datasetInfo, data);

    conversationHistory.push({
      role: 'user',
      content: `Please perform this biostatistical analysis: "${query}"${data ? '\n\nData:\n' + data : ''}${sessionFilesContext}`,
    });

    await sendStep('init', {
      title: 'Initializing Biostatistics Agent',
      status: 'completed',
      message: 'Ready. Starting agent loop...',
    });

    // ITERATIVE AGENT LOOP
    while (!isComplete && iteration < maxIterations) {
      iteration++;
      currentIteration = iteration; // Track for workflow steps

      // Update session status with RICH progress data (Option 2)
      if (dbSessionId) {
        try {
          await updateSessionStatus(dbSessionId, 'running', {
            current_iteration: iteration,
            total_iterations: maxIterations,
            current_step: iteration === 1 ? 'Understanding request' : `Iteration ${iteration}`,
            agent: 'coding',
            code_blocks_generated: allExecutedCode.length,
            execution_outputs: allExecutionOutputs.length,
            last_activity_timestamp: new Date().toISOString()
          });
        } catch (dbError) {
          // Continue even if database update fails
        }
      }

      await sendStep('thinking', {
        iteration,
        title: `Agent Thinking - Iteration ${iteration}`,
        status: 'running',
        message: iteration === 1
          ? 'Understanding the biostatistical request and planning approach...'
          : 'Reviewing previous results and deciding next steps...',
      });

      // Call Claude with Tavily web search tool
      const response = await callAnthropicWithRetry({
        model: 'claude-opus-4-6',  // Sonnet 4.6 for best biostatistics reasoning
        max_tokens: 16000,  // CRITICAL: Increased from 4000 - simr code can be 10k+ chars
        system: systemPrompt,
        messages: conversationHistory,
        tools: [{
          name: 'tavily_search',
          description: 'Search the web for information using Tavily API. Use this when you need to find R package documentation, statistical methods, or programming solutions.',
          input_schema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'The search query'
              },
              search_depth: {
                type: 'string',
                enum: ['basic', 'advanced'],
                description: 'Search depth - basic for quick results, advanced for comprehensive search'
              },
              max_results: {
                type: 'number',
                description: 'Maximum number of results to return (default: 5)'
              }
            },
            required: ['query']
          }
        }],
        tool_choice: { type: 'auto' }
      });

      // Handle response content (can include text, tool uses, and tool results)
      let assistantContent = response.content;
      let usedWebSearch = false;

      // Check for tool calls and handle them
      const toolCalls = assistantContent.filter(block => block.type === 'tool_use');

      if (toolCalls.length > 0) {
        console.log(`🔧 Processing ${toolCalls.length} tool call(s)...`);

        // CRITICAL FIX: Collect ALL tool_results first, then make ONE continuation call
        // The Anthropic API requires EVERY tool_use to have a corresponding tool_result
        const toolResults = [];

        // Process each tool call and collect results
        for (const toolCall of toolCalls) {
          if (toolCall.name === 'tavily_search') {
            usedWebSearch = true;
            console.log(`🔍 Tavily search requested: "${toolCall.input.query}"`);

            const searchResults = await performTavilySearch(toolCall.input);

            // Log search results summary
            if (searchResults.success) {
              console.log(`✅ Tavily returned ${searchResults.results?.length || 0} results`);
            } else {
              console.log(`❌ Tavily search failed: ${searchResults.error}`);
            }

            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolCall.id,
              content: JSON.stringify(searchResults)
            });
          } else {
            // Unknown tool - still must provide tool_result to avoid API error
            console.warn(`⚠️ Unknown tool requested: ${toolCall.name}`);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolCall.id,
              content: `Error: Unknown tool "${toolCall.name}". Only tavily_search is supported.`,
              is_error: true
            });
          }
        }

        // Add assistant message with tool_use blocks
        conversationHistory.push({
          role: 'assistant',
          content: assistantContent
        });

        // Add ALL tool results in one user message
        conversationHistory.push({
          role: 'user',
          content: toolResults
        });

        // Get continuation from Claude with ALL search results
        console.log('📝 Getting Claude continuation with search results...');
        const continuationResponse = await callAnthropicWithRetry({
          model: 'claude-opus-4-6',  // Sonnet 4.6 for best reasoning
          max_tokens: 16000,  // CRITICAL: Match main response limit
          system: systemPrompt,
          messages: conversationHistory
        });

        assistantContent = continuationResponse.content;
        console.log('✅ Claude processed search results');
      }

      // Extract text from content blocks for display
      const textBlocks = assistantContent
        .filter(block => block.type === 'text')
        .map(block => block.text);
      const assistantMessage = textBlocks.join('\n\n');

      if (usedWebSearch) {
        const searches = assistantContent.filter(block => block.type === 'server_tool_use' && block.name === 'web_search');
        console.log(`🔍 WEB SEARCH USED! ${searches.length} search(es) in iteration ${iteration}`);
        searches.forEach((search, idx) => {
          console.log(`   Search ${idx + 1}: "${search.query || 'N/A'}"`);
        });
      }

      // Add FULL content to conversation (including tool uses and results)
      // IMPORTANT: Always add assistant content, but ensure it's not empty
      // The Anthropic API rejects messages with empty content arrays
      if (assistantContent && assistantContent.length > 0) {
        conversationHistory.push({
          role: 'assistant',
          content: assistantContent,  // Store full content array, not just text
        });
      } else {
        // If somehow we got empty content, add a placeholder text to avoid API error
        console.warn(`⚠️ Assistant content was empty in iteration ${iteration}, adding placeholder`);
        conversationHistory.push({
          role: 'assistant',
          content: [{ type: 'text', text: 'Processing...' }],
        });
      }

      // Check if agent wants to complete (but still execute code first!)
      const wantsToComplete = assistantMessage.includes('ANALYSIS_COMPLETE');

      await sendStep('thinking', {
        iteration,
        title: `Agent Thinking - Iteration ${iteration}`,
        status: 'completed',
        message: wantsToComplete
          ? 'Agent has generated final code for execution...'
          : usedWebSearch
            ? 'Agent searched the web for information and has a plan...'
            : 'Agent has a plan. Generating R code...',
        reasoning: assistantMessage,
        webSearchUsed: usedWebSearch,
      });

      // Extract ALL R code blocks from response (not just the first one!)
      // Primary regex: properly closed code blocks
      const codeBlockRegex = /```[rR][ \t]*\n([\s\S]*?)\n```/g;
      const codeBlocks = [];
      let match;
      while ((match = codeBlockRegex.exec(assistantMessage)) !== null) {
        codeBlocks.push(match[1]);
      }

      // FALLBACK: If no properly closed blocks found, check for truncated blocks
      // This handles cases where max_tokens cut off the closing ```
      if (codeBlocks.length === 0 && assistantMessage.includes('```r')) {
        console.log(`⚠️ [CODE-EXTRACT] No properly closed R code blocks found, checking for truncated blocks...`);

        // Find all code block starts
        const truncatedRegex = /```[rR][ \t]*\n([\s\S]*?)(?=```|$)/g;
        let truncMatch;
        while ((truncMatch = truncatedRegex.exec(assistantMessage)) !== null) {
          const code = truncMatch[1].trim();
          if (code.length > 100) {  // Only if substantial code
            console.log(`🔧 [CODE-EXTRACT] Found truncated code block (${code.length} chars) - using it`);
            codeBlocks.push(code);
          }
        }

        if (codeBlocks.length > 0) {
          console.log(`⚠️ [CODE-EXTRACT] WARNING: Using ${codeBlocks.length} truncated code block(s) - may have syntax errors`);
        }
      }

      // Debug: log what we extracted
      if (codeBlocks.length > 0) {
        const totalChars = codeBlocks.reduce((sum, block) => sum + block.length, 0);
        console.log(`📝 Extracted ${codeBlocks.length} R code block(s) (${totalChars} total chars)`);
        if (codeBlocks.length > 1) {
          console.log(`   Block sizes: ${codeBlocks.map(b => b.length).join(', ')} chars`);
        }
      } else {
        // Log why no code was found
        const hasRMarker = assistantMessage.includes('```r') || assistantMessage.includes('```R');
        const hasClosingBackticks = assistantMessage.includes('```\n') || assistantMessage.endsWith('```');
        console.log(`⚠️ [CODE-EXTRACT] No R code blocks extracted:`);
        console.log(`   - Has \`\`\`r marker: ${hasRMarker}`);
        console.log(`   - Has closing \`\`\`: ${hasClosingBackticks}`);
        console.log(`   - Message length: ${assistantMessage.length} chars`);
        if (hasRMarker && !hasClosingBackticks) {
          console.log(`   - LIKELY CAUSE: Response truncated due to max_tokens limit!`);
        }
      }

      if (codeBlocks.length === 0) {
        // No code to execute
        if (wantsToComplete) {
          // 🚨 CRITICAL: Agent wants to complete but didn't execute any code!
          // This is likely hallucination - FORCE code execution
          if (allExecutedCode.length === 0) {
            console.log('⚠️  Agent trying to complete without executing ANY code - forcing code generation');
            await sendStep('thinking', {
              iteration,
              title: `Agent Thinking - Iteration ${iteration}`,
              status: 'error',
              message: '⚠️ Agent must execute R code before completing!',
            });
            conversationHistory.push({
              role: 'user',
              content: `You said ANALYSIS_COMPLETE but you haven't executed ANY R code yet!

This is a biostatistics query that REQUIRES actual calculation using R packages.

You MUST:
1. Write R code using the swdpwr package (or other appropriate package)
2. EXECUTE the code to get REAL results
3. Show the actual numerical output
4. THEN provide your interpretation

DO NOT guess or estimate the power - CALCULATE it with actual R code!`,
            });
            continue;
          } else {
            // Agent wants to complete - let it finish
            // Automatic report generation (2-phase system) will create markdown report
            console.log('✅ Agent completed successfully');
            isComplete = true;
            await sendStep('thinking', {
              iteration,
              title: `Agent Thinking - Iteration ${iteration}`,
              status: 'completed',
              message: 'Agent has completed the biostatistical analysis!',
              reasoning: assistantMessage,
            });
            break;
          }
        }

        // Agent is just thinking, ask for code
        await sendStep('reasoning', {
          iteration,
          title: 'Agent Reasoning',
          status: 'completed',
          message: assistantMessage,
        });

        // Add user message to continue
        conversationHistory.push({
          role: 'user',
          content: 'Please write the R code to proceed with the analysis.',
        });
        continue;
      }

      // Concatenate all code blocks with blank lines between them
      let rCode = codeBlocks.join('\n\n');

      // ============================================================
      // R SYNTAX POST-PROCESSOR: Fix common LLM code generation issues
      // ============================================================
      // Issue 1: LLMs often put newlines between } and else, which is invalid in R
      // R requires } else on the SAME line, otherwise R interprets } as end of statement
      // Fix: } followed by any whitespace/newlines then else → } else
      const originalLength = rCode.length;
      rCode = rCode.replace(/\}\s*\n\s*else\s*\{/g, '} else {');
      rCode = rCode.replace(/\}\s*\n\s*else\s+if/g, '} else if');

      // Issue 2: Missing closing parentheses in function calls (common with complex nested calls)
      // This is harder to fix automatically, but we can at least log a warning
      const openParens = (rCode.match(/\(/g) || []).length;
      const closeParens = (rCode.match(/\)/g) || []).length;
      if (openParens !== closeParens) {
        console.log(`⚠️ [R-SYNTAX] Parenthesis mismatch: ${openParens} open, ${closeParens} close`);
      }

      // Issue 3: Trailing commas before closing parenthesis (invalid in R)
      rCode = rCode.replace(/,\s*\)/g, ')');

      if (rCode.length !== originalLength) {
        console.log(`✅ [R-SYNTAX] Fixed R code syntax issues (${originalLength} → ${rCode.length} chars)`);
      }

      await sendStep('code', {
        iteration,
        title: `Code Generation - Iteration ${iteration}`,
        status: 'completed',
        code: rCode,
        message: codeBlocks.length > 1
          ? `Combined ${codeBlocks.length} R code blocks for execution`
          : 'R code ready for execution',
      });

      // Execute code with R Process Pool
      await sendStep('executing', {
        iteration,
        title: `Executing R Code - Iteration ${iteration}`,
        status: 'running',
        message: poolReady ? 'Running R code via process pool...' : 'Initializing R and executing...',
      });

      // Ensure pool is ready
      if (!poolReady) {
        console.log('[BIOSTAT] R Pool not ready, initializing on demand...');
        try {
          await rPool.initialize();
          poolReady = true;
        } catch (initError) {
          await sendStep('executing', {
            iteration,
            title: `Executing R Code - Iteration ${iteration}`,
            status: 'error',
            error: 'Failed to initialize R process pool',
            message: initError.message,
          });
          conversationHistory.push({
            role: 'user',
            content: `R initialization error: ${initError.message}\n\nPlease try again or suggest an alternative approach.`,
          });
          continue;
        }
      }

      let execution;

      // ===========================
      // AUTO-INJECT SIMR LIBRARY & FIX PROGRESS
      // ===========================
      // If user asks for simr but LLM forgot library(simr), inject it automatically
      // Also ensure progress=FALSE to prevent output flooding in non-interactive mode
      let finalRCode = rCode;
      const queryLower = query.toLowerCase();
      const asksForSimr = queryLower.includes('simr') ||
                          queryLower.includes('powersim') ||
                          queryLower.includes('powercurve') ||
                          (queryLower.includes('simulation') && queryLower.includes('power') && queryLower.includes('monte carlo'));

      const codeHasSimr = rCode.includes('library(simr)') ||
                          rCode.includes('require(simr)') ||
                          rCode.includes('simr::');

      if (asksForSimr && !codeHasSimr) {
        console.log('[SIMR-INJECT] ⚠️ Query asks for simr but code missing library(simr) - auto-injecting');
        finalRCode = `# AUTO-INJECTED: simr library required for simulation-based power analysis
library(simr)
library(lme4)

${rCode}`;
      }

      // NOTE: progress=FALSE injection was removed because the regex couldn't handle
      // nested parentheses in R code like powerSim(model, test=fixed("treatment"), nsim=100)
      // The LLM is now instructed via system prompt to always include progress=FALSE
      if (asksForSimr && !finalRCode.includes('progress=FALSE') && !finalRCode.includes('progress = FALSE')) {
        console.log('[SIMR-INJECT] ⚠️ Note: Code may be missing progress=FALSE - LLM should add this via prompt instructions');
      }

      try {
        // Execute via R process pool with timeout
        // CRITICAL: Add execution-level timeout wrapper to catch hanging executions
        const executionPromise = rPool.execute(finalRCode, {
          timeout: 1200000, // 1200 second (20 min) timeout - allows source compilation of complex packages like swCRTdesign, metafor, glmmTMB
          sessionId: sessionId  // Pass session ID for file organization
        });

        // Add a shorter timeout wrapper (5 minutes per iteration) to prevent infinite hangs
        const iterationTimeout = 300000; // 5 minutes max per iteration
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Iteration timeout: R execution took too long (5 minutes). Will retry with simpler approach.')), iterationTimeout);
        });

        const result = await Promise.race([executionPromise, timeoutPromise]);

        // Format result to match expected structure
        execution = {
          success: result.success,
          output: result.output,
          errors: result.success ? [] : [{ message: result.output }],
          iterations: 1,
          has_output: result.output && result.output.trim().length > 0,
          executionTime: result.executionTime,
          processId: result.processId,
          output_files: result.outputFiles || []  // CRITICAL: Include output files from R execution
        };

        console.log(`   ✅ R execution completed in ${result.executionTime}ms (process ${result.processId})`);
      } catch (execError) {
        // ENHANCED ERROR LOGGING - Always log execution failures to console
        console.error(`❌ R EXECUTION EXCEPTION - Iteration ${iteration}`);
        console.error(`   - Error message: ${execError.message}`);
        console.error(`   - Error type: ${execError.name}`);
        console.error(`   - Stack trace:`, execError.stack);
        console.error(`   - Session: ${sessionId}`);
        console.error(`   - R code attempted:`, rCode.substring(0, 200) + '...');

        await sendStep('executing', {
          iteration,
          title: `Executing R Code - Iteration ${iteration}`,
          status: 'error',
          error: execError.message,
          message: 'Execution error - agent will try to fix...',
        });

        // Tell agent about the error
        conversationHistory.push({
          role: 'user',
          content: `Execution error: ${execError.message}\n\nPlease fix the R code and try again.`,
        });
        continue;
      }

      // Check execution result
      if (!execution.success) {
        const errorMsg = execution.errors && execution.errors.length > 0
          ? execution.errors.map(e => e.message || JSON.stringify(e)).join('\n')
          : execution.has_output === false
            ? 'Code executed but produced no output. The code may have syntax errors or missing packages.'
            : 'Unknown error';

        // ENHANCED ERROR LOGGING - Always log execution failures even when retrying
        console.error(`❌ R EXECUTION FAILED - Iteration ${iteration}`);
        console.error(`   - Error message: ${errorMsg}`);
        console.error(`   - Has output: ${execution.has_output}`);
        console.error(`   - Output length: ${execution.output ? execution.output.length : 0} chars`);
        console.error(`   - Number of errors: ${execution.errors ? execution.errors.length : 0}`);
        console.error(`   - Will retry with agent fix...`);

        await sendStep('executing', {
          iteration,
          title: `Executing R Code - Iteration ${iteration}`,
          status: 'error',
          error: errorMsg,
          message: `Execution failed after ${execution.iterations || 1} attempts. Agent will try to fix...`,
        });

        // Tell agent about the error
        const isPackageError = errorMsg.includes('package') || errorMsg.includes('install') || errorMsg.includes('dependency');
        const isNonNumericError = errorMsg.includes('non-numeric argument') || errorMsg.includes('non-numeric value');

        const errorFeedback = isNonNumericError ? `Execution failed with "non-numeric argument" error:
${errorMsg}

This error means you tried to use mathematical functions (round(), mean(), etc.) on a COMPLEX OBJECT instead of a simple number!

The package function returned a complex object (list, data frame, S3/S4 object), not a simple value.

FIX THIS by using the INSPECT-FIRST pattern:

\`\`\`r
# Step 1: Store the result in a variable (don't try to use it directly)
result <- packagename::function_name(...)

# Step 2: INSPECT the structure to see what it contains
cat("\n=== INSPECTING PACKAGE OUTPUT ===\n")
str(result)
cat("Names:", names(result), "\n")
cat("Class:", class(result), "\n")
print(result)  # Show the full object
cat("\n")

# Step 3: Based on the structure, extract the specific value you need
# Examples:
#   If it's a list with named elements: value <- result$power
#   If it's a data frame: value <- result$power[1]
#   If it's a vector: value <- result[1]
#   If it has an accessor: value <- getPower(result)

# Step 4: Now you can use mathematical functions
cat("Extracted value:", round(value, 4), "\n")
\`\`\`

IMPORTANT: You MUST inspect the object structure with str() BEFORE trying to extract values!

Please rewrite your R code using this pattern.`
        : isPackageError ? `Execution failed due to package installation error:
${errorMsg}

The package installation failed. This often happens when SYSTEM DEPENDENCIES are missing or DEPENDENCY PACKAGES are not loaded.

CRITICAL - Many packages are PRE-INSTALLED in this environment!
Before reinstalling packages, CHECK if they're already installed:
- Matrix, survival, lme4, ggplot2, dplyr, and 150+ other packages are PRE-INSTALLED
- Use: if (require(packagename, quietly = TRUE)) to check
- DON'T blindly reinstall pre-installed packages - just load them!

IMPORTANT: You can install system dependencies from within R using system()!

Your approach should be (IN THIS ORDER):
1. CHECK if base dependency packages are already installed (Matrix, survival, etc.)
   - If already installed, just load with library()
   - DON'T reinstall pre-installed packages!

2. SEARCH THE WEB for: "R [package name] installation linux dependencies" or "[package name] configuration failed dependencies"

3. If system dependencies are needed (cmake, libnlopt-dev, libxml2-dev, etc.):
   - Install them using: system("apt-get update && apt-get install -y cmake libnlopt-dev")
   - Then install the R package: install.packages("[package name]")

4. If the package has complex dependencies that can't be fixed, THEN try alternatives

Example 1 - If MatrixModels fails due to missing Matrix:
\`\`\`r
# Check if Matrix is already installed (it usually is!)
if (!require(Matrix, quietly = TRUE)) {
  cat("Installing Matrix package...\\n")
  install.packages("Matrix")
}
library(Matrix)  # Load it explicitly

# Now install MatrixModels
install.packages("MatrixModels")
library(MatrixModels)
\`\`\`

Example 2 - If nloptr fails (system dependency issue):
\`\`\`r
# Step 1: Search web found that nloptr needs cmake and libnlopt-dev
cat("Installing system dependencies for nloptr...\\n")
system("apt-get update && apt-get install -y cmake libnlopt-dev")

# Step 2: Install nloptr
install.packages("nloptr")
library(nloptr)

# Step 3: Install packages that depend on nloptr
install.packages("lme4")
install.packages("swCRTdesign")
library(swCRTdesign)
\`\`\`

Example 3 - If survminer fails:
\`\`\`r
# survival is PRE-INSTALLED - just load it!
library(survival)

# survminer needs installation - check dependencies first
if (!require(Matrix, quietly = TRUE)) {
  library(Matrix)  # Matrix is pre-installed, just load it
}

# Now install survminer and its dependencies
install.packages("survminer")
library(survminer)
\`\`\`

PRIORITY: Always try to make the USER'S REQUESTED PACKAGE work first before switching to alternatives!

Only use alternatives as a LAST RESORT if:
- System dependencies can't be installed
- Package is fundamentally broken
- After 2+ attempts to fix dependencies

Please write new R code that either:
1. Checks for pre-installed packages and loads them (BEST)
2. Installs missing system dependencies and retries the package (PREFERRED)
3. Uses an alternative package (only if dependencies can't be fixed)`
        // Detect specific R syntax errors for targeted feedback
        : errorMsg.includes("unexpected 'else'") ? `Execution failed with R SYNTAX ERROR:
${errorMsg}

⚠️ CRITICAL R SYNTAX ISSUE: The "unexpected 'else'" error occurs because R requires } else on the SAME LINE!

WRONG (what you wrote):
\`\`\`r
if (condition) {
  ...
}
else {   # ❌ ERROR: newline before else
  ...
}
\`\`\`

CORRECT (what R requires):
\`\`\`r
if (condition) {
  ...
} else {   # ✅ CORRECT: } else on same line
  ...
}
\`\`\`

Please rewrite your R code with ALL if-else statements using } else on the SAME LINE.
For one-liners: if (x) { do_a() } else { do_b() }
For multi-line: Keep } else { together, then newline for body`
        : errorMsg.includes("unexpected") ? `Execution failed with R SYNTAX ERROR:
${errorMsg}

This is a syntax error in your R code. Common causes:
- Missing closing parenthesis ) or brace }
- Unbalanced quotes
- Trailing comma before closing parenthesis
- Newline between } and else (R requires } else on SAME LINE)

Please check your R code for syntax issues and fix them.`
        : `Execution failed:
${errorMsg}

Please fix the R code and try again. Make sure:
1. All lines are properly separated
2. Required packages are loaded with library()
3. Code uses cat() or print() to show results`;

        conversationHistory.push({
          role: 'user',
          content: errorFeedback,
        });
        continue;
      }

      // Success! Show results
      const stdout = execution.output || '';

      // Check if output is meaningful
      const hasOutput = stdout && stdout.trim().length > 0;
      const outputLines = stdout.split('\n').filter(l => l.trim().length > 0).length;

      console.log(`   Output validation: ${hasOutput ? 'YES' : 'NO'} (${stdout.length} chars, ${outputLines} lines)`);

      // CRITICAL FIX: Truncate large outputs for SSE streaming to prevent Cloud Run response truncation
      // Cloud Run has limits on SSE response body size; 115KB+ causes "Truncated response body" errors
      // Keep full output for LLM validation, but send truncated version to frontend
      const MAX_SSE_OUTPUT = 50000; // 50KB max for SSE display
      let truncatedOutput = stdout;
      let outputTruncated = false;
      if (stdout.length > MAX_SSE_OUTPUT) {
        outputTruncated = true;
        truncatedOutput = stdout.substring(0, MAX_SSE_OUTPUT) +
          `\n\n... [Output truncated for display: ${stdout.length} chars total, showing first ${MAX_SSE_OUTPUT}] ...`;
        console.log(`[R-OUTPUT] ⚠️ Truncating large output for SSE: ${stdout.length} -> ${MAX_SSE_OUTPUT} chars`);
      }

      await sendStep('executing', {
        iteration,
        title: `Executing R Code - Iteration ${iteration}`,
        status: 'completed',
        output: truncatedOutput,
        outputTruncated,
        fullOutputLength: stdout.length,
        message: `Code executed successfully in ${execution.iterations || 1} iteration(s)` +
                 (!hasOutput ? ' - but produced no output!' : '') +
                 (outputTruncated ? ` (output truncated from ${stdout.length} chars)` : ''),
      });

      // Store successful execution for output files
      // CRITICAL: R pool returns outputFiles (camelCase), convert to output_files (snake_case)
      lastExecution = execution;
      if (execution.outputFiles) {
        lastExecution.output_files = execution.outputFiles;
      }

      // Track successfully executed code and outputs for final summary
      if (hasOutput) {
        allExecutedCode.push(`# Iteration ${iteration}\n${rCode}`);
        allExecutionOutputs.push(`# Iteration ${iteration} Output\n${stdout}`);
      }

      // ===========================
      // SIMR FABRICATION DETECTION
      // ===========================
      // Validate that if user asked for simr, the output contains actual simr results
      // Use finalRCode (which may have auto-injected library(simr))
      const simrValidation = validateSimrResults(query, stdout, finalRCode, execution.executionTime || 0);
      if (!simrValidation.isValid) {
        console.error(`[SIMR-VALIDATION] ❌ REJECTING RESULTS: ${simrValidation.reason}`);
        await sendStep('executing', {
          iteration,
          title: `simr Validation Failed - Iteration ${iteration}`,
          status: 'error',
          error: 'simr results validation failed',
          message: simrValidation.reason,
        });

        // Force agent to fix the code - don't let it fabricate
        // CRITICAL: Include actual R output so agent can see the specific error
        conversationHistory.push({
          role: 'user',
          content: `🚨 SIMR VALIDATION FAILED 🚨

${simrValidation.reason}

========================================
ACTUAL R OUTPUT (contains error details):
========================================
${stdout || '(no output - code errored before producing output)'}
========================================

⚠️ ANALYZE THE ERROR ABOVE CAREFULLY - it tells you exactly what went wrong!

CRITICAL REQUIREMENTS FOR SIMR POWER ANALYSIS:
1. You MUST include library(simr) at the start of your code
2. You MUST use simr::powerSim() or simr::powerCurve() functions
3. You MUST run actual Monte Carlo simulations (this takes time - at least 30 seconds)
4. The output MUST contain simr's power estimation format
5. You MUST include progress=FALSE in powerSim/powerCurve calls (e.g., powerSim(model, nsim=500, progress=FALSE))

DO NOT fabricate power percentages. The simr package MUST be loaded and the functions MUST be called to get real results.

If simr is not installed, include:
install.packages("simr", repos = "https://packagemanager.posit.co/cran/__linux__/jammy/latest")

FIX the specific error shown in the R output above, then rewrite your R code.`,
        });
        continue; // Force another iteration to fix the code
      }

      // If code produced no output, treat as error and iterate
      if (!hasOutput && !wantsToComplete) {
        conversationHistory.push({
          role: 'user',
          content: `The code executed without errors but produced NO OUTPUT. This means the code didn't work correctly.\n\nPlease:\n1. Check that all code lines are properly separated with newlines\n2. Add cat() or print() statements to show results\n3. Verify the R package functions are being called correctly\n\nRewrite the code with proper formatting and output statements.`,
        });
        continue;
      }

      // CRITICAL: ALWAYS give execution results back to Claude (even if wantsToComplete)
      // The agent needs to see ACTUAL output before providing final summary!
      // Truncate R output to prevent token overflow (max ~30K chars ≈ 7.5K tokens)
      const MAX_R_OUTPUT_FOR_CLAUDE = 30000;
      let claudeStdout = stdout;
      if (stdout.length > MAX_R_OUTPUT_FOR_CLAUDE) {
        const headSize = Math.floor(MAX_R_OUTPUT_FOR_CLAUDE * 0.7);
        const tailSize = Math.floor(MAX_R_OUTPUT_FOR_CLAUDE * 0.3);
        claudeStdout = stdout.substring(0, headSize)
          + `\n\n... [OUTPUT TRUNCATED: ${stdout.length} total chars, showing first ${headSize} and last ${tailSize}] ...\n\n`
          + stdout.substring(stdout.length - tailSize);
        console.log(`⚠️  R output truncated for Claude: ${stdout.length} → ${claudeStdout.length} chars`);
      }

      const executionFeedback = wantsToComplete ? `
EXECUTION COMPLETE! Here are the ACTUAL results from your R code:

========================================
ACTUAL R OUTPUT:
========================================
${claudeStdout}
========================================

Now provide your final biostatistical insights based on these ACTUAL results.
IMPORTANT: Extract the EXACT numbers from the output above.
DO NOT estimate or approximate - use the precise values you see.

Include "ANALYSIS_COMPLETE" in your response to finish.`
      : `
Execution results from iteration ${iteration}:

OUTPUT:
${claudeStdout}

${execution.html_path ? `HTML report generated at: ${execution.html_path}` : ''}

CRITICAL DECISION POINT - READ CAREFULLY:

The R code executed SUCCESSFULLY and produced the output above.

✅ If the analysis is COMPLETE (calculations done, visualizations created, results interpretable):
   → Include "ANALYSIS_COMPLETE" in your response NOW
   → Do NOT iterate again with the same or similar code
   → Provide your final biostatistical insights

❌ ONLY continue iterating if:
   → Code had actual execution ERRORS (not just warnings)
   → Results are genuinely INCOMPLETE or missing critical information
   → User explicitly requested additional analyses you haven't done yet
   → You discovered a REAL mistake in the statistical approach

DO NOT iterate just to "refine" or "improve" code that already works perfectly.
DO NOT regenerate the same analysis with minor tweaks.

If this analysis successfully answered the user's question, say "ANALYSIS_COMPLETE" now.`;

      conversationHistory.push({
        role: 'user',
        content: executionFeedback,
      });

      await sendStep('reviewing', {
        iteration,
        title: `Agent Reviewing Results - Iteration ${iteration}`,
        status: 'running',
        message: wantsToComplete
          ? 'Agent is reading actual execution results to provide final summary...'
          : 'Agent is inspecting R execution outputs...',
      });

      // Small delay to show the step
      await sleep(300);

      // If agent wanted to complete and code executed successfully, we're DONE!
      // The agent already indicated completion and we have results - no need for another iteration
      if (wantsToComplete) {
        // Code executed successfully and agent signaled completion - we're done!
        console.log('✅ Agent signaled completion after successful execution - finishing analysis');
        isComplete = true;
        break;  // Exit the iteration loop immediately
      }
    }

    // Check if analysis completed successfully or hit max iterations
    const hitMaxIterations = !isComplete && iteration >= maxIterations;

    // CRITICAL: Log iteration loop exit for debugging empty output issues
    console.log(`📊 Iteration loop exited: isComplete=${isComplete}, iteration=${iteration}, maxIterations=${maxIterations}`);
    console.log(`   - Executed code blocks: ${allExecutedCode.length}`);
    console.log(`   - Execution outputs: ${allExecutionOutputs.length}`);
    console.log(`   - Conversation history length: ${conversationHistory.length}`);

    // Mark 'reviewing' step as completed before showing summary
    await sendStep('reviewing', {
      iteration,
      title: `Agent Reviewing Results - Iteration ${iteration}`,
      status: 'completed',
      message: 'Results reviewed successfully',
    });

    // Send initial summary step showing we're processing outputs (not complete yet)
    // This will be updated to 'completed' after files are processed and sent
    await sendStep('summary', {
      title: 'Processing Results',
      status: 'running',
      message: 'Preparing output files for download...',
      totalIterations: iteration,
    });

    // Extract final answer from last assistant message
    const finalResponse = conversationHistory[conversationHistory.length - 1];
    let finalContent = '';  // Declare at function scope to make accessible throughout
    if (finalResponse.role === 'assistant') {
      // Extract text from content blocks
      finalContent = Array.isArray(finalResponse.content)
        ? finalResponse.content.filter(block => block.type === 'text').map(block => block.text).join('\n\n')
        : finalResponse.content;

      // Clean up the final content - remove ANALYSIS_COMPLETE marker
      // The agent may say ANALYSIS_COMPLETE either before or after results
      if (finalContent.includes('ANALYSIS_COMPLETE')) {
        const parts = finalContent.split('ANALYSIS_COMPLETE');
        // Use the part with more substantive content (before OR after marker)
        const before = parts[0].trim();
        const after = parts.slice(1).join('').trim();

        // Choose the part with more content (excluding code blocks and reasoning)
        const beforeLength = before.replace(/```[\s\S]*?```/g, '').replace(/^(I'|Let me|Now)/gim, '').trim().length;
        const afterLength = after.replace(/```[\s\S]*?```/g, '').replace(/^(I'|Let me|Now)/gim, '').trim().length;

        finalContent = afterLength > beforeLength ? after : before;
      }

      // Remove code blocks (```...```)
      finalContent = finalContent.replace(/```[\s\S]*?```/g, '').trim();

      // Remove web search reasoning patterns
      finalContent = finalContent.replace(/I'll (perform|search|look|check|find).*?\n/gi, '');
      finalContent = finalContent.replace(/Let me (search|look|check|find|start).*?\n/gi, '');
      finalContent = finalContent.replace(/Now (let me|I'll|I will).*?\n/gi, '');
      finalContent = finalContent.replace(/I (found|searched|looked|checked).*?\n/gi, '');
      finalContent = finalContent.replace(/Based on (my )?research.*?\n/gi, '');

      // Remove lines that start with "I" or "Let" (reasoning indicators)
      finalContent = finalContent.split('\n')
        .filter(line => {
          const trimmed = line.trim();
          // Keep lines that are substantive content, not reasoning
          return !trimmed.match(/^(I'|Let me|Now let|Now I|Perfect!|Great!|Based on my)/i) ||
                 trimmed.match(/^(In |With |The |This |These |For |Using |According)/i);
        })
        .join('\n').trim();

      // Remove multiple blank lines
      finalContent = finalContent.replace(/\n{3,}/g, '\n\n');

      // Combine all executed code with separators
      const fullCode = allExecutedCode.length > 0
        ? allExecutedCode.join('\n\n' + '='.repeat(60) + '\n\n')
        : null;

      // Determine if this is a complete success or needs more info
      const needsMoreInfo = finalContent.toLowerCase().includes('need') &&
                           (finalContent.toLowerCase().includes('more information') ||
                            finalContent.toLowerCase().includes('clarif') ||
                            finalContent.toLowerCase().includes('assumption'));

      // Include the ACTUAL execution outputs for verification
      const fullOutput = allExecutionOutputs.length > 0
        ? allExecutionOutputs.join('\n\n' + '='.repeat(60) + '\n\n')
        : null;

      // Provide fallback message if final content is empty or too short
      if (!finalContent || finalContent.trim().length < 50) {
        if (hitMaxIterations) {
          finalContent = `Analysis reached the maximum iteration limit (${maxIterations} iterations) without completing.\n\nThe agent executed ${allExecutedCode.length} code block(s) and generated ${allExecutionOutputs.length} output(s), but did not finalize the results.\n\nPlease review the execution outputs below or try simplifying the query.`;
        } else if (allExecutionOutputs.length > 0) {
          finalContent = `Analysis completed with ${allExecutedCode.length} code execution(s).\n\nPlease review the execution outputs below for results. The agent may have provided results in the R output rather than a summary.`;
        } else {
          finalContent = 'Analysis completed but no final insights were generated. Please check the execution outputs.';
        }
      }

      await sendStep('insights', {
        title: 'Final Biostatistical Insights',
        status: hitMaxIterations ? 'warning' : (needsMoreInfo ? 'needs_info' : 'completed'),
        content: finalContent,
        fullCode: fullCode,  // Include all successfully executed R code
        executionOutput: fullOutput,  // Include actual R output for verification
      });

      // Save final results to database if dbSessionId available
      if (dbSessionId) {
        try {
          // Save the final formatted content as a message
          await saveMessage(dbSessionId, 'assistant', finalContent, {
            agent_type: 'pi',
            references_coding: true
          });

          // NOTE: Session status will be updated to 'completed' AFTER all workflow steps are saved
          // (moved to after sendStep('complete') to ensure all steps are in DB before status change)
          console.log(`📝 Final content saved for session ${dbSessionId}, status update deferred`);
        } catch (dbError) {
          console.warn('Could not save final results to database:', dbError.message);
        }
      }
    }

    // ===========================
    // START REPORT GENERATION (non-blocking, runs in parallel with conclusion)
    // ===========================
    console.log('📝 Starting report generation (parallel with conclusion)...');
    const reportOpts = {
      query,
      rCode: allExecutedCode.join('\n\n---\n\n'),
      rOutput: allExecutionOutputs.join('\n\n---\n\n'),
      previousExecutions: allExecutedCode.map((code, idx) => ({
        code,
        output: allExecutionOutputs[idx] || ''
      })),
      sessionId: sessionId || dbSessionId || 'session',
      rPool
    };

    // Fire off report generation — will be awaited after conclusion streams
    const reportPromise = (async () => {
      try {
        try {
          return await generatePdfReport(reportOpts);
        } catch (pdfError) {
          console.warn('⚠️  PDF report failed, falling back to markdown:', pdfError.message);
          const mdResult = await generateReport(reportOpts);
          return mdResult.success ? {
            success: true,
            markdown: { filename: mdResult.filename, filepath: mdResult.filepath, content: mdResult.content, size: mdResult.size }
          } : { success: false, error: mdResult.error };
        }
      } catch (err) {
        console.warn('⚠️  Report generation error:', err.message);
        return { success: false, error: err.message };
      }
    })();

    // ===========================
    // DOCUMENT CORRECTION (SAP/Protocol)
    // ===========================
    // If user uploaded a SAP/protocol document, generate a corrected version
    try {
      const correctionExt = (dataset?.name || '').split('.').pop().toLowerCase();
      const isCorrectable = ['pdf', 'docx', 'doc'].includes(correctionExt);

      if (isCorrectable && dataset?.content && extractedDocText) {
        console.log('📝 Generating corrected document...');
        await sendStep('document_correction', {
          title: 'Generating Corrected Document',
          status: 'running',
          message: 'Reviewing document for statistical corrections...'
        });

        const { generateCorrectedDocument } = await import('./document-corrector.js');
        const originalBuffer = Buffer.from(dataset.content, 'base64');
        const analysisReport = lastExecution?.output_files?.find(f => f.type === 'md')?.content || '';

        const correctionResult = await generateCorrectedDocument({
          originalBuffer,
          fileName: dataset.name,
          fileExt: correctionExt,
          extractedText: extractedDocText,
          analysisReport,
          query
        });

        if (correctionResult.success && correctionResult.corrections.length > 0) {
          // Initialize lastExecution if needed
          if (!lastExecution) lastExecution = { output_files: [] };
          if (!lastExecution.output_files) lastExecution.output_files = [];

          const mimeType = correctionResult.format === 'docx'
            ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            : 'application/pdf';

          const correctedFile = {
            name: correctionResult.correctedFileName,
            type: correctionResult.format,
            size: correctionResult.correctedBuffer.length,
            download_url: `data:${mimeType};base64,${correctionResult.correctedBuffer.toString('base64')}`
          };
          lastExecution.output_files.push(correctedFile);

          // Upload to GCS if session available
          if (dbSessionId) {
            try {
              const outputDir = path.join(process.cwd(), 'output');
              const correctedPath = path.join(outputDir, correctionResult.correctedFileName);
              fs.writeFileSync(correctedPath, correctionResult.correctedBuffer);

              const { uploadOutputFilesToGCS } = await import('./r-process-pool.js');
              const uploadedFiles = await uploadOutputFilesToGCS(dbSessionId, process.cwd());
              const uploadedCorrected = uploadedFiles.find(f => f.name === correctionResult.correctedFileName);
              if (uploadedCorrected && uploadedCorrected.download_url) {
                correctedFile.download_url = uploadedCorrected.download_url;
                correctedFile.storage_url = uploadedCorrected.storage_url;
              }
            } catch (uploadErr) {
              console.warn('⚠️  Corrected document GCS upload failed (using data URL):', uploadErr.message);
            }
          }

          const correctionSummary = correctionResult.corrections
            .map(c => `- [${c.severity}] ${c.reason}`)
            .join('\n');

          await sendStep('document_correction', {
            title: 'Document Corrected',
            status: 'complete',
            message: `Applied ${correctionResult.corrections.length} correction(s) to ${dataset.name}`,
            details: correctionSummary,
            corrections: correctionResult.corrections
          });

          console.log(`✅ Corrected document generated: ${correctionResult.correctedFileName} (${correctionResult.corrections.length} corrections)`);
        } else {
          console.log('ℹ️  No corrections needed for the uploaded document');
          await sendStep('document_correction', {
            title: 'Document Review Complete',
            status: 'complete',
            message: 'No statistical corrections needed - the document appears correct.'
          });
        }
      }
    } catch (correctionError) {
      console.warn('⚠️  Document correction error:', correctionError.message);
      // Continue without correction - don't block the analysis
    }

    // ===========================
    // SEND OUTPUT FILES TO FRONTEND (including the report)
    // ===========================
    // This ensures files are shown in a dedicated block below the analysis
    // CRITICAL FIX: Ensure files have download URLs even if GCS fails
    if (lastExecution && lastExecution.output_files) {
      lastExecution.output_files = lastExecution.output_files.map(file => {
        if (!file.download_url || file.download_url === '#') {
          const filePath = file.path || path.join(WORKSPACE_OUTPUT, file.name);
          if (fs.existsSync(filePath)) {
            try {
              const mimeTypes = {
                png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
                svg: 'image/svg+xml', gif: 'image/gif',
                pdf: 'application/pdf',
                csv: 'text/csv', txt: 'text/plain', md: 'text/markdown', html: 'text/html',
                xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                rds: 'application/octet-stream', rda: 'application/octet-stream'
              };
              const ext = file.type || file.name.split('.').pop().toLowerCase();
              const mime = mimeTypes[ext] || 'application/octet-stream';
              const buffer = fs.readFileSync(filePath);
              file.download_url = `data:${mime};base64,${buffer.toString('base64')}`;
              // Also include raw content for text files (used by viewReport)
              if (['csv', 'txt', 'md', 'html'].includes(ext)) {
                file.content = buffer.toString('utf8');
              }
            } catch (e) {
              console.warn('Could not read file for data URL:', e.message);
            }
          }
          // Last resort: remove file from list rather than serving broken '#' URL
          if (!file.download_url || file.download_url === '#') {
            console.warn(`⚠️ No download URL for ${file.name}, file will be excluded`);
            file._exclude = true;
          }
        }
        return file;
      });
      // Remove files that couldn't get a download URL
      lastExecution.output_files = lastExecution.output_files.filter(f => !f._exclude);
    }

    // CRITICAL FIX: Moved outputs step to AFTER chatbot_conclusion
    // Correct order: summary -> chatbot_conclusion (Professional Summary) -> outputs (Downloadable Outputs)
    // The outputs (download section) should appear AFTER the professional summary text

    // Send the final completion summary FIRST
    const finalFileCount = lastExecution?.output_files?.length || 0;
    await sendStep('summary', {
      title: hitMaxIterations ? 'Analysis Reached Iteration Limit' : 'Biostatistical Analysis Complete',
      status: hitMaxIterations ? 'warning' : 'completed',
      message: hitMaxIterations
        ? `Reached maximum ${iteration} iterations without completion. Results may be incomplete.`
        : `Completed in ${iteration} iteration(s)${finalFileCount > 0 ? ` • ${finalFileCount} file(s) ready for download` : ''}`,
      totalIterations: iteration,
      files: lastExecution?.output_files || [],
      fileCount: finalFileCount,
    });

    // ===========================
    // PHASE 3: CHATBOT CONCLUSION (Stream friendly summary with results and file links)
    // ===========================
    console.log('💬 Chatbot: Streaming conclusion...');
    await sendStep('chatbot_conclusion_start', {
      title: 'Summarizing Results',
      status: 'running',
      message: 'Preparing final summary...'
    });

    let conclusionText = '';
    try {
      // Extract final insights and key results
      const finalInsights = finalContent || 'Analysis completed successfully.';

      // Check if agent needs more information from user
      const agentNeedsMoreInfo = finalContent.toLowerCase().includes('need') &&
                                 (finalContent.toLowerCase().includes('more information') ||
                                  finalContent.toLowerCase().includes('clarif') ||
                                  finalContent.toLowerCase().includes('assumption'));

      const filesGenerated = (lastExecution && lastExecution.output_files) ? lastExecution.output_files.length : 0;
      const filesList = (lastExecution && lastExecution.output_files)
        ? lastExecution.output_files.map(f => `- ${f.name} (${f.type})`).join('\n')
        : '';

      // CRITICAL FIX: Read actual file contents for the chatbot
      let fileContents = '';
      if (lastExecution && lastExecution.output_files) {
        for (const file of lastExecution.output_files) {
          try {
            // PRODUCTION FIX: Use file content if available, otherwise try to read
            if (file.content) {
              // Use pre-loaded content (from data URL generation)
              fileContents += `\n\n**File: ${file.name}**\n${file.content.substring(0, 2000)}`;
              console.log(`✅ Used pre-loaded content: ${file.name} (${file.content.length} chars)`);
            } else {
              // Try to read file (works locally)
              const filePath = file.path || path.join(WORKSPACE_OUTPUT, file.name);
              if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath, 'utf8');
                fileContents += `\n\n**File: ${file.name}**\n${content.substring(0, 2000)}`;
                console.log(`✅ Read file content: ${file.name} (${content.length} chars)`);
              } else {
                console.warn(`⚠️ File not accessible: ${file.name}`);
              }
            }
          } catch (e) {
            console.warn(`⚠️ Could not read file ${file.name}:`, e.message);
          }
        }
      }

      // Also include the actual R execution output for numerical results
      const executionOutput = (lastExecution && lastExecution.output) ? lastExecution.output : '';

      // Use Claude Sonnet 4.6 for conclusion streaming
      const conclusionStream = await anthropic.messages.stream({
        model: 'claude-opus-4-6',  // Sonnet 4.6 for simple text
        max_tokens: 800,
        messages: [{
          role: 'user',
          content: agentNeedsMoreInfo
            ? // CASE 1: Agent needs more information from user
              `You are a professional biostatistics consultant providing expert guidance. An automated analysis requires additional information from the client. Present this request in a clear, professional, and service-oriented manner.

**USER'S ORIGINAL QUESTION:**
"${query}"

**WHAT THE AGENT SAYS:**
${finalInsights}

YOUR TASK: Rephrase the agent's request in 2-3 professional sentences. Clearly explain what information is needed and why it's important for the analysis.

Example: "To provide accurate power calculations for your study, I need to confirm the expected effect size. This parameter is essential for determining appropriate sample sizes. Common effect size benchmarks include Cohen's d of 0.2 (small), 0.5 (medium), or 0.8 (large effect)."`
            : // CASE 2: Analysis is complete - summarize results
              `You are a professional biostatistics consultant providing expert analysis. The statistical analysis has been completed. Summarize the results in a professional, clear, and service-oriented manner.

**USER'S ORIGINAL QUESTION:**
"${query}"

**AGENT'S ANALYSIS RESULTS:**
${finalInsights}

**R OUTPUT (Actual Numbers):**
${executionOutput}

**FILES GENERATED (${filesGenerated} files):**
${filesList}

**FILE CONTENTS (First 2000 chars):**
${fileContents || 'Not available for preview'}

YOUR TASK: Write 3-5 professional sentences that:
1. Acknowledge the user's original question
2. Present KEY NUMBERS from R output (sample sizes, p-values, effect sizes, power, etc.)
3. Explain the implications for their research
4. Briefly mention that deliverables were generated (WITHOUT listing individual file names)

Use a professional biostatistician consulting tone - clear, authoritative, and service-oriented.

RULES:
- DO present specific numerical results from R output
- DO mention that ${filesGenerated} deliverables were generated
- DO relate findings back to the research question
- DO NOT list individual file names (they appear in a separate downloads section)
- DO NOT ask for more information - the analysis is complete
- DO NOT use informal phrases like "Great!" or "I see you..."

Example: "The power analysis indicates that 64 participants per group (n=63.77, rounded up) are required to detect Cohen's d=0.5 with 80% power at α=0.05. With 128 total participants, your study will have an 80% probability of detecting a true medium effect if one exists. I have generated comprehensive deliverables including visualizations and detailed calculations for your review."`
        }]
      });

      // Stream conclusion text to client
      conclusionText = '';
      conclusionStream.on('text', async (text) => {
        conclusionText += text;
        await sendStep('chatbot_conclusion_stream', {
          text: text,
          fullText: conclusionText,
          files: lastExecution?.output_files || []
        });
      });

      // Wait for conclusion to complete
      await conclusionStream.finalMessage();
      console.log(`   ✅ Chatbot conclusion streamed (${conclusionText.length} chars)`);
    } catch (conclusionError) {
      console.warn('⚠️  Chatbot conclusion failed:', conclusionError.message);
      conclusionText = 'Analysis completed successfully. Results are available above.';
    }

    // Send conclusion_complete IMMEDIATELY with R output files (don't wait for report)
    await sendStep('chatbot_conclusion_complete', {
      title: 'Analysis Complete',
      status: 'completed',
      message: conclusionText,
      files: lastExecution?.output_files || []
    });

    // Send completion marker IMMEDIATELY so frontend shows "Ready" status
    // Report generation continues as bonus content after this
    let creditsRemaining = null;
    if (req.user) {
      const creditInfo = await getUserCredits(req.user.id);
      creditsRemaining = creditInfo?.credits_remaining;
    }

    await sendStep('complete', {
      iterations: iteration,
      conversationLength: conversationHistory.length,
      credits_remaining: creditsRemaining,
    });

    // ===========================
    // AWAIT REPORT (started in parallel — arrives as bonus after files already shown)
    // ===========================
    try {
      const reportResult = await reportPromise;
      if (reportResult && reportResult.success) {
        if (!lastExecution) lastExecution = { output_files: [] };
        if (!lastExecution.output_files) lastExecution.output_files = [];

        const reportFiles = [];

        if (reportResult.markdown) {
          const mdReport = reportResult.markdown;
          console.log(`   ✅ Markdown report: ${mdReport.filename}`);
          const mdFile = {
            name: mdReport.filename, path: mdReport.filepath, type: 'md',
            size: mdReport.size, content: mdReport.content,
            download_url: `data:text/markdown;base64,${Buffer.from(mdReport.content).toString('base64')}`
          };
          lastExecution.output_files.push(mdFile);
          reportFiles.push(mdFile);
        }

        if (reportResult.pdf) {
          const pdfReport = reportResult.pdf;
          console.log(`   ✅ PDF report: ${pdfReport.filename} (${(pdfReport.size / 1024).toFixed(1)} KB)`);
          const pdfContent = fs.readFileSync(pdfReport.filepath);
          const pdfFile = {
            name: pdfReport.filename, path: pdfReport.filepath, type: 'pdf',
            size: pdfReport.size,
            download_url: `data:application/pdf;base64,${pdfContent.toString('base64')}`
          };
          lastExecution.output_files.push(pdfFile);
          reportFiles.push(pdfFile);
        }

        // Upload reports to GCS
        if (dbSessionId) {
          try {
            const { uploadOutputFilesToGCS } = await import('./r-process-pool.js');
            const uploadedFiles = await uploadOutputFilesToGCS(dbSessionId, WORKSPACE_BASE);
            for (const outputFile of reportFiles) {
              const uploaded = uploadedFiles.find(f => f.name === outputFile.name);
              if (uploaded && uploaded.download_url) {
                outputFile.download_url = uploaded.download_url;
                outputFile.storage_url = uploaded.storage_url;
              }
            }
          } catch (uploadError) {
            console.warn('⚠️  Report GCS upload failed:', uploadError.message);
          }
        }

        // Send ALL files (R outputs + report) as the "Downloadable Outputs" card section
        await sendStep('outputs', {
          title: 'Downloadable Outputs',
          files: lastExecution.output_files,
          message: `Generated ${lastExecution.output_files.length} output file(s) for download`,
          status: 'completed'
        });
      }
    } catch (reportError) {
      console.warn('⚠️  Report generation error:', reportError.message);
    }

    // Send "Downloadable Outputs" card section even if report failed (R files only)
    if (!lastExecution?.output_files?.some(f => f.type === 'md' || f.type === 'pdf')) {
      // Report didn't generate — still show R output files in card layout
      if (lastExecution?.output_files?.length > 0) {
        await sendStep('outputs', {
          title: 'Downloadable Outputs',
          files: lastExecution.output_files,
          message: `Generated ${lastExecution.output_files.length} output file(s) for download`,
          status: 'completed'
        });
      }
    }

    // CRITICAL FIX: Update session status AFTER all workflow steps are saved
    // This ensures other tabs/pages see all steps when they query the database
    // Previously this was done before outputs/conclusion steps, causing incomplete restoration
    if (dbSessionId) {
      try {
        await updateSessionStatus(dbSessionId, 'completed', {
          total_iterations: iteration,
          completed_at: new Date().toISOString(),
          agent: 'coding',
          has_output_files: !!(lastExecution && lastExecution.output_files && lastExecution.output_files.length > 0)
        });
        console.log(`✅ Session ${dbSessionId} marked as completed (after all steps saved)`);
      } catch (statusError) {
        console.warn('⚠️  Could not update session status:', statusError.message);
      }
    }

    console.log(`✅ Biostatistical analysis complete in ${iteration} iterations`);

    clearInterval(keepAliveInterval);  // Stop keepalive before ending
    res.end();
  } catch (error) {
    console.error('❌ Error:', error);
    await sendStep('error', {
      message: error.message,
      details: error.toString(),
    });
    clearInterval(keepAliveInterval);  // Stop keepalive before ending
    res.end();
  }
});

/**
 * MULTI-AGENT ENDPOINT for Clinical Trial System
 * Orchestrates multiple specialized agents with feedback loops
 */
app.post('/api/analyze-multi-agent', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');  // CRITICAL: Disable buffering for Cloud Run/nginx proxies

  // CRITICAL: Keep SSE connection alive during long operations
  const keepAliveInterval = setInterval(() => {
    try {
      res.write(`: keepalive\n\n`);
      if (res.flush && typeof res.flush === 'function') res.flush();
    } catch (e) { /* connection already closed */ }
  }, 10000);

  req.on('close', () => {
    clearInterval(keepAliveInterval);
  });

  const { query, sessionId, mode = 'clinical_trial', enableTracing = true, maxIterations = 20 } = req.body;

  if (!query) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: 'Query is required' })}\n\n`);
    clearInterval(keepAliveInterval);
    return res.end();
  }

  console.log(`\n🏥 Starting Multi-Agent Analysis: ${query.substring(0, 60)}...`);
  console.log(`   Max iterations: ${maxIterations}`);

  // Handle dataset upload if provided (SAME AS SINGLE-AGENT)
  let datasetInfo = null;
  const { dataset } = req.body; // Extract dataset from request body

  if (dataset) {
    console.log(`📁 Dataset provided: ${dataset.name || 'unnamed'}`);

    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const uploadSessionId = `session-${timestamp}`;
      let gcsPath;

      if (dataset.gcsPath) {
        // Dataset already in GCS (e.g., benchmark datasets)
        gcsPath = dataset.gcsPath;
        console.log(`   Using existing GCS path: ${gcsPath}`);
      } else if (dataset.content) {
        // New upload - decode base64 and upload to GCS
        const buffer = Buffer.from(dataset.content, 'base64');
        const filename = dataset.name || `dataset-${timestamp}.csv`;
        gcsPath = `user-uploads/${uploadSessionId}/${filename}`;

        console.log(`   Uploading to GCS: ${gcsPath} (${buffer.length} bytes)`);

        const file = datasetBucket.file(gcsPath);
        await file.save(buffer, {
          contentType: dataset.contentType || 'text/csv',
          metadata: {
            originalName: filename,
            uploadTimestamp: timestamp,
            query: query.substring(0, 100)
          }
        });

        console.log(`   ✅ Dataset uploaded successfully`);
      } else {
        throw new Error('Dataset must have either "content" (base64) or "gcsPath"');
      }

      datasetInfo = {
        name: dataset.name || 'dataset.csv',
        gcsPath: gcsPath,
        gcsBucket: 'power-agent-datasets-476822',
        localPath: `/workspace/data/${dataset.name || 'dataset.csv'}`
      };

    } catch (uploadError) {
      console.error(`❌ Dataset upload error: ${uploadError.message}`);
      res.write(`data: ${JSON.stringify({ type: 'error', message: `Dataset upload failed: ${uploadError.message}` })}\n\n`);
      clearInterval(keepAliveInterval);
      return res.end();
    }
  }

  try {
    // Create multi-agent session in database for trace logging
    let multiAgentSessionId = null;
    if (enableTracing) {
      try {
        const { data: sessionData, error: sessionError} = await supabase
          .from('multi_agent_sessions')
          .insert({
            user_id: '00000000-0000-0000-0000-000000000000', // Anonymous UUID
            created_at: new Date().toISOString(),
            agent_mode: mode || 'clinical_trial',
            status: 'active',
            session_id: sessionId, // Link to chat session
            metadata: {
              query_preview: query.substring(0, 100),
              max_iterations: maxIterations
            }
          })
          .select()
          .single();

        if (sessionError) {
          console.warn('⚠️  Could not create multi-agent session:', sessionError);
        } else {
          multiAgentSessionId = sessionData.id;
          console.log(`✅ Created multi-agent session: ${multiAgentSessionId}`);
        }
      } catch (err) {
        console.warn('⚠️  Exception creating multi-agent session:', err);
      }
    }

    // Lazy load multi-agent components to avoid circular dependencies
    const { AgentOrchestrationEngine } = await import('./agent-orchestration-engine.js');

    // Initialize orchestration engine with config including session ID for tracing
    const orchestrator = new AgentOrchestrationEngine({
      maxIterations,
      datasetInfo,
      multiAgentSessionId,
      enableTracing
    });

    // Set up event listeners for real-time streaming
    orchestrator.on('agent_start', (data) => {
      res.write(`data: ${JSON.stringify({ type: 'agent_start', ...data })}\n\n`);
    });

    orchestrator.on('agent_route', (data) => {
      res.write(`data: ${JSON.stringify({ type: 'agent_route', ...data })}\n\n`);
    });

    orchestrator.on('feedback_loop', (data) => {
      res.write(`data: ${JSON.stringify({ type: 'feedback_loop', ...data })}\n\n`);
    });

    orchestrator.on('iteration', (data) => {
      res.write(`data: ${JSON.stringify({ type: 'iteration', ...data })}\n\n`);
    });

    orchestrator.on('trace', (data) => {
      res.write(`data: ${JSON.stringify({ type: 'trace', content: data })}\n\n`);
    });

    orchestrator.on('content', (data) => {
      res.write(`data: ${JSON.stringify({ type: 'content', content: data })}\n\n`);
    });

    // Execute with feedback loops
    const result = await orchestrator.executeWithFeedback(query, {
      sessionId,
      mode,
      enableTracing,
      maxIterations,
      datasetInfo  // Pass dataset info to orchestrator for biostat agent
    });

    // Send final result
    res.write(`data: ${JSON.stringify({
      type: 'result',
      success: result.success,
      iterations: result.iterations,
      finalScore: result.finalScore,
      content: result.formattedResponse
    })}\n\n`);

    // Send output files if any were generated by biostat agent
    if (result.results && result.results.outputs && result.results.outputs.statistical && result.results.outputs.statistical.outputFiles) {
      const outputFiles = result.results.outputs.statistical.outputFiles;
      console.log(`📤 Sending ${outputFiles.length} output file(s) from multi-agent biostat agent`);
      // FIX: Use sendStep() instead of direct res.write() to ensure consistent format
      // Frontend expects { step: 'outputs', ... } not { type: 'outputs', ... }
      sendStep('outputs', {
        title: 'Downloadable Outputs',
        files: outputFiles,
        message: `Generated ${outputFiles.length} output file(s) for download`,
        status: 'completed'
      });

      // Track files in session_files table for persistence
      if (sessionId && !sessionId.startsWith('local-')) {
        try {
          for (const file of outputFiles) {
            await trackGeneratedFile(sessionId, null, file);
          }
          console.log(`✅ Tracked ${outputFiles.length} file(s) in session_files table`);
        } catch (fileTrackError) {
          console.error('⚠️  Error tracking files:', fileTrackError.message);
          // Continue even if tracking fails
        }
      }
    }

    // Save to database if sessionId provided
    if (sessionId && !sessionId.startsWith('local-')) {
      try {
        // Save multi-agent session
        await supabase
          .from('multi_agent_sessions')
          .insert({
            user_id: 'multi-agent-user',
            session_id: sessionId,
            agent_mode: mode,
            status: 'completed'
          });

        // Save agent traces
        for (const trace of result.agentTraces || []) {
          await supabase
            .from('agent_traces')
            .insert({
              session_id: sessionId,
              iteration: trace.iteration,
              from_agent: trace.from,
              to_agent: trace.to,
              event_type: trace.type,
              message: trace.message,
              metadata: trace.metadata
            });
        }

        // Save metrics
        for (const [agentName, metrics] of Object.entries(result.agentMetrics || {})) {
          await supabase
            .from('agent_metrics')
            .insert({
              session_id: sessionId,
              agent_name: agentName,
              actions_count: metrics.actionsCount,
              total_duration: metrics.totalDuration,
              success_rate: metrics.successRate
            });
        }
      } catch (dbError) {
        console.warn('Could not save multi-agent data to database:', dbError.message);
      }
    }

    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    console.log(`✅ Multi-agent analysis complete in ${result.iterations} iterations`);

  } catch (error) {
    console.error('❌ Multi-agent error:', error);
    res.write(`data: ${JSON.stringify({
      type: 'error',
      message: error.message
    })}\n\n`);
  }

  clearInterval(keepAliveInterval);
  res.end();
});

/**
 * OPTION 3: HIERARCHICAL MULTI-AGENT ORCHESTRATION
 * PI Agent acts as central orchestrator with dynamic task breakdown and routing
 */
app.post('/api/analyze-hierarchical', async (req, res) => {
  // Use JSON response (not streaming) for hierarchical orchestration
  const { query, sessionId, context = {}, maxIterations = 20 } = req.body;

  if (!query) {
    return res.status(400).json({
      success: false,
      error: 'Query is required'
    });
  }

  console.log('\n🎯 Hierarchical Multi-Agent Request:');
  console.log(`   Session: ${sessionId || 'no-session'}`);
  console.log(`   Query: ${query.substring(0, 80)}...`);
  console.log(`   Max Iterations: ${maxIterations}`);

  // Handle dataset upload if provided (same as multi-agent)
  let datasetInfo = null;
  const { dataset } = req.body;

  if (dataset) {
    console.log(`📁 Dataset provided: ${dataset.name || 'unnamed'}`);

    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const uploadSessionId = `session-${timestamp}`;
      let gcsPath;

      if (dataset.gcsPath) {
        gcsPath = dataset.gcsPath;
        console.log(`   Using existing GCS path: ${gcsPath}`);
      } else if (dataset.content) {
        const buffer = Buffer.from(dataset.content, 'base64');
        const filename = dataset.name || `dataset-${timestamp}.csv`;
        gcsPath = `user-uploads/${uploadSessionId}/${filename}`;

        console.log(`   Uploading to GCS: ${gcsPath} (${buffer.length} bytes)`);

        const file = datasetBucket.file(gcsPath);
        await file.save(buffer, {
          contentType: dataset.contentType || 'text/csv',
          metadata: {
            originalName: filename,
            uploadTimestamp: timestamp,
            query: query.substring(0, 100)
          }
        });

        console.log(`   ✅ Dataset uploaded successfully`);
      } else {
        throw new Error('Dataset must have either "content" (base64) or "gcsPath"');
      }

      datasetInfo = {
        name: dataset.name || 'dataset.csv',
        gcsPath: gcsPath,
        gcsBucket: 'power-agent-datasets-476822',
        localPath: `/workspace/data/${dataset.name || 'dataset.csv'}`
      };

    } catch (uploadError) {
      console.error(`❌ Dataset upload error: ${uploadError.message}`);
      return res.status(500).json({
        success: false,
        error: `Dataset upload failed: ${uploadError.message}`
      });
    }
  }

  try {
    // Lazy load multi-agent components
    const { AgentOrchestrationEngine } = await import('./agent-orchestration-engine.js');

    // Initialize orchestration engine
    const orchestrator = new AgentOrchestrationEngine({ maxIterations });

    // Execute with hierarchical orchestration
    const result = await orchestrator.executeWithHierarchicalOrchestration(query, {
      sessionId,
      datasetInfo,
      ...context
    });

    // Prepare response
    const response = {
      success: result.success,
      iterations: result.iterations,
      tasksCompleted: result.tasksCompleted,
      tasksPending: result.tasksPending,
      sessionId: sessionId,
      piPlan: result.piPlan,
      results: result.results,
      issues: result.issues || [],
      executionHistory: result.executionHistory,
      feedbackLoops: result.feedbackLoops
    };

    // Include output files if any were generated
    const biostatResults = Object.values(result.results || {}).find(r => r.outputFiles);
    if (biostatResults && biostatResults.outputFiles && biostatResults.outputFiles.length > 0) {
      console.log(`📤 Including ${biostatResults.outputFiles.length} output file(s) in response`);
      response.outputFiles = biostatResults.outputFiles;

      // Track files in session_files table for persistence
      if (sessionId && !sessionId.startsWith('local-')) {
        try {
          for (const file of biostatResults.outputFiles) {
            await trackGeneratedFile(sessionId, null, file);
          }
          console.log(`✅ Tracked ${biostatResults.outputFiles.length} file(s) in session_files table`);
        } catch (fileTrackError) {
          console.error('⚠️  Error tracking files:', fileTrackError.message);
          // Continue even if tracking fails
        }
      }
    }

    console.log(`✅ Hierarchical orchestration complete`);
    console.log(`   Iterations: ${result.iterations}`);
    console.log(`   Tasks Completed: ${result.tasksCompleted}`);
    console.log(`   Issues Found: ${(result.issues && result.issues.length) || 0}`);

    res.json(response);

  } catch (error) {
    console.error('❌ Hierarchical orchestration error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * SSE endpoint for multi-agent streaming
 * Client connects here after initiating analysis
 */
app.get('/api/analyze-multi-agent', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const { sessionId } = req.query;

  // Keep connection alive
  const keepAlive = setInterval(() => {
    try {
      res.write(`: keepalive\n\n`);
      if (res.flush && typeof res.flush === 'function') res.flush();
    } catch (e) { /* connection already closed */ }
  }, 10000);

  req.on('close', () => {
    clearInterval(keepAlive);
  });
});

/**
 * AI-powered content classification for preliminary analysis
 * Uses Claude Haiku 4.5 to intelligently determine if content is data or document
 * Returns: { contentType: 'data' | 'document', confidence: number, reasoning: string }
 */
async function classifyFileContent(fileName, fileContent) {
  const classificationPrompt = `You are a content classification expert. Analyze this file content and determine if it contains STRUCTURED DATA or a DOCUMENT/TEXT.

File: ${fileName}
Content Preview (first 2000 characters):
${fileContent.substring(0, 2000)}

CLASSIFICATION CRITERIA:

**STRUCTURED DATA** - Contains tabular, numerical, or structured information:
- CSV-like format with comma/tab separators
- Multiple rows of consistent numerical or categorical data
- Column headers followed by data rows
- Database exports or spreadsheet data
- Statistical datasets with variables and observations
- JSON/XML data structures

**DOCUMENT/TEXT** - Contains prose, narrative, or unstructured text:
- Protocols, research papers, reports
- Statistical Analysis Plans (SAPs)
- Natural language paragraphs and sentences
- Markdown or formatted documents
- Study descriptions, methods sections
- Meeting notes or documentation

CRITICAL: Base your decision on the ACTUAL CONTENT STRUCTURE, not just the file extension.

Examples:
- "patient_id,age,treatment\\n1,45,control\\n2,52,intervention" → DATA (even if extension is .txt)
- "# Study Protocol\\nThis randomized trial will..." → DOCUMENT (even if extension is .csv)

Return ONLY valid JSON:
{
  "contentType": "data" or "document",
  "confidence": 0.0-1.0,
  "reasoning": "Brief explanation of why this classification was made"
}`;

  try {
    const response = await callAnthropicWithRetry({
      model: 'claude-opus-4-6', // Sonnet 4.6 for classification
      max_tokens: 500,
      temperature: 0.1, // Low temperature for consistent classification
      messages: [
        {
          role: 'user',
          content: classificationPrompt,
        },
      ],
    });

    const textBlock = response.content.find(block => block.type === 'text');
    const responseText = textBlock ? textBlock.text : '';

    // Parse JSON response
    let classification;
    try {
      classification = JSON.parse(responseText);
    } catch (parseError) {
      // Try to extract JSON from markdown
      const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) || responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        classification = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      } else {
        // Fallback: conservative default
        return {
          contentType: 'data', // Default to data for safety (code execution is accurate)
          confidence: 0.5,
          reasoning: 'Classification parsing failed, defaulting to data analysis for accuracy'
        };
      }
    }

    console.log(`   🤖 AI Classification: ${classification.contentType} (${(classification.confidence * 100).toFixed(0)}% confidence)`);
    console.log(`      Reasoning: ${classification.reasoning}`);

    return classification;
  } catch (error) {
    console.error('   ❌ Content classification error:', error.message);
    // Fallback: conservative default
    return {
      contentType: 'data',
      confidence: 0.5,
      reasoning: 'Classification failed, defaulting to data analysis for accuracy'
    };
  }
}

/**
 * Preliminary file analysis endpoint
 * Automatically analyzes uploaded files to provide context for the agent
 * Adaptive to all file types: data, protocols, statistical analysis plans, etc.
 *
 * IMPORTANT: Uses AI to classify content, then:
 * - For DATA: EXECUTES R CODE to get real statistics (no hallucination)
 * - For DOCUMENTS: Uses Claude API for text analysis
 */
app.post('/api/analyze-file', express.raw({ type: '*/*', limit: '32mb' }), async (req, res) => {
  try {
    const { fileName, fileType, fileSize } = req.query;

    // CRITICAL: Validate fileName BEFORE using it
    if (!fileName) {
      return res.status(400).json({ error: 'fileName query parameter is required' });
    }

    // Generate a session ID for preliminary analysis (for R process organization)
    const sessionId = `prelim-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    // Parse file based on type (handles PDF, DOCX, etc.)
    let fileContent;
    let parsedMetadata = {};

    const ext = fileName.split('.').pop().toLowerCase();

    // For PDFs, DOCXs, and other binary formats, use file parser
    if (['.pdf', '.docx', '.doc'].includes(`.${ext}`)) {
      console.log(`📄 Binary file detected (${ext}), using file parser...`);
      try {
        const parsed = await parseFile(req.body, fileName, fileType);
        fileContent = parsed.text;
        parsedMetadata = parsed.metadata;
        console.log(`   ✅ File parsed successfully:`, parsedMetadata);
      } catch (parseError) {
        console.warn(`   ⚠️ File parsing failed, using raw content:`, parseError.message);
        fileContent = req.body.toString('utf-8');
      }
    } else {
      // For text-based files (CSV, TXT, JSON, etc.), use as-is
      fileContent = req.body.toString('utf-8');
    }

    if (!fileName || !fileContent) {
      return res.status(400).json({ error: 'fileName and file content are required' });
    }

    console.log(`\n📄 Preliminary Analysis Request: ${fileName} (${fileType || 'unknown type'})`);

    // STEP 1: AI-powered content classification
    const classification = await classifyFileContent(fileName, fileContent);

    // STEP 2: Route based on AI classification, not file extension
    if (classification.contentType === 'data' && fileContent.length > 0) {
      console.log('   📊 Data content detected - executing R code for accurate analysis...');

      // Write data to temp file for R to read
      const fs = await import('fs/promises');
      const tmpPath = `/tmp/prelim_${Date.now()}_${fileName}`;
      await fs.writeFile(tmpPath, fileContent, 'utf-8');

      // Generate R code for preliminary analysis
      const rCode = `
# Preliminary Data Analysis - ${fileName}
cat("\\n========================================\\n")
cat("PRELIMINARY DATA ANALYSIS\\n")
cat("File: ${fileName}\\n")
cat("========================================\\n\\n")

# Load data
tryCatch({
  data <- read.csv("${tmpPath}", header = TRUE, stringsAsFactors = FALSE)

  cat("✅ Data loaded successfully\\n\\n")

  # 1. DATA STRUCTURE
  cat("1. DATA STRUCTURE\\n")
  cat("   Dimensions: ", nrow(data), " rows × ", ncol(data), " columns\\n", sep="")
  cat("   Total observations: ", nrow(data) * ncol(data), "\\n\\n", sep="")

  # 2. VARIABLES/COLUMNS
  cat("2. VARIABLES/COLUMNS\\n")
  for (col_name in colnames(data)) {
    col_data <- data[[col_name]]
    col_class <- class(col_data)[1]

    # Determine type
    if (col_class %in% c("numeric", "integer", "double")) {
      data_type <- "Numeric"
      sample_val <- paste("Range:", round(min(col_data, na.rm=TRUE), 2), "to",
                         round(max(col_data, na.rm=TRUE), 2))
    } else if (col_class == "character") {
      unique_count <- length(unique(col_data))
      if (unique_count < 20) {
        data_type <- "Categorical"
        sample_val <- paste(unique_count, "levels:", paste(head(unique(col_data), 3), collapse=", "))
      } else {
        data_type <- "Text"
        sample_val <- paste("Ex:", substr(col_data[1], 1, 30))
      }
    } else {
      data_type <- col_class
      sample_val <- paste("Ex:", substr(as.character(col_data[1]), 1, 30))
    }

    cat("   • ", col_name, " (", data_type, "): ", sample_val, "\\n", sep="")
  }

  cat("\\n3. DATA QUALITY\\n")
  # Missing values
  total_na <- sum(is.na(data))
  if (total_na > 0) {
    cat("   ⚠️  Missing values: ", total_na, " (",
        round(total_na / (nrow(data) * ncol(data)) * 100, 1), "%)\\n", sep="")
    for (col_name in colnames(data)) {
      na_count <- sum(is.na(data[[col_name]]))
      if (na_count > 0) {
        cat("      - ", col_name, ": ", na_count, " missing\\n", sep="")
      }
    }
  } else {
    cat("   ✓ No missing values detected\\n")
  }

  # Duplicates
  dup_count <- sum(duplicated(data))
  if (dup_count > 0) {
    cat("   ⚠️  Duplicate rows: ", dup_count, "\\n", sep="")
  } else {
    cat("   ✓ No duplicate rows\\n")
  }

  cat("\\n4. KEY OBSERVATIONS\\n")
  cat("   Sample size: ", nrow(data), " observations\\n", sep="")

  # Identify potential outcome and treatment variables
  outcome_keywords <- c("outcome", "result", "response", "score", "value", "measure")
  treatment_keywords <- c("treatment", "group", "arm", "intervention", "condition")

  potential_outcomes <- colnames(data)[grepl(paste(outcome_keywords, collapse="|"),
                                             colnames(data), ignore.case=TRUE)]
  potential_treatments <- colnames(data)[grepl(paste(treatment_keywords, collapse="|"),
                                               colnames(data), ignore.case=TRUE)]

  if (length(potential_outcomes) > 0) {
    cat("   Potential outcome variables: ", paste(potential_outcomes, collapse=", "), "\\n", sep="")
  }
  if (length(potential_treatments) > 0) {
    cat("   Potential treatment/group variables: ", paste(potential_treatments, collapse=", "), "\\n", sep="")
  }

  cat("\\n5. STATISTICAL NOTES\\n")
  # Count numeric and categorical variables
  numeric_cols <- sapply(data, function(x) is.numeric(x) || is.integer(x))
  n_numeric <- sum(numeric_cols)
  n_categorical <- ncol(data) - n_numeric

  cat("   • ", n_numeric, " numeric variable(s)\\n", sep="")
  cat("   • ", n_categorical, " categorical/text variable(s)\\n", sep="")

  # Sample size adequacy note
  if (nrow(data) < 30) {
    cat("   ⚠️  Small sample (n=", nrow(data), ") - consider using appropriate small-sample methods\\n", sep="")
  } else if (nrow(data) >= 100) {
    cat("   ✓ Adequate sample size (n=", nrow(data), ") for most analyses\\n", sep="")
  } else {
    cat("   • Moderate sample size (n=", nrow(data), ")\\n", sep="")
  }

  cat("\\n========================================\\n")

}, error = function(e) {
  cat("❌ Error reading data file:\\n")
  cat("   ", e$message, "\\n")
  cat("\\nFile may not be a valid CSV or may have formatting issues.\\n")
})

# Clean up temp file
if (file.exists("${tmpPath}")) {
  file.remove("${tmpPath}")
}
`;

      try {
        // Ensure R pool is ready for file analysis
        if (!poolReady) {
          console.log('[FILE-ANALYSIS] R Pool not ready, initializing...');
          await rPool.initialize();
          poolReady = true;
        }

        // Execute R code using R process pool
        const execution = await rPool.execute(rCode, {
          timeout: 1200000, // 1200 second (20 min) timeout - allows source compilation of complex packages like swCRTdesign, metafor, glmmTMB
          sessionId: sessionId  // Pass session ID for file organization
        });

        if (execution.success && execution.output) {
          console.log(`   ✅ R execution successful in ${execution.executionTime}ms`);

          res.json({
            success: true,
            fileName,
            fileType: 'data',
            analysis: execution.output,
            analyzedAt: new Date().toISOString(),
            method: 'code_execution',
            executionTime: execution.executionTime,
            processId: execution.processId,
            classification: {
              contentType: classification.contentType,
              confidence: classification.confidence,
              reasoning: classification.reasoning
            }
          });
        } else {
          // Fallback to text analysis if R execution fails
          console.warn('   ⚠️  R execution failed, falling back to text analysis');
          throw new Error('R execution produced no output');
        }
      } catch (execError) {
        // ENHANCED ERROR LOGGING - Show full details even when falling back
        console.error('❌ R EXECUTION FAILED - Falling back to text analysis');
        console.error('   - Error message:', execError.message);
        console.error('   - Error stack:', execError.stack);
        console.error('   - File being analyzed:', fileName);
        console.error('   - File type:', fileType);

        // Fallback to Claude text analysis
        console.log('⚠️  Using Claude text analysis as fallback...');
        const ext = fileName.split('.').pop().toLowerCase();
        const fallbackAnalysis = await analyzeWithClaude(fileName, fileContent, ext, false);

        res.json({
          success: true,
          fileName,
          fileType,
          analysis: `⚠️ Code execution unavailable, using text analysis:\n\n${fallbackAnalysis}`,
          analyzedAt: new Date().toISOString(),
          method: 'text_analysis_fallback',
          fallback_reason: execError.message, // Include error in response
          classification: {
            contentType: classification.contentType,
            confidence: classification.confidence,
            reasoning: classification.reasoning
          }
        });
      }

      return; // Exit after handling data content
    }

    // FOR DOCUMENTS: Use Claude API for text analysis
    console.log('   📄 Document content detected - using Claude API for text analysis...');

    // ext already declared at the start of this try block
    const analysis = await analyzeWithClaude(fileName, fileContent, ext, true);

    console.log('   ✅ Preliminary analysis complete');

    // CRITICAL FIX: Store file in session_files table for persistence
    const clientSessionId = req.query.sessionId || req.query.session_id;

    if (clientSessionId && clientSessionId !== 'undefined') {
      try {
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientSessionId);

        if (isUUID) {
          // CRITICAL: Ensure session exists before inserting file (foreign key constraint)
          const { data: existingSession } = await supabase
            .from('chat_sessions')
            .select('session_id')
            .eq('session_id', clientSessionId)
            .single();

          if (!existingSession) {
            // Create session if it doesn't exist
            console.log(`📝 Creating session for uploaded file: ${clientSessionId}`);
            const newSession = await createSession(null);

            await supabase
              .from('chat_sessions')
              .update({
                session_id: clientSessionId,
                title: `Uploaded: ${fileName}`,
                status: 'active',
                last_activity: new Date().toISOString()
              })
              .eq('session_id', newSession.session_id);
          }

          const { data: insertedFile, error: insertError} = await supabase
            .from('session_files')
            .insert({
              session_id: clientSessionId,
              file_name: fileName,
              file_size: fileSize,
              file_type: fileType,
              mime_type: fileType,
              is_uploaded: true,
              analysis_summary: analysis,  // Preliminary analysis
              full_content: fileContent,   // FULL extracted text (critical for domain expert)
              metadata: {
                classification: {
                  content_type: classification.contentType,
                  confidence: classification.confidence,
                  reasoning: classification.reasoning
                },
                parsed_metadata: parsedMetadata,
                file_extension: ext
              }
            })
            .select()
            .single();

          if (insertError) {
            console.warn(`⚠️  Could not store file in database: ${insertError.message}`);
            console.warn(`⚠️  Insert error details:`, JSON.stringify(insertError, null, 2));
          } else {
            console.log(`✅ Stored file in database: ${fileName} (file_id: ${insertedFile.file_id})`);
          }
        }
      } catch (fileStoreError) {
        console.warn(`⚠️  Error storing file: ${fileStoreError.message}`);
        console.warn(`⚠️  Stack trace:`, fileStoreError.stack);
      }
    }

    res.json({
      success: true,
      fileName,
      fileType,
      analysis,
      extractedText: fileContent, // Return full extracted content for downstream use
      analyzedAt: new Date().toISOString(),
      method: 'text_analysis',
      classification: {
        contentType: classification.contentType,
        confidence: classification.confidence,
        reasoning: classification.reasoning
      }
    });
  } catch (error) {
    console.error('❌ Preliminary analysis error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Helper function: Analyze file with Claude API (text-based analysis)
 */
async function analyzeWithClaude(fileName, fileContent, ext, isDocument) {
  let analysisPrompt = `You are a professional biostatistician receiving a file from a colleague. Perform a quick preliminary analysis of this file.

File: ${fileName}
Type: ${ext}

`;

  if (isDocument) {
    analysisPrompt += `This appears to be a DOCUMENT. Analyze and extract:

1. **Document Type**: Protocol, Statistical Analysis Plan (SAP), Study Report, or other
2. **Research Question**: What question is being asked or investigated?
3. **Key Objectives**: Primary and secondary objectives if stated
4. **Study Design**: Type of study (RCT, observational, etc.) and design elements
5. **Data Requirements**: What data or variables are needed
6. **Analysis Methods**: Statistical methods mentioned or required
7. **Expected Outcomes**: What results or deliverables are expected

`;
  } else {
    analysisPrompt += `Analyze this file and provide:

1. **File Purpose**: What is this file for?
2. **Key Content**: Main information or data contained
3. **Relevant Details**: Important details a biostatistician should know
4. **Usage Context**: How might this file be used in statistical analysis?

`;
  }

  analysisPrompt += `
File Content (first 5000 characters):
${fileContent.substring(0, 5000)}

Provide a concise, professional preliminary analysis. Format your response in clear sections. Be specific and factual. If you cannot fully determine something, state what you can observe.`;

  // Use Claude Sonnet 4.6 for fast, efficient text analysis
  const response = await callAnthropicWithRetry({
    model: 'claude-opus-4-6',
    max_tokens: 2048,
    temperature: 0.3,
    messages: [
      {
        role: 'user',
        content: analysisPrompt,
      },
    ],
  });

  const textBlock = response.content.find(block => block.type === 'text');
  return textBlock ? textBlock.text : '';
}

/**
 * Get trace data for a multi-agent session
 */
app.get('/api/session/:sessionId/traces', async (req, res) => {
  try {
    const { sessionId } = req.params;

    // Get multi-agent session ID from chat session
    const { data: sessionData, error: sessionError } = await supabase
      .from('multi_agent_sessions')
      .select('id')
      .eq('session_id', sessionId)
      .single();

    if (sessionError || !sessionData) {
      return res.json({ success: true, traces: [] }); // No multi-agent session, return empty
    }

    // Get all traces for this session
    const { data: traces, error: tracesError } = await supabase
      .from('agent_traces')
      .select('*')
      .eq('session_id', sessionData.id)
      .order('timestamp', { ascending: true });

    if (tracesError) {
      console.error('Error fetching traces:', tracesError);
      return res.status(500).json({ success: false, error: tracesError.message });
    }

    res.json({
      success: true,
      traces: traces || [],
      totalCount: traces?.length || 0
    });
  } catch (error) {
    console.error('Error in /api/session/:sessionId/traces:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Get agent execution traces for E2E testing
 * This endpoint queries workflow_steps to get execution traces for a session
 */
app.get('/api/agent-traces/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;

    console.log(`📊 Fetching agent traces for session: ${sessionId}`);

    // Try to find session in chat_sessions table by UUID first
    let session = null;
    const { data: uuidSession, error: sessionError } = await supabase
      .from('chat_sessions')
      .select('session_id')
      .eq('session_id', sessionId)
      .maybeSingle();

    if (sessionError) {
      console.error('Error finding session by UUID:', sessionError);
    }

    if (uuidSession) {
      session = uuidSession;
      console.log(`   Found session by UUID: ${session.session_id}`);
    } else {
      // If not a UUID or not found, try to find by most recent session
      // This handles cases where client uses non-UUID sessionIds
      console.log(`   Session ${sessionId} not found by UUID, trying most recent session...`);
      const { data: recentSession, error: recentError } = await supabase
        .from('chat_sessions')
        .select('session_id')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (recentError) {
        console.error('Error finding recent session:', recentError);
      }

      if (recentSession) {
        session = recentSession;
        console.log(`   Using most recent session: ${session.session_id}`);
      }
    }

    if (!session) {
      // No sessions found in database
      console.log(`   No sessions found in database`);
      return res.json({ success: true, traces: [] });
    }

    // Query workflow_steps table for execution traces
    const { data: steps, error: stepsError } = await supabase
      .from('workflow_steps')
      .select('*')
      .eq('session_id', session.session_id)
      .order('sequence_number', { ascending: true });

    if (stepsError) {
      console.error('Error fetching workflow steps:', stepsError);
      return res.status(500).json({ success: false, error: stepsError.message });
    }

    // Transform workflow steps to trace format expected by E2E tests
    const traces = (steps || []).map(step => ({
      iteration: step.iteration,
      step: step.step,
      status: step.status,
      code: step.metadata?.code,
      output: step.metadata?.output,
      error: step.metadata?.error,
      duration: step.metadata?.executionTime,
      timestamp: step.created_at
    }));

    console.log(`   ✅ Found ${traces.length} traces for session ${sessionId}`);

    res.json({
      success: true,
      traces: traces
    });
  } catch (error) {
    console.error('Error in /api/agent-traces/:sessionId:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Get multi-agent evaluation results for a session
 */
app.get('/api/session/:sessionId/evaluation', async (req, res) => {
  try {
    const { sessionId } = req.params;

    // Get multi-agent session ID from chat session
    const { data: sessionData, error: sessionError } = await supabase
      .from('multi_agent_sessions')
      .select('id')
      .eq('session_id', sessionId)
      .single();

    if (sessionError || !sessionData) {
      return res.json({ success: true, evaluation: null }); // No multi-agent session
    }

    // Get evaluation results
    const { data: results, error: resultsError } = await supabase
      .from('multi_agent_results')
      .select('*')
      .eq('session_id', sessionData.id)
      .single();

    if (resultsError && resultsError.code !== 'PGRST116') { // PGRST116 = not found
      console.error('Error fetching evaluation:', resultsError);
      return res.status(500).json({ success: false, error: resultsError.message });
    }

    res.json({
      success: true,
      evaluation: results || null
    });
  } catch (error) {
    console.error('Error in /api/session/:sessionId/evaluation:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Get session info with agent type
 */
app.get('/api/session/:sessionId/info', async (req, res) => {
  try {
    const { sessionId } = req.params;

    const { data, error } = await supabase
      .from('chat_sessions')
      .select('*')
      .eq('session_id', sessionId)
      .single();

    if (error) {
      console.error('Error fetching session:', error);
      return res.status(404).json({ success: false, error: 'Session not found' });
    }

    res.json({
      success: true,
      session: data
    });
  } catch (error) {
    console.error('Error in /api/session/:sessionId/info:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'biostatistics-agent',
    mode: 'r-process-pool',
    poolStats: rPool.getStats(),
    poolReady: poolReady,
    features: [
      'R code execution via process pool (1000x faster)',
      'Automatic error detection and fixing',
      'Iterative agent reasoning',
      'Multi-turn execution',
      'Streaming results',
      'All CRAN packages available',
      'Preliminary file analysis',
      'Persistent R processes for performance',
    ],
  });
});

/**
 * Supabase configuration endpoint
 * Provides the Supabase URL and anon key for frontend initialization
 */
app.get('/api/supabase-config', (req, res) => {
  // Use environment variables or fallback to CORRECT values (Power Agent project)
  // FIXED: Changed from old project (kvjbqevf...) to correct project (njhlrrf...)
  const supabaseUrl = process.env.SUPABASE_URL || 'https://njhlrrfstppykimxpvwz.supabase.co';
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5qaGxycmZzdHBweWtpbXhwdnd6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA2NjEyOTksImV4cCI6MjA3NjIzNzI5OX0.N7uR2MiusGqy0tOT39IWqt6GRU02_MXFIaefSvYEAM4';

  res.json({
    url: supabaseUrl,
    anonKey: supabaseAnonKey
  });
});

/**
 * Template Auto-Fill Parser
 * Uses LLM to extract structured information from natural text to fill template fields
 * IMPORTANT: LLM is prompted to be honest and rigorous - only extract explicitly stated information
 */
app.post('/api/parse-template', async (req, res) => {
  try {
    const { userInput, template, prompt } = req.body;

    if (!userInput || !template || !prompt) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: userInput, template, or prompt'
      });
    }

    console.log('📋 Template parsing request:', {
      template: template.title,
      inputLength: userInput.length,
      questionCount: template.questions.length
    });

    // DEBUG: Log the full prompt being sent to Claude
    console.log('🔍 FULL PROMPT BEING SENT TO CLAUDE:');
    console.log('====================');
    console.log(prompt);
    console.log('====================');

    // Call Claude to parse the user input
    const response = await callAnthropicWithRetry({
      model: 'claude-opus-4-6', // Use Sonnet 4.6 for best accuracy
      max_tokens: 4096,
      temperature: 0.1, // Low temperature for precise extraction
      messages: [{
        role: 'user',
        content: prompt
      }]
    });

    // Extract the parsed fields from Claude's response
    const responseText = response.content[0].text;

    console.log('🤖 Claude response:', responseText.substring(0, 300));

    // Try to extract JSON from the response with multiple strategies
    let parsedFields = {};

    // Strategy 1: Look for JSON in code blocks (```json or ```)
    let jsonMatch = responseText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);

    // Strategy 2: Look for plain JSON object
    if (!jsonMatch) {
      jsonMatch = responseText.match(/\{[\s\S]*\}/);
    }

    if (jsonMatch) {
      const jsonString = jsonMatch[1] || jsonMatch[0];
      try {
        parsedFields = JSON.parse(jsonString);
        console.log('✅ Parsed fields:', Object.keys(parsedFields).length, 'fields');
        console.log('📋 Field IDs:', Object.keys(parsedFields).join(', '));
      } catch (parseError) {
        console.error('❌ Failed to parse JSON:', parseError.message);
        console.error('   JSON string attempted:', jsonString.substring(0, 200));
        // Try to clean up and retry
        try {
          // Remove markdown formatting
          const cleaned = jsonString.replace(/\*\*/g, '').replace(/\*/g, '');
          parsedFields = JSON.parse(cleaned);
          console.log('✅ Parsed fields after cleanup:', Object.keys(parsedFields).length, 'fields');
        } catch (retryError) {
          console.error('❌ Still failed after cleanup');
          parsedFields = {};
        }
      }
    } else {
      console.warn('⚠️ No JSON found in response');
      console.warn('   Full response:', responseText);
      parsedFields = {};
    }

    // Log which fields were filled vs missing
    const filledFields = Object.entries(parsedFields).filter(([k, v]) => v !== null && v !== undefined && v !== '').length;
    const missingFields = template.questions.length - filledFields;

    console.log(`📊 Results: ${filledFields} filled, ${missingFields} missing`);

    res.json({
      success: true,
      parsedFields: parsedFields,
      metadata: {
        filledCount: filledFields,
        missingCount: missingFields,
        totalFields: template.questions.length
      }
    });

  } catch (error) {
    console.error('❌ Error in template parsing:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to parse template'
    });
  }
});

/**
 * DOMAIN EXPERT ENDPOINT
 * Validates if a query has enough information for power analysis
 */
app.post('/api/domain-expert', async (req, res) => {
  try {
    const { query, sessionId } = req.body;

    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: query'
      });
    }

    console.log(`[Domain Expert] Analyzing query for session: ${sessionId || 'anonymous'}`);

    // Get session history if available
    let sessionHistory = [];
    if (sessionId) {
      sessionHistory = await chatbotDomainExpert.loadSessionContext(sessionId);
    }

    // Get session files context if available
    let sessionFilesContext = '';
    if (sessionId) {
      try {
        const dbFiles = await getSessionFiles(sessionId);
        if (dbFiles && dbFiles.length > 0) {
          sessionFilesContext = '\n\n**Files Available in This Session:**\n';
          for (const file of dbFiles) {
            sessionFilesContext += `\n### ${file.file_name} (${file.file_type})`;

            // Add preliminary analysis summary
            if (file.analysis_summary) {
              sessionFilesContext += `\n\n**Preliminary Analysis:**\n${file.analysis_summary}`;
            }

            // CRITICAL FIX: Add full document content for domain expert
            if (file.full_content) {
              const contentLength = file.full_content.length;
              // Truncate to 10k chars to avoid token limits (≈2500 tokens)
              const truncatedContent = file.full_content.substring(0, 10000);

              sessionFilesContext += `\n\n**Full Document Content (${contentLength} chars):**\n`;
              sessionFilesContext += `\`\`\`\n${truncatedContent}\n\`\`\``;

              if (contentLength > 10000) {
                sessionFilesContext += `\n\n*(Content truncated for brevity. Full document has ${contentLength} characters)*`;
              }
            }

            sessionFilesContext += '\n';
          }

          console.log(`📋 Built session files context: ${sessionFilesContext.length} chars for domain expert`);
        }
      } catch (filesError) {
        console.log('Note: Could not load session files (non-critical)');
      }
    }

    // Analyze the query (with session files context)
    const analysis = await chatbotDomainExpert.analyzeQuery(query, sessionHistory, sessionFilesContext);

    console.log(`[Domain Expert] Analysis result: mode=${analysis.mode}`);

    res.json(analysis);

  } catch (error) {
    console.error('[Domain Expert] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to analyze query',
      mode: 'error'
    });
  }
});

/**
 * DIRECT R CODE EXECUTION ENDPOINT (FOR TESTING)
 * Bypasses consultation flow to directly test R package installation
 * This is a testing endpoint to verify the PPM fix for on-demand package installation
 */
app.post('/api/test-r-direct', async (req, res) => {
  try {
    const { query, sessionId = 'test-direct-' + Date.now() } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'query is required' });
    }

    console.log(`\n🧪 [TEST-R-DIRECT] Direct R execution request`);
    console.log(`📝 Query: ${query}`);
    console.log(`🔑 Session: ${sessionId}`);

    // Ensure R pool is ready
    if (!poolReady) {
      console.log('[TEST-R-DIRECT] R Pool not ready, initializing...');
      await rPool.initialize();
      poolReady = true;
    }

    const startTime = Date.now();

    // Execute R code directly via R process pool
    console.log(`⏳ [TEST-R-DIRECT] Executing R code...`);
    const result = await rPool.execute(query, {
      timeout: 1800000, // 30 minute timeout for package installation with dependencies
      sessionId: sessionId
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`✅ [TEST-R-DIRECT] Execution completed in ${duration}s`);

    // Return results
    res.json({
      success: true,
      sessionId: sessionId,
      duration: duration + 's',
      output: result.output || '',
      error: result.error || null,
      files: result.files || [],
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[TEST-R-DIRECT] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'R execution failed',
      timestamp: new Date().toISOString()
    });
  }
});

app.use(express.static('../frontend'));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Start server FIRST, then initialize R pool in background
// This ensures Cloud Run health checks pass before R pool is ready
async function startServer() {
  // Start listening on the port IMMEDIATELY so Cloud Run health checks pass
  app.listen(port, () => {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`🧬 BIOSTATISTICS AGENT - LIVE on port ${port}`);
    console.log(`${'='.repeat(70)}`);
    console.log(`\n🚀 R Process Pool: Initializing in background...`);
    console.log(`\n🧠 Agent Capabilities:`);
    console.log(`   • Multi-turn reasoning (adaptive: 10-20 iterations based on query complexity)`);
    console.log(`   • R code execution via warm R process pool (1000x faster)`);
    console.log(`   • Automatic error fixing and retry`);
    console.log(`   • Self-inspection of execution results`);
    console.log(`   • Adaptive biostatistical analysis`);
    console.log(`\n📊 Biostatistics Features:`);
    console.log(`   • Sample size calculations (CRT, SW-CRT, etc.)`);
    console.log(`   • Power analysis for various designs`);
    console.log(`   • Mixed-effects models (lme4)`);
    console.log(`   • Survival analysis`);
    console.log(`   • All CRAN packages auto-installed`);
    console.log(`\n📍 Endpoints:`);
    console.log(`   POST /api/analyze-biostat - BIOSTATISTICS AGENT (Single)`);
    console.log(`   POST /api/analyze-multi-agent - MULTI-AGENT SYSTEM`);
    console.log(`   GET  /health - Health check`);
    console.log(`\n🌐 Open: http://localhost:${port}/chat-biostat.html`);
    console.log(`\n${'='.repeat(70)}\n`);
  });

  // Initialize R pool in the background AFTER server starts
  // This allows Cloud Run health checks to pass immediately
  // Requests will use on-demand initialization if pool isn't ready yet
  initializeRPool().then(() => {
    console.log(`\n✅ R Process Pool: READY - ${rPool.getStats().availableProcesses} processes available`);
  }).catch(error => {
    console.error('⚠️  R Pool initialization failed (will use on-demand):', error.message);
    // Don't exit - server can still work with on-demand R process creation
  });
}

// Start the server
startServer();

export default app;
