#!/usr/bin/env python3
"""
scripts/camoufox-token-worker.py

Automated Stealth Headless Background Token Worker for Bangladesh Railway.
Powered by Camoufox (C++ anti-detect patched Firefox engine).

Functions:
1. Solves Cloudflare Turnstile headlessly on eticket.railway.gov.bd
2. Extracts fresh cft_response tokens
3. Transmits tokens directly to http://localhost:3000/api/auth/set-token
4. Runs on-demand (--once) or continuously as a background daemon (--daemon)
"""

import sys
import os
import time
import json
import argparse
import requests

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)
        sys.stderr.reconfigure(encoding="utf-8", line_buffering=True)
    except Exception:
        pass

SERVER_BASE_URL = os.environ.get("RAILSEAT_SERVER_URL", "http://localhost:3000")
SET_TOKEN_ENDPOINT = f"{SERVER_BASE_URL}/api/auth/set-token"
TOKEN_STATUS_ENDPOINT = f"{SERVER_BASE_URL}/api/auth/token-status"
TARGET_URL = "https://eticket.railway.gov.bd/booking/train/search?fromcity=Dhaka&tocity=Chattogram&doj=19-Oct-2026&class=S_CHAIR"

def check_token_status():
    """Checks if the server already has a fresh token (< 60s old)"""
    try:
        resp = requests.get(TOKEN_STATUS_ENDPOINT, timeout=3)
        if resp.status_code == 200:
            data = resp.json()
            if data.get("has_cft") and data.get("cft_age_seconds") is not None:
                return data.get("cft_age_seconds")
    except Exception:
        pass
    return None

def solve_turnstile_with_camoufox(headless=True, max_wait=35):
    """
    Launches Camoufox stealth browser to acquire a fresh Cloudflare Turnstile token.
    """
    from camoufox.sync_api import Camoufox

    print("====================================================")
    print("🦊 Camoufox Anti-Detect Turnstile Worker")
    print(f"🌐 Headless: {headless} | Target: {TARGET_URL}")
    print("====================================================")

    # Configure stealth parameters for realistic browser fingerprint
    camoufox_config = {
        "headless": headless,
        "humanize": False
    }

    try:
        with Camoufox(**camoufox_config) as browser:
            page = browser.new_page()
            
            # Dismiss disclaimer beforehand
            page.add_init_script("""
                try {
                    sessionStorage.setItem('disclaimer_agreed_for_home', '1');
                    localStorage.setItem('disclaimer_agreed_for_home', '1');
                } catch(e) {}
            """)

            print(f"🧭 Navigating to: {TARGET_URL}...")
            page.goto(TARGET_URL, wait_until="domcontentloaded", timeout=30000)

            # Wait for Angular SPA and Turnstile widget to mount
            print("⏳ Awaiting Turnstile challenge resolution...")
            start_time = time.time()
            captured_token = None

            while time.time() - start_time < max_wait:
                # 1. Check DOM input elements
                token = page.evaluate("""
                    () => {
                        const selectors = [
                            '[name="cf-turnstile-response"]',
                            'input[name="cf-turnstile-response"]',
                            'textarea[name="cf-turnstile-response"]',
                            '[name="cft_response"]',
                            'input[name="cft_response"]',
                            '#cf-chl-widget-response'
                        ];
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

                if token and len(token) > 20:
                    captured_token = token
                    print(f"🎯 Turnstile resolved successfully! Token length: {len(token)}")
                    break

                # 2. Check for interactive checkbox frame if Cloudflare requests a click
                try:
                    iframes = page.locator("iframe[src*='challenges.cloudflare.com']").all()
                    for iframe_el in iframes:
                        box = iframe_el.bounding_box()
                        if box and box.get("width", 0) > 0:
                            click_x = box["x"] + 28
                            click_y = box["y"] + (box["height"] / 2)
                            print(f"🖱️ Clicking human verification checkbox at ({click_x:.1f}, {click_y:.1f})...")
                            page.mouse.click(click_x, click_y)
                            time.sleep(1.5)
                            break
                    for frame in page.frames:
                        if "challenges.cloudflare.com" in frame.url:
                            checkbox = frame.locator("input[type='checkbox'], #challenge-stage, .ctp-checkbox-label, div[role='checkbox']").first
                            if checkbox.is_visible(timeout=500):
                                print("🖱️ Clicking frame element checkbox...")
                                checkbox.click(force=True)
                                time.sleep(1.0)
                except Exception as fe:
                    pass

                time.sleep(0.5)

            # Debug screenshot
            try:
                screenshots_dir = os.path.join(os.path.dirname(__file__), "..", "screenshots")
                os.makedirs(screenshots_dir, exist_ok=True)
                shot_path = os.path.join(screenshots_dir, "camoufox_login_debug.png")
                page.screenshot(path=shot_path)
                print(f"📸 Debug screenshot saved: {shot_path}")
            except Exception as e:
                print(f"Screenshot notice: {e}")

            if captured_token:
                # Transmit token to local server vault
                print(f"⚡ Syncing fresh token to server: {SET_TOKEN_ENDPOINT}...")
                try:
                    sync_res = requests.post(
                        SET_TOKEN_ENDPOINT,
                        json={"cft_response": captured_token},
                        headers={"Content-Type": "application/json"},
                        timeout=5
                    )
                    if sync_res.status_code == 200:
                        print("✅ Token successfully synced to RailSeat server token vault!")
                    else:
                        print(f"⚠️ Server responded with status {sync_res.status_code}")
                except Exception as e:
                    print(f"⚠️ Failed to reach local server: {e}")

                # Save locally for backup
                data_dir = os.path.join(os.path.dirname(__file__), "..", "data")
                os.makedirs(data_dir, exist_ok=True)
                token_file = os.path.join(data_dir, "latest_turnstile_token.json")
                with open(token_file, "w", encoding="utf-8") as f:
                    json.dump({"token": captured_token, "timestamp": int(time.time() * 1000), "source": "camoufox"}, f, indent=2)

                return captured_token
            else:
                print("⚠️ Turnstile did not complete within the timeout period.")
                return None

    except Exception as e:
        print(f"❌ Camoufox execution error: {e}")
        return None

def run_daemon_loop(interval=75):
    """
    Continuous background loop that ensures server always has a fresh token.
    """
    print(f"🔄 Starting Camoufox Daemon Keeper (check interval: {interval}s)...")
    while True:
        try:
            age = check_token_status()
            if age is None or age > 60:
                print(f"🕒 Token missing or aging ({age}s). Fetching fresh token via Camoufox...")
                solve_turnstile_with_camoufox(headless=True)
            else:
                print(f"✨ Server token is fresh ({age}s old). Next check in {interval}s.")
        except KeyboardInterrupt:
            print("\n👋 Stopping Camoufox Daemon Keeper.")
            break
        except Exception as e:
            print(f"⚠️ Worker loop warning: {e}")

        time.sleep(interval)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Camoufox Turnstile Token Worker")
    parser.add_argument("--once", action="store_true", help="Solve once and exit")
    parser.add_argument("--daemon", action="store_true", help="Run continuous background keeper daemon")
    parser.add_argument("--headful", action="store_true", help="Run with visible browser window")
    args = parser.parse_args()

    headless_mode = not args.headful

    if args.daemon:
        run_daemon_loop(interval=75)
    else:
        token = solve_turnstile_with_camoufox(headless=headless_mode)
        sys.exit(0 if token else 1)
