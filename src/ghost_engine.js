#!/usr/bin/env node
/**
 * 👻 GhostCoder Backend - Main Workflow Engine
 * Author: Ayushman Lakshkar
 * 
 * Usage: node ghost_engine.js <github-repo-url>
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { 
  log, 
  parseGitHubUrl, 
  getCodeFiles, 
  deleteDirectory, 
  validateEnvVars,
  formatChangeSummary,
  ensureDirectory
} from './utils.js';
import { analyzeCodeWithAI, generateImprovedCode } from './openrouter_api.js';
import { cloneRepository, createBranch, applyChanges, commitChanges, pushBranch } from './repo_manager.js';
import { createPullRequest, getRepoInfo, addLabelsToPR, commentOnPR } from './github_api.js';
import { buildSymbolGraph } from './symbolGraph.js';
import { buildEmbeddingIndex, loadIndex, indexExists, deleteIndex } from './embeddingIndex.js';
import { retrieveContext, formatContextForAI, createCompactContext } from './contextRetriever.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Main GhostCoder workflow
 * @param {string} repoUrl - GitHub repository URL
 * @param {Object} options - Configuration options
 * @param {string} options.baseBranch - Base branch to analyze (defaults to repo's default branch)
 * @param {string} options.analyzePath - Specific path/folder to analyze (defaults to root)
 * @returns {Promise<Object>} Summary of the ghostcoder run
 */
