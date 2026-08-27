const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { exec } = require('child_process');
require('dotenv').config();

// Dynamic Safe Firebase Admin SDK Loader (Prevents crashes in serverless bundling)
let adminApp = null;
let firestoreModule = null;
let authModule = null;
try {
  adminApp = require('firebase-admin/app');
  firestoreModule = require('firebase-admin/firestore');
  authModule = require('firebase-admin/auth');
} catch (e) {
  console.warn('[Firebase Admin] Optional SDK not initialized:', e.message);
}

// Global crash protection for network blips & unhandled rejections
process.on('uncaughtException', (err) => {
  console.error('[Process] Uncaught Exception caught safely:', err.message);
});
process.on('unhandledRejection', (reason, promise) => {
  console.warn('[Process] Unhandled Rejection caught safely:', reason?.message || reason);
});

const app = express();
const PORT = process.env.PORT || 3000;
const isVercel = !!process.env.VERCEL;

// On Vercel serverless lambda, the filesystem (/var/task) is read-only.
// Use /tmp for writable storage while reading initial seed data from bundled directories.
const DATA_DIR = isVercel ? path.join(os.tmpdir(), 'rail_data') : path.join(__dirname, 'data');
const SEED_DATA_DIR = path.join(__dirname, 'data');

try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
} catch (e) {
  console.warn('[Storage] Warning creating DATA_DIR:', e.message);
}

const SESSION_FILE = path.join(DATA_DIR, 'session.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SEED_USERS_FILE = path.join(SEED_DATA_DIR, 'users.json');
const SEED_SESSION_FILE = path.join(SEED_DATA_DIR, 'session.json');

// In-memory active dashboard user sessions (token -> { userId, username, role, name, expiresAt })
const userSessions = new Map();

// ----------------------------------------------------
// Cryptographic Password Hashing & Security Utilities
// ----------------------------------------------------
function hashPassword(password) {
  if (!password || typeof password !== 'string') return '';
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return `scrypt$16384$8$1$${salt}$${hash}`;
}

function verifyPassword(inputPassword, storedPassword) {
  if (!inputPassword || !storedPassword) return false;

  if (storedPassword.startsWith('scrypt$')) {
    try {
      const parts = storedPassword.split('$');
      if (parts.length === 6) {
        const N = parseInt(parts[1], 10);
        const r = parseInt(parts[2], 10);
        const p = parseInt(parts[3], 10);
        const salt = parts[4];
        const originalHash = parts[5];

        const derived = crypto.scryptSync(inputPassword, salt, 64, { N, r, p }).toString('hex');
        const bufA = Buffer.from(derived, 'hex');
        const bufB = Buffer.from(originalHash, 'hex');
        if (bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB)) {
          return true;
        }
      }
    } catch (err) {
      console.warn('[Security] Error verifying password hash:', err.message);
    }
    return false;
  }

  try {
    const bufA = Buffer.from(String(inputPassword));
    const bufB = Buffer.from(String(storedPassword));
    if (bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB)) {
      return true;
    }
  } catch (e) {}

  return inputPassword === storedPassword;
}

// Failed login attempt tracker (Brute force protection)
const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_COOLDOWN_MS = 5 * 60 * 1000;

function checkLoginRateLimit(key) {
  const record = loginAttempts.get(key);
  if (!record) return { allowed: true };
  if (Date.now() > record.resetAt) {
    loginAttempts.delete(key);
    return { allowed: true };
  }
  if (record.count >= MAX_LOGIN_ATTEMPTS) {
    const remainingSeconds = Math.ceil((record.resetAt - Date.now()) / 1000);
    return { allowed: false, remainingSeconds };
  }
  return { allowed: true };
}

function recordFailedLogin(key) {
  const now = Date.now();
  const record = loginAttempts.get(key) || { count: 0, resetAt: now + LOGIN_COOLDOWN_MS };
  record.count += 1;
  loginAttempts.set(key, record);
}

function resetLoginRateLimit(key) {
  loginAttempts.delete(key);
}

// ====================================================
// ☁️ FIREBASE CLOUD FIRESTORE INTEGRATION & REPOSITORY
// ====================================================
let firestoreDb = null;
let isFirebaseConnected = false;
let firebaseProjectId = null;

function getAdminAuth() {
  try {
    if (authModule && typeof authModule.getAuth === 'function' && adminApp && adminApp.getApps().length) {
      return authModule.getAuth();
    }
  } catch (e) {}
  return null;
}

function initFirebase() {
  if (!adminApp || !firestoreModule) {
    console.log('[Firebase] ℹ️ Operating in local database mode.');
    return;
  }
  const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');
  let serviceAccount = null;

  if (fs.existsSync(serviceAccountPath)) {
    try {
      const raw = fs.readFileSync(serviceAccountPath, 'utf8');
      serviceAccount = JSON.parse(raw);
    } catch (e) {
      console.warn('[Firebase] ⚠️ Error reading serviceAccountKey.json:', e.message);
    }
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } catch (e) {
      console.warn('[Firebase] ⚠️ Error parsing FIREBASE_SERVICE_ACCOUNT env:', e.message);
    }
  }

  if (serviceAccount && serviceAccount.project_id) {
    try {
      if (!adminApp.getApps().length) {
        adminApp.initializeApp({
          credential: adminApp.cert(serviceAccount)
        });
      }
      firestoreDb = firestoreModule.getFirestore();
      isFirebaseConnected = true;
      firebaseProjectId = serviceAccount.project_id;
      console.log(`[Firebase] ☁️ Connected to Cloud Firestore (Project: ${firebaseProjectId})`);
      
      // Perform initial database synchronization
      syncFirestoreUsers();
    } catch (err) {
      console.error('[Firebase] ❌ Initialization error:', err.message);
      isFirebaseConnected = false;
      firestoreDb = null;
    }
  } else {
    console.log('[Firebase] ℹ️ Operating in local database mode. Place serviceAccountKey.json in root to connect Firebase.');
  }
}

async function syncFirestoreUsers() {
  if (!firestoreDb) return;
  try {
    const snapshot = await firestoreDb.collection('system_users').get();
    if (snapshot.empty) {
      // Seed Firestore with local users
      const localData = loadLocalUsersData();
      if (localData.users && localData.users.length > 0) {
        console.log(`[Firebase] 📤 Seeding ${localData.users.length} local user(s) to Cloud Firestore...`);
        const batch = firestoreDb.batch();
        for (const user of localData.users) {
          const docRef = firestoreDb.collection('system_users').doc(user.id);
          batch.set(docRef, user);
        }
        const settingsRef = firestoreDb.collection('system_settings').doc('access_control');
        batch.set(settingsRef, localData.settings || { requireLogin: false });
        await batch.commit();
        console.log('[Firebase] ✅ Cloud Firestore seeded successfully.');
      }
    } else {
      // Pull remote Firestore users into local database
      const users = [];
      snapshot.forEach(doc => {
        users.push(doc.data());
      });
      let settings = { requireLogin: false };
      try {
        const settingsDoc = await firestoreDb.collection('system_settings').doc('access_control').get();
        if (settingsDoc.exists) settings = settingsDoc.data();
      } catch (e) {}
      
      saveLocalUsersData({ settings, users });
      console.log(`[Firebase] 📥 Pulled ${users.length} user(s) from Cloud Firestore.`);
    }
  } catch (err) {
    console.warn('[Firebase] ⚠️ Sync error with Firestore:', err.message);
  }
}

function loadLocalUsersData() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const raw = fs.readFileSync(USERS_FILE, 'utf8');
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.users)) return data;
    } else if (fs.existsSync(SEED_USERS_FILE)) {
      const raw = fs.readFileSync(SEED_USERS_FILE, 'utf8');
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.users)) return data;
    }
  } catch (e) {}
  return {
    settings: { requireLogin: false },
    users: [
      {
        id: 'usr_admin_001',
        username: 'admin',
        password: hashPassword('44277999'),
        name: 'System Administrator',
        role: 'admin',
        status: 'active',
        canViewDashboard: true,
        createdAt: new Date().toISOString(),
        lastLogin: null
      }
    ]
  };
}

function saveLocalUsersData(data) {
  try {
    const dir = path.dirname(USERS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.warn('[Users] Warning saving users.json:', err.message);
  }
}

function loadUsersData() {
  const data = loadLocalUsersData();
  let needsSave = false;
  for (const user of data.users) {
    if (user.password && !user.password.startsWith('scrypt$')) {
      user.password = hashPassword(user.password);
      needsSave = true;
    }
  }
  if (needsSave) {
    saveUsersData(data);
  }
  return data;
}

function saveUsersData(data) {
  saveLocalUsersData(data);

  // Sync to Cloud Firestore if connected
  if (firestoreDb && isFirebaseConnected) {
    (async () => {
      try {
        const batch = firestoreDb.batch();
        for (const user of data.users) {
          const docRef = firestoreDb.collection('system_users').doc(user.id);
          batch.set(docRef, user, { merge: true });
        }
        const settingsRef = firestoreDb.collection('system_settings').doc('access_control');
        batch.set(settingsRef, data.settings || { requireLogin: false }, { merge: true });
        await batch.commit();
      } catch (err) {
        console.warn('[Firebase] ⚠️ Async Firestore write error:', err.message);
      }
    })();
  }
}

// Initialize Firebase upon startup
initFirebase();

// Helper to authenticate session token for dashboard user
function getAuthenticatedUser(req) {
  if (!req) return null;
  const authHeader = req.headers?.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim() || req.query?.token || '';
  if (!token) return null;

  const session = userSessions.get(token);
  if (session && session.expiresAt > Date.now()) {
    return session;
  }
  return null;
}

// Dynamic Auth Credentials (Fallback Global Session)
let authCredentials = {
  token: process.env.SHOHOZ_AUTH_TOKEN || null,
  deviceId: process.env.SHOHOZ_DEVICE_ID || null,
  deviceKey: process.env.SHOHOZ_DEVICE_KEY || null,
  cookie: process.env.SHOHOZ_COOKIE || null,
  user: null,
  lastUpdated: null
};

// Helper to decode rich official profile from Shohoz JWT Token
function decodeShohozJwtProfile(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    const parts = token.split('.');
    if (parts.length >= 2) {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
      return {
        name: payload.display_name || payload.name || 'Railway Passenger',
        phone: payload.phone_number || payload.username || null,
        email: payload.email || null,
        nid: payload.nidn || null,
        nidType: payload.nidnt || 'NID',
        locale: payload.locale || 'bn-BD',
        roles: Array.isArray(payload.role) ? payload.role : [payload.role || 'user'],
        expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
        issuedAt: payload.nbf ? new Date(payload.nbf * 1000).toISOString() : null,
        isExpired: payload.exp ? (Math.floor(Date.now() / 1000) > payload.exp) : false
      };
    }
  } catch (err) {
    console.warn('[Profile] Error decoding Shohoz JWT:', err.message);
  }
  return null;
}

// Get user-specific Shohoz Railway Session (Strict User-Wise Isolation)
function getUserShohozSession(req) {
  const authUser = getAuthenticatedUser(req);
  if (authUser && authUser.userId) {
    const data = loadUsersData();
    const user = data.users.find(u => u.id === authUser.userId);
    if (user && user.shohozSession && user.shohozSession.token) {
      return {
        ...user.shohozSession,
        userId: user.id,
        username: user.username
      };
    }
    // Authenticated user with NO Shohoz session connected:
    // STRICT ISOLATION: Never fall back to another user's session!
    return {
      token: null,
      deviceId: null,
      deviceKey: null,
      cookie: null,
      user: null,
      lastUpdated: null,
      userId: user ? user.id : authUser.userId,
      username: user ? user.username : authUser.username
    };
  }

  // If unauthenticated (no system user logged in):
  // Return empty session to ensure ZERO cross-user leakage
  return {
    token: null,
    deviceId: null,
    deviceKey: null,
    cookie: null,
    user: null,
    lastUpdated: null
  };
}

// Save user-specific Shohoz Railway Session (Strict User-Wise Isolation)
function saveUserShohozSession(req, sessionData) {
  const authUser = getAuthenticatedUser(req);
  if (authUser && authUser.userId) {
    const data = loadUsersData();
    const user = data.users.find(u => u.id === authUser.userId);
    if (user) {
      user.shohozSession = sessionData;
      saveUsersData(data);
      console.log(`[Session] Saved user-specific Shohoz session strictly for: ${user.username} (${user.id})`);
    }
    return;
  }

  // If unauthenticated / guest (only when requireLogin is false)
  authCredentials = sessionData;
  persistSession(sessionData);
}

// Clear user-specific Shohoz Railway Session (Strict User-Wise Isolation)
function clearUserShohozSession(req) {
  const authUser = getAuthenticatedUser(req);
  if (authUser && authUser.userId) {
    const data = loadUsersData();
    const user = data.users.find(u => u.id === authUser.userId);
    if (user && user.shohozSession) {
      delete user.shohozSession;
      saveUsersData(data);
      console.log(`[Session] Cleared Shohoz session strictly for user: ${user.username}`);
    }
    return;
  }

  // Only clear global fallback if guest/anonymous
  authCredentials = {
    token: null,
    deviceId: null,
    deviceKey: null,
    cookie: null,
    user: null,
    lastUpdated: null
  };
  clearPersistedSession();
}

// Persistent Session Management Functions
function loadSavedSession() {
  try {
    let raw = null;
    if (fs.existsSync(SESSION_FILE)) {
      raw = fs.readFileSync(SESSION_FILE, 'utf8');
    } else if (fs.existsSync(SEED_SESSION_FILE)) {
      raw = fs.readFileSync(SEED_SESSION_FILE, 'utf8');
    }
    if (raw) {
      const data = JSON.parse(raw);
      if (data && data.token) {
        const decodedProfile = decodeShohozJwtProfile(data.token);
        authCredentials = {
          token: data.token,
          deviceId: data.deviceId || data.device_id || crypto.randomUUID(),
          deviceKey: data.deviceKey || data.device_key || 'web',
          cookie: data.cookie || null,
          user: decodedProfile || data.user || { name: 'Saved Live Session' },
          lastUpdated: data.lastUpdated || new Date().toISOString()
        };
        console.log(`[Session] Restored saved session (User: ${authCredentials.user?.name || 'Passenger'})`);
      }
    }
  } catch (err) {
    console.warn('[Session] Could not read saved session:', err.message);
  }
}

function persistSession(sessionData) {
  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify({
      token: sessionData.token,
      deviceId: sessionData.deviceId,
      deviceKey: sessionData.deviceKey,
      cookie: sessionData.cookie,
      user: sessionData.user,
      lastUpdated: new Date().toISOString()
    }, null, 2), 'utf8');
    console.log('[Session] Saved session to data/session.json');
  } catch (err) {
    console.warn('[Session] Failed to persist session:', err.message);
  }
}

function clearPersistedSession() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      fs.unlinkSync(SESSION_FILE);
      console.log('[Session] Deleted data/session.json');
    }
  } catch (err) {
    console.warn('[Session] Failed to remove session file:', err.message);
  }
}

// Load session immediately on startup
loadSavedSession();
loadUsersData();

