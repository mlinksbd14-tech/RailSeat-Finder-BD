const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { exec, execFile } = require('child_process');
const webPush = require('web-push');
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
      syncFirestoreChatHistory();
    } catch (err) {
      console.error('[Firebase] ❌ Initialization error:', err.message);
      isFirebaseConnected = false;
      firestoreDb = null;
    }
  } else {
    console.log('[Firebase] ℹ️ Operating in local database mode. Place serviceAccountKey.json in root to connect Firebase.');
  }
}

async function syncFirestoreChatHistory() {
  if (!firestoreDb) return;
  try {
    const snapshot = await firestoreDb.collection('chat_history').get();
    if (snapshot.empty) {
      const localData = loadSupportMessages();
      if (localData.threads && localData.threads.length > 0) {
        console.log(`[Firebase Firestore] 📤 Seeding ${localData.threads.length} chat thread(s) to 'chat_history' table...`);
        const batch = firestoreDb.batch();
        for (const thread of localData.threads) {
          const docRef = firestoreDb.collection('chat_history').doc(thread.id);
          batch.set(docRef, thread);
        }
        await batch.commit();
        console.log('[Firebase Firestore] ✅ chat_history seeded successfully.');
      }
    } else {
      const threads = [];
      snapshot.forEach(doc => {
        threads.push(doc.data());
      });
      threads.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
      saveSupportMessages({ threads });
      console.log(`[Firebase Firestore] 📥 Pulled ${threads.length} chat thread(s) from 'chat_history' table.`);
    }
  } catch (err) {
    console.warn('[Firebase Firestore] ⚠️ Chat sync error with Firestore:', err.message);
  }
}

async function syncChatToFirestore(thread, message) {
  if (!firestoreDb || !isFirebaseConnected || !thread) return;
  try {
    const docRef = firestoreDb.collection('chat_history').doc(thread.id);
    await docRef.set(thread, { merge: true });

    if (message) {
      const msgRef = docRef.collection('messages').doc(message.id);
      await msgRef.set(message, { merge: true });
    }
    console.log(`[Firebase Firestore] 💬 Synced chat to 'chat_history' table: thread=${thread.id}`);
  } catch (err) {
    console.warn(`[Firebase Firestore] ⚠️ Failed to sync chat thread ${thread.id} to Firestore:`, err.message);
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
    settings: { requireLogin: true },
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

// Synchronize HTML default attributes in public/index.html to match active settings
function updateHtmlDefaults(settings) {
  try {
    const htmlPath = path.join(__dirname, 'public', 'index.html');
    if (!fs.existsSync(htmlPath)) return;
    let html = fs.readFileSync(htmlPath, 'utf8');

    // 1. Require Login
    const reqLogin = settings.requireLogin !== false;
    html = html.replace(/(<input type="checkbox" id="settingRequireLoginToggle" class="sr-only")[^>]*>/, '$1' + (reqLogin ? ' checked>' : '>'));
    html = html.replace(/(<input type="checkbox" id="modalRequireLoginToggle" class="sr-only")[^>]*>/, '$1' + (reqLogin ? ' checked>' : '>'));
    html = html.replace(/(<span id="badgeRequireLoginStatus" class="[^"]*">)[^<]*(<\/span>)/, '$1' + (reqLogin ? 'Protected' : 'Public') + '$2');

    // 2. Allow Registration
    const allowReg = settings.allowRegistration !== false;
    html = html.replace(/(<input type="checkbox" id="modalAllowRegistrationToggle" class="sr-only")[^>]*>/, '$1' + (allowReg ? ' checked>' : '>'));
    html = html.replace(/(<span id="badgeAllowRegistrationStatus" class="[^"]*">)[^<]*(<\/span>)/, '$1' + (allowReg ? 'Open' : 'Closed') + '$2');

    // 3. Admin Approval
    const reqAppr = settings.requireAdminApproval === true;
    html = html.replace(/(<input type="checkbox" id="settingRequireApprovalToggle" class="sr-only")[^>]*>/, '$1' + (reqAppr ? ' checked>' : '>'));
    html = html.replace(/(<input type="checkbox" id="modalRequireApprovalToggle" class="sr-only")[^>]*>/, '$1' + (reqAppr ? ' checked>' : '>'));
    html = html.replace(/(<span id="badgeRequireApprovalStatus" class="[^"]*">)[^<]*(<\/span>)/, '$1' + (reqAppr ? 'Required' : 'Instant') + '$2');

    // 4. Email Verification
    const reqEmail = settings.requireEmailVerification === true;
    html = html.replace(/(<input type="checkbox" id="settingRequireEmailVerificationToggle" class="sr-only")[^>]*>/, '$1' + (reqEmail ? ' checked>' : '>'));
    html = html.replace(/(<input type="checkbox" id="modalRequireEmailVerificationToggle" class="sr-only")[^>]*>/, '$1' + (reqEmail ? ' checked>' : '>'));
    html = html.replace(/(<span id="badgeRequireEmailVerificationStatus" class="[^"]*">)[^<]*(<\/span>)/, '$1' + (reqEmail ? 'Required' : 'Disabled') + '$2');

    fs.writeFileSync(htmlPath, html, 'utf8');
  } catch (e) {
    console.warn('[HTML Sync] Warning updating index.html defaults:', e.message);
  }
}

// Synchronize Admin Settings and File Changes directly to GitHub Repository
let gitSyncQueue = Promise.resolve();

function runGitCommand(args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: __dirname }, (error, stdout, stderr) => {
      if (error) reject({ error, stdout: (stdout || '').trim(), stderr: (stderr || '').trim() });
      else resolve({ stdout: (stdout || '').trim(), stderr: (stderr || '').trim() });
    });
  });
}

function syncChangesToGitHub(commitMessage = 'config(admin): update system settings via admin dashboard') {
  if (isVercel || !fs.existsSync(path.join(__dirname, '.git'))) {
    return Promise.resolve();
  }

  gitSyncQueue = gitSyncQueue.then(async () => {
    try {
      const filesToStage = ['data/users.json', 'data/radar_watchlist.json', 'public/index.html'].filter(f => fs.existsSync(path.join(__dirname, f)));
      if (filesToStage.length === 0) return;

      await runGitCommand(['add', ...filesToStage]);

      // Check if there are staged differences
      try {
        await runGitCommand(['diff', '--cached', '--quiet']);
        // No differences to commit
        return;
      } catch (diffErr) {
        // Exit code 1 means changes exist
        const safeMsg = commitMessage.replace(/[\r\n]+/g, ' ').trim();
        const commitRes = await runGitCommand(['commit', '-m', safeMsg]);
        console.log(`[GitHub Sync] 💾 Committed changes:\n${commitRes.stdout}`);
        const pushRes = await runGitCommand(['push', 'origin', 'main']);
        console.log(`[GitHub Sync] 🚀 Synced changes to GitHub repo (${commitMessage}):\n${pushRes.stdout || pushRes.stderr}`);
      }
    } catch (err) {
      console.warn('[GitHub Sync] ⚠️ Git push notice:', err.stderr || err.error?.message || err.message);
    }
  }).catch(err => {
    console.warn('[GitHub Sync] ⚠️ Git sync promise error:', err.message);
  });

  return gitSyncQueue;
}

function saveUsersData(data, gitCommitMsg = null) {
  saveLocalUsersData(data);

  if (data && data.settings) {
    updateHtmlDefaults(data.settings);
  }

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
        batch.set(settingsRef, data.settings || { requireLogin: true }, { merge: true });
        await batch.commit();
      } catch (err) {
        console.warn('[Firebase] ⚠️ Async Firestore write error:', err.message);
      }
    })();
  }

  // Automatically commit and push all User Management & Access Control changes to GitHub repository
  syncChangesToGitHub(gitCommitMsg || 'data(users): sync user management & access control updates [via Dashboard/System]');
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
    try {
      const data = loadUsersData();
      const liveUser = data.users.find(u => u.id === session.userId || u.username.toLowerCase() === (session.username || '').toLowerCase());
      if (liveUser) {
        session.role = liveUser.role || session.role;
        session.status = liveUser.status || session.status;
        if (liveUser.name) session.name = liveUser.name;
      }
    } catch (e) {}
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

  // Allow only public static assets (.js, .css, .html, images inside /public, manifest.json, sw.js)
  const isAllowedPublicAsset = req.path.startsWith('/js/') || req.path.startsWith('/css/') || req.path.startsWith('/images/') || req.path === '/favicon.ico' || req.path === '/' || req.path === '/manifest.json' || req.path === '/sw.js';

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
  return res.status(404).send('<h1>RailSeat Finder BD</h1><p>Error: public/index.html not found on this server.</p>');
});

// Explicit Support Page Route
app.get(['/support', '/support.html'], (req, res) => {
  const supportPath = path.join(publicDir, 'support.html');
  if (fs.existsSync(supportPath)) {
    return res.sendFile(supportPath);
  }
  res.redirect('/');
});

