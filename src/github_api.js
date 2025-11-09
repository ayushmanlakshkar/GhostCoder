/**
 * 👻 GhostCoder Backend - GitHub API Integration
 * Author: Ayushman Lakshkar
 */

import { Octokit } from '@octokit/rest';
import { log } from './utils.js';

/**
 * Create a Pull Request on GitHub
 * @param {Object} params - PR parameters
 * @param {string} params.owner - Repository owner
 * @param {string} params.repo - Repository name
 * @param {string} params.branchName - Head branch (source)
 * @param {string} params.baseBranch - Base branch (target, default: main)
 * @param {string} params.title - PR title
 * @param {string} params.body - PR description
 * @returns {Promise<Object>} Created PR information
 */
export async function createPullRequest({
  owner,
  repo,
  branchName,
  baseBranch = 'main',
  title,
  body
}) {
  try {
    const token = process.env.GITHUB_TOKEN;
    
    if (!token) {
      throw new Error('GITHUB_TOKEN is not set');
    }
    
    const octokit = new Octokit({ auth: token });
    
    log(`Creating Pull Request: ${title}...`, 'pr');
    
    // Check if base branch exists, try 'master' if 'main' doesn't exist
    try {
      await octokit.repos.getBranch({ owner, repo, branch: baseBranch });
    } catch (error) {
      if (error.status === 404 && baseBranch === 'main') {
        log('Main branch not found, trying master...', 'warning');
        baseBranch = 'master';
      } else {
        throw error;
      }
    }
    
    // Create the Pull Request
    const { data: pr } = await octokit.pulls.create({
      owner,
      repo,
      title,
      body,
      head: branchName,
      base: baseBranch
    });
    
    log(`Pull Request created successfully: #${pr.number}`, 'success');
    log(`PR URL: ${pr.html_url}`, 'info');
    
    return {
      number: pr.number,
      url: pr.html_url,
      state: pr.state,
      title: pr.title
    };
  } catch (error) {
    log(`Failed to create Pull Request: ${error.message}`, 'error');
    if (error.response) {
      log(`GitHub API Error: ${JSON.stringify(error.response.data)}`, 'error');
    }
    throw error;
  }
}

/**
 * Add labels to a Pull Request
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} prNumber - PR number
 * @param {Array<string>} labels - Labels to add
 */
export async function addLabelsToPR(owner, repo, prNumber, labels) {
  try {
    const token = process.env.GITHUB_TOKEN;
    const octokit = new Octokit({ auth: token });
    
    await octokit.issues.addLabels({
      owner,
      repo,
      issue_number: prNumber,
      labels
    });
    
    log(`Added labels to PR #${prNumber}: ${labels.join(', ')}`, 'success');
  } catch (error) {
    log(`Failed to add labels: ${error.message}`, 'warning');
  }
}

/**
 * Add a comment to a Pull Request
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} prNumber - PR number
 * @param {string} comment - Comment text
 */
export async function commentOnPR(owner, repo, prNumber, comment) {
  try {
    const token = process.env.GITHUB_TOKEN;
    const octokit = new Octokit({ auth: token });
    
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body: comment
    });
    
    log(`Added comment to PR #${prNumber}`, 'success');
  } catch (error) {
    log(`Failed to add comment: ${error.message}`, 'warning');
  }
}

/**
 * Get repository information
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @returns {Promise<Object>} Repository information
 */
export async function getRepoInfo(owner, repo) {
  try {
    const token = process.env.GITHUB_TOKEN;
    const octokit = new Octokit({ auth: token });
    
    const { data } = await octokit.repos.get({ owner, repo });
    
    return {
      name: data.name,
      fullName: data.full_name,
      description: data.description,
      language: data.language,
      defaultBranch: data.default_branch,
      private: data.private,
      stars: data.stargazers_count,
      forks: data.forks_count
    };
  } catch (error) {
    log(`Failed to get repo info: ${error.message}`, 'error');
    throw error;
  }
}

/**
 * Check if user has write access to repository
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @returns {Promise<boolean>}
 */
export async function hasWriteAccess(owner, repo) {
  try {
    const token = process.env.GITHUB_TOKEN;
    const octokit = new Octokit({ auth: token });
    
    const { data: user } = await octokit.users.getAuthenticated();
    
    const { data: permission } = await octokit.repos.getCollaboratorPermissionLevel({
      owner,
      repo,
      username: user.login
    });
    
    return ['admin', 'write'].includes(permission.permission);
  } catch (error) {
    log(`Could not verify write access: ${error.message}`, 'warning');
    return false;
  }
}

/**
 * List open Pull Requests
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @returns {Promise<Array>} List of open PRs
 */
export async function listOpenPRs(owner, repo) {
  try {
    const token = process.env.GITHUB_TOKEN;
    const octokit = new Octokit({ auth: token });
    
    const { data } = await octokit.pulls.list({
      owner,
      repo,
      state: 'open'
    });
    
    return data.map(pr => ({
      number: pr.number,
      title: pr.title,
      url: pr.html_url,
      head: pr.head.ref,
      base: pr.base.ref,
      createdAt: pr.created_at
    }));
  } catch (error) {
    log(`Failed to list PRs: ${error.message}`, 'error');
    return [];
  }
}

/**
 * List all branches for a repository
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @returns {Promise<Array>} List of branches
 */
export async function listBranches(owner, repo) {
  try {
    const token = process.env.GITHUB_TOKEN;
    const octokit = new Octokit({ auth: token });
    
    const { data } = await octokit.repos.listBranches({
      owner,
      repo,
      per_page: 100
    });
    
    return data.map(branch => ({
      name: branch.name,
      commit: {
        sha: branch.commit.sha,
        url: branch.commit.url
      },
      protected: branch.protected
    }));
  } catch (error) {
    log(`Failed to list branches: ${error.message}`, 'error');
    throw error;
  }
}

/**
 * List repositories for authenticated user
 * @param {Object} options - Options for listing repos
 * @param {string} options.visibility - 'all', 'public', or 'private'
 * @param {string} options.sort - Sort by 'created', 'updated', 'pushed', 'full_name'
 * @param {string} options.direction - 'asc' or 'desc'
 * @param {number} options.per_page - Results per page
 * @param {number} options.page - Page number
 * @returns {Promise<Array>} List of repositories
 */
export async function listUserRepos(options = {}) {
  try {
    const token = process.env.GITHUB_TOKEN;
    const octokit = new Octokit({ auth: token });
    
    const {
      visibility = 'all',
      sort = 'updated',
      direction = 'desc',
      per_page = 30,
      page = 1
    } = options;
    
    const { data } = await octokit.repos.listForAuthenticatedUser({
      visibility,
      sort,
      direction,
      per_page,
      page
    });
    
    return data.map(repo => ({
      id: repo.id,
      name: repo.name,
      fullName: repo.full_name,
      owner: {
        login: repo.owner.login,
        avatar: repo.owner.avatar_url
      },
      description: repo.description,
      private: repo.private,
      htmlUrl: repo.html_url,
      language: repo.language,
      stargazersCount: repo.stargazers_count,
      forksCount: repo.forks_count,
      defaultBranch: repo.default_branch,
      createdAt: repo.created_at,
      updatedAt: repo.updated_at,
      pushedAt: repo.pushed_at
    }));
  } catch (error) {
    log(`Failed to list repositories: ${error.message}`, 'error');
    throw error;
  }
}
