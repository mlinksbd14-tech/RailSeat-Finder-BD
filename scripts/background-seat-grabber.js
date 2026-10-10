/**
 * scripts/background-seat-grabber.js
 * 
 * High-Speed Dual-Method Background Seat Grabber Engine
 * 
 * Method 1: Pure Headless HTTP API Grab (Ultra-fast, ~200ms)
 * Method 2: Headless Browser Grabber (Puppeteer / Chromium Worker, ~2-3s)
 * 
 * Strategy:
 * 1. Tries Method 1 (Direct API Gateway) first for speed.
 * 2. If Turnstile / SSDK challenge fails, automatically cascades to Method 2 (Puppeteer).
 * 3. Locks seat in user's official Railway cart for 5 minutes.
 * 4. Delivers instant Telegram notification with 5-minute countdown and direct checkout link.
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');

const TELEGRAM_BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const TELEGRAM_DEFAULT_CHAT_ID = (process.env.TELEGRAM_CHAT_ID || '').trim();

// ---------------------------------------------------------------------------
// Helpers & Session Loading
// ---------------------------------------------------------------------------

function loadSession(overrideSession = null) {
  if (overrideSession && overrideSession.token) {
    const s = {
      token: overrideSession.token.replace(/^Bearer\s+/i, '').trim(),
      deviceId: overrideSession.deviceId || '34a817c48b87571632d2a7a1d50575a4',
      deviceKey: overrideSession.deviceKey || null,
      cftResponse: overrideSession.cftResponse || null,
      user: overrideSession.user || null
    };
    if (!s.deviceKey || s.deviceKey.length < 32) {
      s.deviceKey = generateShohozDeviceKey(s.token);
    }
    // Also attach fresh turnstile token from disk if not provided
    if (!s.cftResponse) {
      try {
        const tokenPath = path.join(__dirname, '..', 'data', 'latest_turnstile_token.json');
        if (fs.existsSync(tokenPath)) {
          const tData = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
          if (tData && tData.token && (Date.now() - tData.timestamp < 300000)) {
            s.cftResponse = tData.token;
          }
        }
      } catch (e) {}
    }
    return s;
  }

  // 1. Env secret
  if (process.env.RAILWAY_SESSION_TOKEN) {
    return {
      token: process.env.RAILWAY_SESSION_TOKEN.trim(),
      deviceId: process.env.RAILWAY_DEVICE_ID || '34a817c48b87571632d2a7a1d50575a4',
      deviceKey: process.env.RAILWAY_DEVICE_KEY || generateShohozDeviceKey(process.env.RAILWAY_SESSION_TOKEN),
      cftResponse: process.env.RAILWAY_CFT_RESPONSE || null
    };
  }

  let loaded = null;
  // 2. data/session.json
  const sessionPath = path.join(__dirname, '..', 'data', 'session.json');
  if (fs.existsSync(sessionPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
      if (raw && raw.token) loaded = raw;
    } catch (e) {}
  }

  // 3. data/users.json
  if (!loaded) {
    const usersPath = path.join(__dirname, '..', 'data', 'users.json');
    if (fs.existsSync(usersPath)) {
      try {
        const usersData = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
        if (usersData && Array.isArray(usersData.users)) {
          const found = usersData.users.find(u => u.shohozSession && u.shohozSession.token);
          if (found) loaded = found.shohozSession;
        }
      } catch (e) {}
    }
  }

  const finalSession = loaded ? { ...loaded } : { token: null };
  if (finalSession.token) {
    finalSession.deviceId = finalSession.deviceId || '34a817c48b87571632d2a7a1d50575a4';
    if (!finalSession.deviceKey || finalSession.deviceKey.length < 32) {
      finalSession.deviceKey = generateShohozDeviceKey(finalSession.token);
    }
  }

  // 4. Attach active fresh Turnstile token from disk if available
  try {
    const tokenPath = path.join(__dirname, '..', 'data', 'latest_turnstile_token.json');
    if (fs.existsSync(tokenPath)) {
      const tData = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
      if (tData && tData.token && (Date.now() - tData.timestamp < 300000)) {
        finalSession.cftResponse = tData.token;
      }
    }
  } catch (e) {}

  return finalSession;
}

function generateShohozDeviceKey(seed = '') {
  const s = seed || (Date.now() + crypto.randomBytes(16).toString('hex'));
  const p1 = crypto.createHash('sha256').update(s + '_shohoz_k1').digest('hex');
  const p2 = crypto.createHash('sha256').update(p1 + '_shohoz_k2').digest('hex');
  const p3 = crypto.createHash('sha256').update(p2 + '_shohoz_k3').digest('hex');
  return (p1 + p2 + p3).substring(0, 160);
}

function formatShohozDoj(isoDate) {
  if (!isoDate) return '';
  const clean = String(isoDate).trim();
  const mNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    const [y, m, d] = clean.split('-');
    const mIdx = parseInt(m, 10) - 1;
    return `${parseInt(d, 10)}-${mNames[mIdx]}-${y}`;
  }
  return clean;
}

function buildMobileHeaders(session) {
  const devId = session.deviceId || '844272bb-aabf-4f99-8ced-6fd56b4457b2';
  const devKey = (session.deviceKey && session.deviceKey.length >= 32)
    ? session.deviceKey
    : (session.token ? generateShohozDeviceKey(session.token) : generateShohozDeviceKey(devId));

  const headers = {
    'User-Agent': 'Shohoz-Rail-App/2.2.0 (Linux; Android 13; SM-G998B Build/TP1A.220624.014; wv)',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9,bn-BD;q=0.8',
    'x-device-id': devId,
    'x-device-key': devKey,
    'x-platform': 'android',
    'x-app-version': '2.2.0',
    'Content-Type': 'application/json'
  };
  if (session.token) {
    headers['Authorization'] = `Bearer ${session.token.replace(/^Bearer\s+/i, '').trim()}`;
  }
  return headers;
}

function buildWebHeaders(session) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9,bn;q=0.8',
    'Origin': 'https://eticket.railway.gov.bd',
    'Referer': 'https://eticket.railway.gov.bd/',
    'Content-Type': 'application/json'
  };
  if (session.token) {
    headers['Authorization'] = `Bearer ${session.token.replace(/^Bearer\s+/i, '').trim()}`;
  }
  return headers;
}

// ---------------------------------------------------------------------------
// Telegram Dispatchers
// ---------------------------------------------------------------------------

async function sendTelegramAlert(chatId, text, buttons = [], photoPath = null) {
  if (!TELEGRAM_BOT_TOKEN || !chatId) return false;
  
  if (photoPath && fs.existsSync(photoPath)) {
    try {
      const FormData = require('form-data');
      const form = new FormData();
      form.append('chat_id', chatId);
      form.append('caption', text);
      form.append('parse_mode', 'HTML');
      if (buttons.length > 0) {
        form.append('reply_markup', JSON.stringify({ inline_keyboard: buttons }));
      }
      form.append('photo', fs.createReadStream(photoPath));
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, form, {
        headers: form.getHeaders(),
        timeout: 20000
      });
      return true;
    } catch (e) {
      console.warn('[Grabber] Telegram photo upload failed, falling back to text:', e.message);
    }
  }

  try {
    const payload = {
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML',
      disable_web_page_preview: false
    };
    if (buttons.length > 0) {
      payload.reply_markup = { inline_keyboard: buttons };
    }
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, payload, { timeout: 8000 });
    return true;
  } catch (err) {
    console.warn('[Grabber] Telegram alert failed:', err.message);
    return false;
  }
}

// ---------------------------------------------------------------------------
// METHOD 1: Direct Headless HTTP API Grab (~200ms)
// ---------------------------------------------------------------------------

async function grabSeatsViaApi(target, session) {
  console.log(`[Grabber:Method1] ⚡ Executing Direct HTTP API Grab for ${target.trainName || 'Train'}...`);

  if (!session || !session.token) {
    return { success: false, reason: 'No authenticated Railway session token available' };
  }

  // Ensure fresh Turnstile token
  if (!session.cftResponse) {
    try {
      const daemonUrl = process.env.CAMOUFOX_DAEMON_URL || 'http://127.0.0.1:5055';
      const tRes = await axios.get(`${daemonUrl}/token`, { timeout: 2000, validateStatus: () => true });
      if (tRes.status === 200 && tRes.data?.token) {
        session.cftResponse = tRes.data.token;
      }
    } catch (e) {}
  }

  let tripId = target.tripId || target.trip_id;
  let tripRouteId = target.tripRouteId || target.trip_route_id || tripId;
  const fromCity = target.fromCity || target.from || 'Dhaka';
  const toCity = target.toCity || target.to || 'Chittagong';
  const doj = formatShohozDoj(target.date || target.journeyDate);
  let cls = (target.seatClass || target.className || 'S_CHAIR').toUpperCase();

  // Auto-discover trip_id if not explicitly provided
  if (!tripId) {
    try {
      console.log(`[Grabber:Method1] 🔎 Discovering live trip_id for ${fromCity} ➔ ${toCity} on ${doj}...`);
      const searchUrl = `https://railspaapi.shohoz.com/v1.0/web/bookings/search-trips-v2?from_city=${encodeURIComponent(fromCity)}&to_city=${encodeURIComponent(toCity)}&date_of_journey=${encodeURIComponent(doj)}&seat_class=${encodeURIComponent(cls !== 'ANY' && cls !== 'ALL' ? cls : 'S_CHAIR')}`;
      const sHeaders = buildWebHeaders(session);
      const sRes = await axios.get(searchUrl, { headers: sHeaders, timeout: 6000, validateStatus: s => s < 500 });
      if (sRes.status === 200 && sRes.data && Array.isArray(sRes.data.data?.trains)) {
        const trains = sRes.data.data.trains;
        const trainFilter = target.trainName && target.trainName !== 'ALL' && target.trainName !== 'ANY'
          ? target.trainName.toLowerCase()
          : '';

        let matched = null;
        if (trainFilter) {
          matched = trains.find(t => (t.train_name || '').toLowerCase().includes(trainFilter));
        }

        // Priority: Train with available seats (either online count or seats_available)
        if (!matched) {
          matched = trains.find(t => (t.seat_types || []).some(st => (Number(st.seat_counts?.online ?? st.seats_available) || 0) > 0)) || trains[0];
        }

        if (matched) {
          const stMatch = (matched.seat_types || []).find(st => (cls !== 'ANY' && cls !== 'ALL' ? st.type === cls : true) && (Number(st.seat_counts?.online ?? st.seats_available) || 0) > 0)
            || (matched.seat_types || []).find(st => cls !== 'ANY' && cls !== 'ALL' ? st.type === cls : true)
            || (matched.seat_types || [])[0];

          tripId = stMatch?.trip_id || matched.trip_id;
          tripRouteId = stMatch?.trip_route_id || matched.trip_route_id || tripId;
          if (stMatch?.type) cls = stMatch.type;
          target.seatClass = cls;
          target.trainName = matched.train_name;
          target.trainModel = matched.train_model || matched.trip_number || target.trainModel;
          console.log(`[Grabber:Method1] 🎯 Discovered trip_id=${tripId} for ${matched.train_name} (${target.seatClass})`);
        }
      }
    } catch (sErr) {
      console.warn('[Grabber:Method1] Trip discovery failed:', sErr.message);
    }
  }

  if (!tripId) {
    return { success: false, reason: 'Missing trip_id for API reservation' };
  }

  // 1. Fetch live seat layout to locate specific available seat ticket_ids
  let rawCoaches = [];
  let actionToken = session.cftResponse || null;

  console.log(`[Grabber:Method1] 🔎 Discovering open seats for trip ${tripId} (route: ${tripRouteId})...`);
  try {
    // ── ATTEMPT 1: Ultra-Fast Pre-warmed Camoufox Daemon (<500ms) ──
    try {
      const daemonUrl = process.env.CAMOUFOX_DAEMON_URL || 'http://127.0.0.1:5055';
      const dRes = await axios.get(`${daemonUrl}/get-layout`, {
        params: { trip_id: tripId, trip_route_id: tripRouteId },
        timeout: 3000,
        validateStatus: s => s < 500
      });
      if (dRes.status === 200 && dRes.data) {
        const raw = dRes.data.data || dRes.data;
        rawCoaches = raw.seatLayout || raw.coaches || [];
        if (dRes.data.actionToken) actionToken = dRes.data.actionToken;
        if (rawCoaches.length > 0) {
          console.log(`[Grabber:Method1] ⚡ Pre-warmed Camoufox Daemon provided live coach layout in <500ms! (ActionToken: ${Boolean(actionToken)})`);
        }
      }
    } catch (dErr) {}

    // ── ATTEMPT 2: Fallback / ensure X-Action-Token from Shohoz Web Route ──
    if (!actionToken || actionToken.length < 32 || rawCoaches.length === 0) {
      try {
        let webLayoutUrl = `https://railspaapi.shohoz.com/v1.0/web/bookings/seat-layout?trip_id=${encodeURIComponent(tripId)}&trip_route_id=${encodeURIComponent(tripRouteId)}`;
        if (session.cftResponse) webLayoutUrl += `&cft_response=${encodeURIComponent(session.cftResponse)}`;
        const wHeaders = buildWebHeaders(session);
        const wRes = await axios.get(webLayoutUrl, { headers: wHeaders, timeout: 6000, validateStatus: s => s < 500 });
        if (wRes.headers && wRes.headers['x-action-token']) {
          actionToken = wRes.headers['x-action-token'];
        }
        if (rawCoaches.length === 0 && wRes.status === 200 && wRes.data) {
          const raw = wRes.data.data || wRes.data;
          rawCoaches = raw.seatLayout || raw.coaches || [];
        }
      } catch (tokErr) {}
    }

    // ── ATTEMPT 3: Mobile App layout endpoint fallback ──
    if (rawCoaches.length === 0) {
      const layoutUrl = `https://railspaapi.shohoz.com/v1.0/app/bookings/seat-layout?trip_id=${encodeURIComponent(tripId)}&trip_route_id=${encodeURIComponent(tripRouteId)}`;
      const mHeaders = buildMobileHeaders(session);
      const lRes = await axios.get(layoutUrl, { headers: mHeaders, timeout: 6000, validateStatus: s => s < 500 });
      if (lRes.status === 200 && lRes.data) {
        const raw = lRes.data.data || lRes.data;
        rawCoaches = raw.seatLayout || raw.coaches || [];
      }
    }
  } catch (lErr) {
    console.warn('[Grabber:Method1] Could not fetch seat layout prior to grab:', lErr.message);
  }

  // Normalize coaches and extract flat seat items with valid ticket_ids
  const normalizedCoaches = (rawCoaches || []).map(c => {
    const coachName = String(c.floor_name || c.coach_name || '').trim();
    let seatList = [];
    if (Array.isArray(c.layout)) {
      seatList = c.layout.flat();
    } else if (Array.isArray(c.seats)) {
      seatList = c.seats;
    }
    const validSeats = seatList.filter(s => s && (s.seat_number || s.seat_name) && !s.isHidden && !s.is_blank);
    return {
      coachName,
      fare: c.seat_fare || null,
      seats: validSeats
    };
  });

  let selectedCoach = target.coach || target.coach_name || '';
  let availableCandidates = [];

  // Priority 1: Pick from user's preferred coach if specified
  if (selectedCoach) {
    const prefCoach = normalizedCoaches.find(c => c.coachName.toUpperCase() === selectedCoach.toUpperCase());
    if (prefCoach) {
      availableCandidates = prefCoach.seats.filter(s => 
        (s.seat_availability === 1 || s.seat_availability === true || String(s.is_available) === '1' || s.status === 'available')
      );
    }
  }

  // Priority 2: Pick from ANY coach with available seats
  if (availableCandidates.length === 0) {
    for (const c of normalizedCoaches) {
      const free = c.seats.filter(s => 
        (s.seat_availability === 1 || s.seat_availability === true || String(s.is_available) === '1' || s.status === 'available')
      );
      if (free.length > 0) {
        selectedCoach = c.coachName;
        availableCandidates = free;
        break;
      }
    }
  }

  if (availableCandidates.length === 0) {
    return {
      success: false,
      soldOut: true,
      reason: 'No open available seats found in any coach for this train at this moment'
    };
  }

  // Determine how many seats to grab
  const countNeeded = Math.min(target.seatsCount || 1, availableCandidates.length, 4);
  const seatsToHold = availableCandidates.slice(0, countNeeded);
  console.log(`[Grabber:Method1] 🎯 Grabbing ${seatsToHold.length} Seat(s): [${seatsToHold.map(s => s.seat_number).join(', ')}] in Coach ${selectedCoach}...`);

  // Ensure action token
  if (!actionToken) actionToken = session.cftResponse || '';

  // 2. Reserve each seat individually via Official Bangladesh Railway PATCH /bookings/reserve-seat
  const reservedSeats = [];
  const reserveErrors = [];

  for (const s of seatsToHold) {
    const reservePayload = {
      ticket_id: s.ticket_id,
      route_id: tripRouteId,
      action_token: actionToken,
      extras: {
        seat_number: s.seat_number,
        trip_number: String(target.trainModel || target.trainNumber || target.trainName || 'TRAIN'),
        origin_name: fromCity,
        destination_name: toCity
      }
    };

    const reserveHeaders = {
      'Authorization': `Bearer ${session.token}`,
      'x-device-id': session.deviceId || '34a817c48b87571632d2a7a1d50575a4',
      'x-device-key': session.deviceKey || generateShohozDeviceKey(session.token),
      'X-Action-Token': actionToken,
      'Content-Type': 'application/json',
      'Origin': 'https://eticket.railway.gov.bd',
      'Referer': 'https://eticket.railway.gov.bd/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
    };

    try {
      const rRes = await axios.patch(
        'https://railspaapi.shohoz.com/v1.0/web/bookings/reserve-seat',
        reservePayload,
        { headers: reserveHeaders, timeout: 8000, validateStatus: () => true }
      );

      if (rRes.status === 200 && (rRes.data?.data?.ack === 1 || rRes.data?.data?.message?.includes('Reserved') || !rRes.data?.error)) {
        console.log(`[Grabber:Method1] 🚀 Successfully RESERVED & HELD Seat ${s.seat_number} (ticket_id: ${s.ticket_id}) in official Railway cart!`);
        reservedSeats.push(s);
      } else {
        const errDetail = rRes.data?.error?.messages?.error_msg || rRes.data?.error?.message || rRes.data?.message || `HTTP ${rRes.status}`;
        console.warn(`[Grabber:Method1] Could not hold seat ${s.seat_number}:`, errDetail);
        reserveErrors.push(`${s.seat_number}: ${errDetail}`);
      }
    } catch (resErr) {
      console.warn(`[Grabber:Method1] Seat reserve error for ${s.seat_number}:`, resErr.message);
      reserveErrors.push(`${s.seat_number}: ${resErr.message}`);
    }
  }

  if (reservedSeats.length > 0) {
    const heldSeatNumbers = reservedSeats.map(s => s.seat_number);
    console.log(`[Grabber:Method1] 🎉 SUCCESS: ${reservedSeats.length} seat(s) held in official cart for 5 minutes!`);
    return {
      success: true,
      method: 'Headless API Gateway (Method 1)',
      coach: selectedCoach,
      seats: heldSeatNumbers,
      ticketIds: reservedSeats.map(s => s.ticket_id),
      trainName: target.trainName,
      tripId: tripId,
      tripRouteId: tripRouteId,
      expiresInSeconds: 300,
      directCheckoutUrl: 'https://eticket.railway.gov.bd/booking/checkout'
    };
  }

  const combinedError = reserveErrors.join('; ') || 'Railway API declined cart reservation hold';
  return { success: false, reason: `Railway API rejected hold: ${combinedError}` };
}

// ---------------------------------------------------------------------------
// METHOD 2: Headless Browser Grabber (Playwright / Chromium) (~1-2s)
// ---------------------------------------------------------------------------

async function grabSeatsViaPlaywright(target, session) {
  console.log(`[Grabber:Method2] 🌐 Launching Headless Playwright Chrome Worker for ${target.trainName || 'Train'}...`);

  let chromium;
  try {
    chromium = require('playwright').chromium;
  } catch (e) {
    return { success: false, reason: 'Playwright is not installed. Run: npm install playwright' };
  }

  const fromCity = target.fromCity || target.from || 'Dhaka';
  const toCity = target.toCity || target.to || 'Chittagong';
  const dojFormatted = formatShohozDoj(target.date || target.journeyDate || target.doj);
  const seatClass = target.seatClass || target.className || 'S_CHAIR';
  const coachParam = target.coach ? `&coach=${encodeURIComponent(target.coach)}&exact_coach=1` : '';
  const seatsParam = target.seats && target.seats.length > 0 ? `&seats=${encodeURIComponent(target.seats.join(','))}` : '';
  const countParam = target.seatsCount ? `&seats_count=${target.seatsCount}` : '&seats_count=1';

  const autobookUrl = `https://eticket.railway.gov.bd/booking/train/search?fromcity=${encodeURIComponent(fromCity)}&tocity=${encodeURIComponent(toCity)}&doj=${encodeURIComponent(dojFormatted)}&class=${encodeURIComponent(seatClass)}${coachParam}${seatsParam}${countParam}&autobook=1&hold_only=1`;

  const launchArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled',
    '--window-size=1280,900'
  ];

  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: launchArgs });
  } catch (err) {
    browser = await chromium.launch({ headless: true, args: launchArgs });
  }

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
  });

  // Pre-seed session & auto-dismiss Disclaimer popup before page loads
  await context.addInitScript((sessionData) => {
    try {
      sessionStorage.setItem('disclaimer_agreed_for_home', '1');
      localStorage.setItem('disclaimer_agreed_for_home', '1');
      if (sessionData && sessionData.token) {
        localStorage.setItem('token', sessionData.token);
        localStorage.setItem('railway_token', sessionData.token);
        localStorage.setItem('uudid', sessionData.deviceId || '34a817c48b87571632d2a7a1d50575a4');
        localStorage.setItem('ssdk', sessionData.deviceKey || '');
        if (sessionData.user) localStorage.setItem('user', JSON.stringify(sessionData.user));
        if (sessionData.deviceId) localStorage.setItem('device_id', sessionData.deviceId);
        if (sessionData.deviceKey) localStorage.setItem('device_key', sessionData.deviceKey);
      }
    } catch (e) {}
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  }, session);

  const page = await context.newPage();
  let screenshotPath = null;
  let seatSelected = false;

  try {
    console.log(`[Grabber:Method2] 🧭 Navigating to autobook URL: ${autobookUrl}`);
    await page.goto(autobookUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });

    // Auto-dismiss Disclaimer ("I AGREE") if visible
    const agreeBtn = page.locator('.agree-btn, button.agree-btn, button:has-text("I AGREE")').first();
    if (await agreeBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await agreeBtn.click().catch(() => {});
    }

    // Wait for train results
    await page.waitForSelector('.single-trip-wrapper, .train-name, app-single-trip', { timeout: 15000 }).catch(() => {});

    // Click Book Now button
    const bookNowBtn = page.locator('button.book-now-btn, button:has-text("BOOK NOW")').first();
    if (await bookNowBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
      await bookNowBtn.click().catch(() => {});
      console.log('[Grabber:Method2] 🖱️ Clicked Book Now button via Playwright');
    }

    // Wait for seat layout view
    await page.waitForSelector('.seat-layout-view, app-seat-layout, .seat-plan-wrapper', { timeout: 8000 }).catch(() => {});

    // Select available seat
    const freeSeat = page.locator('.seat.available, .seat-available, .free-seat, button.btn-seat:not(.seat-booked):not(.seat-disabled)').first();
    if (await freeSeat.isVisible({ timeout: 3000 }).catch(() => false)) {
      await freeSeat.click().catch(() => {});
      seatSelected = true;
      console.log('[Grabber:Method2] 💺 Seat clicked/selected in DOM via Playwright.');
    }

    // If seat selected, click Continue Purchase to hold
    if (seatSelected) {
      const continueBtn = page.locator('button.continue-btn, #confirmbooking button, button:has-text("CONTINUE PURCHASE")').first();
      if (await continueBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await continueBtn.click().catch(() => {});
        console.log('[Grabber:Method2] 🚀 Clicked Continue Purchase to hold seat.');
        await page.waitForTimeout(2000);
      }
    }

    // Capture confirmation screenshot
    const screenshotDir = path.join(__dirname, '..', 'screenshots');
    if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
    screenshotPath = path.join(screenshotDir, `grab_proof_${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });

    const currentUrl = page.url();
    const isCartHeld = currentUrl.includes('trip-info') || currentUrl.includes('checkout') || seatSelected;

    return {
      success: !!isCartHeld,
      reason: isCartHeld ? null : 'No available seats found on page to select',
      method: 'Headless Browser Playwright (Method 2)',
      screenshot: screenshotPath,
      currentUrl: currentUrl,
      expiresInSeconds: 300
    };

  } catch (err) {
    return { success: false, reason: `Playwright grab failed: ${err.message}` };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// UNIFIED ENGINE: Automatic Method 1 -> Method 2 Cascade
// ---------------------------------------------------------------------------

async function grabSeatsInBackground(target, options = {}) {
  console.log('====================================================');
  console.log('⚡ Background Seat Grabber Engine Started');
  console.log(`🚆 Train: ${target.trainName || 'Any'} | Route: ${target.fromCity} ➔ ${target.toCity}`);
  console.log('====================================================');

  const session = loadSession(options.session || target.session);
  const preferredMethod = options.method || 'auto'; // 'auto', 'api', 'playwright', 'puppeteer'
  let result = null;

  // 1. Attempt Method 1 (Direct API)
  if (preferredMethod === 'auto' || preferredMethod === 'api') {
    result = await grabSeatsViaApi(target, session);
    if (result.success) {
      console.log('🎉 [Success] Method 1 (Direct API) successfully secured the seats!');
    } else {
      console.warn(`⚠️ [Method 1 Failed]: ${result.reason}`);
    }
  }

  // 2. Cascade to Method 2 (Playwright) if Method 1 failed or if requested
  if ((!result || !result.success) && (preferredMethod === 'auto' || preferredMethod === 'playwright' || preferredMethod === 'puppeteer')) {
    console.log('🔄 Cascading to Method 2 (Headless Playwright Chrome Worker)...');
    result = await grabSeatsViaPlaywright(target, session);
    if (result.success) {
      console.log('🎉 [Success] Method 2 (Playwright) successfully secured the seats!');
    } else {
      console.warn(`❌ [Method 2 Failed]: ${result.reason}`);
    }
  }

  if (!result) {
    result = { success: false, reason: 'Both grab methods failed or were disabled.' };
  }

  // 3. Send Telegram Notification if Successful
  if (result.success && options.sendTelegramAlert !== false) {
    const chatId = target.telegramChatId || TELEGRAM_DEFAULT_CHAT_ID;
    const directCheckoutUrl = 'https://eticket.railway.gov.bd/booking/checkout';
    const fallbackSearchUrl = `https://eticket.railway.gov.bd/booking/train/search?fromcity=${encodeURIComponent(target.fromCity || '')}&tocity=${encodeURIComponent(target.toCity || '')}&doj=${encodeURIComponent(formatShohozDoj(target.date || target.journeyDate))}&class=${encodeURIComponent(target.seatClass || 'S_CHAIR')}`;

    const text = 
      `🚨 <b>[SEAT GRABBED & LOCKED IN CART!]</b>\n\n` +
      `🚆 <b>Train:</b> ${target.trainName || 'Train'}\n` +
      `📍 <b>Route:</b> ${target.fromCity || ''} ➔ ${target.toCity || ''}\n` +
      `📅 <b>Date:</b> ${formatShohozDoj(target.date || target.journeyDate)}\n` +
      `💺 <b>Coach / Seats:</b> <code>${result.coach || 'Target'} - [${(result.seats || ['Auto']).join(', ')}]</code>\n` +
      `⚡ <b>Secured Via:</b> <code>${result.method}</code>\n\n` +
      `⏳ <b>TIME REMAINING: 5 MINUTES!</b>\n` +
      `<i>Bangladesh Railway has held these seats in your account cart. Complete your payment (bKash/Nagad/Card) before the 5-minute timer expires!</i>\n\n` +
      `🔗 <a href="${directCheckoutUrl}"><b>👉 Click to Complete Payment Immediately</b></a>`;

    const buttons = [
      [{ text: '💳 Pay Now (Cart Checkout)', url: directCheckoutUrl }],
      [{ text: '🔍 View Search Page', url: fallbackSearchUrl }]
    ];

    await sendTelegramAlert(chatId, text, buttons, result.screenshot);
  }

  return result;
}

module.exports = {
  grabSeatsViaApi,
  grabSeatsViaPlaywright,
  grabSeatsViaPuppeteer: grabSeatsViaPlaywright, // alias for backwards compatibility
  grabSeatsInBackground
};
