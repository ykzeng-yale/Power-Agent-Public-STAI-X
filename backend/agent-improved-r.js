import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import { Sandbox } from '@e2b/code-interpreter';

dotenv.config();

const app = express();
const port = 3005;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * Common R packages for biostatistics
 */
const COMMON_R_PACKAGES = [
  'lme4',        // Mixed-effects models
  'survey',      // Survey statistics  
  'survival',    // Survival analysis
  'CRTSize',     // CRT sample size
  'pwrss',       // Power analysis
  // 'swdpwr',    // Stepped wedge (may not be on CRAN)
  // 'swCRTdesign', // SW design (may not be on CRAN)
];

/**
 * Pre-install R packages in sandbox
 */
async function setupREnvironment(sandbox, sendStep) {
  sendStep('setup', {
    title: 'Setting Up R Environment',
    status: 'running',
    message: 'Installing rpy2 and common R packages...',
  });

  try {
    // Install rpy2
    await sandbox.runCode(`
import subprocess
import sys

print("Installing rpy2...")
subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', 'rpy2'], check=True)
print("✓ rpy2 installed")
`);

    sendStep('setup', {
      title: 'Installing R Packages',
      status: 'running',
      message: `Pre-installing: ${COMMON_R_PACKAGES.join(', ')}...`,
    });

    // Pre-install common R packages
    const installCode = `
import rpy2.robjects as ro
from rpy2.robjects.packages import importr

print("Installing common biostatistics R packages...")
utils = importr('utils')

# Set CRAN mirror
ro.r('options(repos = c(CRAN = "https://cloud.r-project.org"))')

packages = ${JSON.stringify(COMMON_R_PACKAGES)}

for pkg in packages:
    try:
        print(f"Installing {pkg}...")
        ro.r(f'if (!require("{pkg}", quietly = TRUE)) install.packages("{pkg}", quiet = TRUE)')
        print(f"✓ {pkg} ready")
    except Exception as e:
        print(f"⚠ {pkg} failed: {e}")
        
print("\\nR environment setup complete!")
print("Available packages:", packages)
`;

    const result = await sandbox.runCode(installCode);
    
    const installedPackages = COMMON_R_PACKAGES.filter((pkg) =>
      result.logs.stdout?.some((line) => line.includes(`✓ ${pkg} ready`))
    );

    sendStep('setup', {
      title: 'R Environment Ready',
      status: 'completed',
      message: `Installed ${installedPackages.length} R packages. Python + R ready!`,
      packages: installedPackages,
    });

    return installedPackages;
  } catch (error) {
    sendStep('setup', {
      title: 'R Environment',
      status: 'completed',
      message: 'rpy2 installed. R packages available on-demand.',
    });
    return [];
  }
}

/**
 * IMPROVED ITERATIVE AGENT WITH PRE-INSTALLED R PACKAGES
 */
