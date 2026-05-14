// PI Agent (Planning/Inference Agent) - Smart Query Router
// Routes queries to either direct answer or coding agent
// Uses Claude API for intelligent decision making

import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

// Load environment variables BEFORE creating client
dotenv.config();

// Lazy initialization - create client when first used (after dotenv loads)
function getAnthropicClient() {
  if (!global._anthropicClientPI) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY not set in environment. Please check your .env file.');
    }
    global._anthropicClientPI = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });
  }
  return global._anthropicClientPI;
}

const PI_AGENT_MODEL = 'claude-opus-4-6';  // Sonnet 4.6

/**
 * Analyze user query and decide routing strategy
 * @param {string} userQuery - The user's question/request
 * @param {Array} chatHistory - Recent conversation context
 * @param {string} sessionFilesContext - Extracted content from uploaded files (PDF/DOCX)
 * @returns {Object} Routing decision with reasoning
 */
export async function routeQuery(userQuery, chatHistory = [], sessionFilesContext = '') {
    const systemPrompt = `You are the Planning/Inference (PI) Agent for a biostatistics application.

Your role is to ANALYZE user queries and make ROUTING DECISIONS:

1. **DIRECT ANSWER**: ONLY for conceptual, theoretical, or guidance questions WITH NO CALCULATIONS
   - What is ICC?
   - Explain Type I vs Type II errors
   - When should I use paired t-test?
   - Show me the formula for Cohen's d (formula only, NO calculations)
   - What is the difference between fixed and random effects?

2. **CALL CODING AGENT**: For ANY calculations, numerical results, data analysis, simulations, or visualizations
   - Calculate sample size for CRT with 12 clusters, ICC=0.05
   - Run power analysis for t-test, n=100, effect=0.5
   - Analyze this dataset and show descriptive statistics
   - Create a power plot for different sample sizes
   - What is 2 + 2? (even simple math!)
   - How many subjects do I need? (requires calculation!)

🚨 CRITICAL ANTI-HALLUCINATION RULES:
1. NEVER provide numerical answers or calculations in direct_answer
2. If the query asks "how many", "calculate", "what is X when Y", "run analysis" → MUST call_coding_agent
3. Direct answers are ONLY for explaining concepts, definitions, and theory
4. If you're uncertain whether calculation is needed → call_coding_agent (be conservative!)
5. NEVER guess, estimate, or approximate numbers - only coding agent can provide actual results

DECISION RULES:
- Be VERY conservative: If user might want ANY numerical result, route to coding agent
- Consider context: Look at chat history for clues about user's intent
- If query contains parameters (n=100, ICC=0.05, etc.) → MUST call coding agent
- Mixed queries: ONLY provide conceptual explanation, then MUST route to coding for any numbers

RESPONSE FORMAT (JSON only):
{
  "decision": "direct_answer" | "call_coding_agent",
  "reasoning": "Brief explanation of why this decision was made",
  "confidence": 0.0-1.0,
  "requires": ["r"] | ["python"] | ["r", "python"] | null,
  "response": "Your CONCEPTUAL answer (NO NUMBERS, only if direct_answer)",
  "coding_plan": "Brief plan for coding agent (only if call_coding_agent)"
}

IMPORTANT: Return ONLY valid JSON, no markdown formatting, no extra text.`;

    const userPrompt = `Analyze this user query and decide how to respond:

User Query: "${userQuery}"

${chatHistory.length > 0 ? `Recent Chat History (last 3 messages):\n${JSON.stringify(chatHistory.slice(-3), null, 2)}` : 'No previous context.'}

${sessionFilesContext ? `\n\nUploaded Files and Extracted Content:\n${sessionFilesContext.substring(0, 15000)}` : 'No uploaded files.'}

Make your routing decision now. Return only JSON.`;

    try {
        const response = await getAnthropicClient().messages.create({
            model: PI_AGENT_MODEL,
            max_tokens: 2000,
            temperature: 0.3, // Lower temperature for more consistent routing
            system: systemPrompt,
            messages: [
                { role: 'user', content: userPrompt }
            ]
        });

        const responseText = response.content[0].text;

        // Parse JSON response
        let decision;
        try {
            decision = JSON.parse(responseText);
        } catch (parseError) {
            // If JSON parsing fails, try to extract JSON from markdown
            const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) || responseText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                decision = JSON.parse(jsonMatch[1] || jsonMatch[0]);
            } else {
                throw new Error('Could not parse PI agent response as JSON');
            }
        }

        // Validate decision structure
        if (!decision.decision || !['direct_answer', 'call_coding_agent'].includes(decision.decision)) {
            throw new Error('Invalid decision type from PI agent');
        }

        // Add metadata
        decision.timestamp = new Date().toISOString();
        decision.model = PI_AGENT_MODEL;

        console.log(`✅ PI Agent Decision: ${decision.decision} (confidence: ${decision.confidence})`);
        console.log(`   Reasoning: ${decision.reasoning}`);

        return decision;

    } catch (error) {
        console.error('❌ PI Agent Error:', error);

        // Fallback: Default to coding agent for safety
        return {
            decision: 'call_coding_agent',
            reasoning: 'Error in PI agent, defaulting to coding agent for safety',
            confidence: 0.5,
            requires: ['r'],
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
}

/**
 * Format coding agent results into user-friendly response
 * @param {string} userQuery - Original user question
 * @param {Object} codingResult - Results from coding agent
 * @param {Object} routingDecision - Original PI routing decision
 * @returns {string} Formatted response for user
 */
export async function formatCodingResult(userQuery, codingResult, routingDecision) {
    const systemPrompt = `You are the PI Agent formatting results from a coding agent for the user.

Your job is to:
1. Provide a clear, professional summary
2. Highlight key findings
3. Explain what the numbers mean
4. Add context and interpretation
5. Mention any important caveats or assumptions

Be concise but thorough. Use markdown for formatting.`;

    const userPrompt = `User asked: "${userQuery}"

Original routing plan: ${routingDecision.coding_plan || 'Run analysis'}

Coding agent produced these results:
${JSON.stringify(codingResult, null, 2)}

Format this into a clear, professional response for the user. Include:
- Summary of what was calculated
- Key findings (with specific numbers)
- Interpretation of results
- Any important notes or assumptions

Use markdown formatting for clarity.`;

    try {
        const response = await getAnthropicClient().messages.create({
            model: PI_AGENT_MODEL,
            max_tokens: 3000,
            temperature: 0.5,
            system: systemPrompt,
            messages: [
                { role: 'user', content: userPrompt }
            ]
        });

        const formattedResponse = response.content[0].text;

        console.log(`✅ PI Agent formatted ${formattedResponse.length} chars of results`);

        return formattedResponse;

    } catch (error) {
        console.error('❌ PI Agent formatting error:', error);

        // Fallback: Return raw results with basic formatting
        return `## Analysis Results

${codingResult.final_answer || codingResult.output || JSON.stringify(codingResult, null, 2)}

*Note: Automatic formatting unavailable, showing raw results.*`;
    }
}

/**
 * Simple validation check for a query
 * @param {string} query - Query to validate
 * @returns {boolean} True if query is valid
 */
export function isValidQuery(query) {
    if (!query || typeof query !== 'string') return false;
    if (query.trim().length < 3) return false;
    return true;
}

/**
 * Determine if a query likely needs R, Python, or both
 * Simple heuristic-based detection (PI agent will make final decision)
 * @param {string} query - User query
 * @returns {Array<string>} Languages likely needed
 */
export function detectLanguageNeeds(query) {
    const lowerQuery = query.toLowerCase();
    const languages = [];

    // R indicators
    const rKeywords = ['crt', 'cluster randomized', 'sample size', 'power analysis',
                       'anova', 'regression', 'mixed model', 't-test', 'chi-square'];
    if (rKeywords.some(keyword => lowerQuery.includes(keyword))) {
        languages.push('r');
    }

    // Python indicators
    const pythonKeywords = ['pandas', 'numpy', 'machine learning', 'deep learning',
                            'neural network', 'scikit', 'tensorflow', 'pytorch'];
    if (pythonKeywords.some(keyword => lowerQuery.includes(keyword))) {
        languages.push('python');
    }

    // Default to R if nothing detected (biostatistics default)
    if (languages.length === 0) {
        languages.push('r');
    }

    return languages;
}

export default {
    routeQuery,
    formatCodingResult,
    isValidQuery,
    detectLanguageNeeds
};