// Explicit User Manual Page Route
app.get(['/manual', '/manual.html'], (req, res) => {
  const manualPath = path.join(publicDir, 'manual.html');
  if (fs.existsSync(manualPath)) {
    return res.sendFile(manualPath);
  }
  res.redirect('/USER_MANUAL.md');
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
  'biman bandor': 'Biman_Bandar',
  'chittagong': 'Chattogram',
  'ctg': 'Chattogram',
  'chottogram': 'Chattogram',
  'chattagram': 'Chattogram',
  'comilla': 'Cumilla',
  'cumilla junction': 'Cumilla',
  'bogra': 'Bogura',
  'bogura': 'Bogura',
  'jessore': 'Jashore',
  'jashore': 'Jashore',
  'barisal': 'Barishal',
  'coxs bazar': "Cox's Bazar",
  'coxsbazar': "Cox's Bazar",
  "cox's_bazar": "Cox's Bazar",
  'coxs_bazar': "Cox's Bazar",
  'cox bazaar': "Cox's Bazar",
  'coxsbazar railway station': "Cox's Bazar",
  'jamalpur': 'Jamalpur_Town',
  'jamalpur town': 'Jamalpur_Town',
  'cantonment': 'Dhaka_Cantonment',
  'dhaka cantonment': 'Dhaka_Cantonment',
  'bhairab': 'Bhairab_Bazar',
  'bhairab bazar': 'Bhairab_Bazar',
  'b.baria': 'Brahmanbaria',
  'b-baria': 'Brahmanbaria',
  'b baria': 'Brahmanbaria',
  'brahman baria': 'Brahmanbaria',
  'dewanganj': 'Dewanganj_Bazar',
  'dewangonj': 'Dewanganj_Bazar',
  'melandah': 'Melandah_Bazar',
  'islampur': 'Islampur_Bazar',
  'sirajganj': 'Sirajganj_Bazar',
  'sirajgonj': 'Sirajganj_Bazar',
  'thakurgaon': 'Thakurgaon_Road',
  'sayedpur': 'Saidpur',
  'syedpur': 'Saidpur',
  'bhanga': 'Bhanga_Junction',
  'chandpur': 'Chandpur_Court',
  'kushtia': 'Kushtia_Court',
  'boalmari': 'Boalmari_Bazar',
  'bonarpara': 'Bonar_Para',
  'bonar para': 'Bonar_Para',
  'sreemangal': 'Sreemangal',
  'srimangal': 'Sreemangal',
  'shreemangal': 'Sreemangal',
  'parbatipur': 'Parbatipur',
  'santahar': 'Santahar',
  'mymensingh': 'Mymensingh',
  'tongi': 'Tongi',
  'joydebpur': 'Joydebpur',
  'joydevpur': 'Joydebpur',
  'gazipur': 'Joydebpur',
  'ishwardi': 'Ishwardi',
  'ishurdi': 'Ishwardi',
  'poradah': 'Poradah',
  'khulna': 'Khulna',
  'rajshahi': 'Rajshahi',
  'sylhet': 'Sylhet',
  'dinajpur': 'Dinajpur',
  'rangpur': 'Rangpur',
  'kurigram': 'Kurigram',
  'lalmonirhat': 'Lalmonirhat',
  'panchagarh': 'Panchagarh',
  'netrokona': 'Netrokona'
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

// Canonical Bangladesh Railway / Shohoz Date & Booking URL Generators
function formatShohozDoj(dateStr) {
  if (!dateStr) return '';
  const clean = String(dateStr).trim();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (clean.includes('-')) {
    const parts = clean.split('-');
    if (parts.length === 3) {
      if (parts[0].length === 4) {
        const y = parts[0];
        const mIdx = parseInt(parts[1], 10) - 1;
        const d = parts[2].padStart(2, '0');
        if (mIdx >= 0 && mIdx < 12) {
          return `${d}-${months[mIdx]}-${y}`;
        }
      }
      if (parts[2].length === 4) {
        return clean;
      }
    }
  }
  const dateObj = new Date(dateStr);
  if (isNaN(dateObj.getTime())) return dateStr;
  const day = String(dateObj.getDate()).padStart(2, '0');
  const month = months[dateObj.getMonth()];
  const year = dateObj.getFullYear();
  return `${day}-${month}-${year}`;
}

function buildShohozBookingUrl(fromCity, toCity, dateStr, seatClass) {
  const canonicalFrom = getCanonicalStationName(fromCity || 'Dhaka');
  const canonicalTo = getCanonicalStationName(toCity || 'Chattogram');
  const doj = formatShohozDoj(dateStr || new Date().toISOString().split('T')[0]);
  const cls = (seatClass && seatClass !== 'ANY' && seatClass !== 'ALL') ? seatClass.trim() : 'S_CHAIR';
  return `https://eticket.railway.gov.bd/booking/train/search?fromcity=${encodeURIComponent(canonicalFrom)}&tocity=${encodeURIComponent(canonicalTo)}&doj=${encodeURIComponent(doj)}&class=${encodeURIComponent(cls)}`;
}

// Major Railway Junction Hubs and Corridor Stoppage Networks
const ROUTE_CORRIDOR_JUNCTIONS = {
  'dhaka_chattogram': ['Feni', 'Cumilla', 'Laksam', 'Brahmanbaria', 'Akhaura', 'Bhairab_Bazar'],
  'chattogram_dhaka': ['Bhairab_Bazar', 'Brahmanbaria', 'Akhaura', 'Laksam', 'Cumilla', 'Feni'],
  'dhaka_sylhet': ['Kulaura', 'Sreemangal', 'Shaistaganj', 'Akhaura', 'Brahmanbaria', 'Bhairab_Bazar'],
  'sylhet_dhaka': ['Bhairab_Bazar', 'Brahmanbaria', 'Akhaura', 'Shaistaganj', 'Sreemangal', 'Kulaura'],
  'dhaka_rajshahi': ['Abdulpur', 'Ishwardi', 'Ullapara', 'Tangail', 'Joydebpur'],
  'rajshahi_dhaka': ['Joydebpur', 'Tangail', 'Ullapara', 'Ishwardi', 'Abdulpur'],
  'dhaka_khulna': ['Jessore', 'Chuadanga', 'Kushtia_Court', 'Poradah', 'Ishwardi', 'Joydebpur'],
  'khulna_dhaka': ['Joydebpur', 'Ishwardi', 'Poradah', 'Kushtia_Court', 'Chuadanga', 'Jessore'],
  'dhaka_rangpur': ['Parbatipur', 'Bogura', 'Santahar', 'Natore', 'Joydebpur'],
  'rangpur_dhaka': ['Joydebpur', 'Natore', 'Santahar', 'Bogura', 'Parbatipur'],
  'dhaka_dinajpur': ['Parbatipur', 'Santahar', 'Fulbari', 'Joydebpur'],
  'dinajpur_dhaka': ['Joydebpur', 'Santahar', 'Parbatipur', 'Fulbari'],
  'dhaka_cox\'s_bazar': ['Chattogram', 'Feni', 'Cumilla', 'Brahmanbaria'],
  'cox\'s_bazar_dhaka': ['Chattogram', 'Feni', 'Cumilla', 'Brahmanbaria'],
  'chattogram_sylhet': ['Kulaura', 'Sreemangal', 'Akhaura', 'Laksam', 'Cumilla', 'Feni'],
  'sylhet_chattogram': ['Feni', 'Cumilla', 'Laksam', 'Akhaura', 'Sreemangal', 'Kulaura']
};

const GENERAL_JUNCTION_HUBS = [
  'Akhaura', 'Brahmanbaria', 'Feni', 'Cumilla', 'Bhairab_Bazar', 'Ishwardi', 'Santahar', 'Parbatipur', 'Laksam', 'Tongi', 'Joydebpur', 'Kulaura', 'Sreemangal'
];

// Utility to parse train time strings ("06:30 AM", "18:45", etc.) into minutes from midnight
function parseTimeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const clean = timeStr.trim().toUpperCase();
  const match = clean.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/);
  if (!match) return null;
  
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const period = match[3];

  if (period === 'PM' && hours < 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;

  return (hours * 60) + minutes;
}

// ----------------------------------------------------
// Smart Multi-Hop Alternate Junction Route Engine (Corridor & General Transfer Hubs)
// ----------------------------------------------------
async function findAlternateJunctionRoutes(fromCity, toCity, dateStr, session, directTrains = []) {
  const cleanFrom = (fromCity || '').trim().toLowerCase();
  const cleanTo = (toCity || '').trim().toLowerCase();
  const corridorKey = `${cleanFrom.replace(/[\s'-]+/g, '_')}_${cleanTo.replace(/[\s'-]+/g, '_')}`;
  
  const corridorList = ROUTE_CORRIDOR_JUNCTIONS[corridorKey] || [];
  const candidatePool = [...corridorList, ...GENERAL_JUNCTION_HUBS];
  
  const candidates = [];
  const seen = new Set();
  for (const h of candidatePool) {
    const norm = h.toLowerCase().replace(/_/g, ' ').trim();
    if (norm !== cleanFrom && norm !== cleanTo && !seen.has(norm)) {
      seen.add(norm);
      candidates.push(h);
    }
  }

  const longestReachTransferOptions = [];

  for (let hubIndex = 0; hubIndex < Math.min(candidates.length, 4); hubIndex++) {
    const hub = candidates[hubIndex];
    try {
      const cleanHubName = hub.replace(/_/g, ' ');

      const leg1Res = await querySingleShohozTrip(fromCity, cleanHubName, dateStr, session);
      const leg1Trains = (leg1Res.trains || []).filter(t => (t.total_combined_seats || 0) > 0);
      if (leg1Trains.length === 0) continue;

      const leg2Res = await querySingleShohozTrip(cleanHubName, toCity, dateStr, session);
      const leg2Trains = (leg2Res.trains || []).filter(t => (t.total_combined_seats || 0) > 0);
      if (leg2Trains.length === 0) continue;

      for (const t1 of leg1Trains) {
        for (const t2 of leg2Trains) {
          if (String(t1.train_model).trim() !== String(t2.train_model).trim()) {
            const t1Dep = parseTimeToMinutes(t1.departure_time);
            const t1Arr = parseTimeToMinutes(t1.arrival_time) || t1Dep;
            const t2Dep = parseTimeToMinutes(t2.departure_time);

            if (t1Arr !== null && t2Dep !== null) {
              let layover = t2Dep - t1Arr;
              if (layover < 0) layover += 1440;

              if (layover < 15 || layover > 360) {
                continue;
              }

              const layoverHours = Math.floor(layover / 60);
              const layoverMins = layover % 60;
              const layoverLabel = layoverHours > 0 ? `${layoverHours}h ${layoverMins}m` : `${layoverMins}m`;

              longestReachTransferOptions.push({
                is_same_train: false,
                is_longest_reach: hubIndex === 0,
                route_type: 'LONGEST_DESTINATION_TRANSFER',
                via_hub: cleanHubName,
                layover_minutes: layover,
                layover_text: layoverLabel,
                leg1: {
                  train_name: t1.train_name,
                  train_model: t1.train_model,
                  from: fromCity,
                  to: cleanHubName,
                  departure_time: t1.departure_time,
                  arrival_time: t1.arrival_time,
                  seats: t1.total_combined_seats || 0,
                  online_seats: t1.total_online_seats || 0,
                  seat_types: t1.seat_types || []
                },
                leg2: {
                  train_name: t2.train_name,
                  train_model: t2.train_model,
                  from: cleanHubName,
                  to: toCity,
                  departure_time: t2.departure_time,
                  arrival_time: t2.arrival_time,
                  seats: t2.total_combined_seats || 0,
                  online_seats: t2.total_online_seats || 0,
                  seat_types: t2.seat_types || []
                }
              });
              if (longestReachTransferOptions.length >= 3) break;
            }
          }
        }
        if (longestReachTransferOptions.length >= 3) break;
      }

      if (longestReachTransferOptions.length >= 3) break;
    } catch (e) {}
  }

  return longestReachTransferOptions.slice(0, 6);
}

// 2. Search Available Trains & Seats for Single Date
app.get('/api/search', async (req, res) => {
  const { from_city, to_city, date_of_journey, check_alternates } = req.query;

  if (!from_city || !to_city || !date_of_journey) {
    return res.status(400).json({
      success: false,
      error: 'Missing required parameters: from_city, to_city, date_of_journey are required.'
    });
  }

  const session = getUserShohozSession(req);
  const result = await querySingleShohozTrip(from_city, to_city, date_of_journey, session);

  // Auto-scan Smart Alternate Junction Routes when requested
  if (result.success && check_alternates === 'true') {
    try {
      result.alternate_routes = await findAlternateJunctionRoutes(from_city, to_city, date_of_journey, session, result.trains || []);
    } catch (altErr) {
      result.alternate_routes = [];
    }
  } else {
    result.alternate_routes = [];
  }

  return res.json(result);
});

// Dedicated On-Demand Alternate Junction Routes Endpoint
app.get('/api/alternate-routes', async (req, res) => {
  const { from_city, to_city, date_of_journey } = req.query;

  if (!from_city || !to_city || !date_of_journey) {
    return res.status(400).json({
      success: false,
      error: 'Missing required parameters: from_city, to_city, date_of_journey are required.'
    });
  }

  const session = getUserShohozSession(req);
  try {
    const alternateRoutes = await findAlternateJunctionRoutes(from_city, to_city, date_of_journey, session);
    return res.json({
      success: true,
      route: { from: from_city, to: to_city, date: date_of_journey },
      alternate_routes: alternateRoutes,
      ghost_seats: alternateRoutes.filter(r => r.is_same_train)
    });
  } catch (err) {
    return res.json({
      success: false,
      error: err.message,
      alternate_routes: [],
      ghost_seats: []
    });
  }
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

  // Format date of journey for Shohoz cleanly (without timezone shifting)
  let dojStr = date_of_journey;
  if (/^\d{4}-\d{2}-\d{2}$/.test(date_of_journey)) {
    const parts = date_of_journey.split('-');
    const year = parts[0];
    const monthNum = parseInt(parts[1], 10) - 1;
    const day = parts[2];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    dojStr = `${String(day).padStart(2, '0')}-${months[monthNum]}-${year}`;
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

  const cleanModelDigits = String(cleanModel).replace(/\D/g, '').trim();
  const cleanTargetName = String(routeData.train_name || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  // Execute in smooth batches of 2 requests with session passing
  const segments = [];
  const batchSize = 2;

  for (let i = 0; i < targetPairs.length; i += batchSize) {
    const batch = targetPairs.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(async (pair) => {
      try {
        const canonicalFrom = getCanonicalStationName(pair.from);
        const canonicalTo = getCanonicalStationName(pair.to);
        
        // Query live Shohoz trip with active user session
        const queryRes = await querySingleShohozTrip(canonicalFrom, canonicalTo, dojStr, session);
        const trains = queryRes.trains || [];
        
        const matchingTrain = trains.find(t => {
          const tModelDigits = String(t.train_model || '').replace(/\D/g, '').trim();
          if (tModelDigits && cleanModelDigits && tModelDigits === cleanModelDigits) return true;

          const tName = String(t.train_name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
          if (tName && cleanTargetName && (tName.includes(cleanTargetName) || cleanTargetName.includes(tName))) return true;

          return false;
        });

        if (matchingTrain) {
          const totalOnline = Number(matchingTrain.total_online_seats || 0);
          const totalOffline = Number(matchingTrain.total_offline_seats || 0);
          const totalSeats = matchingTrain.total_combined_seats !== undefined 
            ? Number(matchingTrain.total_combined_seats) 
            : (totalOnline + totalOffline);

          const bookClass = (matchingTrain.seat_types && matchingTrain.seat_types.length > 0)
            ? (matchingTrain.seat_types.find(st => (Number(st.seats_available || 0) + Number(st.counter_seats_available || 0)) > 0)?.type || matchingTrain.seat_types[0].type)
            : 'S_CHAIR';

          const bookUrl = `https://eticket.railway.gov.bd/booking/train/search?fromcity=${encodeURIComponent(canonicalFrom)}&tocity=${encodeURIComponent(canonicalTo)}&doj=${encodeURIComponent(dojStr)}&class=${encodeURIComponent(bookClass)}`;

          return {
            from: pair.fromClean,
            to: pair.toClean,
            departure_time: matchingTrain.departure_time || pair.fromDep,
            arrival_time: matchingTrain.arrival_time || pair.toArr,
            travel_time: matchingTrain.travel_time || '',
            total_seats: totalSeats,
            online_seats: totalOnline,
            offline_seats: totalOffline,
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
            online_seats: 0,
            offline_seats: 0,
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
          online_seats: 0,
          offline_seats: 0,
          has_seats: false,
          seat_types: [],
          book_url: `https://eticket.railway.gov.bd/booking/train/search?fromcity=${encodeURIComponent(canonicalFrom)}&tocity=${encodeURIComponent(canonicalTo)}&doj=${encodeURIComponent(dojStr)}&class=S_CHAIR`
        };
      }
    }));

    segments.push(...batchResults);
    if (i + batchSize < targetPairs.length) {
      await new Promise(r => setTimeout(r, 60));
    }
  }

  return res.json({
    success: true,
    train_name: routeData.train_name || `Train #${cleanModel}`,
    train_model: cleanModel,
    date: date_of_journey,
    display_date: formatShohozDate(date_of_journey),
    off_day: routeData.off_day || 'None',
    stoppages: stops,
    segments: segments
  });
});

// ----------------------------------------------------
// 5. Live Train GPS & Delay Tracker Relay Engine
// ----------------------------------------------------
const BD_RAIL_CURVES_FILE = path.join(__dirname, 'data', 'bd_rail_curves.json');
let bdRailCurvesCache = null;
let railTrackRouter = null;
try {
  railTrackRouter = require('./lib/rail-track-router');
} catch (e) {
  console.warn('[RailRouter] lib/rail-track-router not loaded:', e.message);
}

const stationCoordsPath = path.join(__dirname, 'data', 'station_coordinates.json');
let stationCoordinates = {};
try {
  if (fs.existsSync(stationCoordsPath)) {
    stationCoordinates = JSON.parse(fs.readFileSync(stationCoordsPath, 'utf8'));
  }
} catch (e) {
  stationCoordinates = {};
}

function getStationCoordinates(name) {
  if (!name) return null;
  const raw = String(name).trim();
  if (stationCoordinates[raw]) return stationCoordinates[raw];

  // Try normalized variations
  const spaceName = raw.replace(/_/g, ' ');
  if (stationCoordinates[spaceName]) return stationCoordinates[spaceName];

  const underName = raw.replace(/\s+/g, '_');
  if (stationCoordinates[underName]) return stationCoordinates[underName];

  const clean = spaceName.replace(/\s*\([^)]*\)/g, '').trim();
  if (stationCoordinates[clean]) return stationCoordinates[clean];

  // Fuzzy match
  const lower = clean.toLowerCase();
  for (const [k, v] of Object.entries(stationCoordinates)) {
    const kLower = k.toLowerCase().replace(/_/g, ' ');
    if (kLower === lower || lower.includes(kLower) || kLower.includes(lower)) {
      return v;
    }
  }
  return null;
}

const liveTrackerCache = new Map();
const LIVE_TRACKER_CACHE_TTL = 30 * 1000; // 30 seconds

async function fetchLiveTrackerHtml(url) {
  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const resp = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        },
        timeout: 12000
      });
      return typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
    } catch (err) {
      lastErr = err;
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, 400));
      }
    }
  }
  throw lastErr;
}