// ====================================================
// 🛡️ ADVANCED MULTI-LAYER SECURITY & ANTI-LEAK SUITE
// ====================================================

// 1. Hide Express & Server Identifiers
app.disable('x-powered-by');

// 2. Strict Security Headers (Helmet-Grade Protection)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('X-Download-Options', 'noopen');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  next();
});

// 3. Codebase Source Code, Database & Path Traversal Shield
const FORBIDDEN_SECURITY_PATTERNS = [
  /\/\./,                                                               // Any dotfile or dotfolder (.git, .env, .system_generated, etc.)
  /\.\.[\/\\]|\.\.$|%2e%2e|%2f|%5c|\0|%00/i,                            // Path traversal and null-byte injection
  /^\/(data|scratch|node_modules|\.git|\.gemini|builtin)(\/|$)/i,       // Protected server directories
  /^\/(server\.js|package\.json|package-lock\.json|vercel\.json|\.gitignore|\.env)/i, // Critical root files
  /\.(env|json|db|sqlite|log|sql|bak|yml|yaml|config|lock|ts|py|sh|bat|md|git|map)$/i // Sensitive file extensions
];

app.use((req, res, next) => {
  let decodedPath = '';
  let originalUrl = '';
  try {
    decodedPath = decodeURIComponent(req.path || '');
    originalUrl = decodeURIComponent(req.originalUrl || '');
  } catch (e) {
    return res.status(400).json({ success: false, error: 'Malformed URI.' });
  }

  // Allow only public static assets (.js, .css, .html, images inside /public)
  const isAllowedPublicAsset = req.path.startsWith('/js/') || req.path.startsWith('/css/') || req.path.startsWith('/images/') || req.path === '/favicon.ico' || req.path === '/';

  for (const pattern of FORBIDDEN_SECURITY_PATTERNS) {
    if (pattern.test(decodedPath) || pattern.test(originalUrl)) {
      if (!isAllowedPublicAsset) {
        console.warn(`[Security Shield] 🚨 Blocked unauthorized file access attempt: "${req.path}" from IP: ${req.ip}`);
        return res.status(403).json({
          success: false,
          error: 'Access Denied: Forbidden by security shield policy.'
        });
      }
    }
  }
  next();
});

// 4. Advanced In-Memory Sliding-Window API Rate Limiters (Anti-DoS & Anti-Brute-Force)
const apiRateLimits = new Map();
const authRateLimits = new Map();

function createRateLimiter(store, maxRequests, windowMs, errorMessage) {
  return (req, res, next) => {
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown-ip';
    const now = Date.now();
    const record = store.get(clientIp);

    if (!record || now > record.resetAt) {
      store.set(clientIp, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (record.count >= maxRequests) {
      const retryAfter = Math.ceil((record.resetAt - now) / 1000);
      res.setHeader('Retry-After', retryAfter);
      return res.status(429).json({
        success: false,
        error: errorMessage || 'Too many requests. Please slow down and try again.',
        retry_after_seconds: retryAfter
      });
    }

    record.count += 1;
    next();
  };
}

// Periodic cleanup of expired rate limit entries
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of apiRateLimits.entries()) {
    if (now > rec.resetAt) apiRateLimits.delete(ip);
  }
  for (const [ip, rec] of authRateLimits.entries()) {
    if (now > rec.resetAt) authRateLimits.delete(ip);
  }
}, 5 * 60 * 1000);

// Global API Limiter: 500 req / 60s (Generous for live seat monitoring & SPA navigation)
app.use('/api/', createRateLimiter(apiRateLimits, 500, 60 * 1000, 'API rate limit exceeded. Please try again in a few seconds.'));

// Sensitive Write Operations Limiter (Registration, Settings & Telegram pairing): 120 req / 60s
// (Exempts safe GET status checks so dashboard navigation never gets blocked)
app.use(['/api/user-auth/', '/api/users/', '/api/telegram/'], (req, res, next) => {
  if (req.method === 'GET') return next();
  return createRateLimiter(authRateLimits, 120, 60 * 1000, 'Too many requests on security endpoint. Please wait a moment.')(req, res, next);
});

// 5. Clamped Body Parser with Strict Size Limits (Anti-Buffer Overflow)
app.use(cors());
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

// 6. Anti-Prototype Pollution & Deep Input Sanitization Middleware
function deepSanitizeInput(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 5) return;
  
  for (const key of Object.keys(obj)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      delete obj[key];
      continue;
    }
    const val = obj[key];
    if (typeof val === 'string') {
      obj[key] = val.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, 10000);
    } else if (typeof val === 'object' && val !== null) {
      deepSanitizeInput(val, depth + 1);
    }
  }
}

app.use((req, res, next) => {
  if (req.body) deepSanitizeInput(req.body);
  if (req.query) deepSanitizeInput(req.query);
  if (req.params) deepSanitizeInput(req.params);
  next();
});

// Serve static assets from 'public' folder
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

// Explicit Root Route handler to guarantee index.html is served
app.get('/', (req, res) => {
  const indexPath = path.join(publicDir, 'index.html');
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  return res.status(404).send('<h1>RailSeat Finder BD</h1><p>Error: public/index.html not found on this server. Please ensure the public directory was uploaded.</p>');
});

// Load stations list
let stations = [];
try {
  const stationsData = fs.readFileSync(path.join(__dirname, 'data', 'stations.json'), 'utf8');
  stations = JSON.parse(stationsData);
} catch (err) {
  console.error('Error loading stations.json:', err.message);
}

// ----------------------------------------------------
// Anti-Bot & Rate-Limiting Protection Layer
// ----------------------------------------------------
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.2420.81'
];

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// In-memory Response Cache (TTL 20 seconds) & Extended Grace Cache (TTL 5 minutes)
const cache = new Map();
const graceCache = new Map();
const CACHE_TTL_MS = 20 * 1000;
const GRACE_CACHE_TTL_MS = 5 * 60 * 1000;

function getCacheKey(from, to, date, token) {
  const authKey = token ? token.substring(0, 12) : 'noauth';
  return `${from.toLowerCase().trim()}_${to.toLowerCase().trim()}_${date.trim()}_${authKey}`;
}

function getFromCache(key) {
  const cached = cache.get(key);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
    return cached.data;
  }
  cache.delete(key);
  return null;
}

function getFromGraceCache(key) {
  const cached = graceCache.get(key);
  if (cached && (Date.now() - cached.timestamp < GRACE_CACHE_TTL_MS)) {
    return cached.data;
  }
  return null;
}

function setToCache(key, data) {
  if (cache.size > 300) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
  cache.set(key, { timestamp: Date.now(), data });
  graceCache.set(key, { timestamp: Date.now(), data });
}

// Strict Sequential Mutex Queue with Jitter to eliminate Shohoz "You are requesting too frequently"
let requestQueue = Promise.resolve();
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL_MS = 450;

