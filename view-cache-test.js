'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const { performance } = require('node:perf_hooks');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  const html = fs.readFileSync('public/index.html', 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only' });
  const w = dom.window, calls = [];
  const cards = Array.from({ length: 500 }, (_, i) => ({ relPath: `note-${i}.md`, title: `Note ${i}`, dir: '', isMarkdown: true, isShared: i < 10, chars: 20, excerpt: 'Body text', mtime: Date.now() }));
  let revision = 1, exists = true, delayed = false, renders = 0;
  const doc = () => ({ relPath: 'note-0.md', title: 'Note 0', isMarkdown: true, content: '# Note 0\nBody ' + revision, assets: {}, links: {}, version: String(revision), mtime: revision });
  const reply = (value, status = 200, tag = null) => ({ status, ok: status === 200, headers: { get: name => name === 'etag' ? tag : null }, json: async () => { assert.notEqual(status, 304, '304 has no JSON body'); return value; } });
  w.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url === '/api/cards' || url === '/api/tree') {
      if (delayed) await pause(25);
      const tag = '"catalog-' + revision + '"';
      return options.headers?.['If-None-Match'] === tag ? reply(null, 304, tag) : reply(url === '/api/cards' ? { cards } : { children: [] }, 200, tag);
    }
    if (url.startsWith('/api/share')) return reply({ url: 'https://example.com/shared' });
    if (options.method === 'PUT') { revision++; return reply({ ok: true }); }
    if (!exists) return reply(null, 404);
    const current = doc(), tag = '"' + revision + '"';
    if (delayed) await pause(25);
    return options.headers?.['If-None-Match'] === tag ? reply(null, 304, tag) : reply(current, 200, tag);
  };
  try {
    for (const file of ['vendor/marked.min.js', 'reader.js']) w.eval(fs.readFileSync('public/' + file, 'utf8'));
    const original = w.AtlasReader.render;
    w.AtlasReader.render = (...args) => { renders++; return original(...args); };
    w.eval(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
    await pause(40);
    assert.equal(w.document.querySelectorAll('.card').length, 500);
    const first = w.document.querySelector('.card');
    const start = performance.now();
    for (let i = 0; i < 9; i++) w.refreshList();
    assert.equal(w.document.querySelector('.card'), first);
    console.log('500-card cached list refresh mean ms:', ((performance.now() - start) / 9).toFixed(2));
    const navigate = async (view, param) => {
      w.setRoute(view, param); await pause(5);
      for (let i = 0; i < 100 && (w.parseHash().view !== view || /正在加载/.test(w.document.querySelector('#main').textContent)); i++) await pause(10);
      assert.equal(w.parseHash().view, view); assert.doesNotMatch(w.document.querySelector('#main').textContent, /正在加载/);
    };
    const catalogs = () => calls.filter(c => c.url === '/api/cards' || c.url === '/api/tree');
    const originalCatalogCalls = catalogs().length;
    w.document.documentElement.scrollTop = 321;
    await navigate('shared');
    const sharedCard = w.document.querySelector('.card');
    assert.equal(w.document.querySelectorAll('.card').length, 10);
    await navigate('all');
    assert.equal(w.document.querySelector('.card'), first, 'tab return retains original DOM');
    assert.equal(w.document.documentElement.scrollTop, 321, 'each tab retains scroll');
    await navigate('shared');
    assert.equal(w.document.querySelector('.card'), sharedCard);
    await navigate('all');
    assert.equal(catalogs().length, originalCatalogCalls, 'tab switches issue no catalog requests');
    await Promise.all([w.loadCards(), w.loadTree()]);
    assert.ok(catalogs().slice(-2).every(c => c.options.headers['If-None-Match'] === '"catalog-1"'));
    delayed = true;
    const catalogCount = catalogs().length;
    await Promise.all([w.loadCards(), w.loadCards()]);
    assert.equal(catalogs().length, catalogCount + 1, 'concurrent catalog validation coalesces');
    delayed = false;
    await navigate('doc', 'note-0.md'); assert.equal(renders, 1);
    await navigate('all'); assert.equal(w.document.querySelector('.card'), first);
    await navigate('doc', 'note-0.md'); assert.equal(renders, 1, 'unchanged Markdown must not be reparsed');
    const docs = () => calls.filter(c => c.url.startsWith('/api/doc'));
    assert.equal(docs().at(-1).options.headers['If-None-Match'], '"1"');
    revision++;
    await navigate('all'); await navigate('doc', 'note-0.md');
    assert.equal(renders, 2); assert.match(w.document.querySelector('.article').textContent, /Body 2/);
    delayed = true;
    const count = docs().length;
    const [a, b] = await Promise.all([w.fetchDocument('note-1.md'), w.fetchDocument('note-1.md')]);
    assert.equal(a.doc, b.doc); assert.equal(docs().length, count + 1, 'concurrent document requests must coalesce');
    // A mutation during an in-flight read cannot repopulate stale cache or deadlock.
    const oldRead = w.fetchDocument('note-2.md');
    const oldCatalogRead = w.loadCards();
    await w.fetch('/api/doc?path=note-0.md', { method: 'PUT' });
    assert.match((await oldRead).doc.content, /Body 3/);
    await oldCatalogRead;
    assert.equal(catalogs().at(-1).options.headers, undefined, 'in-flight catalog retries after mutation');
    w.clearViewCaches();
    await w.loadCards();
    assert.equal(catalogs().at(-1).options.headers, undefined, 'mutation clears catalog validator');
    await navigate('all'); await navigate('doc', 'note-0.md');
    assert.equal(docs().at(-1).options.headers, undefined);
    assert.match(w.document.querySelector('.article').textContent, /Body 3/);
    exists = false;
    await navigate('all'); await navigate('doc', 'note-0.md');
    assert.match(w.document.querySelector('#main').textContent, /不存在/);
    const small = w.boundedViewCache(8, 2);
    small.set('a', 1, 4); small.set('b', 2, 4); small.get('a'); small.set('c', 3, 4);
    assert.equal(small.get('b'), undefined); assert.equal(small.get('a'), 1);
    small.set('huge', 4, 20); assert.equal(small.get('huge'), undefined);
    small.clear(); assert.equal(small.get('a'), undefined);
    const probe = w.document.createElement('section');
    for (let i = 0; i < 9; i++) { probe.innerHTML = '<div class="card"></div>'; w.retainList(probe, String(i)); }
    assert.equal(w.restoreList(probe, '0'), false, 'oldest tab DOM is evicted at view limit');
    assert.equal(w.restoreList(probe, '1'), true);
    console.log('PASS: list DOM reuse, validated document cache/304, render reuse, external changes/deletion, request coalescing, mutation race, bounded LRU');
  } finally { dom.window.close(); }
  const direct = new JSDOM(html, { url: 'http://localhost/#doc=deep.md', runScripts: 'outside-only' });
  const d = direct.window;
  let releaseCards, releaseTree;
  d.fetch = async url => {
    if (url === '/api/cards') return new Promise(resolve => { releaseCards = () => resolve(reply({ cards: [] })); });
    if (url === '/api/tree') return new Promise(resolve => { releaseTree = () => resolve(reply({ children: [] })); });
    if (url.startsWith('/api/share')) return reply({ url: null });
    return reply({ ...doc(), title: '真实标题', relPath: 'deep.md' });
  };
  try {
    for (const file of ['vendor/marked.min.js', 'reader.js']) d.eval(fs.readFileSync('public/' + file, 'utf8'));
    d.eval(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
    await pause(20);
    const article = d.document.querySelector('.article');
    assert.ok(article, 'direct document must load before the full catalog');
    assert.equal(d.document.title, '真实标题 · Atlas');
    d.document.querySelector('#btn-edit').click();
    const editor = d.document.querySelector('#editor'); editor.value += '\nDraft before catalog';
    releaseCards(); releaseTree(); await pause(20);
    assert.equal(d.document.querySelector('#editor'), editor, 'catalog completion must not remount the editor');
    assert.match(editor.value, /Draft before catalog/);
    console.log('PASS: direct document loads independently of catalog and preserves early editing');
  } finally { direct.window.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
