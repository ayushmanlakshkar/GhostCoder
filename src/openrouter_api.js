/**
 * 👻 GhostCoder Backend - OpenRouter API Integration
 * Author: Ayushman Lakshkar
 */

import axios from 'axios';
import { diffLines } from 'diff';
import { log } from './utils.js';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/**
 * Analyze code and get improvement suggestions from AI
 * @param {string} semanticContext - Formatted semantic context from contextRetriever
 * @param {string} repoInfo - Repository information
 * @param {Object} symbolGraph - Symbol graph for reference
 * @returns {Promise<Object>} AI analysis with suggested improvements
 */
export async function analyzeCodeWithAI(semanticContext, repoInfo, symbolGraph) {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY;
    const model = process.env.OPENROUTER_MODEL || 'anthropic/claude-3.5-sonnet';
    
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY is not set');
    }
    
    log('Sending semantic context to AI for analysis...', 'ghost');
    log(`Using model: ${model}`, 'info');

    // Create analysis prompt using semantic context
    const prompt = createSemanticAnalysisPrompt(semanticContext, repoInfo);
    
    log(`Prompt length: ${prompt.length} characters`, 'info');
    log('Making API request to OpenRouter...', 'info');
    
    const requestPayload = {
      model,
      messages: [
        {
          role: 'system',
          content:
            'You are an expert code reviewer and refactoring assistant. ' +
            'Only suggest changes when necessary. Return a valid JSON object following the specified schema.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.6,
      max_tokens: 1000
    };
    
    log(`Request payload: ${JSON.stringify(requestPayload, null, 2).substring(0, 500)}...`, 'info');
    
    const response = await axios.post(
      `${OPENROUTER_BASE_URL}/chat/completions`,
      requestPayload,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/ghostcoder',
          'X-Title': 'GhostCoder Backend'
        }
      }
    );
    
    log(`API Response status: ${response.status}`, 'success');
    log(`Response data: ${JSON.stringify(response.data).substring(0, 300)}...`, 'info');
    
    const aiResponse = response.data.choices[0].message.content;
    log('Received AI analysis', 'success');
    log(`AI Response: ${aiResponse.substring(0, 500)}...`, 'info');
    
    const suggestions = parseAIResponse(aiResponse);
    log(`Parsed suggestions: ${JSON.stringify(suggestions, null, 2)}`, 'info');

    // ✅ Don't change if AI found no improvements
    if (
      !suggestions.improvements ||
      !Array.isArray(suggestions.improvements) ||
      suggestions.improvements.length === 0 ||
      (suggestions.summary &&
        /no (major )?(issues|changes|improvements)/i.test(suggestions.summary))
    ) {
      log('No significant changes suggested by AI.', 'info');
      log(`Summary: ${suggestions.summary}`, 'info');
      return {
        summary: 'No improvements required. Code looks clean!',
        improvements: [],
        priority: 'low'
      };
    }

    return suggestions;
  } catch (error) {
    log(`AI analysis failed: ${error.message}`, 'error');
    log(`Error stack: ${error.stack}`, 'error');
    if (error.response) {
      log(`API Error Status: ${error.response.status}`, 'error');
      log(`API Error Data: ${JSON.stringify(error.response.data)}`, 'error');
    }
    throw error;
  }
}

/**
 * Prepare code summary for AI analysis
 * @param {Array} codeFiles - Array of code files
 * @returns {string} Formatted code summary
 */
function prepareCodeSummary(codeFiles) {
  const maxTotalSize = 50000;
  let totalSize = 0;
  const includedFiles = [];
  
  for (const file of codeFiles) {
    if (totalSize + file.content.length <= maxTotalSize) {
      includedFiles.push(file);
      totalSize += file.content.length;
    } else break;
  }
  
  log(`Analyzing ${includedFiles.length} files (${totalSize} bytes)`, 'info');
  
  return includedFiles.map(file =>
    `\n--- File: ${file.path} ---\n${file.content}\n`
  ).join('\n');
}

/**
 * Create semantic analysis prompt for AI
 * @param {string} semanticContext - Formatted semantic context from contextRetriever
 * @param {string} repoInfo - Repository information
 * @returns {string} Formatted prompt
 */
