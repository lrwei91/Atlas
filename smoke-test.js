/* 渲染冒烟测试 v3：预加载本地 vendor（marked/hljs）→ 执行内联脚本 → 验证全链路 */
'use strict';
const { JSDOM } = require('jsdom');
const fs = require('fs');
const assert = require('node:assert/strict');

(async () => {
  const base = process.env.ATLAS_TEST_URL || 'http://localhost:4317';
  const html = fs.readFileSync(__dirname + '/public/index.html', 'utf8');
  const errors = [];
  const dom = new JSDOM(html, {
    url: base + '/',
    runScripts: 'outside-only',
    beforeParse(window) {
      window.fetch = (input, options = {}) => {
        const url = typeof input === 'string' ? input : input.url;
        const abs = url.startsWith('http') ? url : base + url;
        return global.fetch(abs, { ...options, headers: { Cookie: process.env.ATLAS_TEST_COOKIE || '', Origin: 'https://note.lrwei91.online', ...options.headers } });
      };
      window.addEventListener('error', (e) => errors.push('window error: ' + e.message));
      window.addEventListener('unhandledrejection', (e) => errors.push('unhandledrejection: ' + (e.reason && e.reason.stack || e.reason)));
    },
  });
  const w = dom.window;
  // 预加载本地 vendor
  w.eval(fs.readFileSync(__dirname + '/public/vendor/marked.min.js', 'utf8'));
  w.eval(fs.readFileSync(__dirname + '/public/vendor/highlight.min.js', 'utf8'));
  w.eval(fs.readFileSync(__dirname + '/public/reader.js', 'utf8'));
  // 执行页面内联脚本
  const inline = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  try { w.eval(inline); }
  catch (e) { console.log('❌ 内联脚本执行异常:', e.stack.split('\n').slice(0, 4).join('\n')); process.exit(1); }
  await new Promise((r) => setTimeout(r, 3000));
  const doc = w.document;
  const cards = doc.querySelectorAll('.card');
  const allCount = cards.length;
  const navItems = doc.querySelectorAll('.nav-item');
  console.log('卡片数量:', cards.length);
  console.log('侧栏目录项:', navItems.length);
  console.log('统计栏:', doc.querySelector('#stat').textContent.trim());
  let articleOk = false;
  if (cards.length) {
    // 阅读视图
    const rel = cards[0].getAttribute('data-rel');
    w.location.hash = 'doc=' + encodeURIComponent(rel);
    await new Promise((r) => setTimeout(r, 1500));
    const article = doc.querySelector('.article');
    articleOk = !!article;
    console.log('阅读视图:', article ? '已渲染' : '未渲染');
    doc.querySelector('#btn-share').click();
    await new Promise(r => setTimeout(r, 500));
    const shareURL = doc.querySelector('#share-link').value;
    if (!shareURL.includes('/share/') || doc.querySelector('#share-result').hidden) errors.push('分享链接未显示');
    doc.querySelector('#btn-revoke').click();
    await new Promise(r => setTimeout(r, 500));
    if (!doc.querySelector('#share-result').hidden || !doc.querySelector('#btn-revoke').hidden) errors.push('取消分享状态错误');
    const publicPath = new URL(shareURL).pathname;
    if ((await global.fetch(base + publicPath)).status !== 404) errors.push('取消后分享链接仍可用');
    console.log('分享与取消分享按钮:', errors.length ? '失败' : '正常');
    // 搜索
    w.location.hash = 'q=' + encodeURIComponent('自动化');
    await new Promise((r) => setTimeout(r, 1500));
    console.log('搜索「自动化」结果:', doc.querySelectorAll('.result').length, '条');
  }
  // ---- 侧栏「全部笔记」点击回归（原 bug：dir= 空目录只显示根目录 1 篇）----
  const navAll = doc.querySelector('.nav-item[data-dir=""]');
  navAll.click();
  await new Promise((r) => setTimeout(r, 800));
  let n = doc.querySelectorAll('.card').length;
  assert.equal(n, allCount, '全部笔记点击回归');
  console.log('点击「全部笔记」后卡片:', n, '✅ 正常');
  // ---- dir= 空参数防御 ----
  w.location.hash = 'dir=';
  await new Promise((r) => setTimeout(r, 800));
  n = doc.querySelectorAll('.card').length;
  assert.equal(n, allCount, '空目录参数回归');
  console.log('hash=dir=（空参数）卡片:', n, '✅ 正常');
  // ---- 筛选交互：近 30 天 ----
  const btnMonth = doc.querySelector('.f-btn[data-f="period"][data-v="month"]');
  btnMonth.click();
  await new Promise((r) => setTimeout(r, 500));
  const nMonth = doc.querySelectorAll('.card').length;
  const cntText = doc.querySelector('.f-count').textContent;
  const fixtureCards = (await (await w.fetch('/api/cards')).json()).cards;
  const expectedMonth = fixtureCards.filter(c => c.mtime >= Date.now() - 30 * 86400e3).length;
  assert.equal(nMonth, expectedMonth, '近 30 天实际过滤');
  assert.equal(cntText.trim(), expectedMonth + ' 篇', '筛选计数');
  console.log('筛选近 30 天:', nMonth, '✅ 正常');
  // ---- 排序：标题 A-Z ----
  const btnTitle = doc.querySelector('.f-btn[data-f="sort"][data-v="title"]');
  btnTitle.click();
  await new Promise((r) => setTimeout(r, 500));
  const titles = [...doc.querySelectorAll('.card .c-title')].map(e => e.textContent);
  const sorted = [...titles].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  assert.deepEqual(titles, sorted, '标题排序');
  console.log('排序标题 A-Z: ✅ 正常');
  // ---- 侧栏日历：当月天数、有文档日期标注、点击日期出当天文档 ----
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const calDays = doc.querySelectorAll('.cal-day');
  const calDots = doc.querySelectorAll('.cal-day .dot');
  console.log('日历格子数:', calDays.length, calDays.length === daysInMonth ? '✅ 正常' : `❌ 异常（应为 ${daysInMonth}）`);
  console.log('日历文档标注:', calDots.length, '天');
  let calOk = calDays.length === daysInMonth;
  if (calDots.length) {
    const dayBtn = calDots[calDots.length - 1].closest('.cal-day');
    const dateKey = dayBtn.getAttribute('data-date');
    dayBtn.click();
    await new Promise((r) => setTimeout(r, 800));
    const nDay = doc.querySelectorAll('.card').length;
    const headText = (doc.querySelector('.view-head h1') || {}).textContent || '';
    const selOk = !!doc.querySelector('.cal-day.sel') && doc.querySelector('.cal-day.sel').getAttribute('data-date') === dateKey;
    console.log(`点击日期 ${dateKey}:`, nDay, '篇，选中态:', selOk ? '✅' : '❌');
    calOk = calOk && nDay > 0 && selOk;
    // 月份切换：上个月 → 回到当月
    doc.querySelector('.cal-nav[data-step="-1"]').click();
    await new Promise((r) => setTimeout(r, 300));
    const prevTitle = doc.querySelector('.cal-title').textContent;
    doc.querySelector('.cal-nav[data-step="1"]').click();
    await new Promise((r) => setTimeout(r, 300));
    const backTitle = doc.querySelector('.cal-title').textContent;
    const navOk = prevTitle !== backTitle && backTitle === `${now.getFullYear()} 年 ${now.getMonth() + 1} 月`;
    console.log('日历月份切换:', navOk ? '✅ 正常' : `❌ 异常（${prevTitle} → ${backTitle}）`);
    calOk = calOk && navOk;
  }
  // ---- 在线编辑/删除 UI（仅 ATLAS_TEST_WRITE=1 时执行，必须在临时库实例上跑）----
  let writeUiOk = true;
  if (process.env.ATLAS_TEST_WRITE === '1' && cards.length) {
    const rel0 = cards[0].getAttribute('data-rel');
    w.location.hash = 'doc=' + encodeURIComponent(rel0);
    await new Promise((r) => setTimeout(r, 1500));
    doc.querySelector('#btn-edit').click();
    await new Promise((r) => setTimeout(r, 300));
    const editor = doc.querySelector('#editor');
    writeUiOk = writeUiOk && !!editor && editor.value.length > 0;
    console.log('编辑模式:', editor ? '已进入' : '❌ 未进入');
    if (editor) {
      editor.value += '\n\n冒烟测试追加行。\n';
      doc.querySelector('#btn-save').click();
      await new Promise((r) => setTimeout(r, 1500));
      const back = !!doc.querySelector('.article');
      const reread = await (await global.fetch(base + '/api/doc?path=' + encodeURIComponent(rel0), { headers: { Cookie: process.env.ATLAS_TEST_COOKIE || '' } })).json();
      const saved = back && typeof reread.content === 'string' && reread.content.includes('冒烟测试追加行');
      console.log('保存并回读:', saved ? '✅ 正常' : '❌ 异常');
      writeUiOk = writeUiOk && saved;
      // 删除：两段式确认
      doc.querySelector('#btn-delete').click();
      await new Promise((r) => setTimeout(r, 200));
      const armed = (doc.querySelector('#btn-delete') || {}).textContent || '';
      doc.querySelector('#btn-delete').click();
      await new Promise((r) => setTimeout(r, 1200));
      const gone = (await global.fetch(base + '/api/doc?path=' + encodeURIComponent(rel0), { headers: { Cookie: process.env.ATLAS_TEST_COOKIE || '' } })).status === 404;
      const left = !w.location.hash.includes('doc=');
      console.log('两段式删除:', armed.includes('确认') && gone && left ? '✅ 正常' : `❌ 异常（确认态:${armed.includes('确认')} 已删:${gone} 已离开:${left}）`);
      writeUiOk = writeUiOk && armed.includes('确认') && gone && left;
    }
  }
  console.log('JS 错误:', errors.length ? errors.join(' | ') : '无');
  const ok = cards.length > 0 && navItems.length >= 7 && errors.length === 0 && articleOk && calOk && writeUiOk;
  console.log(ok ? '✅ 冒烟测试通过' : '❌ 冒烟测试失败');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('测试脚本异常:', e); process.exit(1); });
