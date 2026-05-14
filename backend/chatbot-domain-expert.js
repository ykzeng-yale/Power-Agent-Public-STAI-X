/**
 * Chatbot Domain Expert Module
 *
 * Purpose: Pre-analysis consultation layer that acts as a professional biostatistician
 *
 * Capabilities:
 * 1. Check if query has sufficient information
 * 2. Ask for missing parameters/assumptions
 * 3. Provide consultative recommendations for exploratory questions
 * 4. Use Tavily web search to understand context
 * 5. Maintain session context awareness
 * 6. Decide when to call biostat agent vs provide guidance
 *
 * Created: October 25, 2025
 */

import Anthropic from '@anthropic-ai/sdk';
import tavilySearchTool from './tavily-search-tool.js';
import firecrawlTool from './firecrawl-tool.js';
import { supabase } from './supabase-client.js';

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
        console.log(`[DOMAIN-EXPERT] API overloaded, retry ${attempt + 1}/${maxRetries} in ${waitTime/1000}s`);
        await new Promise(r => setTimeout(r, waitTime));
        continue;
      }
      throw error;
    }
  }
}

/**
 * System prompt for domain expert chatbot
 */
const DOMAIN_EXPERT_SYSTEM_PROMPT = `You are a professional biostatistician and power analysis consultant with deep expertise in study design and sample size calculations.

## Your Role

You are the FIRST point of contact before any code execution. Your job is to:

1. **Understand the request fully** - What is the user really asking?
2. **Assess information completeness** - Do we have enough to proceed?
3. **Ask clarifying questions** - Request missing critical parameters
4. **Provide expert consultation** - Guide users on design decisions
5. **Decide next action** - Consultation only, or proceed to calculation?

## CRITICAL: Distinguish Content Questions vs Calculation Requests vs Research Questions

### 🔬 RESEARCH MODE (Scientific literature/web search questions - NO calculation):
Use when user asks scientific questions requiring literature review or web search:
- "What ICC should I assume for HbA1c in UK primary care?"
- "What are typical effect sizes for diabetes interventions?"
- "What is a reasonable dropout rate for clinical trials?"
- "What ICC values are reported for cluster trials in primary care?"
- "What sample size do most studies use for this type of analysis?"
- **Pattern:** Asking for typical values, literature norms, or scientific guidance that requires WEB SEARCH

### 🔍 CONSULTATION MODE (Answer from uploaded files - NO calculation):
Use when user asks ABOUT content in uploaded papers/files:
- "What power analysis **did they report** in this paper?"
- "What were the findings?"
- "What sample size **did they use**?"
- "What is the ICC value **reported**?"
- "Summarize the methods"
- "What effect size **did they find**?"
- **Pattern:** Asking ABOUT existing analysis/results in uploaded PDF (reading, not computing or searching)

### 🧮 READY_FOR_CALCULATION MODE (Trigger coding agent):
Use when user wants YOU to RUN new calculations:
- "**Calculate power** for MY study with n=100"
- "**Calculate power** in this paper" (extract parameters, run calculations)
- "**Calculate sample size** for this study" (extract parameters, run calculations)
- "What sample size do I need for MY RCT?"
- "Run power analysis for MY data"
- "Analyze this dataset"
- **Pattern:** Asking to CREATE new analysis OR requesting power/sample size calculations

**CRITICAL DECISION RULES:**

1. **EXCEPTION: Power/Sample Size Calculations ALWAYS require code execution:**
   - ✅ "calculate power [of/for/in] this paper" → READY_FOR_CALCULATION
   - ✅ "calculate sample size [of/for/in] this paper" → READY_FOR_CALCULATION
   - ✅ "run power analysis [for/on] this study" → READY_FOR_CALCULATION
   - ✅ "do power analysis [on/for] their methods" → READY_FOR_CALCULATION
   - ✅ "conduct power analysis [of/for] their analysis" → READY_FOR_CALCULATION
   - ✅ "calculate the power of the analysis" → READY_FOR_CALCULATION
   - ✅ "perform power analysis on this study" → READY_FOR_CALCULATION
   - **Reason:** Power analysis ALWAYS requires actual R computation, not just reading. Extract paper's parameters and run calculations.
   - **Keywords that ALWAYS trigger READY_FOR_CALCULATION:** "calculate power", "do power", "run power", "conduct power", "perform power", "calculate sample size"

2. **Key Phrase Detection (General Rules):**
   - If query contains "in this paper" / "in the paper" / "in the study" → Usually CONSULTATION
   - If query contains "for my study" / "for my data" / "for my trial" → READY_FOR_CALCULATION
   - **BUT:** Power/sample size calculation keywords override this (see Exception above)

3. **Examples to distinguish (these are patterns, not exact queries):**
   - ✅ "calculate power in this paper" → READY_FOR_CALCULATION (Exception: power analysis needs computation)
   - ✅ "calculate sample size for this study" → READY_FOR_CALCULATION (Exception: needs computation)
   - ❌ "what sample size did they use?" → CONSULTATION (just reading, not computing)
   - ❌ "what [analysis/metric] did they do?" → CONSULTATION (asking ABOUT paper)
   - ❌ "what was the [result]?" → CONSULTATION (asking ABOUT paper)
   - ✅ "[calculate/find] [metric] for my study" → READY_FOR_CALCULATION (user's new analysis)
   - ✅ "what [metric] do I need for my study?" → READY_FOR_CALCULATION (user's analysis)

4. **The word "calculate" alone does NOT always mean calculation request:**
   - ❌ "calculate the p-value in this paper" = asking what p-value they reported (CONSULTATION)
   - ✅ "calculate power in this paper" = run power calculations using paper's parameters (READY_FOR_CALCULATION - Exception)
   - ✅ "calculate [something] for my study" = asking to RUN new calculation (READY_FOR_CALCULATION)

## Domain Expertise

You have mastery of:
- **Study Designs**: RCTs, observational studies, cluster trials, longitudinal, crossover, etc.
- **Statistical Methods**: t-tests, ANOVA, regression (linear, logistic, Cox), mixed models, survival analysis
- **Power Analysis**: Classical (pwr), simulation (simr), prediction models (pmsampsize)
- **Clinical Trials**: Phase I/II/III designs, superiority, non-inferiority, equivalence
- **Sample Size Factors**: Effect size, power, alpha, correlation, ICC, attrition, clustering

**Comprehensive R Package Knowledge (ALL 43 PRE-INSTALLED):**

**Basic Power Analysis:**
- pwr: t-tests, ANOVA, correlation, regression power
- pwrss: Extended power (unbalanced, covariates, logistic/Poisson)

**Mixed Effects & Longitudinal:**
- lme4, simr, lmerTest: Mixed model power simulation
- nlme: Nonlinear mixed effects (alternative to lme4)

**Survival Analysis:**
- survival, powerSurvEpi: Cox regression, Kaplan-Meier, log-rank tests
- pracma: Numerical methods (dependency)

**Cluster Randomized Trials:**
- clusterPower, CRTSize, swdpwr: Parallel and stepped-wedge CRT designs

**Specialized Designs:**
- pmsampsize: Prediction model sample size (Riley's criteria)
- TrialSize: Equivalence, non-inferiority, superiority
- longpower: Longitudinal/repeated measures
- gsDesign, rpact: Group sequential and adaptive designs
- powerMediation: Mediation analysis power
- WebPower, MKpower, presize: Comprehensive power/precision-based methods

**Harrell's Regression Framework:**
- rms: Regression Modeling Strategies (logistic, ordinal, Cox, validation, nomograms)
- Hmisc: Data manipulation, description, labeling
- ordinal: Ordinal regression models (proportional odds)

**Data & Visualization:**
- ggplot2, lattice: Publication-quality graphics
- data.table: Fast data manipulation
- knitr, qreport: Reproducible reporting

**Statistics & Computing:**
- MASS: Robust methods, negative binomial, multivariate stats
- parallel, foreach, doParallel: Parallel computing for simulations

**ALL packages are pre-installed - no installation delays expected for 95%+ of queries.**

## Web Search Tools Available

You have access to web search tools for research and literature questions:

### Tavily Search (Quick Discovery)
- **tavily_r_documentation_search**: R package documentation, CRAN, statistical methods
- **tavily_medical_search**: Medical literature from PubMed, NEJM, JAMA, Lancet, BMJ

Use Tavily when you need to quickly find relevant sources, typical values, or literature references.

### Firecrawl Extract (Deep Content)
- **firecrawl_scrape**: Extract full content from a specific URL

**Usage Pattern (2-step approach for comprehensive research):**
1. Use Tavily to search and discover relevant URLs
2. If you find a particularly relevant source but need more detail, use Firecrawl to extract the full article content

**Example:** User asks "What ICC should I assume for cluster trials in diabetes?"
1. First, use tavily_medical_search to find relevant papers
2. If Tavily returns a highly relevant paper URL but only snippet, use firecrawl_scrape to get full text

## Critical Information Checklist

Before proceeding to calculation, verify you have:

### For Comparison Studies (t-test, ANOVA, etc.)
- ✓ Study design (independent/paired, # of groups)
- ✓ Expected effect size (mean difference, Cohen's d, OR, etc.)
- ✓ Standard deviation or variance estimate
- ✓ Desired power (default: 80%)
- ✓ Significance level (default: 0.05)
- ✓ One-sided vs two-sided test

### For Regression Models
- ✓ Outcome type (continuous, binary, count, time-to-event)
- ✓ Number of predictors
- ✓ Expected R² or effect size
- ✓ Correlation between predictors (if relevant)

### For Mixed Models / Longitudinal
- ✓ Number of time points or measurements
- ✓ ICC (intracluster correlation)
- ✓ Expected effect over time
- ✓ Correlation structure (AR1, compound symmetry, etc.)

### For Prediction Models
- ✓ Model type (diagnostic, prognostic)
- ✓ Number of predictors
- ✓ Expected C-statistic or R²
- ✓ Outcome prevalence (for binary)
- ✓ Shrinkage factor (default: 0.9)

## Response Modes

### Mode 1: NEEDS_INFO (Missing Critical Information)
**Use sparingly** - Only when core information is truly missing and cannot be reasonably assumed.

Examples of when to use NEEDS_INFO:
- User says "I need sample size" but doesn't specify study design (RCT? observational? cluster trial?)
- User mentions "comparing groups" but no indication of what outcome or effect they expect
- User asks about "power analysis" but unclear if planning new study or analyzing existing data

Examples of when NOT to use NEEDS_INFO (proceed with defaults instead):
- User specifies effect size but not power → assume power=0.80
- User specifies study design but not alpha level → assume alpha=0.05, two-sided
- User mentions CRT but not ICC value → agent can use literature defaults (0.01-0.05) and note assumptions
- User asks about sample size for "medium effect" → proceed with Cohen's d=0.5

When essential parameters are missing, respond with:

\`\`\`json
{
  "mode": "needs_info",
  "reasoning": "Missing critical parameters for sample size calculation",
  "missing_info": [
    {
      "parameter": "effect_size",
      "question": "What effect size do you expect between groups?",
      "help": "This could be mean difference (e.g., 5 mmHg), Cohen's d (e.g., 0.5 for medium effect), or relative risk/odds ratio",
      "typical_values": "Small: 0.2, Medium: 0.5, Large: 0.8 (Cohen's d)"
    },
    {
      "parameter": "standard_deviation",
      "question": "What is the expected standard deviation of the outcome?",
      "help": "Estimate from pilot data or literature. For blood pressure, typically 10-15 mmHg.",
      "typical_values": null
    }
  ],
  "context_summary": "User wants to compare two groups but hasn't specified effect size or variability"
}
\`\`\`

### Mode 2: RESEARCH (Scientific Literature / Web Search)
**NEW MODE for research/literature questions:**

When user asks scientific questions that require web search for typical values or literature norms:
- "What ICC should I assume for...?"
- "What are typical effect sizes for...?"
- "What dropout rate is reasonable for...?"
- "What values are commonly reported in literature?"

**CRITICAL REQUIREMENT:** For RESEARCH mode, you MUST:
1. **Use the tavily_search tool** to find literature sources, published ICCs, typical values
2. **Search for specific values** - ICC estimates, effect sizes, sample sizes from published studies
3. **Put comprehensive answer in "reasoning" field** with citations and specific numeric values
4. **Provide actionable recommendations** - point estimates with ranges for sensitivity analysis
5. **Use web_search_required: true** flag

**Example for "What ICC should we assume for HbA1c in UK primary care?":**
\`\`\`json
{
  "mode": "research",
  "reasoning": "Based on published literature search: [DETAILED FINDINGS FROM WEB SEARCH - typical ICC values for HbA1c in UK primary care cluster trials, citing specific studies with numeric ICC values, ranges, and recommendations for sensitivity analysis]",
  "summary": "ICC values for HbA1c in UK primary care typically range from 0.01 to 0.05",
  "web_search_required": true,
  "search_query": "HbA1c ICC intracluster correlation UK primary care cluster randomized trial",
  "can_proceed_to_calculation": false
}
\`\`\`

### Mode 3: CONSULTATION (Answer from PDF Content OR Design Guidance)
**CRITICAL:** Use CONSULTATION mode in TWO scenarios:

**A) Content Questions About Uploaded Papers (MOST COMMON):**
When user asks ABOUT content in uploaded PDF/document:
- "What power analysis is in this paper?"
- "What sample size did they use?"
- "What were the findings?"
- "Calculate the power of the analysis in this paper"

**CRITICAL REQUIREMENT:** When user asks ABOUT content in uploaded PDF, you MUST:
1. **Extract the detailed answer** from the PDF content provided in the "UPLOADED FILES" section
2. **Put the complete answer in the "reasoning" field** - this will be displayed directly to the user
3. **Include specific numbers, values, findings** from the paper (sample sizes, effect sizes, power values, statistical methods, results, etc.)
4. **Make it informative and complete** - the reasoning field should be a full answer (200+ characters), not just a statement

**Example for "calculate the power of the analysis in this paper":**
\`\`\`json
{
  "mode": "consultation",
  "reasoning": "Based on the TRANSFORM-HF study in the uploaded paper: [DETAILED EXTRACTION FROM PDF CONTENT - explain what power analysis was done, what sample size was used, what assumptions were made, what the actual power achieved was, what statistical methods were used, what results were found. Extract ALL relevant details from the PDF content provided. Make this a comprehensive answer that the user can read directly.]",
  "summary": "Brief summary of key findings",
  "can_proceed_to_calculation": false
}
\`\`\`

**IMPORTANT:** The "reasoning" field for consultation mode MUST contain the actual extracted answer from the PDF. DO NOT just say "user is asking about..." - instead, EXTRACT and PROVIDE the actual information from the PDF content.

**B) Design Consultation (Exploratory Questions):**
When user needs guidance on study design rather than calculation:

\`\`\`json
{
  "mode": "consultation",
  "reasoning": "User is exploring design options, not requesting specific calculation",
  "recommendations": [
    {
      "option": "Cluster Randomized Trial",
      "rationale": "Best for hospital-level intervention where individual randomization isn't feasible",
      "considerations": "Need to account for ICC, may need larger sample size",
      "when_to_use": "Intervention is at cluster (hospital) level"
    }
  ],
  "follow_up": "Which design matches your study context?",
  "can_proceed_to_calculation": false
}
\`\`\`

### Mode 4: READY_FOR_CALCULATION
When all information is available:

\`\`\`json
{
  "mode": "ready_for_calculation",
  "reasoning": "All required parameters provided",
  "summary": "Two-sample t-test, effect size d=0.5, power=0.80, alpha=0.05",
  "confirmed_parameters": {
    "test_type": "two-sample t-test",
    "effect_size": 0.5,
    "power": 0.80,
    "alpha": 0.05,
    "tails": 2
  },
  "proceed_to_agent": true
}
\`\`\`

### Mode 5: CLARIFICATION (Ambiguous Request - USE CONTEXT!)
**IMPORTANT:** Use clarification mode ONLY when request is truly ambiguous AND you have the PDF/file context.
Ask SPECIFIC questions based on what's IN the uploaded file, not generic questions.

**BAD Example** (generic, not helpful):
{
  "mode": "clarification",
  "question": "Could you clarify what you're trying to determine?"
}

**GOOD Example** (specific, actionable, uses PDF context):
{
  "mode": "clarification",
  "reasoning": "Request '[query pattern]' is ambiguous. Based on [paper name] content, this could mean:",
  "interpretations": [
    "1. [Interpretation 1 based on paper content]",
    "2. [Interpretation 2 based on paper content]",
    "3. [Interpretation 3 if applicable]"
  ],
  "question": "I see you uploaded [paper name] which reports [specific values from paper]. Which would you like?\n\n1. [Option 1 based on paper]\n2. [Option 2 based on paper]\n3. Something else - please specify",
  "specific_context": "Paper reports: [relevant values, sample sizes, parameters from the uploaded document]"
}

**Rules for Clarification Mode:**
- MUST reference specific content from uploaded PDF
- MUST offer numbered options based on PDF content
- MUST be actionable - user can choose 1, 2, or 3
- If NO file uploaded, use needs_info mode instead

## Web Search Integration

Use the \`tavily_search\` tool to:
- Understand unfamiliar medical terms or outcomes
- Find typical effect sizes from literature
- Research specific R packages or methods
- Understand clinical context

## Session Context Awareness

Always consider:
- Previous messages in this conversation
- User's apparent expertise level
- Whether this is exploratory or a specific calculation request
- Build on previous answers, don't repeat

## Critical Rules

1. **Use reasonable defaults when appropriate** - Common parameters (power=0.80, alpha=0.05, two-sided tests) can be assumed if not specified. Only ask if truly ambiguous.
2. **Be pragmatic about missing info** - If the core study design is clear, proceed with standard assumptions. Don't block on optional details.
3. **Only use NEEDS_INFO for critical gaps** - Missing effect size, study design type, or outcome measure warrants asking. Missing details like "exact ICC value" or "correlation structure" can use literature defaults.
4. **Be consultative for exploratory questions** - Use CONSULTATION mode when user is brainstorming or asking "what should I do?"
5. **Provide actionable guidance** - Clear next steps for user
6. **Search when uncertain** - Use Tavily to find typical values, understand clinical context, or research methods
7. **Respect user's context** - Don't ask for info they already provided in files or previous messages
8. **Be professional but approachable** - Think "senior colleague consultation"
9. **Favor progression over perfection** - If the agent can produce a useful analysis with reasonable assumptions, let it proceed. Users can always refine later.
10. **IGNORE POLITE OPTIONAL QUESTIONS** - If the intro message asks "would you also like..." or "please confirm whether..." about optional extras (like sensitivity analyses), IGNORE IT. Those are polite add-ons, not missing critical information. Return READY_FOR_CALCULATION if core parameters are present.
11. **CLARIFICATION IS LAST RESORT** - Only use CLARIFICATION mode when the query is TRULY ambiguous and you cannot determine intent even with full PDF content. If you have PDF content available and the query asks about something in the paper (e.g., "what power analysis", "what sample size", "what were the findings"), you MUST use CONSULTATION mode and answer directly from the PDF. Do NOT use CLARIFICATION just because you're uncertain - read the PDF content carefully first.
12. **CLARIFICATION MUST USE PDF CONTEXT** - If you MUST use clarification mode, you MUST reference specific values/content from the uploaded PDF. Generic questions like "what do you mean?" are NOT allowed. Extract ICC values, sample sizes, study parameters from the preliminary analysis and use them in your question.
13. **OFFER SPECIFIC NUMBERED OPTIONS** - When clarifying, give 2-3 specific interpretations with concrete examples from the PDF (e.g., "1. Calculate precision of ICC estimate, 2. Plan new trial using ICC value from paper")
14. **READ FULL CONTENT CAREFULLY** - You now have access to up to 35k characters of PDF content. This includes abstract, methods, results sections. Before deciding to ask for clarification, carefully search the provided content for the answer. Power analysis, sample size calculations, statistical methods are usually in Methods or Results sections.

## Output Format

Respond ONLY with valid JSON matching one of the 5 response modes above:
1. needs_info - Missing critical parameters
2. research - Scientific/literature questions requiring web search
3. consultation - Questions about uploaded PDF content or design guidance
4. ready_for_calculation - All info available, proceed to coding agent
5. clarification - Truly ambiguous request (use sparingly with context)

Do NOT include markdown code fences, just raw JSON.`;

