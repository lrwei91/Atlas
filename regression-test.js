'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { JSDOM } = require('jsdom');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check) {
  for (let i = 0; i < 200; i++) { if (check()) return; await pause(5); }
  throw Error('UI condition timeout');
}

async function serverTests() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-regression-'));
  const vault = path.join(tmp, 'vault'), state = path.join(tmp, 'state');
  fs.mkdirSync(path.join(vault, 'notes'), { recursive: true });
  fs.mkdirSync(path.join(vault, 'resources'));
  fs.writeFileSync(path.join(vault, 'notes', 'test.md'), '# Original\n旧内容');
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: { ...process.env, PORT: '0', ATLAS_VAULT: vault, ATLAS_STATE_DIR: state, ATLAS_PUBLIC_URL: 'https://note.lrwei91.online' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = new Promise(resolve => child.once('exit', resolve));
  try {
    const base = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Startup timeout')), 10000);
      child.stdout.on('data', data => { const m = String(data).match(/http:\/\/localhost:(\d+)/); if (m) { clearTimeout(timer); resolve('http://127.0.0.1:' + m[1]); } });
      child.once('exit', () => { clearTimeout(timer); reject(Error('Startup failed')); });
    });
    let cookie = '';
    const headers = () => ({ Origin: 'https://note.lrwei91.online', Cookie: cookie, 'Content-Type': 'application/json' });
    function chunked(method, route, input, splitChar) {
      const body = Buffer.from(JSON.stringify(input));
      const split = body.indexOf(Buffer.from(splitChar)) + 1;
      assert.ok(split > 0);
      return new Promise((resolve, reject) => {
        const req = http.request(base + route, { method, headers: { ...headers(), 'Content-Length': body.length } }, res => {
          let text = '';
          res.on('data', chunk => { text += chunk; });
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(text) }));
        });
        req.on('error', reject); req.write(body.subarray(0, split));
        setTimeout(() => req.end(body.subarray(split)), 30);
      });
    }
    const credentials = { username: '中文管理员', password: '中文密码-emoji-🙂-123' };
    const setup = await chunked('POST', '/auth/setup', { ...credentials, setupToken: fs.readFileSync(path.join(state, 'setup-token'), 'utf8') }, '中');
    assert.equal(setup.status, 200); cookie = setup.headers['set-cookie'][0].split(';')[0];
    const login = await chunked('POST', '/auth/login', credentials, '🙂');
    assert.equal(login.status, 200);
    const getDoc = async () => (await fetch(base + '/api/doc?path=test.md', { headers: headers() })).json();
    const put = input => fetch(base + '/api/doc?path=test.md', { method: 'PUT', headers: headers(), body: JSON.stringify(input) });
    const doc = await getDoc();
    assert.match(doc.version, /^[a-f0-9]{64}$/);
    const content = '# 中文标题\n中文保存内容🙂';
    const saved = await chunked('PUT', '/api/doc?path=test.md', { content, version: doc.version }, '中');
    assert.equal(saved.status, 200); assert.equal((await getDoc()).content, content);
    assert.equal(fs.readFileSync(path.join(vault, 'notes', 'test.md'), 'utf8'), content);
    assert.equal((await put({ content: 'Missing version' })).status, 428);
    assert.equal((await put({ content: 'Stale save', version: doc.version })).status, 409);
    const current = await getDoc();
    fs.writeFileSync(path.join(vault, 'notes', 'test.md'), '# Obsidian\nNew external edit');
    assert.equal((await put({ content: 'Browser stale draft', version: current.version })).status, 409);
    assert.match((await getDoc()).content, /New external edit/);
    const both = await getDoc();
    assert.equal((await put({ content: '# Tab one', version: both.version })).status, 200);
    assert.equal((await put({ content: '# Tab two', version: both.version })).status, 409);
    assert.equal((await getDoc()).content, '# Tab one');
    assert.equal(fs.readdirSync(path.join(vault, 'notes')).some(n => n.includes('atlas-tmp')), false);
    // Frontmatter covers feed the existing mobile card field without leaking into excerpts.
    const inlineCover = 'data:image/jpeg;base64,/9j/2Q==';
    fs.writeFileSync(path.join(vault, 'resources', 'body.png'), Buffer.from('image'));
    const coverNotes = {
      'cover.md': `---\n![封面](${inlineCover})\n---\n# 封面测试\n这是应当显示的正文摘要。\n![](resources/body.png)`,
      'cover-crlf.md': `\uFEFF---\r\n![封面](${inlineCover})\r\n...\r\n# Cover`,
      'cover-body.md': '# Body\n![](resources/body.png)\n---\nLater\n---',
      'cover-unsafe.md': '---\n![封面](data:text/html;base64,AAAA)\n---\n# Unsafe\n![](resources/body.png)',
      'cover-percent.md': '# Percent\n![](bad%.png)',
    };
    for (const [name, text] of Object.entries(coverNotes)) fs.writeFileSync(path.join(vault, 'notes', name), text);
    const coverCards = (await (await fetch(base + '/api/cards', { headers: headers() })).json()).cards;
    const coverCard = name => coverCards.find(card => card.relPath === name);
    assert.equal(coverCard('cover.md').cover, inlineCover);
    assert.equal(coverCard('cover.md').excerpt, '这是应当显示的正文摘要。');
    assert.equal(coverCard('cover-crlf.md').cover, inlineCover);
    assert.equal(coverCard('cover-body.md').cover, '/files/resources/body.png');
    assert.equal(coverCard('cover-unsafe.md').cover, '/files/resources/body.png');
    assert.equal(coverCard('cover-percent.md').cover, null);
    for (const name of Object.keys(coverNotes)) fs.unlinkSync(path.join(vault, 'notes', name));
    console.log('PASS: frontmatter inline covers, body fallback, safe image types, metadata-free excerpts');
    const readBody = require('./request-body');
    await assert.rejects(readBody((async function* () { yield Buffer.from('123'); yield Buffer.from('456'); })(), 5));

    // Exercise the real launcher while replacing only its browser-opening command.
    const bin = path.join(tmp, 'bin'); fs.mkdirSync(bin);
    const opened = path.join(tmp, 'opened');
    fs.writeFileSync(path.join(bin, 'open'), '#!/bin/sh\nprintf "%s" "$1" > "$ATLAS_TEST_OPENED"\n', { mode: 0o700 });
    const launch = spawn('/bin/bash', [path.join(__dirname, 'start.command')], {
      env: { ...process.env, ATLAS_NODE: process.execPath, ATLAS_LOCAL_URL: base, ATLAS_TEST_OPENED: opened, PATH: bin + ':' + process.env.PATH },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.equal(await new Promise(resolve => launch.once('exit', resolve)), 0);
    assert.equal(fs.readFileSync(opened, 'utf8'), 'https://note.lrwei91.online/');
    console.log('PASS: split UTF-8 setup/login/save, byte limit, missing/stale versions, external edits, two editors, launcher URL');
    for (const dir of ['10-工作', '20-学习', 'C3', 'C4', 'C5', 'C6', 'C7']) fs.mkdirSync(path.join(vault, 'notes', dir));
    fs.writeFileSync(path.join(vault, 'notes', '10-工作/编辑靶子.md'), '# 编辑靶子\n原始编辑样本');
    fs.writeFileSync(path.join(vault, 'notes', '20-学习/删除靶子.md'), '# 删除靶子\n原始删除样本');
    for (const script of ['write-test.js', 'smoke-test.js']) {
      const test = spawn(process.execPath, [path.join(__dirname, script)], {
        env: { ...process.env, ATLAS_TEST_URL: base, ATLAS_TEST_COOKIE: cookie, ATLAS_TEST_VAULT: vault, ATLAS_TEST_WRITE: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      test.stdout.on('data', data => process.stdout.write(data));
      test.stderr.on('data', data => process.stderr.write(data));
      assert.equal(await new Promise(resolve => test.once('exit', resolve)), 0, script);
    }
  } finally { child.kill(); await exited; fs.rmSync(tmp, { recursive: true, force: true }); }
}

async function frontendTests() {
  const html = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only' });
  const w = dom.window, errors = [], pending = new Map(), calls = [];
  const malicious = '<img src=x onerror=window.__injected=1>';
  const noteNames = ['A.md', 'B.md', '100%.md', '100%20.md', '中文 空格 #?.md', malicious + '/note.md'];
  const documents = new Map(noteNames.map(rel => [rel, { relPath: rel, isMarkdown: true, content: '# ' + rel, assets: {}, version: 'a'.repeat(64) }]));
  documents.set('file.pdf', { relPath: 'file.pdf', isMarkdown: false, size: 12, mtime: Date.now() });
  const cards = [...documents].map(([rel, doc], i) => ({
    relPath: rel, title: i === 0 ? 'Zulu' : i === 1 ? 'Alpha' : rel, isMarkdown: doc.isMarkdown,
    dir: rel.includes('/') ? malicious : '', mtime: Date.now() - (i === 2 ? 60 : i) * 86400e3, size: 12, chars: 12, excerpt: '',
  }));
  let deferDocs = false, deferSearch = false, saveStatus = 500;
  const reply = (body, status = 200) => ({ status, ok: status === 200, json: async () => body });
  w.addEventListener('error', e => { errors.push(e.message); e.preventDefault(); });
  w.confirm = () => false;
  w.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url === '/api/cards') return reply({ cards });
    if (url === '/api/tree') return reply({ children: [{ name: 'Work', relPath: 'Work', children: [] }] });
    if (url.startsWith('/api/share')) return reply({ url: null });
    if (url.startsWith('/api/search')) {
      if (deferSearch) return new Promise(resolve => pending.set(url, resolve));
      return reply({ results: [] });
    }
    const rel = new URL(url, 'http://localhost').searchParams.get('path');
    if (options.method === 'PUT') {
      const input = JSON.parse(options.body);
      assert.equal(input.version, documents.get(rel).version);
      if (saveStatus !== 200) return reply({ error: saveStatus === 409 ? '编辑冲突，草稿已保留' : '保存失败' }, saveStatus);
      documents.set(rel, { ...documents.get(rel), content: input.content, version: 'b'.repeat(64) });
      return reply({ ok: true, version: 'b'.repeat(64) });
    }
    if (deferDocs) return new Promise(resolve => pending.set(url, resolve));
    return reply(documents.get(rel));
  };
  const docURL = rel => '/api/doc?path=' + encodeURIComponent(rel);
  async function navigate(view, param) { w.setRoute(view, param); await pause(20); }
  try {
    for (const file of ['vendor/marked.min.js', 'reader.js']) w.eval(fs.readFileSync(path.join(__dirname, 'public', file), 'utf8'));
    w.eval(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
    await waitFor(() => w.document.querySelectorAll('.card').length === cards.length);
    const mobileCover = 'data:image/jpeg;base64,/9j/2Q==';
    const mobileCard = w.document.createElement('div');
    mobileCard.innerHTML = w.mCardHTML({ ...cards[0], cover: mobileCover }, 0);
    assert.equal(mobileCard.querySelector('.cover-img img').getAttribute('src'), mobileCover);
    assert.equal(w.document.querySelector('.c-badge img'), null);
    const maliciousCard = [...w.document.querySelectorAll('.card')].find(el => el.dataset.rel === malicious + '/note.md');
    assert.equal(maliciousCard.querySelector('.c-badge').textContent, malicious);
    assert.equal(w.__injected, undefined);
    // Deterministic filter and title-order samples, including a 60-day-old note.
    w.document.querySelector('[data-f="period"][data-v="month"]').click();
    assert.equal(w.document.querySelectorAll('.card').length, cards.length - 1);
    w.document.querySelector('[data-f="sort"][data-v="title"]').click();
    const titles = [...w.document.querySelectorAll('.c-title')].map(el => el.textContent);
    assert.deepEqual(titles, [...titles].sort((a, b) => a.localeCompare(b, 'zh-CN')));

    const originalA = documents.get('A.md');
    documents.set('A.md', { ...originalA, content: '# A.md\n## 本文标题\n[[notes/B#B.md|跳转B]]\n[[#本文标题|页内标题]]\n[[resources/video.mp4|附件]]',
      links: { '#doc=notes%2FB%23B.md': {type:'document',path:'B.md',fragment:'B.md'}, '#doc=%23%E6%9C%AC%E6%96%87%E6%A0%87%E9%A2%98': {type:'document',path:'A.md',fragment:'本文标题'}, '#doc=resources%2Fvideo.mp4': {type:'asset',path:'resources/video.mp4'} } });
    await navigate('doc', 'A.md');
    const callsBeforeHeading = calls.filter(c=>c.url.startsWith('/api/doc')).length;
    w.document.querySelector('a[data-document-heading="本文标题"]').click(); await pause(10);
    assert.equal(calls.filter(c=>c.url.startsWith('/api/doc')).length, callsBeforeHeading);
    assert.equal(w.document.querySelector('a[href="/files/resources/video.mp4"]').getAttribute('target'), '_blank');
    w.document.querySelector('a[data-document-path="B.md"]').click(); await pause(20);
    assert.equal(w.parseHash().param, 'B.md');
    assert.match(w.document.querySelector('.article').textContent, /B.md/);
    assert.equal(calls.some(c=>c.url===docURL('notes/B#B.md')),false);
    documents.set('A.md', originalA);

    cards[0].isShared = true;
    await navigate('all');
    const shareNav = w.document.querySelector('[data-route="shared"]');
    assert.equal(shareNav.querySelector('.name').textContent, '分享笔记');
    assert.equal(shareNav.previousElementSibling.querySelector('.name').textContent, '全部笔记');
    assert.equal(shareNav.querySelector('.cnt').textContent, '1');
    shareNav.click(); await pause(20);
    assert.equal(w.parseHash().view, 'shared');
    assert.equal(w.document.querySelector('.view-head h1').textContent, '分享笔记');
    assert.equal(w.document.querySelectorAll('.card').length, 1);
    w.document.querySelector('.card').click(); await pause(20);
    assert.equal(w.parseHash().param, cards[0].relPath);
    cards[0].isShared = false;
    await navigate('shared');
    assert.equal(w.document.querySelectorAll('.card').length, 0);
    assert.match(w.document.querySelector('#main').textContent, /暂无已分享的笔记/);
    await navigate('all');

    deferDocs = true;
    await navigate('doc', 'A.md'); await navigate('doc', 'B.md');
    pending.get(docURL('B.md'))(reply(documents.get('B.md'))); await pause(10);
    pending.get(docURL('A.md'))(reply(documents.get('A.md'))); await pause(10);
    assert.equal(w.parseHash().param, 'B.md');
    assert.match(w.document.querySelector('.article').textContent, /B.md/);
    await navigate('doc', 'A.md'); await navigate('all');
    pending.get(docURL('A.md'))(reply(documents.get('A.md'))); await pause(10);
    assert.ok(w.document.querySelector('.grid'));
    deferDocs = false; deferSearch = true;
    await navigate('search', 'old'); await navigate('search', 'new');
    const result = title => ({ results: [{ relPath: 'A.md', title, dir: '', mtime: Date.now(), snippets: [] }] });
    pending.get('/api/search?q=new')(reply(result('new result'))); await pause(10);
    pending.get('/api/search?q=old')(reply(result('old result'))); await pause(10);
    assert.equal(w.document.querySelector('.r-title').textContent, 'new result');
    deferSearch = false;

    await navigate('doc', 'A.md'); w.document.querySelector('#btn-edit').click();
    const editor = w.document.querySelector('#editor'); editor.value += '\nUnsaved';
    await navigate('all');
    assert.equal(w.parseHash().param, 'A.md'); assert.equal(w.document.querySelector('#editor'), editor);
    w.location.hash = 'all'; await pause(20);
    assert.equal(w.parseHash().param, 'A.md'); assert.equal(w.document.querySelector('#editor'), editor);
    w.document.querySelector('#btn-cancel-edit').click(); assert.equal(w.document.querySelector('#editor'), editor);
    w.document.querySelector('#btn-save').click(); await pause(20);
    assert.equal(w.document.querySelector('#editor'), editor); assert.match(w.document.querySelector('#edit-status').textContent, /保存失败/);
    let warned = false; w.onbeforeunload({ preventDefault() { warned = true; } }); assert.equal(warned, true);
    saveStatus = 409; w.document.querySelector('#btn-save').click(); await pause(20);
    assert.match(w.document.querySelector('#edit-status').textContent, /草稿已保留/); assert.match(editor.value, /Unsaved/);
    saveStatus = 200; w.document.querySelector('#btn-save').click(); await waitFor(() => !w.document.querySelector('#editor'));
    assert.match(w.document.querySelector('.article').textContent, /Unsaved/); assert.equal(w.onbeforeunload, null);

    for (const rel of ['100%.md', '100%20.md', '中文 空格 #?.md']) {
      await navigate('all');
      const card = [...w.document.querySelectorAll('.card')].find(el => el.dataset.rel === rel);
      // Reset period filtering so the older percent-path fixture is available.
      if (!card) { w.document.querySelector('[data-f="period"][data-v="all"]').click(); }
      [...w.document.querySelectorAll('.card')].find(el => el.dataset.rel === rel).click(); await pause(20);
      assert.equal(w.parseHash().param, rel); assert.ok(w.document.querySelector('.article'));
    }
    await navigate('doc', 'file.pdf');
    assert.equal(w.document.querySelector('#btn-share'), null);
    assert.equal(w.document.querySelector('a[download]').getAttribute('href'), '/files/notes/file.pdf');
    assert.equal(calls.some(call => call.url === '/api/share?path=file.pdf'), false);
    w.document.querySelector('#btn-nav').click();
    assert.equal(w.document.querySelector('#btn-nav').getAttribute('aria-expanded'), 'true');
    assert.ok(w.document.querySelector('#sidebar').classList.contains('is-open'));
    w.document.querySelector('[data-dir="Work"]').click(); await pause(20);
    assert.equal(w.document.querySelector('#btn-nav').getAttribute('aria-expanded'), 'false');
    w.history.replaceState(null, '', '#doc=broken%'); w.renderView();
    assert.match(w.document.querySelector('#main').textContent, /链接格式无效/);
    assert.deepEqual(errors, []);
    console.log('PASS: escaped badges, real filters/sort, document/search races, dirty navigation/cancel/failure/conflict/success, encoded paths, PDF links, mobile menu, invalid hash');
  } finally { dom.window.close(); }
}

(async () => { await serverTests(); await frontendTests(); })().catch(error => { console.error(error); process.exitCode = 1; });