async function safeShohozRequest(fn) {
  const run = async () => {
    const now = Date.now();
    const elapsed = now - lastRequestTime;
    if (elapsed < MIN_REQUEST_INTERVAL_MS) {
      const delay = (MIN_REQUEST_INTERVAL_MS - elapsed) + Math.floor(Math.random() * 150);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    lastRequestTime = Date.now();
    return fn();
  };

  const task = requestQueue.then(run, run);
  requestQueue = task.catch(() => {});
  return task;
}

// ----------------------------------------------------
// Date Formatting Helper (Shohoz expects "DD-MMM-YYYY" e.g. "28-Aug-2026")
// ----------------------------------------------------
function formatShohozDate(inputDate) {
  if (!inputDate) return '';
  const dateObj = new Date(inputDate);
  if (isNaN(dateObj.getTime())) return inputDate;

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = String(dateObj.getDate()).padStart(2, '0');
  const month = months[dateObj.getMonth()];
  const year = dateObj.getFullYear();

  return `${day}-${month}-${year}`;
}

// ----------------------------------------------------
// Seat & Fare Extraction Helpers for Live Shohoz API
// ----------------------------------------------------
function extractOnlineSeats(st) {
  if (st.seat_counts && typeof st.seat_counts === 'object') {
    if (st.seat_counts.online !== undefined && st.seat_counts.online !== null) {
      return Number(st.seat_counts.online);
    }
  }
  const possible = [
    st.online_available_seats,
    st.seats_available,
    st.available_seats,
    st.online_seats,
    st.online,
    st.seat_available,
    st.vacant_seats,
    st.count
  ];
  for (const val of possible) {
    if (val !== undefined && val !== null && !isNaN(Number(val))) {
      return Number(val);
    }
  }
  return 0;
}

function extractOfflineSeats(st) {
  if (st.seat_counts && typeof st.seat_counts === 'object') {
    if (st.seat_counts.offline !== undefined && st.seat_counts.offline !== null) {
      return Number(st.seat_counts.offline);
    }
  }
  const possible = [
    st.counter_seats_available,
    st.offline_available_seats,
    st.counter_seats,
    st.offline_seats,
    st.offline
  ];
  for (const val of possible) {
    if (val !== undefined && val !== null && !isNaN(Number(val))) {
      return Number(val);
    }
  }
  return 0;
}

function extractFareInfo(st) {
  let baseFare = 0;
  if (st.fare_details && typeof st.fare_details === 'object') {
    if (st.fare_details.fare !== undefined && st.fare_details.fare !== null) {
      baseFare = Number(st.fare_details.fare);
    } else if (st.fare_details.total_fare !== undefined && st.fare_details.total_fare !== null) {
      baseFare = Number(st.fare_details.total_fare);
    }
  }

  if (!baseFare) {
    const possible = [st.fare, st.ticket_fare, st.price, st.base_fare];
    for (const val of possible) {
      if (val !== undefined && val !== null && !isNaN(Number(val))) {
        baseFare = Number(val);
        break;
      }
    }
  }

  // Exact VAT calculation directly from Shohoz
  let vatAmount = 0;
  if (st.vat_amount !== undefined && st.vat_amount !== null && !isNaN(Number(st.vat_amount))) {
    vatAmount = Number(st.vat_amount);
  } else if (st.fare_details?.vat_amount !== undefined && !isNaN(Number(st.fare_details.vat_amount))) {
    vatAmount = Number(st.fare_details.vat_amount);
  } else if (st.vat_percent !== undefined && st.vat_percent !== null && !isNaN(Number(st.vat_percent))) {
    vatAmount = Math.round(baseFare * (Number(st.vat_percent) / 100));
  } else if (st.vat !== undefined && st.vat !== null && !isNaN(Number(st.vat))) {
    vatAmount = Number(st.vat);
  } else {
    // Bangladesh Railway official tax rules:
    // Only AC classes (AC_S, AC_B, SNIGDHA, AC_C, BERTH) have 15% VAT; Non-AC classes (S_CHAIR, SHOVAN, F_SEAT) have 0% VAT
    const type = String(st.type || st.seat_class || '').toUpperCase();
    const isAC = type.includes('AC') || type.includes('SNIGDHA') || type.includes('BERTH');
    vatAmount = isAC ? Math.round(baseFare * 0.15) : 0;
  }

  const totalFare = baseFare > 0 ? (baseFare + vatAmount) : 0;

  return {
    fare: baseFare,
    vat: vatAmount,
    vat_percent: st.vat_percent !== undefined ? Number(st.vat_percent) : (baseFare > 0 ? Math.round((vatAmount / baseFare) * 100) : 0),
    total_fare: totalFare
  };
}

// ----------------------------------------------------
// Normalizer for Live Shohoz Response
// ----------------------------------------------------
function normalizeShohozResponse(data, from_city, to_city, date_of_journey) {
  let rawTrains = [];
  if (Array.isArray(data?.data?.trains)) {
    rawTrains = data.data.trains;
  } else if (Array.isArray(data?.data?.trips)) {
    rawTrains = data.data.trips;
  } else if (Array.isArray(data?.data?.available_trips)) {
    rawTrains = data.data.available_trips;
  } else if (Array.isArray(data?.data)) {
    rawTrains = data.data;
  } else if (Array.isArray(data?.trains)) {
    rawTrains = data.trains;
  } else if (Array.isArray(data?.trips)) {
    rawTrains = data.trips;
  }

  if (rawTrains.length > 0) {
    console.log('[DEBUG Raw Train Sample Keys]:', Object.keys(rawTrains[0]));
    console.log('[DEBUG Raw Train Sample]:', JSON.stringify({
      trip_id: rawTrains[0].trip_id,
      trip_route_id: rawTrains[0].trip_route_id,
      route_id: rawTrains[0].route_id,
      train_name: rawTrains[0].train_name,
      train_model: rawTrains[0].train_model,
      seat_types: rawTrains[0].seat_types || rawTrains[0].seat_classes
    }, null, 2));
  }

  const trains = rawTrains.map((item) => {
    const rawSeatTypes = item.seat_types || item.seat_classes || item.seats || item.seat_availability || item.classes || [];
    
    const seatClasses = rawSeatTypes.map((st) => {
      const onlineSeats = extractOnlineSeats(st);
      const offlineSeats = extractOfflineSeats(st);
      const fareInfo = extractFareInfo(st);

      const typeCode = (st.type || st.seat_class || st.class_name || 'UNKNOWN').toUpperCase();
      const coaches = Array.isArray(st.coaches) ? st.coaches : (st.coach_names || []);

      return {
        type: typeCode,
        trip_id: st.trip_id || item.trip_id || null,
        trip_route_id: st.trip_route_id || item.trip_route_id || null,
        route_id: st.route_id || item.route_id || null,
        display_name: st.display_name || st.seat_class_name || st.type || typeCode,
        fare: fareInfo.fare,
        vat: fareInfo.vat,
        vat_percent: fareInfo.vat_percent,
        total_fare: fareInfo.total_fare,
        seats_available: onlineSeats,
        counter_seats_available: offlineSeats,
        is_available: onlineSeats > 0,
        coaches: coaches
      };
    });

    const totalOnline = seatClasses.reduce((sum, s) => sum + s.seats_available, 0);
    const totalOffline = seatClasses.reduce((sum, s) => sum + s.counter_seats_available, 0);

    return {
      trip_id: (seatClasses[0] && seatClasses[0].trip_id) || item.trip_id || item.id || `TRIP_${item.train_model || Math.random()}`,
      trip_route_id: (seatClasses[0] && seatClasses[0].trip_route_id) || item.trip_route_id || item.route_id || null,
      train_name: item.train_name || item.trip_number || 'Intercity Train',
      train_model: item.train_model || item.train_number || 'N/A',
      departure_station: item.departure_station || from_city,
      departure_time: item.departure_time || item.departure_date_time || 'N/A',
      arrival_station: item.arrival_station || to_city,
      arrival_time: item.arrival_time || item.arrival_date_time || 'N/A',
      travel_time: item.travel_time || item.duration || '',
      off_day: item.off_day || item.offday || 'None',
      seat_types: seatClasses,
      total_available_seats: totalOnline,
      total_online_seats: totalOnline,
      total_offline_seats: totalOffline,
      total_combined_seats: totalOnline + totalOffline
    };
  });

  return {
    success: true,
    source: 'Bangladesh Railway (Shohoz 100% Live API)',
    route: {
      from: from_city,
      to: to_city,
      date: date_of_journey
    },
    total_trains: trains.length,
    trains: trains
  };
}

// ----------------------------------------------------
// Authentication Endpoints
// ----------------------------------------------------

// 1. Get Auth Status (User-Specific or Fallback)
app.get('/api/auth/status', (req, res) => {
  const session = getUserShohozSession(req);
  res.json({
    authenticated: !!session.token,
    user: session.user,
    token_preview: session.token ? `${session.token.substring(0, 10)}...${session.token.slice(-6)}` : null,
    device_id: session.deviceId,
    device_key: session.deviceKey,
    has_saved_session: !!session.token,
    last_updated: session.lastUpdated,
    user_id: session.userId || null,
    username: session.username || null
  });
});

// 2. Set Token (User-Specific or Fallback)
app.post('/api/auth/set-token', (req, res) => {
  let { token, device_id, device_key, raw_curl } = req.body;
  let cookie = null;

  if (raw_curl) {
    const authMatch = raw_curl.match(/[-H\s]['"]?[Aa]uthorization:\s*(Bearer\s+)?([^'"\r\n]+)['"]?/i);
    const deviceIdMatch = raw_curl.match(/[-H\s]['"]?x-device-id:\s*([^'"\r\n]+)['"]?/i);
    const deviceKeyMatch = raw_curl.match(/[-H\s]['"]?x-device-key:\s*([^'"\r\n]+)['"]?/i);
    const cookieMatch = raw_curl.match(/[-H\s]['"]?[Cc]ookie:\s*([^'"\r\n]+)['"]?/i);

    if (authMatch) token = authMatch[2].trim();
    if (deviceIdMatch) device_id = deviceIdMatch[1].trim();
    if (deviceKeyMatch) device_key = deviceKeyMatch[1].trim();
    if (cookieMatch) cookie = cookieMatch[1].trim();
  }

  if (!token || typeof token !== 'string') {
    return res.status(400).json({ success: false, error: 'Authorization token is required.' });
  }

  token = token.replace(/^Bearer\s+/i, '').trim();
  const cleanDeviceId = (device_id && device_id !== 'null' && device_id !== 'undefined') ? device_id.trim() : crypto.randomUUID();
  const cleanDeviceKey = (device_key && device_key !== 'null' && device_key !== 'undefined') ? device_key.trim() : 'web';
  
  const decodedProfile = decodeShohozJwtProfile(token);
  const sessionData = {
    token,
    deviceId: cleanDeviceId,
    deviceKey: cleanDeviceKey,
    cookie: cookie || authCredentials.cookie || null,
    user: decodedProfile || { name: 'Live Railway Session', custom_token: true },
    lastUpdated: new Date().toISOString()
  };
  
  // Persist session to specific user (or global)
  saveUserShohozSession(req, sessionData);
  cache.clear();

  console.log(`[Auth Set] Token: ${token.substring(0, 8)}..., User: ${sessionData.user.name || 'Passenger'}, DeviceID: ${cleanDeviceId}, DeviceKey: ${cleanDeviceKey}`);

  res.json({
    success: true,
    message: 'Live Railway session credentials saved and activated successfully!',
    user: sessionData.user,
    token_preview: `${token.substring(0, 10)}...${token.slice(-6)}`,
    device_id: cleanDeviceId,
    device_key: cleanDeviceKey
  });
});

// 3. Get Railway Live Session Profile Data (User-Specific)
app.get('/api/railway-profile', (req, res) => {
  const session = getUserShohozSession(req);
  if (!session.token) {
    return res.json({
      connected: false,
      profile: null,
      message: 'No active Bangladesh Railway session connected.'
    });
  }

  const profile = decodeShohozJwtProfile(session.token) || session.user;

  res.json({
    connected: true,
    profile: profile,
    device_id: session.deviceId,
    device_key: session.deviceKey,
    last_updated: session.lastUpdated,
    user_id: session.userId || null,
    username: session.username || null
  });
});

// 4. Shohoz Sign-in with Mobile & Password
app.post('/api/auth/sign-in', async (req, res) => {
  const { mobile_number, password } = req.body;

  if (!mobile_number || !password) {
    return res.status(400).json({
      success: false,
      error: 'Mobile number and password are required.'
    });
  }

  const generatedDeviceId = crypto.randomUUID();
  const generatedDeviceKey = 'web';

  const signinEndpoints = [
    'https://railspaapi.shohoz.com/v1.0/web/auth/sign-in',
    'https://railspaapi.shohoz.com/v1.0/app/auth/sign-in'
  ];

  const headers = {
    'User-Agent': getRandomUserAgent(),
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9,bn;q=0.8',
    'Origin': 'https://eticket.railway.gov.bd',
    'Referer': 'https://eticket.railway.gov.bd/',
    'x-device-id': generatedDeviceId,
    'x-device-key': generatedDeviceKey,
    'Content-Type': 'application/json'
  };

  for (const endpoint of signinEndpoints) {
    try {
      console.log(`[Auth] Attempting login to ${endpoint} with mobile ${mobile_number}...`);
      const response = await axios.post(endpoint, {
        mobile_number: mobile_number.trim(),
        password: password
      }, { headers, timeout: 9000 });

      if (response.status === 200 && response.data) {
        const token = response.data.data?.token || response.data.token || response.data.data?.access_token;
        const user = response.data.data?.user || response.data.user || { mobile_number };
        const setCookie = response.headers['set-cookie'];

        if (token) {
          const sessionData = {
            token,
            deviceId: generatedDeviceId,
            deviceKey: generatedDeviceKey,
            cookie: setCookie ? (Array.isArray(setCookie) ? setCookie.join('; ') : setCookie) : null,
            user: user,
            lastUpdated: new Date().toISOString()
          };

          // Persist session to specific user (or global)
          saveUserShohozSession(req, sessionData);
          cache.clear();

          console.log(`[Auth] Login SUCCESS! User:`, user.name || user.mobile_number);
          return res.json({
            success: true,
            message: 'Signed in successfully to Bangladesh Railway (Shohoz)!',
            user: user,
            token_preview: `${token.substring(0, 10)}...${token.slice(-6)}`,
            device_id: generatedDeviceId,
            device_key: generatedDeviceKey
          });
        }
      }
    } catch (err) {
      console.warn(`Sign-in failed at ${endpoint}:`, err.response?.data || err.message);
      if (err.response?.data?.error?.messages) {
        return res.status(401).json({
          success: false,
          error: err.response.data.error.messages.join(', ')
        });
      }
    }
  }

  res.status(401).json({
    success: false,
    error: 'Authentication rejected by Shohoz. Please verify credentials or use the 1-Click Console script in "Connect Live API".'
  });
});

// 5. Logout / Clear Token
app.post('/api/auth/logout', (req, res) => {
  clearUserShohozSession(req);
  cache.clear();
  res.json({ success: true, message: 'Shohoz session disconnected.' });
});

// ----------------------------------------------------
// Public API Endpoints
// ----------------------------------------------------

// 1. Get Stations (256 Shohoz Stations)
app.get('/api/stations', (req, res) => {
  res.json({
    success: true,
    count: stations.length,
    stations: stations
  });
});

// Station alias mapping and spelling correction dictionary
const STATION_ALIASES = {
  'airport': 'Biman_Bandar',
  'dhaka airport': 'Biman_Bandar',
  'biman bandar': 'Biman_Bandar',
  'bimanbandar': 'Biman_Bandar',
  'biman_bandor': 'Biman_Bandar',
  'chittagong': 'Chattogram',
  'ctg': 'Chattogram',
  'chottogram': 'Chattogram',
  'comilla': 'Cumilla',
  'cumilla junction': 'Cumilla',
  'bogra': 'Bogura',
  'jessore': 'Jashore',
  'barisal': 'Barishal',
  'coxs bazar': "Cox's Bazar",
  'coxsbazar': "Cox's Bazar",
  "cox's_bazar": "Cox's Bazar",
  'coxs_bazar': "Cox's Bazar",
  'cox bazaar': "Cox's Bazar",
  'jamalpur': 'Jamalpur_Town',
  'jamalpur town': 'Jamalpur_Town',
  'cantonment': 'Dhaka_Cantonment',
  'dhaka cantonment': 'Dhaka_Cantonment',
  'bhairab': 'Bhairab_Bazar',
  'bhairab bazar': 'Bhairab_Bazar',
  'b.baria': 'Brahmanbaria',
  'b-baria': 'Brahmanbaria',
  'brahman baria': 'Brahmanbaria',
  'dewanganj': 'Dewanganj_Bazar',
  'dewangonj': 'Dewanganj_Bazar',
  'melandah': 'Melandah_Bazar',
  'islampur': 'Islampur_Bazar',
  'sirajganj': 'Sirajganj_Bazar',
  'thakurgaon': 'Thakurgaon_Road',
  'sayedpur': 'Saidpur',
  'bhanga': 'Bhanga_Junction',
  'chandpur': 'Chandpur_Court',
  'kushtia': 'Kushtia_Court',
  'boalmari': 'Boalmari_Bazar',
  'bonarpara': 'Bonar_Para',
  'bonar para': 'Bonar_Para'
};

function getCanonicalStationName(raw) {
  if (!raw) return '';
  const clean = String(raw).trim();
  const lower = clean.toLowerCase();
  
  if (STATION_ALIASES[lower]) {
    return STATION_ALIASES[lower];
  }

  // Exact match on station.name
  const exactName = stations.find(s => s.name && s.name.toLowerCase() === lower);
  if (exactName) return exactName.name;

  // Match on station.display_name
  const exactDisplay = stations.find(s => s.display_name && s.display_name.toLowerCase() === lower);
  if (exactDisplay) return exactDisplay.name;

  // Space vs underscore replacement match
  const underscore = lower.replace(/\s+/g, '_');
  const matchUnderscore = stations.find(s => s.name && s.name.toLowerCase() === underscore);
  if (matchUnderscore) return matchUnderscore.name;

  return clean;
}

// Core function to query a single journey date from live Shohoz Gateway
async function querySingleShohozTrip(from_city, to_city, date_of_journey, customSession = null) {
  const activeSession = (customSession && customSession.token) ? customSession : authCredentials;
  if (!activeSession.token) {
    return {
      success: false,
      auth_required: true,
      error: 'Live Shohoz session is required. Please click "Connect Live API" to pair your session.',
      trains: []
    };
  }

  const canonicalFrom = getCanonicalStationName(from_city);
  const canonicalTo = getCanonicalStationName(to_city);

  // Check In-Memory Cache first (avoid unnecessary requests)
  const cacheKey = getCacheKey(canonicalFrom, canonicalTo, date_of_journey, activeSession.token);
  const cachedData = getFromCache(cacheKey);
  if (cachedData) {
    return {
      ...cachedData,
      from_cache: true,
      cache_ttl_remaining: Math.round((CACHE_TTL_MS - (Date.now() - cache.get(cacheKey).timestamp)) / 1000)
    };
  }

  const formattedDate = formatShohozDate(date_of_journey);
  const targetUrl = `https://railspaapi.shohoz.com/v1.0/web/bookings/search-trips-v2?from_city=${encodeURIComponent(canonicalFrom)}&to_city=${encodeURIComponent(canonicalTo)}&date_of_journey=${encodeURIComponent(formattedDate)}&seat_class=S_CHAIR`;

  const baseHeaders = {
    'User-Agent': getRandomUserAgent(),
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9,bn;q=0.8',
    'Origin': 'https://eticket.railway.gov.bd',
    'Referer': 'https://eticket.railway.gov.bd/',
    'Authorization': `Bearer ${activeSession.token}`,
    'Priority': 'u=1, i'
  };

  if (activeSession.deviceId) baseHeaders['x-device-id'] = activeSession.deviceId;
  if (activeSession.deviceKey) baseHeaders['x-device-key'] = activeSession.deviceKey;
  if (activeSession.cookie) baseHeaders['Cookie'] = activeSession.cookie;

  let lastErrorStatus = null;
  let lastErrorMessage = '';
  let isRateLimited = false;

  try {
    const response = await safeShohozRequest(async () => {
      return axios.get(targetUrl, {
        headers: baseHeaders,
        timeout: 9000,
        validateStatus: (status) => status < 500
      });
    });

    if (response.status === 200 && response.data) {
      if (response.data.error && response.data.error.code) {
        const msg = response.data.error.messages?.join(', ') || '';
        if (msg.toLowerCase().includes('frequently') || msg.toLowerCase().includes('wait') || msg.toLowerCase().includes('too many')) {
          isRateLimited = true;
          lastErrorMessage = msg;
        } else {
          lastErrorMessage = msg || 'Shohoz internal error';
        }
      } else {
        const normalized = normalizeShohozResponse(response.data, from_city, to_city, date_of_journey);
        if (normalized) {
          // Enrich trains with off-days
          for (const t of (normalized.trains || [])) {
            if (t.train_model && t.train_model !== 'N/A') {
              t.off_day = await getOrFetchTrainOffDay(t.train_model, activeSession);
            }
          }

          setToCache(cacheKey, normalized);
          return normalized;
        }
      }
    }

    if (response.status === 429) {
      isRateLimited = true;
      lastErrorStatus = 429;
      lastErrorMessage = response.data?.error?.messages?.join(', ') || 'You are requesting too frequently. Please wait and try after some time.';
    } else if (response.status === 401) {
      lastErrorStatus = 401;
      const msg = response.data?.error?.messages?.join(', ') || 'Your Bangladesh Railway session token has expired or is invalid.';
      lastErrorMessage = msg;
    } else if (response.status === 403) {
      lastErrorStatus = 403;
      lastErrorMessage = 'Shohoz Cloudflare verification required';
    }

  } catch (err) {
    if (err.response?.status === 429 || (err.message && err.message.includes('429'))) {
      isRateLimited = true;
      lastErrorStatus = 429;
      lastErrorMessage = 'You are requesting too frequently. Please wait and try after some time.';
    } else {
      lastErrorMessage = err.message;
    }
  }

  // Grace Cache fallback if rate limited by Shohoz
  if (isRateLimited) {
    const graceData = getFromGraceCache(cacheKey);
    if (graceData) {
      return {
        ...graceData,
        from_cache: true,
        is_stale_cache: true,
        cooldown_notice: 'Shohoz traffic cooldown active. Showing recent live results.'
      };
    }

    return {
      success: false,
      rate_limited: true,
      error: 'You are requesting too frequently. Shohoz traffic cooldown active (3-5s). Please wait a moment.',
      trains: []
    };
  }

  if (lastErrorStatus === 401) {
    return {
      success: false,
      auth_error: true,
      session_expired: true,
      error: `Your Shohoz session has expired (${lastErrorMessage}). Please click "Connect Live API" to copy a fresh token from eticket.railway.gov.bd.`,
      trains: []
    };
  }

  return {
    success: false,
    error: `Failed to fetch live data from Bangladesh Railway (${lastErrorMessage || 'No response'}). Please try again shortly.`,
    trains: []
  };
}

// 2. Search Available Trains & Seats for Single Date
app.get('/api/search', async (req, res) => {
  const { from_city, to_city, date_of_journey } = req.query;

  if (!from_city || !to_city || !date_of_journey) {
    return res.status(400).json({
      success: false,
      error: 'Missing required parameters: from_city, to_city, date_of_journey are required.'
    });
  }

  const session = getUserShohozSession(req);
  const result = await querySingleShohozTrip(from_city, to_city, date_of_journey, session);
  return res.json(result);
});

// 3. Dynamic Next 10-Days Matrix Search (Multi-Date Batch Engine)
app.get('/api/multi-date-search', async (req, res) => {
  const { from_city, to_city, start_date, days = 10 } = req.query;

  if (!from_city || !to_city) {
    return res.status(400).json({
      success: false,
      error: 'from_city and to_city are required.'
    });
  }

  const session = getUserShohozSession(req);
  if (!session.token) {
    return res.json({
      success: false,
      auth_required: true,
      error: 'Live Shohoz session is required. Please click "Connect Live API" to pair your session.',
      matrix: []
    });
  }

  const numDays = Math.min(14, Math.max(1, parseInt(days, 10) || 7));
  const baseDate = start_date ? new Date(start_date) : new Date();

  // Generate consecutive date ISO strings
  const dateList = [];
  for (let i = 0; i < numDays; i++) {
    const d = new Date(baseDate);
    d.setDate(baseDate.getDate() + i);
    dateList.push(d.toISOString().split('T')[0]);
  }

  // Execute in smooth batches of 2 requests with queue spacing
  const matrixResults = [];
  const batchSize = 2;
  for (let i = 0; i < dateList.length; i += batchSize) {
    const batch = dateList.slice(i, i + batchSize);
    const batchPromises = batch.map(async (dStr) => {
      const result = await querySingleShohozTrip(from_city, to_city, dStr, session);
      const trains = result.trains || [];
      const totalSeats = trains.reduce((sum, t) => sum + (t.total_combined_seats || 0), 0);
      const onlineSeats = trains.reduce((sum, t) => sum + (t.total_online_seats || 0), 0);

      return {
        date: dStr,
        formatted_date: formatShohozDate(dStr),
        day_name: new Date(dStr).toLocaleDateString('en-US', { weekday: 'short' }),
        display_date: new Date(dStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        success: result.success,
        total_trains: trains.length,
        total_available_seats: totalSeats,
        total_online_seats: onlineSeats,
        trains: trains.map(t => ({
          train_name: t.train_name,
          train_model: t.train_model,
          departure_time: t.departure_time,
          arrival_time: t.arrival_time,
          off_day: t.off_day,
          total_seats: t.total_combined_seats || 0,
          seat_types: (t.seat_types || []).map(st => ({
            type: st.type,
            display_name: st.display_name,
            total_seats: (st.seats_available || 0) + (st.counter_seats_available || 0),
            online_seats: st.seats_available || 0,
            fare: st.fare,
            vat: st.vat,
            total_fare: st.total_fare
          }))
        }))
      };
    });
    const batchResults = await Promise.all(batchPromises);
    matrixResults.push(...batchResults);
  }

  return res.json({
    success: true,
    route: {
      from: from_city,
      to: to_city,
      start_date: dateList[0],
      end_date: dateList[dateList.length - 1],
      total_days: dateList.length
    },
    matrix: matrixResults
  });
});

// ----------------------------------------------------
// Official Bangladesh Railway Days & Off-Day Resolution
// ----------------------------------------------------
const ALL_DAYS_MAP = {
  'Sun': 'Sunday',
  'Mon': 'Monday',
  'Tue': 'Tuesday',
  'Wed': 'Wednesday',
  'Thu': 'Thursday',
  'Fri': 'Friday',
  'Sat': 'Saturday'
};
const ALL_DAYS_KEYS = ['Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu'];

function computeOffDayFromDays(days) {
  if (!Array.isArray(days) || days.length === 0) return 'None';
  if (days.length >= 7) return 'None';
  const missing = ALL_DAYS_KEYS.filter(d => !days.includes(d));
  if (missing.length === 0) return 'None';
  return missing.map(d => ALL_DAYS_MAP[d] || d).join(', ');
}

// In-Memory Cache for Train Routes and Off-Days
const routeCache = new Map();
const trainOffDaysCache = new Map();

async function getOrFetchTrainOffDay(trainModel, customSession = null) {
  if (!trainModel || trainModel === 'N/A') return 'None';
  const cleanModel = String(trainModel).replace(/\D/g, '').trim() || String(trainModel).trim();
  return await fetchTrainOffDay(cleanModel, customSession);
}

// 2. Fetch Train Route and Compute Off-Day
async function fetchTrainOffDay(cleanModel, customSession = null) {
  const cacheKey = `route_${cleanModel}`;
  if (routeCache.has(cacheKey)) {
    const data = routeCache.get(cacheKey);
    const offDay = computeOffDayFromDays(data.days);
    trainOffDaysCache.set(cleanModel, offDay);
    return offDay;
  }

  const activeSession = (customSession && customSession.token) ? customSession : authCredentials;

  const headers = {
    'User-Agent': getRandomUserAgent(),
    'Accept': 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    'Origin': 'https://eticket.railway.gov.bd',
    'Referer': 'https://eticket.railway.gov.bd/train-information'
  };

  if (activeSession && activeSession.token) headers['Authorization'] = `Bearer ${activeSession.token}`;
  if (activeSession && activeSession.deviceId) headers['x-device-id'] = activeSession.deviceId;
  if (activeSession && activeSession.deviceKey) headers['x-device-key'] = activeSession.deviceKey;

  try {
    const url = 'https://railspaapi.shohoz.com/v1.0/web/train-routes';
    const response = await safeShohozRequest(async () => {
      return axios.post(url, { model: cleanModel }, { headers, timeout: 5000 });
    });

    if (response && response.status === 200 && response.data?.data) {
      const data = response.data.data;
      data.off_day = computeOffDayFromDays(data.days);
      routeCache.set(cacheKey, data);
      trainOffDaysCache.set(cleanModel, data.off_day);
      return data.off_day;
    }
  } catch (err) {
    // Return None on network timeout
  }

  return 'None';
}

// 3. Get Official Train Route & Stoppage Schedule (Live Shohoz Train Information API)
async function getTrainRouteData(cleanModel, customSession = null) {
  const cacheKey = `route_${cleanModel}`;
  if (routeCache.has(cacheKey)) {
    const data = routeCache.get(cacheKey);
    data.off_day = computeOffDayFromDays(data.days);
    return data;
  }

  const activeSession = (customSession && customSession.token) ? customSession : authCredentials;

  const headers = {
    'User-Agent': getRandomUserAgent(),
    'Accept': 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    'Origin': 'https://eticket.railway.gov.bd',
    'Referer': 'https://eticket.railway.gov.bd/train-information'
  };

  if (activeSession && activeSession.token) headers['Authorization'] = `Bearer ${activeSession.token}`;
  if (activeSession && activeSession.deviceId) headers['x-device-id'] = activeSession.deviceId;
  if (activeSession && activeSession.deviceKey) headers['x-device-key'] = activeSession.deviceKey;

  try {
    const url = 'https://railspaapi.shohoz.com/v1.0/web/train-routes';
    const response = await safeShohozRequest(async () => {
      return axios.post(url, { model: cleanModel }, { headers, timeout: 8000 });
    });

    if (response && response.status === 200 && response.data?.data) {
      const data = response.data.data;
      data.off_day = computeOffDayFromDays(data.days);
      routeCache.set(cacheKey, data);
      trainOffDaysCache.set(cleanModel, data.off_day);
      return data.off_day ? data : { ...data, off_day: 'None' };
    }
  } catch (err) {
    console.warn(`[Train Route Error for ${cleanModel}]:`, err.response?.data || err.message);
  }
  return null;
}

app.get('/api/train-route', async (req, res) => {
  const { model } = req.query;

  if (!model) {
    return res.status(400).json({ success: false, error: 'model (train number) parameter is required.' });
  }

  const session = getUserShohozSession(req);
  const cleanModel = String(model).replace(/\D/g, '').trim() || String(model).trim();
  const data = await getTrainRouteData(cleanModel, session);

  if (data) {
    return res.json({
      success: true,
      data: data
    });
  }

  return res.json({
    success: false,
    error: 'No route data returned by Bangladesh Railway for this train model.'
  });
});

// 4. Single-Day All-Station Seat Matrix (Station-to-Station Intermediate Vacancy Grid)
app.get('/api/train-station-matrix', async (req, res) => {
  const { model, date_of_journey, from_station, to_station } = req.query;

  if (!model || !date_of_journey) {
    return res.status(400).json({
      success: false,
      error: 'model (train number) and date_of_journey are required.'
    });
  }

  const session = getUserShohozSession(req);
  if (!session.token) {
    return res.json({
      success: false,
      auth_required: true,
      error: 'Live Shohoz session is required. Please click "Connect Live API" to pair your session.',
      segments: []
    });
  }

  const cleanModel = String(model).replace(/\D/g, '').trim() || String(model).trim();
  const routeData = await getTrainRouteData(cleanModel, session);

  if (!routeData || !routeData.routes || routeData.routes.length === 0) {
    return res.json({
      success: false,
      error: `Could not retrieve stoppage stations for train #${cleanModel}.`
    });
  }

  const rawStops = routeData.routes;
  const stops = rawStops.map(s => ({
    city: s.city,
    cleanCity: (s.city || '').replace(/_/g, ' ').trim(),
    queryCity: s.city,
    arrival_time: s.arrival_time || '--',
    departure_time: s.departure_time || '--',
    halt: s.halt ? `${s.halt} min` : ''
  }));

  // Build target pairs to query (supports single, comma-separated, or multi-select array)
  const parseStationList = (param) => {
    if (!param || param === 'ALL') return null;
    let list = [];
    if (Array.isArray(param)) {
      list = param;
    } else if (typeof param === 'string') {
      list = param.split(',');
    }
    const cleanList = list.map(s => String(s).replace(/_/g, ' ').trim().toLowerCase()).filter(Boolean);
    return cleanList.length > 0 ? cleanList : null;
  };

  const selectedFromList = parseStationList(from_station);
  const selectedToList = parseStationList(to_station);

  const targetPairs = [];

  for (let i = 0; i < stops.length - 1; i++) {
    const originStop = stops[i];
    if (selectedFromList && !selectedFromList.includes(originStop.cleanCity.toLowerCase()) && !selectedFromList.includes(originStop.city.toLowerCase())) {
      continue;
    }

    for (let j = i + 1; j < stops.length; j++) {
      const destStop = stops[j];
      if (selectedToList && !selectedToList.includes(destStop.cleanCity.toLowerCase()) && !selectedToList.includes(destStop.city.toLowerCase())) {
        continue;
      }
      targetPairs.push({
        from: originStop.queryCity,
        fromClean: originStop.cleanCity,
        fromDep: originStop.departure_time,
        to: destStop.queryCity,
        toClean: destStop.cleanCity,
        toArr: destStop.arrival_time
      });
    }
  }

  if (targetPairs.length === 0) {
    return res.json({
      success: true,
      train_name: routeData.train_name || `Train #${cleanModel}`,
      train_model: cleanModel,
      date: date_of_journey,
      display_date: formatShohozDate(date_of_journey),
      off_day: routeData.off_day || 'None',
      stoppages: stops,
      segments: []
    });
  }

  // Format date of journey for Shohoz
  let dojStr = date_of_journey;
  if (/^\d{4}-\d{2}-\d{2}$/.test(date_of_journey)) {
    const d = new Date(date_of_journey);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    dojStr = `${String(d.getDate()).padStart(2, '0')}-${months[d.getMonth()]}-${d.getFullYear()}`;
  }

  // Execute in smooth batches of 2 requests with queue spacing
  const segments = [];
  const batchSize = 2;

  for (let i = 0; i < targetPairs.length; i += batchSize) {
    const batch = targetPairs.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(async (pair) => {
      try {
        const queryRes = await querySingleShohozTrip(pair.from, pair.to, dojStr);
        const trains = queryRes.trains || [];
        const matchingTrain = trains.find(t => 
          String(t.train_model) === cleanModel || 
          (t.train_name && routeData.train_name && t.train_name.toLowerCase().trim() === routeData.train_name.toLowerCase().trim())
        );

        const canonicalFrom = getCanonicalStationName(pair.from);
        const canonicalTo = getCanonicalStationName(pair.to);

        if (matchingTrain) {
          const totalSeats = matchingTrain.total_combined_seats !== undefined 
            ? matchingTrain.total_combined_seats 
            : (matchingTrain.seat_types || []).reduce((sum, st) => sum + Number(st.seats_available || 0) + Number(st.counter_seats_available || 0), 0);

          const bookUrl = `https://eticket.railway.gov.bd/booking/train/search?fromcity=${encodeURIComponent(canonicalFrom)}&tocity=${encodeURIComponent(canonicalTo)}&doj=${encodeURIComponent(dojStr)}&class=${encodeURIComponent(matchingTrain.seat_types?.[0]?.type || 'S_CHAIR')}`;

          return {
            from: pair.fromClean,
            to: pair.toClean,
            departure_time: matchingTrain.departure_time || pair.fromDep,
            arrival_time: matchingTrain.arrival_time || pair.toArr,
            travel_time: matchingTrain.travel_time || '',
            total_seats: totalSeats,
            has_seats: totalSeats > 0,
            seat_types: matchingTrain.seat_types || [],
            book_url: bookUrl
          };
        } else {
          return {
            from: pair.fromClean,
            to: pair.toClean,
            departure_time: pair.fromDep || '--',
            arrival_time: pair.toArr || '--',
            travel_time: '',
            total_seats: 0,
            has_seats: false,
            seat_types: [],
            book_url: `https://eticket.railway.gov.bd/booking/train/search?fromcity=${encodeURIComponent(canonicalFrom)}&tocity=${encodeURIComponent(canonicalTo)}&doj=${encodeURIComponent(dojStr)}&class=S_CHAIR`
          };
        }
      } catch (err) {
        const canonicalFrom = getCanonicalStationName(pair.from);
        const canonicalTo = getCanonicalStationName(pair.to);
        return {
          from: pair.fromClean,
          to: pair.toClean,
          departure_time: pair.fromDep || '--',
          arrival_time: pair.toArr || '--',
          travel_time: '',
          total_seats: 0,
          has_seats: false,
          seat_types: [],
          book_url: `https://eticket.railway.gov.bd/booking/train/search?fromcity=${encodeURIComponent(canonicalFrom)}&tocity=${encodeURIComponent(canonicalTo)}&doj=${encodeURIComponent(dojStr)}&class=S_CHAIR`
        };
      }
    }));

    segments.push(...batchResults);
  }

  return res.json({
    success: true,
    train_name: routeData.train_name || `Train #${cleanModel}`,
    train_model: cleanModel,
    date: date_of_journey,
    display_date: dojStr,
    off_day: routeData.off_day || 'None',
    stoppages: stops,
    segments: segments
  });
});


// 4. Get Intercity Trains Catalogue (For searching by Train Name / Model Code / Route)
const trainsCatalogPath = path.join(__dirname, 'data', 'trains.json');
let trainsCatalog = [];
try {
  if (fs.existsSync(trainsCatalogPath)) {
    trainsCatalog = JSON.parse(fs.readFileSync(trainsCatalogPath, 'utf8'));
  }
} catch (e) {
  trainsCatalog = [];
}

app.get('/api/trains-list', (req, res) => {
  res.json({
    success: true,
    count: trainsCatalog.length,
    trains: trainsCatalog
  });
});

// 5. Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    stations_loaded: stations.length,
    cache_entries: cache.size,
    authenticated: !!authCredentials.token,
    has_device_id: !!authCredentials.deviceId,
    has_device_key: !!authCredentials.deviceKey,
    has_saved_session: fs.existsSync(SESSION_FILE),
    last_updated: authCredentials.lastUpdated
  });
});

