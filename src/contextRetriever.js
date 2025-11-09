/**
 * 👻 GhostCoder - Context Retriever
 * 
 * Intelligent context retrieval system that fetches only relevant files
 * and symbols based on semantic queries. Similar to how GitHub Copilot
 * and Cursor fetch context without loading entire repositories.
 * 
 * Author: Ayushman Lakshkar
 */

import fs from 'fs/promises';
import path from 'path';
import { log } from './utils.js';
import { 
  semanticSearch, 
  findSymbolsByType, 
  findSymbolsInFile,
  findSimilarSymbols 
} from './embeddingIndex.js';
import { 
  findSymbolsByName, 
  findReferences, 
  getSymbolHierarchy 
} from './symbolGraph.js';

/**
 * Retrieve relevant context for code analysis
 * @param {Object} index - Embedding index
 * @param {Object} symbolGraph - Symbol graph
 * @param {string} repoPath - Repository path
 * @param {Object} options - Retrieval options
 * @returns {Promise<Object>} Retrieved context
 */
export async function retrieveContext(index, symbolGraph, repoPath, options = {}) {
  const {
    query = 'code quality and improvements',
    maxFiles = 10,
    maxSymbols = 50,
    includeFullFiles = false,
    focusAreas = [] // e.g., ['security', 'performance', 'best practices']
  } = options;

  log('Retrieving relevant context using semantic search...', 'code');

  const context = {
    relevantFiles: [],
    relevantSymbols: [],
    callGraph: [],
    dependencies: [],
    summary: ''
  };

  // Step 1: Semantic search for relevant symbols and files
  const searchResults = await semanticSearch(index, query, maxSymbols);
  
  // Step 2: Group results by file
  const fileGroups = new Map();
  for (const result of searchResults) {
    if (!fileGroups.has(result.file)) {
      fileGroups.set(result.file, []);
    }
    fileGroups.get(result.file).push(result);
  }

  // Step 3: Sort files by relevance (number of relevant symbols)
  const sortedFiles = Array.from(fileGroups.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, maxFiles);

  // Step 4: Build context for each relevant file
  for (const [filePath, symbols] of sortedFiles) {
    try {
      const fileContext = await buildFileContext(
        filePath,
        symbols,
        symbolGraph,
        repoPath,
        includeFullFiles
      );
      
      context.relevantFiles.push(fileContext);
      context.relevantSymbols.push(...symbols);
    } catch (error) {
      log(`Failed to build context for ${filePath}: ${error.message}`, 'warning');
    }
  }

  // Step 5: Build dependency graph for relevant files
  context.dependencies = buildDependencyGraph(context.relevantFiles, symbolGraph);

  // Step 6: Build call graph for key functions
  context.callGraph = buildCallGraph(context.relevantSymbols, symbolGraph);

  // Step 7: Generate summary
  context.summary = generateContextSummary(context);

  log(`Context retrieved: ${context.relevantFiles.length} files, ${context.relevantSymbols.length} symbols`, 'success');

  return context;
}

/**
 * Build context for a single file
 */
async function buildFileContext(filePath, relevantSymbols, symbolGraph, repoPath, includeFullContent) {
  const absolutePath = path.join(repoPath, filePath);
  
  const fileContext = {
    path: filePath,
    language: symbolGraph.files[filePath]?.language || 'unknown',
    relevantSymbols: relevantSymbols.map(s => ({
      name: s.symbolName,
      type: s.symbolType,
      line: s.line,
      similarity: s.similarity,
      documentation: s.documentation,
      signature: s.signature
    })),
    imports: [],
    exports: [],
    snippet: null,
    fullContent: null
  };

  // Get file metadata from symbol graph
  const fileInfo = symbolGraph.files[filePath];
  if (fileInfo) {
    fileContext.imports = fileInfo.imports?.map(imp => imp.name) || [];
    fileContext.exports = fileInfo.exports?.map(exp => exp.name) || [];
  }

  // Include relevant code snippets
  try {
    const content = await fs.readFile(absolutePath, 'utf-8');
    
    if (includeFullContent) {
      fileContext.fullContent = content;
    } else {
      // Extract relevant snippets around each symbol
      fileContext.snippet = extractRelevantSnippets(content, relevantSymbols);
    }
  } catch (error) {
    log(`Could not read file ${filePath}: ${error.message}`, 'warning');
  }

  return fileContext;
}

/**
 * Extract code snippets around relevant symbols
 */
function extractRelevantSnippets(content, relevantSymbols) {
  const lines = content.split('\n');
  const snippets = [];
  const contextLines = 5; // Lines before and after
  const addedLines = new Set();

  for (const symbol of relevantSymbols.slice(0, 5)) { // Top 5 symbols
    if (!symbol.line) continue;

    const startLine = Math.max(0, symbol.line - contextLines - 1);
    const endLine = Math.min(lines.length, symbol.line + contextLines);

    // Avoid duplicate lines
    let snippet = '';
    for (let i = startLine; i < endLine; i++) {
      if (!addedLines.has(i)) {
        snippet += `${i + 1}: ${lines[i]}\n`;
        addedLines.add(i);
      }
    }

    if (snippet) {
      snippets.push({
        symbolName: symbol.symbolName,
        line: symbol.line,
        code: snippet
      });
    }
  }

  return snippets;
}

