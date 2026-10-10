/**
 * scripts/playwright-seatmap-grabber.js
 * 
 * High-Speed Playwright Worker for Bangladesh Railway Live Seat Map Acquisition.
 * Uses real Google Chrome / Chromium engine to:
 * 1. Navigate to eticket.railway.gov.bd with genuine browser fingerprints.
 * 2. Auto-dismiss Disclaimer ("I AGREE") popups.
 * 3. Extract 100% genuine live coach layouts directly from network response interception.
 * 4. Capture Turnstile tokens and sync them to server vault.
 * 5. Take high-resolution screenshots for Telegram / dashboard.
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { chromium } = require('playwright');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SCREENSHOTS_DIR = path.join(__dirname, '..', 'screenshots');
const TOKEN_FILE = path.join(DATA_DIR, 'latest_turnstile_token.json');
const SESSION_FILE = path.join(DATA_DIR, 'session.json');

const TELEGRAM_BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const TELEGRAM_CHAT_ID = (process.env.TELEGRAM_CHAT_ID || '').trim();

function loadSession() {
  if (fs.existsSync(SESSION_FILE)) {
    try {
      const sess = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
      if (sess && sess.token) return sess;
    } catch (e) {}
  }
  return null;
}

async function sendTelegramPhoto(chatId, photoPath, caption) {
  if (!TELEGRAM_BOT_TOKEN || !chatId || !fs.existsSync(photoPath)) return;
  const FormData = require('form-data');
  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('caption', caption);
  form.append('parse_mode', 'HTML');
  form.append('photo', fs.createReadStream(photoPath));

  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, form, {
      headers: form.getHeaders(),
      timeout: 25000
    });
    console.log('[Playwright] 📸 Seat map screenshot delivered to Telegram!');
  } catch (e) {
    console.warn('[Playwright] Telegram photo upload notice:', e.message);
  }
}

function formatShohozDoj(dateStr) {
  if (!dateStr) return '';
  const clean = String(dateStr).trim();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (clean.includes('-')) {
    const parts = clean.split('-');
    if (parts.length === 3) {
      if (parts[0].length === 4) {
        const y = parts[0];
        const mIdx = parseInt(parts[1], 10) - 1;
        const d = parts[2].padStart(2, '0');
        if (mIdx >= 0 && mIdx < 12) return `${d}-${months[mIdx]}-${y}`;
      }
      if (parts[2].length === 4) {
        return clean;
      }
    }
  }
  return clean;
}

/**
 * Grabs live seat map using Playwright with real Chrome
 * @param {Object} options 
 * @returns {Promise<{success: boolean, layout: Object|null, token: string|null, screenshot: string|null}>}
 */
