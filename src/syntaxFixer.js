/**
 * 👻 GhostCoder - Syntax Error Fixer
 * 
 * Automatically detects and fixes common syntax errors in code files
 * before parsing them. This helps the symbol graph builder handle
 * imperfect code gracefully.
 * 
 * Author: Ayushman Lakshkar
 */

import { log } from './utils.js';

/**
 * Common syntax error patterns and their fixes
 */
const SYNTAX_FIXES = [
  {
    name: 'Missing semicolons',
    pattern: /(\w+)\s*\n/g,
    check: (line) => {
      // Add semicolon if line ends with identifier/value but no semicolon
      const needsSemicolon = /^(import|export|return|const|let|var|throw|break|continue)\s+.*[^;{}\n]$/;
      return needsSemicolon.test(line.trim());
    },
    fix: (line) => line.trim() + ';'
  },
  {
    name: 'Missing commas in object/array',
    pattern: /}\s*\n\s*\w+:/g,
    fix: (match) => match.replace('}', '},')
  },
  {
    name: 'Unclosed strings',
    pattern: /(["'])(?:(?=(\\?))\2.)*?$/gm,
    fix: (match) => match + match[0]
  },
  {
    name: 'Missing closing brackets',
    check: (content) => {
      const openBrackets = (content.match(/[{[(]/g) || []).length;
      const closeBrackets = (content.match(/[}\])]/g) || []).length;
      return openBrackets > closeBrackets;
    }
  }
];

/**
 * Attempt to fix common syntax errors in code
 * @param {string} content - Code content
 * @param {string} filePath - File path (for logging)
 * @param {string} language - Programming language
 * @returns {Object} - { fixed: boolean, content: string, errors: [], fixes: [], shouldCommit: boolean }
 */
export function attemptSyntaxFix(content, filePath, language = 'javascript') {
  const result = {
    fixed: false,
    content: content,
    errors: [],
    fixes: [],
    shouldCommit: false // Flag to indicate if fixes should be committed to repo
  };

  try {
    let fixedContent = content;
    let wasFixed = false;

    // Fix 1: Fix incomplete object/function declarations (critical fix first!)
    if (['javascript', 'typescript'].includes(language)) {
      // Fix pattern: "export const name =" followed by "async function"
      // Should be: "export const name = {"
      const incompleteObjectPattern = /export\s+(const|let|var)\s+(\w+)\s*=\s*\n\s*async\s+(\w+)/g;
      if (incompleteObjectPattern.test(fixedContent)) {
        fixedContent = fixedContent.replace(
          /export\s+(const|let|var)\s+(\w+)\s*=\s*\n\s*async\s+(\w+)/g,
          'export $1 $2 = {\n  async $3'
        );
        wasFixed = true;
        result.fixes.push({
          type: 'incomplete-object-declaration',
          description: 'Fixed incomplete object literal after export declaration'
        });
        log(`Fixed incomplete object declaration in ${filePath}`, 'success');
      }
    }

    // Fix 2: Add missing semicolons (JavaScript/TypeScript) - but be smart about it
    if (['javascript', 'typescript'].includes(language)) {
      const lines = fixedContent.split('\n');
      const fixedLines = lines.map((line, index) => {
        const trimmed = line.trim();
        
        // Skip empty lines, comments, and lines already ending with semicolon/brackets
        if (!trimmed || 
            trimmed.startsWith('//') || 
            trimmed.startsWith('/*') ||
            trimmed.startsWith('*') ||
            /[;{}\])]$/.test(trimmed)) {
          return line;
        }

        // DON'T add semicolon if:
        // - Line ends with "=" (incomplete assignment)
        // - Line ends with "," (in object/array)
        // - Next line starts with "async" or "function" (method definition)
        // - Line is "export const name =" pattern
        if (/[=,]$/.test(trimmed) || 
            /^export\s+(const|let|var)\s+\w+\s*=$/.test(trimmed)) {
          return line;
        }

        // Check if next line starts with async/function (method in object)
        const nextLine = index + 1 < lines.length ? lines[index + 1].trim() : '';
        if (nextLine.startsWith('async ') || nextLine.startsWith('function ')) {
          return line;
        }

        // Check if line needs semicolon
        const needsSemicolon = /^(import|export|return|throw|break|continue|type|interface)\s+/.test(trimmed);
        const isCompleteStatement = /^(const|let|var)\s+\w+\s*=\s*.+[^=,]$/.test(trimmed);
        
        if ((needsSemicolon || isCompleteStatement) && !trimmed.endsWith(';')) {
          wasFixed = true;
          result.fixes.push({
            line: index + 1,
            type: 'missing-semicolon',
            before: line,
            after: line + ';'
          });
          return line + ';';
        }
        
        return line;
      });

      if (wasFixed) {
        fixedContent = fixedLines.join('\n');
        log(`Fixed missing semicolons in ${filePath}`, 'success');
      }
    }

    // Fix 3: Add missing commas between object methods
    if (['javascript', 'typescript'].includes(language)) {
      // Pattern: method end "}" followed by "async method" without comma
      const missingCommaBeforeMethod = /}\s*,?\s*\n\s*async\s+(\w+)/g;
      fixedContent = fixedContent.replace(missingCommaBeforeMethod, '},\n  async $1');
      
      // Pattern: regular properties missing commas
      const missingCommaPattern = /(\w+:\s*[^,\n]+)\s*\n\s*(\w+:)/g;
      if (missingCommaPattern.test(fixedContent)) {
        fixedContent = fixedContent.replace(missingCommaPattern, '$1,\n$2');
        wasFixed = true;
        result.fixes.push({
          type: 'missing-comma',
          description: 'Added missing commas in object literals'
        });
        log(`Fixed missing commas in ${filePath}`, 'success');
      }
    }

    // Fix 3: Fix common TypeScript type annotation issues
    if (language === 'typescript') {
      // Fix missing type imports
      if (fixedContent.includes('interface') && !fixedContent.includes('type ')) {
        // This is fine, TypeScript interfaces don't need type keyword
      }
      
      // Fix incomplete type annotations
      const incompleteTypes = /:\s*$/gm;
      if (incompleteTypes.test(fixedContent)) {
        fixedContent = fixedContent.replace(incompleteTypes, ': any');
        wasFixed = true;
        result.fixes.push({
          type: 'incomplete-type',
          description: 'Added default "any" type for incomplete annotations'
        });
      }
    }

    // Fix 5: Fix object literal ending with trailing comma (should end with }; not ,})
    fixedContent = fixedContent.replace(/,(\s*}\s*;?\s*)$/gm, '$1');

    // Fix 6: Balance brackets
    const openBraces = (fixedContent.match(/{/g) || []).length;
    const closeBraces = (fixedContent.match(/}/g) || []).length;
    const openParens = (fixedContent.match(/\(/g) || []).length;
    const closeParens = (fixedContent.match(/\)/g) || []).length;
    const openBrackets = (fixedContent.match(/\[/g) || []).length;
    const closeBrackets = (fixedContent.match(/\]/g) || []).length;

    if (openBraces > closeBraces) {
      // Smart closing: if last line ends with },  it's likely end of object method
      // Add the final closing brace for the object literal
      const lastNonEmptyLine = fixedContent.trim().split('\n').pop();
      if (lastNonEmptyLine && lastNonEmptyLine.trim().match(/^},?$/)) {
        fixedContent = fixedContent.trimEnd() + '\n};';
      } else {
        fixedContent += '\n' + '}'.repeat(openBraces - closeBraces);
      }
      wasFixed = true;
      result.fixes.push({
        type: 'missing-closing-brace',
        count: openBraces - closeBraces
      });
    }

    if (openParens > closeParens) {
      fixedContent += ')'.repeat(openParens - closeParens);
      wasFixed = true;
      result.fixes.push({
        type: 'missing-closing-paren',
        count: openParens - closeParens
      });
    }

    if (openBrackets > closeBrackets) {
      fixedContent += ']'.repeat(openBrackets - closeBrackets);
      wasFixed = true;
      result.fixes.push({
        type: 'missing-closing-bracket',
        count: openBrackets - closeBrackets
      });
    }

    // Fix 5: Remove trailing commas that cause issues
    fixedContent = fixedContent.replace(/,(\s*[}\]])/g, '$1');

    result.fixed = wasFixed;
    result.content = fixedContent;
    result.shouldCommit = wasFixed; // If we fixed something, we should commit it

    if (wasFixed) {
      log(`Applied ${result.fixes.length} syntax fix(es) to ${filePath}`, 'success');
      log(`📝 These fixes will be committed to the repository`, 'info');
    }

  } catch (error) {
    result.errors.push(error.message);
    log(`Failed to fix syntax in ${filePath}: ${error.message}`, 'warning');
  }

  return result;
}