async function runGhostCoder(repoUrl, options = {}) {
  let tempRepoPath = null;
  const { baseBranch = null, analyzePath = '' } = options;
  
  try {
    // Validate environment variables
    validateEnvVars(['OPENROUTER_API_KEY', 'GITHUB_TOKEN']);
    
    log('🚀 GhostCoder Engine Starting...', 'ghost');
    log(`Target Repository: ${repoUrl}`, 'info');
    
    // Step 1: Parse GitHub URL
    const { owner, repo } = parseGitHubUrl(repoUrl);
    log(`Repository: ${owner}/${repo}`, 'info');
    
    // Step 2: Get repository information
    const repoInfo = await getRepoInfo(owner, repo);
    log(`Repository Info: ${repoInfo.description || 'No description'}`, 'info');
    log(`Primary Language: ${repoInfo.language || 'Unknown'}`, 'info');
    log(`Default Branch: ${repoInfo.defaultBranch}`, 'info');
    
    // Determine the base branch to use
    const targetBaseBranch = baseBranch || repoInfo.defaultBranch;
    log(`Target Base Branch: ${targetBaseBranch}`, 'info');
    
    // Determine the analysis path
    const targetAnalyzePath = analyzePath || '';
    if (targetAnalyzePath) {
      log(`Analysis Path: ${targetAnalyzePath}`, 'info');
    } else {
      log(`Analysis Path: / (root)`, 'info');
    }
    
    // Step 3: Clone repository
    const tempDir = process.env.TEMP_DIR || path.join(__dirname, '..', 'temp_repos');
    await ensureDirectory(tempDir);
    tempRepoPath = path.join(tempDir, `${repo}-${Date.now()}`);
    
    await cloneRepository(repoUrl, tempRepoPath, targetBaseBranch);
    
    // Step 4: Validate and prepare scan path
    const scanPath = targetAnalyzePath 
      ? path.join(tempRepoPath, targetAnalyzePath) 
      : tempRepoPath;
    
    // Validate that the specified path exists
    if (targetAnalyzePath) {
      const fs = await import('fs/promises');
      try {
        const stats = await fs.stat(scanPath);
        if (!stats.isDirectory()) {
          log(`Specified path is not a directory: ${targetAnalyzePath}`, 'error');
          await deleteDirectory(tempRepoPath);
          throw new Error(`Path "${targetAnalyzePath}" is not a directory`);
        }
      } catch (error) {
        if (error.code === 'ENOENT') {
          log(`Specified path does not exist: ${targetAnalyzePath}`, 'error');
          await deleteDirectory(tempRepoPath);
          throw new Error(`Path "${targetAnalyzePath}" does not exist in the repository`);
        }
        throw error;
      }
    }
    
    // Step 5: Scan and collect code files
    log('Scanning repository for code files...', 'code');
    const codeFiles = await getCodeFiles(scanPath);
    
    if (codeFiles.length === 0) {
      log('No code files found to analyze', 'warning');
      return {
        ghost_name: 'GhostCoder',
        repo: `${owner}/${repo}`,
        status: 'no_files_found',
        message: 'No analyzable code files found in repository'
      };
    }
    
    log(`Found ${codeFiles.length} code files to analyze`, 'success');
    
    // Step 6: Build Symbol Graph and Embedding Index
    const repoId = `${owner}/${repo}`;
    log('Building symbol graph and semantic index...', 'ghost');
    
    const symbolGraph = await buildSymbolGraph(codeFiles, tempRepoPath);
    log(`Symbol graph built with ${Object.keys(symbolGraph.symbols).length} symbols`, 'success');
    log(`Syntax fixes found: ${symbolGraph.syntaxFixes ? symbolGraph.syntaxFixes.length : 0}`, 'info');
    
    // Step 6a: Write syntax-fixed files to disk and commit if any
    let syntaxFixesBranch = null;
    if (symbolGraph.syntaxFixes && symbolGraph.syntaxFixes.length > 0) {
      log(`Writing ${symbolGraph.syntaxFixes.length} syntax-fixed file(s) to disk...`, 'code');
      const fs = await import('fs/promises');
      
      for (const fix of symbolGraph.syntaxFixes) {
        const absolutePath = path.join(tempRepoPath, fix.filePath);
        await fs.writeFile(absolutePath, fix.fixedContent, 'utf-8');
        log(`✅ Fixed: ${fix.filePath}`, 'success');
      }
      
      // Create branch and commit syntax fixes immediately
      log('Creating branch for syntax fixes...', 'code');
      syntaxFixesBranch = await createBranch(tempRepoPath);
      
      log('Committing syntax fixes...', 'code');
      await commitChanges(
        tempRepoPath, 
        `🔧 Auto-fix syntax errors (${symbolGraph.syntaxFixes.length} file${symbolGraph.syntaxFixes.length > 1 ? 's' : ''})`
      );
      log('✅ Syntax fixes committed', 'success');
    }
    
    // Check if index exists, otherwise build it
    let embeddingIndex;
    if (await indexExists(repoId)) {
      log('Loading existing embedding index...', 'info');
      embeddingIndex = await loadIndex(repoId);
    } else {
      log('Building embedding index (this may take a few minutes)...', 'ghost');
      embeddingIndex = await buildEmbeddingIndex(symbolGraph, repoId);
    }
    
    // Step 7: Retrieve relevant context using semantic search
    log('Retrieving relevant context for analysis...', 'code');
    const context = await retrieveContext(embeddingIndex, symbolGraph, scanPath, {
      query: 'code quality issues, bugs, security vulnerabilities, performance problems, best practices violations',
      maxFiles: 10,
      maxSymbols: 50,
      includeFullFiles: false
    });
    
    // Create compact context to minimize tokens
    const compactContext = createCompactContext(context, 30000);
    const formattedContext = formatContextForAI(compactContext);
    
    log(`Context prepared: ${compactContext.relevantFiles.length} files, ${compactContext.relevantSymbols.length} symbols`, 'success');
    
    // Step 8: Analyze code with AI using semantic context
    const analysis = await analyzeCodeWithAI(formattedContext, repoId, symbolGraph);
    
    if (!analysis || !analysis.improvements || analysis.improvements.length === 0) {
      log('AI did not suggest any improvements', 'info');
      
      // If we have syntax fixes but no AI improvements, still create PR for syntax fixes
      if (syntaxFixesBranch && symbolGraph.syntaxFixes && symbolGraph.syntaxFixes.length > 0) {
        log('Creating PR for syntax fixes only...', 'ghost');
        
        // Push branch with syntax fixes
        await pushBranch(tempRepoPath, syntaxFixesBranch, process.env.GITHUB_TOKEN);
        
        // Create PR for syntax fixes
        const prTitle = `🔧 Auto-fix syntax errors (${symbolGraph.syntaxFixes.length} file${symbolGraph.syntaxFixes.length > 1 ? 's' : ''})`;
        const prBody = createSyntaxFixPRBody(symbolGraph.syntaxFixes);
        
        const pr = await createPullRequest({
          owner,
          repo,
          branchName: syntaxFixesBranch,
          baseBranch: targetBaseBranch,
          title: prTitle,
          body: prBody
        });
        
        await addLabelsToPR(owner, repo, pr.number, ['ghostcoder', 'syntax-fix', 'automated']);
        
        const comment = '👻 This PR was automatically generated by GhostCoder to fix syntax errors!\n\n' +
                       `Fixed ${symbolGraph.syntaxFixes.length} file(s) with syntax errors.\n\n` +
                       'These fixes were necessary to properly parse and analyze the code.';
        await commentOnPR(owner, repo, pr.number, comment);
        
        await deleteDirectory(tempRepoPath);
        
        // Delete embedding index
        log('Cleaning up embedding index...', 'info');
        await deleteIndex(repoId);
        
        return {
          ghost_name: 'GhostCoder',
          repo: `${owner}/${repo}`,
          status: 'syntax_fixes_only',
          message: `Created PR with syntax fixes for ${symbolGraph.syntaxFixes.length} file(s)`,
          pr_url: pr.html_url,
          pr_number: pr.number
        };
      }
      
      await deleteDirectory(tempRepoPath);
      
      // Delete embedding index
      log('Cleaning up embedding index...', 'info');
      await deleteIndex(repoId);
      
      return {
        ghost_name: 'GhostCoder',
        repo: `${owner}/${repo}`,
        status: 'no_improvements',
        message: 'AI analysis complete - no improvements suggested',
        analysis_summary: analysis.summary || 'Code looks good!'
      };
    }
    
    log(`AI Analysis: ${analysis.summary}`, 'ghost');
    log(`Found ${analysis.improvements.length} improvement(s)`, 'info');
    
    // Step 9: Create new branch (or use existing syntax fixes branch)
    const branchName = syntaxFixesBranch || await createBranch(tempRepoPath);
    
    // Step 10: Apply improvements
    const changes = [];
    
    for (const improvement of analysis.improvements) {
      try {
        log(`Processing: ${improvement.description}`, 'code');
        
        const filePath = path.join(tempRepoPath, improvement.file);
        let fileContent;
        
        try {
          const fs = await import('fs/promises');
          fileContent = await fs.readFile(filePath, 'utf-8');
        } catch (error) {
          log(`File ${improvement.file} not found, skipping...`, 'warning');
          continue;
        }
        
        // Generate improved code with semantic context
        const improvedCode = await generateImprovedCode(
          improvement.file,
          fileContent,
          `${improvement.description}\nReason: ${improvement.reason}\nSuggested changes: ${improvement.changes}`,
          symbolGraph
        );
        
        changes.push({
          file: improvement.file,
          content: improvedCode,
          description: improvement.description
        });
      } catch (error) {
        log(`Failed to process improvement for ${improvement.file}: ${error.message}`, 'error');
      }
    }
    
    if (changes.length === 0) {
      log('No changes could be applied', 'warning');
      await deleteDirectory(tempRepoPath);
      
      // Delete embedding index
      log('Cleaning up embedding index...', 'info');
      await deleteIndex(repoId);
      
      return {
        ghost_name: 'GhostCoder',
        repo: `${owner}/${repo}`,
        status: 'no_changes',
        message: 'No changes could be applied'
      };
    }
    
    // Step 11: Apply changes to files
    const modifiedFiles = await applyChanges(tempRepoPath, changes);
    
    // Step 12: Commit changes
    const commitMessage = `🤖 GhostCoder: ${analysis.summary || 'Code improvements'}`;
    await commitChanges(tempRepoPath, commitMessage, modifiedFiles);
    
    // Step 13: Push branch
    await pushBranch(tempRepoPath, branchName, process.env.GITHUB_TOKEN);
    
    // Step 14: Create Pull Request
    const prTitle = `🤖 GhostCoder: ${analysis.summary || 'Code Improvements'}`;
    const prBody = createPRBody(analysis, changes, symbolGraph.syntaxFixes);
    
    const pr = await createPullRequest({
      owner,
      repo,
      branchName,
      baseBranch: targetBaseBranch,
      title: prTitle,
      body: prBody
    });
    
    // Step 15: Add labels and comment
    await addLabelsToPR(owner, repo, pr.number, ['ghostcoder', 'ai-generated', 'improvement']);
    
    const comment = '👻 This PR was automatically generated by GhostCoder using semantic code analysis!\n\n' +
                   'Analyzed using:\n' +
                   `- ${Object.keys(symbolGraph.symbols).length} symbols\n` +
                   `- ${embeddingIndex.metadata.totalEmbeddings} semantic embeddings\n` +
                   `- ${compactContext.relevantFiles.length} relevant files\n\n` +
                   'Please review the changes carefully before merging.';
    await commentOnPR(owner, repo, pr.number, comment);
    
    // Step 16: Cleanup
    await deleteDirectory(tempRepoPath);
    
    // Step 16a: Delete embedding index to ensure fresh analysis next time
    log('Cleaning up embedding index...', 'info');
    await deleteIndex(repoId);
    
    // Step 17: Return summary
    const summary = {
      ghost_name: 'GhostCoder',
      repo: `${owner}/${repo}`,
      pr_number: pr.number,
      pr_url: pr.url,
      branch: branchName,
      message: analysis.summary || 'Code improvements applied',
      changes_count: changes.length,
      files_modified: modifiedFiles,
      status: 'success'
    };
    
    log('✨ GhostCoder completed successfully!', 'ghost');
    log(`PR Created: ${pr.url}`, 'pr');
    
    return summary;
    
  } catch (error) {
    log(`GhostCoder failed: ${error.message}`, 'error');
    
    // Cleanup on error
    if (tempRepoPath) {
      await deleteDirectory(tempRepoPath);
    }
    
    throw error;
  }
}

