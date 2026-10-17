'use strict';
const fs = require('node:fs');
const path = require('node:path');

module.exports = function safeResolve(base, rel) {
  const resolved = path.resolve(base, rel);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) return null;
  try {
    const realBase = fs.realpathSync(base);
    const real = fs.realpathSync(resolved);
    if (real !== realBase && !real.startsWith(realBase + path.sep)) return null;
    if (path.relative(realBase, real).split(path.sep).some(part => part.startsWith('.'))) return null;
    return real;
  } catch { return null; }
};
