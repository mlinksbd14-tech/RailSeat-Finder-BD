/**
 * scripts/background-seat-grabber.js
 * 
 * High-Speed Direct Official API Background Seat Grabber Engine
 * 
 * Method: Pure Headless HTTP API Grab (Ultra-fast, ~200ms)
 * 
 * Strategy:
 * 1. Uses Direct Official API Gateway for sub-second seat holding.
 * 2. Locks seat in user's official Railway cart for 5 minutes.
 * 3. Delivers instant Telegram notification with 5-minute countdown and direct checkout link.
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

// Direct API Grabber (Ultra-fast pure HTTP holding)
async function grabSeatsDirect(target, session) {
  return grabSeatsViaApi(target, session);
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
  const result = await grabSeatsViaApi(target, session);
  if (result.success) {
    console.log('🎉 [Success] Direct Official API successfully secured the seats!');
  } else {
    console.warn(`⚠️ [Grab Notice]: ${result.reason || 'Could not hold seats'}`);
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
  grabSeatsDirect,
  grabSeatsInBackground
};
