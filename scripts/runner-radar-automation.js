/**
 * scripts/runner-radar-automation.js
 * 
 * Serverless GitHub Actions / Standalone Runner
 * Executes Bangladesh Railway seat checks, grabs live seatmaps,
 * and delivers real-time Telegram alerts without hosting costs.
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');

// Configuration from Environment
const TELEGRAM_BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const TELEGRAM_DEFAULT_CHAT_ID = (process.env.TELEGRAM_CHAT_ID || '').trim();
const RAILSEAT_API_URL = (process.env.RAILSEAT_API_URL || '').replace(/\/+$/, '');
const FORCE_CHECK = process.env.FORCE_CHECK === 'true';

// Bangladesh Railway Shohoz Endpoints
const SHOHOZ_BASE_WEB = 'https://railspaapi.shohoz.com/v1.0/web';
const SHOHOZ_BASE_APP = 'https://railspaapi.shohoz.com/v1.0/app';

// Helpers
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

function getMobileHeaders(session) {
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

function getWebHeaders(session) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9,bn;q=0.8',
    'Origin': 'https://eticket.railway.gov.bd',
    'Referer': 'https://eticket.railway.gov.bd/',
    'Priority': 'u=1, i'
  };
  if (session.token) {
    headers['Authorization'] = `Bearer ${session.token.replace(/^Bearer\s+/i, '').trim()}`;
  }
  return headers;
}

// Load session data
function loadActiveSession() {
  // 1. Check environment variable first
  if (process.env.RAILWAY_SESSION_TOKEN) {
    console.log('[Runner] 🔑 Using session from RAILWAY_SESSION_TOKEN environment secret');
    return {
      token: process.env.RAILWAY_SESSION_TOKEN.trim(),
      deviceId: process.env.RAILWAY_DEVICE_ID || '844272bb-aabf-4f99-8ced-6fd56b4457b2',
      deviceKey: process.env.RAILWAY_DEVICE_KEY || null,
      cftResponse: process.env.RAILWAY_CFT_RESPONSE || null
    };
  }

  // 2. Check local data/session.json
  const sessionPath = path.join(__dirname, '..', 'data', 'session.json');
  if (fs.existsSync(sessionPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
      if (raw && raw.token) {
        console.log('[Runner] 📁 Loaded session from data/session.json');
        return raw;
      }
    } catch (e) {}
  }

  // 3. Check data/users.json for any active user session
  const usersPath = path.join(__dirname, '..', 'data', 'users.json');
  if (fs.existsSync(usersPath)) {
    try {
      const usersData = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
      if (usersData && Array.isArray(usersData.users)) {
        const withSession = usersData.users.find(u => u.shohozSession && u.shohozSession.token);
        if (withSession) {
          console.log(`[Runner] 👤 Loaded session from user ${withSession.username}`);
          return withSession.shohozSession;
        }
      }
    } catch (e) {}
  }

  console.warn('[Runner] ⚠️ No active Shohoz session found!');
  return { token: null };
}

// Load Watchlist Targets
function loadRadarTargets() {
  const watchlistPath = path.join(__dirname, '..', 'data', 'radar_watchlist.json');
  if (fs.existsSync(watchlistPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(watchlistPath, 'utf8'));
      return { data, path: watchlistPath };
    } catch (e) {}
  }
  return { data: { settings: { enabled: true }, targets: [] }, path: watchlistPath };
}

// Send Telegram Message
async function sendTelegramMessage(chatId, text, buttons = []) {
  if (!TELEGRAM_BOT_TOKEN || !chatId) {
    console.log(`[Telegram] Skipped send (Missing token or chatId: ${chatId})`);
    return false;
  }
  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: 'HTML',
    disable_web_page_preview: false
  };
  if (buttons.length > 0) {
    payload.reply_markup = {
      inline_keyboard: buttons
    };
  }
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, payload, { timeout: 8000 });
    console.log(`[Telegram] 📲 Alert delivered to Chat ID ${chatId}`);
    return true;
  } catch (err) {
    console.error(`[Telegram] ❌ Delivery failed for ${chatId}:`, err.response?.data?.description || err.message);
    return false;
  }
}

// Query Shohoz Trips
async function queryShohozTrip(fromCity, toCity, dateStr, session) {
  const formattedDoj = formatShohozDoj(dateStr);
  const url = `${SHOHOZ_BASE_WEB}/bookings/search-trips-v2?from_city=${encodeURIComponent(fromCity)}&to_city=${encodeURIComponent(toCity)}&date_of_journey=${encodeURIComponent(formattedDoj)}&seat_class=S_CHAIR`;

  const headers = getWebHeaders(session);
  const res = await axios.get(url, { headers, timeout: 12000, validateStatus: s => s < 500 });

  if (res.status === 200 && res.data) {
    if (res.data.error && res.data.error.code) {
      console.warn(`[Shohoz] Search error: ${res.data.error.messages?.join(', ')}`);
      return null;
    }
    const rawTrains = res.data.data?.trains || res.data.trains || [];
    return rawTrains;
  }
  console.warn(`[Shohoz] Search returned status ${res.status}`);
  return null;
}

// Fetch Live Seat Layout (Option 1: Mobile App Route /v1.0/app/ - Turnstile Free)
async function fetchLiveSeatLayoutMobile(tripId, tripRouteId, session) {
  if (!tripId || !session.token) return null;
  const url = `${SHOHOZ_BASE_APP}/bookings/seat-layout?trip_id=${encodeURIComponent(tripId)}&trip_route_id=${encodeURIComponent(tripRouteId || tripId)}`;
  const headers = getMobileHeaders(session);

  try {
    const res = await axios.get(url, { headers, timeout: 8000, validateStatus: s => s < 500 });
    if (res.status === 200 && res.data && !res.data.error) {
      const coaches = res.data.data?.coaches || res.data.coaches || [];
      return coaches;
    }
  } catch (e) {
    console.warn('[Shohoz] Mobile seat layout fetch error:', e.message);
  }
  return null;
}

// Main Execution Loop
async function main() {
  console.log('====================================================');
  console.log('🚀 RailSeat GitHub Actions Serverless Automation Job');
  console.log(`⏰ Executed at: ${new Date().toISOString()}`);
  console.log('====================================================');

  const session = loadActiveSession();
  if (!session.token) {
    console.error('❌ Aborting: Live Shohoz session token is required to query live availability.');
    process.exit(1);
  }

  const { data: radarFile, path: radarPath } = loadRadarTargets();
  const targets = (radarFile.targets || []).filter(t => t.active !== false);

  if (targets.length === 0) {
    console.log('ℹ️ No active watchlist targets found. Nothing to scan.');
    return;
  }

  console.log(`📋 Found ${targets.length} active watchlist target(s) to scan.`);

  // Group by distinct journey route & date
  const routesToScan = new Map();
  for (const t of targets) {
    const dates = Array.isArray(t.dates) && t.dates.length > 0 ? t.dates : (t.date ? [t.date] : []);
    for (const d of dates) {
      if (!d) continue;
      const key = `${t.fromCity.toUpperCase().trim()}___${t.toCity.toUpperCase().trim()}___${d.trim()}`;
      if (!routesToScan.has(key)) routesToScan.set(key, []);
      routesToScan.get(key).push(t);
    }
  }

  let totalHits = 0;

  for (const [key, targetList] of routesToScan.entries()) {
    const [fromCity, toCity, dateOfJourney] = key.split('___');
    console.log(`\n🔍 Checking route: ${fromCity} ➔ ${toCity} on ${dateOfJourney}...`);

    try {
      const trains = await queryShohozTrip(fromCity, toCity, dateOfJourney, session);
      if (!trains || trains.length === 0) {
        console.log(`ℹ️ No train records returned for ${fromCity} ➔ ${toCity} on ${dateOfJourney}`);
        continue;
      }

      for (const target of targetList) {
        target.lastCheckedAt = new Date().toISOString();
        target.notifiedSeatsByDate = target.notifiedSeatsByDate || {};

        // Match train
        const matchingTrains = trains.filter(t => {
          if (!target.trainName || target.trainName === 'ALL') return true;
          if (target.trainModel && String(t.train_model) === String(target.trainModel)) return true;
          if (t.train_name && target.trainName && t.train_name.toLowerCase().trim() === target.trainName.toLowerCase().trim()) return true;
          return false;
        });

        for (const train of matchingTrains) {
          const seatTypes = train.seat_types || [];
          for (const st of seatTypes) {
            if (target.className && target.className !== 'ANY' && st.type !== target.className) continue;

            const availOnline = Number(st.seats_available || 0);
            const availCounter = Number(st.counter_seats_available || 0);
            const totalAvail = availOnline + availCounter;
            const minReq = Number(target.minSeats) || 1;

            const lastNotified = target.notifiedSeatsByDate[dateOfJourney] !== undefined
              ? target.notifiedSeatsByDate[dateOfJourney]
              : target.lastNotifiedSeats;

            console.log(`  🚆 ${train.train_name} [${st.type}]: ${totalAvail} seats available (Min required: ${minReq})`);

            if (totalAvail >= minReq) {
              const wasSoldOut = (lastNotified === 0 || lastNotified === undefined);
              const isDifferent = (lastNotified !== totalAvail);

              if (isDifferent || FORCE_CHECK) {
                totalHits++;
                target.notifiedSeatsByDate[dateOfJourney] = totalAvail;
                target.lastNotifiedSeats = totalAvail;
                target.lastNotifiedAt = new Date().toISOString();

                console.log(`  🎯 MATCH! Processing alert for ${train.train_name} (${totalAvail} seats in ${st.type})`);

                // Auto Background Grab Trigger (Method 1 & Method 2) if target or env enabled it
                let grabResult = null;
                const isAutoGrab = target.autoGrab === true || target.auto_grab === true || process.env.AUTO_GRAB === 'true';
                if (isAutoGrab) {
                  try {
                    const { grabSeatsInBackground } = require('./background-seat-grabber');
                    console.log(`  ⚡ AUTO-GRAB ACTIVE! Triggering Dual-Method Background Grabber...`);
                    grabResult = await grabSeatsInBackground({
                      trainName: train.train_name,
                      trainModel: train.train_model,
                      fromCity: fromCity,
                      toCity: toCity,
                      date: dateOfJourney,
                      seatClass: st.type,
                      tripId: st.trip_id,
                      tripRouteId: st.trip_route_id,
                      seatsCount: Number(target.minSeats) || 1,
                      telegramChatId: target.telegramChatId || TELEGRAM_DEFAULT_CHAT_ID
                    }, { method: 'auto', sendTelegramAlert: true });
                  } catch (gErr) {
                    console.warn('  ⚠️ Background grab error:', gErr.message);
                  }
                }

                // If auto-grab already succeeded and sent the Telegram alert, skip duplicate standard alert
                if (!grabResult || !grabResult.success) {
                  // Optionally grab live mobile coach layout if trip_id exists
                  let liveCoachesInfo = '';
                  if (st.trip_id) {
                    try {
                      const coaches = await fetchLiveSeatLayoutMobile(st.trip_id, st.trip_route_id, session);
                      if (coaches && coaches.length > 0) {
                        const availCoaches = coaches.filter(c => Number(c.available_seats || 0) > 0);
                        if (availCoaches.length > 0) {
                          const coachSummary = availCoaches.map(c => `${c.coach_name} (${c.available_seats})`).join(', ');
                          liveCoachesInfo = `\n🧮 <b>Available Coaches:</b> <code>${coachSummary}</code>`;
                        }
                      }
                    } catch (e) {}
                  }

                  const bookUrl = `https://eticket.railway.gov.bd/booking/train/search?fromcity=${encodeURIComponent(fromCity)}&tocity=${encodeURIComponent(toCity)}&doj=${encodeURIComponent(formatShohozDoj(dateOfJourney))}&class=${encodeURIComponent(st.type)}`;
                  const chatId = target.telegramChatId || TELEGRAM_DEFAULT_CHAT_ID;

                  const msgText = wasSoldOut ?
                    `🚨 <b>[SEATS RELEASED / DROPPED!]</b>\n\n` +
                    `🚆 <b>Train:</b> ${train.train_name} (#${train.train_model})\n` +
                    `📍 <b>Route:</b> ${fromCity} ➔ ${toCity}\n` +
                    `📅 <b>Date:</b> ${formatShohozDoj(dateOfJourney)}\n` +
                    `💺 <b>Class:</b> ${st.display_name || st.type}\n` +
                    `🔥 <b>Available Seats:</b> <b>${totalAvail}</b> (Online: ${availOnline}, Counter: ${availCounter})` +
                    liveCoachesInfo +
                    `\n\n⚡ <i>This train was previously sold out and new seats just became available!</i>\n` +
                    `🔗 <a href="${bookUrl}">Click here to Book Immediately</a>`
                    :
                    `🎯 <b>WATCHLIST RADAR ALERT!</b>\n\n` +
                    `🚆 <b>Train:</b> ${train.train_name} (#${train.train_model})\n` +
                    `📍 <b>Route:</b> ${fromCity} ➔ ${toCity}\n` +
                    `📅 <b>Date:</b> ${formatShohozDoj(dateOfJourney)}\n` +
                    `💺 <b>Class:</b> ${st.display_name || st.type}\n` +
                    `🟢 <b>Available Seats:</b> <b>${totalAvail}</b> (Online: ${availOnline}, Counter: ${availCounter})` +
                    liveCoachesInfo +
                    `\n\n⚡ <i>Seats are available now on Bangladesh Railway!</i>\n` +
                    `🔗 <a href="${bookUrl}">Click here to Book Immediately</a>`;

                  await sendTelegramMessage(chatId, msgText, [
                    [{ text: '🎟️ Book Now on Railway', url: bookUrl }]
                  ]);
                }
              }
            } else {
              target.notifiedSeatsByDate[dateOfJourney] = totalAvail;
            }
          }
        }
      }
    } catch (err) {
      console.error(`❌ Error scanning ${key}:`, err.message);
    }

    // Delay between route checks to respect Shohoz rate limits
    await new Promise(r => setTimeout(r, 1200));
  }

  // Save updated timestamps and notified seat states back to disk
  try {
    radarFile.settings.lastRunAt = new Date().toISOString();
    fs.writeFileSync(radarPath, JSON.stringify(radarFile, null, 2), 'utf8');
    console.log(`\n💾 Saved updated check state to ${radarPath}`);
  } catch (err) {
    console.warn('⚠️ Could not save updated radar file:', err.message);
  }

  console.log(`\n✅ Radar check cycle completed with ${totalHits} hit(s).`);
}

main().catch(err => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
