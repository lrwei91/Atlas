'use strict';

// Decode once so a UTF-8 character split across transport chunks stays intact.
module.exports = async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) throw new Error('Request body too large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, size).toString('utf8');
};