function createSemanticAnalysisPrompt(semanticContext, repoInfo) {
  return `
Analyze the following repository using semantic code understanding: ${repoInfo}

${semanticContext}

You are analyzing code using a semantic index that has already identified the most relevant files and symbols. 
The context above includes:
- Symbol graph with functions, classes, and their relationships
- Semantic embeddings showing code similarities
- Dependency and call graphs
- Documentation and signatures for key symbols

Instructions:
- Focus on the relevant symbols and files identified in the context
- Only suggest meaningful, non-trivial improvements
- Consider the semantic relationships between symbols
- If the code is already clean and efficient, respond that no changes are needed
- Avoid over-editing or reformatting code unnecessarily
- Pay attention to the relevance scores - focus on high-relevance items

Return JSON in this format:
{
  "summary": "Brief overview or say 'No changes needed.'",
  "improvements": [
    {
      "file": "path/to/file.js",
      "description": "What to improve",
      "reason": "Why this helps (reference specific symbols/patterns found)",
      "changes": "Specific minimal diff or new code snippet",
      "affectedSymbols": ["list", "of", "affected", "symbols"]
    }
  ],
  "priority": "high/medium/low"
}
`.trim();
}

/**
 * Parse AI response and extract suggestions
 * @param {string} aiResponse - Raw AI response
 * @returns {Object} Parsed suggestions
 */
function parseAIResponse(aiResponse) {
  try {
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return parsed;
    }
    
    log('Could not parse JSON from AI response, using fallback', 'warning');
    return {
      summary: 'AI gave unexpected response, check raw output',
      improvements: [],
      priority: 'low',
      rawResponse: aiResponse
    };
  } catch (error) {
    log(`Failed to parse AI response: ${error.message}`, 'error');
    return {
      summary: 'Failed to parse AI response',
      improvements: [],
      priority: 'low',
      error: error.message
    };
  }
}

/**
 * Detect whether the change between two code versions is meaningful.
 * Filters out tiny diffs, whitespace-only edits, or comment changes.
 * @param {string} oldCode
 * @param {string} newCode
 * @returns {boolean} True if the change is significant
 */
function detectMeaningfulChange(oldCode, newCode) {
  // Normalize whitespace
  const cleanOld = oldCode.replace(/\s+/g, ' ').trim();
  const cleanNew = newCode.replace(/\s+/g, ' ').trim();

  if (cleanOld === cleanNew) return false;

  const parts = diffLines(oldCode, newCode);

  let added = 0, removed = 0, total = 0;
  for (const part of parts) {
    if (part.added) added += part.count;
    else if (part.removed) removed += part.count;
    total += part.count;
  }

  const changeRatio = (added + removed) / total;

  // Skip tiny changes (less than 2% or <3 lines changed)
  if (changeRatio < 0.02 && added + removed < 3) return false;

  // Skip comment-only diffs
  const hasRealChange = parts.some(p =>
    p.added && !/^\s*\/\//.test(p.value.trim()) && p.value.trim() !== ''
  );

  return hasRealChange;
}

/**
 * Ask AI to generate code for a specific improvement
 * @param {string} filePath - Path to the file
 * @param {string} currentContent - Current file content
 * @param {string} improvementDescription - Description of improvement
 * @param {Object} symbolGraph - Symbol graph for context (optional)
 * @returns {Promise<string>} Generated code
 */
export async function generateImprovedCode(filePath, currentContent, improvementDescription, symbolGraph = null) {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY;
    const model = process.env.OPENROUTER_MODEL || 'anthropic/claude-3.5-sonnet';
    
    log(`Generating improved code for ${filePath}...`, 'code');
    
    const prompt = `
File: ${filePath}

Current Content:
\`\`\`
${currentContent}
\`\`\`

Improvement Needed:
${improvementDescription}

Constraints:
- Make the smallest meaningful changes necessary.
- Keep style, structure, and formatting consistent.
- If no actual improvement is possible, return the original code unchanged.

Return ONLY the complete improved code (no markdown or explanations).
`.trim();
    
    const response = await axios.post(
      `${OPENROUTER_BASE_URL}/chat/completions`,
      {
        model,
        messages: [
          {
            role: 'system',
            content:
              'You are a code refactoring assistant. Only modify code when necessary. ' +
              'Return the improved version without markdown or explanations.'
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.4,
        max_tokens: 1000
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    let improvedCode = response.data.choices[0].message.content;

    // Strip markdown code blocks if present
    improvedCode = improvedCode
      .replace(/^```[\w]*\n?/gm, '')
      .replace(/\n?```$/gm, '')
      .trim();

    // ✅ Skip identical or small diffs
    if (!detectMeaningfulChange(currentContent, improvedCode)) {
      log(`Skipped trivial changes for ${filePath}.`, 'info');
      return currentContent;
    }

    return improvedCode;
  } catch (error) {
    log(`Failed to generate improved code: ${error.message}`, 'error');
    throw error;
  }
}
