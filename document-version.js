'use strict';
const { createHash } = require('node:crypto');
module.exports = content => createHash('sha256').update(content, 'utf8').digest('hex');