/**
 * Analyze query and determine if ready for calculation or needs more info/consultation
 *
 * @param {string} query - User's query
 * @param {Array} sessionHistory - Previous messages in this session
 * @param {string} sessionFilesContext - Context about uploaded files in this session (IMPORTANT!)
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} Analysis result with mode and next action
 */
export async function analyzeQuery(query, sessionHistory = [], sessionFilesContext = '', options = {}) {
  console.log('[Chatbot Domain Expert] Analyzing query...');

  // Build context-aware prompt
  let contextPrompt = '';

    // CRITICAL: Check session files FIRST - user may have uploaded papers with preliminary analysis
    // NOTE: sessionFilesContext might be empty if files are in requestSessionFiles but not yet processed
    // We still have access to query patterns to determine intent
    if (sessionFilesContext) {
    // SMART TRUNCATION: 
    // 1. Always include preliminary analysis (usually first in context)
    // 2. Include as much full content as possible (up to 30k chars = ~7500 tokens, safe limit)
    // 3. For content questions, we need full document access
    
    let truncatedContext = sessionFilesContext;
    const maxLength = 45000; // Increased to 45k chars (≈11,250 tokens) - allows full paper content
    
    if (sessionFilesContext.length > maxLength) {
      // Try to preserve the preliminary analysis section (usually at the start)
      const prelimMatch = sessionFilesContext.match(/\*\*Preliminary Analysis:\*\*[\s\S]*?(?=\*\*Full Document Content|\*\*Local Path|$)/i);
      
      if (prelimMatch && prelimMatch[0].length < maxLength) {
        // Include full preliminary analysis + start of full content
        const prelimSection = prelimMatch[0];
        const remainingChars = maxLength - prelimSection.length - 500; // Reserve 500 for markers
        const contentStart = sessionFilesContext.indexOf('**Full Document Content');
        
        if (contentStart > 0 && remainingChars > 0) {
          const contentSection = sessionFilesContext.substring(contentStart, contentStart + remainingChars);
          truncatedContext = prelimSection + '\n\n' + contentSection + '\n\n... [Content truncated - document continues]';
        } else {
          truncatedContext = sessionFilesContext.substring(0, maxLength) + '\n\n... [Content truncated for processing - full document available to downstream agents]';
        }
      } else {
        // Simple truncation but keep note about full content
        truncatedContext = sessionFilesContext.substring(0, maxLength) + '\n\n... [Content truncated for processing - full document available to downstream agents]';
      }
    }

    console.log(`[Chatbot Domain Expert] Session files context: ${sessionFilesContext.length} chars -> ${truncatedContext.length} chars`);

    contextPrompt += '\n\n## UPLOADED FILES IN THIS SESSION (CHECK FIRST!):\n\n';
    contextPrompt += truncatedContext;
    contextPrompt += '\n\n**CRITICAL INSTRUCTION FOR CONSULTATION MODE:**\n';
    contextPrompt += 'If the user uploaded a PDF/document and asks ABOUT content (e.g., "what power analysis", "what sample size", "calculate power in this paper"), you MUST:\n';
    contextPrompt += '1. Search the PDF content above for the answer\n';
    contextPrompt += '2. Extract ALL relevant details (numbers, values, methods, findings)\n';
    contextPrompt += '3. Put the COMPLETE extracted answer in the "reasoning" field (NOT just a statement like "user is asking about...")\n';
    contextPrompt += '4. The reasoning field must be 200+ characters with actual information extracted from the PDF\n';
    contextPrompt += '5. Use CONSULTATION mode (NOT clarification) when you can extract the answer from the PDF\n';
    contextPrompt += '6. Only use CLARIFICATION if the query is truly ambiguous even after reading the PDF content\n\n';
  }

  if (sessionHistory.length > 0) {
    contextPrompt += '\n\n## Previous Conversation Context:\n\n';
    sessionHistory.slice(-5).forEach((msg, idx) => {
      contextPrompt += `**${msg.role === 'user' ? 'User' : 'Assistant'} (${idx + 1}):**\n${msg.content}\n\n`;
    });
    contextPrompt += 'Use this context to avoid asking for information already provided.\n\n';
  }

  const userPrompt = `${contextPrompt}## Current Query:\n\n"${query}"\n\n**DECISION LOGIC:**
- Does query ask for typical/literature values WITHOUT uploaded paper? (e.g., "What ICC should I assume?", "What are typical effect sizes?") → **RESEARCH** (use web search)
- Does query ask ABOUT content in uploaded paper? (e.g., "in this paper", "in the study") → CONSULTATION
- Does query ask to RUN NEW calculation? (e.g., "for my study", "calculate power", "calculate sample size") → READY_FOR_CALCULATION
- If truly ambiguous AND has PDF context → CLARIFICATION (with numbered options)
- If missing critical info → NEEDS_INFO

**CRITICAL: Research questions should trigger RESEARCH mode with web search, NOT rejection or clarification!**

Analyze this query and respond with the appropriate mode.`;

  console.log(`[Chatbot Domain Expert] Total prompt length: ${userPrompt.length} chars`);
  console.log(`[Chatbot Domain Expert] Calling Claude API...`);

  try {
    // Call Claude with web search capability and timeout
    const timeoutMs = 30000; // 30 second timeout
    const apiCallPromise = callAnthropicWithRetry({
      model: 'claude-opus-4-6',  // Sonnet 4.6 for best reasoning
      max_tokens: 2000,
      temperature: 0.3,  // Lower temperature for consistent analysis
      system: DOMAIN_EXPERT_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: userPrompt
        }
      ],
      tools: [
        tavilySearchTool.getClaudeToolDefinition('statistical'),
        tavilySearchTool.getClaudeToolDefinition('medical'),
        firecrawlTool.getClaudeToolDefinition()
      ]
    });

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Domain expert analysis timeout after 30s')), timeoutMs)
    );

    let currentResponse = await Promise.race([apiCallPromise, timeoutPromise]);
    console.log(`[Chatbot Domain Expert] Claude API response received`);

    // Handle multi-turn tool use (Tavily search, then optionally Firecrawl extraction)
    let finalResponse = currentResponse;
    let searchUsed = false;
    let messages = [{ role: 'user', content: userPrompt }];
    const MAX_TOOL_ROUNDS = 3; // Limit to prevent infinite loops
    let toolRound = 0;

    while (currentResponse.content.some(block => block.type === 'tool_use') && toolRound < MAX_TOOL_ROUNDS) {
      toolRound++;
      console.log(`[Chatbot Domain Expert] Agent requested tools (round ${toolRound})...`);
      searchUsed = true;

      // CRITICAL: Every tool_use MUST have a corresponding tool_result
      const toolResults = [];
      for (const block of currentResponse.content) {
        if (block.type === 'tool_use') {
          try {
            if (block.name.startsWith('tavily_')) {
              const searchQuery = block.input.query;
              console.log(`[Chatbot Domain Expert]    Searching: "${searchQuery}"`);

              // Determine search type based on tool name
              let searchResult;
              if (block.name === 'tavily_medical_search') {
                searchResult = await tavilySearchTool.searchMedical(searchQuery);
              } else if (block.name === 'tavily_r_documentation_search') {
                searchResult = await tavilySearchTool.searchRDocumentation(searchQuery);
              } else {
                searchResult = await tavilySearchTool.search(searchQuery);
              }

              // CRITICAL: tool_result content must be a string, not an object
              const formattedContent = typeof searchResult === 'object'
                ? JSON.stringify(searchResult, null, 2)
                : String(searchResult);
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: formattedContent
              });
              console.log(`[Chatbot Domain Expert]    Tavily returned ${searchResult.results?.length || 0} results`);
            } else if (block.name === 'firecrawl_scrape') {
              // Firecrawl deep content extraction
              const url = block.input.url;
              const onlyMainContent = block.input.only_main_content !== false;
              console.log(`[Chatbot Domain Expert]    Extracting content from: ${url}`);

              const scrapeResult = await firecrawlTool.scrape(url, { onlyMainContent });

              // Format for LLM consumption (truncate if too long)
              const formattedContent = firecrawlTool.formatForAgent(scrapeResult, 10000);
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: formattedContent
              });
              console.log(`[Chatbot Domain Expert]    Firecrawl extracted ${scrapeResult.markdown?.length || 0} chars`);
            } else {
              // Unknown tool - still must provide tool_result
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: `Error: Unknown tool "${block.name}".`
              });
            }
          } catch (toolError) {
            // CRITICAL: Even on error, provide tool_result
            console.error(`[Chatbot Domain Expert] Tool error:`, toolError.message);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: `Error: ${toolError.message}`,
              is_error: true
            });
          }
        }
      }

      // Update messages with assistant response and tool results
      messages.push({ role: 'assistant', content: currentResponse.content });
      messages.push({ role: 'user', content: toolResults });

      // Get next response - may be final text or another tool request
      currentResponse = await callAnthropicWithRetry({
        model: 'claude-opus-4-6',  // Sonnet 4.6
        max_tokens: 2000,
        temperature: 0.3,
        system: DOMAIN_EXPERT_SYSTEM_PROMPT,
        messages: messages,
        tools: [
          tavilySearchTool.getClaudeToolDefinition('statistical'),
          tavilySearchTool.getClaudeToolDefinition('medical'),
          firecrawlTool.getClaudeToolDefinition()
        ]
      });

      finalResponse = currentResponse;
      console.log(`[Chatbot Domain Expert] Got response after tool round ${toolRound}`);
    }

    if (toolRound >= MAX_TOOL_ROUNDS) {
      console.log(`[Chatbot Domain Expert] Reached max tool rounds (${MAX_TOOL_ROUNDS}), proceeding with current response`);
    }

    // If final response still has tool_use but no text, force a final call WITHOUT tools
    let textBlock = finalResponse.content.find(block => block.type === 'text');
    if (!textBlock && finalResponse.content.some(block => block.type === 'tool_use')) {
      console.log(`[Chatbot Domain Expert] Final response has tool_use but no text, making forced text call...`);

      // Provide dummy tool results for any pending tool_use
      const dummyToolResults = [];
      for (const block of finalResponse.content) {
        if (block.type === 'tool_use') {
          dummyToolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: 'Search limit reached. Use the information already gathered.',
            is_error: true
          });
        }
      }

      // Update messages and make final call WITHOUT tools
      messages.push({ role: 'assistant', content: finalResponse.content });
      messages.push({ role: 'user', content: dummyToolResults });

      // Add explicit instruction to return JSON - VERY STRICT
      messages.push({
        role: 'user',
        content: `STOP. You have gathered enough information from web searches.

NOW you MUST respond with ONLY a valid JSON object. No explanation, no preamble, no "Based on..." text.

Your response must start with { and end with }

Required format:
{
  "mode": "research",
  "reasoning": "[Put your complete findings here including all ICC values, citations, and recommendations]",
  "summary": "[Brief one-line summary]",
  "web_search_used": true,
  "can_proceed_to_calculation": false
}

START YOUR RESPONSE WITH { CHARACTER NOW:`
      });

      finalResponse = await callAnthropicWithRetry({
        model: 'claude-opus-4-6',
        max_tokens: 3000,
        temperature: 0.3,
        system: DOMAIN_EXPERT_SYSTEM_PROMPT,
        messages: messages
        // NO tools parameter - forces text response
      });

      textBlock = finalResponse.content.find(block => block.type === 'text');
      console.log(`[Chatbot Domain Expert] Forced text call completed, got ${textBlock ? 'text' : 'no text'}`);
    }

    // Extract JSON response
    if (!textBlock) {
      throw new Error('No text response from domain expert - Claude returned empty response');
    }

    // Parse JSON (handle potential markdown code fences and narrative text)
    let jsonText = textBlock.text.trim();

    // First try: extract from markdown code fence
    if (jsonText.includes('```json')) {
      const jsonMatch = jsonText.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        jsonText = jsonMatch[1].trim();
      }
    } else if (jsonText.includes('```')) {
      const codeMatch = jsonText.match(/```\s*([\s\S]*?)\s*```/);
      if (codeMatch) {
        jsonText = codeMatch[1].trim();
      }
    }

    // Second try: find JSON object if text starts with narrative
    if (!jsonText.startsWith('{')) {
      const jsonObjectMatch = jsonText.match(/\{[\s\S]*"mode"\s*:\s*"[^"]+"/);
      if (jsonObjectMatch) {
        // Find the complete JSON object by matching braces
        const startIdx = jsonText.indexOf(jsonObjectMatch[0]);
        let braceCount = 0;
        let endIdx = startIdx;
        for (let i = startIdx; i < jsonText.length; i++) {
          if (jsonText[i] === '{') braceCount++;
          else if (jsonText[i] === '}') {
            braceCount--;
            if (braceCount === 0) {
              endIdx = i + 1;
              break;
            }
          }
        }
        jsonText = jsonText.substring(startIdx, endIdx);
      }
    }

    let analysis;
    try {
      analysis = JSON.parse(jsonText);
    } catch (parseError) {
      console.error('[Chatbot Domain Expert] JSON parse error:', parseError.message);
      console.error('[Chatbot Domain Expert] Response text (first 500 chars):', textBlock.text.substring(0, 500));
      throw new Error(`Failed to parse Domain Expert JSON response: ${parseError.message}. Response preview: ${jsonText.substring(0, 200)}`);
    }
    
    // Validate analysis object has required fields
    if (!analysis.mode) {
      throw new Error(`Domain Expert response missing 'mode' field. Response: ${JSON.stringify(analysis)}`);
    }
    
    analysis.web_search_used = searchUsed;

    // NO FALLBACKS - Let LLM decision stand as-is for honest testing
    // If LLM makes wrong decision, we fix the SYSTEM PROMPT, not add workarounds
    console.log(`[Chatbot Domain Expert] Analysis complete: mode=${analysis.mode}`);
    return analysis;

  } catch (error) {
    console.error('[Chatbot Domain Expert] Error:', error.message);
    console.error('[Chatbot Domain Expert] Error stack:', error.stack);
    console.error('[Chatbot Domain Expert] Query:', query);
    console.error('[Chatbot Domain Expert] Session files context length:', sessionFilesContext.length);
    
    // CRITICAL: Re-throw error so caller knows Domain Expert failed
    // Don't silently fall back to calculation - caller should handle gracefully
    throw error;
  }
}

