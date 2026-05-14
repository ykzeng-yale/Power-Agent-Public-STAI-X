/**
 * LLM-BASED VALUE EXTRACTION FOR BENCHMARK VALIDATION
 *
 * Purpose: Robustly extract numerical values from agent output regardless of format
 * Approach: Use Claude to understand the output and extract key values
 * Benefits: Handles diverse output formats, natural language, tables, etc.
 */

import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

/**
 * Extract sample size from agent output using LLM
 * @param {string} agentOutput - The full agent output text
 * @param {object} context - Context about what we're looking for
 * @returns {Promise<object>} - Extracted value(s) and confidence
 */
export async function extractSampleSize(agentOutput, context = {}) {
  const prompt = `You are a statistical analyst reviewing the output of a power analysis calculation.

Your task: Extract the calculated sample size from this output.

Context:
- Test type: ${context.testType || 'unknown'}
- Looking for: ${context.lookingFor || 'sample size per group'}

Agent Output:
${agentOutput}

Instructions:
1. Find the calculated sample size in the output
2. If there are multiple values (e.g., per group vs total), identify which is which
3. Return the exact numeric value
4. If the value appears in multiple forms (decimal vs rounded), return the most precise one

Respond in JSON format:
{
  "value": <numeric value>,
  "value_type": "per_group" | "total" | "other",
  "confidence": "high" | "medium" | "low",
  "reasoning": "brief explanation of where you found it",
  "alternative_values": [<other relevant numbers if any>]
}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      temperature: 0,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });

    const text = response.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }

    return {
      value: null,
      confidence: 'low',
      reasoning: 'Could not parse LLM response',
      raw_response: text
    };
  } catch (error) {
    console.error('[LLM Extractor] Error:', error.message);
    return {
      value: null,
      confidence: 'low',
      reasoning: `Extraction failed: ${error.message}`
    };
  }
}

/**
 * Extract power value from agent output using LLM
 * @param {string} agentOutput - The full agent output text
 * @param {object} context - Context about what we're looking for
 * @returns {Promise<object>} - Extracted value and confidence
 */
export async function extractPower(agentOutput, context = {}) {
  const prompt = `You are a statistical analyst reviewing the output of a power analysis calculation.

Your task: Extract the calculated statistical power from this output.

Context:
- Test type: ${context.testType || 'unknown'}
- Method: ${context.method || 'unknown'}

Agent Output:
${agentOutput}

Instructions:
1. Find the calculated power value in the output
2. Power should be between 0 and 1 (or 0% and 100%)
3. If given as percentage, convert to decimal (e.g., 80% = 0.80)
4. Look for confidence intervals if present
5. Return the most precise value found

Respond in JSON format:
{
  "value": <power as decimal 0-1>,
  "original_format": "percentage" | "decimal",
  "confidence_interval": [lower, upper] or null,
  "confidence": "high" | "medium" | "low",
  "reasoning": "brief explanation of where you found it"
}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      temperature: 0,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });

    const text = response.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }

    return {
      value: null,
      confidence: 'low',
      reasoning: 'Could not parse LLM response',
      raw_response: text
    };
  } catch (error) {
    console.error('[LLM Extractor] Error:', error.message);
    return {
      value: null,
      confidence: 'low',
      reasoning: `Extraction failed: ${error.message}`
    };
  }
}

/**
 * Extract multiple values for prediction models (n, events, etc.)
 * @param {string} agentOutput - The full agent output text
 * @param {object} context - Context about what we're looking for
 * @returns {Promise<object>} - Extracted values
 */