/**
 * Create Pull Request body with detailed information
 * @param {Object} analysis - AI analysis results
 * @param {Array} changes - Applied changes
 * @param {Array} syntaxFixes - Syntax fixes applied
 * @returns {string} Formatted PR body
 */
/**
 * Create PR body for syntax fixes only
 */
function createSyntaxFixPRBody(syntaxFixes) {
  let body = '## 🔧 Syntax Fixes\n\n';
  body += `GhostCoder automatically detected and fixed syntax errors in ${syntaxFixes.length} file${syntaxFixes.length > 1 ? 's' : ''}.\n\n`;
  body += 'These fixes were necessary to properly parse and analyze the code.\n\n';
  body += '## 📋 Files Fixed\n\n';
  
  syntaxFixes.forEach((fix, index) => {
    body += `${index + 1}. **${fix.filePath}**\n`;
    fix.fixes.forEach(f => {
      body += `   - ${JSON.stringify(f.description)}\n`;
    });
    body += '\n';
  });
  
  body += '## ✅ What This Fixes\n\n';
  body += '- **Incomplete object declarations** - Added missing opening braces\n';
  body += '- **Missing semicolons** - Added where required\n';
  body += '- **Missing commas** - Fixed array/object formatting\n';
  body += '- **Unbalanced brackets** - Balanced parentheses, braces, and brackets\n\n';
  
  body += '## 🔍 Review Notes\n\n';
  body += '- [ ] Verify the fixes don\'t change intended behavior\n';
  body += '- [ ] Ensure all tests still pass\n';
  body += '- [ ] Check that the code style matches project conventions\n\n';
  body += '---\n';
  body += '*This PR was automatically generated by GhostCoder 👻*\n';
  
  return body;
}