/**
 * Load previous messages from session for context
 *
 * @param {string} sessionId - Session UUID
 * @returns {Promise<Array>} Previous messages
 */
export async function loadSessionContext(sessionId) {
  if (!sessionId || sessionId.startsWith('local-')) {
    return [];
  }

  try {
    const { data, error } = await supabase
      .from('messages')
      .select('role, content, created_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true })
      .limit(10);  // Last 10 messages

    if (error) {
      console.warn('[Chatbot Domain Expert] Could not load session context:', error.message);
      return [];
    }

    return (data || []).map(msg => ({
      role: msg.role,
      content: msg.content
    }));
  } catch (err) {
    console.warn('[Chatbot Domain Expert] Error loading context:', err.message);
    return [];
  }
}

/**
 * Generate friendly chatbot response based on analysis mode
 *
 * @param {Object} analysis - Analysis result from analyzeQuery
 * @returns {string} User-friendly response text
 */
export function generateChatbotResponse(analysis) {
  switch (analysis.mode) {
    case 'needs_info':
      let response = `To calculate the sample size accurately, I need a bit more information:\n\n`;
      analysis.missing_info.forEach((item, idx) => {
        response += `${idx + 1}. **${item.question}**\n`;
        if (item.help) {
          response += `   ${item.help}\n`;
        }
        if (item.typical_values) {
          response += `   Typical values: ${item.typical_values}\n`;
        }
        response += `\n`;
      });
      response += `\nOnce you provide these details, I can calculate the exact sample size you need!`;
      return response;

    case 'research':
      // RESEARCH mode: Scientific literature/web search questions
      // The reasoning field should contain web search findings with specific values
      let researchResponse = '';

      // Add web search indicator if used
      if (analysis.web_search_used) {
        researchResponse += `🔍 **Based on literature search:**\n\n`;
      }

      // Primary content from reasoning (contains web search findings)
      if (analysis.reasoning && analysis.reasoning.length > 100) {
        researchResponse += analysis.reasoning.trim();
      } else {
        // Fallback if reasoning is short
        researchResponse += analysis.reasoning || 'Research findings:';
      }

      // Add summary if available and different from reasoning
      if (analysis.summary && !researchResponse.includes(analysis.summary)) {
        researchResponse += `\n\n**Summary:** ${analysis.summary}`;
      }

      // Add recommendations if available
      if (analysis.recommendations && Array.isArray(analysis.recommendations)) {
        researchResponse += `\n\n**Recommendations:**\n`;
        analysis.recommendations.forEach((rec, idx) => {
          researchResponse += `${idx + 1}. ${rec}\n`;
        });
      }

      return researchResponse || 'Based on the literature, here are the findings...';

    case 'consultation':
      // CRITICAL FIX: For content questions about uploaded papers, prioritize reasoning/summary
      // The reasoning from Domain Expert often contains the answer extracted from PDF
      
      // First, check if we have substantial reasoning (likely contains PDF-derived answer)
      if (analysis.reasoning && analysis.reasoning.length > 100) {
        // This is likely a content question with PDF-derived answer
        // Use reasoning as it contains the extracted answer
        let consult = analysis.reasoning.trim();
        
        // If reasoning is substantial (good answer), use it as primary content
        if (consult.length > 200) {
          // Add summary if available and not already included
          if (analysis.summary && !consult.includes(analysis.summary)) {
            consult += `\n\n${analysis.summary}`;
          }
          return consult;
        }
      }
      
      // If reasoning exists but is short, still use it as base
      let consult = analysis.reasoning ? analysis.reasoning.trim() : '';
      
      // Add summary/context_summary if available
      if (analysis.summary || analysis.context_summary) {
        const summaryText = analysis.summary || analysis.context_summary || '';
        if (summaryText && !consult.includes(summaryText)) {
          consult = consult ? `${consult}\n\n${summaryText}` : summaryText;
        }
      }
      
      // If we have a good consultation response so far, return it
      if (consult && consult.length > 50) {
        return consult;
      }
      
      // For design consultation with recommendations
      if (analysis.recommendations && analysis.recommendations.length > 0) {
        consult = consult ? `${consult}\n\n` : '';
        consult += `Great question! Let me share my recommendations:\n\n`;
        analysis.recommendations.forEach((rec, idx) => {
          consult += `### ${idx + 1}. ${rec.option}\n\n`;
          consult += `**Why this works:** ${rec.rationale}\n\n`;
          consult += `**Key considerations:** ${rec.considerations}\n\n`;
          consult += `**When to use:** ${rec.when_to_use}\n\n`;
        });
        if (analysis.follow_up) {
          consult += `\n${analysis.follow_up}`;
        }
        return consult;
      }
      
      // Final fallback: Provide informative response based on available info
      if (consult && consult.length > 0) {
        return consult;
      }
      
      // Last resort: Provide informative fallback based on what we know
      if (analysis.reasoning) {
        return analysis.reasoning;
      }

      // If we have PDF context but no specific answer, provide actionable guidance
      return 'I can help you with questions about the uploaded paper. Please ask a more specific question, such as:\n\n' +
             '- "What power/sample size did they report?"\n' +
             '- "What statistical methods did they use?"\n' +
             '- "What were their key findings?"\n' +
             '- "Calculate power for their analysis" (to run computations)\n\n' +
             'Or if you want me to calculate something, use phrases like "calculate", "compute", or "run analysis".';

    case 'ready_for_calculation':
      return `Perfect! I have all the information needed. Here's what I'll calculate:\n\n${analysis.summary}\n\nLet me run the analysis now...`;

    case 'clarification':
      // CRITICAL FIX: Make clarification informative, not generic
      // Always include reasoning (contains PDF context) and make it actionable
      let clarify = '';
      
      // Start with reasoning if available (contains PDF-derived context)
      if (analysis.reasoning && analysis.reasoning.length > 100) {
        clarify += `${analysis.reasoning}\n\n`;
      }
      
      // Add specific context from PDF if available
      if (analysis.specific_context) {
        clarify += `**From the uploaded paper:**\n${analysis.specific_context}\n\n`;
      }
      
      // Add numbered interpretations
      if (analysis.interpretations && analysis.interpretations.length > 0) {
        clarify += `I want to make sure I understand correctly. Your request could mean:\n\n`;
        analysis.interpretations.forEach((interp, idx) => {
          // Handle both string and object interpretations
          if (typeof interp === 'string') {
            clarify += `${idx + 1}. ${interp}\n`;
          } else if (interp.description) {
            clarify += `${idx + 1}. **${interp.description}**\n`;
            if (interp.details) {
              clarify += `   ${interp.details}\n`;
            }
          } else {
            clarify += `${idx + 1}. ${JSON.stringify(interp)}\n`;
          }
        });
      } else {
        // Fallback: Generate informative clarification from reasoning
        if (analysis.reasoning) {
          clarify += `To proceed, I need to clarify your intent:\n\n`;
          clarify += `Based on the uploaded document, I can help with:\n\n`;
          clarify += `1. **Answer questions about the analysis already conducted** - I can explain what power analysis was done, what sample size was used, what results were found, etc.\n`;
          clarify += `2. **Perform a new power analysis** - I can calculate sample size or power for YOUR study design using parameters from this paper or your own specifications\n`;
          clarify += `3. **Something else** - Please specify what you'd like to know\n\n`;
        }
      }
      
      // Add question if available
      if (analysis.question) {
        clarify += `\n${analysis.question}`;
      } else if (!analysis.interpretations || analysis.interpretations.length === 0) {
        // Fallback question
        clarify += `\n**Which would you like me to help with?**`;
      }
      
      // Ensure we always return something informative
      if (!clarify || clarify.length < 50) {
        clarify = `I want to make sure I help you correctly. Based on the uploaded document, could you clarify:\n\n`;
        clarify += `1. Are you asking about the power analysis that was already conducted in this paper?\n`;
        clarify += `2. Or do you want me to perform a new power analysis for your study?\n\n`;
        clarify += `Please let me know which applies, and I'll provide the appropriate assistance.`;
      }
      
      return clarify;

    default:
      return analysis.reasoning || 'Proceeding with analysis...';
  }
}

export default {
  analyzeQuery,
  loadSessionContext,
  generateChatbotResponse
};
