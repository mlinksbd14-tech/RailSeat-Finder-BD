// ==UserScript==
// @name         RailSeat Finder BD — Automatic Background Token & Session Bridge (Multi-Domain)
// @namespace    https://railseat-finder-bd/
// @version      2.1
// @description  Zero-click automatic sync of Bangladesh Railway live session, Bearer tokens, Cloudflare Turnstile tokens, and a resumable auto-book driver with on-screen progress panel. v2.1: Fixes 'requesting too frequently' rate limit cooldown with smart backoff, dialog throttle, and pacing.
// @author       RailSeat BD
// @match        https://eticket.railway.gov.bd/*
// @icon         https://eticket.railway.gov.bd/favicon.ico
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      localhost
// @connect      127.0.0.1
// @connect      *
// @run-at       document-start
// ==/UserScript==

(function() {
  'use strict';

  // Guard against untargeted iframe injection, but allow background collector iframes
  if (typeof window !== 'undefined') {
    const isCollectorIframe = window.location.href.includes('cft_collector') || (window.location.search && window.location.search.includes('cft_collector'));
    if (window.top !== window.self && !isCollectorIframe) return;
    if (window.__RAILSEAT_SYNC_INITIALIZED__) {
      console.log('[RailSeat Bridge] Already initialized in this context, skipping duplicate run.');
      return;
    }
    window.__RAILSEAT_SYNC_INITIALIZED__ = true;
  }

  // -------------------------------------------------------------------------
  // 1. Multi-Domain Configuration
  // Add all your server URLs here (localhost, cPanel shared hosting, VPS, etc.)
  // -------------------------------------------------------------------------
  const DEFAULT_SERVER_URLS = [
    'http://localhost:3000',
    // 'https://your-domain.com',
    // 'https://subdomain.your-cpanel-site.com'
  ];

  function getTargetUrls() {
    let saved = '';
    if (typeof GM_getValue === 'function') {
      try { saved = GM_getValue('railseat_server_urls', ''); } catch (e) {}
    }
    if (!saved && typeof localStorage !== 'undefined') {
      try { saved = localStorage.getItem('railseat_server_urls') || ''; } catch (e) {}
    }
    let dynamicOrigin = '';
    if (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) {
      try { dynamicOrigin = new URL(document.currentScript.src).origin; } catch (e) {}
    }
    const rawList = saved ? saved.split(',') : (dynamicOrigin ? [dynamicOrigin, ...DEFAULT_SERVER_URLS] : DEFAULT_SERVER_URLS);
    const cleaned = rawList
      .map(u => String(u || '').trim())
      .filter(u => u.length > 0)
      .map(u => u.replace(/\/+$/, ''));
    return cleaned.length > 0 ? Array.from(new Set(cleaned)) : ['http://localhost:3000'];
  }

  // Register Tampermonkey extension menu to edit domains on the fly
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('⚙️ Configure RailSeat Domains', () => {
      const current = getTargetUrls().join(', ');
      const input = prompt(
        'Enter your RailSeat server URLs separated by commas:\nExample: http://localhost:3000, https://yourdomain.com',
        current
      );
      if (input !== null) {
        const cleaned = input.split(',').map(s => s.trim()).filter(Boolean).join(', ');
        if (typeof GM_setValue === 'function') {
          GM_setValue('railseat_server_urls', cleaned);
        }
        alert(`✅ Server URLs saved!\nCurrently syncing to:\n${cleaned || 'http://localhost:3000'}`);
      }
    });
  }

  let lastSentToken = '';
  let lastSentCft = '';

  // -------------------------------------------------------------------------
  // 2. Non-Intrusive Floating Toast Indicator (Deduplicated)
  // -------------------------------------------------------------------------
  let lastBadgeText = '';
  let lastBadgeTime = 0;
  function showFloatingBadge(message, isSuccess = true) {
    try {
      const now = Date.now();
      // Suppress duplicate toasts within 5 seconds
      if (message === lastBadgeText && (now - lastBadgeTime) < 5000) {
        return;
      }
      lastBadgeText = message;
      lastBadgeTime = now;

      // @run-at document-start means <body> does not exist yet. Appending then
      // would throw and abort whatever called us, so defer until the DOM is ready.
      if (!document.body) {
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', () => showFloatingBadge(message, isSuccess), { once: true });
        }
        return;
      }

      let badge = document.getElementById('railseat-bridge-badge');
      if (!badge) {
        badge = document.createElement('div');
        badge.id = 'railseat-bridge-badge';
        badge.style.cssText = `
          position: fixed;
          bottom: 16px;
          right: 16px;
          z-index: 999999;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          font-size: 11px;
          font-weight: 700;
          padding: 6px 14px;
          border-radius: 9999px;
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
          display: flex;
          align-items: center;
          gap: 6px;
          transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          opacity: 0;
          transform: translateY(8px);
          pointer-events: none;
        `;
        document.body.appendChild(badge);
      }

      badge.style.backgroundColor = isSuccess ? '#064e3b' : '#7f1d1d';
      badge.style.color = '#ffffff';
      badge.style.border = isSuccess ? '1px solid #10b981' : '1px solid #ef4444';
      badge.innerHTML = `
        <span style="width: 6px; height: 6px; border-radius: 50%; background: ${isSuccess ? '#34d399' : '#f87171'}; display: inline-block;"></span>
        <span>RailSeat BD: ${message}</span>
      `;

      badge.style.opacity = '1';
      badge.style.transform = 'translateY(0)';

      clearTimeout(badge._timer);
      badge._timer = setTimeout(() => {
        badge.style.opacity = '0';
        badge.style.transform = 'translateY(8px)';
      }, 4000);
    } catch (e) {
      // A cosmetic toast is never worth losing the booking flow over.
    }
  }

  // -------------------------------------------------------------------------
  // 3. Multi-Domain Broadcast Dispatcher
  // -------------------------------------------------------------------------
  function sendToRailSeat(payload, successMsg = 'Token Synced') {
    // 0ms instant sync to parent dashboard window when inside bridge iframe
    if (window.top !== window.self) {
      try {
        window.parent.postMessage({ type: 'RAILSEAT_CFT_TOKEN', ...payload }, '*');
      } catch (e) {}
    }

    const urls = getTargetUrls();
    const postData = JSON.stringify(payload);
    let successCount = 0;

    urls.forEach((baseUrl) => {
      const targetUrl = `${baseUrl}/api/auth/set-token`;

      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({
          method: 'POST',
          url: targetUrl,
          headers: { 'Content-Type': 'application/json' },
          data: postData,
          onload: function(res) {
            try {
              const data = JSON.parse(res.responseText);
              if (data.success) {
                successCount++;
                console.log(`[RailSeat Bridge] ✅ Synced to ${baseUrl}`);
                showFloatingBadge(`${successMsg} (${successCount}/${urls.length} domains)`, true);
              }
            } catch (e) {}
          },
          onerror: function(err) {
            console.warn(`[RailSeat Bridge] Could not reach ${baseUrl}:`, err);
          }
        });
      } else {
        fetch(targetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: postData,
          mode: 'cors'
        }).then(r => r.json()).then(d => {
          if (d.success) {
            successCount++;
            showFloatingBadge(`${successMsg} (${successCount}/${urls.length} domains)`, true);
          }
        }).catch(() => {});
      }
    });
  }

  // -------------------------------------------------------------------------
  // 4. Intercept Fetch & XHR (Bearer Tokens & Layout URLs)
  // -------------------------------------------------------------------------
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    try {
      const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
      const opts = args[1] || {};
      const headers = opts.headers || {};

      let token = '';
      if (headers instanceof Headers) {
        token = headers.get('authorization') || '';
      } else if (typeof headers === 'object') {
        token = headers['authorization'] || headers['Authorization'] || '';
      }

      if (token && token.startsWith('Bearer ') && token !== lastSentToken) {
        lastSentToken = token;
        const cleanToken = token.replace(/^Bearer\s+/i, '');
        const deviceId = (headers instanceof Headers ? headers.get('x-device-id') : headers['x-device-id']) || '';
        const deviceKey = (headers instanceof Headers ? headers.get('x-device-key') : headers['x-device-key']) || '';
        sendToRailSeat({ token: cleanToken, device_id: deviceId, device_key: deviceKey }, 'Railway Session Synced');
      }

      if (url.includes('cft_response=')) {
        const m = url.match(/[?&]cft_response=([^&'"\s]+)/i);
        if (m && m[1] && m[1] !== lastSentCft) {
          lastSentCft = m[1];
          sendToRailSeat({ cft_response: decodeURIComponent(m[1]) }, 'Live Turnstile Token Synced');
        }
      }
    } catch (e) {}

    return originalFetch.apply(this, args);
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function(method, url) {
    this._url = url;
    this._headers = {};
    return originalOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.setRequestHeader = function(header, value) {
    if (this._headers) this._headers[header.toLowerCase()] = value;
    return originalSetRequestHeader.apply(this, arguments);
  };

  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function() {
    try {
      const url = this._url || '';
      const headers = this._headers || {};

      const auth = headers['authorization'] || '';
      if (auth && auth.startsWith('Bearer ') && auth !== lastSentToken) {
        lastSentToken = auth;
        const cleanToken = auth.replace(/^Bearer\s+/i, '');
        const deviceId = headers['x-device-id'] || '';
        const deviceKey = headers['x-device-key'] || '';
        sendToRailSeat({ token: cleanToken, device_id: deviceId, device_key: deviceKey }, 'Railway Session Synced');
      }

      if (url.includes('cft_response=')) {
        const m = url.match(/[?&]cft_response=([^&'"\s]+)/i);
        if (m && m[1] && m[1] !== lastSentCft) {
          lastSentCft = m[1];
          sendToRailSeat({ cft_response: decodeURIComponent(m[1]) }, 'Live Turnstile Token Synced');
        }
      }
    } catch (e) {}

    return originalSend.apply(this, arguments);
  };

  // -------------------------------------------------------------------------
  // 4b. Sync Existing Railway Session from LocalStorage on Startup
  // -------------------------------------------------------------------------
  function syncExistingSessionFromStorage() {
    try {
      const storedToken = localStorage.getItem('token') || sessionStorage.getItem('token');
      const storedDeviceId = localStorage.getItem('device_id') || localStorage.getItem('deviceId') || '';
      const storedDeviceKey = localStorage.getItem('device_key') || localStorage.getItem('deviceKey') || '';
      if (storedToken && storedToken.length > 20 && storedToken !== lastSentToken) {
        lastSentToken = storedToken;
        const cleanToken = storedToken.replace(/^Bearer\s+/i, '').trim();
        sendToRailSeat({
          token: cleanToken,
          device_id: storedDeviceId,
          device_key: storedDeviceKey
        }, 'Railway Local Session Synced');
      }
    } catch (e) {}
  }
  syncExistingSessionFromStorage();
  setTimeout(syncExistingSessionFromStorage, 1000);

  // -------------------------------------------------------------------------
  // 5. Turnstile DOM Poller (Automatic Zero-Click Background Collection)
  // -------------------------------------------------------------------------
  function pollTurnstileInDOM() {
    try {
      const selectors = [
        '[name="cf-turnstile-response"]',
        'input[name="cf-turnstile-response"]',
        'textarea[name="cf-turnstile-response"]',
        '[name="cft_response"]',
        'input[name="cft_response"]',
        '#cf-chl-widget-response'
      ];
      let cft = null;
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.value && el.value.length > 20) {
          cft = el.value;
          break;
        }
      }

      if (!cft && window.turnstile && typeof window.turnstile.getResponse === 'function') {
        cft = window.turnstile.getResponse();
      }

      if (cft && cft.length > 20 && cft !== lastSentCft) {
        lastSentCft = cft;
        sendToRailSeat({ cft_response: cft }, 'Live Turnstile Token Synced Automatically');

        // Broadcast token to parent/top window (when in invisible background iframe) or window.opener (if any)
        try {
          const msgPayload = { type: 'RAILSEAT_CFT_TOKEN', cft_response: cft };
          if (window.parent && window.parent !== window) {
            window.parent.postMessage(msgPayload, '*');
          }
          if (window.top && window.top !== window && window.top !== window.parent) {
            window.top.postMessage(msgPayload, '*');
          }
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage(msgPayload, '*');
          }
        } catch (e) {}
      }
    } catch (e) {}
  }

  // Fast-polling: checks every 200ms for instant detection as soon as Turnstile completes
  setInterval(pollTurnstileInDOM, 200);
  pollTurnstileInDOM();

  // Active trigger for Turnstile execution in collector iframe or when idle
  function triggerActiveTurnstileSolve() {
    try {
      if (window.turnstile) {
        if (typeof window.turnstile.execute === 'function') {
          window.turnstile.execute();
        } else if (typeof window.turnstile.reset === 'function') {
          window.turnstile.reset();
        }
      }
    } catch (e) {}
  }

  // If in collector mode (background bridge iframe), immediately trigger solving
  if (typeof window !== 'undefined' && window.location.href.includes('cft_collector')) {
    setTimeout(triggerActiveTurnstileSolve, 400);
    setTimeout(triggerActiveTurnstileSolve, 1500);
    setTimeout(triggerActiveTurnstileSolve, 3000);
  }

  // Continuous background token refresh every 60s while browser is open on Railway site
  setInterval(() => {
    triggerActiveTurnstileSolve();
    pollTurnstileInDOM();
  }, 60000);

  // MutationObserver triggers sync the exact millisecond the response input is filled
  try {
    const observer = new MutationObserver(() => pollTurnstileInDOM());
    const targetNode = document.documentElement || document.body;
    if (targetNode) {
      observer.observe(targetNode, { childList: true, subtree: true, attributes: true });
    }
  } catch (e) {}

  window.addEventListener('DOMContentLoaded', () => { pollTurnstileInDOM(); triggerActiveTurnstileSolve(); });
  window.addEventListener('load', () => { pollTurnstileInDOM(); triggerActiveTurnstileSolve(); });

  // -------------------------------------------------------------------------
  // 6. Automated Seat Selection → Continue Purchase → OTP page
  //
  // eticket.railway.gov.bd is an Angular SPA. The DOM contract we drive is:
  //   /booking/train/search   ->  app-search-result
  //                                app-single-trip                  (one per train)
  //                                  .trip-name h2                   (train number)
  //                                  .single-seat-class             (one per class)
  //                                    .seat-class-name              ("S_CHAIR" ...)
  //                                    button.book-now-btn            (loads layout)
  //   seat layout (modal, same route)
  //                              app-seat-layout > .seat-layout-view
  //                                select#select-bogie              (coach / floor)
  //                                button.btn-seat[title="<seat>"] (.seat-selected)
  //                                select#boardingpoint            (REQUIRED)
  //                                button.continue-btn             (Continue Purchase)
  //   /booking/train/trip-info  ->  passenger details + app-confirm-booking-otp
  //
  // The intent travels in the URL *and* in sessionStorage, because the official
  // site re-renders (and sometimes fully reloads) between the search page, the
  // seat layout and the purchase page, which would otherwise drop the query
  // string. The driver below is a resumable state machine: it re-inspects the
  // DOM on every tick and only performs the step that is still missing.
  // -------------------------------------------------------------------------
  const AUTOBOOK_STORAGE_KEY = 'railseat_autobook_intent';
  const AUTOBOOK_TTL_MS = 60 * 60 * 1000;
  const AUTOBOOK_TICK_MS = 800;
  const AUTOBOOK_MAX_TICKS = 900;
  const RAILWAY_LS_TOKEN = 'token';
  const RAILWAY_LS_USER = 'user';

  const RS = {
    tripCard: 'app-single-trip, .single-trip, .trip-box, .trip-card',
    tripTitle: '.trip-name h2, .trip-name h1, .trip-name h3, .trip-name, .trip-title',
    tripHeader: '.trip-name, .trip-header',
    seatClassCard: '.single-seat-class, .seat-class-box, .seat-type-box, .seat-class',
    seatClassName: '.seat-class-name, .seat-type-name, h3, h4, .class-name',
    bookNowBtn: 'button.book-now-btn, button.btn-book-now, button.book-btn',
    seatLayout: 'app-seat-layout, .seat-layout-view, .seat-plan-wrapper, .seat-layout',
    coachSelect: 'select#select-bogie, select[formcontrolname="bogie"], select[name="bogie"], select.select-bogie',
    seatBtn: 'button.btn-seat, button.seat-btn, .btn-seat, button[title*="-"], button[aria-label*="-"], button.seat',
    seatSelected: 'seat-selected',
    seatSelectedSel: '.seat-selected',
    seatBooked: 'seat-booked',
    seatDisabled: 'seat-disabled',
    boardingSelect: 'select#boardingpoint, select[formcontrolname="boarding_point"], select.boarding-point',
    continueBtn: 'button.continue-btn, button.btn-continue, #confirmbooking button, button.book-now-btn',
    loginModal: 'app-login-modal, .login-modal-wrapper, #login-modal, .modal-login',
    otpBox: 'app-confirm-booking-otp, .otp-wrapper, #otp-box'
  };

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // A permanent, on-screen trace of what the driver is doing. The previous
  // implementation only ever flashed a 4s toast, so any stall looked exactly
  // like "nothing happened".
  const STATUS_ID = 'railseat-autobook-status';
  let statusEl = null;

  function setStatus(step, detail, tone) {
    try {
      if (!document.body) return;
      if (!statusEl || !statusEl.isConnected) {
        const existing = document.getElementById(STATUS_ID);
        if (existing) existing.remove();
        statusEl = document.createElement('div');
        statusEl.id = STATUS_ID;
        statusEl.style.cssText = `
          position: fixed; left: 16px; bottom: 16px; z-index: 2147483647;
          max-width: 380px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          font-size: 12px; line-height: 1.5; padding: 12px 14px; border-radius: 12px;
          background: #0f172a; color: #e2e8f0; box-shadow: 0 8px 28px rgba(0,0,0,.45);
          display: flex; flex-direction: column; gap: 6px;
        `;
        const head = document.createElement('div');
        head.style.cssText = 'display:flex;align-items:center;gap:6px;font-weight:800;font-size:12px;';
        head.innerHTML = '<span style="width:8px;height:8px;border-radius:50%;background:#34d399;display:inline-block"></span>RailSeat auto-book';
        const body = document.createElement('div');
        body.id = STATUS_ID + '-body';
        const foot = document.createElement('div');
        foot.style.cssText = 'display:flex;gap:6px;';
        const retry = document.createElement('button');
        retry.textContent = 'Retry now';
        retry.style.cssText = 'cursor:pointer;border:0;border-radius:8px;padding:4px 10px;font-size:11px;font-weight:700;background:#34d399;color:#052e16;';
        retry.addEventListener('click', () => {
          const intent = loadAutoBookIntent() || readAutoBookIntentFromUrl();
          if (intent) {
            saveAutoBookIntent(intent);
            setStatus('Retrying', 'Restarted by hand.', true);
            startAutoBookDriver(true);
          }
        });
        const stop = document.createElement('button');
        stop.textContent = 'Cancel';
        stop.style.cssText = 'cursor:pointer;border:0;border-radius:8px;padding:4px 10px;font-size:11px;font-weight:700;background:#475569;color:#f8fafc;';
        stop.addEventListener('click', () => {
          clearAutoBookIntent();
          autoBookDriverRunning = false;
          if (statusEl && statusEl.isConnected) statusEl.remove();
          statusEl = null;
        });
        foot.appendChild(retry);
        foot.appendChild(stop);
        statusEl.appendChild(head);
        statusEl.appendChild(body);
        statusEl.appendChild(foot);
        document.body.appendChild(statusEl);
      }

      const body = statusEl.querySelector('#' + STATUS_ID + '-body');
      if (body) {
        body.textContent = detail ? step + ' — ' + detail : step;
        body.style.color = tone === 'bad' ? '#fca5a5' : (tone === 'wait' ? '#fcd34d' : '#e2e8f0');
      }
    } catch (e) {}
  }

  function normalize(value) {
    return String(value == null ? '' : value).trim().toUpperCase();
  }

  function readAutoBookIntentFromUrl() {
    let params;
    try {
      params = new URLSearchParams(window.location.search || '');
    } catch (e) {
      return null;
    }
    if (params.get('autobook') !== '1') return null;

    const seats = (params.get('seats') || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    const intent = {
      train: (params.get('train') || '').trim(),
      trainModel: (params.get('train_model') || '').trim(),
      seatClass: (params.get('class') || '').trim(),
      coach: (params.get('coach') || '').trim(),
      seats: seats,
      seatsCount: parseInt(params.get('seats_count') || (seats.length ? String(seats.length) : '1'), 10),
      autoCoach: params.get('auto_coach') === '1',
      from: (params.get('fromcity') || '').trim(),
      to: (params.get('tocity') || '').trim(),
      doj: (params.get('doj') || '').trim(),
      // Hold Only mode: select and hold seats without clicking Continue Purchase (no OTP)
      holdOnly: params.get('hold_only') === '1' || params.get('mode') === 'hold',
      // Strict coach match: do not auto-seek other coaches if user explicitly chose an exact coach in seat layout modal
      exactCoach: params.get('exact_coach') === '1' || params.get('exact') === '1',
      // Class-specific trip IDs from Railway server for exact coach targeting
      tripId: (params.get('trip_id') || '').trim(),
      tripRouteId: (params.get('trip_route_id') || '').trim(),
      position: (params.get('position') || params.get('pos') || 'any').toLowerCase().trim(),
      // Keep together preference: grab row-wise first, and if not found grab same side seat
      keepTogether: params.get('keep_together') !== '0',
      searchUrl: window.location.origin + window.location.pathname + window.location.search,
      createdAt: Date.now()
    };

    if (!intent.seats.length && !intent.coach && !intent.seatsCount) return null;
    return intent;
  }

  function saveAutoBookIntent(intent) {
    try {
      sessionStorage.setItem(AUTOBOOK_STORAGE_KEY, JSON.stringify(intent));
      localStorage.setItem(AUTOBOOK_STORAGE_KEY, JSON.stringify(intent));
    } catch (e) {}
  }

  function loadAutoBookIntent() {
    let raw = '';
    try {
      raw = sessionStorage.getItem(AUTOBOOK_STORAGE_KEY) || localStorage.getItem(AUTOBOOK_STORAGE_KEY) || '';
    } catch (e) {
      return null;
    }
    if (!raw) return null;

    let intent;
    try {
      intent = JSON.parse(raw);
    } catch (e) {
      clearAutoBookIntent();
      return null;
    }
    if (!intent || !Array.isArray(intent.seats)) {
      clearAutoBookIntent();
      return null;
    }
    if (Date.now() - (Number(intent.createdAt) || 0) > AUTOBOOK_TTL_MS) {
      clearAutoBookIntent();
      return null;
    }
    return intent;
  }

  function clearAutoBookIntent() {
    try {
      sessionStorage.removeItem(AUTOBOOK_STORAGE_KEY);
      localStorage.removeItem(AUTOBOOK_STORAGE_KEY);
    } catch (e) {}
  }

  function isRailwayLoggedIn() {
    try {
      return !!(localStorage.getItem(RAILWAY_LS_TOKEN) && localStorage.getItem(RAILWAY_LS_USER));
    } catch (e) {
      return false;
    }
  }

  function onPurchasePage() {
    return /\/booking\/train\/trip-info/i.test(window.location.pathname);
  }

  function onSearchPage() {
    return /\/booking\/train\/search/i.test(window.location.pathname);
  }

  function railClick(el) {
    if (!el) return false;
    try {
      el.scrollIntoView({ block: 'center', inline: 'center' });
    } catch (e) {}
    try {
      if (typeof el.click === 'function') {
        el.click();
      }
    } catch (e) {
      try {
        el.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true }));
      } catch (e2) {}
    }
    return true;
  }

  function railSelect(select, value) {
    if (!select) return false;
    try {
      const proto = window.HTMLSelectElement ? window.HTMLSelectElement.prototype : select.__proto__;
      const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
      if (descriptor && descriptor.set) {
        descriptor.set.call(select, value);
      } else {
        select.value = value;
      }
      const idx = Array.from(select.options || []).findIndex(o => String(o.value) === String(value));
      if (idx !== -1) select.selectedIndex = idx;
    } catch (e) {
      try {
        select.value = value;
      } catch (e2) {
        return false;
      }
    }

    ['input', 'change', 'blur'].forEach(type => {
      try {
        select.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
      } catch (e) {}
    });

    // Check & auto-dismiss prompt or modal that pops up after coach change with gentle pacing
    setTimeout(dismissAttentionDialogs, 400);
    setTimeout(dismissAttentionDialogs, 1200);

    return String(select.value) === String(value);
  }

  // -------------------------------------------------------------------------
  // Automatic Attention / Notice / Confirmation Dialogue Dismissal
  // When selecting a coach on eticket.railway.gov.bd, an "Attention" modal
  // or SweetAlert confirmation dialog often pops up asking user to click "OK" / "Agree".
  // This helper finds and auto-clicks OK / Agree / Confirm immediately, with deduplication.
  // -------------------------------------------------------------------------
  let lastDismissedTime = 0;
  let rateLimitCooldownUntil = 0;

  function isRateLimitActive() {
    return Date.now() < rateLimitCooldownUntil;
  }

  function triggerRateLimitCooldown(source = 'Railway Server') {
    const cooldownMs = 6000;
    rateLimitCooldownUntil = Date.now() + cooldownMs;
    console.warn(`[RailSeat AutoBook] ⚠️ Rate limit triggered by ${source}: 'You are requesting too frequently'. Cooling down for ${cooldownMs / 1000}s...`);
    setStatus('Rate limit cooldown', 'Railway server: "You are requesting too frequently." Pausing auto-book for 6 seconds to avoid IP block...', 'wait');
    showFloatingBadge('Railway rate limit: Cooldown active for 6 seconds. Please wait...', false);
  }

  function dismissAttentionDialogs() {
    try {
      const now = Date.now();
      if (now - lastDismissedTime < 450) return false;

      // 1. SweetAlert2 / Swal dialogs
      const swalConfirm = document.querySelector('.swal2-confirm, button.swal2-confirm, .swal-button--confirm');
      const swalPopup = document.querySelector('.swal2-popup, .swal-modal');
      if (swalPopup) {
        const swalText = textOf(swalPopup).toLowerCase();
        if (swalText.includes('too frequently') || swalText.includes('frequently') || swalText.includes('too many requests') || swalText.includes('wait and try after some time')) {
          triggerRateLimitCooldown('SweetAlert');
        }
      }
      if (swalConfirm && swalConfirm.offsetParent !== null && !swalConfirm._railClicked) {
        swalConfirm._railClicked = true;
        lastDismissedTime = now;
        console.log('[RailSeat AutoBook] 🎯 Auto-dismissing SweetAlert dialog');
        railClick(swalConfirm);
        return true;
      }

      // 2. Generic Modal / Dialog containers
      const dialogSelectors = [
        'app-attention-modal',
        '.attention-modal',
        '.attention-modal-wrapper',
        'app-alert-modal',
        '.modal.show',
        '.modal.fade.show',
        'ngb-modal-window',
        '.modal-dialog',
        '.cdk-overlay-pane',
        '.swal2-popup',
        'mat-dialog-container',
        'div[role="dialog"]',
        'div[role="alertdialog"]',
        '.popup',
        '.pop-up',
        '.popup-modal',
        '.dialog-box',
        '.ant-modal',
        '.alert-modal'
      ];

      for (const sel of dialogSelectors) {
        const dialogs = document.querySelectorAll(sel);
        for (const dlg of dialogs) {
          if (!dlg || dlg.offsetParent === null) continue; // not visible

          // Skip login modal so we don't accidentally close login
          if (dlg.matches(RS.loginModal) || dlg.querySelector(RS.loginModal) || dlg.querySelector('input[type="password"]')) {
            continue;
          }

          const dlgText = textOf(dlg).toLowerCase();

          // Check if this modal is a rate-limit / too-frequently warning from railway server
          if (dlgText.includes('too frequently') || dlgText.includes('frequently') || dlgText.includes('too many requests') || dlgText.includes('wait and try after some time')) {
            triggerRateLimitCooldown('Modal Dialog');
          }

          const isAttention = dlgText.includes('attention') ||
                              dlgText.includes('notice') ||
                              dlgText.includes('alert') ||
                              dlgText.includes('warning') ||
                              dlgText.includes('error') ||
                              dlgText.includes('frequently') ||
                              dlgText.includes('সতর্কতা') ||
                              dlgText.includes('দৃষ্টি আকর্ষণ') ||
                              dlgText.includes('অনুগ্রহ করে') ||
                              dlgText.includes('change coach') ||
                              dlgText.includes('selected coach') ||
                              dlgText.includes('bogie') ||
                              dlgText.includes('seat selection') ||
                              dlgText.includes('coach') ||
                              dlgText.includes('xtr') ||
                              dlgText.includes('extra') ||
                              dlgText.includes('কোচ') ||
                              dlgText.includes('বগি');

          // Look for OK, Confirm, Yes, Agree, Continue buttons inside the dialog
          const buttons = Array.from(dlg.querySelectorAll('button, a.btn, input[type="button"], input[type="submit"]'));
          const okBtn = buttons.find(b => {
            const txt = textOf(b).toLowerCase();
            const aria = (b.getAttribute('aria-label') || '').toLowerCase();
            return txt === 'ok' ||
                   txt === 'okay' ||
                   txt === 'agree' ||
                   txt === 'i agree' ||
                   txt === 'yes' ||
                   txt === 'confirm' ||
                   txt === 'ঠিক আছে' ||
                   txt === 'সম্মত' ||
                   txt === 'হ্যাঁ' ||
                   txt.includes('understood') ||
                   txt.includes('okay') ||
                   txt.includes('agree') ||
                   txt.includes('confirm') ||
                   txt.includes('try again') ||
                   txt.includes('আবার চেষ্টা') ||
                   aria === 'ok' ||
                   aria === 'okay' ||
                   aria === 'close' ||
                   b.classList.contains('btn-ok') ||
                   b.classList.contains('btn-confirm') ||
                   b.classList.contains('swal2-confirm') ||
                   b.getAttribute('data-dismiss') === 'modal';
          }) || (isAttention ? buttons.find(b => b.classList.contains('btn-primary') || b.classList.contains('btn-success') || b.classList.contains('btn-confirm') || b.classList.contains('swal2-confirm')) : null) || (isAttention ? buttons[0] : null);

          if (okBtn && !okBtn._railClicked) {
            okBtn._railClicked = true;
            lastDismissedTime = now;
            console.log('[RailSeat AutoBook] 🎯 Auto-dismissed Attention/Popup dialogue box:', textOf(okBtn) || 'OK');
            railClick(okBtn);
            return true;
          }
        }
      }

      // 3. Fallback: Search all visible buttons in the document matching standalone "OK" on attention backdrop
      const allModals = document.querySelectorAll('.modal-backdrop, .cdk-overlay-backdrop, .swal2-backdrop-show, .modal-open, .cdk-global-overlay-wrapper');
      if (allModals.length > 0) {
        const standaloneOk = Array.from(document.querySelectorAll('button, a.btn, input[type="button"]')).find(b => {
          if (b.offsetParent === null || b._railClicked) return false;
          // Avoid touching login modal submit
          if (b.closest(RS.loginModal) || b.closest('form')?.querySelector('input[type="password"]')) return false;
          const txt = textOf(b).toLowerCase();
          return txt === 'ok' || txt === 'okay' || txt === 'ঠিক আছে' || b.classList.contains('swal2-confirm') || b.classList.contains('btn-ok') || txt.includes('understood') || txt === 'agree' || txt === 'confirm';
        });
        if (standaloneOk) {
          standaloneOk._railClicked = true;
          lastDismissedTime = now;
          console.log('[RailSeat AutoBook] 🎯 Auto-dismissed backdrop dialogue with OK button');
          railClick(standaloneOk);
          return true;
        }
      }
    } catch (e) {
      console.warn('[RailSeat AutoBook] dismissAttentionDialogs error:', e);
    }
    return false;
  }

  function textOf(el) {
    return ((el && (el.textContent || '')) || '').replace(/\s+/g, ' ').trim();
  }

  function toEnglishDigits(str) {
    if (!str) return '';
    const bnMap = { '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4', '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9' };
    return String(str).replace(/[০-৯]/g, d => bnMap[d] || d);
  }

  const BN_EN_COACH_MAP = {
    'KA': ['ক', 'KA'],
    'KHA': ['খ', 'KHA'],
    'GA': ['গ', 'GA'],
    'GHA': ['ঘ', 'GHA'],
    'UMA': ['ঙ', 'UMA'],
    'CHA': ['চ', 'CHA'],
    'SCHA': ['ছ', 'SCHA', 'CHHA'],
    'JA': ['জ', 'JA'],
    'JHA': ['ঝ', 'JHA'],
    'NEO': ['ঞ', 'NEO', 'IO'],
    'TA': ['ট', 'TA'],
    'THA': ['ঠ', 'THA'],
    'DA': ['ড', 'DA'],
    'DHA': ['ঢ', 'DHA'],
    'NA': ['ণ', 'ন', 'NA'],
    'TO': ['ত', 'TO', 'TA'],
    'THO': ['থ', 'THO', 'THA'],
    'DO': ['দ', 'DO', 'DA'],
    'DHO': ['ধ', 'DHO', 'DHA'],
    'NO': ['ন', 'NO', 'NA'],
    'PA': ['প', 'PA'],
    'PHA': ['ফ', 'PHA', 'FA'],
    'BA': ['ব', 'BA'],
    'BHA': ['ভ', 'BHA', 'VA'],
    'MA': ['ম', 'MA'],
    'JA': ['য', 'জ', 'JA', 'YA'],
    'RA': ['র', 'RA'],
    'LA': ['ল', 'LA'],
    'XTR1': ['XTR1', 'XTR-1', 'EXTRA1', 'EXTRA-1', 'এক্সট্রা ১', 'এক্সট্রা-১'],
    'XTR2': ['XTR2', 'XTR-2', 'EXTRA2', 'EXTRA-2', 'এক্সট্রা ২', 'এক্সট্রা-২'],
    'XTR3': ['XTR3', 'XTR-3', 'EXTRA3', 'EXTRA-3', 'এক্সট্রা ৩', 'এক্সট্রা-৩'],
    'XTR4': ['XTR4', 'XTR-4', 'EXTRA4', 'EXTRA-4', 'এক্সট্রা ৪', 'এক্সট্রা-৪'],
    'XTR5': ['XTR5', 'XTR-5', 'EXTRA5', 'EXTRA-5', 'এক্সট্রা ৫', 'এক্সট্রা-৫'],
    'XTR6': ['XTR6', 'XTR-6', 'EXTRA6', 'EXTRA-6', 'এক্সট্রা ৬', 'এক্সট্রা-৬']
  };

  function coachTokens(coach) {
    if (!coach) return [];
    const raw = String(coach).trim().toUpperCase();
    const engDigits = toEnglishDigits(raw);
    const tokens = new Set();
    tokens.add(raw);
    tokens.add(engDigits);

    // Check Bengali/English bogie alias mapping
    for (const [key, aliases] of Object.entries(BN_EN_COACH_MAP)) {
      if (aliases.some(a => raw === a || engDigits === a || raw.startsWith(a + '-') || raw.endsWith('-' + a) || engDigits.startsWith(a + '-') || engDigits.endsWith('-' + a))) {
        aliases.forEach(a => {
          tokens.add(a);
          tokens.add(a.toUpperCase());
        });
        break;
      }
    }

    raw.split(/[\s\-_\/()]+/).forEach(part => {
      if (part.length >= 1) {
        tokens.add(part);
        tokens.add(toEnglishDigits(part));
      }
    });

    const m = engDigits.match(/([A-Z\u0980-\u09FF]{1,4})\s*[-_]?\s*(\d{1,3})/);
    if (m) {
      tokens.add(m[1]);
      tokens.add(m[2]);
      tokens.add(m[1] + m[2]);
    }
    const cleanNoPunct = engDigits.replace(/[\s\-_\/()]/g, '');
    if (cleanNoPunct) tokens.add(cleanNoPunct);
    return Array.from(tokens);
  }

  function findTripCard(intent) {
    const cards = Array.from(document.querySelectorAll(RS.tripCard));
    if (!cards.length) return null;

    const rawTrain = normalize(intent.train);
    const model = normalize(intent.trainModel);
    const name = rawTrain.replace(/\s*EXPRESS.*$/, '').replace(/\(\d+\)/, '').trim();
    const number = (rawTrain.match(/\b(\d{2,4})\b/) || [])[1] || (model.match(/\b(\d{2,4})\b/) || [])[1] || '';

    // If intent has no train preference or "ALL", pick the first card
    if (!rawTrain || rawTrain === 'ALL') {
      return cards[0] || null;
    }

    // 1. Numeric train number (e.g. 704, 788)
    if (number) {
      const byNumber = cards.find(card => {
        const titleText = textOf(card.querySelector(RS.tripTitle) || card.querySelector('.trip-name') || card);
        return titleText.includes(number);
      });
      if (byNumber) return byNumber;
    }

    // 2. Model match
    if (model) {
      const byModel = cards.find(card => {
        const titleText = textOf(card.querySelector(RS.tripTitle) || card.querySelector('.trip-name') || card);
        return titleText.toUpperCase().includes(model);
      });
      if (byModel) return byModel;
    }

    // 3. Name match
    if (name) {
      const byName = cards.find(card => {
        const titleText = normalize(textOf(card.querySelector(RS.tripTitle) || card.querySelector('.trip-name') || card));
        return titleText.includes(name) || name.includes(titleText);
      });
      if (byName) return byName;
    }

    // 4. Loose match in full text content
    return cards.find(card => {
      const fullText = normalize(card.textContent);
      return (number && fullText.includes(number)) || (name && fullText.includes(name));
    }) || cards[0] || null;
  }

  let lastClassNote = '';

  function findSeatClassCard(card, seatClass) {
    const wanted = normalize(seatClass);
    let cards = Array.from(card.querySelectorAll(RS.seatClassCard));
    if (!cards.length) {
      const btns = Array.from(card.querySelectorAll(RS.bookNowBtn));
      cards = btns.map(b => b.closest('div') || b.parentElement).filter(Boolean);
    }
    if (!cards.length) return null;
    lastClassNote = '';

    const classAliases = {
      'S_CHAIR': ['S_CHAIR', 'SHOVON CHAIR', 'S-CHAIR', 'SCHAIR', 'SHOVON'],
      'SNIGDHA': ['SNIGDHA', 'AC CHAIR', 'SNIGDHA (AC CHAIR)', 'AC_C'],
      'F_SEAT': ['F_SEAT', 'FIRST SEAT', 'FIRST CLASS SEAT', 'F-SEAT'],
      'F_BERTH': ['F_BERTH', 'FIRST BERTH', 'FIRST CLASS BERTH', 'F-BERTH'],
      'AC_B': ['AC_B', 'AC BERTH', 'AC-B'],
      'AC_S': ['AC_S', 'AC SEAT', 'AC-S'],
      'SHOVON': ['SHOVON', 'SHOVON CHAIR', 'S_CHAIR']
    };

    const targetAliases = (wanted && classAliases[wanted]) || (wanted ? [wanted] : []);

    if (wanted && wanted !== 'ANY') {
      for (const c of cards) {
        const label = normalize(textOf(c.querySelector(RS.seatClassName) || c));
        if (targetAliases.some(alias => label === alias || label.includes(alias) || alias.includes(label))) {
          return c;
        }
      }
    }

    const bookable = cards.find(c => {
      const btn = c.querySelector(RS.bookNowBtn) || (c.matches && c.matches(RS.bookNowBtn) ? c : null);
      return btn && !btn.disabled;
    });
    if (bookable) {
      lastClassNote = `using ${textOf(bookable.querySelector(RS.seatClassName)) || 'available class'}`;
      console.log(`[RailSeat AutoBook] ${lastClassNote}`);
      return bookable;
    }
    return cards[0] || null;
  }

  // Step 1 — expand the train card and press "Book Now" for the requested class
  // so the official seat layout modal is mounted.
  function openSeatLayout(intent) {
    if (document.querySelector(RS.seatLayout)) return 'requested';

    const card = findTripCard(intent);
    if (!card) return 'no-train';

    const header = card.querySelector(RS.tripHeader) || card.querySelector('.trip-name') || card;
    const classCard = findSeatClassCard(card, intent.seatClass);

    if (!classCard) {
      if (header) railClick(header);
      return 'expanding';
    }

    const bookBtn = classCard.querySelector(RS.bookNowBtn) ||
      (classCard.matches && classCard.matches(RS.bookNowBtn) ? classCard : null) ||
      card.querySelector(RS.bookNowBtn);

    if (!bookBtn) {
      if (header) railClick(header);
      return 'expanding';
    }
    if (bookBtn.disabled) return 'book-disabled';

    railClick(bookBtn);
    return 'requested';
  }

  function matchCoachOption(select, coachName) {
    if (!select || !select.options || !coachName) return null;
    const tokens = coachTokens(coachName);
    const cleanedCoach = toEnglishDigits(String(coachName).trim().toUpperCase()).replace(/[\s\-_\/()]/g, '');
    if (cleanedCoach && !tokens.includes(cleanedCoach)) tokens.push(cleanedCoach);

    const options = Array.from(select.options).filter(o => o && o.value && String(o.value).trim() !== '');
    if (!options.length) return null;

    let bestOption = null;
    let bestScore = -1;

    for (const option of options) {
      const origText = textOf(option);
      const text = toEnglishDigits(origText).toUpperCase().trim();
      const cleanText = text.replace(/[\s\-_\/()]/g, '');
      const val = toEnglishDigits(String(option.value || '')).toUpperCase().trim();
      const cleanVal = val.replace(/[\s\-_\/()]/g, '');

      let score = 0;

      // Extract leading coach identifier (e.g., "XTR1", "CHA", "KA", "1")
      const optCoachMatch = text.match(/^([A-Z\u0980-\u09FF0-9]+)/);
      const optLeadingName = optCoachMatch ? optCoachMatch[1] : '';

      for (const token of tokens) {
        const t = token.toUpperCase();
        const cleanT = t.replace(/[\s\-_\/()]/g, '');

        // 1. Exact match on coach name / leading identifier (e.g. "XTR1 (12)" or "XTR-1" matches "XTR1")
        if (optLeadingName === t || optLeadingName === cleanT) {
          score = Math.max(score, 100);
        }
        // 2. Exact match on full option text or value
        else if (text === t || val === t || cleanText === cleanT || cleanVal === cleanT) {
          score = Math.max(score, 95);
        }
        // 3. Option text starts with token followed by delimiter
        else if (text.startsWith(t + ' ') || text.startsWith(t + '(') || text.startsWith(t + '-') || text.startsWith(t + ':')) {
          score = Math.max(score, 90);
        }
        // 4. Token enclosed in parentheses or surrounded by spaces
        else if (text.includes(' ' + t + ' ') || text.includes('(' + t + ')') || text.includes('-' + t + '-') || text.includes(' ' + t + '(')) {
          score = Math.max(score, 85);
        }
        // 5. Clean text prefix match
        else if (cleanText.startsWith(cleanT) || cleanVal.startsWith(cleanT)) {
          score = Math.max(score, 75);
        }
        // 6. Substring match
        else if (origText.includes(token) || text.includes(t)) {
          score = Math.max(score, 60);
        }
      }

      // Check cleaned coach directly
      if (cleanedCoach) {
        if (optLeadingName === cleanedCoach) {
          score = Math.max(score, 100);
        } else if (cleanText.startsWith(cleanedCoach)) {
          score = Math.max(score, 80);
        } else if (cleanText.includes(cleanedCoach)) {
          score = Math.max(score, 65);
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestOption = option;
      }
    }

    if (bestScore >= 60) {
      console.log(`[RailSeat AutoBook] 🎯 Matched coach "${coachName}" to option "${textOf(bestOption)}" (score: ${bestScore})`);
      return bestOption;
    }

    return null;
  }

  function isSeatButtonAvailable(btn) {
    if (!btn) return false;
    if (btn.disabled) return false;
    if (btn.classList.contains(RS.seatBooked) || btn.classList.contains('booked') || btn.classList.contains('seat-in-progress') || btn.classList.contains('in-progress')) return false;
    if (btn.classList.contains(RS.seatDisabled) || btn.classList.contains('disabled')) return false;
    if (btn.getAttribute('aria-disabled') === 'true') return false;
    const txt = (btn.textContent || '').trim();
    const title = (btn.getAttribute('title') || '').trim();
    const aria = (btn.getAttribute('aria-label') || '').trim();
    if (!txt && !title && !aria) return false;
    return true;
  }

  function getAvailableSeatButtons(layout) {
    const buttons = Array.from(layout.querySelectorAll(RS.seatBtn));
    return buttons.filter(btn => isSeatButtonAvailable(btn) && !btn.classList.contains(RS.seatSelected));
  }

  // Wait for seat buttons in the layout to appear or update after coach selection
  async function waitForSeatLayoutUpdate(layout, maxWaitMs = 1200) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      dismissAttentionDialogs();
      const btns = layout.querySelectorAll(RS.seatBtn);
      if (btns.length > 0) return true;
      await sleep(150);
    }
    return false;
  }

  // Step 2 — Smart Blank Coach Selection: Automatically finds and selects a coach with blank seats!
  async function findAndSelectCoachWithBlankSeats(layout, intent, log) {
    const select = layout.querySelector(RS.coachSelect);
    if (!select || !select.options || select.options.length === 0) return 'loading';

    const validOptions = Array.from(select.options).filter(o => o.value && String(o.value).trim() !== '');
    if (!validOptions.length) return 'loading';

    // 1. If preferred coach is given, test it first
    if (intent.coach && intent.coach !== 'ANY' && intent.coach !== 'Coach') {
      const matched = matchCoachOption(select, intent.coach);
      if (matched) {
        if (String(select.value) !== String(matched.value)) {
          railSelect(select, matched.value);
          await sleep(200);
          dismissAttentionDialogs();
          await waitForSeatLayoutUpdate(layout, 1200);
          dismissAttentionDialogs();
        }
        const free = getAvailableSeatButtons(layout);
        if (free.length > 0) {
          log(`Preferred Coach ${intent.coach} is active with ${free.length} blank seat(s).`);
          return 'ok';
        }
        if (intent.exactCoach) {
          // If exact match requested, check if seat buttons have finished rendering
          const allSeats = layout.querySelectorAll(RS.seatBtn);
          if (allSeats.length === 0) {
            await waitForSeatLayoutUpdate(layout, 1000);
          }
          log(`Exact Coach ${intent.coach} selected by user is active.`);
          return 'ok';
        }
        log(`Preferred Coach ${intent.coach} has 0 blank seats. Auto-seeking available coaches...`);
      } else {
        if (intent.exactCoach) {
          log(`Exact Coach ${intent.coach} not found in dropdown yet. Retrying exact coach...`);
          return 'loading';
        }
        log(`Preferred Coach ${intent.coach} not found in dropdown. Auto-seeking available coaches...`);
      }
    } else if (select.value && select.value !== '') {
      dismissAttentionDialogs();
      const free = getAvailableSeatButtons(layout);
      if (free.length > 0) return 'ok';
    }

    if (intent.exactCoach) {
      log(`Exact coach ${intent.coach || ''} requested by user — staying on selected coach.`);
      return 'ok';
    }

    // 2. Scan coaches to find one with blank seats!
    // Priority: options whose text does NOT indicate "(0)" or "Available: 0"
    const sorted = [...validOptions].sort((a, b) => {
      const aText = textOf(a);
      const bText = textOf(b);
      const aZero = /\(\s*0\s*\)/.test(aText) || /available:\s*0/i.test(aText);
      const bZero = /\(\s*0\s*\)/.test(bText) || /available:\s*0/i.test(bText);
      if (aZero && !bZero) return 1;
      if (!aZero && bZero) return -1;
      return 0;
    });

    for (const opt of sorted) {
      if (isRateLimitActive()) {
        log(`Rate limit cooldown active. Pausing coach search...`);
        return 'loading';
      }

      const optText = textOf(opt);
      if (/\(\s*0\s*\)/.test(optText) || /available:\s*0/i.test(optText)) {
        continue; // skip coaches explicitly showing 0 seats
      }

      if (String(select.value) !== String(opt.value)) {
        railSelect(select, opt.value);
        await sleep(400); // polite delay to respect Railway rate limits
        dismissAttentionDialogs();
        await waitForSeatLayoutUpdate(layout, 1200);
        dismissAttentionDialogs();
      }

      const free = getAvailableSeatButtons(layout);
      if (free.length > 0) {
        const coachName = (optText.match(/^([A-Za-z0-9\-_]+)/) || [])[1] || optText;
        log(`🎯 Auto-switched to Coach ${coachName} with ${free.length} blank seat(s)!`);
        intent.coach = coachName;
        return 'ok';
      }
    }

    // If no option explicitly marked > 0 worked, test remaining options just in case (with rate-limiting guard)
    for (const opt of validOptions) {
      if (isRateLimitActive()) return 'loading';
      if (String(select.value) !== String(opt.value)) {
        railSelect(select, opt.value);
        await sleep(500); // polite delay
        dismissAttentionDialogs();
        await waitForSeatLayoutUpdate(layout, 1200);
        dismissAttentionDialogs();
      }
      const free = getAvailableSeatButtons(layout);
      if (free.length > 0) {
        const coachName = (textOf(opt).match(/^([A-Za-z0-9\-_]+)/) || [])[1] || textOf(opt);
        log(`🎯 Found Coach ${coachName} with ${free.length} blank seat(s)!`);
        intent.coach = coachName;
        return 'ok';
      }
    }

    return 'none-available';
  }

  function findSeatButton(layout, seat) {
    const raw = toEnglishDigits(seat);
    const wanted = normalize(raw);
    if (!wanted) return null;
    const buttons = Array.from(layout.querySelectorAll(RS.seatBtn));
    if (!buttons.length) return null;

    const bareNumber = wanted.replace(/^[^0-9]+/, '');

    // 1. Direct exact match on title, text, data-seat, aria-label
    for (const btn of buttons) {
      const title = normalize(toEnglishDigits(btn.getAttribute('title') || ''));
      const text = normalize(toEnglishDigits(textOf(btn)));
      const dataSeat = normalize(toEnglishDigits(btn.getAttribute('data-seat') || btn.getAttribute('data-seat-number') || btn.getAttribute('data-seat-name') || ''));
      const aria = normalize(toEnglishDigits(btn.getAttribute('aria-label') || ''));

      if (title === wanted || text === wanted || dataSeat === wanted || aria === wanted) {
        return btn;
      }
    }

    // 2. Dash/bogie match e.g. "CHA-14" or "14" matches title ending with "-14" or containing " 14"
    if (bareNumber) {
      for (const btn of buttons) {
        const title = normalize(toEnglishDigits(btn.getAttribute('title') || ''));
        const text = normalize(toEnglishDigits(textOf(btn)));
        const dataSeat = normalize(toEnglishDigits(btn.getAttribute('data-seat') || btn.getAttribute('data-seat-number') || ''));

        const titleNum = title.replace(/^[^0-9]+/, '').replace(/[^0-9]+.*$/, '');
        const textNum = text.replace(/^[^0-9]+/, '').replace(/[^0-9]+.*$/, '');
        const dataNum = dataSeat.replace(/^[^0-9]+/, '').replace(/[^0-9]+.*$/, '');

        if (titleNum === bareNumber || textNum === bareNumber || dataNum === bareNumber) {
          return btn;
        }

        // Substring check e.g. "CHA-14" or "-14" or "(14)"
        if (title.endsWith('-' + bareNumber) || title.includes('-' + bareNumber + ' ') || title.includes('(' + bareNumber + ')')) {
          return btn;
        }
      }
    }

    return null;
  }

  async function clickAndVerifySeat(layout, btn, seatLabel) {
    if (!btn) return false;
    if (btn.classList.contains(RS.seatSelected)) return true;
    railClick(btn);

    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      if (btn.classList.contains(RS.seatSelected)) return true;
      const refound = seatLabel ? findSeatButton(layout, seatLabel) : null;
      if (refound && refound.classList.contains(RS.seatSelected)) return true;
      if (btn.disabled || btn.classList.contains(RS.seatBooked)) return false;
      await sleep(200);
    }
    return btn.classList.contains(RS.seatSelected);
  }

  // Step 3 — Smart Seat Reservation: Automatically picks blank seats!
  async function smartReserveSeats(layout, intent, log) {
    const needed = Math.max(1, parseInt(intent.seatsCount, 10) || (intent.seats && intent.seats.length) || 1);
    const results = { selected: [], missing: [] };

    // 1. Try specifically requested seat names/numbers first
    if (Array.isArray(intent.seats) && intent.seats.length > 0) {
      for (const seat of intent.seats) {
        if (isRateLimitActive()) {
          log(`Rate limit cooldown active. Pausing seat reservation...`);
          break;
        }
        if (countSelectedSeats(layout) >= needed) break;
        const btn = findSeatButton(layout, seat);
        if (btn && isSeatButtonAvailable(btn)) {
          const ok = await clickAndVerifySeat(layout, btn, seat);
          if (ok) results.selected.push(seat);
          else results.missing.push(seat);
          await sleep(300); // polite pause between seat requests
        } else {
          results.missing.push(seat);
        }
      }
    }

    // 2. If still need seats and NOT in strict exact-match mode, automatically pick available blank seats in current layout!
    let currentlySelected = countSelectedSeats(layout);
    if (currentlySelected < needed) {
      if (intent.exactCoach && Array.isArray(intent.seats) && intent.seats.length > 0) {
        log(`Exact seat mode active — not auto-picking random alternative seats.`);
      } else {
        const stillNeed = needed - currentlySelected;
        let blankButtons = getAvailableSeatButtons(layout);
        if (blankButtons.length > 0) {
          const pos = (intent.position || intent.section || 'any').toLowerCase();
          const keepTogether = intent.keepTogether !== false && stillNeed > 1;

          // Helper: Parse seat button properties and geometric position
          function parseButtonInfo(btn, allButtons) {
            const label = normalize(btn.getAttribute('title') || textOf(btn) || btn.getAttribute('data-seat') || '');
            const num = parseInt(label.replace(/\D+/g, ''), 10) || 0;

            // Row detection: Try parent element grouping or bounding client rect
            let rowId = null;
            let colId = null;
            const rowParent = btn.closest('.seat-row, .row, tr, [class*="row"]');
            if (rowParent) {
              rowId = rowParent;
              const siblings = Array.from(rowParent.querySelectorAll(RS.seatBtn) || []);
              colId = siblings.indexOf(btn);
            }

            // Visual layout coordinates via getBoundingClientRect if in DOM
            let rect = null;
            try {
              rect = btn.getBoundingClientRect();
            } catch (e) {}

            return { btn, label, num, rowId, colId, rect };
          }

          // Group all available buttons with geometric metadata
          const seatMetaList = blankButtons.map(b => parseButtonInfo(b, blankButtons));

          // Helper: Detect coach row size (4 for 2+2, 5 for 3+2)
          const is3Plus2 = (intent.seatClass || '').toUpperCase().includes('SNIGDHA') || (intent.seatClass || '').toUpperCase().includes('AC_S');
          const seatsPerRow = is3Plus2 ? 5 : 4;

          function getEstimatedRow(item) {
            if (item.rect && item.rect.top > 0) {
              // Group rows by visual Y coordinate with 16px tolerance
              return Math.round(item.rect.top / 24);
            }
            if (item.num > 0) {
              return Math.ceil(item.num / seatsPerRow);
            }
            return 1;
          }

          function getSide(item) {
            if (item.rect && item.rect.left > 0) {
              // Compare with layout center
              try {
                const layoutRect = layout.getBoundingClientRect();
                const center = layoutRect.left + (layoutRect.width / 2);
                return item.rect.left < center ? 'left' : 'right';
              } catch (e) {}
            }
            if (item.num > 0) {
              const mod = (item.num - 1) % seatsPerRow;
              if (seatsPerRow === 5) return mod <= 2 ? 'left' : 'right';
              return mod <= 1 ? 'left' : 'right';
            }
            return 'left';
          }

          function isWindowSeat(item) {
            if (item.num > 0) {
              const mod4 = (item.num - 1) % 4;
              const mod5 = (item.num - 1) % 5;
              return mod4 === 0 || mod4 === 3 || mod5 === 0 || mod5 === 4;
            }
            return false;
          }

          function isAisleSeat(item) {
            if (item.num > 0) {
              const mod4 = (item.num - 1) % 4;
              const mod5 = (item.num - 1) % 5;
              return mod4 === 1 || mod4 === 2 || mod5 === 2 || mod5 === 3;
            }
            return false;
          }

          // Helper: Score individual seat against position preference
          function scoreItemPosition(item) {
            let s = 0;
            if (pos === 'window') {
              if (isWindowSeat(item)) s += 30;
              else if (isAisleSeat(item)) s -= 10;
            } else if (pos === 'aisle') {
              if (isAisleSeat(item)) s += 30;
              else if (isWindowSeat(item)) s -= 10;
            } else if (pos === 'front') {
              s += (500 - (item.num || 100));
            } else if (pos === 'back') {
              s += (item.num || 0);
            } else if (pos === 'middle') {
              const mid = 45;
              s += (100 - Math.abs((item.num || 45) - mid));
            }
            return s;
          }

          let chosenButtons = [];

          // -------------------------------------------------------------
          // STEP 1 (ROW-WISE FIRST): Look for seats together in the SAME ROW
          // -------------------------------------------------------------
          if (keepTogether) {
            log(`Searching for ${stillNeed} seat(s) together row-wise...`);
            const rowMap = new Map();

            for (const item of seatMetaList) {
              const rKey = item.rowId || getEstimatedRow(item);
              if (!rowMap.has(rKey)) rowMap.set(rKey, []);
              rowMap.get(rKey).push(item);
            }

            let bestRowRun = null;
            let bestRowScore = -Infinity;

            for (const [, itemsInRow] of rowMap.entries()) {
              if (itemsInRow.length >= stillNeed) {
                // Sort by col or X position or seat number
                itemsInRow.sort((a, b) => {
                  if (a.rect && b.rect && Math.abs(a.rect.left - b.rect.left) > 2) {
                    return a.rect.left - b.rect.left;
                  }
                  return (a.num || 0) - (b.num || 0);
                });

                // Find contiguous or adjacent window of length stillNeed in this row on the SAME SIDE
                for (let i = 0; i <= itemsInRow.length - stillNeed; i++) {
                  const run = itemsInRow.slice(i, i + stillNeed);
                  const firstSide = getSide(run[0]);
                  const allSameSide = run.every(st => getSide(st) === firstSide);
                  if (!allSameSide) continue; // MUST HAVE SAME SIDE: Do not pick seats across the aisle!

                  let runScore = 120;
                  run.forEach(st => { runScore += scoreItemPosition(st); });

                  // Check if seat numbers are contiguous e.g. 1 & 2
                  const nums = run.map(r => r.num).filter(n => n > 0);
                  if (nums.length === stillNeed) {
                    const isSequential = nums.every((n, idx) => idx === 0 || n === nums[idx - 1] + 1);
                    if (isSequential) runScore += 50;
                  }

                  if (runScore > bestRowScore) {
                    bestRowScore = runScore;
                    bestRowRun = run.map(r => r.btn);
                  }
                }
              }
            }

            if (bestRowRun && bestRowRun.length === stillNeed) {
              chosenButtons = bestRowRun;
              log(`🎯 Found ${stillNeed} seats together in the same row & on the SAME SIDE!`);
            }
          }

          // -------------------------------------------------------------
          // STEP 2 (SAME-SIDE FALLBACK): If not found in same row, grab seats on the SAME SIDE
          // -------------------------------------------------------------
          if (chosenButtons.length < stillNeed && keepTogether) {
            log(`Seats together in same row not available. Falling back to same-side seats...`);
            const leftSideItems = [];
            const rightSideItems = [];

            for (const item of seatMetaList) {
              if (getSide(item) === 'left') leftSideItems.push(item);
              else rightSideItems.push(item);
            }

            let bestSideGroup = null;
            let bestSideScore = -Infinity;

            for (const sideList of [leftSideItems, rightSideItems]) {
              if (sideList.length >= stillNeed) {
                // Sort by row proximity
                sideList.sort((a, b) => {
                  const rA = getEstimatedRow(a);
                  const rB = getEstimatedRow(b);
                  if (rA !== rB) return rA - rB;
                  return (a.num || 0) - (b.num || 0);
                });

                for (let i = 0; i <= sideList.length - stillNeed; i++) {
                  const group = sideList.slice(i, i + stillNeed);
                  const minR = Math.min(...group.map(g => getEstimatedRow(g)));
                  const maxR = Math.max(...group.map(g => getEstimatedRow(g)));
                  const rowSpread = maxR - minR;

                  let sideScore = 80 - (rowSpread * 10);
                  group.forEach(g => { sideScore += scoreItemPosition(g); });

                  if (sideScore > bestSideScore) {
                    bestSideScore = sideScore;
                    bestSideGroup = group.map(g => g.btn);
                  }
                }
              }
            }

            if (bestSideGroup && bestSideGroup.length === stillNeed) {
              chosenButtons = bestSideGroup;
              log(`🎯 Found ${stillNeed} seats together on the same side of the carriage!`);
            }
          }

          // -------------------------------------------------------------
          // STEP 3 (GENERAL FALLBACK): Best available seats sorted by position
          // -------------------------------------------------------------
          if (chosenButtons.length < stillNeed) {
            if (keepTogether) {
              log(`Could not find adjacent row/side block. Picking best individual available seats...`);
            }
            blankButtons.sort((a, b) => {
              const metaA = parseButtonInfo(a, blankButtons);
              const metaB = parseButtonInfo(b, blankButtons);
              return scoreItemPosition(metaB) - scoreItemPosition(metaA);
            });
            chosenButtons = blankButtons.slice(0, stillNeed);
          }

          // Click and verify the chosen seats
          for (let i = 0; i < chosenButtons.length; i++) {
            if (isRateLimitActive()) {
              log(`Rate limit cooldown active. Pausing seat reservation...`);
              break;
            }
            const btn = chosenButtons[i];
            const label = normalize(btn.getAttribute('title') || textOf(btn) || btn.getAttribute('data-seat') || `Seat-${i+1}`);
            const ok = await clickAndVerifySeat(layout, btn, label);
            if (ok) {
              results.selected.push(label);
              currentlySelected = countSelectedSeats(layout);
              if (currentlySelected >= needed) break;
            }
            await sleep(300); // polite pause between seat selections
          }
        }
      }
    }

    log(`Seats reserved: ${countSelectedSeats(layout)} / ${needed} (${results.selected.join(', ') || 'none'})`);
    return results;
  }

  // Step 4 — the official form refuses to continue without a boarding point,
  // even though it looks optional.
  function setBoardingPoint(layout) {
    const select = layout.querySelector(RS.boardingSelect);
    if (!select) return true;
    if (select.value && select.value !== '') return true;

    const options = Array.from(select.options || []);
    const option = options.find(opt => {
      const val = String(opt.value || '').trim();
      const txt = textOf(opt).toUpperCase();
      return val !== '' && !txt.includes('SELECT') && !txt.includes('CHOOSE');
    }) || options.find(opt => String(opt.value || '').trim() !== '');

    if (!option) return false;
    return railSelect(select, option.value);
  }

  function countSelectedSeats(layout) {
    return layout.querySelectorAll(RS.seatSelectedSel).length;
  }

  function findContinueButton(layout) {
    const root = layout.querySelector('#confirmbooking') || layout || document;
    let btn = root.querySelector(RS.continueBtn) || document.querySelector(RS.continueBtn);
    if (!btn) {
      const allBtns = Array.from(root.querySelectorAll('button, a.btn'));
      btn = allBtns.find(b => /CONTINUE\s*PURCHASE/i.test(textOf(b)) || /^CONTINUE/i.test(textOf(b)));
    }
    return btn;
  }

  // Step 5 — Continue Purchase. On success the SPA routes to
  // /booking/train/trip-info, which is the passenger details + OTP page.
  function clickContinue(layout) {
    const btn = findContinueButton(layout);
    if (!btn) return 'missing';
    if (btn.disabled || btn.classList.contains('continue-btn-disabled')) return 'disabled';
    railClick(btn);
    return 'clicked';
  }

  function focusOtpBox() {
    const box = document.querySelector(RS.otpBox);
    if (!box) return;
    const input = box.querySelector('input');
    if (!input) return;
    try {
      input.scrollIntoView({ block: 'center' });
      input.focus();
    } catch (e) {}
  }

  let autoBookDriverRunning = false;
  let autoBookWatchdog = null;
  let driverGeneration = 0;

  async function runAutoBookDriver(myGeneration) {
    let idleTicks = 0;
    let announcedLogin = false;
    let openAttempts = 0;
    let openCooldown = 0;
    let coachMissTicks = 0;
    let boardingMissTicks = 0;
    let continueWaits = 0;
    let returningToSearch = false;

    for (let tick = 0; tick < AUTOBOOK_MAX_TICKS; tick++) {
      if (driverGeneration !== myGeneration) break;
      const intent = loadAutoBookIntent();
      if (!intent) break;

      if (onPurchasePage()) {
        focusOtpBox();
        showFloatingBadge('Seats held. Enter the OTP sent to your mobile to confirm.', true);
        setStatus('Done', 'Seats are held on the railway site. Enter the OTP sent to your mobile to confirm.', 'ok');
        clearAutoBookIntent();
        break;
      }

      if (document.querySelector(RS.loginModal)) {
        idleTicks++;
        if (!announcedLogin || idleTicks % 5 === 0) {
          announcedLogin = true;
          showFloatingBadge('Please log in on the railway modal — booking will proceed immediately to OTP.', false);
        }
        setStatus('Login required', 'Please sign in on the railway popup. Seats will be held and continue to OTP.', 'wait');
        await sleep(1500);
        continue;
      }

      const layout = document.querySelector(RS.seatLayout);
      if (!layout) {
        idleTicks++;
        if (!onSearchPage()) {
          // The railway SPA wandered off (login bounce, a guard, a manual
          // click). Put it back on the search URL with a real navigation so
          // the app re-runs the search and this script re-seeds the intent.
          setStatus('Returning', `Railway site is on ${window.location.pathname} — returning to the search page.`, 'wait');
          if (intent.searchUrl && !returningToSearch) {
            returningToSearch = true;
            try {
              window.location.assign(intent.searchUrl);
            } catch (e) {}
            return;
          }
        } else if (isRateLimitActive()) {
          setStatus('Rate limit cooldown', 'Railway server requested cooldown ("requesting too frequently"). Waiting 5s...', 'wait');
          await sleep(2000);
          continue;
        } else if (openAttempts < 30 && openCooldown <= 0) {
          const status = openSeatLayout(intent);
          if (status === 'requested') {
            openAttempts++;
            // Give the modal time to mount before touching the button again (polite pacing).
            openCooldown = 5;
            setStatus('Opening seat map', `Pressing Book Now${lastClassNote ? ' (' + lastClassNote + ')' : ''}...`, 'ok');
          } else if (status === 'no-train') {
            setStatus('Finding train', `Train "${intent.trainModel || intent.train}" has not appeared in the results yet. ${openAttempts}/30.`, 'wait');
          } else if (status === 'expanding') {
            setStatus('Finding train', 'Expanding the train card...', 'wait');
          } else if (status === 'no-book-button' || status === 'book-disabled') {
            setStatus('Not bookable', 'That seat class is not bookable on the railway site right now. Retrying...', 'bad');
          }
          await sleep(AUTOBOOK_TICK_MS);
          continue;
        } else if (idleTicks > 400) {
          showFloatingBadge('Could not find that train on the railway site.', false);
          setStatus('Stuck', 'The train never appeared in the railway results. Use "Retry now" after searching manually, or pick different seats.', 'bad');
          break;
        } else {
          setStatus('Opening seat map', 'Waiting for the seat map to mount on the railway site...', 'wait');
        }
        if (openCooldown > 0) openCooldown--;
        await sleep(AUTOBOOK_TICK_MS);
        continue;
      }

      idleTicks = 0;
      announcedLogin = false;

      // Always auto-dismiss any Attention / Notice dialogue box that may be blocking the UI
      dismissAttentionDialogs();

      const neededSeats = Math.max(1, parseInt(intent.seatsCount, 10) || (intent.seats && intent.seats.length) || 1);

      // Step 2: Smart Blank Coach Selection — Automatically finds and selects a coach with blank seats!
      if (countSelectedSeats(layout) < neededSeats) {
        dismissAttentionDialogs();
        const coachStatus = await findAndSelectCoachWithBlankSeats(layout, intent, msg => {
          setStatus('Seeking Coach', msg, 'wait');
        });

        if (coachStatus === 'loading') {
          coachMissTicks++;
          if (coachMissTicks > 30) {
            showFloatingBadge('Coach list is not mounting on the railway site.', false);
            setStatus('Stuck', 'Coach dropdown not found. Please select coach manually.', 'bad');
          }
          await sleep(AUTOBOOK_TICK_MS);
          continue;
        }
        coachMissTicks = 0;
      }
      await sleep(250);

      // Step 3: Smart Seat Reservation — Automatically finds and grabs blank seats!
      if (countSelectedSeats(layout) < neededSeats) {
        setStatus('Reserving Seats', `Finding & locking ${neededSeats} seat(s) in Coach ${intent.coach || ''}...`, 'ok');
        const results = await smartReserveSeats(layout, intent, msg => {
          setStatus('Reserving Seats', msg, 'ok');
        });
        await sleep(350);

        if (countSelectedSeats(layout) < neededSeats) {
          coachMissTicks++;
          if (intent.exactCoach) {
            if (coachMissTicks < 15) {
              setStatus('Reserving Exact Seats', `Trying to select requested seat(s) (${intent.seats.join(', ') || ''}) in Coach ${intent.coach || ''}... (${coachMissTicks}/15)`, 'wait');
              await sleep(AUTOBOOK_TICK_MS);
              continue;
            } else {
              showFloatingBadge(`Requested seat(s) in Coach ${intent.coach || ''} could not be reserved (may be already taken).`, false);
              setStatus('Seats unavailable', `Selected seat(s) (${intent.seats.join(', ') || ''}) in Coach ${intent.coach || ''} are not available on the Railway server.`, 'bad');
              clearAutoBookIntent();
              break;
            }
          } else {
            if (coachMissTicks < 8) {
              setStatus('Seeking Seats', `Coach ${intent.coach || ''} didn't have enough seats. Checking other coaches...`, 'wait');
              await sleep(AUTOBOOK_TICK_MS);
              continue;
            } else {
              showFloatingBadge('Could not find enough blank seats on this train.', false);
              setStatus('Sold out', 'Could not find enough available blank seats across train coaches.', 'bad');
              clearAutoBookIntent();
              break;
            }
          }
        }
      }

      if (!setBoardingPoint(layout)) {
        boardingMissTicks++;
        if (boardingMissTicks > 30) {
          showFloatingBadge('The railway site would not accept a boarding point, so nothing was booked.', false);
          setStatus('Stuck', 'The railway site would not accept a boarding point, so nothing was booked.', 'bad');
          clearAutoBookIntent();
          break;
        }
        setStatus('Boarding point', 'Choosing a boarding point for you...', 'wait');
        await sleep(AUTOBOOK_TICK_MS);
        continue;
      }
      boardingMissTicks = 0;
      await sleep(250);

      if (countSelectedSeats(layout) > 0) {
        // If user chose "Hold Only" mode: stop here! Do not click Continue Purchase, do not advance to OTP.
        if (intent.holdOnly) {
          const heldSeatsText = intent.seats.length ? intent.seats.join(', ') : 'Selected seats';
          showFloatingBadge(`Seat(s) ${heldSeatsText} held successfully! (Hold Only Mode — Not proceeding to OTP)`, true);
          setStatus('Seats Held', `Seat(s) ${heldSeatsText} in coach ${intent.coach || ''} are held on the railway server. Hold Only mode active — Continue Purchase was not clicked. You have ~5 minutes to review.`, 'ok');
          clearAutoBookIntent();
          break;
        }

        if (isRateLimitActive()) {
          setStatus('Rate limit cooldown', 'Railway server: "You are requesting too frequently." Waiting out cooldown before continuing...', 'wait');
          await sleep(2500);
          continue;
        }

        const result = clickContinue(layout);
        if (result === 'clicked') {
          continueWaits = 0;
          showFloatingBadge('Continue Purchase sent — opening passenger & OTP step...', true);
          setStatus('Continuing', 'Continue Purchase sent — opening the passenger & OTP step...', 'ok');
          await sleep(2000);
          continue;
        }
        if (result === 'disabled') {
          continueWaits++;
          setStatus('Continuing', 'Waiting for the railway server to confirm the seats...', 'wait');
          if (continueWaits > 30) {
            showFloatingBadge('The railway site keeps refusing Continue Purchase. Nothing was booked.', false);
            setStatus('Stuck', 'The railway site keeps refusing Continue Purchase. Open the seat map and finish by hand — nothing was booked.', 'bad');
            break;
          }
        }
      } else {
        showFloatingBadge('Seats unavailable — pick different seats on the railway site.', false);
        setStatus('Seats unavailable', 'No seats are selected. Pick different seats on the railway site.', 'bad');
        clearAutoBookIntent();
        break;
      }

      await sleep(AUTOBOOK_TICK_MS);
    }

    autoBookDriverRunning = false;
  }

  function startAutoBookDriver(force) {
    if (autoBookDriverRunning) {
      if (!force) return;
      // Ask the in-flight loop to unwind, then let the watchdog relaunch it.
      driverGeneration++;
    } else {
      autoBookDriverRunning = true;
      runAutoBookDriver(driverGeneration)
        .catch(err => {
          console.warn('[RailSeat AutoBook] Driver error:', err);
          setStatus('Error', String((err && err.message) || err), 'bad');
        })
        .finally(() => {
          autoBookDriverRunning = false;
          // If the driver fell out of its loop while an intent is still pending
          // (SPA soft-navigation, a thrown step, a lost race), pick it back up
          // instead of leaving the user with a dead page.
          if (loadAutoBookIntent() && !autoBookWatchdog) {
            autoBookWatchdog = setTimeout(() => {
              autoBookWatchdog = null;
              if (loadAutoBookIntent()) startAutoBookDriver();
            }, 2000);
          }
        });
    }
  }

  let autoBookWatchersAttached = false;

  function initAutoBookFlow() {
    const fromUrl = readAutoBookIntentFromUrl();
    if (fromUrl) {
      saveAutoBookIntent(fromUrl);
      console.log('[RailSeat AutoBook] Auto-book intent received:', fromUrl);

      // Clean the autobook and seat parameters from the URL so page refreshes or navigations
      // do not repeatedly re-trigger the intent or re-seed it unintentionally.
      try {
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete('autobook');
        cleanUrl.searchParams.delete('seats');
        cleanUrl.searchParams.delete('coach');
        cleanUrl.searchParams.delete('hold_only');
        cleanUrl.searchParams.delete('exact_coach');
        cleanUrl.searchParams.delete('mode');
        window.history.replaceState({}, document.title, cleanUrl.pathname + cleanUrl.search);
      } catch (e) {}
    }

    if (!loadAutoBookIntent()) return;

    let kickedOff = false;
    const kickOff = () => {
      if (kickedOff) return;
      kickedOff = true;
      try {
        const currentIntent = loadAutoBookIntent();
        const isHold = currentIntent && currentIntent.holdOnly;
        showFloatingBadge(isHold ? 'Auto-holding seats on Railway server (Hold Only mode)...' : 'Auto-booking on the railway server...', true);
        setStatus('Starting', isHold ? 'Auto-hold mode active: will select & hold seats without proceeding to OTP.' : 'Reading the search page on eticket.railway.gov.bd...', 'wait');
      } catch (e) {}
      setTimeout(() => startAutoBookDriver(), 800);
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', kickOff, { once: true });
    } else {
      kickOff();
    }

    if (autoBookWatchersAttached) return;
    autoBookWatchersAttached = true;

    // The railway site is an SPA, so a client-side route change never re-runs
    // this file. Keep a cheap heartbeat that relaunches the driver whenever an
    // intent is pending but nothing is driving it.
    setInterval(() => {
      if (!autoBookDriverRunning && loadAutoBookIntent()) {
        setStatus('Resuming', 'Reattached to the pending auto-book request.', 'wait');
        startAutoBookDriver();
      }
    }, 3000);

    // Fast watcher: instantly dismiss any Attention / Alert dialog box as soon as it appears in the DOM
    setInterval(() => {
      if (loadAutoBookIntent()) {
        dismissAttentionDialogs();
      }
    }, 400);

    // MutationObserver to auto-dismiss dialogs immediately when appended to DOM
    try {
      const observer = new MutationObserver(() => {
        if (loadAutoBookIntent()) {
          dismissAttentionDialogs();
        }
      });
      observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
    } catch (e) {}
  }

  // Resume if the railway site performs a full page load or restores the tab
  // while an intent is still pending.
  window.addEventListener('pageshow', () => {
    if (loadAutoBookIntent() && !autoBookDriverRunning) startAutoBookDriver();
  });

  try {
    initAutoBookFlow();
  } catch (e) {
    console.warn('[RailSeat AutoBook] Init error:', e);
    try { setStatus('Error', 'Auto-book failed to start: ' + ((e && e.message) || e), 'bad'); } catch (e2) {}
  }

  console.log(`[RailSeat Bridge] 🚆 Multi-domain session & token bridge active for: ${getTargetUrls().join(', ')}`);
})();
