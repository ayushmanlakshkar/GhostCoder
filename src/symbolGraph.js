/**
 * 👻 GhostCoder - Symbol Graph Builder
 * 
 * Extracts functions, classes, imports, exports, and their relationships
 * from code files using AST parsing. Creates a semantic graph similar to
 * GitHub Copilot's symbol index.
 * 
 * Author: Ayushman Lakshkar
 */

import * as parser from '@babel/parser';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import fs from 'fs/promises';
import path from 'path';
import { log } from './utils.js';
import { smartFix } from './syntaxFixer.js';
import { semanticFix } from './semanticFixer.js';

/**
 * Symbol types that we track
 */
export const SymbolType = {
  FUNCTION: 'function',
  CLASS: 'class',
  METHOD: 'method',
  VARIABLE: 'variable',
  IMPORT: 'import',
  EXPORT: 'export',
  INTERFACE: 'interface',
  TYPE: 'type'
};

/**
 * Build a symbol graph for a repository
 * @param {Array<{path: string, content: string}>} codeFiles - Array of code files
 * @param {string} repoPath - Root path of the repository
 * @returns {Promise<Object>} Symbol graph with nodes and edges, plus syntax fixes
 */
export async function buildSymbolGraph(codeFiles, repoPath) {
  log('Building symbol graph...', 'code');
  
  const graph = {
    symbols: new Map(), // symbolId -> symbol metadata
    files: new Map(),   // filePath -> file metadata
    edges: [],          // relationships between symbols
    imports: new Map(), // import relationships
    calls: new Map(),   // function call relationships
    syntaxFixes: [],    // files with syntax fixes that should be committed
    metadata: {
      totalSymbols: 0,
      totalFiles: codeFiles.length,
      buildTime: Date.now()
    }
  };

  // Phase 1: Run semantic analysis to detect typos in export/import names
  log('🔍 Phase 1: Running semantic analysis...', 'ghost');
  const semanticFixResults = new Map();
  
  // Scan entire repository for import context (not just analyzed files)
  let allRepoFiles = codeFiles;
  try {
    // Try to get all files in the repo for better context
    const allFiles = await getAllCodeFiles(repoPath);
    if (allFiles.length > codeFiles.length) {
      log(`📚 Loaded ${allFiles.length} files from repository for semantic context`, 'info');
      allRepoFiles = allFiles;
    }
  } catch (error) {
    log('Using only analyzed files for semantic context', 'info');
  }
  
  for (const file of codeFiles) {
    try {
      const result = await semanticFix(file.content, file.path, allRepoFiles);
      if (result.fixed) {
        semanticFixResults.set(file.path, result);
        // Update file content with semantic fixes
        file.content = result.content;
      }
    } catch (error) {
      log(`Semantic analysis failed for ${file.path}: ${error.message}`, 'warning');
    }
  }
  
  if (semanticFixResults.size > 0) {
    log(`✅ Applied semantic fixes to ${semanticFixResults.size} file(s)`, 'success');
  }

  // Phase 2: Analyze files and extract symbols (with syntactic fixes if needed)
  log('📊 Phase 2: Extracting symbols...', 'ghost');
  for (const file of codeFiles) {
    try {
      await analyzeFile(file, graph, repoPath, semanticFixResults.get(file.path));
    } catch (error) {
      log(`Failed to analyze ${file.path}: ${error.message}`, 'warning');
    }
  }

  graph.metadata.totalSymbols = graph.symbols.size;
  log(`Symbol graph built: ${graph.symbols.size} symbols, ${graph.edges.length} relationships`, 'success');
  
  return serializeGraph(graph);
}

/**
 * Analyze a single file and extract symbols
 * @param {Object} file - File object with path and content
 * @param {Object} graph - Symbol graph to populate
 * @param {string} repoPath - Repository root path
 * @param {Object} semanticFixResult - Previously applied semantic fixes
 * @returns {Promise<Object>} Result with symbols and any syntax fixes
 */
