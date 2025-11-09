/**
 * 👻 GhostCoder - Embedding Index Manager
 * 
 * Creates and manages vector embeddings for semantic search using local
 * transformer models. Stores embeddings in a lightweight local format
 * similar to GitHub Copilot's cloud embedding index.
 * 
 * Author: Ayushman Lakshkar
 */

import { pipeline, env } from '@xenova/transformers';
import fs from 'fs/promises';
import path from 'path';
import { log } from './utils.js';

// Disable remote models in offline mode (optional)
// env.allowRemoteModels = false;

// Cache directory for models
const MODELS_CACHE_DIR = path.join(process.cwd(), 'data', 'models');
const INDEX_DIR = path.join(process.cwd(), 'data', 'indexes');

// Singleton for embedding pipeline
let embeddingPipeline = null;

/**
 * Initialize the embedding pipeline
 * Using a lightweight model suitable for code embeddings
 */
async function getEmbeddingPipeline() {
  if (embeddingPipeline) {
    return embeddingPipeline;
  }

  log('Initializing embedding model (first time may take a while)...', 'ghost');
  
  try {
    // Use a lightweight model optimized for code/text similarity
    // Options: 'Xenova/all-MiniLM-L6-v2' (fast, small), 'Xenova/bge-small-en-v1.5' (better quality)
    embeddingPipeline = await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2',
      { 
        cache_dir: MODELS_CACHE_DIR,
        quantized: true // Use quantized model for better performance
      }
    );
    
    log('Embedding model loaded successfully', 'success');
  } catch (error) {
    log(`Failed to load embedding model: ${error.message}`, 'error');
    throw error;
  }

  return embeddingPipeline;
}

/**
 * Generate embedding for a text
 * @param {string} text - Text to embed
 * @returns {Promise<Array<number>>} Embedding vector
 */
export async function generateEmbedding(text) {
  try {
    const pipeline = await getEmbeddingPipeline();
    const output = await pipeline(text, { pooling: 'mean', normalize: true });
    
    // Convert tensor to array
    return Array.from(output.data);
  } catch (error) {
    log(`Failed to generate embedding: ${error.message}`, 'error');
    throw error;
  }
}

/**
 * Build embedding index for a symbol graph
 * @param {Object} symbolGraph - Symbol graph from symbolGraph.js
 * @param {string} repoId - Repository identifier
 * @returns {Promise<Object>} Embedding index
 */
export async function buildEmbeddingIndex(symbolGraph, repoId) {
  log('Building embedding index...', 'code');
  
  const index = {
    repoId,
    embeddings: [],
    metadata: {
      totalEmbeddings: 0,
      buildTime: Date.now(),
      model: 'Xenova/all-MiniLM-L6-v2'
    }
  };

  const pipeline = await getEmbeddingPipeline();
  
  // Create embeddings for each symbol
  let count = 0;
  for (const [symbolId, symbol] of Object.entries(symbolGraph.symbols)) {
    try {
      // Create a rich text representation for embedding
      const textToEmbed = createSymbolText(symbol);
      
      log(`Embedding symbol ${count + 1}/${Object.keys(symbolGraph.symbols).length}: ${symbol.name}`, 'info');
      
      const embedding = await generateEmbedding(textToEmbed);
      
      index.embeddings.push({
        id: symbolId,
        symbolName: symbol.name,
        symbolType: symbol.type,
        file: symbol.file,
        line: symbol.line,
        embedding: embedding,
        text: textToEmbed,
        documentation: symbol.documentation || null,
        signature: symbol.signature || null
      });
      
      count++;
    } catch (error) {
      log(`Failed to embed symbol ${symbol.name}: ${error.message}`, 'warning');
    }
  }

  // Also create file-level embeddings
  for (const [filePath, fileInfo] of Object.entries(symbolGraph.files)) {
    try {
      const fileText = createFileText(fileInfo, symbolGraph);
      const embedding = await generateEmbedding(fileText);
      
      index.embeddings.push({
        id: `file::${filePath}`,
        symbolName: path.basename(filePath),
        symbolType: 'file',
        file: filePath,
        line: 0,
        embedding: embedding,
        text: fileText,
        language: fileInfo.language,
        symbolCount: fileInfo.symbolCount
      });
    } catch (error) {
      log(`Failed to embed file ${filePath}: ${error.message}`, 'warning');
    }
  }

  index.metadata.totalEmbeddings = index.embeddings.length;
  log(`Embedding index built: ${index.embeddings.length} embeddings`, 'success');
  
  // Save index to disk
  await saveIndex(index, repoId);
  
  return index;
}

