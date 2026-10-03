'use strict';
/* 游客模式 UI 回归：在真实服务端点上跑一遍游客会话，验证写入口收起、示例内容可读 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { JSDOM } = require('jsdom');
const pause = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-guest-'));
  const vault = path.join(tmp, 'vault'), state = path.join(tmp, 'state');
  fs.mkdirSync(path.join(vault, 'notes', '真实目录'), { recursive: true });
  fs.mkdirSync(path.join(vault, 'resources'));
  fs.writeFileSync(path.join(vault, 'notes', '真实目录', '机密笔记.md'), '# 机密\n真实主库内容\n[[不存在的目标]]');
  fs.writeFileSync(path.join(vault, 'resources', 'private.png'), 'private');
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: { ...process.env, PORT: '0', ATLAS_VAULT: vault, ATLAS_STATE_DIR: state },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let base;
  try {
    base = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Startup timeout')), 10000);
      child.stdout.on('data', d => { const m = String(d).match(/http:\/\/localhost:(\d+)/); if (m) { clearTimeout(timer); resolve('http://localhost:' + m[1]); } });
      child.once('exit', c => { clearTimeout(timer); reject(Error('Server exited ' + c)); });
    });
    // 游客会话（Origin 与本机一致）
    const guest = await fetch(base + '/auth/guest', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: '{}' });
    assert.equal(guest.status, 200);
    const cookie = guest.headers.get('set-cookie').split(';')[0];

    const html = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');
    const errors = [];
    const dom = new JSDOM(html, {
      url: base + '/', runScripts: 'outside-only',
      beforeParse(window) {
        window.fetch = (input, options = {}) => {
          const url = typeof input === 'string' ? input : input.url;
          const abs = url.startsWith('http') ? url : base + url;
          return fetch(abs, { ...options, headers: { Cookie: cookie, Origin: base, ...options.headers } });
        };
        window.addEventListener('error', e => errors.push('window error: ' + e.message));
        window.addEventListener('unhandledrejection', e => errors.push('unhandledrejection: ' + (e.reason?.stack || e.reason)));
      },
    });
    const w = dom.window, doc = w.document;
    w.eval(fs.readFileSync(path.join(__dirname, 'public/vendor/marked.min.js'), 'utf8'));
    w.eval(fs.readFileSync(path.join(__dirname, 'public/vendor/highlight.min.js'), 'utf8'));
    w.eval(fs.readFileSync(path.join(__dirname, 'public/reader.js'), 'utf8'));
    w.eval(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
    await pause(1200);

    // 登录态与游客标识（mAuth 是脚本内 const，只能从 DOM 观测）
    assert.equal(doc.body.classList.contains('is-guest'), true);
    // 写入口收起：.m-item 显式声明 display:flex，会盖掉 hidden 属性，因此断言计算样式
    const hidden = sel => [...doc.querySelectorAll(sel)].every(el => w.getComputedStyle(el).display === 'none');
    for (const sel of ['#m-tabbar .m-item[data-nav="create"]', '#m-rm-edit', '#m-rm-del', '#m-rm-copy', '#btn-m-share', '#btn-m-more']) {
      assert.ok(doc.querySelector(sel), sel + ' 应存在');
      assert.equal(hidden(sel), true, sel + ' 在游客模式下应收起');
    }
    // 非游客不应被误伤：撤掉 is-guest 后写入口恢复
    // （jsdom 不加载媒体查询，底栏基础 display 是 inline-block 而非 flex，只断言「已恢复可见」）
    doc.body.classList.remove('is-guest');
    doc.querySelectorAll('.guest-hide').forEach(el => el.classList.remove('guest-hide'));
    assert.notEqual(w.getComputedStyle(doc.querySelector('#m-tabbar .m-item[data-nav="create"]')).display, 'none');
    doc.body.classList.add('is-guest');
    w.eval('applyGuestUI()');
    assert.equal(hidden('#m-tabbar .m-item[data-nav="create"]'), true);
    assert.equal(w.getComputedStyle(doc.getElementById('guest-bar')).display, 'flex');
    assert.match(doc.getElementById('guest-bar').textContent, /游客访问/);
    assert.equal(doc.getElementById('btn-logout').textContent, '退出游客');

    // 列表来自示例数据集，主库目录不出现
    const cards = [...doc.querySelectorAll('.card')];
    assert.ok(cards.length >= 5, '示例卡片数量 ' + cards.length);
    const rels = cards.map(c => c.getAttribute('data-rel'));
    assert.ok(rels.some(r => r.includes('欢迎使用 Atlas')), '应展示示例文档');
    assert.ok(!rels.some(r => r.includes('机密')), '真实主库目录不得出现');
    const navText = doc.getElementById('nav-tree').textContent;
    assert.ok(!navText.includes('真实目录'), '侧栏不得出现真实目录');
    assert.ok(navText.includes('快速上手'), '侧栏应出现示例分类');

    // 封面走 /files/demo/ 白名单
    const cardsData = (await (await fetch(base + '/api/cards', { headers: { Cookie: cookie } })).json()).cards;
    const withCover = cardsData.find(c => c.cover);
    assert.ok(withCover, '示例卡片应带封面');
    assert.equal((await fetch(base + withCover.cover, { headers: { Cookie: cookie } })).status, 200);

    // 打开一篇示例文档：桌面阅读页无写操作按钮
    w.setRoute('doc', rels.find(r => r.includes('欢迎使用 Atlas')));
    await pause(600);
    assert.ok(doc.querySelector('.article'), '阅读页应渲染');
    for (const id of ['btn-share', 'btn-revoke', 'btn-edit', 'btn-delete']) assert.equal(doc.getElementById(id), null, '游客不应看到 ' + id);
    assert.equal(doc.querySelectorAll('.reader-back').length, 1);

    // 双链可跳转
    const wiki = [...doc.querySelectorAll('.article a[href^="#doc="]')];
    assert.ok(wiki.length > 0, '示例文档应包含双链');
    wiki[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
    await pause(500);
    assert.ok(doc.querySelector('.article'), '双链应跳转到另一篇示例文档');

    // 真实主库文档即使知道路径也打不开
    w.setRoute('doc', '真实目录/机密笔记.md');
    await pause(500);
    assert.match(doc.querySelector('#main').textContent, /文档不存在|无法读取/, '真实主库文档对游客不可读');

    // 搜索只命中示例内容
    w.setRoute('search', '风控');
    await pause(600);
    const results = doc.querySelectorAll('.result');
    assert.ok(results.length > 0, '示例检索应有命中');
    assert.ok([...results].every(r => !r.getAttribute('data-rel').includes('机密')));

    // 服务端写操作拒绝（UI 已隐藏，这里直接验证接口层）
    const write = await fetch(base + '/api/doc?path=' + encodeURIComponent(rels[0]), {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: base, Cookie: cookie },
      body: JSON.stringify({ content: 'x', version: '0'.repeat(64) }),
    });
    assert.equal(write.status, 403);
    assert.equal(fs.readdirSync(path.join(vault, 'notes', '真实目录')).length, 1);

    assert.deepEqual(errors, []);
    dom.window.close();
    console.log('PASS: 游客登录态与提示条、示例列表与侧栏、封面白名单、阅读页无写入口、双链跳转、主库不可读、检索隔离、写操作 403');
  } finally {
    child.kill();
    await new Promise(r => child.once('exit', r));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
