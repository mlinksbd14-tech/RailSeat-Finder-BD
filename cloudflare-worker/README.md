# Shohoz Bangladesh Railway Mobile API Gateway (Cloudflare Worker)

This Cloudflare Worker allows your dashboard to authenticate passengers and fetch live seat layouts using Bangladesh Railway's official **Mobile App API endpoints (`/v1.0/app/`)**.

### Why use Mobile App Endpoints?
- **NO Turnstile / CAPTCHA Required:** Native mobile apps do not execute web Turnstile widgets.
- **Fast & Lightweight:** Runs entirely on Cloudflare edge servers with 0ms spin-up.
- **Full CORS Support:** Ready to be queried directly from your dashboard frontend or server backend.

---

## Method 1: Deploy in 60 seconds via Cloudflare Dashboard (Free, No Install)

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. In the left sidebar, click **Compute (Workers & Pages)** > **Workers & Pages**.
3. Click **Create** > **Create Worker**.
4. Give it a name (e.g., `shohoz-mobile-gateway`) and click **Deploy**.
5. Once deployed, click **Edit code**.
6. Replace the sample code with the entire content of [`worker.js`](worker.js).
7. Click **Deploy** in the top right corner.
8. Your worker URL will look like: `https://shohoz-mobile-gateway.<your-subdomain>.workers.dev`.

---

## Method 2: Deploy using Wrangler CLI

From this directory (`cloudflare-worker`):
```bash
npm install -g wrangler
npx wrangler login
npx wrangler deploy
```

---

## Available API Endpoints

### 1. Direct Mobile Login (No Turnstile required)
* **Method:** `POST /api/login`
* **Request Body (JSON):**
  ```json
  {
    "mobile_number": "017XXXXXXXX",
    "password": "yourPasswordHere"
  }
  ```
* **Success Response:**
  ```json
  {
    "success": true,
    "message": "Signed in successfully via Shohoz Mobile App API!",
    "token": "eyJhbGciOi...",
    "device_id": "...",
    "device_key": "...",
    "user": { ... },
    "source": "railway_mobile_app_cf_worker"
  }
  ```

---

### 2. Live Seat Layout & Vacant Seats
* **Method:** `GET /api/seat-layout?trip_id=...&trip_route_id=...`
* **Headers (Optional if guest/public, recommended with token):**
  * `Authorization: Bearer <token>`
* **Success Response:**
  ```json
  {
    "success": true,
    "status_source": "official_railway_mobile_app",
    "data": { ... }
  }
  ```

---

### 3. Train Search
* **Method:** `GET /api/search?from_city=Dhaka&to_city=Chittagong&date_of_journey=05-Oct-2026&seat_class=S_CHAIR`
