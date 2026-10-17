'use strict';
const fs = require('node:fs');
const path = require('node:path');
const safeResolve = require('./safe-path');

// The web API and MCP use the same parser, cache and keyword-search semantics.
module.exports = function createKnowledge(vault, { roots = ['*'], noteCache = require('./note-cache')(), maxReadBytes = Infinity } = {}) {
  vault = fs.realpathSync(vault);
  const notes = path.join(vault, 'notes');
  const documents = require('./documents')(vault, safeResolve, noteCache);
  for (const root of roots) {
    if (root !== '*' && (typeof root !== 'string' || !root || root.includes('\\') || path.posix.normalize(root) !== root || root.split('/').some(part => !part || part.startsWith('.')) || path.isAbsolute(root))) throw Error('Invalid note root');
  }
  const inScope = rel => roots.some(root => root === '*' || rel === root || rel.startsWith(root + '/'));
  function resolveNote(rel) {
    if (typeof rel !== 'string' || rel.includes('\\') || path.isAbsolute(rel) || rel.split('/').some(part => !part || part.startsWith('.')) || !inScope(rel)) return null;
    const full = safeResolve(notes, rel);
    if (!full || !inScope(path.relative(notes, full).split(path.sep).join('/'))) return null;
    return full;
  }
  function list() {
    const result = [];
    function scan(dir) {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
        const full = path.join(dir, entry.name);
        const rel = path.relative(notes, full).split(path.sep).join('/');
        if (entry.isDirectory()) {
          if (inScope(rel) || roots.some(root => root.startsWith(rel + '/'))) scan(full);
        } else if (entry.isFile() && /\.md$/i.test(entry.name) && inScope(rel)) result.push(rel);
      }
    }
    scan(notes);
    return result;
  }
  function read(rel) {
    const full = resolveNote(rel);
    if (!full) return null;
    const st = fs.statSync(full);
    if (!st.isFile() || !/\.md$/i.test(full)) return null;
    if (st.size > maxReadBytes) throw Error('Document exceeds read size limit');
    const doc = documents.read(rel);
    for (const [href, link] of Object.entries(doc.links)) {
      if (link.type === 'document' && !resolveNote(link.path)) delete doc.links[href];
      if (link.type === 'asset' && link.path.startsWith('notes/') && !resolveNote(link.path.slice(6))) delete doc.links[href];
    }
    for (const [source, asset] of Object.entries(doc.assets)) if (asset.startsWith('notes/') && !resolveNote(asset.slice(6))) delete doc.assets[source];
    return doc;
  }
  function search(q) {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const results = [];
    for (const rel of list()) {
      const full = resolveNote(rel);
      if (!full) continue;
      let entry, st;
      try { st = fs.statSync(full); if (st.size > maxReadBytes) continue; entry = noteCache.read(full, st); } catch { continue; }
      if (!terms.every(term => entry.lower.includes(term))) continue;
      const snippets = [];
      for (const line of entry.searchContent.split('\n')) {
        if (snippets.length === 3) break;
        if (terms.some(term => line.toLowerCase().includes(term)) && line.trim()) snippets.push(line.trim().length > 160 ? line.trim().slice(0, 160) + '…' : line.trim());
      }
      results.push({ relPath: rel, title: ((entry.searchContent.match(/^#\s+(.+)$/m) || [])[1] || path.basename(full, '.md')).trim().slice(0, 80), mtime: st.mtimeMs, dir: path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel), snippets });
    }
    return results.sort((a, b) => b.mtime - a.mtime);
  }
  return { read, search, list, resolveNote, vault, maxReadBytes };
};