/**
 * Detect syntax errors without fixing
 * @param {string} content - Code content
 * @param {string} language - Programming language
 * @returns {Array} - List of detected errors
 */
export function detectSyntaxErrors(content, language = 'javascript') {
  const errors = [];

  try {
    // Check bracket balance
    const brackets = {
      '{': 0,
      '[': 0,
      '(': 0
    };

    for (const char of content) {
      if (char === '{') brackets['{']++;
      if (char === '}') brackets['{']--;
      if (char === '[') brackets['[']++;
      if (char === ']') brackets['[']--;
      if (char === '(') brackets['(']++;
      if (char === ')') brackets['(']--;
    }

    if (brackets['{'] > 0) errors.push({ type: 'unclosed-brace', count: brackets['{'] });
    if (brackets['['] > 0) errors.push({ type: 'unclosed-bracket', count: brackets['['] });
    if (brackets['('] > 0) errors.push({ type: 'unclosed-paren', count: brackets['('] });
    if (brackets['{'] < 0) errors.push({ type: 'extra-closing-brace', count: -brackets['{'] });
    if (brackets['['] < 0) errors.push({ type: 'extra-closing-bracket', count: -brackets['['] });
    if (brackets['('] < 0) errors.push({ type: 'extra-closing-paren', count: -brackets['('] });

    // Check for common issues
    if (['javascript', 'typescript'].includes(language)) {
      // Detect missing semicolons
      const lines = content.split('\n');
      let missingSemicolons = 0;
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line && 
            !line.startsWith('//') && 
            !line.startsWith('/*') &&
            /^(import|export|return|const|let|var)\s+/.test(line) &&
            !line.endsWith(';') &&
            !line.endsWith('{') &&
            !line.endsWith('}')) {
          missingSemicolons++;
        }
      }

      if (missingSemicolons > 0) {
        errors.push({ 
          type: 'missing-semicolons', 
          count: missingSemicolons,
          severity: 'warning'
        });
      }
    }

  } catch (error) {
    errors.push({ type: 'detection-error', message: error.message });
  }

  return errors;
}

