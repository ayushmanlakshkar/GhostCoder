# 👻 GhostCoder Backend

**Author:** Ayushman Lakshkar

A fully autonomous AI-powered code review bot that uses **semantic indexing and embeddings** (similar to GitHub Copilot and Cursor) to intelligently analyze GitHub repositories, generate code improvements using AI, and create Pull Requests with the changes.

---

## � What's New: Semantic Code Intelligence

GhostCoder now uses **advanced semantic indexing** instead of naive code dumping:

### **Traditional Approach (Old)** ❌
- Dump all code files into AI context
- Limited by token constraints
- No understanding of code relationships
- Inefficient and expensive

### **Semantic Approach (New)** ✅
- **Symbol Graph**: Extracts functions, classes, imports using AST parsing
- **Embedding Index**: Creates vector embeddings for semantic search
- **Context Retrieval**: Fetches only relevant code based on semantic similarity
- **Intelligent Analysis**: Understands code relationships and dependencies

**Similar to**: GitHub Copilot's cloud embedding index, Cursor's codebase indexing

---

## �📖 What Does This Code Do?

GhostCoder is an intelligent automation tool that acts as your personal AI code reviewer. Here's what happens when you run it:

1. **Takes a GitHub repo URL as input**
2. **Clones the repository locally**
3. **Builds a symbol graph** (functions, classes, imports, exports)
4. **Creates semantic embeddings** using local transformer models
5. **Performs semantic search** to find relevant code patterns
6. **Retrieves intelligent context** (only relevant files/symbols)
7. **Sends semantic context to AI** (via OpenRouter) for analysis
8. **AI identifies improvements** based on semantic understanding
9. **Generates improved code** using AI
10. **Commits changes** to a new branch
11. **Pushes to GitHub** and **creates a Pull Request** automatically
12. **Adds labels and comments** to the PR
13. **Cleans up** temporary files

All of this happens automatically with a single command! 🚀

---

## 🏗️ How The Code Works

### **Architecture Overview**

The project follows a **modular architecture** with semantic intelligence:

```
src/
├── ghost_engine.js         → Orchestrates the entire workflow
├── symbolGraph.js          → Builds AST-based symbol graph (NEW)
├── embeddingIndex.js       → Creates vector embeddings for semantic search (NEW)
├── contextRetriever.js     → Intelligent context retrieval (NEW)
├── openrouter_api.js       → Handles AI communication with semantic context
├── github_api.js           → Creates PRs and interacts with GitHub
├── repo_manager.js         → Git operations (clone, branch, commit, push)
└── utils.js                → Helper functions and utilities

data/
├── indexes/                → Stored embedding indexes (local vector DB)
└── models/                 → Cached transformer models
```

---

## 🧠 Semantic Intelligence System

### **1. Symbol Graph Builder** (`symbolGraph.js`)

Extracts code structure using AST parsing:

**What it extracts:**
- Functions and their signatures
- Classes and methods
- Imports and exports
- Variables and constants
- Interfaces and types (TypeScript)
- Documentation strings

**Supported Languages:**
- JavaScript/JSX (using Babel parser)
- TypeScript/TSX (using Babel with TypeScript plugin)
- Python (regex-based extraction)
- Generic patterns for other languages

**Example Symbol:**
```javascript
{
  name: "fetchUserData",
  type: "function",
  params: ["userId", "options"],
  line: 42,
  async: true,
  documentation: "Fetches user data from API",
  signature: "async function fetchUserData(userId, options)"
}
```

### **2. Embedding Index** (`embeddingIndex.js`)

Creates semantic embeddings using local transformer models:

**How it works:**
1. Uses `@xenova/transformers` (ONNX Runtime in JavaScript)
2. Model: `all-MiniLM-L6-v2` (lightweight, fast, code-optimized)
3. Generates 384-dimensional vectors for each symbol
4. Stores embeddings locally in JSON format
5. Enables semantic similarity search

**What gets embedded:**
- Each function/class with its documentation
- Each file with its imports/exports
- Symbol signatures and parameters
- Code context and relationships

