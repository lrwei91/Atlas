'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { performance } = require('node:perf_hooks');

// Isolated fixture; ATLAS_BENCH_SOURCE can point to a pre-change source snapshot.
(async () => {
  const source = process.env.ATLAS_BENCH_SOURCE || __dirname;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-performance-'));
  const vault = path.join(tmp, 'vault');
  const notes = path.join(vault, 'notes');
  const state = path.join(tmp, 'state');
  fs.mkdirSync(notes, { recursive: true });
  fs.mkdirSync(path.join(vault, 'resources', 'nested'), { recursive: true });
  const inlineCover = process.env.ATLAS_BENCH_COVERS ? '---\n![封面](data:image/jpeg;base64,' + Buffer.alloc(48 * 1024, 255).toString('base64') + ')\n---\n' : '';
  for (let i = 0; i < 500; i++) {
    fs.writeFileSync(path.join(notes, `note-${i}.md`), (i < 260 ? inlineCover : '') + `# Note ${i}\n\n` + 'Atlas performance searchable content.\n'.repeat(250));
    fs.writeFileSync(path.join(vault, 'resources', 'nested', `image-${i}.png`), 'fixture');
  }
  fs.writeFileSync(path.join(notes, 'direct.md'), '# Direct\n![](../resources/nested/image-0.png)');
  fs.writeFileSync(path.join(notes, 'fallback.md'), '# Fallback\n![[image-0.png]]');
  const child = spawn(process.execPath, [path.join(source, 'server.js')], {
    env: { ...process.env, PORT: '0', ATLAS_VAULT: vault, ATLAS_STATE_DIR: state, ATLAS_PUBLIC_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = new Promise(resolve => child.once('exit', resolve));
  try {
    const base = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Startup timeout')), 10000);
      child.stdout.on('data', data => {
        const match = String(data).match(/http:\/\/localhost:(\d+)/);
        if (match) { clearTimeout(timer); resolve('http://127.0.0.1:' + match[1]); }
      });
      child.once('exit', code => { clearTimeout(timer); reject(Error('Server exited ' + code)); });
    });
    const setup = await fetch(base + '/auth/setup', {
      method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'fixture-passphrase-123', setupToken: fs.readFileSync(path.join(state, 'setup-token'), 'utf8') }),
    });
    assert.equal(setup.status, 200);
    const cookie = setup.headers.get('set-cookie').split(';')[0];
    async function get(route) {
      const response = await fetch(base + route, { headers: { Cookie: cookie } });
      assert.equal(response.status, 200);
      return response.json();
    }
    const medians = {};
    for (const [label, route] of Object.entries({ cards: '/api/cards', search: '/api/search?q=searchable', textDoc: '/api/doc?path=note-0.md', directImage: '/api/doc?path=direct.md', fallbackImage: '/api/doc?path=fallback.md' })) {
      await get(route);
      const samples = [];
      for (let i = 0; i < 9; i++) {
        const start = performance.now(); await get(route); samples.push(performance.now() - start);
      }
      samples.sort((a, b) => a - b);
      medians[label] = Number(samples[4].toFixed(2));
    }
    console.log('Median local HTTP ms (502 notes, 500 images):', JSON.stringify(medians));
    if (inlineCover) console.log('Cards JSON bytes (260 embedded covers):', Buffer.byteLength(JSON.stringify(await get('/api/cards'))));

    // Repeated requests must still observe external edits and atomic replacements.
    const target = path.join(notes, 'note-0.md');
    fs.writeFileSync(target, '# Changed\nunique-fresh-content');
    assert.equal((await get('/api/search?q=unique-fresh-content')).results.length, 1);
    assert.equal((await get('/api/cards')).cards.find(c => c.relPath === 'note-0.md').title, 'Changed');
    fs.writeFileSync(target + '.new', '# Replaced\nunique-atomic-content');
    fs.renameSync(target + '.new', target);
    assert.match((await get('/api/doc?path=note-0.md')).content, /unique-atomic-content/);
    assert.equal((await get('/api/search?q=unique-fresh-content')).results.length, 0);
    fs.renameSync(target, path.join(notes, 'renamed.md'));
    const cards = (await get('/api/cards')).cards;
    assert.equal(cards.some(c => c.relPath === 'note-0.md'), false);
    assert.equal(cards.some(c => c.relPath === 'renamed.md'), true);
    fs.unlinkSync(path.join(notes, 'renamed.md'));
    assert.equal((await get('/api/search?q=unique-atomic-content')).results.length, 0);
    fs.writeFileSync(path.join(notes, 'added.md'), '# Added\nunique-added-content');
    assert.equal((await get('/api/search?q=unique-added-content')).results.length, 1);
    const beforeSave = await get('/api/doc?path=added.md');
    const write = (method, route, content) => fetch(base + route, {
      method, headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' },
      body: content === undefined ? undefined : JSON.stringify({ content, version: beforeSave.version }),
    });
    assert.equal((await write('PUT', '/api/doc?path=added.md', '# Saved\nunique-saved-content')).status, 200);
    assert.equal((await get('/api/search?q=unique-added-content')).results.length, 0);
    assert.equal((await get('/api/search?q=unique-saved-content')).results.length, 1);
    assert.equal((await get('/api/cards')).cards.find(c => c.relPath === 'added.md').title, 'Saved');
    assert.equal((await write('DELETE', '/api/doc?path=added.md')).status, 200);
    assert.equal((await get('/api/search?q=unique-saved-content')).results.length, 0);
    assert.equal((await get('/api/cards')).cards.some(c => c.relPath === 'added.md'), false);
    assert.match(fs.readFileSync(path.join(vault, '.trash', 'added.md'), 'utf8'), /unique-saved-content/);

    // Fallback uniqueness and share allowlists must not be cached across asset edits.
    assert.equal((await get('/api/doc?path=fallback.md')).assets['image-0.png'], 'resources/nested/image-0.png');
    const beforeAsset = await fetch(base + '/api/doc?path=fallback.md', { headers: { Cookie: cookie } });
    const assetTag = beforeAsset.headers.get('etag'); await beforeAsset.text();
    fs.writeFileSync(path.join(vault, 'resources', 'image-0.png'), 'direct fixture');
    if (assetTag) {
      const changed = await fetch(base + '/api/doc?path=fallback.md', { headers: { Cookie: cookie, 'If-None-Match': assetTag } });
      assert.equal(changed.status, 200, 'asset resolution changes must invalidate document validators');
      assert.equal((await changed.json()).assets['image-0.png'], 'resources/image-0.png');
    }
    assert.equal((await get('/api/doc?path=fallback.md')).assets['image-0.png'], 'resources/image-0.png');
    fs.unlinkSync(path.join(vault, 'resources', 'image-0.png'));
    fs.mkdirSync(path.join(vault, 'resources', 'duplicate'));
    fs.writeFileSync(path.join(vault, 'resources', 'duplicate', 'image-0.png'), 'duplicate');
    assert.equal((await get('/api/doc?path=fallback.md')).assets['image-0.png'], undefined);
    fs.unlinkSync(path.join(vault, 'resources', 'duplicate', 'image-0.png'));
    assert.equal((await get('/api/doc?path=fallback.md')).assets['image-0.png'], 'resources/nested/image-0.png');
    console.log('PASS: external edits, atomic replace, rename, deletion, additions, online save/trash, live image resolution');

    const { JSDOM } = require('jsdom');
    const page = fs.readFileSync(path.join(source, 'public', 'index.html'), 'utf8');
    let fixtureCards = [
      { relPath: 'Work/first.md', dir: 'Work', title: 'First', isMarkdown: true, mtime: Date.now(), size: 10, chars: 10, excerpt: '' },
      { relPath: 'Work/Child/second.md', dir: 'Work/Child', title: 'Second', isMarkdown: true, mtime: Date.now(), size: 10, chars: 10, excerpt: '' },
    ];
    const dom = new JSDOM(page, { url: base, runScripts: 'outside-only' });
    try {
      const w = dom.window;
      w.fetch = async url => ({ status: 200, json: async () => url === '/api/cards' ? { cards: fixtureCards } : {
        name: 'All', relPath: '', children: [{ name: 'Work', relPath: 'Work', children: [{ name: 'Child', relPath: 'Work/Child', children: [] }] }],
      } });
      w.eval(page.match(/<script>([\s\S]*?)<\/script>/)[1] + '\nwindow.testNameIndex = () => nameIndex;');
      await new Promise(resolve => setTimeout(resolve, 20));
      const count = dir => w.document.querySelector(`[data-dir="${dir}"] .cnt`).textContent;
      assert.equal(count('Work'), '2');
      assert.equal(count('Work/Child'), '1');
      fixtureCards = fixtureCards.slice(0, 1);
      await w.eval('loadCards()');
      w.eval('renderSidebar()');
      assert.equal(count('Work'), '1');
      assert.equal(count('Work/Child'), '0');
      assert.match(w.document.querySelector('.cal-day:has(.dot)').title, /1/);
      assert.equal(w.testNameIndex().second, undefined);
      console.log('PASS: nested directory counts, calendar counts and indexes refreshed after removal');
    } finally { dom.window.close(); }
  } finally {
    child.kill(); await exited;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