async function analyzeFile(file, graph, repoPath, semanticFixResult = null) {
  const ext = path.extname(file.path).toLowerCase();
  
  // Determine parser based on file extension
  let symbols = [];
  let syntaxFixApplied = semanticFixResult; // Start with semantic fixes if any
  
  if (['.js', '.jsx', '.mjs'].includes(ext)) {
    const result = await parseJavaScript(file.content, file.path);
    symbols = result.symbols;
    syntaxFixApplied = result.fixApplied;
  } else if (['.ts', '.tsx'].includes(ext)) {
    const result = await parseTypeScript(file.content, file.path);
    symbols = result.symbols;
    syntaxFixApplied = result.fixApplied;
  } else if (['.py'].includes(ext)) {
    const result = await parsePython(file.content, file.path);
    symbols = result.symbols;
    syntaxFixApplied = result.fixApplied;
  } else {
    // Generic extraction for other languages
    symbols = await extractGenericSymbols(file.content, file.path);
  }
  
  // Track syntax fixes if any were applied
  if (syntaxFixApplied && syntaxFixApplied.shouldCommit) {
    log(`📝 Tracking syntax fix for ${file.path} to be committed`, 'info');
    graph.syntaxFixes.push({
      filePath: file.path,
      originalContent: file.content,
      fixedContent: syntaxFixApplied.content,
      fixes: syntaxFixApplied.fixes
    });
  } else if (syntaxFixApplied && !syntaxFixApplied.shouldCommit) {
    log(`⚠️ Syntax fix applied to ${file.path} but shouldCommit=false`, 'warning');
  }

  // Add file metadata
  graph.files.set(file.path, {
    path: file.path,
    language: detectLanguage(ext),
    symbolCount: symbols.length,
    size: file.content.length,
    imports: symbols.filter(s => s.type === SymbolType.IMPORT),
    exports: symbols.filter(s => s.type === SymbolType.EXPORT)
  });

  // Add symbols to graph
  for (const symbol of symbols) {
    const symbolId = `${file.path}::${symbol.name}`;
    graph.symbols.set(symbolId, {
      ...symbol,
      id: symbolId,
      file: file.path
    });
  }

  // Build edges (relationships)
  buildEdges(symbols, file.path, graph);
}

/**
 * Parse JavaScript/JSX files using Babel parser
 * @returns {Promise<Object>} Object with symbols array and fixApplied info
 */
