'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const directory = process.env.ATLAS_STATE_DIR || path.join(__dirname, '.local');
const file = path.join(directory, 'shares.json');
function load() { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}; }
function save(data) {
  const temp = file + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(data), { mode: 0o600 });
  fs.renameSync(temp, file);
}
function find(rel) { return Object.entries(load()).find(([,v]) => v.relPath === rel)?.[0] || null; }
function create(rel) { const existing = find(rel); if (existing) return existing; const all = load(); const token = crypto.randomBytes(32).toString('hex'); all[token] = { relPath: rel, createdAt: new Date().toISOString() }; save(all); return token; }
function revoke(rel) { const all = load(); for (const [token,value] of Object.entries(all)) if (value.relPath === rel) delete all[token]; save(all); }
function get(token) { if (!/^[a-f0-9]{64}$/.test(token)) return null; return load()[token] || null; }
function paths() { return new Set(Object.values(load()).map(value => value.relPath)); }
module.exports = { find, create, revoke, get, paths };
