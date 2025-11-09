/**
 * 👻 GhostCoder - Semantic Syntax Fixer
 * 
 * Uses semantic analysis to detect and fix naming errors like typos
 * in export/import statements by analyzing the codebase context.
 * 
 * Author: Ayushman Lakshkar
 */

import { log } from './utils.js';
import path from 'path';

/**
 * Detect potential typos in export names by checking imports across the codebase
 * @param {string} content - File content
 * @param {string} filePath - Current file path
 * @param {Array<{path: string, content: string}>} allFiles - All files in the codebase
 * @returns {Array<{line: number, original: string, suggested: string, reason: string}>}
 */
export function detectExportNameTypos(content, filePath, allFiles) {
  const typos = [];
  const lines = content.split('\n');
  
  // Find export declarations in current file
  const exportPattern = /export\s+(?:const|let|var|class|function|interface|type)\s+(\w+)/g;
  const exports = [];
  
  let match;
  while ((match = exportPattern.exec(content)) !== null) {
    const exportName = match[1];
    const lineNum = content.substring(0, match.index).split('\n').length;
    exports.push({ name: exportName, line: lineNum, match: match[0] });
  }
  
  if (exports.length === 0) return typos;
  
  // Get the file name without extension as a hint for correct naming
  const fileName = path.basename(filePath, path.extname(filePath));
  
  // Check each export against imports in other files
  for (const exp of exports) {
    const importAttempts = findImportAttempts(filePath, allFiles);
    
    log(`Checking export "${exp.name}" in ${filePath}, found ${importAttempts.length} import(s)`, 'info');
    
    // Look for imports that try to import from this file
    for (const attempt of importAttempts) {
      // Check if import name is different from export name
      if (attempt.importedNames && attempt.importedNames.length > 0) {
        for (const importedName of attempt.importedNames) {
          log(`  Import attempt: "${importedName}" from ${attempt.filePath}`, 'info');
          
          // Calculate similarity between export and import names
          const similarity = stringSimilarity(exp.name, importedName);
          const fileNameSimilarity = stringSimilarity(exp.name, fileName);
          
          log(`  Similarity: export "${exp.name}" vs import "${importedName}" = ${similarity.toFixed(2)}`, 'info');
          log(`  File name "${fileName}" vs export "${exp.name}" = ${fileNameSimilarity.toFixed(2)}`, 'info');
          
          // If import name is very similar to file name but export is not, it's likely a typo
          const importFilenameSim = stringSimilarity(importedName, fileName);
          log(`  Import "${importedName}" vs filename "${fileName}" = ${importFilenameSim.toFixed(2)}`, 'info');
          
          if (similarity < 0.5 && importFilenameSim > 0.7) {
            log(`  ✅ TYPO DETECTED: "${exp.name}" should be "${importedName}"`, 'warning');
            typos.push({
              line: exp.line,
              original: exp.name,
              suggested: importedName,
              reason: `Export name "${exp.name}" doesn't match import "${importedName}" which is closer to file name "${fileName}"`,
              confidence: 'high',
              importedIn: attempt.filePath
            });
          }
          
          // If export name looks like a typo (very short, lowercase) and file name suggests otherwise
          if (exp.name.length <= 5 && exp.name === exp.name.toLowerCase() && 
              fileName.length > 5 && fileName !== fileName.toLowerCase()) {
            const importedNameSimilarToFile = stringSimilarity(importedName, fileName) > 0.7;
            if (importedNameSimilarToFile) {
              typos.push({
                line: exp.line,
                original: exp.name,
                suggested: fileName,
                reason: `Export name "${exp.name}" appears to be a typo. File name is "${fileName}" and imported as "${importedName}"`,
                confidence: 'medium',
                importedIn: attempt.filePath
              });
            }
          }
        }
      }
    }
  }
  
  // Remove duplicates, keeping highest confidence
  const typoMap = new Map();
  const confidenceOrder = { high: 3, medium: 2, low: 1 };
  
  for (const typo of typos) {
    const key = typo.original + typo.suggested;
    const existing = typoMap.get(key);
    
    if (!existing || confidenceOrder[typo.confidence] > confidenceOrder[existing.confidence]) {
      typoMap.set(key, typo);
    }
  }
  
  return Array.from(typoMap.values());
}

/**
 * Find all import attempts for a specific file
 * @param {string} targetFilePath - The file being imported
 * @param {Array<{path: string, content: string}>} allFiles - All files
 * @returns {Array<{filePath: string, importedNames: string[]}>}
 */