/**
 * Create a syntax error report
 * @param {Array} errors - List of errors
 * @returns {string} - Formatted report
 */
export function createErrorReport(errors) {
  if (errors.length === 0) {
    return 'No syntax errors detected';
  }

  const report = [];
  report.push(`Found ${errors.length} syntax issue(s):`);
  
  for (const error of errors) {
    if (error.type === 'unclosed-brace') {
      report.push(`  - ${error.count} unclosed brace(s) {`);
    } else if (error.type === 'unclosed-bracket') {
      report.push(`  - ${error.count} unclosed bracket(s) [`);
    } else if (error.type === 'unclosed-paren') {
      report.push(`  - ${error.count} unclosed parenthesis(es) (`);
    } else if (error.type === 'missing-semicolons') {
      report.push(`  - ${error.count} missing semicolon(s) (warning)`);
    } else {
      report.push(`  - ${error.type}: ${JSON.stringify(error)}`);
    }
  }

  return report.join('\n');
}

/**
 * Smart syntax fixer that attempts multiple strategies
 * @param {string} content - Code content
 * @param {string} filePath - File path
 * @param {Error} parseError - Original parse error
 * @returns {Object} - Fixed result
 */
export function smartFix(content, filePath, parseError) {
  const language = filePath.endsWith('.ts') || filePath.endsWith('.tsx') ? 'typescript' : 'javascript';
  
  log(`Attempting to fix syntax errors in ${filePath}...`, 'ghost');
  
  // First, detect what's wrong
  const detectedErrors = detectSyntaxErrors(content, language);
  
  if (detectedErrors.length > 0) {
    log(createErrorReport(detectedErrors), 'info');
  }
  
  // Attempt fixes
  const result = attemptSyntaxFix(content, filePath, language);
  
  if (result.fixed && result.fixes.length > 0) {
    log(`✨ Successfully applied ${result.fixes.length} fix(es):`, 'success');
    for (const fix of result.fixes) {
      if (fix.line) {
        log(`   Line ${fix.line}: ${fix.type}`, 'info');
      } else {
        log(`   ${fix.type}: ${fix.description || fix.count || ''}`, 'info');
      }
    }
  }
  
  return result;
}

/**
 * Validate if fixed code is better than original
 * @param {string} original - Original content
 * @param {string} fixed - Fixed content
 * @returns {boolean} - True if fixed version is valid
 */
export function validateFix(original, fixed) {
  // Basic validation: check if we didn't break anything
  const originalLines = original.split('\n').length;
  const fixedLines = fixed.split('\n').length;
  
  // If we added more than 10% more lines, something might be wrong
  if (fixedLines > originalLines * 1.1) {
    return false;
  }
  
  // Check bracket balance
  const brackets = ['{', '}', '[', ']', '(', ')'];
  for (const bracket of brackets) {
    const originalCount = (original.match(new RegExp(`\\${bracket}`, 'g')) || []).length;
    const fixedCount = (fixed.match(new RegExp(`\\${bracket}`, 'g')) || []).length;
    
    // Make sure we didn't drastically change bracket counts
    if (Math.abs(fixedCount - originalCount) > 3) {
      return false;
    }
  }
  
  return true;
}
