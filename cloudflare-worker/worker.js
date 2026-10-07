/**
 * Cloudflare Worker: Bangladesh Railway (Shohoz) Mobile API Proxy & Direct Auth
 * 
 * Capabilities:
 *  - Direct Mobile Sign-In (phone + password) using official Android App API (/v1.0/app/)
 *  - ZERO Turnstile / CAPTCHA requirement (Mobile SSDK bypasses web Turnstile)
 *  - Live Seat Layout Retrieval (/v1.0/app/bookings/seat-layout)
 *  - Train Search API Proxy
 *  - Built-in CORS support for seamless integration into any frontend/dashboard
 */

// Helper: Web Crypto SHA-256
async function sha256Hex(str) {
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Generate valid 160-char Shohoz SSDK device fingerprint
async function generateShohozDeviceKey(seed = '') {
  const s = seed || (Date.now().toString() + crypto.randomUUID());
  const p1 = await sha256Hex(s + '_shohoz_k1');
  const p2 = await sha256Hex(p1 + '_shohoz_k2');
  const p3 = await sha256Hex(p2 + '_shohoz_k3');
  return (p1 + p2 + p3).substring(0, 160);
}

// Base CORS Headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-device-id, x-device-key',
  'Access-Control-Max-Age': '86400'
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8'
    }
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // 2. Health & Info Root
    if (url.pathname === '/' || url.pathname === '/api') {
      return jsonResponse({
        service: 'Bangladesh Railway Mobile API Gateway (Cloudflare Worker)',
        status: 'active',
        engine: 'Cloudflare V8 Edge Worker',
        routes: {
          'POST /api/login': 'Direct Mobile App Login (No Turnstile required)',
          'GET, POST /api/seat-layout': 'Live Coach & Seat Layout via /v1.0/app/bookings/seat-layout',
          'GET /api/search': 'Train Search via /v1.0/web/booking/search'
        },
        documentation: 'Send mobile_number and password to /api/login to get your session token.'
      });
    }

    // -------------------------------------------------------------------------
    // ROUTE: Direct Mobile Login (/api/login or /api/auth/sign-in)
    // -------------------------------------------------------------------------
    if (url.pathname === '/api/login' || url.pathname === '/api/auth/sign-in') {
      if (request.method !== 'POST') {
        return jsonResponse({ success: false, error: 'Method Not Allowed' }, 405);
      }

      try {
        const body = await request.json();
        const mobile = (body.mobile_number || body.mobile || '').toString().trim();
        const password = (body.password || '').toString();

        if (!mobile || !password) {
          return jsonResponse({ success: false, error: 'Mobile number and password are required.' }, 400);
        }

        const deviceId = crypto.randomUUID();
        const deviceKey = await generateShohozDeviceKey(mobile);

        const mobileHeaders = {
          'User-Agent': 'Shohoz-Rail-App/2.2.0 (Linux; Android 13; SM-G998B Build/TP1A.220624.014; wv)',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9,bn-BD;q=0.8',
          'x-device-id': deviceId,
          'x-device-key': deviceKey,
          'x-platform': 'android',
          'x-app-version': '2.2.0',
          'Content-Type': 'application/json'
        };

        const shohozRes = await fetch('https://railspaapi.shohoz.com/v1.0/app/auth/sign-in', {
          method: 'POST',
          headers: mobileHeaders,
          body: JSON.stringify({
            mobile_number: mobile,
            password: password
          })
        });

        const shohozData = await shohozRes.json().catch(() => null);

        if (shohozRes.status === 200 && shohozData) {
          const token = shohozData.data?.token || shohozData.token || shohozData.data?.access_token;
          const user = shohozData.data?.user || shohozData.user || { mobile_number: mobile };

          return jsonResponse({
            success: true,
            message: 'Signed in successfully via Shohoz Mobile App API!',
            token: token,
            token_preview: token ? `${token.substring(0, 10)}...${token.slice(-6)}` : null,
            device_id: deviceId,
            device_key: deviceKey,
            user: user,
            source: 'railway_mobile_app_cf_worker'
          });
        }

        let errMsg = null;
        if (Array.isArray(shohozData?.error?.messages)) {
          errMsg = shohozData.error.messages.join(', ');
        } else if (typeof shohozData?.error?.message === 'string') {
          errMsg = shohozData.error.message;
        } else if (typeof shohozData?.error === 'string') {
          errMsg = shohozData.error;
        } else if (typeof shohozData?.message === 'string') {
          errMsg = shohozData.message;
        } else {
          errMsg = `Shohoz rejected login (HTTP ${shohozRes.status})`;
        }

        return jsonResponse({
          success: false,
          error: errMsg,
          details: shohozData
        }, shohozRes.status >= 400 && shohozRes.status < 500 ? shohozRes.status : 401);

      } catch (err) {
        return jsonResponse({ success: false, error: err.message || 'Internal login error' }, 500);
      }
    }

    // -------------------------------------------------------------------------
    // ROUTE: Seat Layout (/api/seat-layout or /api/live-coach-layout)
    // -------------------------------------------------------------------------
    if (url.pathname === '/api/seat-layout' || url.pathname === '/api/live-coach-layout') {
      let bodyData = {};
      if (request.method === 'POST') {
        try {
          bodyData = await request.json();
        } catch (_) {
          bodyData = {};
        }
      }

      const tripId = bodyData.trip_id || url.searchParams.get('trip_id');
      const tripRouteId = bodyData.trip_route_id || url.searchParams.get('trip_route_id');

      if (!tripId || !tripRouteId) {
        return jsonResponse({ success: false, error: 'trip_id and trip_route_id parameters are required.' }, 400);
      }

      // Check authorization header, body token, or query token
      const authHeader = request.headers.get('Authorization') || '';
      const queryToken = url.searchParams.get('token');
      const bodyToken = bodyData.token;
      const rawToken = authHeader.replace(/^Bearer\s+/i, '').trim() || bodyToken || queryToken;

      const deviceId = request.headers.get('x-device-id') || bodyData.device_id || bodyData.deviceId || crypto.randomUUID();
      const deviceKey = request.headers.get('x-device-key') || bodyData.device_key || bodyData.deviceKey || (rawToken ? await generateShohozDeviceKey(rawToken) : await generateShohozDeviceKey(deviceId));

      const mobileHeaders = {
        'User-Agent': 'Shohoz-Rail-App/2.2.0 (Linux; Android 13; SM-G998B Build/TP1A.220624.014; wv)',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9,bn-BD;q=0.8',
        'x-device-id': deviceId,
        'x-device-key': deviceKey,
        'x-platform': 'android',
        'x-app-version': '2.2.0',
        'Content-Type': 'application/json'
      };

      if (rawToken) {
        mobileHeaders['Authorization'] = `Bearer ${rawToken}`;
      }

      const targetUrl = `https://railspaapi.shohoz.com/v1.0/app/bookings/seat-layout?trip_id=${encodeURIComponent(tripId)}&trip_route_id=${encodeURIComponent(tripRouteId)}`;

      try {
        const res = await fetch(targetUrl, {
          method: 'GET',
          headers: mobileHeaders
        });

        const data = await res.json().catch(() => null);

        if (res.status === 200 && data) {
          return jsonResponse({
            success: true,
            status_source: 'official_railway_mobile_app',
            data: data.data || data
          });
        }

        let errLayout = null;
        if (Array.isArray(data?.error?.messages)) {
          errLayout = data.error.messages.join(', ');
        } else if (typeof data?.error?.message === 'string') {
          errLayout = data.error.message;
        } else if (typeof data?.error === 'string') {
          errLayout = data.error;
        } else if (typeof data?.message === 'string') {
          errLayout = data.message;
        } else {
          errLayout = `Failed to fetch seat layout (HTTP ${res.status})`;
        }

        return jsonResponse({
          success: false,
          error: errLayout,
          raw: data
        }, res.status);
      } catch (err) {
        return jsonResponse({ success: false, error: err.message }, 500);
      }
    }

    // -------------------------------------------------------------------------
    // ROUTE: Search Trains (/api/search)
    // -------------------------------------------------------------------------
    if (url.pathname === '/api/search') {
      const fromCity = url.searchParams.get('from_city') || '';
      const toCity = url.searchParams.get('to_city') || '';
      const doj = url.searchParams.get('date_of_journey') || '';
      const seatClass = url.searchParams.get('seat_class') || 'S_CHAIR';

      if (!fromCity || !toCity || !doj) {
        return jsonResponse({ success: false, error: 'from_city, to_city, and date_of_journey are required.' }, 400);
      }

      const targetUrl = `https://railspaapi.shohoz.com/v1.0/web/booking/search?from_city=${encodeURIComponent(fromCity)}&to_city=${encodeURIComponent(toCity)}&date_of_journey=${encodeURIComponent(doj)}&seat_class=${encodeURIComponent(seatClass)}`;

      try {
        const res = await fetch(targetUrl, {
          headers: {
            'User-Agent': 'Shohoz-Rail-App/2.2.0 (Linux; Android 13; SM-G998B Build/TP1A.220624.014; wv)',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9,bn-BD;q=0.8'
          }
        });
        const data = await res.json().catch(() => null);
        return jsonResponse(data || { success: false, error: 'Empty search response' }, res.status);
      } catch (err) {
        return jsonResponse({ success: false, error: err.message }, 500);
      }
    }

    return jsonResponse({ success: false, error: 'Endpoint not found' }, 404);
  }
};