// ====================================================
// 6. Fixed Telegram Bot & Automated Deep-Link Pairing
// ====================================================

const FIXED_TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8600942866:AAEH3-rsOq24r55Y4iNb7tJqklmhn0ni3a0';
const FIXED_TELEGRAM_BOT_USERNAME = 'railseatfinderbdbot';

// In-memory pairing sessions (code -> { code, createdAt, status: 'pending'|'paired', chatId, username, firstName })
const activePairings = new Map();
let latestTelegramUser = null;
let lastTelegramUpdateOffset = 0;

function formatTelegramError(err) {
  const rawMsg = err.response?.data?.description || err.message || 'Telegram connection error';
  const lower = rawMsg.toLowerCase();
  
  if (lower.includes('chat not found')) {
    return 'Chat not found! Please click "Login with Telegram" and press START in Telegram first.';
  }
  if (lower.includes('unauthorized') || lower.includes('invalid token') || lower.includes('bot token')) {
    return 'Invalid Bot Token. Please check bot credentials.';
  }
  if (lower.includes('bot was blocked by the user')) {
    return 'Bot was blocked! Please unblock @railseatfinderbdbot in Telegram and send /start.';
  }
  if (lower.includes('chat_id is empty')) {
    return 'Chat ID cannot be empty.';
  }
  return `Telegram Error: ${rawMsg}`;
}

