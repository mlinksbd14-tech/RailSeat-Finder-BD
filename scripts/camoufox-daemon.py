#!/usr/bin/env python3
"""
scripts/camoufox-daemon.py

Pre-warmed Persistent Camoufox Daemon for Bangladesh Railway (Shohoz).
Maintains a warm, headless Camoufox browser instance in memory:
- Keeps eticket.railway.gov.bd and authenticated session loaded
- Automatically solves and refreshes Cloudflare Turnstile continuously
- Exposes a high-speed local HTTP micro-service on http://127.0.0.1:5055
- Responds to live seat layout requests in sub-second time (~200ms - 500ms)
"""

import sys
import os
import json
import time
import queue
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)
        sys.stderr.reconfigure(encoding="utf-8", line_buffering=True)
    except Exception:
        pass

PORT = int(os.environ.get("CAMOUFOX_DAEMON_PORT", 5055))
DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
SESSION_FILE = os.path.join(DATA_DIR, "session.json")
TOKEN_FILE = os.path.join(DATA_DIR, "latest_turnstile_token.json")
NODE_SERVER_URL = os.environ.get("RAILSEAT_SERVER_URL", "http://localhost:3000")

# Thread-safe request queue to bridge HTTP server thread with Camoufox main thread
request_queue = queue.Queue()

# Global daemon state
daemon_state = {
    "ready": False,
    "started_at": time.time(),
    "last_token": None,
    "token_timestamp": 0,
    "last_check_time": 0,
    "request_count": 0,
    "success_count": 0
}

def load_session():
    if os.path.exists(SESSION_FILE):
        try:
            with open(SESSION_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return None

class DaemonHTTPHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Suppress routine access logs for clean console
        if "/health" in (args[0] if args else ""):
            return
        super().log_message(format, *args)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        if path in ["/health", "/status"]:
            now = time.time()
            token_age = int(now - daemon_state["token_timestamp"]) if daemon_state["token_timestamp"] else None
            res = {
                "status": "ready" if daemon_state["ready"] else "initializing",
                "ready": daemon_state["ready"],
                "uptime_seconds": int(now - daemon_state["started_at"]),
                "has_token": bool(daemon_state["last_token"]),
                "token_age_seconds": token_age,
                "requests_served": daemon_state["request_count"],
                "success_count": daemon_state["success_count"]
            }
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(res).encode("utf-8"))
            return

        elif path == "/token":
            now = time.time()
            token_age = int(now - daemon_state["token_timestamp"]) if daemon_state["token_timestamp"] else None
            res = {
                "token": daemon_state["last_token"],
                "age_seconds": token_age,
                "ready": daemon_state["ready"]
            }
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(res).encode("utf-8"))
            return

        elif path == "/get-layout":
            if not daemon_state["ready"]:
                self.send_response(503)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Daemon browser still initializing"}).encode("utf-8"))
                return

            trip_id = query.get("trip_id", [""])[0]
            trip_route_id = query.get("trip_route_id", [""])[0]

            if not trip_id or not trip_route_id:
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": "trip_id and trip_route_id are required"}).encode("utf-8"))
                return

            # Dispatch task to Camoufox main thread via Queue
            daemon_state["request_count"] += 1
            task = {
                "type": "fetch_layout",
                "trip_id": trip_id,
                "trip_route_id": trip_route_id,
                "event": threading.Event(),
                "result": None,
                "error": None
            }
            request_queue.put(task)

            # Wait for execution on warm browser page (typically 200ms - 800ms)
            finished = task["event"].wait(timeout=12.0)
            if not finished:
                self.send_response(504)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Request timed out waiting for warm browser"}).encode("utf-8"))
                return

            if task["result"]:
                daemon_state["success_count"] += 1
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(task["result"]).encode("utf-8"))
            else:
                self.send_response(502)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": task["error"] or "Failed to grab live layout"}).encode("utf-8"))
            return

        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/refresh-token":
            task = {
                "type": "refresh_token",
                "event": threading.Event(),
                "result": None
            }
            request_queue.put(task)
            task["event"].wait(timeout=10.0)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "refreshed", "token": daemon_state["last_token"]}).encode("utf-8"))
            return

        self.do_GET()