app.post('/api/analyze-biostat', async (req, res) => {
  let sandbox = null;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  function sendStep(step, data) {
    res.write(`data: ${JSON.stringify({ step, timestamp: Date.now(), ...data })}\n\n`);
  }

  try {
    const { query, data } = req.body;

    if (!query) {
      sendStep('error', { message: 'Query is required' });
      return res.end();
    }

    console.log(`\n🧬 Biostatistics Analysis: ${query.substring(0, 60)}...`);

    // Create sandbox
    sendStep('init', {
      title: 'Initializing Biostatistics Environment',
      status: 'running',
      message: 'Creating E2B sandbox...',
    });

    sandbox = await Sandbox.create({
      apiKey: process.env.E2B_API_KEY,
    });

    sendStep('init', {
      status: 'completed',
      message: 'Sandbox created',
    });

    // Setup R environment with pre-installed packages
    const installedPackages = await setupREnvironment(sandbox, sendStep);

    // Write data if provided
    if (data) {
      await sandbox.files.write('/home/user/data.csv', data);
      sendStep('data', {
        status: 'completed',
        message: 'Data loaded',
      });
    }

    // AGENTIC LOOP
    const conversationHistory = [];
    let iteration = 0;
    const maxIterations = 5;
    let isComplete = false;

    const systemPrompt = `You are an expert biostatistician agent with Python AND R.

PRE-INSTALLED R PACKAGES: ${installedPackages.join(', ')}

CRITICAL EXECUTION RULES:
1. ALWAYS generate executable code (Python or R)
2. When using R packages, PREFER rpy2 approach over subprocess
3. If R package exists for the task, USE IT via rpy2 (don't reinvent in Python!)
4. NEVER say "ANALYSIS_COMPLETE" without executing code first
5. After execution, READ outputs and decide: iterate or complete

HOW TO USE R PACKAGES (RECOMMENDED APPROACH):

For pre-installed packages (${installedPackages.join(', ')}):
\`\`\`python
import rpy2.robjects as ro
from rpy2.robjects import pandas2ri
from rpy2.robjects.packages import importr

pandas2ri.activate()

# Import package (already installed!)
lme4 = importr('lme4')  # Or any pre-installed package

# Use R functions
result = lme4.lmer('y ~ x + (1|group)', data=df_r)
summary = ro.r['summary'](result)
print(summary)
\`\`\`

For other packages:
\`\`\`python
import rpy2.robjects as ro

# Install if needed
ro.r('if (!require("packagename")) install.packages("packagename")')

from rpy2.robjects.packages import importr
pkg = importr('packagename')
\`\`\`

IMPORTANT PRIORITIES:
1. If R package exists for task (e.g., CRTSize, lme4, survey):
   → Use it via rpy2 (PREFERRED!)
   → Don't create Python equivalent
   
2. If R package install fails:
   → Try simpler R base functions first
   → Only use pure Python as last resort
   
3. When you see execution results:
   → Inspect them carefully
   → Decide if sufficient or need refinement

${data ? 'Data: /home/user/data.csv' : ''}`;

    conversationHistory.push({
      role: 'user',
      content: `Analyze: "${query}"

Available R packages (pre-installed): ${installedPackages.join(', ')}

${data ? 'Data: /home/user/data.csv' : ''}

Prefer using R packages via rpy2 when they exist for the task!`,
    });

    // ITERATIVE LOOP
    while (!isComplete && iteration < maxIterations) {
      iteration++;

      sendStep('thinking', {
        iteration,
        title: `Agent Reasoning - Iteration ${iteration}`,
        status: 'running',
        message:
          iteration === 1
            ? 'Planning analysis approach...'
            : 'Reviewing results and deciding next steps...',
      });

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        system: systemPrompt,
        messages: conversationHistory,
      });

      const assistantMessage = response.content[0].text;
      conversationHistory.push({
        role: 'assistant',
        content: assistantMessage,
      });

      // Extract code
      const pythonMatch = assistantMessage.match(/```python\n([\s\S]*?)\n```/);
      const rMatch = assistantMessage.match(/```r\n([\s\S]*?)\n```/);

      let code, language;
      if (pythonMatch) {
        code = pythonMatch[1];
        language = 'Python';
      } else if (rMatch) {
        code = rMatch[1];
        language = 'R';
      }

      // Check for premature completion
      const wantsToComplete = assistantMessage.includes('ANALYSIS_COMPLETE');
      
      if (!code) {
        if (wantsToComplete) {
          // Completing without code - allow if this is final interpretation
          isComplete = true;
          sendStep('thinking', {
            iteration,
            status: 'completed',
            reasoning: assistantMessage,
          });
          break;
        }
        
        // No code and not completing - prompt for code
        conversationHistory.push({
          role: 'user',
          content: 'Please provide executable code (Python or R) for the analysis.',
        });
        continue;
      }

      sendStep('thinking', {
        iteration,
        status: 'completed',
        reasoning: assistantMessage.substring(0, 400) + '...',
      });

      sendStep('code', {
        iteration,
        title: `${language} Code Generated`,
        status: 'completed',
        code: code,
        language: language,
      });

      // Execute code
      sendStep('executing', {
        iteration,
        title: `Executing ${language}`,
        status: 'running',
        message: `Running ${language} in E2B...`,
      });

      let execution;
      try {
        // Wrap R code for subprocess if needed
        let execCode = code;
        if (language === 'R') {
          execCode = `
import subprocess
import tempfile

r_code = """
${code}
"""

with tempfile.NamedTemporaryFile(mode='w', suffix='.R', delete=False) as f:
    f.write(r_code)
    r_file = f.name

try:
    result = subprocess.run(['Rscript', r_file], 
                          capture_output=True, 
                          text=True, 
                          timeout=180)
    print(result.stdout)
    if result.stderr:
        print("R MESSAGES:", result.stderr)
except Exception as e:
    print(f"R execution error: {e}")
`;
        }

        execution = await sandbox.runCode(execCode);
      } catch (execError) {
        sendStep('executing', {
          iteration,
          title: `Execution Error`,
          status: 'error',
          error: execError.message,
        });

        conversationHistory.push({
          role: 'user',
          content: `Execution error: ${execError.message}\n\nPlease fix the code and try again.`,
        });
        continue;
      }

      const stdout = execution.logs.stdout || [];
      const stderr = execution.logs.stderr || [];

      sendStep('executing', {
        iteration,
        title: `${language} Execution Complete`,
        status: 'completed',
        output: stdout,
        warnings: stderr.length > 0 ? stderr : undefined,
      });

      // Collect visualizations
      const images = [];
      const files = await sandbox.files.list('/home/user');

      for (const file of files) {
        if (file.name.match(/\.(png|jpg|jpeg|pdf)$/i) && !file.name.startsWith('.')) {
          try {
            const imageData = await sandbox.files.read(file.path);
            images.push({
              filename: file.name,
              data: Buffer.from(imageData).toString('base64'),
              format: file.name.endsWith('.pdf') ? 'application/pdf' : 'image/png',
            });
          } catch (err) {}
        }
      }

      if (images.length > 0) {
        sendStep('visualization', {
          iteration,
          images: images,
          status: 'completed',
        });
      }

      // Give results back to agent
      const executionFeedback = `
===== EXECUTION RESULTS - Iteration ${iteration} =====

LANGUAGE USED: ${language}

OUTPUT:
${stdout.join('\n') || '(no output)'}

${stderr.length > 0 ? `MESSAGES/WARNINGS:\n${stderr.join('\n')}` : ''}
${images.length > 0 ? `VISUALIZATIONS: ${images.length} generated` : ''}

===== REVIEW REQUIRED =====

You have now SEEN the execution results above.

1. Did the code execute successfully?
2. Do the results answer the user's question?
3. Do you need to refine or try different approach?

DECISION:
A) Results are SUFFICIENT:
   - Interpret the outputs clearly
   - Explain what they mean
   - Include "ANALYSIS_COMPLETE"
   
B) Need to iterate:
   - Explain what you learned
   - What will you try next
   - Generate improved code
   - Do NOT say "ANALYSIS_COMPLETE"

Remember: User wants REAL RESULTS, not just code!`;

      conversationHistory.push({
        role: 'user',
        content: executionFeedback,
      });

      sendStep('reviewing', {
        iteration,
        title: 'Agent Reviewing Results',
        status: 'running',
        message: 'Analyzing execution outputs...',
      });

      await sleep(500);
    }

    // Final summary
    sendStep('summary', {
      title: 'Analysis Complete',
      status: 'completed',
      totalIterations: iteration,
    });

    const finalResponse = conversationHistory[conversationHistory.length - 1];
    if (finalResponse.role === 'assistant') {
      sendStep('insights', {
        title: 'Final Insights',
        status: 'completed',
        content: finalResponse.content,
      });
    }

    sendStep('complete', { iterations: iteration });

    console.log(`✅ Biostatistics analysis complete (${iteration} iterations)`);
    res.end();
  } catch (error) {
    console.error('❌ Error:', error);
    sendStep('error', { message: error.message });
    res.end();
  } finally {
    if (sandbox) {
      try {
        await sandbox.kill();
      } catch (e) {}
    }
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'biostatistics-agent',
    preinstalled_r_packages: COMMON_R_PACKAGES,
    features: [
      'r-package-preinstall',
      'rpy2-integration',
      'iterative-reasoning',
      'python-r-hybrid',
    ],
  });
});

app.use(express.static('../frontend'));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.listen(port, () => {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`🧬 BIOSTATISTICS AGENT - Port ${port}`);
  console.log(`${'='.repeat(70)}`);
  console.log(`\n📦 Pre-installed R Packages:`);
  COMMON_R_PACKAGES.forEach((pkg) => console.log(`   • ${pkg}`));
  console.log(`\n✨ Features:`);
  console.log(`   • R packages pre-installed at startup`);
  console.log(`   • Faster R package access`);
  console.log(`   • Prioritizes rpy2 over pure Python`);
  console.log(`   • Iterative refinement`);
  console.log(`\n🌐 Open: http://localhost:${port}/chat-biostat.html`);
  console.log(`\n${'='.repeat(70)}\n`);
});

export default app;


