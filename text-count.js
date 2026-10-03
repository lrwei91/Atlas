'use strict';
const { JSDOM } = require('jsdom');
const marked = require('./public/vendor/marked.min.js');
const reader = require('./public/reader');

// Count visible body characters, including punctuation and code, excluding
// whitespace, metadata, Markdown syntax, media payloads and link destinations.
module.exports = function textCount(content) {
  const source = reader.prepare(content).replace(/data:(?:image|audio|video)\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/]+={0,2}/gi, '');
  const fragment = JSDOM.fragment(marked.parse(source));
  fragment.querySelectorAll('img,video,audio,source,script,style,noscript,template,iframe,object,embed,form,input,button,link,meta,svg,math').forEach(el => el.remove());
  return Array.from(fragment.textContent.replace(/\s/g, '')).length;
};
