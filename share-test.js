'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { JSDOM } = require('jsdom');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-share-'));
const vault = path.join(tmp, 'vault'); fs.mkdirSync(path.join(vault, 'notes'), { recursive: true }); fs.mkdirSync(path.join(vault, 'resources'));
const safe = (root, rel) => { root = fs.realpathSync(root); const full = path.resolve(root, rel); if (!full.startsWith(root + path.sep) || !fs.existsSync(full)) return null; const real = fs.realpathSync(full); return real.startsWith(root + path.sep) ? real : null; };
fs.writeFileSync(path.join(vault, 'notes', '测试.md'), '---\nprivate: hidden\n---\n# 测试\n[章节](#章节)\n## 章节\n![[图片 空格.png]]\n![[视频.mp4]]\n\n[[其他]]\n<script>alert(1)</script>');
fs.writeFileSync(path.join(vault, 'notes', '其他.md'), '# 不可分享');
fs.writeFileSync(path.join(vault, 'resources', '图片 空格.png'), 'image');
fs.writeFileSync(path.join(vault, 'resources', '视频.mp4'), 'video');
fs.writeFileSync(path.join(vault, 'resources', 'private.png'), 'private');
const doc = require('./documents')(vault, safe).read('测试.md');
const files = require('./static-share')(doc, vault, safe);
assert.equal(files.size, 4);
const html = files.get('index.html').toString();
const dom = new JSDOM(html);
assert.equal(dom.window.document.querySelector('script'), null);
assert.match(dom.window.document.querySelector('img').getAttribute('src'), /^assets\//);
assert.match(dom.window.document.querySelector('video').getAttribute('src'), /^assets\//);
assert.equal(dom.window.document.querySelector('a').getAttribute('href'), '#heading-1');
assert.equal([...dom.window.document.querySelectorAll('a')].find(a => a.textContent === '其他').hasAttribute('href'), false);
assert.ok(!html.includes('/api/') && !html.includes('private:') && !html.includes('其他.md'));
assert.ok(!files.get('document.md').toString().includes('private: hidden')); dom.window.close();
process.env.ATLAS_STATE_DIR = path.join(tmp, 'state');
process.env.ATLAS_SHARE_REPO = path.join(tmp, 'remote.git');
process.env.ATLAS_SHARE_URL = 'https://example.test/Share';
execFileSync('git', ['init', '--bare', process.env.ATLAS_SHARE_REPO], { stdio: 'ignore' });
const publisher = require('./github-share');
(async () => {
  try {
    await publisher.initialize();
    const id = 'A'.repeat(22);
    const result = await publisher.publish(id, files);
    assert.equal(result.url, `https://example.test/Share/documents/${id}/`);
    const remoteGit = args => execFileSync('git', ['--git-dir=' + process.env.ATLAS_SHARE_REPO, ...args], { encoding: 'utf8' });
    assert.match(remoteGit(['show', `main:documents/${id}/index.html`]), /测试/);
    assert.equal(remoteGit(['ls-tree', '-r', '--name-only', 'main']).includes('private.png'), false);
    // Push failure leaves a local commit; the next retry must push it and preserve the same URL.
    const hook = path.join(process.env.ATLAS_SHARE_REPO, 'hooks', 'pre-receive'); fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    files.set('document.md', Buffer.from('# 更新'));
    await assert.rejects(publisher.publish(id, files)); fs.unlinkSync(hook);
    const updated = await publisher.publish(id, files); assert.equal(updated.url, result.url);
    assert.equal(remoteGit(['show', `main:documents/${id}/document.md`]), '# 更新');
    await publisher.revoke(id);
    assert.equal(remoteGit(['ls-tree', '-r', '--name-only', 'main']).includes(`documents/${id}/`), false);
    await apiTests(remoteGit);
    console.log('PASS: static scoped media, sanitization, headings, Git commit/push, update, failed push retry, revoke');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exitCode = 1; });

async function apiTests(remoteGit) {
  const { spawn } = require('node:child_process');
  const state = path.join(tmp, 'api-state');
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env: { ...process.env, PORT: '0', ATLAS_VAULT: vault, ATLAS_STATE_DIR: state, ATLAS_PUBLIC_URL: 'https://atlas.test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise(resolve => child.once('exit', resolve));
  try {
    const base = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Share API startup timeout')), 10000);
      child.stdout.on('data', data => { const m = String(data).match(/http:\/\/localhost:(\d+)/); if (m) { clearTimeout(timer); resolve('http://127.0.0.1:' + m[1]); } });
      child.once('exit', () => { clearTimeout(timer); reject(Error('Share API startup failed')); });
    });
    const setup = await fetch(base + '/auth/setup', { method: 'POST', headers: { Origin: 'https://atlas.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'share-test', password: 'share-test-password-123', setupToken: fs.readFileSync(path.join(state, 'setup-token'), 'utf8') }) });
    assert.equal(setup.status, 200);
    const headers = { Cookie: setup.headers.get('set-cookie').split(';')[0], Origin: 'https://atlas.test' };
    const endpoint = base + '/api/share?path=' + encodeURIComponent('测试.md');
    let response = await fetch(endpoint, { method: 'POST', headers }); assert.equal(response.status, 200);
    const published = await response.json(); assert.equal(published.provider, 'github'); assert.match(published.commitSha, /^[a-f0-9]{40}$/);
    const id = new URL(published.url).pathname.split('/').at(-2);
    assert.equal((await fetch(base + '/s/' + id, { redirect: 'manual' })).headers.get('location'), published.url);
    assert.equal((await fetch(base + '/s/' + id + '/doc')).status, 404);
    assert.equal((await (await fetch(endpoint, { headers })).json()).url, published.url);
    const hook = path.join(process.env.ATLAS_SHARE_REPO, 'hooks', 'pre-receive'); fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    response = await fetch(endpoint, { method: 'DELETE', headers }); assert.equal(response.status, 502);
    assert.equal((await (await fetch(endpoint, { headers })).json()).url, published.url); fs.unlinkSync(hook);
    response = await fetch(endpoint, { method: 'DELETE', headers }); assert.equal(response.status, 200);
    assert.equal((await (await fetch(endpoint, { headers })).json()).url, null);
    assert.ok(!remoteGit(['ls-tree', '-r', '--name-only', 'main']).includes(id));
    console.log('PASS: authenticated GitHub share API, static redirect, private route blocked, failed revoke state, revoke retry');
  } finally { child.kill('SIGTERM'); await exited; }
}
