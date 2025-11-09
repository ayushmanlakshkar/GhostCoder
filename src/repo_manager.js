/**
 * 👻 GhostCoder Backend - Repository Management
 * Author: Ayushman Lakshkar
 */

import simpleGit from 'simple-git';
import path from 'path';
import fs from 'fs/promises';
import { log, ensureDirectory, generateBranchName } from './utils.js';

/**
 * Clone a GitHub repository to a local directory
 * @param {string} repoUrl - GitHub repository URL
 * @param {string} targetDir - Directory to clone into
 * @param {string} branch - Optional branch to checkout (defaults to repo's default branch)
 * @returns {Promise<string>} Path to cloned repository
 */
export async function cloneRepository(repoUrl, targetDir, branch = null) {
  try {
    log(`Cloning repository: ${repoUrl}...`, 'info');
    
    await ensureDirectory(path.dirname(targetDir));
    
    const git = simpleGit();
    
    if (branch) {
      log(`Checking out branch: ${branch}`, 'info');
      await git.clone(repoUrl, targetDir, ['--branch', branch]);
    } else {
      await git.clone(repoUrl, targetDir);
    }
    
    log(`Repository cloned to: ${targetDir}`, 'success');
    return targetDir;
  } catch (error) {
    log(`Failed to clone repository: ${error.message}`, 'error');
    throw error;
  }
}

/**
 * Configure git user for commits
 * @param {string} repoPath - Path to repository
 */
async function configureGitUser(repoPath) {
  const git = simpleGit(repoPath);
  
  try {
    await git.addConfig('user.name', 'GhostCoder Bot');
    await git.addConfig('user.email', 'ghostcoder@bot.github.com');
  } catch (error) {
    log('Warning: Could not configure git user', 'warning');
  }
}

/**
 * Create a new branch for changes
 * @param {string} repoPath - Path to repository
 * @param {string} branchName - Name of the new branch
 * @returns {Promise<string>} Created branch name
 */
export async function createBranch(repoPath, branchName = null) {
  try {
    const git = simpleGit(repoPath);
    const actualBranchName = branchName || generateBranchName();
    
    await git.checkoutLocalBranch(actualBranchName);
    log(`Created and switched to branch: ${actualBranchName}`, 'success');
    
    return actualBranchName;
  } catch (error) {
    log(`Failed to create branch: ${error.message}`, 'error');
    throw error;
  }
}

/**
 * Apply code changes to files
 * @param {string} repoPath - Path to repository
 * @param {Array<{file: string, content: string}>} changes - Array of file changes
 * @returns {Promise<Array<string>>} List of modified files
 */
export async function applyChanges(repoPath, changes) {
  const modifiedFiles = [];
  
  try {
    log(`Applying ${changes.length} code changes...`, 'code');
    
    for (const change of changes) {
      try {
        const filePath = path.join(repoPath, change.file);
        
        // Ensure directory exists
        await ensureDirectory(path.dirname(filePath));
        
        // Write the new content
        await fs.writeFile(filePath, change.content, 'utf-8');
        
        modifiedFiles.push(change.file);
        log(`Modified: ${change.file}`, 'success');
      } catch (error) {
        log(`Failed to modify ${change.file}: ${error.message}`, 'error');
      }
    }
    
    return modifiedFiles;
  } catch (error) {
    log(`Failed to apply changes: ${error.message}`, 'error');
    throw error;
  }
}

/**
 * Commit changes to the repository
 * @param {string} repoPath - Path to repository
 * @param {string} commitMessage - Commit message
 * @param {Array<string>} files - Files to commit (optional, defaults to all)
 * @returns {Promise<Object>} Commit result
 */
export async function commitChanges(repoPath, commitMessage, files = []) {
  try {
    const git = simpleGit(repoPath);
    
    // Configure git user
    await configureGitUser(repoPath);
    
    // Add files
    if (files.length > 0) {
      await git.add(files);
      log(`Added ${files.length} files to commit`, 'info');
    } else {
      await git.add('.');
      log('Added all changes to commit', 'info');
    }
    
    // Commit
    const commit = await git.commit(commitMessage);
    log(`Committed changes: ${commitMessage}`, 'success');
    
    return commit;
  } catch (error) {
    log(`Failed to commit changes: ${error.message}`, 'error');
    throw error;
  }
}

/**
 * Push branch to remote repository
 * @param {string} repoPath - Path to repository
 * @param {string} branchName - Branch to push
 * @param {string} token - GitHub token for authentication
 * @returns {Promise<void>}
 */
export async function pushBranch(repoPath, branchName, token) {
  try {
    const git = simpleGit(repoPath);
    
    // Get remote URL and inject token for authentication
    const remotes = await git.getRemotes(true);
    const originUrl = remotes.find(r => r.name === 'origin')?.refs?.fetch;
    
    if (!originUrl) {
      throw new Error('Could not find origin remote');
    }
    
    // Inject token into URL for authentication
    let authenticatedUrl = originUrl;
    if (originUrl.startsWith('https://')) {
      authenticatedUrl = originUrl.replace('https://', `https://${token}@`);
    }
    
    // Set authenticated remote
    await git.remote(['set-url', 'origin', authenticatedUrl]);
    
    // Push branch
    log(`Pushing branch ${branchName} to remote...`, 'info');
    await git.push('origin', branchName, ['--set-upstream']);
    
    log(`Branch ${branchName} pushed successfully`, 'success');
  } catch (error) {
    log(`Failed to push branch: ${error.message}`, 'error');
    throw error;
  }
}

/**
 * Get repository status
 * @param {string} repoPath - Path to repository
 * @returns {Promise<Object>} Git status
 */
export async function getRepoStatus(repoPath) {
  try {
    const git = simpleGit(repoPath);
    const status = await git.status();
    return status;
  } catch (error) {
    log(`Failed to get repo status: ${error.message}`, 'error');
    throw error;
  }
}

/**
 * Check if repository has uncommitted changes
 * @param {string} repoPath - Path to repository
 * @returns {Promise<boolean>}
 */
export async function hasUncommittedChanges(repoPath) {
  try {
    const status = await getRepoStatus(repoPath);
    return !status.isClean();
  } catch (error) {
    return false;
  }
}