async function parseJavaScript(content, filePath) {
  const symbols = [];
  let fixApplied = null;
  
  try {
    const ast = parser.parse(content, {
      sourceType: 'module',
      plugins: ['jsx', 'dynamicImport', 'classProperties', 'decorators-legacy']
    });

    // Extract imports
    for (const node of ast.program.body) {
      if (node.type === 'ImportDeclaration') {
        for (const specifier of node.specifiers) {
          symbols.push({
            name: specifier.local.name,
            type: SymbolType.IMPORT,
            from: node.source.value,
            line: node.loc.start.line,
            documentation: extractDocstring(content, node.loc.start.line)
          });
        }
      }

      // Extract function declarations
      if (node.type === 'FunctionDeclaration' && node.id) {
        symbols.push({
          name: node.id.name,
          type: SymbolType.FUNCTION,
          params: node.params.map(p => getParamName(p)),
          line: node.loc.start.line,
          async: node.async,
          documentation: extractDocstring(content, node.loc.start.line),
          signature: generateSignature(node)
        });
      }

      // Extract class declarations
      if (node.type === 'ClassDeclaration' && node.id) {
        const className = node.id.name;
        symbols.push({
          name: className,
          type: SymbolType.CLASS,
          line: node.loc.start.line,
          documentation: extractDocstring(content, node.loc.start.line),
          methods: []
        });

        // Extract methods
        for (const member of node.body.body) {
          if (member.type === 'MethodDefinition' && member.key) {
            symbols.push({
              name: `${className}.${member.key.name || member.key.value}`,
              type: SymbolType.METHOD,
              className: className,
              params: member.value.params.map(p => getParamName(p)),
              line: member.loc.start.line,
              async: member.value.async,
              static: member.static,
              documentation: extractDocstring(content, member.loc.start.line)
            });
          }
        }
      }

      // Extract variable/const declarations
      if (node.type === 'VariableDeclaration') {
        for (const decl of node.declarations) {
          if (decl.id && decl.id.name) {
            symbols.push({
              name: decl.id.name,
              type: SymbolType.VARIABLE,
              kind: node.kind, // var, let, const
              line: node.loc.start.line,
              exported: false
            });
          }
        }
      }

      // Extract exports
      if (node.type === 'ExportNamedDeclaration') {
        if (node.declaration) {
          const name = node.declaration.id?.name || node.declaration.declarations?.[0]?.id?.name;
          if (name) {
            symbols.push({
              name: name,
              type: SymbolType.EXPORT,
              line: node.loc.start.line,
              exported: true
            });
          }
        }
      }

      if (node.type === 'ExportDefaultDeclaration') {
        const name = node.declaration.id?.name || node.declaration.name || 'default';
        symbols.push({
          name: name,
          type: SymbolType.EXPORT,
          line: node.loc.start.line,
          default: true
        });
      }
    }
  } catch (error) {
    log(`Failed to parse JavaScript in ${filePath}: ${error.message}`, 'warning');
    
    // Attempt to fix syntax errors and retry
    const fixResult = smartFix(content, filePath, error);
    
    if (fixResult.fixed) {
      try {
        log(`Retrying parse with fixed content...`, 'info');
        const ast = parser.parse(fixResult.content, {
          sourceType: 'module',
          plugins: ['jsx', 'dynamicImport', 'classProperties', 'decorators-legacy']
        });
        
        // Re-extract symbols from fixed AST
        // (Same extraction logic as above)
        for (const node of ast.program.body) {
          if (node.type === 'ImportDeclaration') {
            for (const specifier of node.specifiers) {
              symbols.push({
                name: specifier.local.name,
                type: SymbolType.IMPORT,
                from: node.source.value,
                line: node.loc.start.line
              });
            }
          }
          if (node.type === 'FunctionDeclaration' && node.id) {
            symbols.push({
              name: node.id.name,
              type: SymbolType.FUNCTION,
              params: node.params.map(p => getParamName(p)),
              line: node.loc.start.line
            });
          }
          if (node.type === 'ClassDeclaration' && node.id) {
            symbols.push({
              name: node.id.name,
              type: SymbolType.CLASS,
              line: node.loc.start.line
            });
          }
        }
        
        log(`✅ Successfully parsed after syntax fixes!`, 'success');
        fixApplied = fixResult;
        return { symbols, fixApplied };
      } catch (retryError) {
        log(`Still failed after fixes: ${retryError.message}`, 'warning');
      }
    }
    
    // Fall back to regex-based extraction
    const genericSymbols = await extractGenericSymbols(content, filePath);
    return { symbols: genericSymbols, fixApplied: null };
  }

  return { symbols, fixApplied };
}

/**
 * Parse TypeScript files (similar to JavaScript but with type support)
 * @returns {Promise<Object>} Object with symbols array and fixApplied info
 */
