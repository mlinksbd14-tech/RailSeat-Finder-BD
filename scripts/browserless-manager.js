/**
 * scripts/browserless-manager.js
 * 
 * Remote Browserless.io Cloud Client via WebSocket (puppeteer-core)
 * 
 * Offloads all heavy browser automation, DOM execution, and Turnstile challenge resolution
 * to Browserless.io cloud servers.
 * 
 * Memory on Render: ~5MB RAM (Only streams CDP messages over WebSocket).
 * Zero local Chromium/Firefox binaries required.
 */

let puppeteerCore = null;
try {
  puppeteerCore = require('puppeteer-core');
} catch (e) {
  // Graceful fallback if puppeteer-core is not installed
}

/**
 * Checks if Browserless.io is configured and ready to use
 */
function isBrowserlessAvailable() {
  if (!puppeteerCore) return false;
  const key = (process.env.BROWSERLESS_API_KEY || process.env.BROWSERLESS_KEY || '').trim();
  const url = (process.env.BROWSERLESS_URL || '').trim();
  return !!(key || url);
}

/**
 * Builds the Browserless.io WebSocket URL with stealth and anti-bot flags
 */
function getBrowserlessWsEndpoint() {
  const customUrl = (process.env.BROWSERLESS_URL || '').trim();
  if (customUrl) {
    return customUrl.startsWith('ws') ? customUrl : `wss://${customUrl.replace(/^https?:\/\//, '')}`;
  }

  const apiKey = (process.env.BROWSERLESS_API_KEY || process.env.BROWSERLESS_KEY || '').trim();
  if (!apiKey) return null;

  // Browserless.io official cloud WebSocket endpoint with stealth flags
  const params = new URLSearchParams({
    token: apiKey,
    stealth: 'true',
    '--no-sandbox': 'true',
    '--disable-setuid-sandbox': 'true',
    '--disable-dev-shm-usage': 'true',
    '--disable-blink-features': 'AutomationControlled'
  });

  return `wss://chrome.browserless.io?${params.toString()}`;
}

/**
 * Executes a function with a remote Browserless browser instance
 * Guarantees that the remote browser is cleanly closed in all scenarios
 * 
 * @param {Function} taskFn - async (page, browser) => result
 * @param {Object} options - { timeoutMs: 30000, viewport: { width, height } }
 */
async function withBrowserless(taskFn, options = {}) {
  if (!isBrowserlessAvailable()) {
    throw new Error('Browserless is not available. Please set BROWSERLESS_API_KEY in environment.');
  }

  const endpoint = getBrowserlessWsEndpoint();
  const timeoutMs = options.timeoutMs || 30000;

  let browser = null;
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`Browserless task timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  const executionPromise = (async () => {
    browser = await puppeteerCore.connect({
      browserWSEndpoint: endpoint
    });

    const page = await browser.newPage();
    const vp = options.viewport || { width: 1280, height: 800 };
    await page.setViewport(vp);

    await page.setUserAgent(
      options.userAgent ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
    );

    return await taskFn(page, browser);
  })();

  try {
    return await Promise.race([executionPromise, timeoutPromise]);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

/**
 * Remotely solves Cloudflare Turnstile token on Bangladesh Railway via Browserless.io
 * @param {string} targetUrl - Railway search URL
 * @returns {Promise<string|null>} Turnstile token (cft_response)
 */
async function solveTurnstileRemote(targetUrl = '') {
  if (!isBrowserlessAvailable()) return null;

  const url = targetUrl || 'https://eticket.railway.gov.bd/booking/train/search?fromcity=Dhaka&tocity=Chattogram&doj=19-Oct-2026&class=S_CHAIR';
  console.log(`[Browserless Cloud] 🌐 Connecting to Browserless.io WebSocket to solve Turnstile remotely...`);

  try {
    const startTime = Date.now();
    const token = await withBrowserless(async (page) => {
      let capturedToken = null;

      // Intercept network requests for cft_response
      page.on('request', req => {
        const reqUrl = req.url();
        if (reqUrl.includes('cft_response=')) {
          const match = reqUrl.match(/[?&]cft_response=([^&'"\s]+)/i);
          if (match && match[1]) {
            capturedToken = decodeURIComponent(match[1]);
          }
        }
      });

      // Inject consent before navigation
      await page.evaluateOnNewDocument(() => {
        try {
          sessionStorage.setItem('disclaimer_agreed_for_home', '1');
          localStorage.setItem('disclaimer_agreed_for_home', '1');
        } catch (e) {}
      });

      console.log(`[Browserless Cloud] 🧭 Navigating to Railway booking search page on remote Chrome...`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});

      // Fast-poll remote DOM and network for completed Turnstile token (up to 14s)
      const pollStart = Date.now();
      while (Date.now() - pollStart < 14000) {
        if (capturedToken && capturedToken.length > 20) break;

        // Auto-click disclaimer if present
        await page.evaluate(() => {
          try {
            const agree = document.querySelector('.agree-btn, button.agree-btn, .disclaimer-bottom-sheet-action-btn button');
            if (agree && !agree._autoClicked) {
              agree._autoClicked = true;
              agree.click();
            }
          } catch (e) {}
        }).catch(() => {});

        // Check if token value is in the DOM
        const inDom = await page.evaluate(() => {
          const input = document.querySelector('input[name="cf-turnstile-response"], input[name="cft_response"]');
          if (input && input.value && input.value.length > 20) return input.value;
          if (window.turnstile && typeof window.turnstile.getResponse === 'function') {
            const resp = window.turnstile.getResponse();
            if (resp && resp.length > 20) return resp;
          }
          return null;
        }).catch(() => null);

        if (inDom) {
          capturedToken = inDom;
          break;
        }

        await new Promise(r => setTimeout(r, 400));
      }

      return capturedToken;
    }, { timeoutMs: 25000 });

    if (token) {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.log(`[Browserless Cloud] ⚡ Successfully acquired Turnstile token remotely via Browserless.io (${elapsed}s, token: ${token.substring(0, 16)}...)!`);
      return token;
    } else {
      console.warn('[Browserless Cloud] ⚠️ Remote browser did not capture a Turnstile token within timeout.');
      return null;
    }
  } catch (err) {
    console.warn(`[Browserless Cloud] Remote solve error: ${err.message}`);
    return null;
  }
}

/**
 * Diagnostic health check for Browserless connection
 */
async function testBrowserlessConnection() {
  if (!isBrowserlessAvailable()) {
    return {
      success: false,
      configured: false,
      message: 'BROWSERLESS_API_KEY is not configured in environment variables.'
    };
  }

  const start = Date.now();
  try {
    const result = await withBrowserless(async (page) => {
      await page.goto('about:blank');
      return await page.evaluate(() => navigator.userAgent);
    }, { timeoutMs: 12000 });

    const latencyMs = Date.now() - start;
    return {
      success: true,
      configured: true,
      latencyMs: latencyMs,
      userAgent: result,
      message: `Connected successfully to Browserless.io WebSocket in ${latencyMs}ms.`
    };
  } catch (err) {
    return {
      success: false,
      configured: true,
      error: err.message,
      message: `Failed to connect to Browserless.io: ${err.message}`
    };
  }
}

module.exports = {
  isBrowserlessAvailable,
  withBrowserless,
  solveTurnstileRemote,
  testBrowserlessConnection
};
