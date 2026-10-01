'use strict';
const fs = require('node:fs');

// Always stat before reusing content: external edits, atomic replacements and
// deletions must be visible on the next request. Bound retained text to 32 MiB.
module.exports = function createNoteCache(maxBytes = 32 * 1024 * 1024) {
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
    const lower = content.toLowerCase();
    const entry = { key, content, lower, bytes: (content.length + lower.length) * 2 };
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