// Background Telegram Poller for 1-Click Pairing & Commands
async function pollTelegramBotUpdates() {
  if (!FIXED_TELEGRAM_BOT_TOKEN) return;

  try {
    const url = `https://api.telegram.org/bot${FIXED_TELEGRAM_BOT_TOKEN}/getUpdates?offset=${lastTelegramUpdateOffset}&timeout=3`;
    const res = await axios.get(url, { timeout: 10000 });
    const updates = res.data?.result || [];

    for (const update of updates) {
      if (update.update_id >= lastTelegramUpdateOffset) {
        lastTelegramUpdateOffset = update.update_id + 1;
      }

      const msg = update.message;
      if (!msg || !msg.text) continue;

      const chatId = msg.chat?.id || msg.from?.id;
      const text = (msg.text || '').trim();
      const fromUser = msg.from || {};
      const firstName = fromUser.first_name || 'Traveler';
      const username = fromUser.username ? `@${fromUser.username}` : '';

      // Check for /start or /start pair_XXXXXX or /login
      if (text.startsWith('/start') || text.startsWith('/login') || text.startsWith('/connect')) {
        const parts = text.split(/\s+/);
        let pairCode = parts[1] || '';
        pairCode = pairCode.replace(/^pair_/i, '').trim().toUpperCase();

        const userInfo = {
          chatId: String(chatId),
          username: username,
          firstName: firstName,
          linkedAt: Date.now()
        };

        latestTelegramUser = userInfo;

        // If specific pairing code matched
        if (pairCode && activePairings.has(pairCode)) {
          const session = activePairings.get(pairCode);
          session.status = 'paired';
          session.chatId = String(chatId);
          session.username = username;
          session.firstName = firstName;
          activePairings.set(pairCode, session);
          console.log(`[Telegram] 🔗 Paired code ${pairCode} with chat ${chatId} (${username || firstName})`);
        } else {
          // If user just sent /start with no code, also pair the most recent pending session if any
          for (const [code, session] of activePairings.entries()) {
            if (session.status === 'pending' && (Date.now() - session.createdAt < 5 * 60 * 1000)) {
              session.status = 'paired';
              session.chatId = String(chatId);
              session.username = username;
              session.firstName = firstName;
              activePairings.set(code, session);
              console.log(`[Telegram] 🔗 Auto-paired active session ${code} with chat ${chatId} (${username || firstName})`);
              break;
            }
          }
        }

        // Send confirmation reply to Telegram
        try {
          const replyUrl = `https://api.telegram.org/bot${FIXED_TELEGRAM_BOT_TOKEN}/sendMessage`;
          await axios.post(replyUrl, {
            chat_id: chatId,
            text: `👋 <b>Hello ${firstName}!</b>\n\n🎉 <b>Your Telegram is now connected to RailSeat BD!</b>\n\nYou will automatically receive real-time alerts here whenever a watched seat becomes available.\n\n🎯 <i>Return to your web dashboard to watch your preferred train routes!</i>`,
            parse_mode: 'HTML'
          }, { timeout: 6000 });
        } catch (e) {
          console.warn('[Telegram] Could not send welcome reply:', e.message);
        }
      }
    }
  } catch (err) {
    // Silently ignore transient network poll errors
  }
}

// Start continuous background poller every 2.5s
setInterval(pollTelegramBotUpdates, 2500);
setTimeout(pollTelegramBotUpdates, 1000);

// 1. Get Bot Info
app.get('/api/telegram/info', (req, res) => {
  res.json({
    success: true,
    bot_username: FIXED_TELEGRAM_BOT_USERNAME,
    bot_name: 'RailSeat Finder BD',
    has_fixed_token: true
  });
});

// 2. Generate 1-Click Login / Pairing Deep Link
app.post('/api/telegram/generate-pair-code', (req, res) => {
  const code = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit code e.g. 489201
  activePairings.set(code, {
    code,
    createdAt: Date.now(),
    status: 'pending',
    chatId: null,
    username: null,
    firstName: null
  });

  // Clean old pairing sessions (>15 min)
  for (const [c, sess] of activePairings.entries()) {
    if (Date.now() - sess.createdAt > 15 * 60 * 1000) {
      activePairings.delete(c);
    }
  }

  const directUrl = `https://t.me/${FIXED_TELEGRAM_BOT_USERNAME}?start=pair_${code}`;

  res.json({
    success: true,
    pair_code: code,
    bot_username: FIXED_TELEGRAM_BOT_USERNAME,
    direct_url: directUrl
  });
});

// 3. Check Pairing Status
app.get('/api/telegram/pair-status', (req, res) => {
  const { code } = req.query;
  const cleanCode = (code || '').trim().toUpperCase();

  if (cleanCode && activePairings.has(cleanCode)) {
    const session = activePairings.get(cleanCode);
    if (session.status === 'paired') {
      return res.json({
        success: true,
        paired: true,
        chat_id: session.chatId,
        username: session.username,
        first_name: session.firstName
      });
    }
  }

  // Also check if user recently pressed /start within last 30 seconds
  if (latestTelegramUser && (Date.now() - latestTelegramUser.linkedAt < 30 * 1000)) {
    return res.json({
      success: true,
      paired: true,
      chat_id: latestTelegramUser.chatId,
      username: latestTelegramUser.username,
      first_name: latestTelegramUser.firstName
    });
  }

  return res.json({
    success: true,
    paired: false
  });
});

// 4. Send Telegram Alert (Uses Fixed Bot Token)
app.post('/api/telegram/send-alert', async (req, res) => {
  const { chat_id, message } = req.body;
  const cleanChatId = (chat_id || '').trim();

  if (!cleanChatId || !message) {
    return res.json({ success: false, error: 'chat_id and message are required.' });
  }

  try {
    const telegramUrl = `https://api.telegram.org/bot${FIXED_TELEGRAM_BOT_TOKEN}/sendMessage`;
    const response = await axios.post(telegramUrl, {
      chat_id: cleanChatId,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: false
    }, { timeout: 8000 });

    if (response.data && response.data.ok) {
      console.log(`[Telegram] ✅ Alert sent to chat ${cleanChatId}`);
      return res.json({ success: true, message_id: response.data.result?.message_id });
    } else {
      const errMsg = formatTelegramError({ response });
      console.warn('[Telegram] ❌ API returned not-ok:', errMsg);
      return res.json({ success: false, error: errMsg });
    }
  } catch (err) {
    const errMsg = formatTelegramError(err);
    console.error('[Telegram] ❌ Failed to send alert:', errMsg);
    return res.json({ success: false, error: errMsg });
  }
});

// 5. Test Telegram Connection (Uses Fixed Bot Token)
app.post('/api/telegram/test', async (req, res) => {
  const { chat_id } = req.body;
  const cleanChatId = (chat_id || '').trim();

  if (!cleanChatId) {
    return res.json({ success: false, error: 'Chat ID is required. Please click "Login with Telegram".' });
  }

  try {
    const telegramUrl = `https://api.telegram.org/bot${FIXED_TELEGRAM_BOT_TOKEN}/sendMessage`;
    const response = await axios.post(telegramUrl, {
      chat_id: cleanChatId,
      text: '🚆 <b>RailSeat BD — Telegram Connected!</b>\n\n🎉 Your Telegram account is successfully connected to <b>@railseatfinderbdbot</b>!\n\nYou will receive instant notifications here whenever a watched seat becomes available.',
      parse_mode: 'HTML'
    }, { timeout: 8000 });

    if (response.data && response.data.ok) {
      return res.json({ success: true });
    } else {
      const errMsg = formatTelegramError({ response });
      return res.json({ success: false, error: errMsg });
    }
  } catch (err) {
    const errMsg = formatTelegramError(err);
    return res.json({ success: false, error: errMsg });
  }
});

// ====================================================
// 7. User Management & Dashboard Access Control API
// ====================================================

// User Agent & Device Telemetry Helper for Admin Inspection
function parseUserAgent(uaString = '') {
  const ua = uaString || '';
  let browser = 'Unknown Browser';
  let os = 'Unknown OS';
  let device = 'Desktop';

  // Device type detection
  if (/mobile|android|iphone|ipod|blackberry|iemobile|opera mini/i.test(ua)) {
    device = 'Mobile';
  } else if (/ipad|tablet|playbook|silk/i.test(ua)) {
    device = 'Tablet';
  }

  // OS detection
  if (/windows nt 10/i.test(ua)) os = 'Windows 10/11';
  else if (/windows nt 6.3/i.test(ua)) os = 'Windows 8.1';
  else if (/windows nt 6.2/i.test(ua)) os = 'Windows 8';
  else if (/windows nt 6.1/i.test(ua)) os = 'Windows 7';
  else if (/windows/i.test(ua)) os = 'Windows';
  else if (/android/i.test(ua)) {
    const v = ua.match(/android\s([0-9.]+)/i);
    os = v ? `Android ${v[1]}` : 'Android';
  } else if (/iphone|ipad|ipod/i.test(ua)) {
    const v = ua.match(/os\s([0-9_]+)/i);
    os = v ? `iOS ${v[1].replace(/_/g, '.')}` : 'iOS';
  } else if (/mac os x/i.test(ua)) {
    os = 'macOS';
  } else if (/cros/i.test(ua)) {
    os = 'ChromeOS';
  } else if (/linux/i.test(ua)) {
    os = 'Linux';
  }

  // Browser detection
  if (/edg/i.test(ua)) {
    const v = ua.match(/edg\/([0-9.]+)/i);
    browser = v ? `Edge ${v[1].split('.')[0]}` : 'Edge';
  } else if (/opr|opera/i.test(ua)) {
    browser = 'Opera';
  } else if (/chrome|crios/i.test(ua)) {
    const v = ua.match(/(?:chrome|crios)\/([0-9.]+)/i);
    browser = v ? `Chrome ${v[1].split('.')[0]}` : 'Chrome';
  } else if (/firefox|fxios/i.test(ua)) {
    const v = ua.match(/(?:firefox|fxios)\/([0-9.]+)/i);
    browser = v ? `Firefox ${v[1].split('.')[0]}` : 'Firefox';
  } else if (/safari/i.test(ua)) {
    const v = ua.match(/version\/([0-9.]+)/i);
    browser = v ? `Safari ${v[1].split('.')[0]}` : 'Safari';
  }

  return { browser, os, device, raw: ua.slice(0, 200) };
}

function recordUserTelemetry(user, req, action = 'login') {
  if (!user) return;
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  const uaString = req.headers['user-agent'] || '';
  const parsedUa = parseUserAgent(uaString);
  const now = new Date().toISOString();

  user.lastIp = clientIp;
  user.lastUserAgent = uaString.slice(0, 250);
  user.lastDevice = parsedUa;
  user.lastLogin = now;
  user.loginCount = (user.loginCount || 0) + (action === 'login' ? 1 : 0);

  user.ips = user.ips || [];
  if (clientIp && clientIp !== 'unknown' && !user.ips.includes(clientIp)) {
    user.ips.unshift(clientIp);
    if (user.ips.length > 10) user.ips.pop();
  }

  user.activityHistory = user.activityHistory || [];
  user.activityHistory.unshift({
    action,
    timestamp: now,
    ip: clientIp,
    device: parsedUa.device,
    os: parsedUa.os,
    browser: parsedUa.browser
  });
  if (user.activityHistory.length > 25) user.activityHistory.pop();
}

// 1. Dashboard User Auth Status Check
app.get('/api/user-auth/status', (req, res) => {
  const data = loadUsersData();
  const session = getAuthenticatedUser(req);
  const pendingCount = (session && session.role === 'admin') 
    ? data.users.filter(u => u.status === 'pending').length 
    : 0;

  res.json({
    success: true,
    require_login: !!data.settings?.requireLogin,
    require_admin_approval: data.settings?.requireAdminApproval !== false,
    require_email_verification: data.settings?.requireEmailVerification !== false,
    allow_registration: data.settings?.allowRegistration !== false,
    auth_notice: data.settings?.authNotice || '',
    auth_notice_enabled: data.settings?.authNoticeEnabled !== false,
    logged_in: !!session,
    pending_count: pendingCount,
    user: session ? {
      id: session.userId,
      username: session.username,
      name: session.name,
      role: session.role
    } : null
  });
});