/**
 * Create rich text representation of a symbol for embedding
 */
function createSymbolText(symbol) {
  const parts = [];
  
  // Add symbol type and name
  parts.push(`${symbol.type} ${symbol.name}`);
  
  // Add signature if available
  if (symbol.signature) {
    parts.push(symbol.signature);
  }
  
  // Add parameters if available
  if (symbol.params && symbol.params.length > 0) {
    parts.push(`parameters: ${symbol.params.join(', ')}`);
  }
  
  // Add documentation if available
  if (symbol.documentation) {
    parts.push(symbol.documentation);
  }
  
  // Add file path context
  if (symbol.file) {
    const fileName = path.basename(symbol.file);
    const dirName = path.basename(path.dirname(symbol.file));
    parts.push(`in ${dirName}/${fileName}`);
  }
  
  // Add class context for methods
  if (symbol.className) {
    parts.push(`method of class ${symbol.className}`);
  }
  
  return parts.join(' ');
}

/**
 * Create rich text representation of a file for embedding
 */
function createFileText(fileInfo, symbolGraph) {
  const parts = [];
  
  // Add file path
  parts.push(fileInfo.path);
  
  // Add language
  parts.push(`${fileInfo.language} file`);
  
  // Add imports (what this file depends on)
  if (fileInfo.imports && fileInfo.imports.length > 0) {
    const importNames = fileInfo.imports.slice(0, 10).map(imp => imp.name).join(', ');
    parts.push(`imports: ${importNames}`);
  }
  
  // Add exports (what this file provides)
  if (fileInfo.exports && fileInfo.exports.length > 0) {
    const exportNames = fileInfo.exports.slice(0, 10).map(exp => exp.name).join(', ');
    parts.push(`exports: ${exportNames}`);
  }
  
  // Add top-level symbols
  const fileSymbols = Object.values(symbolGraph.symbols)
    .filter(s => s.file === fileInfo.path)
    .slice(0, 10)
    .map(s => s.name)
    .join(', ');
  
  if (fileSymbols) {
    parts.push(`contains: ${fileSymbols}`);
  }
  
  return parts.join(' ');
}

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(vec1, vec2) {
  if (vec1.length !== vec2.length) {
    throw new Error('Vectors must have the same length');
  }
  
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;
  
  for (let i = 0; i < vec1.length; i++) {
    dotProduct += vec1[i] * vec2[i];
    norm1 += vec1[i] * vec1[i];
    norm2 += vec2[i] * vec2[i];
  }
  
  norm1 = Math.sqrt(norm1);
  norm2 = Math.sqrt(norm2);
  
  if (norm1 === 0 || norm2 === 0) {
    return 0;
  }
  
  return dotProduct / (norm1 * norm2);
}

/**
 * Search the embedding index using semantic similarity
 * @param {Object} index - Embedding index
 * @param {string} query - Search query
 * @param {number} topK - Number of results to return
 * @returns {Promise<Array>} Top K most similar results
 */
export async function semanticSearch(index, query, topK = 10) {
  log(`Performing semantic search for: "${query}"`, 'code');
  
  try {
    // Generate embedding for query
    const queryEmbedding = await generateEmbedding(query);
    
    // Calculate similarities
    const results = index.embeddings.map(item => {
      const similarity = cosineSimilarity(queryEmbedding, item.embedding);
      return {
        ...item,
        similarity,
        embedding: undefined // Remove embedding from result to save space
      };
    });
    
    // Sort by similarity and return top K
    results.sort((a, b) => b.similarity - a.similarity);
    const topResults = results.slice(0, topK);
    
    log(`Found ${topResults.length} relevant results (top similarity: ${topResults[0]?.similarity.toFixed(3)})`, 'success');
    
    return topResults;
  } catch (error) {
    log(`Semantic search failed: ${error.message}`, 'error');
    throw error;
  }
}