**Example:**
```javascript
{
  id: "src/api.js::fetchUserData",
  symbolName: "fetchUserData",
  embedding: [0.123, -0.456, 0.789, ...], // 384 dimensions
  text: "async function fetchUserData(userId, options) ...",
  similarity: 0.95 // when queried
}
```

### **3. Context Retriever** (`contextRetriever.js`)

Intelligently retrieves relevant context:

**Retrieval strategies:**
- **Semantic Search**: Find symbols by meaning, not just name
- **Pattern Queries**: Search for security issues, performance problems
- **Dependency Analysis**: Understand import/export relationships
- **Call Graph**: Track function calls and references
- **Focused Context**: Analyze specific paths/files

**Query Examples:**
```javascript
// Find security vulnerabilities
queryPattern(index, graph, repoPath, 'security')

// Find all usages of a function
findAllUsages(index, graph, 'connectToDB')

// Get context for specific files
getFocusedContext(index, graph, repoPath, ['src/auth.js'])
```

**Token Optimization:**
- Extracts only relevant code snippets
- Provides compact context with ~5 lines around each symbol
- Respects token limits (configurable)
- Includes relevance scores to prioritize

---

## 💡 Benefits of Semantic Indexing

### **Why This Approach is Better:**

| Aspect | Old Approach | New Semantic Approach |
|--------|-------------|----------------------|
| **Context Understanding** | None - just dumps code | Deep - understands relationships |
| **Token Efficiency** | Sends everything | Sends only relevant context |
| **Scalability** | Fails on large repos | Scales to any repo size |
| **Analysis Quality** | Surface-level | Semantic understanding |
| **Search Capability** | Grep/regex only | Semantic similarity search |
| **Performance** | Slow for large repos | Fast with indexed search |
| **Cost** | High (many tokens) | Low (optimized context) |

### **Real-World Improvements:**

1. **Handles Large Repositories**: Can analyze repos with 1000+ files by intelligently selecting relevant context
2. **Better AI Understanding**: AI gets semantic context about code relationships, not just raw text
3. **Faster Analysis**: Symbol graph cached locally, embeddings reused across runs
4. **Smarter Suggestions**: AI can trace dependencies and understand call graphs
5. **Targeted Analysis**: Can focus on security, performance, or specific patterns
6. **Cost Effective**: Reduces token usage by 60-80% compared to dumping all code

### **Similar to Production Tools:**

- **GitHub Copilot**: Uses cloud embedding index for workspace understanding
- **Cursor**: Builds local codebase index with semantic search
- **Amazon CodeWhisperer**: Semantic code analysis and suggestions
- **Tabnine**: Local semantic code completion

---

### **Detailed Module Breakdown**

#### **1. `ghost_engine.js` - The Brain** 🧠

This is the **main orchestrator** that runs the entire workflow:

```javascript
// Step-by-step workflow:
1. Validates environment variables (API keys)
2. Parses GitHub URL → extracts owner/repo
3. Gets repository info (language, default branch)
4. Clones repo to temporary directory
5. Scans for code files (.js, .py, .java, etc.)
6. Sends code to AI for analysis
7. Creates a new Git branch
8. Applies AI-suggested improvements
9. Commits and pushes changes
10. Creates Pull Request on GitHub
11. Cleans up temporary files
```

**Key Functions:**
- `runGhostCoder(repoUrl)` - Main workflow function
- `createPRBody(analysis, changes)` - Formats PR description

---

#### **2. `openrouter_api.js` - The AI Interface** 🤖

Handles all communication with OpenRouter AI API using semantic context:

**How AI Analysis Works (NEW):**
```javascript
1. Receives semantic context (not raw code files)
2. Context includes: symbol graph, embeddings, relevance scores
3. Prepares semantic analysis prompt
4. Sends HTTP POST request to OpenRouter API
5. AI analyzes with understanding of code relationships
6. Returns JSON with improvements referencing specific symbols
```

**Key Functions:**
- `analyzeCodeWithAI(semanticContext, repoInfo, symbolGraph)` - Sends semantic context to AI
- `generateImprovedCode(filePath, content, description, symbolGraph)` - Generates improved code
- `createSemanticAnalysisPrompt(context, repoInfo)` - Creates semantic-aware prompts

