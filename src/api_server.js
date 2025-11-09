#!/usr/bin/env node
/**
 * 👻 GhostCoder API Server
 * Author: Ayushman Lakshkar
 * 
 * REST API endpoints for GhostCoder frontend integration
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Octokit } from '@octokit/rest';
import { runGhostCoder } from './ghost_engine.js';
import { deleteIndex } from './embeddingIndex.js';
import { log } from './utils.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'GhostCoder API', version: '1.0.0' });
});

/**
 * Run GhostCoder analysis on a repository
 * POST /api/analyze
 * Body: {
 *   repoUrl: string (required) - GitHub repository URL
 *   branch?: string (optional) - Branch to analyze
 *   path?: string (optional) - Specific path/folder to analyze
 * }
 */
app.post('/api/analyze', async (req, res) => {
  try {
    const { repoUrl, branch, path } = req.body;

    if (!repoUrl) {
      return res.status(400).json({ 
        error: 'repoUrl is required',
        message: 'Please provide a GitHub repository URL' 
      });
    }

    log(`API Request: Analyzing ${repoUrl}`, 'info');
    
    const options = {};
    if (branch) options.baseBranch = branch;
    if (path) options.analyzePath = path;

    const result = await runGhostCoder(repoUrl, options);
    
    // Delete embedding index after successful PR creation
    if (result.status === 'success' || result.status === 'no_improvements') {
      const repoId = result.repo;
      log(`Cleaning up embedding index for ${repoId}...`, 'info');
      await deleteIndex(repoId);
    }

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    log(`API Error: ${error.message}`, 'error');
    res.status(500).json({
      success: false,
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * Get all branches for a GitHub repository
 * GET /api/branches?owner=<owner>&repo=<repo>
 */
app.get('/api/branches', async (req, res) => {
  try {
    const { owner, repo } = req.query;

    if (!owner || !repo) {
      return res.status(400).json({
        error: 'owner and repo are required',
        message: 'Please provide both owner and repo query parameters'
      });
    }

    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      return res.status(500).json({
        error: 'GITHUB_TOKEN not configured',
        message: 'Server configuration error'
      });
    }

    const octokit = new Octokit({ auth: token });
    
    log(`API Request: Fetching branches for ${owner}/${repo}`, 'info');
    
    const { data: branches } = await octokit.repos.listBranches({
      owner,
      repo,
      per_page: 100
    });

    res.json({
      success: true,
      data: branches.map(branch => ({
        name: branch.name,
        commit: {
          sha: branch.commit.sha,
          url: branch.commit.url
        },
        protected: branch.protected
      }))
    });

  } catch (error) {
    log(`API Error: ${error.message}`, 'error');
    
    if (error.status === 404) {
      return res.status(404).json({
        success: false,
        error: 'Repository not found',
        message: 'The repository does not exist or you do not have access to it'
      });
    }

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get GitHub repositories for the authenticated user
 * GET /api/repos?type=<all|owner|public|private>&page=<number>&per_page=<number>
 */
app.get('/api/repos', async (req, res) => {
  try {
    const { 
      type = 'all', 
      page = 1, 
      per_page = 30,
      sort = 'updated',
      direction = 'desc'
    } = req.query;

    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      return res.status(500).json({
        error: 'GITHUB_TOKEN not configured',
        message: 'Server configuration error'
      });
    }

    const octokit = new Octokit({ auth: token });
    
    log(`API Request: Fetching repositories (type: ${type})`, 'info');

    let repositories;
    
    if (type === 'all') {
      // Get all repositories (public + private)
      const { data } = await octokit.repos.listForAuthenticatedUser({
        visibility: 'all',
        sort,
        direction,
        per_page: parseInt(per_page),
        page: parseInt(page)
      });
      repositories = data;
    } else if (type === 'public') {
      // Get only public repositories
      const { data } = await octokit.repos.listForAuthenticatedUser({
        visibility: 'public',
        sort,
        direction,
        per_page: parseInt(per_page),
        page: parseInt(page)
      });
      repositories = data;
    } else if (type === 'private') {
      // Get only private repositories
      const { data } = await octokit.repos.listForAuthenticatedUser({
        visibility: 'private',
        sort,
        direction,
        per_page: parseInt(per_page),
        page: parseInt(page)
      });
      repositories = data;
    } else if (type === 'owner') {
      // Get only owned repositories (not forks)
      const { data } = await octokit.repos.listForAuthenticatedUser({
        type: 'owner',
        sort,
        direction,
        per_page: parseInt(per_page),
        page: parseInt(page)
      });
      repositories = data;
    } else {
      return res.status(400).json({
        error: 'Invalid type parameter',
        message: 'type must be one of: all, owner, public, private'
      });
    }

    res.json({
      success: true,
      data: repositories.map(repo => ({
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
      })),
      pagination: {
        page: parseInt(page),
        per_page: parseInt(per_page)
      }
    });

  } catch (error) {
    log(`API Error: ${error.message}`, 'error');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Parse GitHub URL to extract owner and repo
 * POST /api/parse-github-url
 * Body: { url: string }
 */
app.post('/api/parse-github-url', (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({
        error: 'url is required',
        message: 'Please provide a GitHub URL'
      });
    }

    // Parse GitHub URL
    const match = url.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    
    if (!match) {
      return res.status(400).json({
        error: 'Invalid GitHub URL',
        message: 'URL must be in format: https://github.com/owner/repo'
      });
    }

    const owner = match[1];
    const repo = match[2].replace(/\.git$/, '');

    res.json({
      success: true,
      data: {
        owner,
        repo,
        fullName: `${owner}/${repo}`
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get repository information
 * GET /api/repo-info?owner=<owner>&repo=<repo>
 */
app.get('/api/repo-info', async (req, res) => {
  try {
    const { owner, repo } = req.query;

    if (!owner || !repo) {
      return res.status(400).json({
        error: 'owner and repo are required',
        message: 'Please provide both owner and repo query parameters'
      });
    }

    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      return res.status(500).json({
        error: 'GITHUB_TOKEN not configured',
        message: 'Server configuration error'
      });
    }

    const octokit = new Octokit({ auth: token });
    
    const { data } = await octokit.repos.get({ owner, repo });

    res.json({
      success: true,
      data: {
        name: data.name,
        fullName: data.full_name,
        description: data.description,
        language: data.language,
        defaultBranch: data.default_branch,
        private: data.private,
        stars: data.stargazers_count,
        forks: data.forks_count,
        openIssues: data.open_issues_count,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        pushedAt: data.pushed_at
      }
    });

  } catch (error) {
    log(`API Error: ${error.message}`, 'error');
    
    if (error.status === 404) {
      return res.status(404).json({
        success: false,
        error: 'Repository not found',
        message: 'The repository does not exist or you do not have access to it'
      });
    }

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Error handler middleware
 */
app.use((err, req, res, next) => {
  log(`Unhandled error: ${err.message}`, 'error');
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

/**
 * Start server
 */
app.listen(PORT, () => {
  log(`🚀 GhostCoder API Server running on port ${PORT}`, 'ghost');
  log(`Environment: ${process.env.NODE_ENV || 'development'}`, 'info');
  log(`Endpoints:`, 'info');
  log(`  GET  /health - Health check`, 'info');
  log(`  POST /api/analyze - Run GhostCoder analysis`, 'info');
  log(`  GET  /api/branches - Get repository branches`, 'info');
  log(`  GET  /api/repos - Get user repositories`, 'info');
  log(`  POST /api/parse-github-url - Parse GitHub URL`, 'info');
  log(`  GET  /api/repo-info - Get repository information`, 'info');
});

export default app;