async function grabLiveSeatmapWithPlaywright(options = {}) {
  const fromStation = options.fromCity || options.fromStation || process.env.FROM_STATION || 'Dhaka';
  const toStation = options.toCity || options.toStation || process.env.TO_STATION || 'Chattogram';
  const rawDate = options.journeyDate || options.date || process.env.JOURNEY_DATE || new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const journeyDate = formatShohozDoj(rawDate);
  const seatClass = (options.seatClass || options.seat_class || 'S_CHAIR').toUpperCase();
  const trainFilter = (options.trainName || options.trainModel || '').toLowerCase().trim();

  console.log('====================================================');
  console.log('🎭 Playwright Live Seat Map Automation Worker');
  console.log(`📍 Route: ${fromStation} ➔ ${toStation} | Date: ${journeyDate} | Class: ${seatClass}`);
  console.log('====================================================');

  let browser = null;
  let capturedToken = null;
  let capturedLayout = null;
  let screenshotPath = null;

  try {
    // Launch Chrome with high-stealth parameters
    const launchArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1280,900'
    ];

    try {
      browser = await chromium.launch({ channel: 'chrome', headless: true, args: launchArgs });
      console.log('🌐 Launched system Google Chrome via Playwright');
    } catch (chromeErr) {
      browser = await chromium.launch({ headless: true, args: launchArgs });
      console.log('🌐 Launched bundled Chromium via Playwright');
    }

    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      locale: 'en-US'
    });

    // 1. Inject anti-bot stealth & pre-set Disclaimer suppression
    const sess = loadSession();
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

    // 2. Intercept network requests for Turnstile token & seat layout JSON
    page.on('request', req => {
      const url = req.url();
      if (url.includes('cft_response=')) {
        const match = url.match(/[?&]cft_response=([^&'"\s]+)/i);
        if (match && match[1]) {
          capturedToken = decodeURIComponent(match[1]);
          console.log(`[Playwright] ⚡ Intercepted Turnstile token from request: ${capturedToken.substring(0, 16)}...`);
        }
      }
    });

    page.on('response', async resp => {
      const url = resp.url();
      if (url.includes('/bookings/seat-layout') && resp.status() === 200) {
        try {
          const json = await resp.json();
          if (json && (json.data || json.coaches)) {
            capturedLayout = json.data || json;
            console.log('[Playwright] 🎯 Successfully intercepted 100% Genuine Live Seat Map JSON from Railway server!');
          }
        } catch (e) {}
      }
    });

    // 3. Navigate to railway search route
    const searchUrl = `https://eticket.railway.gov.bd/booking/train/search?fromcity=${encodeURIComponent(fromStation)}&tocity=${encodeURIComponent(toStation)}&doj=${encodeURIComponent(journeyDate)}&class=${encodeURIComponent(seatClass)}`;
    console.log(`🧭 Navigating to: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });

    // 4. Auto-dismiss Disclaimer ("I AGREE") if it renders
    const agreeBtn = page.locator('.agree-btn, button.agree-btn, .disclaimer-bottom-sheet-action-btn button, button:has-text("I AGREE")').first();
    if (await agreeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log('[Playwright] 🖱️ Auto-clicking "I AGREE" disclaimer popup button...');
      await agreeBtn.click().catch(() => {});
    }

    // 5. Wait for train search results
    await page.waitForSelector('.single-trip-wrapper, .train-name, .no-trains-found', { timeout: 20000 }).catch(() => {});

    // 6. Look for Turnstile response token in DOM
    const domToken = await page.evaluate(() => {
      const input = document.querySelector('input[name="cf-turnstile-response"], input[name="cft_response"]');
      if (input && input.value && input.value.length > 20) return input.value;
      if (window.turnstile && typeof window.turnstile.getResponse === 'function') {
        const r = window.turnstile.getResponse();
        if (r && r.length > 20) return r;
      }
      return null;
    }).catch(() => null);

    if (domToken && !capturedToken) {
      capturedToken = domToken;
      console.log(`[Playwright] ⚡ Captured Turnstile token from DOM: ${capturedToken.substring(0, 16)}...`);
    }

    // If token found, save to server token vault
    if (capturedToken) {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(TOKEN_FILE, JSON.stringify({ token: capturedToken, timestamp: Date.now() }, null, 2));
      try {
        await axios.post('http://localhost:3000/api/auth/set-token', { cft_response: capturedToken }, { timeout: 3000 }).catch(() => {});
      } catch (e) {}
    }

    // 7. Click Book Now / Show Layout button to trigger seat map
    const layoutTriggered = await page.evaluate((filter) => {
      const trips = Array.from(document.querySelectorAll('.single-trip-wrapper, app-single-trip'));
      let targetTrip = null;

      if (filter && trips.length > 0) {
        targetTrip = trips.find(t => (t.textContent || '').toLowerCase().includes(filter));
      }
      if (!targetTrip && trips.length > 0) {
        targetTrip = trips[0];
      }

      const root = targetTrip || document;
      const buttons = Array.from(root.querySelectorAll('button, a.btn, .book-now-btn, button:has-text("BOOK NOW")'));
      for (const btn of buttons) {
        const txt = (btn.textContent || '').trim().toUpperCase();
        if (txt.includes('BOOK NOW') || txt.includes('SHOW LAYOUT') || btn.classList.contains('book-now-btn')) {
          btn.click();
          return true;
        }
      }
      return false;
    }, trainFilter).catch(() => false);

    if (layoutTriggered) {
      console.log('[Playwright] 🖱️ Clicked "Book Now" / Layout button, awaiting seat map render...');
      // Wait for seat map dialog or layout view
      await page.waitForSelector('.seat-layout-view, .seat-layout-modal, app-seat-layout, .coach-details', { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(2000);
    }

    // 8. Capture screenshot
    if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    screenshotPath = path.join(SCREENSHOTS_DIR, `playwright_seatmap_${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(`[Playwright] 📸 Screenshot captured: ${screenshotPath}`);

    // Deliver to Telegram if configured
    if (TELEGRAM_CHAT_ID && TELEGRAM_BOT_TOKEN && fs.existsSync(screenshotPath)) {
      const caption = `🚆 <b>Bangladesh Railway Live Seat Map (Playwright)</b>\n📍 <b>Route:</b> ${fromStation} ➔ ${toStation}\n📅 <b>Date:</b> ${journeyDate}\n🎫 <b>Class:</b> ${seatClass}\n⚡ <b>Captured by Playwright Chromium Engine</b>`;
      await sendTelegramPhoto(TELEGRAM_CHAT_ID, screenshotPath, caption);
    }

    // Save captured layout to disk for dashboard/API fallback
    if (capturedLayout) {
      const layoutFile = path.join(DATA_DIR, 'latest_live_seatmap.json');
      fs.writeFileSync(layoutFile, JSON.stringify({ layout: capturedLayout, timestamp: Date.now(), fromStation, toStation, journeyDate }, null, 2));
    }

    return {
      success: !!(capturedLayout || capturedToken),
      layout: capturedLayout,
      token: capturedToken,
      screenshot: screenshotPath
    };

  } catch (err) {
    console.error('[Playwright] ❌ Execution error:', err.message);
    return {
      success: false,
      error: err.message,
      layout: null,
      token: capturedToken,
      screenshot: screenshotPath
    };
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
      console.log('[Playwright] 🏁 Browser closed cleanly.');
    }
  }
}

if (require.main === module) {
  grabLiveSeatmapWithPlaywright().then(res => {
    console.log('Result:', JSON.stringify({ success: res.success, hasLayout: !!res.layout, hasToken: !!res.token }));
  }).catch(console.error);
}

module.exports = {
  grabLiveSeatmapWithPlaywright,
  runPuppeteer: grabLiveSeatmapWithPlaywright // alias for backwards compatibility
};
