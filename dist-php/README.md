# 🚆 RailSeat BD — Shared Hosting (PHP & HTML) Deployment Guide

This package provides a standalone, zero-Node.js PHP & HTML build of **RailSeat Finder BD** designed for shared web hosting (e.g. cPanel, Hostinger, Namecheap, Bluehost, DirectAdmin, etc.).

---

## ⚡ Option 1: Direct cPanel / Shared Hosting Upload (Instant Live)

1. Open your hosting control panel (**cPanel File Manager** or FTP).
2. Navigate to your website root directory (usually `public_html/` or your subdomain folder).
3. Upload and extract the `railseat-bd-shared-hosting.zip` file directly into `public_html/`.
4. Ensure folder permissions:
   - `data/` and `data/cache/` must be writable (**0755** or **0777**).
5. Open your domain in your web browser:
   - **`https://yourdomain.com/`** &rarr; Your full live RailSeat BD dashboard is immediately visible!

---

## 🔄 Option 2: Automatic GitHub Repo Connection (Live Auto-Updates)

You can link your live shared hosting to automatically pull updates from GitHub in two ways:

### Method A: cPanel "Git™ Version Control" (Recommended)
1. In cPanel, search for **Git™ Version Control**.
2. Click **Create** and enter:
   - **Clone URL**: `https://github.com/mlinksbd14-tech/RailSeat-Finder-BD.git`
   - **Repository Path**: `public_html` (or your chosen subfolder)
   - **Branch**: `main`
3. Whenever you push to GitHub, click **Update from Remote** or set up a Webhook.

### Method B: 1-Click Webhook URL Sync
We included an automated sync endpoint:
- **Webhook URL**: `https://yourdomain.com/api/github-sync`
- In your GitHub Repository &rarr; **Settings** &rarr; **Webhooks** &rarr; **Add Webhook**:
  - **Payload URL**: `https://yourdomain.com/api/github-sync`
  - **Content type**: `application/json`
  - **Events**: `Just the push event`
- Whenever a commit is pushed to `main`, your shared hosting dashboard will automatically sync the newest code.

---

## 🚀 Live Features Included in this PHP Build
- ✅ **100% Live Bangladesh Railway Gateway**: Real-time train schedules, vacant seat counts, and fares via `api/search.php`.
- ✅ **Bilingual বাংলা & English Support**: Dynamic language toggle (`🇧🇩 বাংলা / 🇬🇧 EN`) with full Bengali numerals (`৳৪৫০`) and translations.
- ✅ **Mobile App Ready UI**: Cards View with boarding-pass ribbons, mobile table list cards, and in-app push banners.
- ✅ **Connect Live API**: 1-Click PC console and mobile bookmarklet token synchronization.
- ✅ **10-Day Availability Calendar Matrix**: Multi-date batch search queries.
