'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);
const readBody = require('./request-body');
const stateDir = process.env.ATLAS_STATE_DIR || path.join(__dirname, '.local');
fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
const adminFile = path.join(stateDir, 'admin.json');
const tokenFile = path.join(stateDir, 'setup-token');
const sessions = new Map();
const attempts = new Map();
let creating = false;
if (!fs.existsSync(adminFile) && !fs.existsSync(tokenFile)) {
  fs.writeFileSync(tokenFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
}
function equal(a, b) {
  const aa = Buffer.from(a || ''), bb = Buffer.from(b || '');
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}
function session(req) {
  const cookie = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('atlas_session='));
  const token = cookie ? cookie.slice(14) : '';
  const value = sessions.get(token);
  if (!value || value.expires < Date.now()) { sessions.delete(token); return null; }
  return { token, ...value };
}
function cookie(token, maxAge) {
  return `atlas_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${process.env.ATLAS_PUBLIC_URL?.startsWith('https:') ? '; Secure' : ''}`;
}
async function body(req) {
  return JSON.parse(await readBody(req, 4096));
}
async function handle(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/auth/status') {
    json(res, 200, { setupRequired: !fs.existsSync(adminFile), authenticated: !!session(req), publicUrl: process.env.ATLAS_PUBLIC_URL || null }); return true;
  }
  if (!['/auth/setup', '/auth/login', '/auth/logout'].includes(pathname)) return false;
  if (req.method !== 'POST') { json(res, 405, { error: '请使用 POST' }); return true; }
  const expected = process.env.ATLAS_PUBLIC_URL || `http://${req.headers.host}`;
  if (req.headers.origin !== expected || !(req.headers['content-type'] || '').startsWith('application/json')) {
    json(res, 403, { error: '请求来源无效' }); return true;
  }
  if (pathname === '/auth/logout') {
    const current = session(req); if (current) sessions.delete(current.token);
    res.setHeader('Set-Cookie', cookie('', 0)); json(res, 200, { ok: true }); return true;
  }
  // Global limiter cannot be bypassed by forged forwarded IP headers.
  const key = req.socket.remoteAddress;
  const now = Date.now();
  const recent = (attempts.get(key) || []).filter(t => now - t < 15 * 60 * 1000);
  if (recent.length >= 10) { json(res, 429, { error: '尝试过于频繁，请 15 分钟后重试' }); return true; }
  recent.push(now); attempts.set(key, recent);
  let input;
  try { input = await body(req); } catch { json(res, 400, { error: '请求格式无效' }); return true; }
  const { username, password, setupToken } = input;
  if (typeof username !== 'string' || typeof password !== 'string' || username.length > 64 || password.length > 256) {
    json(res, 400, { error: '账号或密码格式无效' }); return true;
  }
  if (pathname === '/auth/setup') {
    if (fs.existsSync(adminFile) || creating) { json(res, 409, { error: '管理员已创建' }); return true; }
    if (typeof setupToken !== 'string' || !equal(setupToken, fs.readFileSync(tokenFile, 'utf8').trim())) {
      json(res, 403, { error: '初始化凭据无效，请使用本机生成的凭据' }); return true;
    }
    if (!username.trim() || password.length < 12) { json(res, 400, { error: '请填写账号，密码至少 12 位' }); return true; }
    creating = true;
    try {
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = (await scrypt(password, salt, 64)).toString('hex');
      fs.writeFileSync(adminFile, JSON.stringify({ username: username.trim(), salt, hash }), { mode: 0o600, flag: 'wx' });
      fs.unlinkSync(tokenFile);
    } finally { creating = false; }
  } else {
    if (!fs.existsSync(adminFile)) { json(res, 409, { error: '请先创建管理员' }); return true; }
    const admin = JSON.parse(fs.readFileSync(adminFile, 'utf8'));
    const hash = (await scrypt(password, admin.salt, 64)).toString('hex');
    if (!equal(username.trim(), admin.username) || !equal(hash, admin.hash)) {
      json(res, 401, { error: '账号或密码错误' }); return true;
    }
  }
  attempts.delete(key);
  for (const [key, value] of sessions) if (value.expires < now) sessions.delete(key);
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { expires: now + 12 * 60 * 60 * 1000 });
  res.setHeader('Set-Cookie', cookie(token, 43200));
  json(res, 200, { ok: true }); return true;
}
module.exports = { handle, session };
