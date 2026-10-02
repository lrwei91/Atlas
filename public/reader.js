(function(root) {
'use strict';
const escape = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function body(source) { return String(source || '').replace(/^\uFEFF?---\s*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/, ''); }
function prepare(source, names = {}) {
  return body(source).split(/(^\s*```[^\n]*\n[\s\S]*?^\s*```[^\n]*$|^\s*~~~[^\n]*\n[\s\S]*?^\s*~~~[^\n]*$)/gm).map((part, i) => i % 2 ? part : part
    .replace(/!\[\[([^\]\n|]+)(?:\|([^\]\n]*))?\]\]/g, (_, target, size) => {
      const dims = /^(\d+)(?:x(\d+))?$/.exec(size || '');
      const video = /\.(mp4|webm|ogv|mov|m4v)(?:[?#]|$)/i.test(target);
      if (video) return `<video src="${escape(target.trim())}" controls playsinline preload="metadata"${dims ? ` width="${Math.min(Number(dims[1]), 4096)}"` : ''}></video>`;
      return `<img src="${escape(target.trim())}" alt="${escape(dims ? '' : size || '')}"${dims ? ` width="${Math.min(Number(dims[1]), 4096)}"${dims[2] ? ` height="${Math.min(Number(dims[2]), 4096)}"` : ''}` : ''}>`;
    })
    .replace(/(?<!!)\[\[([^\]\n|]+)(?:\|([^\]\n]*))?\]\]/g, (_, target, alias) => {
      const key = target.trim().toLowerCase();
      return `[${alias || target.trim().split('/').pop().replace(/\.md$/, '')}](#doc=${encodeURIComponent(names[key] || names[key.replace(/\.md$/, '')] || target.trim())})`;
    })).join('');
}
function render(doc, options = {}) {
  const container = document.createElement('div');
  container.innerHTML = marked.parse(prepare(doc.content, doc.links ? {} : options.names), { gfm: true, breaks: true });
  container.querySelectorAll('img').forEach(img => {
    if (/\.(mp4|webm|ogv|mov|m4v)(?:[?#]|$)/i.test(img.getAttribute('src') || '')) {
      const video = document.createElement('video');
      video.setAttribute('src', img.getAttribute('src'));
      if (img.getAttribute('width')) video.setAttribute('width', img.getAttribute('width'));
      img.replaceWith(video);
    }
  });
  container.querySelectorAll('script,iframe,object,embed,form,input,button,style,link,meta,base,svg,math').forEach(el => el.remove());
  container.querySelectorAll('*').forEach(el => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on') || ['srcdoc','style','srcset'].includes(name)) el.removeAttribute(attr.name);
      if (['href','src','poster','xlink:href'].includes(name)) {
        const value = attr.value.replace(/[\u0000-\u0020]/g, '');
        const imageData = el.tagName === 'IMG' && /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(value);
        if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value) && !/^https?:/i.test(value) && !imageData) el.removeAttribute(attr.name);
      }
    }
  });
  container.querySelectorAll('img,video,video source').forEach(el => {
    for (const name of el.tagName === 'VIDEO' ? ['src', 'poster'] : ['src']) {
      const source = el.getAttribute(name);
      if (!source) continue;
      if (!/^https?:\/\//i.test(source) && !(el.tagName === 'IMG' && /^data:image\//i.test(source))) {
        const asset = doc.assets?.[source];
        if (asset) el.setAttribute(name, options.assetUrl(asset));
        else { el.removeAttribute(name); if (el.tagName === 'IMG') el.alt = el.alt || '图片未找到'; }
      }
    }
    if (el.tagName === 'IMG') el.loading = 'lazy';
    if (el.tagName === 'VIDEO') {
      el.controls = true; el.setAttribute('playsinline', ''); el.preload = 'metadata';
      el.removeAttribute('autoplay'); el.removeAttribute('loop');
      el.appendChild(document.createTextNode('浏览器无法播放此视频，请使用兼容的编码格式。'));
    }
    if (el.tagName !== 'SOURCE') { el.style.maxWidth = '100%'; el.style.height = 'auto'; }
  });
  container.querySelectorAll('video').forEach(el => { if (!el.getAttribute('src') && !el.querySelector('source[src]')) { const p = document.createElement('p'); p.textContent = '视频文件未找到'; el.after(p); } });
  container.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href');
    const link = doc.links?.[href];
    if (!link) return;
    if (link.type === 'document') {
      if (options.shared && link.path !== doc.relPath) { a.removeAttribute('href'); a.title = '此文档未分享'; return; }
      a.href = '#doc=' + encodeURIComponent(link.path);
      a.dataset.documentPath = link.path;
      if (link.fragment) a.dataset.documentHeading = link.fragment;
    } else if (link.type === 'asset' && (!options.shared || Object.values(doc.assets || {}).includes(link.path))) {
      a.href = options.assetUrl(link.path); a.target = '_blank'; a.rel = 'noopener';
    } else { a.removeAttribute('href'); a.title = link.type === 'missing' ? '链接目标不存在或路径不明确' : '此附件未分享'; }
  });
  if (options.shared) container.querySelectorAll('a[href^="#doc="]').forEach(a => { if (!a.dataset.documentHeading) { a.removeAttribute('href'); a.title = '此链接未分享'; } });
  container.querySelectorAll('pre code').forEach(el => { try { if (typeof hljs !== 'undefined') hljs.highlightElement(el); } catch {} });
  return container.innerHTML;
}
function scrollToHeading(container, fragment) {
  const key = value => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const heading = [...container.querySelectorAll('h1,h2,h3,h4,h5,h6')].find(el => el.id === fragment || key(el.textContent) === key(fragment));
  if (heading) heading.scrollIntoView?.({ block: 'start' });
  return !!heading;
}
const api = { body, prepare, render, scrollToHeading };
if (typeof module === 'object' && module.exports) module.exports = api;
else root.AtlasReader = api;
})(typeof window !== 'undefined' ? window : globalThis);
