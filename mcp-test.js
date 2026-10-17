'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { randomBytes, createHash } = require('node:crypto');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-mcp-'));
  let httpServer;
  let child, childExit;
  const connected = [];
  try {
    for (const dir of ['notes/技术', 'notes/私人', 'resources']) fs.mkdirSync(path.join(tmp, dir), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'notes/技术/测试.md'), '# 测试\n## 同步\n服务器同步资料\n### 细节\n细节内容\n## 下一章\n不应出现在上一章节\n![图片](../../resources/pixel.png)\n[[私人/秘密.md]]');
    fs.writeFileSync(path.join(tmp, 'notes/私人/秘密.md'), '# 秘密\n服务器同步资料');
    fs.writeFileSync(path.join(tmp, 'resources/pixel.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'));
    fs.writeFileSync(path.join(tmp, 'resources/unlinked.txt'), 'not linked');
    const techToken = randomBytes(32).toString('hex'), privateToken = randomBytes(32).toString('hex');
    const hash = token => createHash('sha256').update(token).digest('hex');
    const { createHttpServer } = require('./mcp-server');
    httpServer = createHttpServer({ vault: tmp, clients: [
      { id: 'tech', tokenSha256: hash(techToken), roots: ['技术'] },
      { id: 'private', tokenSha256: hash(privateToken), roots: ['私人'] },
    ] });
    await new Promise(resolve => httpServer.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + httpServer.address().port;
    assert.equal((await fetch(base + '/healthz')).status, 200);
    assert.equal((await fetch(base + '/mcp', { method: 'POST' })).status, 404, 'previous endpoint is retired');
    assert.equal((await fetch(base + '/note', { method: 'POST' })).status, 401);
    async function connect(token) {
      const client = new Client({ name: 'atlas-test', version: '1.0.0' });
      connected.push(client);
      await client.connect(new StreamableHTTPClientTransport(new URL(base + '/note'), { requestInit: { headers: { Authorization: 'Bearer ' + token } } }));
      return client;
    }
    const tech = await connect(techToken), privateClient = await connect(privateToken);
    const tools = (await tech.listTools()).tools;
    assert.deepEqual(tools.map(tool => tool.name).sort(), ['get_attachment', 'list_notes', 'read_note', 'search_notes']);
    assert.ok(tools.every(tool => tool.annotations.readOnlyHint));
    const search = await tech.callTool({ name: 'search_notes', arguments: { query: '服务器 同步' } });
    const data = JSON.parse(search.content[0].text);
    assert.equal(data.total, 1);
    assert.equal(data.results[0].relPath, '技术/测试.md');
    const privateSearch = await privateClient.callTool({ name: 'search_notes', arguments: { query: '服务器 同步' } });
    assert.equal(JSON.parse(privateSearch.content[0].text).results[0].relPath, '私人/秘密.md');
    const call = async (name, args) => {
      const result = await tech.callTool({ name, arguments: args });
      assert.ok(!result.isError, result.content[0].text);
      return JSON.parse(result.content[0].text);
    };
    const section = await call('read_note', { path: '技术/测试.md', heading: '同步' });
    assert.equal(section.text, '## 同步\n服务器同步资料\n### 细节\n细节内容');
    assert.equal(section.next, null);
    assert.equal(section.syncStatus, 'unknown');
    for (const target of ['私人/秘密.md', '../私人/秘密.md', '/etc/passwd']) {
      const denied = await tech.callTool({ name: 'read_note', arguments: { path: target } });
      assert.equal(denied.isError, true);
      assert.doesNotMatch(denied.content[0].text, /服务器同步资料|\/Users\//);
    }
    fs.symlinkSync(path.join(tmp, 'notes/私人'), path.join(tmp, 'notes/技术/软链'));
    assert.equal((await tech.callTool({ name: 'read_note', arguments: { path: '技术/软链/秘密.md' } })).isError, true);
    const image = await tech.callTool({ name: 'get_attachment', arguments: { document: '技术/测试.md', path: 'resources/pixel.png' } });
    assert.ok(!image.isError);
    assert.equal(image.content[1].type, 'image');
    assert.equal(image.content[1].mimeType, 'image/png');
    for (const target of ['resources/unlinked.txt', '../outside.txt', 'notes/私人/秘密.md']) {
      assert.equal((await tech.callTool({ name: 'get_attachment', arguments: { document: '技术/测试.md', path: target } })).isError, true);
    }
    fs.writeFileSync(path.join(tmp, 'notes/技术/分页.md'), '# 分页\n' + '中文😀'.repeat(90) + '\n最后一行');
    let cursor = {}, reconstructed = '', version;
    let pages = 0;
    do {
      const part = await call('read_note', { path: '技术/分页.md', ...cursor, version, maxChars: 29 });
      assert.ok(part.text.length <= 29);
      assert.doesNotMatch(part.text, /[\uD800-\uDBFF]$/);
      reconstructed += part.text;
      version = part.version;
      cursor = part.next;
      pages++;
      assert.ok(pages < 100, 'pagination must advance');
    } while (cursor);
    assert.ok(pages > 2);
    assert.equal(reconstructed, fs.readFileSync(path.join(tmp, 'notes/技术/分页.md'), 'utf8'));
    let tinyCursor = {}, tinyText = '';
    do {
      const part = await call('read_note', { path: '技术/测试.md', ...tinyCursor, maxLines: 1, maxChars: 3 });
      tinyText += part.text;
      tinyCursor = part.next;
    } while (tinyCursor);
    assert.equal(tinyText, fs.readFileSync(path.join(tmp, 'notes/技术/测试.md'), 'utf8'), 'line and character pagination must preserve every newline');
    fs.writeFileSync(path.join(tmp, 'notes/技术/分页.md'), '# 已修改\nnew-fresh-keyword');
    assert.equal((await call('search_notes', { query: 'new-fresh-keyword' })).total, 1);
    assert.equal((await tech.callTool({ name: 'read_note', arguments: { path: '技术/分页.md', version } })).isError, true);
    fs.writeFileSync(path.join(tmp, 'notes/技术/代码.md'), '# 代码\n```md\n## 假标题\n```\n## 真标题\n实际内容');
    assert.equal((await call('read_note', { path: '技术/代码.md' })).headings.length, 2);
    assert.equal((await tech.callTool({ name: 'read_note', arguments: { path: '技术/代码.md', heading: '假标题' } })).isError, true);
    fs.writeFileSync(path.join(tmp, 'notes/技术/标题.md'), '# C#\n正文\n## 章节 ###\n内容\n## 保留###\n结尾');
    assert.deepEqual((await call('read_note', { path: '技术/标题.md' })).headings.map(item => item.title), ['C#', '章节', '保留###']);
    const auth = { Authorization: 'Bearer ' + techToken };
    const checked = await promisify(execFile)(process.execPath, [path.join(__dirname, 'mcp-check.js')], { env: { ...process.env, ATLAS_MCP_URL: base + '/note', ATLAS_MCP_TOKEN: techToken }, timeout: 10000 });
    assert.match(checked.stdout, /PASS: MCP initialize/);
    assert.ok(!checked.stdout.includes(techToken));
    assert.ok(!checked.stdout.includes('测试.md'));
    assert.equal((await fetch(base + '/note', { headers: auth })).status, 405);
    assert.equal((await fetch(base + '/note', { method: 'POST', headers: { ...auth, Origin: 'https://untrusted.example' } })).status, 403);
    const wrongHost = await new Promise((resolve, reject) => {
      const req = http.request(base + '/note', { method: 'POST', headers: { ...auth, Host: 'untrusted.example' } }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject); req.end();
    });
    assert.equal(wrongHost, 403);
    assert.equal((await fetch(base + '/note?token=placeholder', { method: 'POST', headers: auth })).status, 400);
    assert.equal((await fetch(base + '/note', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: '{' })).status, 400);
    assert.equal((await fetch(base + '/note', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: ' '.repeat(65537) })).status, 413);
    assert.equal((await tech.callTool({ name: 'read_note', arguments: { path: '技术/测试.md', maxChars: 1000000 } })).isError, true);
    assert.throws(() => createHttpServer({ vault: tmp, clients: [] }), /client/i);
    assert.throws(() => createHttpServer({ vault: tmp, clients: [], maxNoteBytes: 65 * 1024 * 1024 }), /maxNoteBytes/);
    assert.throws(() => createHttpServer({ vault: tmp, clients: [{ id: 'bad', tokenSha256: hash(techToken), roots: ['../私人'] }] }), /root/i);
    assert.throws(() => createHttpServer({ vault: tmp, clients: [
      { id: 'a', tokenSha256: hash(techToken), roots: ['技术'] },
      { id: 'b', tokenSha256: hash(techToken), roots: ['私人'] },
    ] }), /duplicate/i);
    await assert.rejects(promisify(execFile)(process.execPath, [path.join(__dirname, 'mcp-server.js')], { env: { ...process.env, ATLAS_VAULT: '', ATLAS_MCP_CLIENTS_FILE: '' } }));
    fs.writeFileSync(path.join(tmp, 'resources/large.png'), Buffer.alloc(512 * 1024 + 1));
    fs.writeFileSync(path.join(tmp, 'notes/技术/大附件.md'), '# 大附件\n![](../../resources/large.png)');
    assert.equal((await tech.callTool({ name: 'get_attachment', arguments: { document: '技术/大附件.md', path: 'resources/large.png' } })).isError, true);
    fs.writeFileSync(path.join(tmp, 'resources/linked.txt'), '附件文字');
    fs.writeFileSync(path.join(tmp, 'notes/技术/文字附件.md'), '# 文字附件\n[附件](../../resources/linked.txt)');
    const textAttachment = await tech.callTool({ name: 'get_attachment', arguments: { document: '技术/文字附件.md', path: 'resources/linked.txt' } });
    assert.equal(textAttachment.content[1].type, 'resource');
    assert.equal(Buffer.from(textAttachment.content[1].resource.blob, 'base64').toString(), '附件文字');
    fs.writeFileSync(path.join(tmp, 'notes/技术/大文档.md'), '# 大文档\n' + 'oversized-secret '.repeat(300000));
    assert.equal((await tech.callTool({ name: 'read_note', arguments: { path: '技术/大文档.md' } })).isError, true);
    assert.equal((await call('search_notes', { query: 'oversized-secret' })).total, 0);
    let limited = false;
    for (let i = 0; i < 121; i++) {
      const response = await fetch(base + '/note', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: i, method: 'ping' }) });
      await response.text();
      if (response.status === 429) { limited = true; break; }
    }
    assert.ok(limited, 'per-client rate limit must be enforced');
    const unaffected = await privateClient.callTool({ name: 'search_notes', arguments: { query: '服务器 同步' } });
    assert.equal(JSON.parse(unaffected.content[0].text).total, 1, 'rate limits must not spill between clients');
    // Real CLI startup uses a file containing only hashes, as production does.
    const clientFile = path.join(tmp, 'clients.json');
    fs.writeFileSync(clientFile, JSON.stringify([{ id: 'tech', tokenSha256: hash(techToken), roots: ['技术'] }]), { mode: 0o600 });
    child = spawn(process.execPath, [path.join(__dirname, 'mcp-server.js')], {
      env: { PATH: process.env.PATH, ATLAS_VAULT: tmp, ATLAS_MCP_CLIENTS_FILE: clientFile, ATLAS_MCP_PORT: '0', ATLAS_MCP_MAX_NOTE_BYTES: String(16 * 1024 * 1024) }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    childExit = new Promise(resolve => child.once('exit', resolve));
    const cliUrl = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('CLI startup timeout')), 10000);
      child.stdout.on('data', data => {
        const match = String(data).match(/http:\/\/127\.0\.0\.1:\d+\/note/);
        if (match) { clearTimeout(timer); resolve(match[0]); }
      });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', () => { clearTimeout(timer); reject(Error('CLI exited before startup')); });
    });
    const cliCheck = await promisify(execFile)(process.execPath, [path.join(__dirname, 'mcp-check.js')], { env: { ...process.env, ATLAS_MCP_URL: cliUrl, ATLAS_MCP_TOKEN: techToken }, timeout: 10000 });
    assert.match(cliCheck.stdout, /PASS/);
    const expandedClient = new Client({ name: 'expanded-limit-test', version: '1.0.0' });
    connected.push(expandedClient);
    await expandedClient.connect(new StreamableHTTPClientTransport(new URL(cliUrl), { requestInit: { headers: auth } }));
    const expandedRead = await expandedClient.callTool({ name: 'read_note', arguments: { path: '技术/大文档.md', maxChars: 100 } });
    assert.ok(!expandedRead.isError, 'configured 16 MiB limit must admit a note above the default 4 MiB limit');
    assert.match((await expandedClient.listTools()).tools.find(tool => tool.name === 'read_note').description, /16777216 bytes/);
    assert.equal((await fetch(cliUrl, { method: 'POST', headers: { Authorization: 'Bearer ' + privateToken } })).status, 401, 'a removed client cannot connect after service restart');
    console.log('PASS: official MCP client initialize/list/call over HTTP, independent client scopes and authentication');
    console.log('PASS: section boundaries, Unicode pagination, version conflict, attachments, live edits, host/origin validation and request limits');
    console.log('PASS: standalone service startup, connection checker, per-client rate limits and revocation after restart');
  } finally {
    if (child && child.exitCode === null) { child.kill('SIGTERM'); await childExit; }
    await Promise.all(connected.map(client => client.close()));
    if (httpServer) { httpServer.closeAllConnections(); await new Promise(resolve => httpServer.close(resolve)); }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
