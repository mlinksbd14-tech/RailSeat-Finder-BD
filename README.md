# 🚆 Bangladesh Railway (Shohoz) Train Seat Availability Dashboard

A real-time, responsive JavaScript dashboard for checking and monitoring Bangladesh Railway train seat availability, schedules, fares, and class-wise seat distributions powered by the Shohoz API gateway.

![Dashboard Preview](https://img.shields.io/badge/Status-Active-emerald?style=for-the-badge)
![Node Version](https://img.shields.io/badge/Node.js-18%2B-blue?style=for-the-badge)
![License](https://img.shields.io/badge/License-MIT-purple?style=for-the-badge)

---

## 🌟 Key Features

1. **Anti-Bot & Anti-Rate Limiting Proxy**:
   - Rotates realistic modern browser `User-Agent` and `Sec-CH-UA` headers.
   - Built-in **20-second in-memory response cache (TTL)** to avoid triggering `429 Too Many Requests` or IP rate limits.
   - Automatic request throttling & queue spacing to emulate natural human browsing.

2. **100% Live Shohoz API Connectivity (Fixing HTTP 401)**:
   - **Direct Sign-In**: Enter Bangladesh Railway mobile number & password to automatically retrieve and store an active session token.
   - **Bearer Token Support**: Paste a Bearer token copied from `eticket.railway.gov.bd` local storage (`token`).
   - Seamless switching between Live Gateway and Offline Emulation mode.

2. **Live Train & Seat Matrix Breakdown**:
   - View seats available for every class:
     - **S_CHAIR** (Shovon Chair)
     - **SNIGDHA** (Snigdha AC)
     - **AC_S** (AC Seat)
     - **AC_B** (AC Berth)
     - **SHOVON** (Shovon)
     - **F_BERTH / F_SEAT / F_CHAIR** (First Class)
   - Visual badges: 🟢 **Available (>10 seats)** | 🟡 **Few Seats (1-10 seats)** | 🔴 **Sold Out (0 seats)**.
   - Fare in Bangladeshi Taka (৳) including VAT.

3. **Interactive Station Search & Autocomplete**:
   - Complete database of Bangladesh Railway stations with English & Bengali name search and station code detection.
   - One-click Station Swap (⇄) and popular route shortcuts (Dhaka ⇄ Chattogram, Dhaka ⇄ Sylhet, Dhaka ⇄ Cox's Bazar, Dhaka ⇄ Rajshahi).

4. **Live Seat Drop Tracker & Auto-Refresh**:
   - Configurable auto-polling interval (`15s`, `30s`, `60s`, `Off`).
   - Web Audio API notification chime when newly released seats are detected.

5. **Modern UI / UX**:
   - Dark mode / Light mode with persistence.
   - Grid Card Matrix View & Compact Tabular Matrix View.
   - 10-day advance booking window limiter with quick day selection chips.

---

## 🚀 Getting Started

### Option A: One-Click Auto-Start (Recommended)
- **Windows**: Double-click [`start.bat`](file:///d:/TV/Rail/start.bat) (or run `./start.ps1` in PowerShell).
- **Mac / Linux / Git Bash**: Run `./start.sh`.

> *This will automatically verify Node.js, install any missing dependencies, start the server, and open `http://localhost:3000` in your default browser.*

---

### Option B: Manual Command Line
```bash
# 1. Install Dependencies
npm install

# 2. Start the Server
npm start
```
Or for auto-reloading development:
```bash
npm run dev
```

### 3. Open the Dashboard
Navigate to:
```
http://localhost:3000
```

---

## 📡 API Endpoints

### `GET /api/stations`
Returns the list of all Bangladesh Railway stations.

### `GET /api/search?from_city=Dhaka&to_city=Chattogram&date_of_journey=2026-08-28`
Queries available trains and returns transformed seat matrix items.
- Parameters:
  - `from_city` *(required)*: Departure station (e.g. `Dhaka`)
  - `to_city` *(required)*: Arrival station (e.g. `Chattogram`)
  - `date_of_journey` *(required)*: Date in `YYYY-MM-DD` or `DD-MMM-YYYY` format
  - `force_mock` *(optional)*: `true` to test UI with simulated data

### `GET /api/health`
Returns proxy health status, station count, and active cache size.

---

## 📁 Project Structure

```
Rail/
├── data/
│   └── stations.json         # Bangladesh Railway stations database
├── public/
│   ├── css/
│   │   └── style.css         # Custom matrix styles and animations
│   ├── js/
│   │   └── app.js            # Frontend logic, autocomplete, audio chime & polling
│   └── index.html            # Main dashboard user interface
├── .env.example              # Example environment variables
├── package.json              # Project dependencies & scripts
├── README.md                 # Documentation
└── server.js                 # Anti-bot proxy server & Shohoz API bridge
```

---

## ⚖️ Disclaimer
This project is an unofficial tool created for informational and educational purposes. Bangladesh Railway and Shohoz are trademarks of their respective owners.
