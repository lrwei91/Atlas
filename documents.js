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
    target = target.replace(/^file:\/\//, '').replace(/^\/files\//, '').replace(/\\/g, '/');
    if (target.startsWith(vault + '/')) target = target.slice(vault.length + 1);
    const candidates = [path.posix.join('notes', path.posix.dirname(rel), target), target.replace(/^\//,''), 'resources/attachments/' + target, 'resources/' + target, 'notes/' + target];
    for (const candidate of candidates) {
      if (!/^(notes|resources)\//.test(candidate) || !/\.(png|jpe?g|gif|webp|svg|avif|bmp|mp4|webm|ogv|mov|m4v)$/i.test(candidate)) continue;
      const absolute = safeResolve(vault, candidate);
      if (absolute && fs.statSync(absolute).isFile()) return path.relative(vault, absolute).split(path.sep).join('/');
    }
    const matches = getIndex().filter(p => p.endsWith('/' + target));
    return matches.length === 1 ? matches[0] : null;
  }
  function resolveLink(href, rel, getNotes) {
    let raw = href;
    const wiki = raw.startsWith('#doc=');
    if (wiki) { try { raw = decodeURIComponent(raw.slice(5)); } catch { return null; } }
    if (!wiki && /^(https?:|mailto:|tel:|data:|javascript:|\/\/)/i.test(raw)) return null;
    let [target, ...parts] = raw.split('#');
    let fragment = parts.join('#');
    try { target = decodeURIComponent(target); if (!wiki) fragment = decodeURIComponent(fragment); } catch {}
    target = target.replace(/\\/g, '/').replace(/^file:\/\//, '');
    if (target.startsWith(vault + '/')) target = target.slice(vault.length + 1);
    target = target.replace(/^\/files\//, '').replace(/^\//, '');
    if (!target) return { type: 'document', path: rel, fragment };
    const rooted = /^(notes|resources)\//.test(target);
    const candidates = rooted ? [target] : [path.posix.join('notes', path.posix.dirname(rel), target), 'notes/' + target, 'resources/' + target, 'resources/attachments/' + target];
    for (const candidate of candidates) {
      for (const name of path.extname(candidate).toLowerCase() === '.md' ? [candidate] : [candidate, candidate + '.md']) {
        if (!/^(notes|resources)\//.test(name)) continue;
        const full = safeResolve(vault, name);
        if (full && fs.statSync(full).isFile()) {
          const canonical = path.relative(vault, full).split(path.sep).join('/');
          if (canonical.startsWith('notes/') && /\.md$/i.test(canonical)) return { type: 'document', path: canonical.slice(6), fragment };
          return { type: 'asset', path: canonical, fragment };
        }
      }
    }
    if (!rooted && !target.includes('..')) {
      const wanted = target.replace(/\.md$/i, '').toLowerCase();
      const matches = getNotes().filter(name => name.replace(/\.md$/i, '').toLowerCase().endsWith('/' + wanted));
      if (matches.length === 1) return { type: 'document', path: matches[0].slice(6), fragment };
    }
    return { type: 'missing' };
  }
  function read(rel) {
    const full = safeResolve(notes, rel);
    if (!full || !fs.statSync(full).isFile() || path.extname(full).toLowerCase() !== '.md') return null;
    const st = fs.statSync(full);
    const entry = noteCache.read(full, st);
    const content = entry.content;
    const version = entry.version || (entry.version = versionOf(content));
    let { sources, hrefs } = entry.parsed || { sources: [], hrefs: [] };
    // Most notes contain no media; avoid constructing a DOM for those notes.
    if (!entry.parsed) {
      const html = marked.parse(reader.prepare(content));
      if (/<(?:img|video|a)[\s>]/i.test(html)) {
        const dom = new JSDOM(html);
        try {
          hrefs = [...new Set([...dom.window.document.querySelectorAll('a[href]')].map(el => el.getAttribute('href')))];
          sources = [...new Set([...dom.window.document.querySelectorAll('img,video,video source')].flatMap(el => [el.getAttribute('src'), el.tagName === 'VIDEO' ? el.getAttribute('poster') : null]).filter(Boolean))];
        } finally { dom.window.close(); }
      }
      // Cache syntax only; resolve paths and share allowlists against live files.
      entry.parsed = { sources, hrefs };
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
    let noteIndex;
    const getNotes = () => {
      if (!noteIndex) {
        noteIndex = [];
        const scan = dir => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) scan(full);
          else if (/\.md$/i.test(entry.name)) noteIndex.push(path.relative(vault, full).split(path.sep).join('/'));
        } };
        scan(notes);
      }
      return noteIndex;
    };
    const links = Object.create(null);
    for (const href of hrefs) {
      let link = resolveLink(href, rel, getNotes);
      if (link?.type === 'missing') {
        let raw = href;
        if (raw.startsWith('#doc=')) { try { raw = decodeURIComponent(raw.slice(5)); } catch {} }
        const media = resolveImage(raw, rel, getIndex);
        if (media) link = { type: 'asset', path: media };
      }
      if (link) {
        links[href] = link;
        if (link.type === 'asset' && /\.(png|jpe?g|gif|webp|svg|avif|bmp|mp4|webm|ogv|mov|m4v)$/i.test(link.path)) assets[href] = link.path;
      }
    }
    const title = (reader.body(content).match(/^#\s+(.+)$/m) || [])[1] || path.basename(rel, '.md');
    return { relPath: rel, title, isMarkdown: true, content, assets, links, version, mtime: st.mtimeMs, size: st.size };
  }
  return { read };
};