def start_http_server(port):
    server = HTTPServer(("127.0.0.1", port), DaemonHTTPHandler)
    print(f"[CamoufoxDaemon] 🚀 In-memory HTTP microservice listening at http://127.0.0.1:{port}")
    server.serve_forever()

def evaluate_turnstile_in_page(page):
    """Checks page for resolved Cloudflare Turnstile token"""
    return page.evaluate("""
        () => {
            const selectors = [
                '[name="cf-turnstile-response"]',
                'input[name="cf-turnstile-response"]',
                'textarea[name="cf-turnstile-response"]',
                '[name="cft_response"]',
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

def sync_token_to_server(token):
    try:
        import requests
        requests.post(
            f"{NODE_SERVER_URL}/api/auth/set-token",
            json={"cft_response": token},
            timeout=3
        )
    except Exception:
        pass

def main():
    from camoufox.sync_api import Camoufox

    print("====================================================")
    print("🦊 Starting Pre-warmed Persistent Camoufox Daemon")
    print(f"📡 Port: {PORT} | Node Server: {NODE_SERVER_URL}")
    print("====================================================")

    session = load_session()
    tok = session.get("token", "") if session else ""
    dev_id = session.get("deviceId", "34a817c48b87571632d2a7a1d50575a4") if session else "34a817c48b87571632d2a7a1d50575a4"
    dev_key = session.get("deviceKey", "") if session else ""
    user_json = json.dumps(session.get("user", {}) if session else {})

    target_url = "https://eticket.railway.gov.bd/booking/train/search?fromcity=Dhaka&tocity=Chattogram&doj=19-Oct-2026&class=S_CHAIR"

    # Start HTTP server thread
    http_thread = threading.Thread(target=start_http_server, args=(PORT,), daemon=True)
    http_thread.start()

    with Camoufox(headless=True, humanize=False) as browser:
        page = browser.new_page()

        # Inject session auth
        page.add_init_script(f"""
            try {{
                sessionStorage.setItem('disclaimer_agreed_for_home', '1');
                localStorage.setItem('disclaimer_agreed_for_home', '1');
                if ('{tok}') {{
                    localStorage.setItem('token', '{tok}');
                    localStorage.setItem('user', JSON.stringify({user_json}));
                    localStorage.setItem('uudid', '{dev_id}');
                    localStorage.setItem('ssdk', '{dev_key}');
                }}
            }} catch(e) {{}}
        """)

        # Block fonts and media for fast execution and minimal RAM
        page.route("**/*", lambda route: route.abort() if route.request.resource_type in ["image", "media", "font"] else route.continue_())

        print(f"[CamoufoxDaemon] Pre-warming browser page: {target_url}...")
        try:
            page.goto(target_url, wait_until="commit", timeout=25000)
        except Exception as e:
            print(f"[CamoufoxDaemon] Initial navigation warning: {e}")

        # Wait for initial Turnstile resolution
        print("[CamoufoxDaemon] Solving initial Turnstile challenge...")
        initial_wait = time.time()
        while time.time() - initial_wait < 15:
            tok_found = evaluate_turnstile_in_page(page)
            if tok_found:
                daemon_state["last_token"] = tok_found
                daemon_state["token_timestamp"] = time.time()
                try:
                    with open(TOKEN_FILE, "w", encoding="utf-8") as f:
                        json.dump({"token": tok_found, "timestamp": int(time.time() * 1000), "source": "camoufox_daemon"}, f, indent=2)
                except Exception:
                    pass
                sync_token_to_server(tok_found)
                print(f"[CamoufoxDaemon] ✅ Initial Turnstile token captured! ({tok_found[:16]}...)")
                break
            time.sleep(0.3)

        daemon_state["ready"] = True
        print("[CamoufoxDaemon] 🟢 Pre-warmed Camoufox Daemon is 100% READY for fast queries!")

        last_token_refresh = time.time()

        # Main Daemon Event Loop
        while True:
            # 1. Check for incoming requests
            task = None
            try:
                task = request_queue.get(timeout=0.15)
            except queue.Empty:
                task = None

            if task:
                task_type = task.get("type")
                if task_type == "fetch_layout":
                    trip_id = task["trip_id"]
                    trip_route_id = task["trip_route_id"]
                    cft = daemon_state["last_token"] or ""
                    
                    t_start = time.time()
                    print(f"[CamoufoxDaemon] ⚡ Serving instant layout for trip_id={trip_id} (CFT: {cft[:10]}...)...")

                    try:
                        # Direct in-page fetch using existing warm browser session
                        api_res = page.evaluate("""
                            async ({ tripId, tripRouteId, cft }) => {
                                try {
                                    const token = localStorage.getItem('token');
                                    const uudid = localStorage.getItem('uudid') || '';
                                    const ssdk = localStorage.getItem('ssdk') || '';
                                    let url = `https://railspaapi.shohoz.com/v1.0/web/bookings/seat-layout?trip_id=${encodeURIComponent(tripId)}&trip_route_id=${encodeURIComponent(tripRouteId)}`;
                                    if (cft) url += `&cft_response=${encodeURIComponent(cft)}`;
                                    
                                    const res = await fetch(url, {
                                        headers: {
                                            'Accept': 'application/json',
                                            'Authorization': `Bearer ${token}`,
                                            'X-Device-Id': uudid,
                                            'X-Device-Key': ssdk,
                                            'X-Requested-With': 'XMLHttpRequest'
                                        }
                                    });
                                    const data = await res.json();
                                    return { status: res.status, ok: res.ok, data: data };
                                } catch(e) {
                                    return { status: 0, error: e.message };
                                }
                            }
                        """, {"tripId": trip_id, "tripRouteId": trip_route_id, "cft": cft})

                        dur = int((time.time() - t_start) * 1000)
                        if api_res and api_res.get("ok") and (api_res.get("data", {}).get("data") or api_res.get("data", {}).get("coaches")):
                            print(f"[CamoufoxDaemon] 🎯 Live layout delivered in {dur}ms!")
                            task["result"] = api_res.get("data")
                        else:
                            err_msg = api_res.get("data", {}).get("message") if api_res else "No data"
                            status_code = api_res.get("status") if api_res else 0
                            print(f"[CamoufoxDaemon] Fetch returned status={status_code}, error={err_msg} in {dur}ms")
                            task["error"] = f"Shohoz status {status_code}: {err_msg}"
                    except Exception as ex:
                        print(f"[CamoufoxDaemon] Evaluate error: {ex}")
                        task["error"] = str(ex)

                    task["event"].set()

                elif task_type == "refresh_token":
                    try:
                        page.evaluate("() => { if (window.turnstile && typeof window.turnstile.reset === 'function') window.turnstile.reset(); }")
                        time.sleep(1.0)
                        tok = evaluate_turnstile_in_page(page)
                        if tok:
                            daemon_state["last_token"] = tok
                            daemon_state["token_timestamp"] = time.time()
                    except Exception:
                        pass
                    task["event"].set()

                continue

            # 2. Idle background maintenance: keep Turnstile token fresh (< 75 seconds old)
            now = time.time()
            token_age = now - daemon_state["token_timestamp"]
            if token_age > 70 or not daemon_state["last_token"]:
                fresh_tok = evaluate_turnstile_in_page(page)
                if fresh_tok and fresh_tok != daemon_state["last_token"]:
                    daemon_state["last_token"] = fresh_tok
                    daemon_state["token_timestamp"] = now
                    sync_token_to_server(fresh_tok)
                    print(f"[CamoufoxDaemon] 🔄 Captured freshly rotated Turnstile token: {fresh_tok[:14]}...")
                elif token_age > 85:
                    # Token is getting stale, reset Turnstile widget to trigger challenge solve
                    print("[CamoufoxDaemon] ⏳ Rotating Turnstile widget to maintain hot cache...")
                    try:
                        page.evaluate("() => { if (window.turnstile && typeof window.turnstile.reset === 'function') window.turnstile.reset(); }")
                        time.sleep(0.5)
                        new_t = evaluate_turnstile_in_page(page)
                        if new_t:
                            daemon_state["last_token"] = new_t
                            daemon_state["token_timestamp"] = time.time()
                            sync_token_to_server(new_t)
                    except Exception as e:
                        pass

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[CamoufoxDaemon] Shutting down gracefully...")
        sys.exit(0)
