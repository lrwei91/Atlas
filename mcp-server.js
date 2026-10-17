'use strict';
const fs = require('node:fs');
const http = require('node:http');
const crypto = require('node:crypto');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const createKnowledge = require('./knowledge');
const createMcpServer = require('./mcp-tools');
const readBody = require('./request-body');

function createHttpServer({ vault, clients, allowedHosts = ['127.0.0.1', 'localhost', '[::1]'], allowedOrigins = [], maxNoteBytes = 4 * 1024 * 1024 }) {
  if (!Number.isSafeInteger(maxNoteBytes) || maxNoteBytes < 1 || maxNoteBytes > 64 * 1024 * 1024) throw Error('Invalid maxNoteBytes');
  if (!Array.isArray(clients) || !clients.length) throw Error('Configure at least one MCP client');
  if (!Array.isArray(allowedHosts) || !allowedHosts.length || allowedHosts.some(host => typeof host !== 'string' || !host || host.includes('/') || host.includes('*'))) throw Error('Invalid allowedHosts');
  if (!Array.isArray(allowedOrigins) || allowedOrigins.some(origin => { try { return new URL(origin).origin !== origin; } catch { return true; } })) throw Error('Invalid allowedOrigins');
  const noteCache = require('./note-cache')();
  const ids = new Set(), hashes = new Set();
  const principals = clients.map(client => {
    if (!client || typeof client.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(client.id) || !/^[a-f0-9]{64}$/.test(client.tokenSha256) || !Array.isArray(client.roots) || !client.roots.length || ids.has(client.id) || hashes.has(client.tokenSha256)) throw Error('Invalid or duplicate MCP client');
    ids.add(client.id); hashes.add(client.tokenSha256);
    return { hash: Buffer.from(client.tokenSha256, 'hex'), kb: createKnowledge(vault, { roots: client.roots, noteCache, maxReadBytes: maxNoteBytes }), windowStart: 0, requests: 0, active: 0 };
  });
  function send(res, status, value) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  }
  const server = http.createServer(async (req, res) => {
    let mcp;
    try {
      const url = new URL(req.url, 'http://localhost');
      let hostname;
      try { hostname = new URL('http://' + req.headers.host).hostname; } catch { return send(res, 403, { error: 'Invalid host' }); }
      if (!allowedHosts.includes(hostname)) return send(res, 403, { error: 'Invalid host' });
      if (req.headers.origin && !allowedOrigins.includes(req.headers.origin)) return send(res, 403, { error: 'Invalid origin' });
      if (url.pathname === '/healthz' && req.method === 'GET') return send(res, 200, { ok: true });
      if (url.pathname !== '/note') return send(res, 404, { error: 'Not found' });
      if (url.search) return send(res, 400, { error: 'Use Authorization header; query parameters are not supported' });
      const token = /^Bearer ([^\s]{32,512})$/.exec(req.headers.authorization || '')?.[1];
      const hash = crypto.createHash('sha256').update(token || '').digest();
      const principal = principals.find(client => crypto.timingSafeEqual(client.hash, hash));
      if (!token || !principal) { res.setHeader('WWW-Authenticate', 'Bearer realm="atlas-knowledge"'); return send(res, 401, { error: 'Unauthorized' }); }
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { error: 'Method not allowed' }); }
      const now = Date.now();
      if (now - principal.windowStart >= 60000) { principal.windowStart = now; principal.requests = 0; }
      if (++principal.requests > 120 || principal.active >= 8) { res.setHeader('Retry-After', '60'); return send(res, 429, { error: 'Rate limit exceeded' }); }
      if ((req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') return send(res, 415, { error: 'Expected application/json' });
      principal.active++;
      res.once('close', () => { principal.active--; });
      let body;
      try { body = JSON.parse(await readBody(req, 64 * 1024)); }
      catch (error) { return send(res, error.message === 'Request body too large' ? 413 : 400, { error: 'Invalid or oversized JSON request' }); }
      mcp = createMcpServer(principal.kb);
      res.once('close', () => { mcp.close().catch(() => {}); });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await mcp.connect(transport);
      res.setHeader('Cache-Control', 'no-store');
      await transport.handleRequest(req, res, body);
    } catch {
      if (!res.headersSent) send(res, 500, { error: 'MCP request failed' });
      else res.end();
      if (mcp) await mcp.close().catch(() => {});
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return server;
}

if (require.main === module) {
  try {
    if (!process.env.ATLAS_VAULT || !process.env.ATLAS_MCP_CLIENTS_FILE) throw Error('ATLAS_VAULT and ATLAS_MCP_CLIENTS_FILE are required');
    const clients = JSON.parse(fs.readFileSync(process.env.ATLAS_MCP_CLIENTS_FILE, 'utf8'));
    const server = createHttpServer({ vault: process.env.ATLAS_VAULT, clients, allowedHosts: process.env.ATLAS_MCP_ALLOWED_HOSTS?.split(',').map(value => value.trim()), allowedOrigins: process.env.ATLAS_MCP_ALLOWED_ORIGINS?.split(',').map(value => value.trim()), maxNoteBytes: process.env.ATLAS_MCP_MAX_NOTE_BYTES ? Number(process.env.ATLAS_MCP_MAX_NOTE_BYTES) : undefined });
    const port = Number(process.env.ATLAS_MCP_PORT || 4320);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('Invalid ATLAS_MCP_PORT');
    server.listen(port, '127.0.0.1', () => console.log('Atlas MCP listening on http://127.0.0.1:' + server.address().port + '/note'));
    server.on('error', () => { console.error('Atlas MCP could not bind its listening socket'); process.exitCode = 1; });
    const stop = () => { server.close(() => process.exit(0)); setTimeout(() => { server.closeAllConnections(); process.exit(0); }, 5000).unref(); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  } catch { console.error('Atlas MCP startup failed; check vault, client file and MCP settings'); process.exitCode = 1; }
}

module.exports = { createHttpServer };
