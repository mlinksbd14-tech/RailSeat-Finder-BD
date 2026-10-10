/**
 * scripts/turnstile-auto-solver.js
 * 
 * 100% Automated Background Cloudflare Turnstile Token Solver & Bridge
 * Eliminates the need to ever open eticket.railway.gov.bd manually.
 * Completely invisible background execution (Zero popups, zero UI intrusion).
 * 
 * Features:
 * 1. Headless Chromium automated Turnstile resolution with session authentication.
 * 2. In-memory caching (tokens reused for up to 3 minutes).
 * 3. Concurrency lock (multiple concurrent requests share a single browser solve).
 * 4. Automatic sync with data/latest_turnstile_token.json and data/session.json.
 */

const fs = require('fs');
const path = require('path');

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
 * Solve Cloudflare Turnstile automatically in headless Chromium
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

  // If a solve is already underway, await that existing promise
  if (ongoingSolvePromise) {
    return ongoingSolvePromise;
  }

  ongoingSolvePromise = (async () => {
    // ── STEP 1: Camoufox C++ Stealth Anti-Detect Engine (Highest Turnstile Evasion) ──
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
    }

    // ── STEP 2: Fallback to Playwright Chrome Engine ──
    let chromium;
    try {
      chromium = require('playwright').chromium;
    } catch (err) {
      console.warn('[Turnstile Auto-Solver] Playwright not available:', err.message);
      return null;
    }

    console.log('[Turnstile Auto-Solver] 🌐 Launching background Playwright Chrome engine to acquire fresh Turnstile token...');
    let browser = null;
    try {
      const launchArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled'
      ];
      try {
        browser = await chromium.launch({ channel: 'chrome', headless: true, args: launchArgs });
      } catch (e) {
        browser = await chromium.launch({ headless: true, args: launchArgs });
      }

      const sess = loadSession();
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        locale: 'en-US'
      });

      await context.addInitScript((sessionData) => {
        try {
          sessionStorage.setItem('disclaimer_agreed_for_home', '1');
          localStorage.setItem('disclaimer_agreed_for_home', '1');
          if (sessionData && sessionData.token) {
            localStorage.setItem('token', sessionData.token);
            if (sessionData.user) localStorage.setItem('user', JSON.stringify(sessionData.user));
            if (sessionData.deviceId) localStorage.setItem('device_id', sessionData.deviceId);
            if (sessionData.deviceKey) localStorage.setItem('device_key', sessionData.deviceKey);
          }
        } catch (e) {}
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      }, sess);

      const page = await context.newPage();

      // Allow Cloudflare Turnstile resources to load unimpeded
      let capturedToken = null;

      page.on('request', req => {
        const url = req.url();
        if (url.includes('cft_response=')) {
          const match = url.match(/[?&]cft_response=([^&'"\s]+)/i);
          if (match && match[1]) {
            capturedToken = decodeURIComponent(match[1]);
          }
        }
      });

      const targetUrl = 'https://eticket.railway.gov.bd/booking/train/search?fromcity=Dhaka&tocity=Chattogram&doj=19-Oct-2026&class=S_CHAIR';
      console.log(`[Turnstile Auto-Solver] 🧭 Navigating to Railway booking search page via Playwright: ${targetUrl}`);
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});

      // Fast-poll the DOM and network for Cloudflare Turnstile token completion (up to 14s)
      const startTime = Date.now();
      while (Date.now() - startTime < 14000) {
        if (capturedToken && capturedToken.length > 20) break;

        // Auto-dismiss disclaimer if rendered
        await page.evaluate(() => {
          try {
            sessionStorage.setItem('disclaimer_agreed_for_home', '1');
            const agree = document.querySelector('.agree-btn, button.agree-btn, .disclaimer-bottom-sheet-action-btn button');
            if (agree && !agree._autoClicked) {
              agree._autoClicked = true;
              agree.click();
            }
          } catch (e) {}
        }).catch(() => {});

        // If Cloudflare Turnstile iframe has an interactive checkbox, click it
        const frames = page.frames();
        for (const f of frames) {
          if (f.url().includes('challenges.cloudflare.com')) {
            try {
              const box = await f.$('input[type="checkbox"], #challenge-stage, .ctp-checkbox-label');
              if (box) await box.click().catch(() => {});
            } catch (e) {}
          }
        }

        const resolvedToken = await page.evaluate(() => {
          const input = document.querySelector('input[name="cf-turnstile-response"], input[name="cft_response"]');
          if (input && input.value && input.value.length > 20) {
            return input.value;
          }
          if (window.turnstile && typeof window.turnstile.getResponse === 'function') {
            const resp = window.turnstile.getResponse();
            if (resp && resp.length > 20) return resp;
          }
          if (window.turnstileToken && window.turnstileToken.length > 20) {
            return window.turnstileToken;
          }
          return null;
        }).catch(() => null);

        if (resolvedToken) {
          capturedToken = resolvedToken;
          break;
        }

        await new Promise(r => setTimeout(r, 400));
      }

      if (capturedToken) {
        console.log(`[Turnstile Auto-Solver] ⚡ Successfully acquired fresh Cloudflare Turnstile token (${capturedToken.substring(0, 18)}...)!`);
        cachedToken = capturedToken;
        cachedTimestamp = Date.now();

        // Persist to data/latest_turnstile_token.json
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(TOKEN_FILE, JSON.stringify({ token: capturedToken, timestamp: cachedTimestamp }, null, 2));

        // Update data/session.json if session exists
        if (fs.existsSync(SESSION_FILE)) {
          try {
            const currentSess = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
            currentSess.cftResponse = capturedToken;
            currentSess.lastUpdated = new Date().toISOString();
            fs.writeFileSync(SESSION_FILE, JSON.stringify(currentSess, null, 2));
          } catch (e) {}
        }

        return capturedToken;
      }
    } catch (err) {
      console.warn('[Turnstile Auto-Solver] Playwright notice:', err.message);
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
        browser = null;
      }
    }

    // ── STEP 3: Fallback to Puppeteer Chrome Engine ──
    try {
      let puppeteer;
      try { puppeteer = require('puppeteer'); } catch (e) { puppeteer = null; }
      if (puppeteer) {
        console.log('[Turnstile Auto-Solver] 🌐 Launching background Puppeteer Chrome engine to acquire fresh Turnstile token...');
        const pBrowser = await puppeteer.launch({
          headless: 'new',
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled'
          ]
        });
        try {
          const pPage = await pBrowser.newPage();
          await pPage.setViewport({ width: 1280, height: 800 });
          await pPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36');
          
          const sess = loadSession();
          await pPage.evaluateOnNewDocument((sessionData) => {
            try {
              sessionStorage.setItem('disclaimer_agreed_for_home', '1');
              localStorage.setItem('disclaimer_agreed_for_home', '1');
              if (sessionData && sessionData.token) {
                localStorage.setItem('token', sessionData.token);
                if (sessionData.user) localStorage.setItem('user', JSON.stringify(sessionData.user));
                if (sessionData.deviceId) localStorage.setItem('device_id', sessionData.deviceId);
                if (sessionData.deviceKey) localStorage.setItem('device_key', sessionData.deviceKey);
              }
            } catch (e) {}
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
          }, sess);

          let pCapturedToken = null;
          pPage.on('request', req => {
            const url = req.url();
            if (url.includes('cft_response=')) {
              const match = url.match(/[?&]cft_response=([^&'"\s]+)/i);
              if (match && match[1]) pCapturedToken = decodeURIComponent(match[1]);
            }
          });

          const targetUrl = 'https://eticket.railway.gov.bd/booking/train/search?fromcity=Dhaka&tocity=Chattogram&doj=19-Oct-2026&class=S_CHAIR';
          console.log(`[Turnstile Auto-Solver] 🧭 Navigating to Railway booking search page via Puppeteer: ${targetUrl}`);
          await pPage.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});

          const pStartTime = Date.now();
          while (Date.now() - pStartTime < 14000) {
            if (pCapturedToken && pCapturedToken.length > 20) break;

            const resolved = await pPage.evaluate(() => {
              const input = document.querySelector('input[name="cf-turnstile-response"], input[name="cft_response"]');
              if (input && input.value && input.value.length > 20) return input.value;
              if (window.turnstile && typeof window.turnstile.getResponse === 'function') {
                const r = window.turnstile.getResponse();
                if (r && r.length > 20) return r;
              }
              return null;
            }).catch(() => null);

            if (resolved) {
              pCapturedToken = resolved;
              break;
            }
            await new Promise(r => setTimeout(r, 400));
          }

          if (pCapturedToken) {
            console.log(`[Turnstile Auto-Solver] ⚡ Puppeteer successfully acquired fresh Turnstile token (${pCapturedToken.substring(0, 18)}...)!`);
            cachedToken = pCapturedToken;
            cachedTimestamp = Date.now();

            if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
            fs.writeFileSync(TOKEN_FILE, JSON.stringify({ token: pCapturedToken, timestamp: cachedTimestamp }, null, 2));

            if (fs.existsSync(SESSION_FILE)) {
              try {
                const currentSess = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
                currentSess.cftResponse = pCapturedToken;
                currentSess.lastUpdated = new Date().toISOString();
                fs.writeFileSync(SESSION_FILE, JSON.stringify(currentSess, null, 2));
              } catch (e) {}
            }
            return pCapturedToken;
          }
        } finally {
          await pBrowser.close().catch(() => {});
        }
      }
    } catch (peErr) {
      console.warn('[Turnstile Auto-Solver] Puppeteer solver notice:', peErr.message);
    } finally {
      ongoingSolvePromise = null;
    }

    console.warn('[Turnstile Auto-Solver] ⚠️ Turnstile token could not be acquired across active solvers.');
    return null;
  })();

  return ongoingSolvePromise;
}

module.exports = {
  solveTurnstileToken,
  getCachedToken
};
