#!/usr/bin/env node
/**
 * scripts/headless-grab-cli.js
 * 
 * Way 2: CLI Headless Mobile Grabber Runner
 * 
 * Usage:
 *   node scripts/headless-grab-cli.js --from "Dhaka" --to "Chittagong" --date "2026-10-15" --class "S_CHAIR" --seats 2
 *   OR via npm:
 *   FROM="Dhaka" TO="Chittagong" DOJ="2026-10-15" CLASS="S_CHAIR" npm run seat:grab
 *   OR for 08:00 AM Ticket Rush:
 *   node scripts/headless-grab-cli.js --from "Dhaka" --to "Cox's Bazar" --date "2026-10-17" --rush
 */

require('dotenv').config();
const { grabSeatsInBackground } = require('./background-seat-grabber');

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.replace(/^--/, '');
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        parsed[key] = next;
        i++;
      } else {
        parsed[key] = true;
      }
    }
  }
  return parsed;
}

const cliArgs = parseArgs();

const fromCity = cliArgs.from || cliArgs.from_station || process.env.FROM || process.env.FROM_STATION || 'Dhaka';
const toCity = cliArgs.to || cliArgs.to_station || process.env.TO || process.env.TO_STATION || 'Chittagong';
const dateOfJourney = cliArgs.date || cliArgs.doj || cliArgs.journey_date || process.env.DOJ || process.env.JOURNEY_DATE || getTomorrowDate();
const seatClass = (cliArgs.class || cliArgs.seat_class || process.env.CLASS || process.env.SEAT_CLASS || 'S_CHAIR').toUpperCase();
const trainName = cliArgs.train || cliArgs.train_name || process.env.TRAIN || process.env.TRAIN_NAME || '';
const coach = cliArgs.coach || process.env.COACH || '';
const seatsCount = parseInt(cliArgs.seats || cliArgs.seats_count || process.env.SEATS || process.env.SEATS_COUNT || '1', 10);
const method = cliArgs.method || process.env.METHOD || 'auto'; // 'auto', 'api', 'puppeteer'
const isRushMode = cliArgs.rush === true || cliArgs.watch === true || process.env.RUSH === 'true';
const maxRetries = parseInt(cliArgs.retries || (isRushMode ? '40' : '1'), 10);

function getTomorrowDate() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

async function main() {
  console.log('===============================================================');
  console.log('🚀 Headless Mobile Seat Grabber (Method 3: CLI Runner)');
  console.log(`📍 Route:        ${fromCity} ➔ ${toCity}`);
  console.log(`📅 Date:         ${dateOfJourney}`);
  console.log(`💺 Class:        ${seatClass} | Seats: ${seatsCount}`);
  if (trainName) console.log(`🚆 Train:        ${trainName}`);
  if (coach)     console.log(`🚃 Coach:        ${coach}`);
  console.log(`⚡ Grab Mode:    ${method.toUpperCase()} ${isRushMode ? '(Rush Mode Active ⚡)' : ''}`);
  console.log('===============================================================\n');

  let attempt = 0;
  let succeeded = false;

  while (attempt < maxRetries && !succeeded) {
    attempt++;
    if (maxRetries > 1) {
      console.log(`\n🔄 [Attempt ${attempt}/${maxRetries}] Checking and grabbing seats...`);
    }

    try {
      const result = await grabSeatsInBackground({
        fromCity,
        toCity,
        date: dateOfJourney,
        seatClass,
        trainName,
        coach,
        seatsCount,
        telegramChatId: process.env.TELEGRAM_CHAT_ID
      }, {
        method,
        sendTelegramAlert: true
      });

      if (result.success) {
        succeeded = true;
        console.log('\n===============================================================');
        console.log('🎉 SEAT GRAB SUCCESSFUL!');
        console.log(`⚡ Secured Via: ${result.method}`);
        console.log(`💺 Coach & Seats: ${result.coach || 'Target'} - [${(result.seats || []).join(', ')}]`);
        console.log('⏱️ Seats are locked in your official cart for ~5 minutes.');
        console.log('💳 Checkout URL: https://eticket.railway.gov.bd/booking/checkout');
        console.log('📱 Telegram alert sent to your mobile phone!');
        console.log('===============================================================\n');
        process.exit(0);
      } else {
        console.warn(`⚠️ Attempt ${attempt} did not secure seats: ${result.reason || 'Not available yet'}`);
        if (attempt < maxRetries) {
          const delay = isRushMode ? 1800 : 3000;
          await new Promise(r => setTimeout(r, delay));
        }
      }
    } catch (err) {
      console.error(`❌ Attempt ${attempt} encountered error:`, err.message);
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 2500));
      }
    }
  }

  if (!succeeded) {
    console.error('\n❌ Grabber finished without securing seats after ' + maxRetries + ' attempts.');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal CLI Error:', err);
  process.exit(1);
});