**Semantic AI Prompt Structure:**
- Provides symbol graph with relationships
- Includes relevance scores for prioritization
- References specific symbols and dependencies
- Asks AI to consider semantic relationships
- Requires response with `affectedSymbols` for traceability

---

#### **3. `github_api.js` - The GitHub Integration** 🔀

Manages all GitHub operations using Octokit:

**Key Functions:**
- `createPullRequest({owner, repo, branchName, title, body})` - Creates PR
- `addLabelsToPR(owner, repo, prNumber, labels)` - Adds labels like "ai-generated"
- `commentOnPR(owner, repo, prNumber, comment)` - Adds bot comment
- `getRepoInfo(owner, repo)` - Fetches repo metadata
- `hasWriteAccess(owner, repo)` - Checks permissions
- `listOpenPRs(owner, repo)` - Lists existing PRs

**Authentication:**
Uses GitHub Personal Access Token stored in `.env`

---

#### **4. `repo_manager.js` - The Git Handler** 🔧

Handles all Git operations using simple-git:

**Key Functions:**
- `cloneRepository(repoUrl, targetDir)` - Clones repo locally
- `createBranch(repoPath, branchName)` - Creates new branch with timestamp
- `applyChanges(repoPath, changes)` - Writes improved code to files
- `commitChanges(repoPath, message, files)` - Commits with custom message
- `pushBranch(repoPath, branchName, token)` - Pushes to remote with auth
- `getRepoStatus(repoPath)` - Checks Git status
- `configureGitUser(repoPath)` - Sets "GhostCoder Bot" as committer

**Authentication:**
Injects GitHub token into remote URL for push authentication

---

#### **5. `utils.js` - The Toolbox** 🛠️

Helper functions used across all modules:

**Key Functions:**
- `log(message, type)` - Emoji-based logging (👻, ✅, ❌, ⚠️)
- `parseGitHubUrl(repoUrl)` - Extracts owner/repo from URL
- `getCodeFiles(dirPath)` - Recursively scans for code files
- `generateBranchName(baseName)` - Creates unique branch names
- `validateEnvVars(requiredVars)` - Checks for required environment variables
- `ensureDirectory(dirPath)` - Creates directories if needed
- `deleteDirectory(dirPath)` - Cleanup temporary files

**Smart File Scanning:**
- Ignores: `node_modules`, `.git`, `dist`, `build`
- Supports: `.js`, `.ts`, `.py`, `.java`, `.go`, `.rs`, `.rb`, etc.
- Limits file size to avoid API token limits

---

## 🔄 Complete Workflow Example

```bash
$ node src/ghost_engine.js https://github.com/user/repo
```

**What Happens:**

```
1. 👻 GhostCoder Engine Starting...
2. ⚙️ Validates API keys (OpenRouter + GitHub)
3. ⚙️ Parses URL → owner: "user", repo: "repo"
4. ⚙️ Fetches repo info from GitHub API
5. ✅ Clones to: temp_repos/repo-1234567890
6. 💻 Scans files → Found 5 code files
7. 👻 Sends to AI → Analyzing 5 files (3456 bytes)
8. ✅ AI returns: "Found performance improvements"
9. ✅ Creates branch: ghostcoder-improvements-1234567890
10. 💻 Generates improved code for each file
11. ✅ Applies changes to 3 files
12. ✅ Commits: "🤖 GhostCoder: Found performance improvements"
13. ✅ Pushes branch to GitHub
14. 🔀 Creates Pull Request #42
15. ✅ Adds labels: [ghostcoder, ai-generated, improvement]
16. ✅ Adds comment: "This PR was auto-generated..."
17. ✅ Deletes temp directory
18. ✨ GhostCoder completed successfully!

📊 Summary:
{
  "ghost_name": "GhostCoder",
  "repo": "user/repo",
  "pr_number": 42,
  "pr_url": "https://github.com/user/repo/pull/42",
  "status": "success"
}
```

---

## 🛠️ Tech Stack