function extractNextJsStreamText(html) {
  const chunks = [];
  const nextRegex = /self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)/g;
  let m;
  while ((m = nextRegex.exec(html)) !== null) {
    try {
      chunks.push(JSON.parse(`"${m[1]}"`));
    } catch (e) {
      chunks.push(m[1]);
    }
  }
  return chunks.join('');
}

function parseRunningTrainsHtml(html) {
  const trains = [];
  const cardRegex = /<a[^>]*href="\/track\/(\d+)"[^>]*>([\s\S]*?)<\/a>/g;
  let match;
  while ((match = cardRegex.exec(html)) !== null) {
    const trainNo = match[1];
    const cardHtml = match[2];

    const nameMatch = cardHtml.match(/<div[^>]*class="[^"]*truncate[^"]*"[^>]*>([^<]+)<\/div>/i);
    if (!nameMatch) continue;
    const trainName = nameMatch[1].trim();

    const durationMatch = cardHtml.match(/(\d+h\s*\d+m|\d+h|\d+m)/);
    const duration = durationMatch ? durationMatch[1] : '';

    const delayMatch = cardHtml.match(/(\+\d+m|On time|ON TIME)/i);
    const delayText = delayMatch ? delayMatch[1] : 'On time';
    let delayMinutes = 0;
    if (delayText.startsWith('+')) {
      delayMinutes = parseInt(delayText.replace(/[^\d]/g, ''), 10) || 0;
    }

    const updatedMatch = cardHtml.match(/(\d+m\s*ago|\d+s\s*ago|just\s*now)/i);
    const lastUpdated = updatedMatch ? updatedMatch[1] : 'Just now';

    const stationPairs = [];
    const stationRegex = />(\d{1,2}:\d{2})<\/div>\s*<div[^>]*>([^<]+)<\/div>/g;
    let sMatch;
    while ((sMatch = stationRegex.exec(cardHtml)) !== null) {
      stationPairs.push({ time: sMatch[1], station: sMatch[2].trim() });
    }

    const pctMatch = cardHtml.match(/(\d+)<!-- -->%/);
    const progressPct = pctMatch ? parseInt(pctMatch[1], 10) : 0;

    const isNoData = cardHtml.includes('No data') || cardHtml.includes('NO DATA') || delayText.toLowerCase().includes('no data') || cardHtml.includes('No tracking');
    const isCompleted = progressPct >= 100 || cardHtml.includes('Arrived') || cardHtml.includes('Completed');
    const isScheduled = progressPct === 0 && !isNoData && !isCompleted;
    const isDelayed = delayMinutes > 0 && !isCompleted && !isNoData && !isScheduled;
    const isOntime = !isDelayed && !isNoData && !isScheduled && !isCompleted;

    let trainStatus = 'running';
    if (isNoData) trainStatus = 'nodata';
    else if (isCompleted) trainStatus = 'completed';
    else if (isScheduled) trainStatus = 'scheduled';
    else if (isDelayed) trainStatus = 'delayed';
    else if (isOntime) trainStatus = 'ontime';

    const fromCoords = getStationCoordinates(stationPairs[0]?.station);
    const toCoords = getStationCoordinates(stationPairs[1]?.station);
    let currentCoords = null;

    // Calculate live position strictly along the physical Google Maps railway track curve
    if (fromCoords && toCoords && railTrackRouter) {
      const track = railTrackRouter.solveTrackBetweenCoords(fromCoords, toCoords);
      if (track && track.length > 1) {
        const pctRatio = Math.min(1, Math.max(0, progressPct / 100));
        const idx = Math.min(track.length - 1, Math.max(0, Math.round((track.length - 1) * pctRatio)));
        currentCoords = track[idx];
      }
    }

    if (!currentCoords && fromCoords && toCoords) {
      const pctRatio = Math.min(1, Math.max(0, progressPct / 100));
      currentCoords = [
        Math.round((fromCoords[0] + (toCoords[0] - fromCoords[0]) * pctRatio) * 10000) / 10000,
        Math.round((fromCoords[1] + (toCoords[1] - fromCoords[1]) * pctRatio) * 10000) / 10000
      ];
    } else if (!currentCoords && fromCoords) {
      currentCoords = fromCoords;
    }

    if (currentCoords && railTrackRouter) {
      currentCoords = railTrackRouter.snapToRailTrack(currentCoords[0], currentCoords[1]);
    }

    trains.push({
      train_no: trainNo,
      train_name: trainName,
      from: stationPairs[0]?.station || '',
      to: stationPairs[1]?.station || '',
      from_coords: fromCoords,
      to_coords: toCoords,
      current_coords: currentCoords,
      departure_time: stationPairs[0]?.time || '',
      arrival_time: stationPairs[1]?.time || '',
      duration,
      delay_text: delayText,
      delay_minutes: delayMinutes,
      progress_pct: progressPct,
      last_updated: lastUpdated,
      status: trainStatus
    });
  }

  return trains;
}

function addMinutesToTime(timeStr, minutesToAdd) {
  if (!timeStr || timeStr === '—' || !timeStr.includes(':')) return '—';
  const parts = timeStr.split(':');
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return timeStr;
  
  let totalMinutes = (h * 60 + m + (minutesToAdd || 0)) % (24 * 60);
  if (totalMinutes < 0) totalMinutes += 24 * 60;
  
  const newH = Math.floor(totalMinutes / 60);
  const newM = totalMinutes % 60;
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
}


