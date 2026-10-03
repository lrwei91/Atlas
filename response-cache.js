'use strict';
const fs = require('node:fs');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const entries = new Map();
const MAX_BYTES = 32 * 1024 * 1024;
let bytes = 0;
function wantsGzip(req) {
  return (req.headers['accept-encoding'] || '').split(',').some(part => {
    const [name, ...params] = part.trim().split(';');
    return name === 'gzip' && !params.some(p => /^\s*q\s*=\s*0(?:\.0*)?\s*$/.test(p));
  });
}
function etag(st) { return `W/"${[st.dev, st.ino, st.size, st.mtimeMs, st.ctimeMs].join('-')}"`; }
function fresh(req, tag) {
  return (req.headers['if-none-match'] || '').split(',').some(value => value.trim() === '*' || value.trim().replace(/^W\//, '') === tag.replace(/^W\//, ''));
}
function staticBody(file, st) {
  const key = etag(st), hit = entries.get(file);
  if (hit?.key === key) { entries.delete(file); entries.set(file, hit); return hit; }
  if (hit) { bytes -= hit.bytes; entries.delete(file); }
  const body = fs.readFileSync(file), gzip = zlib.gzipSync(body);
  const entry = { key, body, gzip, bytes: body.length + gzip.length };
  while (bytes + entry.bytes > MAX_BYTES && entries.size) {
    const first = entries.keys().next().value; bytes -= entries.get(first).bytes; entries.delete(first);
  }
  if (entry.bytes <= MAX_BYTES) { entries.set(file, entry); bytes += entry.bytes; }
  return entry;
}
function coverBody(file, st, source) {
  const cacheKey = 'cover:' + file, key = etag(st), hit = entries.get(cacheKey);
  if (hit?.key === key) { entries.delete(cacheKey); entries.set(cacheKey, hit); return hit.body; }
  if (hit) { bytes -= hit.bytes; entries.delete(cacheKey); }
  const body = Buffer.from(source, 'base64'), entry = { key, body, bytes: body.length };
  while (bytes + entry.bytes > MAX_BYTES && entries.size) {
    const first = entries.keys().next().value; bytes -= entries.get(first).bytes; entries.delete(first);
  }
  if (entry.bytes <= MAX_BYTES) { entries.set(cacheKey, entry); bytes += entry.bytes; }
  return body;
}
function json(res, code, obj, options = {}) {
  const body = Buffer.from(JSON.stringify(obj)), req = res.atlasRequest;
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Accept-Encoding' };
  if (options.validate && req && code === 200) {
    headers['Cache-Control'] = 'private, no-cache';
    headers.ETag = '"' + crypto.createHash('sha256').update(options.key || body).digest('hex') + '"';
    if (fresh(req, headers.ETag)) { res.writeHead(304, headers); res.end(); return; }
  }
  if (body.length > 1024 && req && wantsGzip(req)) {
    zlib.gzip(body, (err, compressed) => {
      if (res.destroyed) return;
      if (!err) headers['Content-Encoding'] = 'gzip';
      res.writeHead(code, headers); res.end(req.method === 'HEAD' ? undefined : err ? body : compressed);
    });
  } else { res.writeHead(code, headers); res.end(req?.method === 'HEAD' ? undefined : body); }
}
module.exports = { etag, fresh, staticBody, coverBody, wantsGzip, json };
