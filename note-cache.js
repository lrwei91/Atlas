'use strict';
const fs = require('node:fs');

// Always stat before reusing content: external edits, atomic replacements and
// deletions must be visible on the next request. Search text is computed lazily.
module.exports = function createNoteCache(maxBytes = 64 * 1024 * 1024) {
  const entries = new Map();
  let bytes = 0;
  function remove(file) {
    const entry = entries.get(file);
    if (entry) { bytes -= entry.bytes; entries.delete(file); }
  }
  function read(file, st = fs.statSync(file)) {
    const key = [st.dev, st.ino, st.size, st.mtimeMs, st.ctimeMs].join(':');
    const hit = entries.get(file);
    if (hit?.key === key) {
      entries.delete(file); entries.set(file, hit);
      return hit;
    }
    remove(file);
    const content = fs.readFileSync(file, 'utf8');
    // Image bytes are not searchable prose. Keep metadata and attachment names.
    const searchContent = content.replace(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/]+={0,2}/gi, '[图片]');
    const entry = { key, content, searchContent, bytes: (content.length + (searchContent === content ? 0 : searchContent.length)) * 2 };
    let lower;
    Object.defineProperty(entry, 'lower', { get() {
      if (lower !== undefined) return lower;
      const value = searchContent.toLowerCase(), cost = value.length * 2;
      if (entries.get(file) === entry && entry.bytes + cost <= maxBytes) {
        while (bytes + cost > maxBytes) remove(entries.keys().next().value);
        lower = value; entry.bytes += cost; bytes += cost;
      }
      return value;
    } });
    if (entry.bytes <= maxBytes) {
      while (bytes + entry.bytes > maxBytes) remove(entries.keys().next().value);
      entries.set(file, entry); bytes += entry.bytes;
    }
    return entry;
  }
  function prune(liveFiles) {
    for (const file of entries.keys()) if (!liveFiles.has(file)) remove(file);
  }
  return { read, prune };
};