function parseTrainDetailStream(stream, trainNo, delayReport = null) {
  const parseJsonObj = (str, key) => {
    const idx = str.indexOf(`"${key}":{`);
    if (idx === -1) return null;
    const startObj = idx + `"${key}":`.length;
    let depth = 0;
    for (let i = startObj; i < str.length; i++) {
      if (str[i] === '{') depth++;
      else if (str[i] === '}') {
        depth--;
        if (depth === 0) {
          try {
            const rawJson = str.slice(startObj, i + 1);
            const sanitized = rawJson.replace(/"\$undefined"/g, 'null').replace(/"\$[\w:.]+"/g, 'null');
            return JSON.parse(sanitized);
          } catch (e) { return null; }
        }
      }
    }
    return null;
  };

  const initialTrain = parseJsonObj(stream, 'initialTrain');
  const initialDerived = parseJsonObj(stream, 'initialDerived');
  const delayReportObj = delayReport || parseJsonObj(stream, 'delayReport');
  const nextStopCode = initialTrain?.nextStop || '';

  const delayMin = initialTrain?.delay || initialDerived?.delay || 0;
  const afterStopIdx = (initialDerived?.trainSegmentPosition?.afterStopIdx !== undefined && initialDerived?.trainSegmentPosition?.afterStopIdx !== null)
    ? initialDerived.trainSegmentPosition.afterStopIdx
    : -1;

  const rawStoppages = initialTrain?.route || [];
  const stoppages = rawStoppages.map((r, idx) => {
    const isPassed = afterStopIdx >= 0 && idx <= afterStopIdx;
    const isNext = afterStopIdx >= 0 && idx === afterStopIdx + 1;
    const calculatedEta = (r.sched && r.sched !== '—') ? addMinutesToTime(r.sched, delayMin) : '—';
    const actualTime = r.act && r.act !== '—' ? r.act : (isPassed ? calculatedEta : '—');
    const coords = getStationCoordinates(r.name);

    return {
      station_name: r.name || '',
      station_bn: r.bn || '',
      station_code: r.code || '',
      scheduled_time: r.sched || '—',
      actual_time: actualTime,
      eta_time: calculatedEta,
      platform: r.platform || '—',
      distance_km: r.km || 0,
      lat: coords ? coords[0] : null,
      lng: coords ? coords[1] : null,
      status: isPassed ? 'passed' : (isNext ? 'next' : 'upcoming')
    };
  });

  let nextStopIndex = -1;
  if (afterStopIdx >= 0 && afterStopIdx + 1 < stoppages.length) {
    nextStopIndex = afterStopIdx + 1;
  } else if (afterStopIdx < 0 && stoppages.length > 0) {
    nextStopIndex = 0;
  }

  let fullNextStopName = '';
  let nextEta = initialTrain?.nextEta || '';

  if (nextStopIndex >= 0 && nextStopIndex < stoppages.length) {
    fullNextStopName = stoppages[nextStopIndex].station_name;
    if (!nextEta || nextEta === '—') {
      nextEta = stoppages[nextStopIndex].eta_time;
    }
  } else if (initialTrain?.nextStop) {
    const code = String(initialTrain.nextStop).trim().toUpperCase();
    const found = stoppages.find(s => s.station_code && s.station_code.toUpperCase() === code);
    fullNextStopName = found ? found.station_name : initialTrain.nextStop;
  } else if (stoppages.length > 0) {
    fullNextStopName = stoppages[stoppages.length - 1].station_name;
  } else {
    fullNextStopName = 'Destination';
  }

  const trainState = initialTrain?.status || initialDerived?.state || 'running';
  let accurateNextStop = fullNextStopName;
  let accurateNextEta = nextEta;

  if (trainState === 'scheduled') {
    accurateNextStop = (stoppages.length > 1 ? stoppages[1].station_name : stoppages[0]?.station_name) || initialTrain?.from || 'Origin';
    accurateNextEta = initialTrain?.depart ? `Departs ${initialTrain.depart}` : (stoppages[0]?.scheduled_time || 'Scheduled');
  } else if (trainState === 'arrived' || trainState === 'completed') {
    accurateNextStop = (stoppages.length > 0 ? stoppages[stoppages.length - 1].station_name : initialTrain?.to) || 'Destination';
    accurateNextEta = 'Arrived';
  } else if (trainState === 'offday') {
    accurateNextStop = 'Off Day Today';
    accurateNextEta = '—';
  }

  const prevStopObj = afterStopIdx >= 0 && afterStopIdx < stoppages.length ? stoppages[afterStopIdx] : null;
  const prevStopName = prevStopObj ? prevStopObj.station_name : (stoppages[0]?.station_name || initialTrain?.from || 'Origin');
  const coveredSincePrevStopKm = initialDerived?.coveredSincePrevStopKm ? Math.round(initialDerived.coveredSincePrevStopKm * 10) / 10 : (trainState === 'running' && afterStopIdx >= 0 ? 0 : null);
  const segmentProgressPct = initialDerived?.trainSegmentPosition?.pct ? Math.round(initialDerived.trainSegmentPosition.pct) : (initialDerived?.currentSegmentProgressPct ? Math.round(initialDerived.currentSegmentProgressPct) : null);

  let nearestStationName = initialDerived?.nearestStationName || '';
  let nearestDistanceKm = initialDerived?.nearestStationDistanceKm ? Math.round(initialDerived.nearestStationDistanceKm * 10) / 10 : null;

  if (!nearestStationName) {
    if (trainState === 'scheduled') {
      nearestStationName = stoppages[0]?.station_name || initialTrain?.from || 'Origin Station';
      nearestDistanceKm = 0;
    } else if (trainState === 'arrived' || trainState === 'completed') {
      nearestStationName = stoppages[stoppages.length - 1]?.station_name || initialTrain?.to || 'Destination Station';
      nearestDistanceKm = 0;
    } else if (prevStopName) {
      nearestStationName = prevStopName;
      nearestDistanceKm = coveredSincePrevStopKm || 0;
    }
  }

  let lastUpdatedText = '0s ago';
  if (initialDerived?.lastUpdateAt) {
    try {
      const rawDate = String(initialDerived.lastUpdateAt).replace(/^\$D/, '');
      const updateDate = new Date(rawDate);
      const diffSeconds = Math.max(0, Math.floor((Date.now() - updateDate.getTime()) / 1000));
      if (diffSeconds < 60) {
        lastUpdatedText = `${diffSeconds}s ago`;
      } else {
        const diffMinutes = Math.floor(diffSeconds / 60);
        lastUpdatedText = `${diffMinutes}m ago`;
      }
    } catch (e) {
      lastUpdatedText = '0s ago';
    }
  }

  const recentRuns = (delayReportObj?.runs || []).map(run => ({
    date: run.run_date,
    delay_minutes: run.delay_minutes
  }));

  const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  let formattedOffDay = 'No Off Day';
  if (initialTrain?.offDay !== undefined && initialTrain?.offDay !== null) {
    if (typeof initialTrain.offDay === 'string' && isNaN(parseInt(initialTrain.offDay, 10))) {
      formattedOffDay = initialTrain.offDay;
    } else {
      const offIdx = parseInt(initialTrain.offDay, 10);
      if (offIdx >= 0 && offIdx < DAY_NAMES.length) {
        formattedOffDay = DAY_NAMES[offIdx];
      } else if (offIdx === -1) {
        formattedOffDay = 'No Off Day';
      }
    }
  }

  let coachCount = initialTrain?.coaches;
  if (!coachCount || isNaN(coachCount)) {
    coachCount = 16;
  }

  return {
    success: true,
    train_no: String(initialTrain?.no || trainNo),
    train_name: initialTrain?.name || `Train ${trainNo}`,
    train_name_bn: initialTrain?.bn || '',
    from: initialTrain?.from || '',
    to: initialTrain?.to || '',
    departure_time: initialTrain?.depart || '',
    arrival_time: initialTrain?.arrive || '',
    duration: initialTrain?.duration || '',
    speed: initialTrain?.speed || 0,
    delay_minutes: initialTrain?.delay || initialDerived?.delay || 0,
    progress_pct: initialDerived?.pct || (trainState === 'arrived' ? 100 : (trainState === 'scheduled' ? 0 : 0)),
    status: trainState,
    coaches: coachCount,
    next_stop: accurateNextStop,
    next_stop_code: nextStopCode,
    next_eta: accurateNextEta,
    prev_stop: prevStopName,
    prev_stop_idx: afterStopIdx,
    covered_since_prev_stop_km: coveredSincePrevStopKm,
    segment_progress_pct: segmentProgressPct,
    km_to_next: initialDerived?.kmToNext || 0,
    nearest_station: nearestStationName,
    nearest_distance_km: nearestDistanceKm,
    covered_distance_km: initialDerived?.coveredDistanceKm ? Math.round(initialDerived.coveredDistanceKm) : 0,
    last_updated: lastUpdatedText,
    off_day: formattedOffDay,
    operating_days: initialTrain?.days || [],
    classes: initialTrain?.classes || [],
    stoppages,
    delay_history: {
      avg_delay_minutes: delayReportObj?.avg_delay_minutes || 0,
      max_delay_minutes: delayReportObj?.max_delay_minutes || 0,
      min_delay_minutes: delayReportObj?.min_delay_minutes || 0,
      runs_analyzed: delayReportObj?.known_runs || recentRuns.length,
      recent_runs: recentRuns
    }
  };
}

// 5.1. Get All Live Running Trains
app.get('/api/live-tracker/running-trains', async (req, res) => {
  const isForceRefresh = req.query.refresh === '1';
  const cached = liveTrackerCache.get('running_trains');
  if (!isForceRefresh && cached && (Date.now() - cached.timestamp < LIVE_TRACKER_CACHE_TTL)) {
    return res.json(cached.data);
  }

  try {
    const html = await fetchLiveTrackerHtml('https://trainkothai.com/trains');
    const trains = parseRunningTrainsHtml(html);

    const payload = {
      success: true,
      updated_at: new Date().toISOString(),
      total_running: trains.length,
      trains
    };

    liveTrackerCache.set('running_trains', {
      timestamp: Date.now(),
      data: payload
    });

    return res.json(payload);
  } catch (err) {
    console.warn('[LiveTracker] Upstream trains fetch warning:', err.message);
    if (cached) {
      return res.json({
        ...cached.data,
        cached_fallback: true
      });
    }
    return res.status(200).json({
      success: false,
      error: 'Live train tracker feed is temporarily syncing. Please retry in a moment.',
      trains: []
    });
  }
});

function loadBdRailCurves() {
  if (bdRailCurvesCache) return bdRailCurvesCache;
  try {
    if (fs.existsSync(BD_RAIL_CURVES_FILE)) {
      const raw = JSON.parse(fs.readFileSync(BD_RAIL_CURVES_FILE, 'utf8'));
      bdRailCurvesCache = raw.routes || {};
    }
  } catch (e) {
    console.warn('[RailCurves] Error reading bd_rail_curves.json:', e.message);
    bdRailCurvesCache = {};
  }
  return bdRailCurvesCache || {};
}

// 5.2. Get 100% Accurate Physical Railway Curve Coordinates Matching Google Maps
app.all('/api/live-tracker/rail-curve', (req, res) => {
  const query = req.method === 'POST' ? (req.body || {}) : req.query;
  const from = String(query.from || '').trim();
  const to = String(query.to || '').trim();
  const fromLat = parseFloat(query.from_lat || query.lat1);
  const fromLng = parseFloat(query.from_lng || query.lng1);
  const toLat = parseFloat(query.to_lat || query.lat2);
  const toLng = parseFloat(query.to_lng || query.lng2);
  const waypoints = query.waypoints;

  // 1. Multi-stop waypoints solving
  if (Array.isArray(waypoints) && waypoints.length >= 2 && railTrackRouter) {
    const coords = railTrackRouter.solveMultiStopTrack(waypoints);
    if (coords && coords.length > 2) {
      return res.json({ success: true, coordinates: coords });
    }
  }

  // 2. Precomputed curves lookup
  const curves = loadBdRailCurves();
  if (from && to) {
    const key1 = `${from}->${to}`;
    const key2 = `${to}->${from}`;

    if (curves[key1] && curves[key1].length > 2) {
      return res.json({ success: true, coordinates: curves[key1] });
    }
    if (curves[key2] && curves[key2].length > 2) {
      return res.json({ success: true, coordinates: curves[key2].slice().reverse() });
    }

    for (const [k, v] of Object.entries(curves)) {
      if (!Array.isArray(v) || v.length <= 2) continue;
      const [s1, s2] = k.split('->');
      if ((s1.toLowerCase().includes(from.toLowerCase()) || from.toLowerCase().includes(s1.toLowerCase())) &&
          (s2.toLowerCase().includes(to.toLowerCase()) || to.toLowerCase().includes(s2.toLowerCase()))) {
        return res.json({ success: true, coordinates: v });
      }
      if ((s1.toLowerCase().includes(to.toLowerCase()) || to.toLowerCase().includes(s1.toLowerCase())) &&
          (s2.toLowerCase().includes(from.toLowerCase()) || from.toLowerCase().includes(s2.toLowerCase()))) {
        return res.json({ success: true, coordinates: v.slice().reverse() });
      }
    }
  }

  // 3. Dynamic A* track curve solving between station names
  if (from && to && railTrackRouter) {
    const c1 = getStationCoordinates(from);
    const c2 = getStationCoordinates(to);
    if (c1 && c2) {
      const track = railTrackRouter.solveTrackBetweenCoords(c1, c2);
      if (track && track.length > 2) {
        return res.json({ success: true, coordinates: track });
      }
    }
  }

  // 4. Dynamic A* track curve solving between GPS coordinates
  if (!isNaN(fromLat) && !isNaN(fromLng) && !isNaN(toLat) && !isNaN(toLng) && railTrackRouter) {
    const track = railTrackRouter.solveTrackBetweenCoords([fromLat, fromLng], [toLat, toLng]);
    if (track && track.length > 2) {
      return res.json({ success: true, coordinates: track });
    }
  }

  return res.json({ success: false, coordinates: [] });
});

