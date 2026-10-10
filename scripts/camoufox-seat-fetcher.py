#!/usr/bin/env python3
"""
scripts/camoufox-seat-fetcher.py

100% Genuine Live Seat Map Fetcher for Bangladesh Railway.
Powered by Camoufox anti-detect engine.
- Headlessly mounts Bangladesh Railway with authentic authenticated user session
- Lets Cloudflare Turnstile solve invisibly (sitekey 0x4AAAAAACNkZ_TxQr_zpcZW)
- Uses expect_response to safely capture live seat layout responses from Shohoz / Bangladesh Railway
- Saves live layout to JSON and prints directly for Node.js server ingestion
"""

import sys
import os
import json
import time
import argparse

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)
        sys.stderr.reconfigure(encoding="utf-8", line_buffering=True)
    except Exception:
        pass

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
SESSION_FILE = os.path.join(DATA_DIR, "session.json")
TOKEN_FILE = os.path.join(DATA_DIR, "latest_turnstile_token.json")

def load_session():
    if os.path.exists(SESSION_FILE):
        try:
            with open(SESSION_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return None

def fetch_live_seat_layout(
    from_city="Dhaka",
    to_city="Chattogram",
    doj="19-Oct-2026",
    seat_class="S_CHAIR",
    train_model="704",
    trip_id="",
    trip_route_id="",
    timeout=25
):
    from camoufox.sync_api import Camoufox

    session = load_session()
    if not session or not session.get("token"):
        print("[CamoufoxSeatFetcher] Error: Valid user session token required.")
        return None

    tok = session["token"]
    dev_id = session.get("deviceId", "34a817c48b87571632d2a7a1d50575a4")
    dev_key = session.get("deviceKey", "")
    user_json = json.dumps(session.get("user", {}))

    target_url = f"https://eticket.railway.gov.bd/booking/train/search?fromcity={from_city}&tocity={to_city}&doj={doj}&class={seat_class}"
    print(f"[CamoufoxSeatFetcher] Target URL: {target_url}")

    captured_layout = None
    captured_cft = None

    with Camoufox(headless=True, humanize=False) as b:
        p = b.new_page()

        # Inject official authenticated localStorage state
        p.add_init_script(f"""
            try {{
                sessionStorage.setItem('disclaimer_agreed_for_home', '1');
                localStorage.setItem('disclaimer_agreed_for_home', '1');
                localStorage.setItem('token', '{tok}');
                localStorage.setItem('user', JSON.stringify({user_json}));
                localStorage.setItem('uudid', '{dev_id}');
                localStorage.setItem('ssdk', '{dev_key}');
            }} catch(e) {{}}
        """)

        # Check if we already have a very fresh token (< 100s old) in TOKEN_FILE
        if os.path.exists(TOKEN_FILE):
            try:
                with open(TOKEN_FILE, "r", encoding="utf-8") as f:
                    t_data = json.load(f)
                    age_ms = int(time.time() * 1000) - t_data.get("timestamp", 0)
                    if age_ms < 100000 and t_data.get("token"):
                        captured_cft = t_data.get("token")
                        print(f"[CamoufoxSeatFetcher] ⚡ Using pre-existing fresh CFT token ({int(age_ms/1000)}s old)")
            except Exception:
                pass

        # Block unnecessary media and fonts to load 3x faster
        p.route("**/*", lambda route: route.abort() if route.request.resource_type in ["image", "media", "font"] else route.continue_())

        print("[CamoufoxSeatFetcher] Navigating to search page...")
        p.goto(target_url, wait_until="commit", timeout=20000)

        # Wait for Angular trips and Turnstile with high-frequency check
        start_wait = time.time()
        while time.time() - start_wait < 12:
            if not captured_cft:
                cft = p.evaluate("""
                    () => {
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
                    }
                """)
                if cft:
                    captured_cft = cft
                    try:
                        with open(TOKEN_FILE, "w", encoding="utf-8") as f:
                            json.dump({"token": cft, "timestamp": int(time.time() * 1000), "source": "camoufox"}, f, indent=2)
                    except Exception:
                        pass
                    break

            if captured_cft and trip_id and trip_route_id:
                break
            time.sleep(0.2)

        # If specific trip_id and trip_route_id are provided, trigger directly via in-page fetch immediately
        if trip_id and trip_route_id and captured_cft:
            print(f"[CamoufoxSeatFetcher] ⚡ In-page fast fetch for trip_id={trip_id}...")
            api_res = p.evaluate("""
                async ({ tripId, tripRouteId, cft }) => {
                    try {
                        const token = localStorage.getItem('token');
                        const uudid = localStorage.getItem('uudid') || '';
                        const ssdk = localStorage.getItem('ssdk') || '';
                        const url = `https://railspaapi.shohoz.com/v1.0/web/bookings/seat-layout?trip_id=${encodeURIComponent(tripId)}&trip_route_id=${encodeURIComponent(tripRouteId)}&cft_response=${encodeURIComponent(cft)}`;
                        const res = await fetch(url, {
                            headers: {
                                'Accept': 'application/json',
                                'Authorization': `Bearer ${token}`,
                                'X-Device-Id': uudid,
                                'X-Device-Key': ssdk,
                                'X-Requested-With': 'XMLHttpRequest'
                            }
                        });
                        if (res.ok) {
                            return await res.json();
                        }
                        return null;
                    } catch(e) {
                        return null;
                    }
                }
            """, {"tripId": trip_id, "tripRouteId": trip_route_id, "cft": captured_cft})

            if api_res and (api_res.get("data") or api_res.get("coaches")):
                captured_layout = api_res
                print(f"[CamoufoxSeatFetcher] 🚀 Direct in-page layout retrieval succeeded in record time!")

        # If layout not yet captured, click the button on the UI using expect_response
        if not captured_layout:
            clean_model = str(train_model).replace("\\D", "").strip()
            print(f"[CamoufoxSeatFetcher] Locating button for model: {clean_model} or class: {seat_class}...")
            btn = p.locator(f'app-single-trip:has-text("{clean_model}") button.book-now-btn').first
            if not btn.is_visible(timeout=3000):
                btn = p.locator('button.book-now-btn').first

            if btn.is_visible(timeout=2000):
                print(f"[CamoufoxSeatFetcher] Armed with expect_response! Clicking book-now-btn...")
                try:
                    with p.expect_response(lambda res: '/bookings/seat-layout' in res.url and res.status == 200, timeout=15000) as resp_info:
                        btn.click()
                    res_val = resp_info.value
                    if res_val.status == 200:
                        captured_layout = res_val.json()
                        print(f"[CamoufoxSeatFetcher] 🎯 Successfully captured live seat layout via expect_response!")
                except Exception as e:
                    print(f"[CamoufoxSeatFetcher] expect_response notice: {e}")

    if captured_layout:
        cache_name = f"live_layout_{train_model}_{seat_class}.json"
        cache_path = os.path.join(DATA_DIR, cache_name)
        try:
            with open(cache_path, "w", encoding="utf-8") as f:
                json.dump(captured_layout, f, indent=2)
            print(f"[CamoufoxSeatFetcher] ✅ Saved live layout to {cache_path}")
        except Exception:
            pass
        return captured_layout

    return None

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--from-city", default="Dhaka")
    parser.add_argument("--to-city", default="Chattogram")
    parser.add_argument("--doj", default="19-Oct-2026")
    parser.add_argument("--class", dest="seat_class", default="S_CHAIR")
    parser.add_argument("--model", default="704")
    parser.add_argument("--trip-id", default="")
    parser.add_argument("--trip-route-id", default="")
    args = parser.parse_args()

    res = fetch_live_seat_layout(
        from_city=args.from_city,
        to_city=args.to_city,
        doj=args.doj,
        seat_class=args.seat_class,
        train_model=args.model,
        trip_id=args.trip_id,
        trip_route_id=args.trip_route_id
    )
    if res:
        print("---LIVE_LAYOUT_JSON_START---")
        print(json.dumps(res))
        print("---LIVE_LAYOUT_JSON_END---")
        sys.exit(0)
    else:
        print("RESULT_FAILED")
        sys.exit(1)
