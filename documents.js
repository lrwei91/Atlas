'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const marked = require('./public/vendor/marked.min.js');
const reader = require('./public/reader.js');
const versionOf = require('./document-version');
module.exports = function(vault, safeResolve, noteCache = require('./note-cache')()) {
  vault = fs.realpathSync(vault);
  const notes = path.join(vault, 'notes');
  function images(dir, result = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.isSymbolicLink()) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) images(full, result);
      else if (/\.(png|jpe?g|gif|webp|svg|avif|bmp|mp4|webm|ogv|mov|m4v)$/i.test(e.name)) result.push(path.relative(vault, full).split(path.sep).join('/'));
    }
    return result;
  }
  function resolveImage(raw, rel, getIndex) {
    if (/^(https?:|data:)/i.test(raw)) return null;
    let target = raw.split(/[?#]/)[0];
    try { target = decodeURIComponent(target); } catch {}
    target = target.replace(/^\/files\//, '').replace(/\\/g, '/');
    const candidates = [path.posix.join('notes', path.posix.dirname(rel), target), target.replace(/^\//,''), 'resources/attachments/' + target, 'resources/' + target, 'notes/' + target];
    for (const candidate of candidates) {
      if (!/^(notes|resources)\//.test(candidate) || !/\.(png|jpe?g|gif|webp|svg|avif|bmp|mp4|webm|ogv|mov|m4v)$/i.test(candidate)) continue;
      const absolute = safeResolve(vault, candidate);
      if (absolute && fs.statSync(absolute).isFile()) return path.relative(vault, absolute).split(path.sep).join('/');
    }
    const matches = getIndex().filter(p => p.endsWith('/' + target));
    return matches.length === 1 ? matches[0] : null;
  }
  function read(rel) {
    const full = safeResolve(notes, rel);
    if (!full || !fs.statSync(full).isFile() || path.extname(full).toLowerCase() !== '.md') return null;
    const st = fs.statSync(full);
    const entry = noteCache.read(full, st);
    const content = entry.content;
    const version = entry.version || (entry.version = versionOf(content));
    const html = marked.parse(reader.prepare(content));
    let sources = [];
    // Most notes contain no media; avoid constructing a DOM for those notes.
    if (/<(?:img|video)[\s>]/i.test(html)) {
      const dom = new JSDOM(html);
      try {
        sources = [...new Set([...dom.window.document.querySelectorAll('img,video,video source')].flatMap(el => [el.getAttribute('src'), el.tagName === 'VIDEO' ? el.getAttribute('poster') : null]).filter(Boolean))];
      } finally { dom.window.close(); }
    }
    let index;
    const getIndex = () => {
      if (!index) {
        index = [];
        for (const dir of ['notes', 'resources']) {
          const fullDir = safeResolve(vault, dir);
          if (fullDir) images(fullDir, index);
        }
      }
      return index;
    };
    const assets = Object.create(null);
    for (const source of sources) { const asset = resolveImage(source, rel, getIndex); if (asset) assets[source] = asset; }
    const title = (reader.body(content).match(/^#\s+(.+)$/m) || [])[1] || path.basename(rel, '.md');
    return { relPath: rel, title, isMarkdown: true, content, assets, version, mtime: st.mtimeMs, size: st.size };
  }
  return { read };
};