async function parseTypeScript(content, filePath) {
  const symbols = [];
  let fixApplied = null;
  
  try {
    const ast = parser.parse(content, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx', 'decorators-legacy', 'classProperties']
    });

    // Extract all symbols from TypeScript AST
    for (const node of ast.program.body) {
      // Handle imports
      if (node.type === 'ImportDeclaration') {
        for (const specifier of node.specifiers) {
          symbols.push({
            name: specifier.local.name,
            type: SymbolType.IMPORT,
            from: node.source.value,
            line: node.loc.start.line,
            documentation: extractDocstring(content, node.loc.start.line)
          });
        }
      }

      // Handle interfaces
      if (node.type === 'TSInterfaceDeclaration' && node.id) {
        symbols.push({
          name: node.id.name,
          type: SymbolType.INTERFACE,
          line: node.loc.start.line,
          documentation: extractDocstring(content, node.loc.start.line)
        });
      }

      // Handle type aliases
      if (node.type === 'TSTypeAliasDeclaration' && node.id) {
        symbols.push({
          name: node.id.name,
          type: SymbolType.TYPE,
          line: node.loc.start.line,
          documentation: extractDocstring(content, node.loc.start.line)
        });
      }

      // Handle function declarations
      if (node.type === 'FunctionDeclaration' && node.id) {
        symbols.push({
          name: node.id.name,
          type: SymbolType.FUNCTION,
          params: node.params.map(p => getParamName(p)),
          line: node.loc.start.line,
          async: node.async,
          documentation: extractDocstring(content, node.loc.start.line),
          signature: generateSignature(node)
        });
      }

      // Handle class declarations
      if (node.type === 'ClassDeclaration' && node.id) {
        const className = node.id.name;
        symbols.push({
          name: className,
          type: SymbolType.CLASS,
          line: node.loc.start.line,
          documentation: extractDocstring(content, node.loc.start.line),
          methods: []
        });

        // Extract methods
        for (const member of node.body.body) {
          if (member.type === 'MethodDefinition' && member.key) {
            symbols.push({
              name: `${className}.${member.key.name || member.key.value}`,
              type: SymbolType.METHOD,
              className: className,
              params: member.value.params.map(p => getParamName(p)),
              line: member.loc.start.line,
              async: member.value.async,
              static: member.static,
              documentation: extractDocstring(content, member.loc.start.line)
            });
          }
        }
      }

      // Handle variable/const declarations
      if (node.type === 'VariableDeclaration') {
        for (const decl of node.declarations) {
          if (decl.id && decl.id.name) {
            symbols.push({
              name: decl.id.name,
              type: SymbolType.VARIABLE,
              kind: node.kind,
              line: node.loc.start.line,
              exported: false
            });
          }
        }
      }

      // Handle exports
      if (node.type === 'ExportNamedDeclaration') {
        if (node.declaration) {
          const name = node.declaration.id?.name || node.declaration.declarations?.[0]?.id?.name;
          if (name) {
            symbols.push({
              name: name,
              type: SymbolType.EXPORT,
              line: node.loc.start.line,
              exported: true
            });
          }
        }
      }

      if (node.type === 'ExportDefaultDeclaration') {
        const name = node.declaration.id?.name || node.declaration.name || 'default';
        symbols.push({
          name: name,
          type: SymbolType.EXPORT,
          line: node.loc.start.line,
          default: true
        });
      }
    }

  } catch (error) {
    log(`Failed to parse TypeScript in ${filePath}: ${error.message}`, 'warning');
    
    // Attempt to fix syntax errors and retry
    const fixResult = smartFix(content, filePath, error);
    
    if (fixResult.fixed) {
      try {
        log(`Retrying TypeScript parse with fixed content...`, 'info');
        const ast = parser.parse(fixResult.content, {
          sourceType: 'module',
          plugins: ['typescript', 'jsx', 'decorators-legacy', 'classProperties']
        });
        
        // Re-extract symbols from fixed AST
        for (const node of ast.program.body) {
          if (node.type === 'ImportDeclaration') {
            for (const specifier of node.specifiers) {
              symbols.push({
                name: specifier.local.name,
                type: SymbolType.IMPORT,
                from: node.source.value,
                line: node.loc.start.line
              });
            }
          }
          if (node.type === 'FunctionDeclaration' && node.id) {
            symbols.push({
              name: node.id.name,
              type: SymbolType.FUNCTION,
              params: node.params.map(p => getParamName(p)),
              line: node.loc.start.line
            });
          }
          if (node.type === 'ClassDeclaration' && node.id) {
            symbols.push({
              name: node.id.name,
              type: SymbolType.CLASS,
              line: node.loc.start.line
            });
          }
          if (node.type === 'TSInterfaceDeclaration' && node.id) {
            symbols.push({
              name: node.id.name,
              type: SymbolType.INTERFACE,
              line: node.loc.start.line
            });
          }
          if (node.type === 'TSTypeAliasDeclaration' && node.id) {
            symbols.push({
              name: node.id.name,
              type: SymbolType.TYPE,
              line: node.loc.start.line
            });
          }
        }
        
        log(`✅ Successfully parsed TypeScript after syntax fixes!`, 'success');
        fixApplied = fixResult;
        return { symbols, fixApplied };
      } catch (retryError) {
        log(`Still failed after fixes: ${retryError.message}`, 'warning');
      }
    }
    
    const genericSymbols = await extractGenericSymbols(content, filePath);
    return { symbols: genericSymbols, fixApplied: null };
  }

  return { symbols, fixApplied };
}

/**
 * Parse Python files using regex (simplified)
 * @returns {Promise<Object>} Object with symbols array and fixApplied info
 */
