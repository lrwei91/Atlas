'use strict';
// Read dimensions only; do not decode pixels or alter the source image.
module.exports = function imageSize(b) {
  const result = (width, height) => width > 0 && height > 0 && width <= 100000 && height <= 100000 ? { coverWidth: width, coverHeight: height } : {};
  if (b.length >= 24 && b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return result(b.readUInt32BE(16), b.readUInt32BE(20));
  if (b.length >= 10 && /^GIF8[79]a$/.test(b.toString('ascii', 0, 6))) return result(b.readUInt16LE(6), b.readUInt16LE(8));
  if (b.length >= 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const kind = b.toString('ascii', 12, 16);
    if (kind === 'VP8X') return result(1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3));
    if (kind === 'VP8 ' && b[23] === 0x9d && b[24] === 1 && b[25] === 0x2a) return result(b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff);
    if (kind === 'VP8L' && b[20] === 0x2f) return result(1 + (b.readUInt32LE(21) & 0x3fff), 1 + ((b.readUInt32LE(21) >>> 14) & 0x3fff));
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let at = 2;
    while (at + 4 <= b.length) {
      if (b[at++] !== 0xff) break;
      while (b[at] === 0xff) at++;
      const marker = b[at++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
      if (at + 2 > b.length) break;
      const length = b.readUInt16BE(at);
      if (length < 2 || at + length > b.length) break;
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker) && length >= 7) return result(b.readUInt16BE(at + 5), b.readUInt16BE(at + 3));
      at += length;
    }
  }
  return {};
};
