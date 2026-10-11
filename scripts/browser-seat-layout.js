/**
 * scripts/browser-seat-layout.js
 * Uses Playwright / Camoufox to navigate directly to the search page,
 * let Cloudflare Turnstile render and solve natively within the page,
 * click the specific train & class to trigger the official Angular action,
 * and intercept the exact 100% live seat-layout response from Bangladesh Railway.
 */

const fs = require('fs');
const path = require('path');

async function fetchLiveSeatLayoutViaBrowser({
  fromCity = 'Dhaka',
  toCity = 'Chattogram',
  dateOfJourney = '19-Oct-2026',
  seatClass = 'S_CHAIR',
  trainModel = '',
  timeout = 35000
}) {
  console.log(`[BrowserSeatLayout] 🚀 Launching headless browser to fetch live seat map...`);
  console.log(`[BrowserSeatLayout] Params: ${fromCity} -> ${toCity} on ${dateOfJourney} (${seatClass})`);

  let session = null;
  const sessionPath = path.join(__dirname, '..', 'data', 'session.json');
  if (fs.existsSync(sessionPath)) {
    try {
      session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    } catch (e) {}
  }

  const { chromium } = require('playwright');
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu'
    ]
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 }
  });

  const page = await context.newPage();

  // Inject user session into localStorage before Angular SPA boots
  if (session && session.token) {
    await page.addInitScript(({ token, deviceId, deviceKey, user }) => {
      try {
        localStorage.setItem('token', token);
        if (deviceId) localStorage.setItem('device_id', deviceId);
        if (deviceKey) localStorage.setItem('device_key', deviceKey);
        if (user) localStorage.setItem('user', JSON.stringify(user));
        sessionStorage.setItem('disclaimer_agreed_for_home', '1');
        localStorage.setItem('disclaimer_agreed_for_home', '1');
      } catch (e) {}
    }, {
      token: session.token,
      deviceId: session.deviceId,
      deviceKey: session.deviceKey,
      user: session.user
    });
  }

  let capturedLayout = null;
  let capturedTurnstileToken = null;

  // Intercept all network responses
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('/bookings/seat-layout')) {
      try {
        const status = response.status();
        console.log(`[BrowserSeatLayout] 🎯 Intercepted /bookings/seat-layout [Status: ${status}]`);
        if (status === 200) {
          const body = await response.json();
          if (body && (body.data || body.coaches)) {
            capturedLayout = body;
            console.log(`[BrowserSeatLayout] ✅ Captured 100% Genuine Live Seat Layout!`);
          }
        }
      } catch (e) {
        console.warn('[BrowserSeatLayout] Error reading seat-layout response:', e.message);
      }
    }
  });

  // Navigate to target search page
  const targetUrl = `https://eticket.railway.gov.bd/booking/train/search?fromcity=${encodeURIComponent(fromCity)}&tocity=${encodeURIComponent(toCity)}&doj=${encodeURIComponent(dateOfJourney)}&class=${encodeURIComponent(seatClass)}`;
  console.log(`[BrowserSeatLayout] 🧭 Navigating to ${targetUrl}...`);

  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait for Angular SingleTrip components to render
    console.log('[BrowserSeatLayout] ⏳ Waiting for search results to render...');
    await page.waitForSelector('app-single-trip, .single-trip-wrapper, .train-name', { timeout: 15000 }).catch(() => null);

    // Wait for Turnstile invisible challenge to resolve
    console.log('[BrowserSeatLayout] ⏳ Waiting for Turnstile token to resolve in page...');
    const startTime = Date.now();
    while (Date.now() - startTime < 12000) {
      const token = await page.evaluate(() => {
        const selectors = ['[name="cf-turnstile-response"]', 'input[name="cf-turnstile-response"]', 'textarea[name="cf-turnstile-response"]', '#cf-chl-widget-response'];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el && el.value && el.value.length > 20) return el.value;
        }
        if (window.turnstile && typeof window.turnstile.getResponse === 'function') {
          const r = window.turnstile.getResponse();
          if (r && r.length > 20) return r;
        }
        return null;
      });

      if (token) {
        capturedTurnstileToken = token;
        console.log(`[BrowserSeatLayout] 🛡️ Page Turnstile resolved! Length: ${token.length}`);
        break;
      }
      await page.waitForTimeout(500);
    }

    // Now trigger the "BOOK NOW" or seat class button on the target train
    console.log(`[BrowserSeatLayout] 🖱️ Locating seat class button for train ${trainModel || 'first train'}...`);
    const clicked = await page.evaluate((targetModel) => {
      const trips = document.querySelectorAll('app-single-trip');
      let targetTrip = null;
      if (trips.length > 0) {
        if (targetModel) {
          for (const trip of trips) {
            if (trip.textContent.includes(targetModel)) {
              targetTrip = trip;
              break;
            }
          }
        }
        if (!targetTrip) targetTrip = trips[0];
      }

      if (targetTrip) {
        // Look for BOOK NOW button or seat class button
        const btn = targetTrip.querySelector('.book-now-btn, button.btn-book, .single-seat-class, .seat-class-name, button');
        if (btn) {
          btn.click();
          return true;
        }
      }
      return false;
    }, trainModel);

    console.log(`[BrowserSeatLayout] Click trigger status: ${clicked}`);

    // Wait for seat-layout network response
    const waitResponseStart = Date.now();
    while (Date.now() - waitResponseStart < 15000) {
      if (capturedLayout) break;
      await page.waitForTimeout(500);
    }

  } catch (err) {
    console.warn('[BrowserSeatLayout] Error during page execution:', err.message);
  } finally {
    await browser.close().catch(() => {});
  }

  return {
    layout: capturedLayout,
    cftToken: capturedTurnstileToken
  };
}

module.exports = { fetchLiveSeatLayoutViaBrowser };

if (require.main === module) {
  fetchLiveSeatLayoutViaBrowser({
    fromCity: 'Dhaka',
    toCity: 'Chattogram',
    dateOfJourney: '19-Oct-2026',
    seatClass: 'S_CHAIR'
  }).then(res => {
    console.log('Result layout present?', !!res.layout);
    console.log('Result CFT token present?', !!res.cftToken);
  });
}