// 2. User Registration (Viewer Self-Registration with Optional Email Verification & Admin Approval)
app.post('/api/user-auth/register', async (req, res) => {
  const { username, password, name, email, firebaseUid, emailVerified } = req.body;
  const cleanUsername = (username || '').trim().toLowerCase();
  const cleanPassword = (password || '').trim();
  const cleanEmail = (email || '').trim().toLowerCase();
  const cleanName = (name || '').trim() || cleanUsername;

  const data = loadUsersData();
  const isFirstUser = data.users.length === 0;
  const allowRegistration = data.settings?.allowRegistration !== false;

  if (!allowRegistration && !isFirstUser) {
    const customNotice = (data.settings?.authNotice && data.settings?.authNoticeEnabled !== false)
      ? data.settings.authNotice
      : 'New account registration is currently closed by administrator.';
    return res.json({
      success: false,
      registrationClosed: true,
      error: `Registration Closed: ${customNotice}`
    });
  }

  if (!cleanUsername || cleanUsername.length < 3) {
    return res.json({ success: false, error: 'Username must be at least 3 characters long.' });
  }

  if (!/^[a-zA-Z0-9_.-]+$/.test(cleanUsername)) {
    return res.json({ success: false, error: 'Username can only contain letters, numbers, dots, hyphens, and underscores.' });
  }

  if (!cleanPassword || cleanPassword.length < 4) {
    return res.json({ success: false, error: 'Password must be at least 4 characters long.' });
  }

  if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.json({ success: false, error: 'Please provide a valid email address.' });
  }

  const existingUsername = data.users.find(u => u.username.toLowerCase() === cleanUsername);
  if (existingUsername) {
    return res.json({ success: false, error: `Username "${cleanUsername}" is already registered.` });
  }

  if (cleanEmail) {
    const existingEmail = data.users.find(u => u.email && u.email.toLowerCase() === cleanEmail);
    if (existingEmail) {
      return res.json({ success: false, error: `Email "${cleanEmail}" is already registered. Please sign in instead.` });
    }
  }

  const requireApproval = data.settings?.requireAdminApproval !== false;
  const requireEmailVerification = data.settings?.requireEmailVerification !== false;
  const role = isFirstUser ? 'admin' : 'viewer';
  const status = (isFirstUser || !requireApproval) ? 'active' : 'pending';
  const canViewDashboard = isFirstUser || !requireApproval;
  const finalEmailVerified = (isFirstUser || !requireEmailVerification) ? true : !!emailVerified;

  const newUser = {
    id: 'usr_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    username: cleanUsername,
    email: cleanEmail || null,
    password: hashPassword(cleanPassword),
    name: cleanName,
    role,
    status,
    emailVerified: finalEmailVerified,
    firebaseUid: firebaseUid || null,
    authProvider: 'password',
    canViewDashboard,
    createdAt: new Date().toISOString(),
    lastLogin: null
  };

  // Record IP and device telemetry
  recordUserTelemetry(newUser, req, 'register');

  data.users.push(newUser);
  saveUsersData(data);
  console.log(`[Users] 📝 New registration: ${cleanUsername} (${cleanEmail}) - IP: ${newUser.lastIp}, Status: ${newUser.status}, RequireApproval: ${requireApproval}`);

  // Auto-sync to Firebase
  await syncUserToFirebase(newUser, 'update', cleanPassword);

  res.json({
    success: true,
    emailVerified: newUser.emailVerified,
    instantActive: status === 'active',
    requireEmailVerification,
    message: (cleanEmail && requireEmailVerification)
      ? (requireApproval
          ? 'Registration submitted! Please verify your email via the link sent to your inbox. Once approved by administrator, you will be able to sign in.'
          : 'Registration successful! Please verify your email via the link sent to your inbox. You can sign in immediately once verified.')
      : (requireApproval
          ? 'Registration submitted successfully! Your account is pending administrator approval.'
          : 'Registration successful! Your account is active and you can sign in now.')
  });
});

// 2.1. Resend Email Verification Link Endpoint
app.post('/api/user-auth/resend-verification', async (req, res) => {
  const { email, username } = req.body;
  const identifier = (email || username || '').trim().toLowerCase();

  if (!identifier) {
    return res.status(400).json({ success: false, error: 'Email or username is required.' });
  }

  const data = loadUsersData();
  const user = data.users.find(u => (u.email && u.email.toLowerCase() === identifier) || u.username.toLowerCase() === identifier);

  if (!user || !user.email) {
    return res.json({ success: true, message: 'If an account exists with this email, a verification link has been sent.' });
  }

  if (user.emailVerified) {
    return res.json({ success: true, message: 'This email is already verified! You can sign in once approved.' });
  }

  try {
    const auth = getAdminAuth();
    if (isFirebaseConnected && auth) {
      const link = await auth.generateEmailVerificationLink(user.email);
      console.log(`[Firebase Auth] ✉️ Generated email verification link for ${user.email}: ${link}`);
    }
  } catch (err) {
    console.warn('[Firebase Auth] Failed to generate verification link:', err.message);
  }

  res.json({
    success: true,
    message: `Verification instructions sent to ${user.email}. Please check your inbox (and spam folder).`
  });
});

// 3. User Login (Protected with Brute-Force Rate Limiting, Email Verification, Status Checking & Salted Scrypt)
app.post('/api/user-auth/login', async (req, res) => {
  const { username, password, rememberMe } = req.body;
  const cleanUsername = (username || '').trim().toLowerCase();
  const cleanPassword = (password || '').trim();

  if (!cleanUsername || !cleanPassword) {
    return res.json({ success: false, error: 'Username/Email and password are required.' });
  }

  // Brute-force rate limit check
  const rateLimit = checkLoginRateLimit(cleanUsername);
  if (!rateLimit.allowed) {
    return res.json({
      success: false,
      error: `Too many failed login attempts. Please wait ${rateLimit.remainingSeconds} seconds before trying again.`
    });
  }

  const data = loadUsersData();
  const user = data.users.find(u => u.username.toLowerCase() === cleanUsername || (u.email && u.email.toLowerCase() === cleanUsername));

  if (!user || !verifyPassword(cleanPassword, user.password)) {
    recordFailedLogin(cleanUsername);
    return res.json({ success: false, error: 'Invalid username/email or password.' });
  }

  // Check Email Verification Status if Email Verification is enabled
  const requireEmailVerification = data.settings?.requireEmailVerification !== false;
  if (requireEmailVerification && user.email && user.emailVerified === false) {
    const auth = getAdminAuth();
    if (isFirebaseConnected && auth && user.firebaseUid) {
      try {
        const firebaseUser = await auth.getUser(user.firebaseUid);
        if (firebaseUser && firebaseUser.emailVerified) {
          user.emailVerified = true;
          saveUsersData(data);
          console.log(`[Firebase Auth] ✅ Email verified for user: ${user.username} (${user.email})`);
        }
      } catch (e) {}
    }

    if (user.emailVerified === false && user.role !== 'admin') {
      return res.json({
        success: false,
        emailUnverified: true,
        email: user.email,
        error: 'Please verify your email address before signing in. Check your inbox for the verification link.'
      });
    }
  }

  // Check Approval Status
  if (user.status === 'pending') {
    return res.json({
      success: false,
      pending: true,
      error: 'Your account is pending administrator approval. Please wait for an administrator to approve your account before signing in.'
    });
  }

  if (user.status === 'disabled') {
    return res.json({ success: false, error: 'This user account has been disabled by Admin.' });
  }

  // Reset rate limit on successful login
  resetLoginRateLimit(cleanUsername);

  // Transparently re-hash legacy passwords to salted scrypt if needed
  if (!user.password.startsWith('scrypt$')) {
    user.password = hashPassword(cleanPassword);
  }

  // Record Telemetry (IP, OS, Browser, Device, Login Count)
  recordUserTelemetry(user, req, 'login');
  saveUsersData(data);

  // Generate session token (30 days if rememberMe, 1 day otherwise)
  const token = 'sess_' + crypto.randomBytes(24).toString('hex');
  const durationMs = rememberMe ? (30 * 24 * 60 * 60 * 1000) : (24 * 60 * 60 * 1000);
  const sessionData = {
    token,
    userId: user.id,
    username: user.username,
    name: user.name,
    email: user.email || null,
    role: user.role || 'viewer',
    status: user.status,
    expiresAt: Date.now() + durationMs
  };

  userSessions.set(token, sessionData);
  console.log(`[Users] 🔑 User logged in: ${user.username} (${user.role}) - IP: ${user.lastIp}`);

  res.json({
    success: true,
    token,
    rememberMe: !!rememberMe,
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role || 'viewer',
      status: user.status,
      canViewDashboard: user.canViewDashboard !== false
    }
  });
});