function findImportAttempts(targetFilePath, allFiles) {
  const attempts = [];
  const targetFileName = path.basename(targetFilePath, path.extname(targetFilePath));
  const targetDir = path.dirname(targetFilePath);
  
  for (const file of allFiles) {
    if (file.path === targetFilePath) continue;
    
    // Look for imports from this file
    // Match: import { Something } from './PDFService'
    const importPattern = /import\s+(?:{([^}]+)}|\*\s+as\s+(\w+)|(\w+))\s+from\s+['"](.*?)['"]/g;
    let match;
    
    while ((match = importPattern.exec(file.content)) !== null) {
      const importedNamesStr = match[1] || match[2] || match[3];
      const importPath = match[4];
      
      // Check if this import is trying to import from our target file
      const isTargetFile = importPath.includes(targetFileName) || 
                          importPath.includes(path.basename(targetFilePath));
      
      if (isTargetFile) {
        const importedNames = importedNamesStr ? 
          importedNamesStr.split(',').map(n => n.trim().split(' as ')[0].trim()) : 
          [];
        
        attempts.push({
          filePath: file.path,
          importedNames,
          importStatement: match[0]
        });
      }
    }
  }
  
  return attempts;
}

/**
 * Calculate string similarity (Levenshtein distance based)
 * @param {string} str1 
 * @param {string} str2 
 * @returns {number} Similarity score 0-1
 */
function stringSimilarity(str1, str2) {
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();
  
  // Exact match
  if (s1 === s2) return 1.0;
  
  // Calculate Levenshtein distance
  const matrix = Array(s2.length + 1).fill(null).map(() => Array(s1.length + 1).fill(null));
  
  for (let i = 0; i <= s1.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= s2.length; j++) matrix[j][0] = j;
  
  for (let j = 1; j <= s2.length; j++) {
    for (let i = 1; i <= s1.length; i++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,     // deletion
        matrix[j - 1][i] + 1,     // insertion
        matrix[j - 1][i - 1] + cost // substitution
      );
    }
  }
  
  const distance = matrix[s2.length][s1.length];
  const maxLen = Math.max(s1.length, s2.length);
  
  return 1 - (distance / maxLen);
}

/**
 * Apply semantic fixes to the content
 * @param {string} content - File content
 * @param {string} filePath - File path
 * @param {Array} typos - Detected typos
 * @returns {Object} Fixed content and applied fixes
 */
export function applySemanticFixes(content, filePath, typos) {
  let fixedContent = content;
  const appliedFixes = [];
  
  log(`🔧 Applying semantic fixes to ${filePath}: ${typos.length} typo(s) found`, 'ghost');
  
  // Sort typos by line number in reverse to avoid offset issues
  const sortedTypos = [...typos].sort((a, b) => b.line - a.line);
  
  for (const typo of sortedTypos) {
    log(`  Checking typo with confidence: ${typo.confidence}`, 'info');
    if (typo.confidence === 'high') {
      log(`🔍 Found likely typo in ${filePath} line ${typo.line}: "${typo.original}" → "${typo.suggested}"`, 'info');
      log(`   Reason: ${typo.reason}`, 'info');
      
      // Replace the export name
      const exportPattern = new RegExp(
        `(export\\s+(?:const|let|var|class|function|interface|type)\\s+)${typo.original}\\b`,
        'g'
      );
      
      const before = fixedContent;
      fixedContent = fixedContent.replace(exportPattern, `$1${typo.suggested}`);
      
      if (fixedContent !== before) {
        appliedFixes.push({
          type: 'export-name-typo',
          line: typo.line,
          original: typo.original,
          fixed: typo.suggested,
          reason: typo.reason
        });
        
        log(`✅ Fixed export name: ${typo.original} → ${typo.suggested}`, 'success');
      }
    }
  }
  
  return {
    fixed: appliedFixes.length > 0,
    content: fixedContent,
    fixes: appliedFixes
  };
}

/**
 * Main semantic fix function - detects and fixes semantic issues
 * @param {string} content - File content
 * @param {string} filePath - File path
 * @param {Array<{path: string, content: string}>} allFiles - All codebase files
 * @returns {Object} Result with fixed content
 */
export async function semanticFix(content, filePath, allFiles) {
  log(`🔍 Running semantic analysis on ${filePath}...`, 'ghost');
  
  // Detect typos in export names
  const typos = detectExportNameTypos(content, filePath, allFiles);
  
  if (typos.length > 0) {
    log(`Found ${typos.length} potential naming issue(s) in ${filePath}`, 'warning');
    
    // Apply fixes for high-confidence typos
    const result = applySemanticFixes(content, filePath, typos);
    
    if (result.fixed) {
      return {
        fixed: true,
        content: result.content,
        fixes: result.fixes,
        shouldCommit: true
      };
    }
  }
  
  return {
    fixed: false,
    content,
    fixes: [],
    shouldCommit: false
  };
}