/**
 * Save embedding index to disk
 */
async function saveIndex(index, repoId) {
  try {
    await fs.mkdir(INDEX_DIR, { recursive: true });
    
    const indexPath = path.join(INDEX_DIR, `${sanitizeRepoId(repoId)}.json`);
    
    // Convert to JSON-serializable format
    const serialized = JSON.stringify(index, null, 2);
    
    await fs.writeFile(indexPath, serialized, 'utf-8');
    log(`Index saved to: ${indexPath}`, 'success');
  } catch (error) {
    log(`Failed to save index: ${error.message}`, 'error');
    throw error;
  }
}

/**
 * Load embedding index from disk
 */
export async function loadIndex(repoId) {
  try {
    const indexPath = path.join(INDEX_DIR, `${sanitizeRepoId(repoId)}.json`);
    const content = await fs.readFile(indexPath, 'utf-8');
    const index = JSON.parse(content);
    
    log(`Index loaded from: ${indexPath}`, 'success');
    return index;
  } catch (error) {
    if (error.code === 'ENOENT') {
      log(`No existing index found for ${repoId}`, 'info');
      return null;
    }
    log(`Failed to load index: ${error.message}`, 'error');
    throw error;
  }
}

/**
 * Check if index exists for a repository
 */
export async function indexExists(repoId) {
  try {
    const indexPath = path.join(INDEX_DIR, `${sanitizeRepoId(repoId)}.json`);
    await fs.access(indexPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete index for a repository
 */
export async function deleteIndex(repoId) {
  try {
    const indexPath = path.join(INDEX_DIR, `${sanitizeRepoId(repoId)}.json`);
    
    // Check if file exists before trying to delete
    try {
      await fs.access(indexPath);
      await fs.unlink(indexPath);
      log(`Index deleted: ${indexPath}`, 'success');
    } catch (error) {
      if (error.code === 'ENOENT') {
        log(`Index file does not exist (already deleted or never created): ${indexPath}`, 'info');
      } else {
        throw error;
      }
    }
  } catch (error) {
    log(`Failed to delete index: ${error.message}`, 'warning');
  }
}

/**
 * Sanitize repository ID for use in filename
 */
function sanitizeRepoId(repoId) {
  return repoId.replace(/[^a-zA-Z0-9-_]/g, '_');
}

/**
 * Get index statistics
 */
export async function getIndexStats(repoId) {
  const index = await loadIndex(repoId);
  
  if (!index) {
    return null;
  }
  
  const stats = {
    totalEmbeddings: index.metadata.totalEmbeddings,
    buildTime: new Date(index.metadata.buildTime).toISOString(),
    model: index.metadata.model,
    symbolTypes: {},
    languages: {}
  };
  
  // Count symbol types
  for (const embedding of index.embeddings) {
    stats.symbolTypes[embedding.symbolType] = (stats.symbolTypes[embedding.symbolType] || 0) + 1;
    
    if (embedding.language) {
      stats.languages[embedding.language] = (stats.languages[embedding.language] || 0) + 1;
    }
  }
  
  return stats;
}

/**
 * Rebuild index (useful for updates)
 */
export async function rebuildIndex(symbolGraph, repoId) {
  log(`Rebuilding index for ${repoId}...`, 'ghost');
  
  // Delete old index
  await deleteIndex(repoId);
  
  // Build new index
  return await buildEmbeddingIndex(symbolGraph, repoId);
}

/**
 * Find similar symbols (for "find all references" type queries)
 */
export async function findSimilarSymbols(index, symbolName, topK = 5) {
  const query = `function or class named ${symbolName}`;
  return await semanticSearch(index, query, topK);
}

/**
 * Find symbols by type (e.g., all functions, all classes)
 */
export function findSymbolsByType(index, symbolType, limit = 50) {
  return index.embeddings
    .filter(item => item.symbolType === symbolType)
    .slice(0, limit);
}

/**
 * Find symbols in a specific file
 */
export function findSymbolsInFile(index, filePath, limit = 50) {
  return index.embeddings
    .filter(item => item.file === filePath)
    .slice(0, limit);
}
