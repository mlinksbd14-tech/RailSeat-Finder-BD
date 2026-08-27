# 🚆 RailSeat Finder BD — User Manual & Guide

Welcome to **RailSeat Finder BD**, your real-time Bangladesh Railway train seat availability finder, auto-monitor, and instant booking assistant. 

This guide explains how to use all the dashboard features, customize your notification alerts, track seat releases, and set up mobile Telegram alarms.

---

## 📑 Table of Contents
1. [Getting Started & Sign In](#1-getting-started--sign-in)
2. [Finding Train Seat Availability](#2-finding-train-seat-availability)
3. [Exploring Different View Modes](#3-exploring-different-view-modes)
4. [Live Auto-Monitoring & Countdown Ticker](#4-live-auto-monitoring--countdown-ticker)
5. [Seat Alerts & Audio Notifications](#5-seat-alerts--audio-notifications)
6. [Active Seat Watchlist Radar & Telegram Alerts](#6-active-seat-watchlist-radar--telegram-alerts)
7. [Sharing & Exporting Availability](#7-sharing--exporting-availability)
8. [Appearance, Sound Previews & Settings](#8-appearance-sound-previews--settings)
9. [Frequently Asked Questions (FAQ)](#9-frequently-asked-questions-faq)

---

## 1. Getting Started & Sign In

### Accessing the Dashboard
- **Public / Protected Mode**: When you open the dashboard, you can immediately begin searching for trains or sign in to your personal account.
- **1-Click Google Sign-In**: Click **Sign In** in the top-right corner and select **"Continue with Google"** for fast, 1-click access.
- **Username / Email Sign-In**: You can also sign in with your registered username/email and password.
- **Creating a New Account**: Click **"Create Account"** in the Sign-In window, enter your name, email, and password. You will receive an email verification link in your inbox. Click the link to verify your email.

---

## 2. Finding Train Seat Availability

### Searching a Route
1. **From Station**: Type your origin station name (e.g., `Dhaka`). Fast autocomplete suggestions will appear as you type.
2. **Swap Button (`⇄`)**: Click the swap icon to instantly reverse your origin and destination stations.
3. **Destination Station**: Type your destination (e.g., `Chattogram` or `Cox's Bazar`).
4. **Date of Journey**: Select your travel date from the date picker (up to 10 days in advance).
5. **Quick Date Shortcuts**: Click on any of the quick chips (e.g., `Today`, `Tomorrow`, `Friday`) below the search form to quickly pick a date in one click.
6. **Popular Route Shortcuts**: Click on any popular route strip (e.g., `Dhaka ➔ Cox's Bazar`, `Dhaka ➔ Sylhet`, `Dhaka ➔ Rajshahi`) for instant pre-filled searches.
7. Click **"Find Trains"**.

### Dynamic Filters
- **Train (Optional)**: Filter results to show only a single specific train (e.g., *Suborno Express*, *Parabat Express*). When selected, dynamic badges show the **Total Running Trains** and **Total Available Seats** specifically for that train.
- **Class Filter**: Select a specific class (e.g., `Snigdha AC`, `Shovon Chair`, `AC Berth`) or choose `All Classes` to see the full seat matrix.

---

## 3. Exploring Different View Modes

The dashboard provides multiple layout modes depending on your preference:

### 🎴 Train Cards View (Default)
- Shows each train with full schedule details: **Train Name**, **Train Model Number**, **Departure & Arrival Times**, and **Total Travel Duration**.
- Displays every seat class with distinct color-coded badges for:
  - **Online Available Seats**
  - **Counter Seats**
  - **Fare per Ticket**
- Click **"Book"** to go directly to Bangladesh Railway's official booking checkout page with the route and seat class pre-selected!

### 📊 Comparative Table View
- A high-density table comparing all running trains side-by-side with columns for Train Name, Schedule, and Class-by-Class availability.

### 📅 10-Day Availability Matrix
- Click the **"10-Day Matrix"** button to inspect seat availability across all 10 upcoming days simultaneously in a single color-coded heatmap.

### 🗺️ Stoppage & Route Schedule Modal
- Click **"View Route / Stops"** on any train card to open its complete station-by-station stoppage schedule, arrival/departure timings, and intermediate stoppage durations.

---

## 4. Live Auto-Monitoring & Countdown Ticker

When you want to keep an eye on a busy route where seats are frequently booked and cancelled:
1. In the **Tracker Bar** at the top of the search results, open the **Monitor** dropdown.
2. Choose your preferred refresh interval:
   - `Monitor: 15s` (Fast tracking)
   - `Monitor: 30s` (Balanced monitoring - Recommended)
   - `Monitor: 60s` (Relaxed monitoring)
   - `Monitor: Off` (Manual refresh only)
3. **Live Countdown Ticker**: A live countdown bar displays the seconds remaining before the next auto-refresh.
4. **Pause / Resume (`⏸` / `▶`)**: Click the pause button to temporarily freeze auto-refresh without resetting your search parameters.

---

## 5. Seat Alerts & Audio Notifications

RailSeat Finder BD features distinct visual banners, audio alerts, and toasts tailored to the urgency of each seat change:

| Alert Type | Sound Tone | Visual Display | When It Triggers |
| :--- | :--- | :--- | :--- |
| 🟢 **Normal Available Seat** | 🎵 Gentle Melodious Railway Bell (D5 $\rightarrow$ A5) | Emerald badge & green toast | When seats are initially found or regular seat counts increase. |
| 🚨 **Sold Out ➔ Released Seat** | ⚡ Rapid Ascending High-Energy Burst | Glowing fiery banner & urgent toast | When a train/class was completely **0 / SOLD OUT** and seats are suddenly cancelled/released! |
| 🎯 **Watchlist Radar Hit** | 📡 Sonar / Radar Sweep Ping | Gold/Amber glowing toast & OS push notification | When a train matches your custom watched criteria and minimum seat threshold. |

### 🔔 Top Notification Center (Bell Icon)
- Click the **Bell Icon** in the top navigation bar to view your complete categorized history of alerts.
- Filter by unread notifications, preview released seat counts, and click **Book** directly from any historical alert.

---

## 6. Active Seat Watchlist Radar & Telegram Alerts

The **Watchlist Radar** allows you to target specific trains and receive instant alerts on your mobile phone via Telegram even when your browser is closed.

### Setting a Watch Target
1. Search your desired route.
2. On any train card, click the **"Watch" (`🎯`)** button.
3. Choose your preferred seat class (e.g., `Snigdha AC` or `Any Class`) and the **Minimum Seats Threshold** (e.g., `≥ 1 Seat`, `≥ 2 Seats`, `≥ 4 Seats`).
4. Click **"Save Target"**.

### Connecting Telegram for Instant Mobile Phone Alerts
1. Open the **Watchlist Radar** window.
2. Under **Telegram Alerts Setup**:
   - Open Telegram and search for the bot **`@RailSeatAlertBot`**.
   - Send `/start` to the bot to receive your personal **Chat ID**.
   - Enter your Chat ID in the field and click **"Connect"**.
3. You will receive real-time, beautifully formatted Telegram messages the instant seats drop!

---

## 7. Sharing & Exporting Availability

- **WhatsApp 1-Click Share**: Click the **Share** button on the tracker bar and choose **WhatsApp** to share clean, formatted availability text directly to friends or family.
- **Copy Summary**: Click **"Copy Summary"** to copy a concise text table of all available trains and seats to your clipboard.

---

## 8. Appearance, Sound Previews & Settings

Click **⚙️ Settings** in the top navigation bar to customize your dashboard:
- **Dark / Light Theme**: Switch between dark mode and light mode.
- **Sound Alerts Toggle**: Enable or disable audio chimes.
- **Sound Preview Buttons**:
  - `🔔 Normal Seat`: Previews the gentle melodious railway bell.
  - `⚡ Sold Out ➔ Released`: Previews the rapid high-priority alert.
  - `🎯 Radar Alarm`: Previews the sonar sweep radar ping.

---

## 9. Frequently Asked Questions (FAQ)

**Q: How often does the seat availability update?**  
A: When auto-monitor is enabled, the dashboard scans live seat availability according to your selected interval (15s, 30s, or 60s).

**Q: Can I book tickets directly through this dashboard?**  
A: Clicking the **"Book"** button directs you straight to Bangladesh Railway's official booking portal (`eticket.railway.gov.bd`) with your train, route, and seat class pre-selected for maximum checkout speed.

**Q: Will I get Telegram alerts if I close my laptop or browser?**  
A: Yes! Once you add targets to your **Active Seat Watchlist Radar** and link your Telegram Chat ID, alerts are automatically dispatched directly to your Telegram app.

---

*RailSeat Finder BD — Fast, Reliable Bangladesh Railway Seat Availability Tracking.*