// 5.3. Get Real-Time Live Status for Specific Train
app.get('/api/live-tracker/train/:trainNo', async (req, res) => {
  const trainNo = String(req.params.trainNo || '').trim();
  if (!trainNo) {
    return res.status(400).json({ success: false, error: 'Train number is required.' });
  }

  const cacheKey = `train_${trainNo}`;
  const cached = liveTrackerCache.get(cacheKey);
  const isForceRefresh = req.query.refresh === '1';

  if (!isForceRefresh && cached && (Date.now() - cached.timestamp < LIVE_TRACKER_CACHE_TTL)) {
    return res.json(cached.data);
  }

  try {
    const html = await fetchLiveTrackerHtml(`https://trainkothai.com/track/${encodeURIComponent(trainNo)}`);
    const stream = extractNextJsStreamText(html);
    const detail = parseTrainDetailStream(stream, trainNo);

    if (detail && detail.train_name) {
      liveTrackerCache.set(cacheKey, {
        timestamp: Date.now(),
        data: detail
      });
      return res.json(detail);
    }
  } catch (err) {
    console.warn(`[LiveTracker] Upstream train #${trainNo} fetch warning:`, err.message);
  }

  if (cached) {
    return res.json({
      ...cached.data,
      cached_fallback: true
    });
  }

  // Graceful fallback from running_trains cache
  const runningCached = liveTrackerCache.get('running_trains');
  const runningTrain = runningCached?.data?.trains?.find(t => String(t.train_no) === String(trainNo));
  if (runningTrain) {
    const fallbackDetail = {
      success: true,
      train_no: String(trainNo),
      train_name: runningTrain.train_name || `Train ${trainNo}`,
      from: runningTrain.from || '',
      to: runningTrain.to || '',
      departure_time: runningTrain.departure_time || '',
      arrival_time: runningTrain.arrival_time || '',
      duration: runningTrain.duration || '',
      delay_minutes: runningTrain.delay_minutes || 0,
      progress_pct: runningTrain.progress_pct || 0,
      status: runningTrain.status || 'running',
      next_stop: runningTrain.to || 'Destination',
      next_eta: runningTrain.arrival_time || '',
      prev_stop: runningTrain.from || 'Origin',
      nearest_station: runningTrain.from || '',
      nearest_distance_km: null,
      last_updated: runningTrain.last_updated || 'Just now',
      stoppages: [
        { station_name: runningTrain.from || 'Origin', scheduled_time: runningTrain.departure_time || '--:--', actual_time: runningTrain.departure_time || '--:--', status: 'passed' },
        { station_name: runningTrain.to || 'Destination', scheduled_time: runningTrain.arrival_time || '--:--', actual_time: runningTrain.arrival_time || '--:--', status: 'next' }
      ]
    };
    return res.json(fallbackDetail);
  }

  return res.status(200).json({
    success: false,
    error: `Live tracking feed for train #${trainNo} is currently updating.`
  });
});