/**
 * Build dependency graph from relevant files
 */
function buildDependencyGraph(relevantFiles, symbolGraph) {
  const dependencies = [];
  
  for (const file of relevantFiles) {
    for (const importName of file.imports) {
      // Find where this import comes from
      const edges = symbolGraph.edges.filter(e => 
        e.from.includes(file.path) && e.type === 'imports'
      );
      
      for (const edge of edges) {
        dependencies.push({
          from: file.path,
          to: edge.to,
          type: 'imports',
          symbol: importName
        });
      }
    }
  }
  
  return dependencies;
}

/**
 * Build call graph for relevant symbols
 */
function buildCallGraph(relevantSymbols, symbolGraph) {
  const callGraph = [];
  
  // Find function calls and references
  for (const symbol of relevantSymbols) {
    if (symbol.symbolType === 'function' || symbol.symbolType === 'method') {
      const references = findReferences(symbolGraph, symbol.symbolName);
      
      for (const ref of references.slice(0, 5)) { // Limit to 5 references
        callGraph.push({
          caller: ref.from,
          callee: ref.to,
          symbolName: symbol.symbolName
        });
      }
    }
  }
  
  return callGraph;
}

/**
 * Generate a summary of the retrieved context
 */
function generateContextSummary(context) {
  const summary = {
    totalFiles: context.relevantFiles.length,
    totalSymbols: context.relevantSymbols.length,
    languages: new Set(),
    symbolTypes: {},
    topFiles: []
  };

  // Collect statistics
  for (const file of context.relevantFiles) {
    summary.languages.add(file.language);
    
    for (const symbol of file.relevantSymbols) {
      summary.symbolTypes[symbol.type] = (summary.symbolTypes[symbol.type] || 0) + 1;
    }
  }

  // Get top files by relevance
  summary.topFiles = context.relevantFiles
    .slice(0, 5)
    .map(f => ({
      path: f.path,
      symbolCount: f.relevantSymbols.length,
      language: f.language
    }));

  summary.languages = Array.from(summary.languages);

  return summary;
}

/**
 * Query for specific patterns or issues
 * @param {Object} index - Embedding index
 * @param {Object} symbolGraph - Symbol graph
 * @param {string} repoPath - Repository path
 * @param {string} queryType - Type of query (e.g., 'security', 'performance', 'bugs')
 * @returns {Promise<Object>} Query results
 */
export async function queryPattern(index, symbolGraph, repoPath, queryType) {
  const queryMap = {
    security: 'security vulnerabilities, SQL injection, XSS, authentication issues, password handling',
    performance: 'performance issues, slow loops, inefficient algorithms, memory leaks, N+1 queries',
    bugs: 'potential bugs, null pointer, undefined, error handling, edge cases',
    'best-practices': 'code quality, best practices, clean code, SOLID principles, maintainability',
    dependencies: 'external dependencies, imports, third-party libraries, API calls',
    testing: 'test coverage, unit tests, integration tests, test cases, assertions'
  };

  const query = queryMap[queryType] || queryType;
  log(`Querying for: ${queryType}`, 'info');

  return await retrieveContext(index, symbolGraph, repoPath, {
    query,
    maxFiles: 15,
    maxSymbols: 30,
    focusAreas: [queryType]
  });
}

/**
 * Find all usages of a function or class
 * @param {Object} index - Embedding index
 * @param {Object} symbolGraph - Symbol graph
 * @param {string} symbolName - Name of symbol to find
 * @returns {Promise<Array>} List of usages
 */
export async function findAllUsages(index, symbolGraph, symbolName) {
  log(`Finding all usages of: ${symbolName}`, 'code');

  // Combine exact name match with semantic search
  const exactMatches = findSymbolsByName(symbolGraph, symbolName);
  const semanticMatches = await findSimilarSymbols(index, symbolName, 10);
  
  // Find references in symbol graph
  const references = findReferences(symbolGraph, symbolName);

  return {
    definitions: exactMatches,
    similarSymbols: semanticMatches,
    references: references,
    totalUsages: exactMatches.length + references.length
  };
}

/**
 * Get focused context for specific files/paths
 * @param {Object} index - Embedding index
 * @param {Object} symbolGraph - Symbol graph
 * @param {string} repoPath - Repository path
 * @param {Array<string>} targetPaths - Specific paths to analyze
 * @returns {Promise<Object>} Focused context
 */
