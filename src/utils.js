/**
 * 👻 GhostCoder Backend - Utility Functions
 * Author: Ayushman Lakshkar
 */

import fs from 'fs/promises';
import path from 'path';

/**
 * Log messages with emoji indicators
 * @param {string} message - The message to log
 * @param {string} type - Type of log (info, success, error, warning)
 */
export function log(message, type = 'info') {
  const emojis = {
    info: '⚙️',
    success: '✅',
    error: '❌',
    warning: '⚠️',
    ghost: '👻',
    code: '💻',
    pr: '🔀'
  };
  
  const emoji = emojis[type] || '📝';
  console.log(`${emoji} ${message}`);
}

/**
 * Parse GitHub repository URL to extract owner and repo name
 * @param {string} repoUrl - GitHub repository URL
 * @returns {{owner: string, repo: string}} Owner and repository name
 */
export function parseGitHubUrl(repoUrl) {
  try {
    // Handle different URL formats
    // https://github.com/owner/repo
    // https://github.com/owner/repo.git
    // git@github.com:owner/repo.git
    
    let cleanUrl = repoUrl.trim();
    
    if (cleanUrl.includes('git@github.com:')) {
      cleanUrl = cleanUrl.replace('git@github.com:', 'https://github.com/');
    }
    
    cleanUrl = cleanUrl.replace(/\.git$/, '');
    
    const urlPattern = /github\.com[\/:]([^\/]+)\/([^\/\s]+)/;
    const match = cleanUrl.match(urlPattern);
    
    if (!match) {
      throw new Error('Invalid GitHub URL format');
    }
    
    return {
      owner: match[1],
      repo: match[2]
    };
  } catch (error) {
    log(`Failed to parse GitHub URL: ${error.message}`, 'error');
    throw error;
  }
}

/**
 * Create directory if it doesn't exist
 * @param {string} dirPath - Directory path to create
 */
export async function ensureDirectory(dirPath) {
  try {
    await fs.access(dirPath);
  } catch {
    await fs.mkdir(dirPath, { recursive: true });
    log(`Created directory: ${dirPath}`, 'success');
  }
}

/**
 * Delete directory recursively
 * @param {string} dirPath - Directory path to delete
 */
export async function deleteDirectory(dirPath) {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
    log(`Deleted directory: ${dirPath}`, 'success');
  } catch (error) {
    log(`Failed to delete directory: ${error.message}`, 'warning');
  }
}

/**
 * Read file content safely
 * @param {string} filePath - Path to the file
 * @returns {Promise<string|null>} File content or null if error
 */
export async function readFileSafe(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return content;
  } catch (error) {
    log(`Could not read file ${filePath}: ${error.message}`, 'warning');
    return null;
  }
}

/**
 * Get all code files from a directory (recursively)
 * @param {string} dirPath - Directory to scan
 * @param {number} maxSize - Maximum file size in bytes (default 100KB)
 * @returns {Promise<Array<{path: string, content: string, size: number}>>}
 */
export async function getCodeFiles(dirPath, maxSize = 100000) {
  const codeFiles = [];
  const ignoreDirs = ['node_modules', '.git', 'dist', 'build', 'coverage', '.next', 'temp_repos'];
  const codeExtensions = ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.go', '.rs', '.rb', '.php', '.c', '.cpp', '.cs'];
  
  async function scanDirectory(currentPath) {
    try {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        
        if (entry.isDirectory()) {
          if (!ignoreDirs.includes(entry.name) && !entry.name.startsWith('.')) {
            await scanDirectory(fullPath);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if (codeExtensions.includes(ext)) {
            try {
              const stats = await fs.stat(fullPath);
              if (stats.size <= maxSize) {
                const content = await fs.readFile(fullPath, 'utf-8');
                const relativePath = path.relative(dirPath, fullPath);
                codeFiles.push({
                  path: relativePath,
                  content,
                  size: stats.size
                });
              }
            } catch (error) {
              // Skip files that can't be read
            }
          }
        }
      }
    } catch (error) {
      log(`Error scanning directory ${currentPath}: ${error.message}`, 'warning');
    }
  }
  
  await scanDirectory(dirPath);
  return codeFiles;
}

/**
 * Generate a unique branch name
 * @param {string} baseName - Base name for the branch
 * @returns {string} Unique branch name with timestamp
 */
export function generateBranchName(baseName = 'ghostcoder-improvements') {
  const timestamp = Date.now();
  return `${baseName}-${timestamp}`;
}

/**
 * Format code changes for display
 * @param {Array} changes - Array of change objects
 * @returns {string} Formatted change summary
 */
export function formatChangeSummary(changes) {
  if (!changes || changes.length === 0) {
    return 'No changes made';
  }
  
  return changes.map((change, index) => 
    `${index + 1}. ${change.file}: ${change.description}`
  ).join('\n');
}

/**
 * Validate required environment variables
 * @param {Array<string>} requiredVars - List of required environment variable names
 * @throws {Error} If any required variable is missing
 */
export function validateEnvVars(requiredVars) {
  const missing = requiredVars.filter(varName => !process.env[varName]);
  
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      'Please check your .env file and ensure all required variables are set.'
    );
  }
}

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
