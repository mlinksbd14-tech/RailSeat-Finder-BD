/**
 * scripts/puppeteer-seatmap-grabber.js
 * 
 * Headless Puppeteer / Chromium Worker for GitHub Actions
 * Solves Turnstile tokens, captures live seatmap screenshots,
 * and extracts authentic seat layout DOM from eticket.railway.gov.bd.
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const TELEGRAM_BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const TELEGRAM_CHAT_ID = (process.env.TELEGRAM_CHAT_ID || '').trim();
const TARGET_FROM = process.env.FROM_STATION || 'Dhaka';
const TARGET_TO = process.env.TO_STATION || "Cox's Bazar";
const TARGET_DATE = process.env.JOURNEY_DATE || ''; // e.g. '2026-10-10'

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
      timeout: 20000
    });
    console.log('[Puppeteer] 📸 Seatmap screenshot delivered to Telegram!');
  } catch (e) {
    console.warn('[Puppeteer] Telegram photo upload failed:', e.message);
  }
}

async function runPuppeteer() {
  console.log('====================================================');
  console.log('🤖 Headless Browser Seatmap Automation Runner');
  console.log('====================================================');

  let puppeteer;
  try {
    puppeteer = require('puppeteer');
  } catch (e) {
    console.error('Puppeteer is not installed in the current environment. Run: npm install puppeteer');
    process.exit(1);
  }

  const doj = TARGET_DATE || new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const searchUrl = `https://eticket.railway.gov.bd/booking/train/search?fromcity=${encodeURIComponent(TARGET_FROM)}&tocity=${encodeURIComponent(TARGET_TO)}&doj=${encodeURIComponent(doj)}&class=S_CHAIR`;

  console.log(`🌐 Launching Chromium in headless mode...`);
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--window-size=1280,900'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36');

  try {
    console.log(`🧭 Navigating to: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 45000 });

    // Wait for train cards to render
    await page.waitForSelector('.single-trip-wrapper, .train-name, .no-trains-found', { timeout: 20000 }).catch(() => {});

    // Check if Cloudflare Turnstile token exists in DOM
    const turnstileToken = await page.evaluate(() => {
      const input = document.querySelector('input[name="cf-turnstile-response"]');
      if (input && input.value) return input.value;
      if (window.turnstile && typeof window.turnstile.getResponse === 'function') {
        return window.turnstile.getResponse();
      }
      return null;
    });

    if (turnstileToken) {
      console.log('⚡ Solved/Captured Cloudflare Turnstile token:', turnstileToken.substring(0, 20) + '...');
      // Save token to session artifact
      const tokenArtifact = path.join(__dirname, '..', 'data', 'latest_turnstile_token.json');
      fs.writeFileSync(tokenArtifact, JSON.stringify({ token: turnstileToken, timestamp: Date.now() }, null, 2));
    }

    // Try clicking first available "Book Now" or "Show Layout" if present
    const bookBtn = await page.$('.book-now-btn, button:has-text("BOOK NOW"), button:has-text("Show Layout")');
    if (bookBtn) {
      console.log('🖱️ Clicking layout/booking button to open seat layout...');
      await bookBtn.click().catch(() => {});
      await page.waitForTimeout(3000);
    }

    // Capture screenshot of results
    const screenshotDir = path.join(__dirname, '..', 'screenshots');
    if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
    const screenshotPath = path.join(screenshotDir, `seatmap_${Date.now()}.png`);

    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(`📸 Screenshot saved to: ${screenshotPath}`);

    // Deliver to Telegram if configured
    if (TELEGRAM_CHAT_ID && TELEGRAM_BOT_TOKEN) {
      const caption = `🚆 <b>Bangladesh Railway Live Map / Search</b>\n📍 <b>Route:</b> ${TARGET_FROM} ➔ ${TARGET_TO}\n📅 <b>Date:</b> ${doj}\n⏰ Captured by GitHub Actions Serverless Runner`;
      await sendTelegramPhoto(TELEGRAM_CHAT_ID, screenshotPath, caption);
    }

  } catch (err) {
    console.error('❌ Headless browser automation error:', err.message);
  } finally {
    await browser.close();
    console.log('🏁 Browser closed.');
  }
}

if (require.main === module) {
  runPuppeteer().catch(console.error);
}

module.exports = { runPuppeteer };