/**
 * Create PR body
 */
function createPRBody(analysis, changes, syntaxFixes = []) {
  let body = '## 🤖 GhostCoder Analysis\n\n';
  body += `${analysis.summary}\n\n`;
  body += `**Priority:** ${analysis.priority || 'medium'}\n\n`;
  
  // Add syntax fixes section if any
  if (syntaxFixes && syntaxFixes.length > 0) {
    body += '## � Syntax Fixes Applied\n\n';
    body += `Automatically fixed ${syntaxFixes.length} file${syntaxFixes.length > 1 ? 's' : ''} with syntax errors:\n\n`;
    
    syntaxFixes.forEach((fix, index) => {
      body += `${index + 1}. **${fix.filePath}**\n`;
      fix.fixes.forEach(f => {
        body += `   - ${f}\n`;
      });
      body += '\n';
    });
    
    body += '---\n\n';
  }
  
  body += '## 📝 Code Improvements\n\n';
  
  changes.forEach((change, index) => {
    body += `${index + 1}. **${change.file}**\n`;
    body += `   - ${change.description}\n\n`;
  });
  
  body += '## 🔍 Review Checklist\n\n';
  body += '- [ ] Code changes are correct\n';
  body += '- [ ] No breaking changes introduced\n';
  body += '- [ ] Tests pass (if applicable)\n';
  body += '- [ ] Code follows project conventions\n\n';
  body += '---\n';
  body += '*This PR was automatically generated by GhostCoder 👻*\n';
  
  return body;
}

/**
 * CLI entry point
 */
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: node ghost_engine.js <github-repo-url> [--branch <branch-name>] [--path <folder-path>]');
    console.log('\nExamples:');
    console.log('  node ghost_engine.js https://github.com/octocat/hello-world');
    console.log('  node ghost_engine.js https://github.com/octocat/hello-world --branch develop');
    console.log('  node ghost_engine.js https://github.com/octocat/hello-world --path src/components');
    console.log('  node ghost_engine.js https://github.com/octocat/hello-world --branch develop --path src');
    process.exit(1);
  }
  
  const repoUrl = args[0];
  const options = {};
  
  // Parse command line arguments
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--branch' && args[i + 1]) {
      options.baseBranch = args[i + 1];
      i++;
    } else if (args[i] === '--path' && args[i + 1]) {
      options.analyzePath = args[i + 1];
      i++;
    }
  }
  
  try {
    const result = await runGhostCoder(repoUrl, options);
    console.log('\n📊 Summary:');
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

// Export for programmatic usage
export { runGhostCoder };
