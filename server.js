'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

const ROOT = __dirname;
const VIEWS = path.join(ROOT, 'views');
const CONTENT_FILE = path.join(ROOT, 'content.json');
const ANALYTICS_FILE = path.join(ROOT, 'analytics.json');

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'DixitAdmin#2026!';
const SESSION_COOKIE = 'ddbh_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const sessions = new Map();

app.set('view engine', 'ejs');
app.set('views', VIEWS);
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '20mb' }));

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function getCookie(req, name) {
  const raw = String(req.headers.cookie || '');
  for (const piece of raw.split(';')) {
    const part = piece.trim();
    if (!part) continue;
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq);
    if (key !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1));
    } catch {
      return '';
    }
  }
  return '';
}

function isAuthed(req) {
  const token = getCookie(req, SESSION_COOKIE);
  if (!token) return false;
  const expiresAt = sessions.get(token);
  if (!expiresAt) return false;
  if (expiresAt <= Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

function deleteSession(req) {
  const token = getCookie(req, SESSION_COOKIE);
  if (token) sessions.delete(token);
}

function cleanupSessions() {
  const now = Date.now();
  for (const [token, expiresAt] of sessions) {
    if (expiresAt <= now) sessions.delete(token);
  }
}
setInterval(cleanupSessions, 15 * 60 * 1000).unref();

function emptyAnalytics() {
  return { total: 0, days: {}, lastVisit: null };
}

function analyticsDay(date) {
  // The site is for a Bilaspur hospital, so dashboard day counts use India time.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function recordVisit() {
  const analytics = readJson(ANALYTICS_FILE, emptyAnalytics());
  const now = new Date();
  const day = analyticsDay(now);
  analytics.total = Number(analytics.total || 0) + 1;
  analytics.days = analytics.days && typeof analytics.days === 'object' ? analytics.days : {};
  analytics.days[day] = Number(analytics.days[day] || 0) + 1;
  analytics.lastVisit = now.toISOString();
  writeJsonAtomic(ANALYTICS_FILE, analytics);
}

function analyticsStats() {
  const analytics = readJson(ANALYTICS_FILE, emptyAnalytics());
  const today = analyticsDay(new Date());
  const days = analytics.days && typeof analytics.days === 'object' ? analytics.days : {};

  // Build the previous 7 India-time calendar dates.
  let last7 = 0;
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit'
  });
  // Noon UTC avoids crossing the India-date boundary while subtracting days.
  const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12));
  for (let i = 0; i < 7; i += 1) {
    last7 += Number(days[formatter.format(cursor)] || 0);
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  return {
    total: Number(analytics.total || 0),
    today: Number(days[today] || 0),
    last7,
    lastVisit: analytics.lastVisit || ''
  };
}

function loadSite() {
  const data = readJson(CONTENT_FILE, { cfg: {}, regions: {} });
  if (!data.cfg || typeof data.cfg !== 'object') data.cfg = {};
  if (!data.regions || typeof data.regions !== 'object') data.regions = {};
  return data;
}

function safeJson(value) {
  // Prevent a content value from ever closing the script tag when embedded in EJS.
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function renderSite(req, res, isAdminPage) {
  const site = loadSite();
  const authed = isAuthed(req);
  const build = process.env.BUILD_ID || 'node-ejs-1';

  res.set('Cache-Control', 'no-store');
  res.render('index', {
    cfg: site.cfg,
    regions: site.regions,
    safeCfgJson: safeJson(site.cfg),
    isAdminPage,
    isAuthed: authed,
    build
  });
}

function requireAuth(req, res, next) {
  if (!isAuthed(req)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  return next();
}

app.post('/api/login', (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (username !== ADMIN_USER || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ ok: false, error: 'Invalid credentials' });
  }

  const token = createSession();
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const cookie = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    secure ? 'Secure' : ''
  ].filter(Boolean).join('; ');

  res.set('Set-Cookie', cookie);
  return res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  deleteSession(req);
  res.set('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return res.json({ ok: true });
});

app.get('/api/analytics', requireAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.json(analyticsStats());
});

app.put('/api/site', requireAuth, (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      !body.cfg || typeof body.cfg !== 'object' ||
      !body.regions || typeof body.regions !== 'object') {
    return res.status(400).json({ ok: false, error: 'Invalid site data' });
  }

  try {
    writeJsonAtomic(CONTENT_FILE, {
      cfg: body.cfg,
      regions: body.regions
    });
    return res.json({ ok: true, savedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Could not save content.json:', error);
    return res.status(500).json({ ok: false, error: 'Could not save site data' });
  }
});

app.get('/admin', (req, res) => renderSite(req, res, true));

app.get("/healthCheck",(req,res)=>{
  return res.status(200).json({
    status:"ok"
  })
})

function publicPage(req, res) {
  // Admin edit mode still loads the public page, so it can edit the exact same DOM.
  recordVisit();
  renderSite(req, res, false);
}

app.get('/', publicPage);
app.get('/index.html', publicPage);

app.use(express.static(path.join(ROOT, 'public'), {
  extensions: false,
  index: false,
  maxAge: '1h'
}));

app.use((req, res) => {
  res.status(404).send('Not found');
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ ok: false, error: 'Server error' });
});

app.listen(PORT, HOST, () => {
  console.log(`Dr Dixit Bilaspur Hospital running at http://localhost:${PORT}`);
  console.log(`Admin dashboard: http://localhost:${PORT}/admin`);
});
