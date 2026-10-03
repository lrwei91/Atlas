'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const imageSize = require('./image-size');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1S8AAAAASUVORK5CYII=', 'base64');
assert.deepEqual(imageSize(png), { coverWidth: 1, coverHeight: 1 });
assert.deepEqual(imageSize(Buffer.from('ffd8ffe00004ffffffc000070804b00258ffd9', 'hex')), { coverWidth: 600, coverHeight: 1200 });
for (let i = 0; i < 12; i++) assert.deepEqual(imageSize(Buffer.alloc(i)), {});
assert.deepEqual(imageSize(Buffer.from('ffd8ffc000ff00', 'hex')), {});
for (const file of ['index.html', 'login.html', 'share.html']) {
  const html = fs.readFileSync('public/' + file, 'utf8');
  assert.match(html, /touch-action:\s*pan-x pan-y/);
  assert.doesNotMatch(html, /user-scalable\s*=\s*(?:no|0)|maximum-scale\s*=/);
  assert.match(html, /src="\/page-touch.js"/);
}
const dom = new JSDOM('<input><div>Text</div>', { runScripts: 'outside-only' });
try {
  const w = dom.window;
  w.eval(fs.readFileSync('public/page-touch.js', 'utf8'));
  for (const type of ['gesturestart', 'gesturechange']) {
    const event = new w.Event(type, { bubbles: true, cancelable: true });
    w.document.querySelector('input').dispatchEvent(event); assert.equal(event.defaultPrevented, true);
  }
  for (const type of ['touchstart', 'touchmove', 'touchend', 'selectstart', 'wheel', 'keydown']) {
    const event = new w.Event(type, { bubbles: true, cancelable: true });
    w.document.querySelector('input').dispatchEvent(event); assert.equal(event.defaultPrevented, false);
  }
} finally { dom.window.close(); }
console.log('PASS: image dimensions/truncated headers, ordinary-page pinch policy, normal touch/selection/keyboard/wheel passthrough');
