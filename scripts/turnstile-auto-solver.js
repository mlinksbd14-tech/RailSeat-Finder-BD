/**
 * scripts/turnstile-auto-solver.js
 * 
 * 100% Automated Background Cloudflare Turnstile Token Solver & Bridge
 * Eliminates the need to ever open eticket.railway.gov.bd manually.
 * Completely invisible background execution (Zero popups, zero UI intrusion).
 * 
 * Features:
 * 1. Anti-detect stealth resolution via pre-warmed daemon or Camoufox engine.
 * 2. In-memory caching (tokens reused for up to 3 minutes).
 * 3. Concurrency lock (multiple concurrent requests share a single solve).
 * 4. Automatic sync with data/latest_turnstile_token.json and data/session.json.
 */

const fs = require('fs');
const path = require('path');

const isRender = !!(process.env.RENDER || process.env.RENDER_SERVICE_ID || process.env.RENDER_INSTANCE_ID);
const isVercel = !!(process.env.VERCEL || process.env.NOW_REGION);
const isLowMemory = isRender || isVercel || process.env.DISABLE_LOCAL_BROWSER === 'true' || process.env.LOW_MEMORY === 'true';

let cachedToken = null;
let cachedTimestamp = 0;
let ongoingSolvePromise = null;

const DATA_DIR = path.join(__dirname, '..', 'data');
const TOKEN_FILE = path.join(DATA_DIR, 'latest_turnstile_token.json');
const SESSION_FILE = path.join(DATA_DIR, 'session.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

// Initialize from disk if available and still fresh
function initFromDisk() {
  if (fs.existsSync(TOKEN_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
      if (data && data.token && data.timestamp) {
        const age = Date.now() - data.timestamp;
        if (age < 300000) { // < 5 minutes
          cachedToken = data.token;
          cachedTimestamp = data.timestamp;
          console.log(`[Turnstile Auto-Solver] 💾 Loaded fresh token from disk (${Math.round(age / 1000)}s old)`);
        }
      }
    } catch (e) {}
  }
}

initFromDisk();

function getCachedToken() {
  if (cachedToken && (Date.now() - cachedTimestamp < 45000)) { // 45 seconds (Turnstile tokens expire quickly)
    return { token: cachedToken, age: Math.round((Date.now() - cachedTimestamp) / 1000) };
  }
  return null;
}

function loadSession() {
  if (fs.existsSync(SESSION_FILE)) {
    try {
      const sess = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
      if (sess && sess.token) return sess;
    } catch (e) {}
  }
  if (fs.existsSync(USERS_FILE)) {
    try {
      const uData = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
      if (uData && Array.isArray(uData.users)) {
        const found = uData.users.find(u => u.shohozSession && u.shohozSession.token);
        if (found) return found.shohozSession;
      }
    } catch (e) {}
  }
  return null;
}

/**
 * Solve Cloudflare Turnstile automatically
 * @param {boolean} force - Whether to force a fresh token fetch
 * @returns {Promise<string|null>} Fresh Turnstile token (cft_response)
 */
async function solveTurnstileToken(force = false, journeyDate = '') {
  // Return cached token if valid and not forcing refresh
  if (!force) {
    const existing = getCachedToken();
    if (existing) {
      return existing.token;
    }
  }

  // Refresh from disk if available
  initFromDisk();
  const diskFresh = getCachedToken();
  if (diskFresh && !force) {
    return diskFresh.token;
  }

  // In constrained cloud environments (Render 512MB / Vercel), do NOT spawn heavy in-container browser processes
  if (isLowMemory) {
    // 1. If Browserless.io remote cloud browser is available, solve remotely! (~5MB RAM on Render)
    try {
      const { isBrowserlessAvailable, solveTurnstileRemote } = require('./browserless-manager');
      if (isBrowserlessAvailable()) {
        const remoteToken = await solveTurnstileRemote();
        if (remoteToken) {
          cachedToken = remoteToken;
          cachedTimestamp = Date.now();
          try {
            if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
            fs.writeFileSync(TOKEN_FILE, JSON.stringify({ token: remoteToken, timestamp: cachedTimestamp }, null, 2));
          } catch (e) {}
          return remoteToken;
        }
      }
    } catch (bErr) {
      console.warn('[Turnstile Auto-Solver] Browserless remote solve notice:', bErr.message);
    }

    // 2. If an external daemon URL is provided, query it
    if (process.env.CAMOUFOX_DAEMON_URL) {
      try {
        const axios = require('axios');
        const dRes = await axios.get(`${process.env.CAMOUFOX_DAEMON_URL}/get-token`, { timeout: 5000 });
        if (dRes.data?.token) {
          cachedToken = dRes.data.token;
          cachedTimestamp = Date.now();
          return cachedToken;
        }
      } catch (e) {}
    }
    console.log('[Turnstile Auto-Solver] 🛡️ Running in low-memory cloud mode (Render 512MB limit). Skipping local browser launch.');
    return cachedToken || (diskFresh ? diskFresh.token : null);
  }

  // If a solve is already underway, await that existing promise
  if (ongoingSolvePromise) {
    return ongoingSolvePromise;
  }

  ongoingSolvePromise = (async () => {
    // ── Camoufox C++ Stealth Anti-Detect Engine (Highest Turnstile Evasion) ──
    try {
      const { execFile } = require('child_process');
      const camoufoxScript = path.join(__dirname, 'camoufox-token-worker.py');
      if (fs.existsSync(camoufoxScript)) {
        console.log('[Turnstile Auto-Solver] 🦊 Launching stealth Camoufox engine to acquire fresh Turnstile token...');
        const pyExe = process.env.PYTHON_PATH || 'C:\\Users\\User\\AppData\\Local\\Python\\pythoncore-3.14-64\\python.exe';
        const camoufoxToken = await new Promise((resolve) => {
          execFile(pyExe, [camoufoxScript, '--once'], { timeout: 35000, env: process.env }, (err) => {
            if (err) {
              console.warn('[Turnstile Auto-Solver] Camoufox notice:', err.message);
            }
            // Always check latest_turnstile_token.json on disk for freshly saved token
            try {
              if (fs.existsSync(TOKEN_FILE)) {
                const disk = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
                if (disk && disk.token && (Date.now() - disk.timestamp < 180000)) {
                  cachedToken = disk.token;
                  cachedTimestamp = disk.timestamp;
                  return resolve(disk.token);
                }
              }
            } catch (e) {}

            const fresh = getCachedToken();
            if (fresh && fresh.token) return resolve(fresh.token);
            resolve(null);
          });
        });
        if (camoufoxToken) {
          console.log('[Turnstile Auto-Solver] 🚀 Fresh token successfully acquired via Camoufox C++ engine!');
          return camoufoxToken;
        }
      }
    } catch (camErr) {
      console.warn('[Turnstile Auto-Solver] Camoufox notice:', camErr.message);
    } finally {
      ongoingSolvePromise = null;
    }

    console.warn('[Turnstile Auto-Solver] ⚠️ Turnstile token could not be acquired.');
    return null;
  })();

  return ongoingSolvePromise;
}

module.exports = {
  solveTurnstileToken,
  getCachedToken
};