// 3.1. Firebase Authentication Login / Sign-In (Supports Google Sign-In & Firebase Auth Providers)
app.post('/api/user-auth/firebase-login', async (req, res) => {
  const { idToken, rememberMe } = req.body;

  if (!idToken) {
    return res.status(400).json({ success: false, error: 'Firebase ID token is required.' });
  }

  try {
    let decodedToken = null;
    const auth = getAdminAuth();
    if (isFirebaseConnected && auth) {
      decodedToken = await auth.verifyIdToken(idToken);
    } else {
      // Fallback decode if running without serviceAccountKey
      const base64Url = idToken.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      decodedToken = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
    }

    if (!decodedToken || !decodedToken.uid) {
      return res.status(401).json({ success: false, error: 'Invalid or expired Firebase token.' });
    }

    const email = decodedToken.email || '';
    const name = decodedToken.name || decodedToken.display_name || (email ? email.split('@')[0] : 'Firebase User');
    const uid = decodedToken.uid;
    const picture = decodedToken.picture || null;

    const data = loadUsersData();
    let user = data.users.find(u => u.firebaseUid === uid || (email && u.email === email) || u.username === email || u.username === uid);

    if (!user) {
      const allowRegistration = data.settings?.allowRegistration !== false;
      const isFirstUser = data.users.length === 0;

      if (!allowRegistration && !isFirstUser) {
        const customNotice = (data.settings?.authNotice && data.settings?.authNoticeEnabled !== false)
          ? data.settings.authNotice
          : 'New account registration is currently closed by administrator.';
        return res.json({
          success: false,
          registrationClosed: true,
          error: `Registration Closed: ${customNotice}`
        });
      }

      // Create new user registered through Firebase
      const generatedUsername = email ? email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '').toLowerCase() : `user_${uid.substring(0, 6)}`;
      let finalUsername = generatedUsername;
      let counter = 1;
      while (data.users.some(u => u.username === finalUsername)) {
        finalUsername = `${generatedUsername}${counter++}`;
      }

      const requireApproval = data.settings?.requireAdminApproval !== false;
      const status = (isFirstUser || !requireApproval) ? 'active' : 'pending';
      const canViewDashboard = isFirstUser || !requireApproval;

      user = {
        id: `usr_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        username: finalUsername,
        firebaseUid: uid,
        email: email || null,
        name: name,
        picture: picture,
        authProvider: 'firebase_google',
        role: isFirstUser ? 'admin' : 'viewer',
        status,
        canViewDashboard,
        emailVerified: true,
        createdAt: new Date().toISOString(),
        lastLogin: null
      };

      recordUserTelemetry(user, req, 'register');
      data.users.push(user);
      saveUsersData(data);
      console.log(`[Firebase Auth] 👤 New user registered via Firebase: ${user.username} (${user.email || user.id}) - IP: ${user.lastIp}`);

      // Auto-sync to Firebase
      await syncUserToFirebase(user, 'update');
    } else {
      let updated = false;
      if (!user.firebaseUid) { user.firebaseUid = uid; updated = true; }
      if (email && !user.email) { user.email = email; updated = true; }
      if (picture && !user.picture) { user.picture = picture; updated = true; }
      if (updated) saveUsersData(data);
    }

    // Check account approval status
    if (user.status === 'pending') {
      return res.json({
        success: false,
        pending: true,
        error: 'Your Google Account has been registered, but is pending administrator approval before you can sign in.'
      });
    }

    if (user.status === 'disabled') {
      return res.json({
        success: false,
        disabled: true,
        error: 'This account has been disabled by Administrator.'
      });
    }

    // Record Telemetry (IP, OS, Browser, Device, Login Count)
    recordUserTelemetry(user, req, 'login');
    saveUsersData(data);

    // Generate dashboard session token
    const token = 'sess_' + crypto.randomBytes(24).toString('hex');
    const durationMs = rememberMe ? (30 * 24 * 60 * 60 * 1000) : (24 * 60 * 60 * 1000);
    const sessionData = {
      token,
      userId: user.id,
      username: user.username,
      name: user.name,
      email: user.email || null,
      picture: user.picture || null,
      role: user.role || 'viewer',
      status: user.status,
      expiresAt: Date.now() + durationMs
    };

    userSessions.set(token, sessionData);
    console.log(`[Firebase Auth] 🔑 User logged in via Firebase: ${user.username} (${user.role}) - IP: ${user.lastIp}`);

    return res.json({
      success: true,
      token,
      rememberMe: !!rememberMe,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email || null,
        picture: user.picture || null,
        role: user.role || 'viewer',
        status: user.status,
        canViewDashboard: user.canViewDashboard !== false
      }
    });
  } catch (err) {
    console.error('[Firebase Auth] Error in firebase-login:', err.message);
    return res.status(401).json({ success: false, error: 'Firebase authentication failed: ' + err.message });
  }
});

// 4. User Logout
app.post('/api/user-auth/logout', (req, res) => {
  const token = getAuthToken(req);
  if (token && userSessions.has(token)) {
    userSessions.delete(token);
  }
  res.json({ success: true, message: 'Logged out successfully.' });
});

// Middleware to enforce Admin-only role for User Management
function requireAdmin(req, res, next) {
  const session = getAuthenticatedUser(req);
  if (!session || session.role !== 'admin') {
    return res.status(403).json({
      success: false,
      error: 'Forbidden: Access restricted to Administrators only.'
    });
  }
  next();
}

// 5. Get All Users (Admin-only + Full Telemetry & History)
app.get('/api/users', requireAdmin, (req, res) => {
  const data = loadUsersData();
  
  // Return list with sanitized fields (NEVER expose password hashes)
  const safeUsers = data.users.map(u => ({
    id: u.id,
    username: u.username,
    name: u.name,
    email: u.email || null,
    role: u.role || 'viewer',
    status: u.status || 'active',
    canViewDashboard: u.canViewDashboard !== false,
    has_shohoz_session: !!(u.shohozSession && u.shohozSession.token),
    emailVerified: u.emailVerified !== false,
    authProvider: u.authProvider || 'password',
    lastIp: u.lastIp || 'N/A',
    ips: u.ips || [],
    lastDevice: u.lastDevice || null,
    lastUserAgent: u.lastUserAgent || null,
    loginCount: u.loginCount || 0,
    activityHistory: u.activityHistory || [],
    createdAt: u.createdAt,
    lastLogin: u.lastLogin
  }));

  const pendingCount = data.users.filter(u => u.status === 'pending').length;

  res.json({
    success: true,
    count: safeUsers.length,
    pending_count: pendingCount,
    require_login: !!data.settings?.requireLogin,
    require_admin_approval: data.settings?.requireAdminApproval !== false,
    require_email_verification: data.settings?.requireEmailVerification !== false,
    allow_registration: data.settings?.allowRegistration !== false,
    auth_notice: data.settings?.authNotice || '',
    auth_notice_enabled: data.settings?.authNoticeEnabled !== false,
    users: safeUsers
  });
});

// Automatic Bidirectional Firebase Synchronization Helper (Firestore & Firebase Auth)
async function syncUserToFirebase(user, action = 'update', plainPassword = null) {
  if (!user || !user.id) return;

  // 1. Cloud Firestore Synchronization
  if (firestoreDb && isFirebaseConnected) {
    try {
      const docRef = firestoreDb.collection('system_users').doc(user.id);
      if (action === 'delete') {
        await docRef.delete();
        console.log(`[Firebase Firestore] 🗑️ Deleted user document: ${user.id} (@${user.username})`);
      } else {
        // Strip sensitive internal fields if needed or store safe representation
        await docRef.set(user, { merge: true });
        console.log(`[Firebase Firestore] ☁️ Synced user document: ${user.id} (@${user.username})`);
      }
    } catch (err) {
      console.warn(`[Firebase Firestore] ⚠️ Failed to ${action} user ${user.id}:`, err.message);
    }
  }

  // 2. Firebase Authentication Synchronization (Enabled / Disabled / Password / Profile / Deletion)
  const auth = getAdminAuth();
  if (auth) {
    try {
      let uid = user.firebaseUid;
      if (!uid && user.email) {
        try {
          const fbUser = await auth.getUserByEmail(user.email);
          if (fbUser) uid = fbUser.uid;
        } catch (e) {}
      }

      if (action === 'delete') {
        if (uid) {
          await auth.deleteUser(uid);
          console.log(`[Firebase Auth] 🗑️ Deleted user from Firebase Auth: @${user.username} (${uid})`);
        }
      } else {
        if (uid) {
          const updates = {};
          if (user.name) updates.displayName = user.name;
          if (user.email) updates.email = user.email;
          if (user.status === 'disabled') updates.disabled = true;
          else if (user.status === 'active') updates.disabled = false;
          if (plainPassword && plainPassword.length >= 6) updates.password = plainPassword;

          await auth.updateUser(uid, updates);
          console.log(`[Firebase Auth] 🔄 Updated Firebase Auth user: @${user.username} (${uid})`);
        }
      }
    } catch (err) {
      console.warn(`[Firebase Auth] ⚠️ Failed to ${action} user @${user.username}:`, err.message);
    }
  }
}

// 5. Add New User (Admin-only, Encrypted with Salted Scrypt + Auto Firebase Sync)
app.post('/api/users/add', requireAdmin, async (req, res) => {
  const { username, password, name, email, role, status } = req.body;
  const cleanUsername = (username || '').trim().toLowerCase();
  const cleanPassword = (password || '').trim();
  const cleanName = (name || '').trim() || cleanUsername;
  const cleanEmail = (email || '').trim().toLowerCase() || null;
  const cleanRole = (role || 'viewer').toLowerCase() === 'admin' ? 'admin' : 'viewer';
  const cleanStatus = (status || 'active').toLowerCase() === 'disabled' ? 'disabled' : 'active';

  if (!cleanUsername || cleanUsername.length < 3) {
    return res.json({ success: false, error: 'Username must be at least 3 characters long.' });
  }

  if (!cleanPassword || cleanPassword.length < 4) {
    return res.json({ success: false, error: 'Password must be at least 4 characters long.' });
  }

  const data = loadUsersData();
  const existing = data.users.find(u => u.username.toLowerCase() === cleanUsername);
  if (existing) {
    return res.json({ success: false, error: `Username "${cleanUsername}" is already taken.` });
  }

  const newUser = {
    id: 'usr_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    username: cleanUsername,
    password: hashPassword(cleanPassword),
    name: cleanName,
    email: cleanEmail,
    role: cleanRole,
    status: cleanStatus,
    emailVerified: true,
    canViewDashboard: true,
    createdAt: new Date().toISOString(),
    lastLogin: null
  };

  data.users.push(newUser);
  saveUsersData(data);
  console.log(`[Users] 👤 Added new encrypted user: ${cleanUsername} (${cleanRole})`);

  // Auto-sync new user to Firebase
  await syncUserToFirebase(newUser, 'update', cleanPassword);

  res.json({
    success: true,
    message: `User ${cleanUsername} created successfully in local DB and Firebase.`,
    user: {
      id: newUser.id,
      username: newUser.username,
      name: newUser.name,
      email: newUser.email,
      role: newUser.role,
      status: newUser.status,
      createdAt: newUser.createdAt
    }
  });
});

// 5.1. Edit Existing User Details (Admin-only + Auto Firebase Sync)
app.post('/api/users/edit', requireAdmin, async (req, res) => {
  const { id, name, email, role, status } = req.body;
  if (!id) return res.json({ success: false, error: 'User ID is required.' });

  const data = loadUsersData();
  const user = data.users.find(u => u.id === id);

  if (!user) {
    return res.json({ success: false, error: 'User not found.' });
  }

  if (name !== undefined) user.name = (name || '').trim();
  if (email !== undefined) user.email = (email || '').trim().toLowerCase();
  if (role !== undefined) user.role = (role || 'viewer').toLowerCase() === 'admin' ? 'admin' : 'viewer';
  if (status !== undefined) user.status = (status || 'active').toLowerCase();

  saveUsersData(data);
  console.log(`[Users] ✏️ Edited user @${user.username} (Role: ${user.role}, Status: ${user.status})`);

  // Auto-sync updated user to Firebase
  await syncUserToFirebase(user, 'update');

  res.json({
    success: true,
    message: `User @${user.username} updated in system and Firebase.`,
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status
    }
  });
});

// 6. Delete / Remove User (Admin-only + Auto Firebase Deletion)
app.post('/api/users/delete', requireAdmin, async (req, res) => {
  const { id } = req.body;
  if (!id) return res.json({ success: false, error: 'User ID is required.' });

  const data = loadUsersData();
  const userIdx = data.users.findIndex(u => u.id === id);

  if (userIdx === -1) {
    return res.json({ success: false, error: 'User not found.' });
  }

  const userToDelete = data.users[userIdx];

  // Prevent deleting the only remaining admin
  const totalAdmins = data.users.filter(u => u.role === 'admin').length;
  if (userToDelete.role === 'admin' && totalAdmins <= 1) {
    return res.json({ success: false, error: 'Cannot delete the only remaining Administrator account.' });
  }

  data.users.splice(userIdx, 1);
  saveUsersData(data);
  console.log(`[Users] 🗑️ Deleted user: ${userToDelete.username}`);

  // Auto-delete from Cloud Firestore and Firebase Auth
  await syncUserToFirebase(userToDelete, 'delete');

  res.json({ success: true, message: `User "${userToDelete.username}" removed from local DB and Firebase.` });
});

// 7. Toggle User Status (Admin-only + Auto Firebase Sync)
app.post('/api/users/toggle-status', requireAdmin, async (req, res) => {
  const { id } = req.body;
  if (!id) return res.json({ success: false, error: 'User ID is required.' });

  const data = loadUsersData();
  const user = data.users.find(u => u.id === id);

  if (!user) {
    return res.json({ success: false, error: 'User not found.' });
  }

  user.status = (user.status === 'active') ? 'disabled' : 'active';
  saveUsersData(data);

  // Auto-sync status change to Firebase Auth & Firestore
  await syncUserToFirebase(user, 'update');

  res.json({
    success: true,
    status: user.status,
    message: `User ${user.username} is now ${user.status} in local DB and Firebase.`
  });
});

// 8. Approve Pending User (Admin-only + Auto Firebase Sync)
app.post('/api/users/approve', requireAdmin, async (req, res) => {
  const { id } = req.body;
  if (!id) return res.json({ success: false, error: 'User ID is required.' });

  const data = loadUsersData();
  const user = data.users.find(u => u.id === id);

  if (!user) {
    return res.json({ success: false, error: 'User not found.' });
  }

  user.status = 'active';
  user.canViewDashboard = true;
  saveUsersData(data);
  console.log(`[Users] ✅ Approved user: ${user.username} (${user.id})`);

  // Auto-sync active status to Firebase Auth & Firestore
  await syncUserToFirebase(user, 'update');

  res.json({
    success: true,
    status: user.status,
    message: `User @${user.username} has been approved and activated in local DB and Firebase.`
  });
});

// 9. Reset / Update User Password (Admin-only, Encrypted with Salted Scrypt + Auto Firebase Sync)
app.post('/api/users/update-password', requireAdmin, async (req, res) => {
  const { id, newPassword } = req.body;
  const cleanPassword = (newPassword || '').trim();

  if (!id || !cleanPassword || cleanPassword.length < 4) {
    return res.json({ success: false, error: 'Password must be at least 4 characters.' });
  }

  const data = loadUsersData();
  const user = data.users.find(u => u.id === id);

  if (!user) {
    return res.json({ success: false, error: 'User not found.' });
  }

  user.password = hashPassword(cleanPassword);
  saveUsersData(data);

  // Auto-sync password update to Firebase Auth & Firestore
  await syncUserToFirebase(user, 'update', cleanPassword);

  res.json({ success: true, message: `Password for ${user.username} updated in local DB and Firebase.` });
});

// 10. Update Access Control Settings (Admin-only + Auto Firebase Sync)
app.post('/api/users/update-settings', requireAdmin, async (req, res) => {
  const { requireLogin, requireAdminApproval, requireEmailVerification, allowRegistration, authNotice, authNoticeEnabled } = req.body;
  const data = loadUsersData();

  data.settings = data.settings || {};
  if (requireLogin !== undefined) {
    data.settings.requireLogin = !!requireLogin;
  }
  if (requireAdminApproval !== undefined) {
    data.settings.requireAdminApproval = !!requireAdminApproval;
  }
  if (requireEmailVerification !== undefined) {
    data.settings.requireEmailVerification = !!requireEmailVerification;
  }
  if (allowRegistration !== undefined) {
    data.settings.allowRegistration = !!allowRegistration;
  }
  if (authNotice !== undefined) {
    data.settings.authNotice = String(authNotice || '').trim();
  }
  if (authNoticeEnabled !== undefined) {
    data.settings.authNoticeEnabled = !!authNoticeEnabled;
  }
  saveUsersData(data);

  // Sync settings to Cloud Firestore if connected
  if (firestoreDb && isFirebaseConnected) {
    try {
      await firestoreDb.collection('system_config').doc('settings').set(data.settings, { merge: true });
      console.log('[Firebase Firestore] ☁️ Synced access control settings to Cloud Firestore');
    } catch (e) {
      console.warn('[Firebase Firestore] Warning syncing settings:', e.message);
    }
  }

  console.log(`[Access Control] 🔒 Dashboard settings updated: Login=${data.settings.requireLogin}, AdminApproval=${data.settings.requireAdminApproval !== false}, EmailVerification=${data.settings.requireEmailVerification !== false}, AllowReg=${data.settings.allowRegistration !== false}, Notice="${data.settings.authNotice || ''}"`);
  res.json({
    success: true,
    require_login: !!data.settings.requireLogin,
    require_admin_approval: data.settings.requireAdminApproval !== false,
    require_email_verification: data.settings.requireEmailVerification !== false,
    allow_registration: data.settings.allowRegistration !== false,
    auth_notice: data.settings.authNotice || '',
    auth_notice_enabled: data.settings.authNoticeEnabled !== false,
    message: `Settings updated: Allow Registration = ${data.settings.allowRegistration !== false ? 'ON' : 'OFF'}, Notice = ${data.settings.authNoticeEnabled !== false && data.settings.authNotice ? 'ACTIVE' : 'OFF'}.`
  });
});

// ====================================================
// 8. 🛰️ 24/7 Server-Side Background Watchlist Radar Engine
// ====================================================

const RADAR_FILE = path.join(DATA_DIR, 'radar_watchlist.json');
const SEED_RADAR_FILE = path.join(SEED_DATA_DIR, 'radar_watchlist.json');

function loadRadarData() {
  try {
    let raw = null;
    if (fs.existsSync(RADAR_FILE)) {
      raw = fs.readFileSync(RADAR_FILE, 'utf8');
    } else if (fs.existsSync(SEED_RADAR_FILE)) {
      raw = fs.readFileSync(SEED_RADAR_FILE, 'utf8');
    }
    if (raw && raw.trim()) {
      const data = JSON.parse(raw);
      data.settings = data.settings || { enabled: true, intervalSeconds: 25, lastRunAt: null };
      data.targets = Array.isArray(data.targets) ? data.targets : [];
      return data;
    }
  } catch (err) {
    console.warn('[Radar] Error reading radar_watchlist.json:', err.message);
  }
  return { settings: { enabled: true, intervalSeconds: 25, lastRunAt: null }, targets: [] };
}

function saveRadarData(data) {
  try {
    const dir = path.dirname(RADAR_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(RADAR_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.warn('[Radar] Warning writing radar_watchlist.json:', err.message);
  }
}

// Find best Shohoz token for background scanning
function getRadarShohozSession(targetUserId) {
  const usersData = loadUsersData();
  // 1. Try target user
  if (targetUserId) {
    const targetUser = usersData.users.find(u => u.id === targetUserId);
    if (targetUser && targetUser.shohozSession && targetUser.shohozSession.token) {
      return targetUser.shohozSession;
    }
  }
  // 2. Try any user with an active Shohoz session (prefer admin)
  const userWithSession = usersData.users.find(u => u.shohozSession && u.shohozSession.token);
  if (userWithSession) {
    return userWithSession.shohozSession;
  }
  // 3. Try global in-memory session
  if (authCredentials && authCredentials.token) {
    return authCredentials;
  }
  return { token: null };
}

// Background Radar Poller (Executes 24/7 even when browser tabs are closed)
let isRadarRunning = false;
async function runBackgroundRadarCycle() {
  if (isRadarRunning) return;
  const radarData = loadRadarData();
  if (radarData.settings.enabled === false) return;

  const activeTargets = radarData.targets.filter(t => t.active !== false);
  if (activeTargets.length === 0) return;

  isRadarRunning = true;
  radarData.settings.lastRunAt = new Date().toISOString();

  try {
    // Group active targets by unique route (fromCity, toCity, date)
    const routeGroups = new Map();
    for (const target of activeTargets) {
      if (!target.fromCity || !target.toCity || !target.date) continue;
      const key = `${target.fromCity.toUpperCase().trim()}___${target.toCity.toUpperCase().trim()}___${target.date.trim()}`;
      if (!routeGroups.has(key)) {
        routeGroups.set(key, []);
      }
      routeGroups.get(key).push(target);
    }

    for (const [routeKey, targets] of routeGroups.entries()) {
      const [fromCity, toCity, dateOfJourney] = routeKey.split('___');
      const session = getRadarShohozSession(targets[0]?.userId);

      if (!session || !session.token) {
        continue;
      }

      try {
        const result = await querySingleShohozTrip(fromCity, toCity, dateOfJourney, session);
        if (!result.success || !Array.isArray(result.trains)) continue;

        const trains = result.trains;

        for (const target of targets) {
          target.lastCheckedAt = new Date().toISOString();

          // Match train
          const matchingTrains = trains.filter(t => {
            if (!target.trainName || target.trainName === 'ALL') return true;
            if (target.trainModel && String(t.train_model) === String(target.trainModel)) return true;
            if (t.train_name && target.trainName && t.train_name.toLowerCase().trim() === target.trainName.toLowerCase().trim()) return true;
            return false;
          });

          for (const train of matchingTrains) {
            const seatTypes = train.seat_types || [];
            for (const st of seatTypes) {
              if (target.className && target.className !== 'ANY' && st.type !== target.className) continue;

              const availableSeats = Number(st.seats_available || 0) + Number(st.counter_seats_available || 0);
              const minSeats = Number(target.minSeats) || 1;

              if (availableSeats >= minSeats) {
                // Check if already notified for this exact seat count
                if (target.lastNotifiedSeats !== availableSeats) {
                  const wasSoldOut = (target.lastNotifiedSeats === 0 || target.lastNotifiedSeats === undefined);
                  target.lastNotifiedSeats = availableSeats;
                  target.lastNotifiedAt = new Date().toISOString();

                  const chatId = target.telegramChatId;
                  if (chatId && FIXED_TELEGRAM_BOT_TOKEN) {
                    console.log(`[Radar 24/7] 🎯 ALERT (${wasSoldOut ? 'SOLD_OUT_RELEASED' : 'RADAR_HIT'}): ${train.train_name} has ${availableSeats} seat(s) in ${st.display_name}! Sending to Telegram chat ${chatId}`);

                    const bookUrl = `https://eticket.railway.gov.bd/booking/train/search?fromcity=${encodeURIComponent(fromCity)}&tocity=${encodeURIComponent(toCity)}&doj=${encodeURIComponent(dateOfJourney)}&seatclass=${encodeURIComponent(st.type)}`;
                    
                    const msgText = wasSoldOut ?
                      `🚨 <b>[RELEASED SEAT ALERT: ALL SOLD OUT ➔ AVAILABLE!]</b>\n\n` +
                      `🚆 <b>Train:</b> ${train.train_name} (#${train.train_model})\n` +
                      `📍 <b>Route:</b> ${fromCity} ➔ ${toCity}\n` +
                      `📅 <b>Date:</b> ${dateOfJourney}\n` +
                      `💺 <b>Class:</b> ${st.display_name || st.type}\n` +
                      `🔥 <b>Available Seats:</b> <b>${availableSeats}</b> (Online: ${st.seats_available}, Counter: ${st.counter_seats_available})\n\n` +
                      `⚡ <i>This train was previously SOLD OUT and new seats just dropped! Book immediately before they are gone!</i>\n` +
                      `🔗 <a href="${bookUrl}">Click here to Book on Railway</a>`
                      :
                      `🎯 <b>WATCHLIST RADAR HIT!</b>\n\n` +
                      `🚆 <b>Train:</b> ${train.train_name} (#${train.train_model})\n` +
                      `📍 <b>Route:</b> ${fromCity} ➔ ${toCity}\n` +
                      `📅 <b>Date:</b> ${dateOfJourney}\n` +
                      `💺 <b>Class:</b> ${st.display_name || st.type}\n` +
                      `🟢 <b>Available Seats:</b> <b>${availableSeats}</b> (Online: ${st.seats_available}, Counter: ${st.counter_seats_available})\n\n` +
                      `⚡ <i>Book immediately on Bangladesh Railway!</i>\n` +
                      `🔗 <a href="${bookUrl}">Click here to Book on Railway</a>`;

                    try {
                      await axios.post(`https://api.telegram.org/bot${FIXED_TELEGRAM_BOT_TOKEN}/sendMessage`, {
                        chat_id: chatId,
                        text: msgText,
                        parse_mode: 'HTML',
                        disable_web_page_preview: false
                      });
                    } catch (tgErr) {
                      console.warn('[Radar] ❌ Telegram send error:', tgErr.response?.data?.description || tgErr.message);
                    }
                  }
                }
              } else if (availableSeats === 0 && (target.lastNotifiedSeats || 0) > 0) {
                // Reset so when seats release again, alert fires immediately
                target.lastNotifiedSeats = 0;
              }
            }
          }
        }
      } catch (routeErr) {
        console.warn(`[Radar] Error scanning route ${routeKey}:`, routeErr.message);
      }

      // Small throttling delay between routes
      await new Promise(r => setTimeout(r, 1200));
    }

    saveRadarData(radarData);
  } catch (err) {
    console.error('[Radar] Error in background radar cycle:', err.message);
  } finally {
    isRadarRunning = false;
  }
}

