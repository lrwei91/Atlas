'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const directory = process.env.ATLAS_STATE_DIR || path.join(__dirname, '.local');
const file = path.join(directory, 'shares.json');
let cached, stamp, byPath, aliases;
const signature = () => { try { const s = fs.statSync(file); return [s.ino, s.size, s.mtimeMs, s.ctimeMs].join(':'); } catch (e) { if (e.code === 'ENOENT') return ''; throw e; } };
const validToken = token => /^(?:[A-Za-z0-9_-]{22}|[a-f0-9]{64})$/.test(token);
function shortToken(data) { let token; do { token = crypto.randomBytes(16).toString('base64url'); } while (data[token]); return token; }
function load() {
  const current = signature();
  if (cached && stamp === current) return cached;
  const data = current ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  let migrated = false;
  for (const [token, value] of Object.entries(data)) {
    if (/^[a-f0-9]{64}$/.test(token)) {
      const short = shortToken(data);
      data[short] = { ...value, legacyToken: token }; delete data[token]; migrated = true;
    }
  }
  if (migrated) save(data);
  cached = data; stamp = signature(); byPath = new Map(); aliases = new Map();
  for (const [token, value] of Object.entries(data)) {
    byPath.set(value.relPath, token);
    if (value.legacyToken) aliases.set(value.legacyToken, token);
  }
  return data;
}
function save(data) {
  cached = null;
  const temp = file + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(data), { mode: 0o600 });
  fs.renameSync(temp, file);
}
function find(rel) { load(); return byPath.get(rel) || null; }
function create(rel) { const existing = find(rel); if (existing) return existing; const all = load(); const token = shortToken(all); all[token] = { relPath: rel, createdAt: new Date().toISOString() }; save(all); return token; }
function revoke(rel) { const all = load(); for (const [token,value] of Object.entries(all)) if (value.relPath === rel) delete all[token]; save(all); }
function get(token) { if (!validToken(token)) return null; const all = load(); return all[token] || all[aliases.get(token)] || null; }
function paths() { return new Set(Object.values(load()).map(value => value.relPath)); }
module.exports = { find, create, revoke, get, paths };