- **Node.js (ES Modules)** - Runtime environment
- **simple-git** - Git operations (clone, commit, push)
- **axios** - HTTP client for OpenRouter API calls
- **@octokit/rest** - Official GitHub API SDK
- **dotenv** - Environment variable management

---

## 🎯 Key Technical Features

### **1. Async/Await Architecture**
- All functions use modern async/await pattern
- Proper error handling with try-catch blocks
- Sequential workflow with clear steps

### **2. Modular Design Pattern**
- Each module has a single responsibility
- Clean imports/exports using ES6 modules
- Easy to test and maintain

### **3. Smart File Processing**
```javascript
// Recursively scans directories
// Filters by file extension
// Limits file size to 100KB per file
// Total size capped at ~50KB to fit AI token limits
```

### **4. AI Integration Strategy**
```javascript
// Uses structured prompts for consistent results
// Requests JSON responses for easy parsing
// Falls back gracefully if AI returns unexpected format
// Configurable models (Claude, GPT-4, etc.)
```

### **5. Git Authentication**
```javascript
// Injects token into HTTPS URL for authentication
// Format: https://TOKEN@github.com/owner/repo.git
// Automatically handles push authentication
```

### **6. Error Handling & Cleanup**
```javascript
// Validates env vars before starting
// Cleans up temp files even on failure
// Logs errors with clear emoji indicators
// Returns structured error responses
```

---

## 📋 Prerequisites

- **Node.js 18+** installed
- **GitHub Personal Access Token** with `repo` permissions
- **OpenRouter API Key** (supports Claude, GPT-4, etc.)

## 🔧 Setup

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd ghost
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```
   
   **New dependencies for semantic indexing:**
   - `@xenova/transformers` - Local transformer models for embeddings
   - `@babel/parser` - AST parsing for JavaScript/TypeScript
   - `acorn` & `acorn-walk` - Alternative JavaScript parser

   **First run will download embedding model (~50MB) - this happens automatically.**

3. **Configure environment variables**
   
   Copy `.env.example` to `.env` and fill in your credentials:
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env`:
   ```env
   OPENROUTER_API_KEY=your_openrouter_api_key_here
   GITHUB_TOKEN=your_github_token_here
   TEMP_DIR=./temp_repos
   OPENROUTER_MODEL=anthropic/claude-3.5-sonnet
   ```