async function parsePython(content, filePath) {
  const symbols = [];
  let fixApplied = null;
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Extract imports
    const importMatch = line.match(/^(?:from\s+(\S+)\s+)?import\s+(.+)/);
    if (importMatch) {
      const imports = importMatch[2].split(',').map(s => s.trim().split(' as ')[0]);
      for (const imp of imports) {
        symbols.push({
          name: imp,
          type: SymbolType.IMPORT,
          from: importMatch[1] || null,
          line: lineNum
        });
      }
    }

    // Extract function definitions
    const funcMatch = line.match(/^def\s+(\w+)\s*\((.*?)\)/);
    if (funcMatch) {
      symbols.push({
        name: funcMatch[1],
        type: SymbolType.FUNCTION,
        params: funcMatch[2].split(',').map(p => p.trim().split('=')[0].trim()).filter(Boolean),
        line: lineNum,
        documentation: extractPythonDocstring(lines, i)
      });
    }

    // Extract class definitions
    const classMatch = line.match(/^class\s+(\w+)(?:\(.*?\))?:/);
    if (classMatch) {
      symbols.push({
        name: classMatch[1],
        type: SymbolType.CLASS,
        line: lineNum,
        documentation: extractPythonDocstring(lines, i)
      });
    }
  }

  return { symbols, fixApplied };
}

/**
 * Generic symbol extraction using regex (fallback for unsupported languages)
 */
async function extractGenericSymbols(content, filePath) {
  const symbols = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Try to match common function patterns
    const funcPatterns = [
      /function\s+(\w+)\s*\(/,
      /def\s+(\w+)\s*\(/,
      /(\w+)\s*[:=]\s*function\s*\(/,
      /(\w+)\s*[:=]\s*\([^)]*\)\s*=>/,
      /const\s+(\w+)\s*=\s*\([^)]*\)\s*=>/
    ];

    for (const pattern of funcPatterns) {
      const match = line.match(pattern);
      if (match) {
        symbols.push({
          name: match[1],
          type: SymbolType.FUNCTION,
          line: lineNum,
          documentation: null
        });
        break;
      }
    }

    // Try to match class patterns
    const classPatterns = [
      /class\s+(\w+)/,
      /interface\s+(\w+)/,
      /type\s+(\w+)\s*=/
    ];

    for (const pattern of classPatterns) {
      const match = line.match(pattern);
      if (match) {
        symbols.push({
          name: match[1],
          type: SymbolType.CLASS,
          line: lineNum,
          documentation: null
        });
        break;
      }
    }
  }

  return symbols;
}

/**
 * Extract docstring from comments above a line
 */
function extractDocstring(content, line) {
  const lines = content.split('\n');
  let docstring = '';
  
  // Look backwards from the line
  for (let i = line - 2; i >= 0 && i >= line - 10; i--) {
    const l = lines[i].trim();
    if (l.startsWith('//') || l.startsWith('*') || l.startsWith('/*')) {
      docstring = l.replace(/^(\/\/|\*|\/\*\*?)\s*/, '') + ' ' + docstring;
    } else if (l === '' || l === '/**' || l === '*/') {
      continue;
    } else {
      break;
    }
  }
  
  return docstring.trim() || null;
}

/**
 * Extract Python docstring
 */
function extractPythonDocstring(lines, startIndex) {
  if (startIndex + 1 < lines.length) {
    const nextLine = lines[startIndex + 1].trim();
    if (nextLine.startsWith('"""') || nextLine.startsWith("'''")) {
      const quote = nextLine.substring(0, 3);
      let docstring = nextLine.substring(3);
      
      if (docstring.endsWith(quote)) {
        return docstring.substring(0, docstring.length - 3).trim();
      }
      
      for (let i = startIndex + 2; i < lines.length && i < startIndex + 20; i++) {
        const line = lines[i];
        if (line.includes(quote)) {
          docstring += ' ' + line.substring(0, line.indexOf(quote));
          break;
        }
        docstring += ' ' + line.trim();
      }
      
      return docstring.trim();
    }
  }
  return null;
}

/**
 * Get parameter name from AST node
 */
function getParamName(param) {
  if (param.type === 'Identifier') return param.name;
  if (param.type === 'AssignmentPattern') return getParamName(param.left);
  if (param.type === 'RestElement') return '...' + getParamName(param.argument);
  return 'param';
}

/**
 * Generate function signature
 */
function generateSignature(node) {
  if (node.type === 'FunctionDeclaration') {
    const params = node.params.map(p => getParamName(p)).join(', ');
    const async = node.async ? 'async ' : '';
    return `${async}function ${node.id.name}(${params})`;
  }
  return null;
}