export async function extractPredictionModelValues(agentOutput, context = {}) {
  const prompt = `You are a statistical analyst reviewing the output of a sample size calculation for a prediction model.

Your task: Extract the calculated sample size and number of events from this output.

Context:
- Outcome type: ${context.outcomeType || 'unknown'}
- Method: ${context.method || 'pmsampsize (Riley criteria)'}

Agent Output:
${agentOutput}

Instructions:
1. Find the final recommended sample size (n)
2. Find the number of events (for binary outcomes)
3. For binary outcomes: n (participants) should be LARGER than events
4. Look for criteria-specific values if mentioned (Criterion 1, 2, 3)
5. Return the FINAL/MAXIMUM recommended value

Respond in JSON format:
{
  "n": <total sample size>,
  "events": <number of events> or null,
  "criterion_values": {
    "criterion_1": <value> or null,
    "criterion_2": <value> or null,
    "criterion_3": <value> or null
  },
  "final_is_max": true/false,
  "confidence": "high" | "medium" | "low",
  "reasoning": "brief explanation",
  "sanity_check": "passed" | "failed: n < events" | "passed"
}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 700,
      temperature: 0,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });

    const text = response.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);

      // Sanity check: for binary outcomes, n should be > events
      if (result.events && result.n && result.n < result.events) {
        result.sanity_check = `failed: n (${result.n}) < events (${result.events})`;
        result.confidence = 'low';
      } else {
        result.sanity_check = 'passed';
      }

      return result;
    }

    return {
      n: null,
      events: null,
      confidence: 'low',
      reasoning: 'Could not parse LLM response',
      raw_response: text
    };
  } catch (error) {
    console.error('[LLM Extractor] Error:', error.message);
    return {
      n: null,
      events: null,
      confidence: 'low',
      reasoning: `Extraction failed: ${error.message}`
    };
  }
}

/**
 * Generic value extractor - can extract any statistical value
 * @param {string} agentOutput - The full agent output text
 * @param {object} whatToExtract - Description of what to extract
 * @returns {Promise<object>} - Extracted value(s)
 */
export async function extractGenericValue(agentOutput, whatToExtract) {
  const prompt = `You are a statistical analyst reviewing output from a statistical analysis.

Your task: Extract the following value(s) from this output.

What to extract:
${JSON.stringify(whatToExtract, null, 2)}

Agent Output:
${agentOutput}

Instructions:
1. Find the requested value(s) in the output
2. Extract the exact numeric value
3. Handle both natural language and formatted output
4. If the value appears multiple times, choose the most precise/final one
5. Be robust to different output formats

Respond in JSON format with the extracted values and your confidence.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 700,
      temperature: 0,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });

    const text = response.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }

    return {
      confidence: 'low',
      reasoning: 'Could not parse LLM response',
      raw_response: text
    };
  } catch (error) {
    console.error('[LLM Extractor] Error:', error.message);
    return {
      confidence: 'low',
      reasoning: `Extraction failed: ${error.message}`
    };
  }
}

/**
 * Hybrid extractor: Try regex first, fall back to LLM if needed
 * @param {string} agentOutput - The agent output
 * @param {Function} regexExtractor - Function that tries regex extraction
 * @param {Function} llmExtractor - Function that uses LLM extraction
 * @param {object} context - Context for extraction
 * @returns {Promise<object>} - Extracted result
 */
export async function hybridExtract(agentOutput, regexExtractor, llmExtractor, context = {}) {
  // Try regex first (fast)
  const regexResult = regexExtractor(agentOutput);

  if (regexResult.valid && regexResult.confidence !== 'low') {
    return {
      ...regexResult,
      method: 'regex',
      llm_fallback_used: false
    };
  }

  // Fall back to LLM (robust but slower)
  console.log('[Hybrid Extractor] Regex extraction failed or low confidence, using LLM...');
  const llmResult = await llmExtractor(agentOutput, context);

  return {
    value: llmResult.value,
    valid: llmResult.value !== null && llmResult.confidence !== 'low',
    confidence: llmResult.confidence,
    reasoning: llmResult.reasoning,
    method: 'llm',
    llm_fallback_used: true,
    regex_attempt: regexResult
  };
}

// Export all functions
export default {
  extractSampleSize,
  extractPower,
  extractPredictionModelValues,
  extractGenericValue,
  hybridExtract
};
