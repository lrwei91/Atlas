'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-local-share-'));
  const vault = path.join(root, 'vault'), state = path.join(root, 'state');
  fs.mkdirSync(path.join(vault, 'notes'), { recursive: true });
  fs.mkdirSync(path.join(vault, 'resources'));
  fs.mkdirSync(state);
  fs.writeFileSync(path.join(vault, 'notes', 'shared.md'), '# Shared\n![](../resources/image.png)');
  fs.writeFileSync(path.join(vault, 'notes', 'private.md'), '# Private');
  fs.writeFileSync(path.join(vault, 'resources', 'image.png'), 'image');
  fs.writeFileSync(path.join(vault, 'resources', 'private.png'), 'private');
  const origin = 'https://note.lrwei91.cn';
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: { ...process.env, PORT: '0', ATLAS_VAULT: vault, ATLAS_STATE_DIR: state,
      ATLAS_PUBLIC_URL: origin },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = new Promise(resolve => child.once('exit', resolve));
  try {
    const base = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Startup timeout')), 10000);
      child.stdout.on('data', data => {
        const m = String(data).match(/http:\/\/localhost:(\d+)/);
        if (m) { clearTimeout(timer); resolve('http://127.0.0.1:' + m[1]); }
      });
      child.once('exit', () => { clearTimeout(timer); reject(Error('Server exited')); });
    });
    const setup = await fetch(base + '/auth/setup', { method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'fixture', password: 'fixture-password-123',
        setupToken: fs.readFileSync(path.join(state, 'setup-token'), 'utf8') }),
    });
    assert.equal(setup.status, 200);
    const headers = { Origin: origin, Cookie: setup.headers.get('set-cookie').split(';')[0] };
    const endpoint = base + '/api/share?path=shared.md';
    assert.equal((await (await fetch(endpoint, { headers })).json()).url, null);
    assert.equal((await fetch(base + '/s/' + 'a'.repeat(64) + '/doc')).status, 404);
    assert.equal((await fetch(base + '/share/' + 'a'.repeat(22) + '/doc')).status, 404);
    const first = await fetch(endpoint, { method: 'POST', headers });
    assert.equal(first.status, 200);
    const firstShare = await first.json();
    const token = new URL(firstShare.url).pathname.split('/').pop();
    assert.match(token, /^[A-Za-z0-9_-]{22}$/);
    assert.equal((await fetch(base + '/s/' + token, { redirect: 'manual' })).status, 200);
    assert.equal((await fetch(base + '/s/' + token + '/doc')).status, 200);
    assert.equal((await fetch(base + '/s/' + token + '/file?path=resources/image.png')).status, 200);
    assert.equal((await fetch(base + '/s/' + token + '/file?path=resources/private.png')).status, 404);
    assert.equal((await fetch(base + '/api/doc?path=private.md')).status, 401);
    assert.equal((await fetch(endpoint, { method: 'POST', headers: { ...headers, Origin: 'https://invalid.example' } })).status, 403);
    assert.equal((await fetch(endpoint, { method: 'POST', headers })).status, 200, 'publish needs no GitHub credentials');
    assert.equal((await fetch(endpoint, { method: 'DELETE', headers })).status, 200, 'revoke needs no GitHub credentials');
    assert.equal((await fetch(base + '/s/' + token + '/doc')).status, 404);
    const fresh = await fetch(endpoint, { method: 'POST', headers });
    assert.equal(fresh.status, 200);
    const published = await fresh.json();
    assert.match(published.url, /^https:\/\/note\.lrwei91\.cn\/s\/[A-Za-z0-9_-]{22}$/);
    const doc = await (await fetch(base + '/api/doc?path=shared.md', { headers })).json();
    const saved = await fetch(base + '/api/doc?path=shared.md', { method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '# Updated', version: doc.version }),
    });
    assert.equal(saved.status, 200);
    assert.match((await (await fetch(base + new URL(published.url).pathname + '/doc')).json()).content, /Updated/);
    assert.equal((await fetch(base + '/api/doc?path=shared.md', { method: 'DELETE', headers })).status, 200);
    assert.equal((await fetch(base + new URL(published.url).pathname)).status, 404);
    assert.equal(fs.existsSync(path.join(state, 'share-repository')), false);
    console.log('PASS: server share creation, scoped media, live updates, revoke/delete, retired routes rejected');
  } finally {
    child.kill('SIGTERM'); await exited;
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
