'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { JSDOM } = require('jsdom');
const marked = require('./public/vendor/marked.min.js');
const readerSource = fs.readFileSync(path.join(__dirname, 'public/reader.js'), 'utf8');
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Export only this document's resolved media. No directory scan or linked note export.
module.exports = function exportShare(doc, vault, safeResolve) {
  const files = new Map();
  const urls = new Map();
  let total = 0;
  for (const asset of new Set(Object.values(doc.assets || {}))) {
    const full = safeResolve(vault, asset);
    if (!full || !fs.statSync(full).isFile()) throw Error('分享附件已不存在，请刷新文档后重试');
    const size = fs.statSync(full).size;
    if (size > 90 * 1024 * 1024 || total + size > 250 * 1024 * 1024) throw Error('分享附件过大：单个文件须小于 90 MB，合计须小于 250 MB');
    total += size;
    const name = 'assets/' + crypto.createHash('sha256').update(asset).digest('hex').slice(0, 24) + path.extname(asset).toLowerCase();
    files.set(name, fs.readFileSync(full)); urls.set(asset, name);
  }
  const dom = new JSDOM('', { runScripts: 'outside-only' });
  let html;
  try {
    dom.window.marked = marked;
    dom.window.eval(readerSource);
    html = dom.window.AtlasReader.render(doc, { shared: true, assetUrl: asset => urls.get(asset) });
    const article = dom.window.document.createElement('article'); article.innerHTML = html;
    article.querySelectorAll('a[data-document-heading]').forEach(a => {
      const heading = a.dataset.documentHeading;
      const key = value => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
      const target = [...article.querySelectorAll('h1,h2,h3,h4,h5,h6')].find(el => el.id === heading || key(el.textContent) === key(heading));
      if (target) { target.id ||= 'heading-' + [...article.querySelectorAll('h1,h2,h3,h4,h5,h6')].indexOf(target); a.setAttribute('href', '#' + target.id); }
      else a.removeAttribute('href');
    });
    article.querySelectorAll('[data-document-path],[data-document-heading]').forEach(el => { el.removeAttribute('data-document-path'); el.removeAttribute('data-document-heading'); });
    html = article.innerHTML;
  } finally { dom.window.close(); }
  const template = fs.readFileSync(path.join(__dirname, 'public/share.html'), 'utf8');
  const css = template.match(/<style>([\s\S]*?)<\/style>/)[1];
  files.set('index.html', Buffer.from(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escape(doc.title)} · Atlas</title><style>${css}</style></head><body><main><div class="brand">Atlas · 分享文档</div><article class="article">${html}</article></main></body></html>`));
  files.set('document.md', Buffer.from(require('./public/reader').body(doc.content)));
  return files;
};
