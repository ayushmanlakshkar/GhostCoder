/**
 * 👻 GhostCoder - Memory Manager
 *
 * @deprecated This module is deprecated in favor of the new semantic indexing system.
 * The semantic index (symbolGraph.js + embeddingIndex.js + contextRetriever.js)
 * provides much more intelligent context management using embeddings and symbol graphs
 * similar to GitHub Copilot and Cursor.
 *
 * Kept for backward compatibility only.
 *
 * Stores short-term memory per-repo in a local JSON file with simple locking
 * and atomic writes to avoid corruption. Designed to be modular and swapped
 * out for Redis/DB later.
 */

import fs from 'fs/promises';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const MEMORY_FILE = path.join(DATA_DIR, 'memory_store.json');
const LOCK_FILE = `${MEMORY_FILE}.lock`;

// Defaults
const DEFAULT_MAX_ENTRIES = 50;
const DEFAULT_TIMEOUT_MS = 5000;

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function acquireLock(retries = 50, delay = 100) {
  // Try to create a lock file atomically using flag 'wx'
  for (let i = 0; i < retries; i++) {
    try {
      const fh = await fs.open(LOCK_FILE, 'wx');
      await fh.close();
      return;
    } catch (err) {
      // If file exists, wait and retry
      await new Promise(res => setTimeout(res, delay));
    }
  }
  throw new Error('Could not acquire memory store lock');
}

async function releaseLock() {
  try {
    await fs.unlink(LOCK_FILE);
  } catch (err) {
    // ignore
  }
}

async function readMemoryFile() {
  try {
    const raw = await fs.readFile(MEMORY_FILE, 'utf-8');
    return JSON.parse(raw || '{}');
  } catch (err) {
    // If file does not exist or is invalid, return empty object
    return {};
  }
}

async function writeMemoryFile(obj) {
  // Atomic write: write to temp file then rename
  const tmp = `${MEMORY_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2), 'utf-8');
  await fs.rename(tmp, MEMORY_FILE);
}

/**
 * Add a memory entry for a given repoId.
 * Keeps only the most recent `maxEntries` (default 50).
 * memoryObject should include at least: { prId?, summary, improvements, timestamp }
 */
export async function addToMemory(repoId, memoryObject, maxEntries = DEFAULT_MAX_ENTRIES) {
  await ensureDataDir();
  await acquireLock();
  try {
    const store = await readMemoryFile();
    if (!store[repoId]) store[repoId] = [];
    // Ensure timestamp exists
    if (!memoryObject.timestamp) memoryObject.timestamp = Date.now();

    store[repoId].push(memoryObject);
    // Trim to most recent maxEntries
    if (store[repoId].length > maxEntries) {
      store[repoId] = store[repoId].slice(-maxEntries);
    }
    await writeMemoryFile(store);
  } finally {
    await releaseLock();
  }
}

/**
 * Get recent memory entries for a repoId (most recent first)
 */
export async function getRecentContext(repoId, limit = 3) {
  await ensureDataDir();
  // No lock for read-only optimistic access — we'll still attempt to read safely
  try {
    const store = await readMemoryFile();
    const entries = store[repoId] || [];
    console.log(`Memory entries for ${repoId}: ${entries.length}`);
    // Return newest first
    return entries.slice(-limit).reverse();
  } catch (err) {
    return [];
  }
}

/**
 * Clear memory for a particular repoId
 */
export async function clearMemory(repoId) {
  await ensureDataDir();
  await acquireLock();
  try {
    const store = await readMemoryFile();
    delete store[repoId];
    await writeMemoryFile(store);
  } finally {
    await releaseLock();
  }
}

/**
 * Low-level access (for debugging) — returns full store
 */
export async function _readAll() {
  await ensureDataDir();
  return readMemoryFile();
}

export default {
  addToMemory,
  getRecentContext,
  clearMemory,
  _readAll
};