// 5.3. Get All Station Geolocation Coordinates
app.get('/api/live-tracker/coordinates', (req, res) => {
  res.json({
    success: true,
    count: Object.keys(stationCoordinates).length,
    coordinates: stationCoordinates
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

const FIXED_TELEGRAM_BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const FIXED_TELEGRAM_BOT_USERNAME = (process.env.TELEGRAM_BOT_USERNAME || 'railseatfinderbdbot').trim();

if (!FIXED_TELEGRAM_BOT_TOKEN) {
  console.log('[Telegram Bot] ℹ️ TELEGRAM_BOT_TOKEN not configured in .env');
} else {
  console.log(`[Telegram Bot] 🔒 Bot Token securely loaded from environment (@${FIXED_TELEGRAM_BOT_USERNAME})`);
}

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

// Station Fuzzy Name Matcher for Telegram Bot (100% Shohoz Compatible)
function findStationName(query = '') {
  if (!query) return null;
  const canonical = getCanonicalStationName(query);
  if (canonical) return canonical;
  
  const cleanQ = query.trim().toLowerCase();
  const exact = stations.find(s => s.name && (s.name.toLowerCase() === cleanQ || s.name.toLowerCase().startsWith(cleanQ)));
  if (exact) return exact.name;

  const abbrevs = {
    'dha': 'Dhaka', 'dhaka': 'Dhaka', 'kam': 'Dhaka', 'ctg': 'Chattogram', 'chittagong': 'Chattogram', 'chattogram': 'Chattogram',
    'syl': 'Sylhet', 'raj': 'Rajshahi', 'cox': "Cox's Bazar", 'coxs': "Cox's Bazar", 'coxsbazar': "Cox's Bazar", 'khu': 'Khulna',
    'bar': 'Barishal', 'rang': 'Rangpur', 'din': 'Dinajpur', 'com': 'Cumilla', 'comilla': 'Cumilla', 'feni': 'Feni',
    'bra': 'Brahmanbaria', 'b.baria': 'Brahmanbaria', 'sre': 'Sreemangal', 'bog': 'Bogura', 'bogra': 'Bogura', 'jas': 'Jashore', 'jes': 'Jashore'
  };
  if (abbrevs[cleanQ]) return abbrevs[cleanQ];

  const partial = stations.find(s => s.name && s.name.toLowerCase().includes(cleanQ));
  return partial ? partial.name : query;
}

// ----------------------------------------------------
// Telegram Polling Engine (Receives /start, /search, /radar)
// ----------------------------------------------------
async function pollTelegramBotUpdates() {
  if (!FIXED_TELEGRAM_BOT_TOKEN) return;

  try {
    const url = `https://api.telegram.org/bot${FIXED_TELEGRAM_BOT_TOKEN}/getUpdates?offset=${lastTelegramUpdateOffset}&timeout=3`;
    const res = await axios.get(url, { timeout: 6000 });
    const updates = res.data?.result || [];

    for (const update of updates) {
      lastTelegramUpdateOffset = update.update_id + 1;

      // Handle Callback Query (Inline Keyboard Clicks)
      if (update.callback_query) {
        const cb = update.callback_query;
        try {
          await axios.post(`https://api.telegram.org/bot${FIXED_TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
            callback_query_id: cb.id,
            text: 'Opening live booking page on Bangladesh Railway...'
          });
        } catch (e) {}
        continue;
      }

      const msg = update.message;
      if (!msg || !msg.text) continue;

      const chatId = msg.chat?.id;
      const text = msg.text.trim();
      const fromUser = msg.from || {};
      const firstName = fromUser.first_name || 'Traveler';
      const username = fromUser.username ? `@${fromUser.username}` : '';
      const replyUrl = `https://api.telegram.org/bot${FIXED_TELEGRAM_BOT_TOKEN}/sendMessage`;

      // 1. Command: /start or /login or /connect or /link
      if (text.startsWith('/start') || text.startsWith('/login') || text.startsWith('/connect') || text.startsWith('/link')) {
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

        if (pairCode && activePairings.has(pairCode)) {
          const session = activePairings.get(pairCode);
          session.status = 'paired';
          session.chatId = String(chatId);
          session.username = username;
          session.firstName = firstName;
          activePairings.set(pairCode, session);
          console.log(`[Telegram] 🔗 Paired code ${pairCode} with chat ${chatId} (${username || firstName})`);
        } else {
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

        try {
          await axios.post(replyUrl, {
            chat_id: chatId,
            text: `👋 <b>Hello ${firstName}!</b>\n\n🎉 <b>Your Telegram is now connected to RailSeat BD!</b>\n\nYou will automatically receive real-time alerts here whenever a watched seat becomes available.\n\n💡 <b>Try commands:</b>\n• <code>/search Dhaka Chittagong</code> — Instant seat availability\n• <code>/radar</code> — View your background seat monitors\n• <code>/help</code> — Full commands list`,
            parse_mode: 'HTML'
          }, { timeout: 6000 });
        } catch (e) {}
        continue;
      }

      // 2. Command: /help
      if (text.startsWith('/help')) {
        const helpText = `🚆 <b>RailSeat Finder BD — Telegram Commands</b>\n\n` +
          `🔍 <b>/search &lt;From&gt; &lt;To&gt; [Date]</b>\n` +
          `<i>Example:</i> <code>/search Dhaka Chittagong</code> or <code>/search DHA CTG 2026-08-30</code>\n` +
          `Queries Bangladesh Railway live seat availability and provides direct 1-click booking buttons.\n\n` +
          `🛰️ <b>/radar</b> or <b>/watchlist</b>\n` +
          `Lists your active 24/7 background seat drop monitors.\n\n` +
          `🔗 <b>/link &lt;pair_code&gt;</b>\n` +
          `Link this Telegram chat to your RailSeat BD dashboard.\n\n` +
          `❓ <b>/help</b>\n` +
          `Show this command guide.`;

        try {
          await axios.post(replyUrl, { chat_id: chatId, text: helpText, parse_mode: 'HTML' }, { timeout: 6000 });
        } catch (e) {}
        continue;
      }

      // 3. Command: /radar or /watchlist
      if (text.startsWith('/radar') || text.startsWith('/watchlist')) {
        const radarData = loadRadarData();
        const userWatchlist = (radarData.watchlist || []).filter(w => String(w.telegramChatId) === String(chatId));

        let radarReply = `🛰️ <b>Your 24/7 Radar Watchlist (${userWatchlist.length} Active)</b>\n\n`;
        if (userWatchlist.length === 0) {
          radarReply += `<i>No active background watches found for this Telegram chat. Set up your watches on the Web Dashboard to receive instant alerts!</i>`;
        } else {
          userWatchlist.forEach((w, idx) => {
            radarReply += `<b>${idx + 1}. ${w.trainName}</b> (${w.className || 'All'})\n` +
              `📍 ${getCanonicalStationName(w.fromCity)} ➔ ${getCanonicalStationName(w.toCity)} | 📅 ${formatShohozDoj(w.date)}\n` +
              `🔔 Status: ${w.status === 'active' ? '🟢 Monitoring' : '⏸️ Paused'}\n\n`;
          });
        }

        try {
          await axios.post(replyUrl, { chat_id: chatId, text: radarReply, parse_mode: 'HTML' }, { timeout: 6000 });
        } catch (e) {}
        continue;
      }

      // 4. Command: /search <from> <to> [date]
      if (text.startsWith('/search')) {
        const parts = text.replace(/^\/search\s*/i, '').trim().split(/\s+/);
        if (parts.length < 2) {
          try {
            await axios.post(replyUrl, {
              chat_id: chatId,
              text: `⚠️ <b>Usage:</b> <code>/search &lt;From Station&gt; &lt;To Station&gt; [Date]</code>\n<i>Example:</i> <code>/search Dhaka Chittagong</code> or <code>/search Dhaka Sylhet 2026-08-30</code>`,
              parse_mode: 'HTML'
            }, { timeout: 6000 });
          } catch (e) {}
          continue;
        }

        const rawFrom = parts[0];
        const rawTo = parts[1];
        let rawDate = parts[2] || '';

        const fromStation = findStationName(rawFrom);
        const toStation = findStationName(rawTo);

        if (!fromStation || !toStation) {
          try {
            await axios.post(replyUrl, {
              chat_id: chatId,
              text: `❌ Could not find station name for <b>${!fromStation ? rawFrom : rawTo}</b>. Please check spelling (e.g. Dhaka, Chittagong, Sylhet, Rajshahi, Cox's Bazar).`,
              parse_mode: 'HTML'
            }, { timeout: 6000 });
          } catch (e) {}
          continue;
        }

        // Format Date
        let searchDate = new Date();
        if (rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
          searchDate = new Date(rawDate);
        } else if (rawDate && /^\d{2}-[A-Za-z]{3}-\d{4}$/.test(rawDate)) {
          searchDate = new Date(rawDate);
        } else {
          searchDate.setDate(searchDate.getDate() + 1);
        }
        const dateIsoStr = searchDate.toISOString().split('T')[0];
        const formattedDoj = formatShohozDoj(dateIsoStr);

        try {
          await axios.post(replyUrl, {
            chat_id: chatId,
            text: `🔍 <i>Querying Shohoz live gateway for <b>${fromStation} ➔ ${toStation}</b> on ${formattedDoj}...</i>`,
            parse_mode: 'HTML'
          }, { timeout: 6000 });

          const defaultSession = authCredentials.token ? authCredentials : { token: null };
          const result = await querySingleShohozTrip(fromStation, toStation, formattedDoj, defaultSession);

          if (!result.success || !result.trains || result.trains.length === 0) {
            await axios.post(replyUrl, {
              chat_id: chatId,
              text: `❌ <b>No trains found for ${fromStation} ➔ ${toStation} on ${formattedDoj}.</b>\n${result.error || ''}`,
              parse_mode: 'HTML'
            }, { timeout: 6000 });
            continue;
          }

          let replyMsg = `🚆 <b>${fromStation} ➔ ${toStation}</b>\n📅 <b>${formattedDoj}</b>\n━━━━━━━━━━━━━━━━━━━━\n\n`;
          let bookButtons = [];

          result.trains.forEach((t, i) => {
            const hasSeats = (t.total_combined_seats || 0) > 0;
            const statusIcon = hasSeats ? '🟢' : '🔴';
            replyMsg += `${statusIcon} <b>${t.train_name}</b> (#${t.train_model})\n`;
            replyMsg += `⏰ Dep: ${t.departure_time || 'N/A'} | Arr: ${t.arrival_time || 'N/A'}\n`;

            if (hasSeats) {
              t.seat_types.forEach(st => {
                const avail = (st.seats_available || 0) + (st.counter_seats_available || 0);
                if (avail > 0) {
                  replyMsg += `  • <b>${st.display_name || st.type}:</b> <b>${avail}</b> seats (৳${st.fare})\n`;
                }
              });
            } else {
              replyMsg += `  • <i>ALL SEATS SOLD OUT</i>\n`;
            }
            replyMsg += `\n`;

            if (hasSeats && bookButtons.length < 3) {
              const bookClass = t.seat_types?.find(st => ((st.seats_available || 0) + (st.counter_seats_available || 0)) > 0)?.type || 'S_CHAIR';
              const bookUrl = buildShohozBookingUrl(fromStation, toStation, formattedDoj, bookClass);
              bookButtons.push([{ text: `🎟️ Book (${t.train_name})`, url: bookUrl }]);
            }
          });

          const directUrl = buildShohozBookingUrl(fromStation, toStation, formattedDoj, 'S_CHAIR');
          if (bookButtons.length === 0) {
            bookButtons.push([{ text: `🎟️ Open Booking Search`, url: directUrl }]);
          }

          await axios.post(replyUrl, {
            chat_id: chatId,
            text: replyMsg,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: bookButtons }
          }, { timeout: 8000 });

        } catch (searchErr) {
          await axios.post(replyUrl, {
            chat_id: chatId,
            text: `⚠️ Search error: ${searchErr.message}`,
            parse_mode: 'HTML'
          }, { timeout: 6000 });
        }
        continue;
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
    has_fixed_token: !!FIXED_TELEGRAM_BOT_TOKEN
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
  const { chat_id, message, bookUrl } = req.body;
  const cleanChatId = (chat_id || '').trim();

  if (!cleanChatId || !message) {
    return res.json({ success: false, error: 'chat_id and message are required.' });
  }

  try {
    const telegramUrl = `https://api.telegram.org/bot${FIXED_TELEGRAM_BOT_TOKEN}/sendMessage`;
    const payload = {
      chat_id: cleanChatId,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: false
    };

    if (bookUrl) {
      payload.reply_markup = {
        inline_keyboard: [
          [{ text: '🎟️ Book Now on Railway', url: bookUrl }]
        ]
      };
    }

    const response = await axios.post(telegramUrl, payload, { timeout: 8000 });

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

// GeoIP & ISP Intelligence Cache & Resolver
const geoIpCache = new Map();

function getCountryFlag(countryCode = '') {
  if (!countryCode || countryCode.length !== 2) return '🌐';
  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map(char => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

async function lookupIpLocation(ip = '') {
  const cleanIp = (ip || '').replace(/^.*:/, '').trim();
  if (!cleanIp || cleanIp === '127.0.0.1' || cleanIp === '1' || cleanIp === 'unknown' || cleanIp.startsWith('192.168.') || cleanIp.startsWith('10.') || cleanIp.startsWith('172.16.')) {
    return {
      city: 'Localhost',
      region: 'Local Network',
      country: 'Development',
      countryCode: 'BD',
      flag: '💻',
      isp: 'Internal Loopback / Dev',
      query: ip
    };
  }

  if (geoIpCache.has(cleanIp)) {
    return geoIpCache.get(cleanIp);
  }

  try {
    const res = await axios.get(`http://ip-api.com/json/${cleanIp}?fields=status,country,countryCode,regionName,city,isp,org,query`, {
      timeout: 3000
    });
    if (res.data && res.data.status === 'success') {
      const loc = {
        city: res.data.city || 'Unknown City',
        region: res.data.regionName || '',
        country: res.data.country || 'Unknown Country',
        countryCode: res.data.countryCode || '',
        flag: getCountryFlag(res.data.countryCode),
        isp: res.data.isp || res.data.org || 'Internet Service Provider',
        query: cleanIp
      };
      geoIpCache.set(cleanIp, loc);
      if (geoIpCache.size > 500) {
        const firstKey = geoIpCache.keys().next().value;
        geoIpCache.delete(firstKey);
      }
      return loc;
    }
  } catch (e) {
    // Silently fallback on timeout or network block
  }

  const fallback = {
    city: 'Unknown City',
    region: '',
    country: 'Internet',
    countryCode: '',
    flag: '🌐',
    isp: 'Standard Network',
    query: cleanIp
  };
  geoIpCache.set(cleanIp, fallback);
  return fallback;
}

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

  const historyItem = {
    action,
    timestamp: now,
    ip: clientIp,
    device: parsedUa.device,
    os: parsedUa.os,
    browser: parsedUa.browser,
    location: user.lastLocation || null
  };

  user.activityHistory = user.activityHistory || [];
  user.activityHistory.unshift(historyItem);
  if (user.activityHistory.length > 25) user.activityHistory.pop();

  // Asynchronously resolve GeoIP & ISP location without blocking the request
  lookupIpLocation(clientIp).then(loc => {
    user.lastLocation = loc;
    historyItem.location = loc;
  }).catch(() => {});
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
    require_login: data.settings?.requireLogin !== false,
    require_admin_approval: data.settings?.requireAdminApproval === true,
    require_email_verification: data.settings?.requireEmailVerification === true,
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

  const requireApproval = data.settings?.requireAdminApproval === true;
  const requireEmailVerification = data.settings?.requireEmailVerification === true;
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
    requireAdminApproval: requireApproval,
    message: (cleanEmail && requireEmailVerification)
      ? (requireApproval
          ? 'Registration submitted! Please verify your email via the link sent to your inbox. Once approved by administrator, you will be able to sign in.'
          : 'Registration successful! Please verify your email via the link sent to your inbox. You can sign in immediately once verified.')
      : (requireApproval
          ? 'Registration submitted successfully! Your account is pending administrator approval before sign in.'
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

      const requireApproval = data.settings?.requireAdminApproval === true;
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

// 4.1. Get User Favorite / Popular Routes
app.get('/api/user-auth/popular-routes', (req, res) => {
  const defaultRoutes = [
    { from: 'Dhaka', to: 'Chattogram', label: 'Dhaka ⇄ Ctg' },
    { from: 'Dhaka', to: "Cox's Bazar", label: "Dhaka ⇄ Cox's Bazar" },
    { from: 'Dhaka', to: 'Sylhet', label: 'Dhaka ⇄ Sylhet' },
    { from: 'Dhaka', to: 'Rajshahi', label: 'Dhaka ⇄ Rajshahi' },
    { from: 'Dhaka', to: 'Khulna', label: 'Dhaka ⇄ Khulna' },
    { from: 'Dhaka', to: 'Rangpur', label: 'Dhaka ⇄ Rangpur' }
  ];

  const session = getAuthenticatedUser(req);
  if (session) {
    const data = loadUsersData();
    const user = data.users.find(u => u.id === session.userId);
    if (user && Array.isArray(user.popular_routes) && user.popular_routes.length > 0) {
      return res.json({ success: true, routes: user.popular_routes });
    }
  }
  res.json({ success: true, routes: defaultRoutes });
});

// 4.2. Update User Favorite / Popular Routes
app.post('/api/user-auth/popular-routes', (req, res) => {
  const { routes } = req.body;
  if (!Array.isArray(routes)) {
    return res.status(400).json({ success: false, error: 'Routes array is required.' });
  }

  const cleanRoutes = routes.slice(0, 30).map(r => ({
    from: String(r.from || '').trim(),
    to: String(r.to || '').trim(),
    label: String(r.label || `${r.from} ⇄ ${r.to}`).trim()
  })).filter(r => r.from && r.to);

  const session = getAuthenticatedUser(req);
  if (session) {
    const data = loadUsersData();
    const user = data.users.find(u => u.id === session.userId);
    if (user) {
      user.popular_routes = cleanRoutes;
      saveUsersData(data);
    }
  }

  res.json({ success: true, routes: cleanRoutes });
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
    lastLocation: u.lastLocation || null,
    activityHistory: u.activityHistory || [],
    createdAt: u.createdAt,
    lastLogin: u.lastLogin
  }));

  const pendingCount = data.users.filter(u => u.status === 'pending').length;

  res.json({
    success: true,
    count: safeUsers.length,
    pending_count: pendingCount,
    require_login: data.settings?.requireLogin !== false,
    require_admin_approval: data.settings?.requireAdminApproval === true,
    require_email_verification: data.settings?.requireEmailVerification === true,
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

  // Auto-sync new user directly to GitHub repository
  syncChangesToGitHub(`admin: add user @${cleanUsername} [via Admin Dashboard]`);

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

  // Auto-sync edit directly to GitHub repository
  syncChangesToGitHub(`admin: update user @${user.username} [via Admin Dashboard]`);

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

  // Auto-sync deletion directly to GitHub repository
  syncChangesToGitHub(`admin: delete user @${userToDelete.username} [via Admin Dashboard]`);

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

  // Auto-sync status change directly to GitHub repository
  syncChangesToGitHub(`admin: set status of @${user.username} to ${user.status} [via Admin Dashboard]`);

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

  // Auto-sync user approval directly to GitHub repository
  syncChangesToGitHub(`admin: approve user @${user.username} [via Admin Dashboard]`);

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

  // Auto-sync password update directly to GitHub repository
  syncChangesToGitHub(`admin: update password for @${user.username} [via Admin Dashboard]`);

  res.json({ success: true, message: `Password for ${user.username} updated in local DB and Firebase.` });
});

// 10. Update Access Control Settings (Admin-only + Auto Firebase & GitHub Sync)
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

  // Update HTML file inline defaults for offline/static consistency
  updateHtmlDefaults(data.settings);

  // Sync settings to Cloud Firestore if connected
  if (firestoreDb && isFirebaseConnected) {
    try {
      await firestoreDb.collection('system_config').doc('settings').set(data.settings, { merge: true });
      console.log('[Firebase Firestore] ☁️ Synced access control settings to Cloud Firestore');
    } catch (e) {
      console.warn('[Firebase Firestore] Warning syncing settings:', e.message);
    }
  }

  // Auto-sync setting change directly to GitHub repository
  const summary = [];
  if (requireLogin !== undefined) summary.push(`Login: ${data.settings.requireLogin ? 'ON' : 'OFF'}`);
  if (requireAdminApproval !== undefined) summary.push(`Approval: ${data.settings.requireAdminApproval ? 'ON' : 'OFF'}`);
  if (requireEmailVerification !== undefined) summary.push(`Email Verification: ${data.settings.requireEmailVerification ? 'ON' : 'OFF'}`);
  if (allowRegistration !== undefined) summary.push(`Signup: ${data.settings.allowRegistration !== false ? 'ON' : 'OFF'}`);
  if (authNotice !== undefined || authNoticeEnabled !== undefined) summary.push(`Notice: ${data.settings.authNoticeEnabled !== false && data.settings.authNotice ? 'ACTIVE' : 'OFF'}`);
  const summaryStr = summary.length ? ` (${summary.join(', ')})` : '';
  syncChangesToGitHub(`config(settings): update access control toggles${summaryStr} [via Admin Dashboard]`);

  console.log(`[Access Control] 🔒 Dashboard settings updated: Login=${data.settings.requireLogin}, AdminApproval=${data.settings.requireAdminApproval === true}, EmailVerification=${data.settings.requireEmailVerification === true}, AllowReg=${data.settings.allowRegistration !== false}, Notice="${data.settings.authNotice || ''}"`);
  res.json({
    success: true,
    require_login: data.settings?.requireLogin !== false,
    require_admin_approval: data.settings?.requireAdminApproval === true,
    require_email_verification: data.settings?.requireEmailVerification === true,
    allow_registration: data.settings?.allowRegistration !== false,
    auth_notice: data.settings?.authNotice || '',
    auth_notice_enabled: data.settings?.authNoticeEnabled !== false,
    message: `Settings updated: Require Login = ${data.settings?.requireLogin !== false ? 'ON' : 'OFF'}, Admin Approval = ${data.settings?.requireAdminApproval === true ? 'ON' : 'OFF'}, Email Verification = ${data.settings?.requireEmailVerification === true ? 'ON' : 'OFF'}, Allow Registration = ${data.settings?.allowRegistration !== false ? 'ON' : 'OFF'}.`
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
      data.targets = Array.isArray(data.targets) ? data.targets.map(t => {
        if (!t.dates || !Array.isArray(t.dates) || t.dates.length === 0) {
          t.dates = t.date ? [t.date] : [];
        }
        return t;
      }) : [];
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

// Web Push (VAPID) Persistent Key Manager
const VAPID_KEYS_FILE = path.join(DATA_DIR, 'vapid_keys.json');
const SEED_VAPID_KEYS_FILE = path.join(SEED_DATA_DIR, 'vapid_keys.json');
const PUSH_SUBS_FILE = path.join(DATA_DIR, 'push_subscriptions.json');

function getVapidKeys() {
  try {
    let raw = null;
    if (fs.existsSync(VAPID_KEYS_FILE)) {
      raw = fs.readFileSync(VAPID_KEYS_FILE, 'utf8');
    } else if (fs.existsSync(SEED_VAPID_KEYS_FILE)) {
      raw = fs.readFileSync(SEED_VAPID_KEYS_FILE, 'utf8');
    }
    if (raw && raw.trim()) {
      const keys = JSON.parse(raw);
      if (keys.publicKey && keys.privateKey) return keys;
    }
  } catch (e) {}

  const newKeys = webPush.generateVAPIDKeys();
  try {
    const dir = path.dirname(VAPID_KEYS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(VAPID_KEYS_FILE, JSON.stringify(newKeys, null, 2), 'utf8');
  } catch (e) {}
  return newKeys;
}

const vapidKeys = getVapidKeys();
try {
  webPush.setVapidDetails(
    'mailto:support@railseatbd.com',
    vapidKeys.publicKey,
    vapidKeys.privateKey
  );
} catch (e) {
  console.warn('[WebPush] VAPID setup warning:', e.message);
}

function loadPushSubscriptions() {
  try {
    if (fs.existsSync(PUSH_SUBS_FILE)) {
      const raw = fs.readFileSync(PUSH_SUBS_FILE, 'utf8');
      if (raw && raw.trim()) {
        const data = JSON.parse(raw);
        return Array.isArray(data) ? data : [];
      }
    }
  } catch (e) {}
  return [];
}

function savePushSubscriptions(subs) {
  try {
    const dir = path.dirname(PUSH_SUBS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(PUSH_SUBS_FILE, JSON.stringify(subs, null, 2), 'utf8');
  } catch (e) {}
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
    // Group active targets by unique route (fromCity, toCity, date) supporting multi-date targets
    const routeGroups = new Map();
    for (const target of activeTargets) {
      if (!target.fromCity || !target.toCity) continue;
      const targetDates = Array.isArray(target.dates) && target.dates.length > 0
        ? target.dates
        : (target.date ? [target.date] : []);

      if (targetDates.length === 0) continue;

      for (const d of targetDates) {
        if (!d) continue;
        const key = `${target.fromCity.toUpperCase().trim()}___${target.toCity.toUpperCase().trim()}___${d.trim()}`;
        if (!routeGroups.has(key)) {
          routeGroups.set(key, []);
        }
        routeGroups.get(key).push(target);
      }
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
          target.notifiedSeatsByDate = target.notifiedSeatsByDate || {};

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
              const lastNotified = target.notifiedSeatsByDate[dateOfJourney] !== undefined
                ? target.notifiedSeatsByDate[dateOfJourney]
                : target.lastNotifiedSeats;

              if (availableSeats >= minSeats) {
                // Check if already notified for this exact seat count on this journey date
                if (lastNotified !== availableSeats) {
                  const wasSoldOut = (lastNotified === 0 || lastNotified === undefined);
                  target.notifiedSeatsByDate[dateOfJourney] = availableSeats;
                  target.lastNotifiedSeats = availableSeats;
                  target.lastNotifiedAt = new Date().toISOString();

                  const bookUrl = buildShohozBookingUrl(fromCity, toCity, dateOfJourney, st.type);

                  // 📥 Record Radar Alert for Connected Web Dashboard Notification Center
                  const alertRecord = {
                    id: 'radar_alert_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
                    targetId: target.id,
                    userId: target.userId || null,
                    type: wasSoldOut ? 'SOLD_OUT_RELEASED' : 'RADAR_HIT',
                    title: wasSoldOut ? '🚨 RELEASED!' : '🎯 Watchlist Radar Hit!',
                    message: `${availableSeats} seat(s) available on ${train.train_name} in ${st.display_name || st.type}!`,
                    trainName: train.train_name,
                    trainModel: train.train_model,
                    fromCity: fromCity,
                    toCity: toCity,
                    date: dateOfJourney,
                    className: st.display_name || st.type,
                    seats: availableSeats,
                    onlineSeats: st.seats_available,
                    counterSeats: st.counter_seats_available,
                    bookUrl: bookUrl,
                    timestamp: Date.now(),
                    createdAt: new Date().toISOString()
                  };

                  radarData.recentAlerts = Array.isArray(radarData.recentAlerts) ? radarData.recentAlerts : [];
                  radarData.recentAlerts.push(alertRecord);
                  if (radarData.recentAlerts.length > 50) {
                    radarData.recentAlerts = radarData.recentAlerts.slice(-50);
                  }

                  const chatId = target.telegramChatId;
                  if (chatId && FIXED_TELEGRAM_BOT_TOKEN) {
                    console.log(`[Radar 24/7] 🎯 ALERT (${wasSoldOut ? 'SOLD_OUT_RELEASED' : 'RADAR_HIT'}): ${train.train_name} on ${dateOfJourney} has ${availableSeats} seat(s) in ${st.display_name}! Sending to Telegram chat ${chatId}`);

                    const msgText = wasSoldOut ?
                      `🚨 <b>[RELEASED!]</b>\n\n` +
                      `🚆 <b>Train:</b> ${train.train_name} (#${train.train_model})\n` +
                      `📍 <b>Route:</b> ${fromCity} ➔ ${toCity}\n` +
                      `📅 <b>Date:</b> ${formatShohozDoj(dateOfJourney)}\n` +
                      `💺 <b>Class:</b> ${st.display_name || st.type}\n` +
                      `🔥 <b>Available Seats:</b> <b>${availableSeats}</b> (Online: ${st.seats_available}, Counter: ${st.counter_seats_available})\n\n` +
                      `⚡ <i>This train was previously SOLD OUT and new seats just dropped! Book immediately before they are gone!</i>\n` +
                      `🔗 <a href="${bookUrl}">Click here to Book Now on Railway</a>`
                      :
                      `🎯 <b>WATCHLIST RADAR HIT!</b>\n\n` +
                      `🚆 <b>Train:</b> ${train.train_name} (#${train.train_model})\n` +
                      `📍 <b>Route:</b> ${fromCity} ➔ ${toCity}\n` +
                      `📅 <b>Date:</b> ${formatShohozDoj(dateOfJourney)}\n` +
                      `💺 <b>Class:</b> ${st.display_name || st.type}\n` +
                      `🟢 <b>Available Seats:</b> <b>${availableSeats}</b> (Online: ${st.seats_available}, Counter: ${st.counter_seats_available})\n\n` +
                      `⚡ <i>Book immediately on Bangladesh Railway!</i>\n` +
                      `🔗 <a href="${bookUrl}">Click here to Book Now on Railway</a>`;

                    try {
                      await axios.post(`https://api.telegram.org/bot${FIXED_TELEGRAM_BOT_TOKEN}/sendMessage`, {
                        chat_id: chatId,
                        text: msgText,
                        parse_mode: 'HTML',
                        disable_web_page_preview: false,
                        reply_markup: {
                          inline_keyboard: [
                            [{ text: '🎟️ Book Now', url: bookUrl }]
                          ]
                        }
                      });
                    } catch (tgErr) {
                      console.warn('[Radar] ❌ Telegram send error:', tgErr.response?.data?.description || tgErr.message);
                    }
                  }

                  // 📲 Closed-Browser Web Push Notification Dispatch (Wakes up closed browsers via Service Worker!)
                  try {
                    const pushSubs = loadPushSubscriptions();
                    if (pushSubs.length > 0) {
                      const pushPayload = JSON.stringify({
                        title: wasSoldOut ? '🚨 [RELEASED!]' : '🎯 Watchlist Radar Hit!',
                        body: `${train.train_name} (#${train.train_model}) on ${dateOfJourney}: ${availableSeats} seat(s) available in ${st.display_name || st.type}!`,
                        icon: '/favicon.ico',
                        badge: '/favicon.ico',
                        bookUrl: bookUrl,
                        url: '/'
                      });

                      pushSubs.forEach(subObj => {
                        const sub = subObj.subscription || subObj;
                        if (!target.userId || !subObj.userId || subObj.userId === target.userId) {
                          webPush.sendNotification(sub, pushPayload).catch(err => {
                            if (err.statusCode === 404 || err.statusCode === 410) {
                              const remaining = loadPushSubscriptions().filter(s => (s.subscription?.endpoint || s.endpoint) !== sub.endpoint);
                              savePushSubscriptions(remaining);
                            }
                          });
                        }
                      });
                    }
                  } catch (pushErr) {
                    console.warn('[Radar] WebPush dispatch warning:', pushErr.message);
                  }
                }
              } else if (availableSeats === 0 && (lastNotified || 0) > 0) {
                // Reset for this journey date so when seats release again, alert fires immediately
                target.notifiedSeatsByDate[dateOfJourney] = 0;
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
  const { fromCity, toCity, date, dates, trainName, trainModel, className, minSeats, telegramChatId, telegramUsername } = req.body;

  const targetDates = Array.isArray(dates) && dates.length > 0 ? dates : (date ? [date] : []);
  if (!fromCity || !toCity || targetDates.length === 0) {
    return res.json({ success: false, error: 'fromCity, toCity, and at least one travel date are required.' });
  }

  const radarData = loadRadarData();
  const newTarget = {
    id: 'radar_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    userId: session ? session.userId : null,
    username: session ? session.username : 'guest',
    fromCity: fromCity.trim().toUpperCase(),
    toCity: toCity.trim().toUpperCase(),
    date: targetDates[0].trim(),
    dates: targetDates.map(d => String(d).trim()),
    trainName: (trainName || 'ALL').trim(),
    trainModel: trainModel || null,
    className: className || 'ANY',
    minSeats: Number(minSeats) || 1,
    telegramChatId: telegramChatId || null,
    telegramUsername: telegramUsername || null,
    active: true,
    lastNotifiedSeats: 0,
    notifiedSeatsByDate: {},
    lastCheckedAt: null,
    createdAt: new Date().toISOString()
  };

  radarData.targets.push(newTarget);
  saveRadarData(radarData);

  console.log(`[Radar] ➕ Added target: ${newTarget.trainName} on ${newTarget.fromCity} ➔ ${newTarget.toCity} (${newTarget.dates.join(', ')})`);

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
    const targetDates = Array.isArray(t.dates) && t.dates.length > 0 
      ? t.dates 
      : (t.date ? [t.date] : []);
    if (!t.fromCity || !t.toCity || targetDates.length === 0) continue;

    radarData.targets.push({
      id: t.id || ('radar_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6)),
      userId: session ? session.userId : null,
      username: session ? session.username : 'guest',
      fromCity: (t.fromCity || '').trim().toUpperCase(),
      toCity: (t.toCity || '').trim().toUpperCase(),
      date: targetDates[0].trim(),
      dates: targetDates.map(d => String(d).trim()),
      trainName: (t.trainName || 'ALL').trim(),
      trainModel: t.trainModel || null,
      className: t.className || 'ANY',
      minSeats: Number(t.minSeats) || 1,
      telegramChatId: t.telegramChatId || telegramChatId || null,
      telegramUsername: t.telegramUsername || telegramUsername || null,
      active: t.active !== false,
      lastNotifiedSeats: t.lastNotifiedSeats || 0,
      notifiedSeatsByDate: t.notifiedSeatsByDate || {},
      lastCheckedAt: t.lastCheckedAt || null,
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

  res.json({
    success: true,
    message: 'Target deleted from watchlist.'
  });
});

// 7. Get Recent Background Radar Alerts for Web Dashboard Notification Center
app.get('/api/radar/alerts', (req, res) => {
  const session = getAuthenticatedUser(req);
  const since = parseInt(req.query.since || '0', 10);
  const radarData = loadRadarData();
  let alerts = radarData.recentAlerts || [];

  if (session && session.role !== 'admin') {
    alerts = alerts.filter(a => !a.userId || a.userId === session.userId);
  }

  if (since > 0) {
    alerts = alerts.filter(a => a.timestamp > since);
  }

  res.json({
    success: true,
    alerts: alerts.slice(-30),
    serverTime: Date.now()
  });
});

// ====================================================
// 9. 📲 Web Push (Service Worker Closed-Browser Alerts) Endpoints
// ====================================================

// Get VAPID Public Key for client-side subscription
app.get('/api/push/vapid-public-key', (req, res) => {
  res.json({
    success: true,
    publicKey: vapidKeys.publicKey
  });
});

// Register / Save Web Push Subscription
app.post('/api/push/subscribe', (req, res) => {
  const session = getAuthenticatedUser(req);
  const { subscription } = req.body;

  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ success: false, error: 'Valid subscription object required.' });
  }

  const subs = loadPushSubscriptions();
  // Filter out existing matching endpoint
  const filtered = subs.filter(s => (s.subscription?.endpoint || s.endpoint) !== subscription.endpoint);
  
  filtered.push({
    id: 'sub_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    userId: session ? session.userId : null,
    username: session ? session.username : 'guest',
    subscription: subscription,
    createdAt: new Date().toISOString()
  });

  savePushSubscriptions(filtered);

  console.log(`[WebPush] 📲 Registered push subscription for ${session ? session.username : 'guest'} (Total: ${filtered.length})`);

  res.json({
    success: true,
    message: 'Web Push subscription registered successfully. You will receive alerts even when your browser is closed.'
  });
});

// Unregister Web Push Subscription
app.post('/api/push/unsubscribe', (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ success: false, error: 'Endpoint required.' });

  const subs = loadPushSubscriptions();
  const filtered = subs.filter(s => (s.subscription?.endpoint || s.endpoint) !== endpoint);
  savePushSubscriptions(filtered);

  res.json({
    success: true,
    message: 'Web Push subscription removed.'
  });
});

// ====================================================
// 🎧 SUPPORT & CONTACT CHAT BACKEND ENGINE
// ====================================================
const SUPPORT_MESSAGES_FILE = path.join(__dirname, 'data', 'support_messages.json');

function loadSupportMessages() {
  try {
    if (fs.existsSync(SUPPORT_MESSAGES_FILE)) {
      const raw = fs.readFileSync(SUPPORT_MESSAGES_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.warn('[Support] ⚠️ Error loading support messages:', e.message);
  }
  return { threads: [] };
}

function saveSupportMessages(data) {
  try {
    fs.writeFileSync(SUPPORT_MESSAGES_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('[Support] ❌ Error saving support messages:', e.message);
  }
}

// Dedicated Support Page Route
app.get('/support', (req, res) => {
  const supportPath = path.join(__dirname, 'public', 'support.html');
  if (fs.existsSync(supportPath)) {
    return res.sendFile(supportPath);
  }
  res.redirect('/');
});

// GET /api/support/messages - Get support conversation stream
app.get('/api/support/messages', (req, res) => {
  const session = getAuthenticatedUser(req);
  const isAdmin = session && session.role === 'admin';
  const querySessionId = (req.query.sessionId || '').trim();
  const data = loadSupportMessages();

  if (isAdmin) {
    const allMessages = [];
    (data.threads || []).forEach(t => {
      (t.messages || []).forEach(m => {
        allMessages.push({ ...m, threadId: t.id, threadSender: t.senderName });
      });
    });
    allMessages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    return res.json({ success: true, isAdmin: true, messages: allMessages, threads: data.threads });
  }

  let thread = null;
  if (session && session.userId) {
    thread = (data.threads || []).find(t => t.userId === session.userId || t.sessionId === querySessionId);
  } else if (querySessionId) {
    thread = (data.threads || []).find(t => t.sessionId === querySessionId);
  }

  const messages = thread ? (thread.messages || []) : [];
  res.json({
    success: true,
    isAdmin: false,
    messages
  });
});

// POST /api/support/send - Send a support message
app.post('/api/support/send', async (req, res) => {
  const session = getAuthenticatedUser(req);
  const isAdmin = session && session.role === 'admin';
  const { sessionId, senderName, senderPhone, senderContact, message } = req.body;
  const cleanMsg = (message || '').trim();

  if (!cleanMsg) {
    return res.status(400).json({ success: false, error: 'Message cannot be empty.' });
  }

  const cleanName = (senderName || (session && (session.name || session.username)) || '').trim();
  const cleanPhone = (senderPhone || senderContact || (session && (session.phone || session.email)) || '').trim();

  if (!isAdmin && (!cleanName || cleanName.length < 2)) {
    return res.status(400).json({ success: false, error: 'Please enter your Full Name before sending a message.' });
  }

  if (!isAdmin && (!cleanPhone || cleanPhone.length < 6)) {
    return res.status(400).json({ success: false, error: 'Please enter a valid Phone Number before sending a message.' });
  }

  const data = loadSupportMessages();
  if (!data.threads) data.threads = [];

  const targetSessionId = sessionId || (session ? 'user_' + session.userId : 'guest_' + Date.now());
  let thread = (data.threads || []).find(t => (session && session.userId && t.userId === session.userId) || t.sessionId === targetSessionId);

  if (!thread) {
    thread = {
      id: 'thread_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      userId: session ? session.userId : null,
      sessionId: targetSessionId,
      senderName: cleanName || 'User',
      senderPhone: cleanPhone || '',
      senderContact: cleanPhone || '',
      senderRole: session ? session.role : 'viewer',
      status: 'open',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: []
    };
    data.threads.push(thread);
  } else {
    if (cleanName) thread.senderName = cleanName;
    if (cleanPhone) {
      thread.senderPhone = cleanPhone;
      thread.senderContact = cleanPhone;
    }
  }

  const newMsg = {
    id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    sender: isAdmin ? (session.name || session.username || 'Admin Support') : cleanName,
    senderPhone: isAdmin ? '' : cleanPhone,
    senderRole: isAdmin ? 'admin' : (session ? 'user' : 'viewer'),
    text: cleanMsg,
    timestamp: new Date().toISOString()
  };

  thread.messages.push(newMsg);
  thread.updatedAt = new Date().toISOString();
  saveSupportMessages(data);

  // Sync to Cloud Firestore 'chat_history' table
  await syncChatToFirestore(thread, newMsg);

  console.log(`[Support] 💬 New message from ${newMsg.sender} (${cleanPhone}): "${cleanMsg.substring(0, 40)}..."`);
  res.json({ success: true, message: newMsg });
});

// POST /api/support/reply - Admin replies to a chat thread
app.post('/api/support/reply', async (req, res) => {
  const session = getAuthenticatedUser(req);
  if (!session || session.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Unauthorized: Admin access required.' });
  }

  const { threadId, replyText } = req.body;
  const cleanReply = (replyText || '').trim();

  if (!threadId || !cleanReply) {
    return res.status(400).json({ success: false, error: 'Thread ID and reply text are required.' });
  }

  const data = loadSupportMessages();
  const thread = (data.threads || []).find(t => t.id === threadId);

  if (!thread) {
    return res.status(404).json({ success: false, error: 'Chat thread not found.' });
  }

  const adminMsg = {
    id: 'msg_reply_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    sender: session.name || session.username || 'Admin Support',
    senderRole: 'admin',
    text: cleanReply,
    timestamp: new Date().toISOString()
  };

  if (!thread.messages) thread.messages = [];
  thread.messages.push(adminMsg);
  thread.updatedAt = new Date().toISOString();
  saveSupportMessages(data);

  // Sync to Cloud Firestore 'chat_history' table
  await syncChatToFirestore(thread, adminMsg);

  console.log(`[Support] 👑 Admin reply sent to thread ${threadId}: "${cleanReply.substring(0, 40)}..."`);
  res.json({ success: true, message: adminMsg, thread });
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
  const numericPort = parseInt(portToTry, 10) || 3000;
  const server = app.listen(numericPort, () => {
    const serverUrl = `http://localhost:${numericPort}`;
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
      const nextPort = numericPort + 1;
      console.warn(`[Port Conflict] Port ${numericPort} is busy. Trying port ${nextPort}...`);
      startServer(nextPort);
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