4. **Get your API keys**
   - **GitHub Token**: Go to [GitHub Settings > Developer settings > Personal access tokens](https://github.com/settings/tokens)
   - **OpenRouter Key**: Sign up at [OpenRouter](https://openrouter.ai/)

## 🎯 Usage

### Basic Usage

Run GhostCoder on any public GitHub repository:

```bash
node src/ghost_engine.js https://github.com/owner/repo
```

### Advanced Usage

Specify a custom base branch and/or analyze a specific path:

```bash
# Analyze a specific branch
node src/ghost_engine.js https://github.com/owner/repo --branch develop

# Analyze only a specific folder
node src/ghost_engine.js https://github.com/owner/repo --path src/components

# Combine both options
node src/ghost_engine.js https://github.com/owner/repo --branch develop --path src
```

### Options

- `--branch <branch-name>` - Specify the base branch to analyze (defaults to repository's default branch)
- `--path <folder-path>` - Specify a specific folder or path to analyze (defaults to root `/`)

### Examples

**Basic analysis:**
```bash
node src/ghost_engine.js https://github.com/octocat/hello-world
```

**Analyze the develop branch:**
```bash
node src/ghost_engine.js https://github.com/octocat/hello-world --branch develop
```

**Analyze only the src directory:**
```bash
node src/ghost_engine.js https://github.com/octocat/hello-world --path src
```

**Analyze src directory on feature branch:**
```bash
node src/ghost_engine.js https://github.com/octocat/hello-world --branch feature/new-feature --path src/components
```

### Expected Output

```
👻 GhostCoder Engine Starting...
⚙️ Target Repository: https://github.com/octocat/hello-world
⚙️ Repository: octocat/hello-world
✅ Repository cloned to: ./temp_repos/hello-world-1234567890
💻 Found 5 code files to analyze
👻 Sending code to AI for analysis...
✅ Received AI analysis
👻 AI Analysis: Found opportunities to improve code readability
✅ Created and switched to branch: ghostcoder-improvements-1234567890
💻 Processing: Refactor redundant functions
✅ Modified: src/utils.js
✅ Committed changes: 🤖 GhostCoder: Found opportunities to improve code readability
✅ Branch ghostcoder-improvements-1234567890 pushed successfully
🔀 Creating Pull Request: 🤖 GhostCoder: Found opportunities to improve code readability...
✅ Pull Request created successfully: #7
✨ GhostCoder completed successfully!
🔀 PR Created: https://github.com/octocat/hello-world/pull/7

📊 Summary:
{
  "ghost_name": "GhostCoder",
  "repo": "octocat/hello-world",
  "pr_number": 7,
  "pr_url": "https://github.com/octocat/hello-world/pull/7",
  "branch": "ghostcoder-improvements-1234567890",
  "message": "Found opportunities to improve code readability",
  "changes_count": 2,
  "files_modified": ["src/utils.js", "README.md"],
  "status": "success"
}
```

## 📁 Project Structure

```
ghostcoder-backend/
├── src/
│   ├── ghost_engine.js      # Main workflow orchestrator
│   ├── openrouter_api.js    # AI analysis integration
│   ├── github_api.js        # GitHub PR creation
│   ├── repo_manager.js      # Git operations
│   └── utils.js             # Helper functions
├── temp_repos/              # Temporary clone directory (auto-created)
├── .env                     # Environment variables (you create this)
├── .env.example             # Example environment file
├── .gitignore               # Git ignore rules
├── package.json             # Node.js dependencies
└── README.md                # This file
```

## 🔐 Security Notes

- **Never commit `.env` file** - It contains sensitive credentials
- **Use minimal permissions** - GitHub token should only have necessary `repo` access
- **Review PRs carefully** - Always review AI-generated code before merging
- **Private repos** - GhostCoder works with both public and private repos (if you have access)

## 🎨 Customization

### Change AI Model

Edit `.env`:
```env
OPENROUTER_MODEL=anthropic/claude-3.5-sonnet
# Or try: openai/gpt-4-turbo, google/gemini-pro, etc.
```

### Modify Analysis Focus

Edit the prompt in `src/openrouter_api.js` > `createAnalysisPrompt()` to focus on specific areas:
- Security vulnerabilities
- Performance optimizations
- Code style consistency
- Documentation improvements

### Adjust File Scanning

Edit `src/utils.js` > `getCodeFiles()` to:
- Add/remove file extensions
- Change max file size
- Modify ignore patterns

---

## 🔍 Code Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    USER RUNS COMMAND                        │
│         node src/ghost_engine.js <github-url>               │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  ghost_engine.js (Main Orchestrator)                        │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ 1. Validate environment variables                    │   │
│  │ 2. Parse GitHub URL                                  │   │
│  └──────────────────┬───────────────────────────────────┘   │
└────────────────────┼────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  github_api.js                                              │
│  └─→ getRepoInfo(owner, repo)                              │
│      Returns: language, default branch, description         │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  repo_manager.js                                            │
│  └─→ cloneRepository(repoUrl, tempDir)                     │
│      Uses: simple-git library                               │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  utils.js                                                   │
│  └─→ getCodeFiles(repoPath)                                │
│      Scans recursively, filters by extension                │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  openrouter_api.js                                          │
│  └─→ analyzeCodeWithAI(codeFiles, repoInfo)                │
│      ┌─────────────────────────────────────────────┐       │
│      │ 1. Prepare code summary                      │       │
│      │ 2. Create structured prompt                  │       │
│      │ 3. POST to OpenRouter API                    │       │
│      │ 4. Parse JSON response                       │       │
│      └─────────────────────────────────────────────┘       │
│      Returns: {summary, improvements[], priority}           │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  repo_manager.js                                            │
│  └─→ createBranch(repoPath, branchName)                    │
│      Creates: ghostcoder-improvements-<timestamp>           │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  openrouter_api.js (Loop for each improvement)              │
│  └─→ generateImprovedCode(file, content, description)      │
│      AI generates actual improved code                      │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  repo_manager.js                                            │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ 1. applyChanges(repoPath, changes)                  │   │
│  │ 2. commitChanges(repoPath, message)                 │   │
│  │ 3. pushBranch(repoPath, branchName, token)          │   │
│  └──────────────────────────────────────────────────────┘   │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  github_api.js                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ 1. createPullRequest(...)                           │   │
│  │ 2. addLabelsToPR(...)                               │   │
│  │ 3. commentOnPR(...)                                 │   │
│  └──────────────────────────────────────────────────────┘   │
│  Returns: {pr_number, url, status}                          │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  utils.js                                                   │
│  └─→ deleteDirectory(tempRepoPath)                         │
│      Cleanup temporary files                                │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  RETURN SUMMARY JSON                                        │
│  {ghost_name, repo, pr_number, pr_url, status: "success"}  │
└─────────────────────────────────────────────────────────────┘
```

---

## 🐛 Troubleshooting

### **"Failed to clone repository"**
- Check if the repository URL is correct
- Verify you have access to the repository
- Ensure `git` is installed: `git --version`

### **"OPENROUTER_API_KEY is not set"**
- Make sure `.env` file exists (not just `.env.example`)
- Verify the API key is valid
- Check for typos in variable names

### **"Request failed with status code 402"**
- Your OpenRouter account is out of credits
- Visit https://openrouter.ai/settings/credits to add funds
- Or use a cheaper model: `OPENROUTER_MODEL=openai/gpt-3.5-turbo`

### **"Failed to create Pull Request"**
- Verify GitHub token has `repo` scope permissions
- Check if you have write access to the repository
- Ensure you're not trying to PR to a fork you don't own

### **"No code files found to analyze"**
- Repository might be empty or only contain documentation
- Check if file extensions are supported (see `utils.js` line 94)
- Verify ignore patterns aren't too restrictive

---

## 💡 How The AI Prompting Works

The AI receives this structured prompt:

```
Analyze the following repository: owner/repo

Code Files:
--- File: src/app.js ---
[actual code content]

--- File: src/utils.js ---
[actual code content]

Please analyze this code and suggest improvements. Focus on:
1. Code quality and readability
2. Potential bugs or issues
3. Performance optimizations
4. Best practices and patterns
5. Security concerns

Return your response as a JSON object with this exact structure:
{
  "summary": "Brief overview of findings",
  "improvements": [
    {
      "file": "path/to/file.js",
      "description": "What needs to be improved",
      "reason": "Why this improvement is needed",
      "changes": "Specific code changes to make"
    }
  ],
  "priority": "high/medium/low"
}
```

**Why this works:**
- Clear structure helps AI understand the task
- JSON format ensures parseable responses
- Specific focus areas guide the analysis
- File-by-file improvements allow targeted changes

---

## 🚧 Future Enhancements

- [ ] Support for multiple PR strategies (one per improvement vs. combined)
- [ ] Integration with CI/CD for automatic testing
- [ ] Web dashboard for managing GhostCoder runs
- [ ] Support for custom analysis rules/plugins
- [ ] Slack/Discord notifications
- [ ] Batch processing of multiple repositories
- [ ] Cost tracking for API usage
- [ ] Support for custom AI prompts via config file
- [ ] Rollback mechanism if PR is rejected
- [ ] Integration with code quality tools (ESLint, Prettier, etc.)

---

## 🧪 Technical Implementation Details

### **Authentication Flow**

**GitHub Authentication:**
```javascript
// Uses Personal Access Token
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

// For git push, injects token into URL:
const authenticatedUrl = url.replace('https://', `https://${token}@`);
```

**OpenRouter Authentication:**
```javascript
// Bearer token in headers
headers: {
  'Authorization': `Bearer ${apiKey}`,
  'Content-Type': 'application/json'
}
```

### **File Size Management**

To avoid API token limits:
```javascript
// Per-file limit: 100KB
const maxSize = 100000;

// Total content limit: ~50KB
const maxTotalSize = 50000;

// Only includes files that fit within limits
```

### **Branch Naming Strategy**

```javascript
// Format: ghostcoder-improvements-<timestamp>
// Example: ghostcoder-improvements-1762591797316
// Ensures unique branch names for parallel runs
```

### **Error Handling Pattern**

```javascript
try {
  // Main workflow
} catch (error) {
  log(`Failed: ${error.message}`, 'error');
  // Cleanup temp files
  await deleteDirectory(tempRepoPath);
  throw error; // Re-throw for CLI handling
}
```

### **Logging System**

```javascript
// Emoji-based severity levels:
log('message', 'info')    // ⚙️
log('message', 'success') // ✅
log('message', 'error')   // ❌
log('message', 'warning') // ⚠️
log('message', 'ghost')   // 👻
log('message', 'code')    // 💻
log('message', 'pr')      // 🔀
```

### **Environment Configuration**

```env
# Required
OPENROUTER_API_KEY=sk-or-v1-xxxxx
GITHUB_TOKEN=ghp_xxxxx

# Optional with defaults
TEMP_DIR=./temp_repos
OPENROUTER_MODEL=anthropic/claude-3.5-sonnet
BASE_BRANCH=ghostcoder-improvements
```

### **Supported File Extensions**

```javascript
const codeExtensions = [
  '.js',   // JavaScript
  '.ts',   // TypeScript
  '.jsx',  // React
  '.tsx',  // React TypeScript
  '.py',   // Python
  '.java', // Java
  '.go',   // Go
  '.rs',   // Rust
  '.rb',   // Ruby
  '.php',  // PHP
  '.c',    // C
  '.cpp',  // C++
  '.cs'    // C#
];
```

### **Git Configuration**

```javascript
// Bot commits appear as:
user.name = "GhostCoder Bot"
user.email = "ghostcoder@bot.github.com"
```

---

## 📊 Performance Metrics

**Average Execution Time:**
- Small repos (<10 files): ~30-45 seconds
- Medium repos (10-50 files): ~1-2 minutes
- Large repos (50+ files): ~2-5 minutes

**API Costs (approximate):**
- Claude 3.5 Sonnet: $0.02-0.05 per analysis
- GPT-3.5 Turbo: $0.001-0.003 per analysis
- GPT-4 Turbo: $0.01-0.03 per analysis

**Token Usage:**
- Average input: 500-1500 tokens
- Average output: 300-1000 tokens
- Total per run: 800-2500 tokens

---

## 🔒 Security Best Practices

1. **Never commit `.env` file**
   - Already included in `.gitignore`
   - Contains sensitive API keys

2. **Use minimal GitHub token permissions**
   - Only needs: `repo` scope
   - Avoid using admin tokens

3. **Review AI-generated code before merging**
   - AI can make mistakes
   - Always manually review PRs

4. **Limit file access**
   - Only processes code files
   - Ignores sensitive directories

5. **Clean up temporary data**
   - Automatically deletes cloned repos
   - No data persistence on disk

---

## � Example Output

```json
{
  "ghost_name": "GhostCoder",
  "repo": "ayushmanlakshkar/Wack-A-Mole",
  "pr_number": 7,
  "pr_url": "https://github.com/ayushmanlakshkar/Wack-A-Mole/pull/7",
  "branch": "ghostcoder-improvements-1762591797316",
  "message": "Improved code structure and added error handling",
  "changes_count": 2,
  "files_modified": [
    "src/game.js",
    "src/utils.js"
  ],
  "status": "success"
}
```

---

## �📄 License

MIT License - feel free to use this project however you'd like!

## 👨‍💻 Author

**Ayushman Lakshkar**
- GitHub: [@ayushmanlakshkar](https://github.com/ayushmanlakshkar)
- Project: GhostCoder Backend

---

## 🙏 Acknowledgments

- **OpenRouter** - AI API aggregation platform
- **GitHub** - Version control and PR infrastructure
- **Octokit** - Official GitHub API library
- **simple-git** - Excellent Git wrapper for Node.js

---

**Happy Ghostcoding! 👻✨**

*Built with passion by Ayushman Lakshkar*