export async function getFocusedContext(index, symbolGraph, repoPath, targetPaths) {
  log(`Getting focused context for ${targetPaths.length} path(s)`, 'code');

  const context = {
    files: [],
    dependencies: [],
    relatedSymbols: []
  };

  for (const targetPath of targetPaths) {
    // Get all symbols in this file
    const fileSymbols = findSymbolsInFile(index, targetPath);
    
    // Build file context
    const fileContext = await buildFileContext(
      targetPath,
      fileSymbols,
      symbolGraph,
      repoPath,
      false
    );
    
    context.files.push(fileContext);

    // Find related symbols in other files
    for (const symbol of fileSymbols.slice(0, 5)) {
      const similar = await findSimilarSymbols(index, symbol.symbolName, 5);
      context.relatedSymbols.push(...similar.filter(s => s.file !== targetPath));
    }
  }

  // Build dependency graph
  context.dependencies = buildDependencyGraph(context.files, symbolGraph);

  log(`Focused context retrieved: ${context.files.length} files`, 'success');

  return context;
}

/**
 * Format context for AI consumption
 * @param {Object} context - Retrieved context
 * @returns {string} Formatted context string
 */
export function formatContextForAI(context) {
  const sections = [];

  // Summary
  sections.push('=== CODE CONTEXT SUMMARY ===');
  sections.push(`Total Files: ${context.summary.totalFiles}`);
  sections.push(`Total Symbols: ${context.summary.totalSymbols}`);
  sections.push(`Languages: ${context.summary.languages.join(', ')}`);
  sections.push(`Symbol Types: ${JSON.stringify(context.summary.symbolTypes, null, 2)}`);
  sections.push('');

  // Top relevant files
  sections.push('=== TOP RELEVANT FILES ===');
  for (const fileInfo of context.summary.topFiles) {
    sections.push(`- ${fileInfo.path} (${fileInfo.language}, ${fileInfo.symbolCount} relevant symbols)`);
  }
  sections.push('');

  // File details
  sections.push('=== FILE DETAILS ===');
  for (const file of context.relevantFiles) {
    sections.push(`\n--- File: ${file.path} (${file.language}) ---`);
    
    // Imports
    if (file.imports.length > 0) {
      sections.push(`Imports: ${file.imports.join(', ')}`);
    }
    
    // Exports
    if (file.exports.length > 0) {
      sections.push(`Exports: ${file.exports.join(', ')}`);
    }
    
    // Relevant symbols
    sections.push('\nRelevant Symbols:');
    for (const symbol of file.relevantSymbols.slice(0, 10)) {
      sections.push(`  - ${symbol.name} (${symbol.type}) at line ${symbol.line}`);
      if (symbol.documentation) {
        sections.push(`    Doc: ${symbol.documentation}`);
      }
      if (symbol.signature) {
        sections.push(`    Signature: ${symbol.signature}`);
      }
      sections.push(`    Relevance: ${(symbol.similarity * 100).toFixed(1)}%`);
    }
    
    // Code snippets
    if (file.snippet && file.snippet.length > 0) {
      sections.push('\nCode Snippets:');
      for (const snippet of file.snippet.slice(0, 3)) {
        sections.push(`\n  Symbol: ${snippet.symbolName} (line ${snippet.line})`);
        sections.push('  ```');
        sections.push(snippet.code);
        sections.push('  ```');
      }
    }
  }

  // Dependencies
  if (context.dependencies.length > 0) {
    sections.push('\n=== DEPENDENCIES ===');
    for (const dep of context.dependencies.slice(0, 20)) {
      sections.push(`${dep.from} -> ${dep.to} (${dep.symbol})`);
    }
  }

  return sections.join('\n');
}

/**
 * Get intelligent suggestions for code improvements
 * @param {Object} index - Embedding index
 * @param {Object} symbolGraph - Symbol graph
 * @param {string} repoPath - Repository path
 * @returns {Promise<Object>} Improvement suggestions
 */
export async function getImprovementSuggestions(index, symbolGraph, repoPath) {
  log('Analyzing code for potential improvements...', 'ghost');

  const suggestions = {
    security: await queryPattern(index, symbolGraph, repoPath, 'security'),
    performance: await queryPattern(index, symbolGraph, repoPath, 'performance'),
    bestPractices: await queryPattern(index, symbolGraph, repoPath, 'best-practices'),
    testing: await queryPattern(index, symbolGraph, repoPath, 'testing')
  };

  return suggestions;
}

/**
 * Create a compact context for token efficiency
 * Useful when you need to minimize tokens sent to AI
 */
export function createCompactContext(context, maxTokens = 10000) {
  const estimated = estimateTokens(formatContextForAI(context));
  
  if (estimated <= maxTokens) {
    return context;
  }

  // Reduce context size
  const compactContext = {
    ...context,
    relevantFiles: context.relevantFiles.slice(0, 5), // Reduce files
    relevantSymbols: context.relevantSymbols.slice(0, 20), // Reduce symbols
    callGraph: context.callGraph.slice(0, 10),
    dependencies: context.dependencies.slice(0, 10)
  };

  // Remove full content, keep only snippets
  for (const file of compactContext.relevantFiles) {
    file.fullContent = null;
    if (file.snippet) {
      file.snippet = file.snippet.slice(0, 2); // Keep only top 2 snippets
    }
  }

  return compactContext;
}

/**
 * Estimate token count (rough approximation)
 */
function estimateTokens(text) {
  // Rough estimate: 1 token ≈ 4 characters
  return Math.ceil(text.length / 4);
}