/**
 * Build edges (relationships) between symbols
 */
function buildEdges(symbols, filePath, graph) {
  // Build import relationships
  const imports = symbols.filter(s => s.type === SymbolType.IMPORT);
  const functions = symbols.filter(s => s.type === SymbolType.FUNCTION);
  const classes = symbols.filter(s => s.type === SymbolType.CLASS);

  for (const imp of imports) {
    graph.edges.push({
      from: `${filePath}::${imp.name}`,
      to: `${imp.from}::${imp.name}`,
      type: 'imports'
    });
  }

  // Build inheritance relationships (could be expanded)
  for (const cls of classes) {
    if (cls.extends) {
      graph.edges.push({
        from: `${filePath}::${cls.name}`,
        to: `${filePath}::${cls.extends}`,
        type: 'extends'
      });
    }
  }
}

/**
 * Detect language from file extension
 */
function detectLanguage(ext) {
  const languageMap = {
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.mjs': 'javascript',
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.py': 'python',
    '.java': 'java',
    '.cpp': 'cpp',
    '.c': 'c',
    '.go': 'go',
    '.rs': 'rust',
    '.rb': 'ruby',
    '.php': 'php'
  };
  
  return languageMap[ext] || 'unknown';
}

/**
 * Serialize graph to JSON-compatible format
 */
function serializeGraph(graph) {
  return {
    symbols: Object.fromEntries(graph.symbols),
    files: Object.fromEntries(graph.files),
    edges: graph.edges,
    imports: Object.fromEntries(graph.imports),
    calls: Object.fromEntries(graph.calls),
    syntaxFixes: graph.syntaxFixes,  // Include syntax fixes
    metadata: graph.metadata
  };
}

/**
 * Find symbols by name (fuzzy search)
 */
export function findSymbolsByName(graph, query) {
  const results = [];
  const lowerQuery = query.toLowerCase();
  
  for (const [id, symbol] of Object.entries(graph.symbols)) {
    if (symbol.name.toLowerCase().includes(lowerQuery)) {
      results.push(symbol);
    }
  }
  
  return results;
}

/**
 * Find all references to a symbol
 */
export function findReferences(graph, symbolName) {
  const references = [];
  
  for (const edge of graph.edges) {
    if (edge.to.includes(symbolName) || edge.from.includes(symbolName)) {
      references.push(edge);
    }
  }
  
  return references;
}

/**
 * Get symbol hierarchy (e.g., class methods, nested functions)
 */
export function getSymbolHierarchy(graph, filePath) {
  const hierarchy = {
    classes: [],
    functions: [],
    imports: [],
    exports: []
  };
  
  for (const [id, symbol] of Object.entries(graph.symbols)) {
    if (symbol.file === filePath) {
      if (symbol.type === SymbolType.CLASS) {
        hierarchy.classes.push(symbol);
      } else if (symbol.type === SymbolType.FUNCTION) {
        hierarchy.functions.push(symbol);
      } else if (symbol.type === SymbolType.IMPORT) {
        hierarchy.imports.push(symbol);
      } else if (symbol.type === SymbolType.EXPORT) {
        hierarchy.exports.push(symbol);
      }
    }
  }
  
  return hierarchy;
}

/**
 * Get all code files in a repository (for semantic analysis context)
 * @param {string} repoPath - Repository root path
 * @returns {Promise<Array<{path: string, content: string}>>}
 */
async function getAllCodeFiles(repoPath) {
  const codeExtensions = ['.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.go', '.rs', '.cpp', '.c', '.h'];
  const files = [];
  
  async function scanDirectory(dir) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        // Skip common directories
        if (entry.isDirectory()) {
          const skipDirs = ['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '__pycache__'];
          if (!skipDirs.includes(entry.name)) {
            await scanDirectory(fullPath);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if (codeExtensions.includes(ext)) {
            try {
              const content = await fs.readFile(fullPath, 'utf-8');
              const relativePath = path.relative(repoPath, fullPath);
              files.push({ path: relativePath, content });
            } catch (error) {
              // Skip files that can't be read
            }
          }
        }
      }
    } catch (error) {
      // Skip directories that can't be read
    }
  }
  
  await scanDirectory(repoPath);
  return files;
}