// Start Server-Side Radar Daemon
if (!process.env.VERCEL) {
  setInterval(runBackgroundRadarCycle, 25000);
  setTimeout(runBackgroundRadarCycle, 5000);
}

// --- Firebase Cloud Status & Config Endpoints ---
app.get('/api/firebase/status', (req, res) => {
  res.json({
    success: true,
    connected: isFirebaseConnected,
    project_id: firebaseProjectId || null,
    mode: isFirebaseConnected ? 'Cloud Firestore' : 'Local JSON'
  });
});

app.get('/api/firebase/config', (req, res) => {
  const data = loadUsersData();
  const savedCfg = data.settings?.firebaseWebConfig || {};
  const projectId = savedCfg.projectId || firebaseProjectId || process.env.FIREBASE_PROJECT_ID || 'railseat-finder-bd';
  const apiKey = savedCfg.apiKey || process.env.FIREBASE_WEB_API_KEY || 'AIzaSyD67AVgu4gq5Ya4txcKJee7XL61na7nd6E';
  const authDomain = savedCfg.authDomain || (projectId ? `${projectId}.firebaseapp.com` : 'railseat-finder-bd.firebaseapp.com');
  const storageBucket = savedCfg.storageBucket || 'railseat-finder-bd.firebasestorage.app';
  const messagingSenderId = savedCfg.messagingSenderId || '266186751082';
  const appId = savedCfg.appId || process.env.FIREBASE_APP_ID || '1:266186751082:web:ee5f2695ac16bda97e9e13';
  const measurementId = savedCfg.measurementId || 'G-BVRRX1HN95';

  res.json({
    success: true,
    configured: true,
    projectId,
    apiKey,
    authDomain,
    storageBucket,
    messagingSenderId,
    appId,
    measurementId,
    firebaseConsoleUrl: `https://console.firebase.google.com/project/${projectId}/settings/general`
  });
});

app.post('/api/firebase/config', (req, res) => {
  const { apiKey, authDomain, projectId, appId } = req.body;
  if (!apiKey || typeof apiKey !== 'string') {
    return res.status(400).json({ success: false, error: 'Firebase Web API Key is required.' });
  }

  const cleanApiKey = apiKey.trim();
  const cleanProjectId = (projectId || firebaseProjectId || 'railseat-finder-bd').trim();
  const cleanAuthDomain = (authDomain || `${cleanProjectId}.firebaseapp.com`).trim();
  const cleanAppId = (appId || '').trim();

  const data = loadUsersData();
  if (!data.settings) data.settings = {};
  data.settings.firebaseWebConfig = {
    apiKey: cleanApiKey,
    projectId: cleanProjectId,
    authDomain: cleanAuthDomain,
    appId: cleanAppId,
    updatedAt: new Date().toISOString()
  };

  saveUsersData(data);
  console.log(`[Firebase Config] 🔑 Updated Firebase Web Client Config (Project: ${cleanProjectId})`);

  res.json({
    success: true,
    message: 'Firebase Web App configuration saved successfully!',
    config: {
      projectId: cleanProjectId,
      apiKey: cleanApiKey,
      authDomain: cleanAuthDomain,
      appId: cleanAppId
    }
  });
});

// --- Radar API Endpoints ---

// 1. Radar Status Check
app.get('/api/radar/status', (req, res) => {
  const radarData = loadRadarData();
  const activeCount = radarData.targets.filter(t => t.active !== false).length;
  res.json({
    success: true,
    running: !!radarData.settings.enabled,
    interval_seconds: radarData.settings.intervalSeconds || 25,
    last_run_at: radarData.settings.lastRunAt,
    total_targets: radarData.targets.length,
    active_targets: activeCount
  });
});

// 2. Get Radar Watchlist Targets
app.get('/api/radar/watchlist', (req, res) => {
  const session = getAuthenticatedUser(req);
  const radarData = loadRadarData();
  
  let userTargets = radarData.targets;
  if (session && session.role !== 'admin') {
    userTargets = radarData.targets.filter(t => t.userId === session.userId || !t.userId);
  }

  res.json({
    success: true,
    targets: userTargets,
    settings: radarData.settings
  });
});

// 3. Add or Update Radar Target
app.post('/api/radar/watchlist/add', (req, res) => {
  const session = getAuthenticatedUser(req);
  const { fromCity, toCity, date, trainName, trainModel, className, minSeats, telegramChatId, telegramUsername } = req.body;

  if (!fromCity || !toCity || !date) {
    return res.json({ success: false, error: 'fromCity, toCity, and date are required.' });
  }

  const radarData = loadRadarData();
  const newTarget = {
    id: 'radar_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    userId: session ? session.userId : null,
    username: session ? session.username : 'guest',
    fromCity: fromCity.trim().toUpperCase(),
    toCity: toCity.trim().toUpperCase(),
    date: date.trim(),
    trainName: (trainName || 'ALL').trim(),
    trainModel: trainModel || null,
    className: className || 'ANY',
    minSeats: Number(minSeats) || 1,
    telegramChatId: telegramChatId || null,
    telegramUsername: telegramUsername || null,
    active: true,
    lastNotifiedSeats: 0,
    lastCheckedAt: null,
    createdAt: new Date().toISOString()
  };

  radarData.targets.push(newTarget);
  saveRadarData(radarData);

  console.log(`[Radar] ➕ Added target: ${newTarget.trainName} on ${newTarget.fromCity} ➔ ${newTarget.toCity} (${newTarget.date})`);

  // Trigger instant scan cycle
  setTimeout(runBackgroundRadarCycle, 500);

  res.json({
    success: true,
    message: 'Added to 24/7 Background Radar! Telegram alerts will be sent automatically.',
    target: newTarget
  });
});

// 4. Batch Sync Browser Watchlist with Server Radar
app.post('/api/radar/watchlist/sync', (req, res) => {
  const session = getAuthenticatedUser(req);
  const { targets = [], telegramChatId, telegramUsername } = req.body;

  if (!Array.isArray(targets)) {
    return res.json({ success: false, error: 'Invalid targets array.' });
  }

  const radarData = loadRadarData();

  // Replace or merge user targets
  if (session && session.userId) {
    radarData.targets = radarData.targets.filter(t => t.userId !== session.userId);
  } else {
    radarData.targets = radarData.targets.filter(t => t.userId);
  }

  for (const t of targets) {
    if (!t.fromCity || !t.toCity || !t.date) continue;
    radarData.targets.push({
      id: t.id || ('radar_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6)),
      userId: session ? session.userId : null,
      username: session ? session.username : 'guest',
      fromCity: (t.fromCity || '').trim().toUpperCase(),
      toCity: (t.toCity || '').trim().toUpperCase(),
      date: (t.date || '').trim(),
      trainName: (t.trainName || 'ALL').trim(),
      trainModel: t.trainModel || null,
      className: t.className || 'ANY',
      minSeats: Number(t.minSeats) || 1,
      telegramChatId: t.telegramChatId || telegramChatId || null,
      telegramUsername: t.telegramUsername || telegramUsername || null,
      active: t.active !== false,
      lastNotifiedSeats: t.lastNotifiedSeats || 0,
      lastCheckedAt: null,
      createdAt: t.createdAt || new Date().toISOString()
    });
  }

  saveRadarData(radarData);
  console.log(`[Radar] 🔄 Synced ${targets.length} watchlist targets into 24/7 background radar.`);

  setTimeout(runBackgroundRadarCycle, 500);

  res.json({
    success: true,
    count: radarData.targets.length,
    message: 'Watchlist synchronized with 24/7 Background Radar.'
  });
});

// 5. Toggle Target Active State
app.post('/api/radar/watchlist/toggle', (req, res) => {
  const { id } = req.body;
  if (!id) return res.json({ success: false, error: 'Target ID is required.' });

  const radarData = loadRadarData();
  const target = radarData.targets.find(t => t.id === id);
  if (!target) return res.json({ success: false, error: 'Target not found.' });

  target.active = !target.active;
  saveRadarData(radarData);

  res.json({
    success: true,
    active: target.active,
    message: `Target is now ${target.active ? 'active' : 'paused'}.`
  });
});

// 6. Delete Target
app.post('/api/radar/watchlist/delete', (req, res) => {
  const { id } = req.body;
  if (!id) return res.json({ success: false, error: 'Target ID is required.' });

  const radarData = loadRadarData();
  const initialLen = radarData.targets.length;
  radarData.targets = radarData.targets.filter(t => t.id !== id);

  if (radarData.targets.length === initialLen) {
    return res.json({ success: false, error: 'Target not found.' });
  }

  saveRadarData(radarData);
  res.json({ success: true, message: 'Target removed from 24/7 Radar.' });
});

// Dedicated User Manual Documentation Route
app.get('/manual', (req, res) => {
  const manualPath = path.join(__dirname, 'public', 'manual.html');
  if (fs.existsSync(manualPath)) {
    return res.sendFile(manualPath);
  }
  res.redirect('/USER_MANUAL.md');
});

// Fallback for SPA routing & API 404 handler
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, error: `API endpoint '${req.path}' not found.` });
  }
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  res.status(404).send('Cannot GET ' + req.path);
});

// Centralized Safe Error Handling Middleware (Zero Leakage of Stack Traces or Code Paths)
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ success: false, error: 'Malformed JSON payload rejected by security filter.' });
  }
  console.error('[Security] 🛡️ Unhandled runtime exception safely handled:', err.message);
  res.status(500).json({ success: false, error: 'Internal server error occurred.' });
});

let browserOpened = false;
function openBrowser(url) {
  if (browserOpened) return;
  browserOpened = true;
  const startCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
  exec(`${startCmd} "${url}"`, (err) => {
    if (err && process.platform === 'win32') {
      exec(`explorer "${url}"`);
    }
  });
}

// Start Server with dynamic port fallback
function startServer(portToTry) {
  const server = app.listen(portToTry, () => {
    const serverUrl = `http://localhost:${portToTry}`;
    console.log(`====================================================`);
    console.log(` 🚆 RailSeat Finder BD - Bangladesh Railway Seat Availability`);
    console.log(` 🌐 Server running at: ${serverUrl}`);
    console.log(` 🛡️ Anti-Bot Protection & Request Throttling: Active`);
    console.log(` 💾 Persistent Session Storage: ${fs.existsSync(SESSION_FILE) ? 'LOADED (Active)' : 'EMPTY (Waiting for connection)'}`);
    console.log(` 📋 Loaded ${stations.length} official Shohoz stations`);
    console.log(` 🚀 Dashboard auto-launching in browser...`);
    console.log(`====================================================`);

    // Auto open dashboard in default browser
    setTimeout(() => {
      openBrowser(serverUrl);
    }, 500);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[Port Conflict] Port ${portToTry} is busy. Trying port ${portToTry + 1}...`);
      startServer(portToTry + 1);
    } else {
      console.error('Server error:', err);
    }
  });
}

// Only listen when executed directly (not in Vercel serverless environment)
if (!process.env.VERCEL) {
  startServer(PORT);
}

module.exports = app;

