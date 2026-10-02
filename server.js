/*
 * Atlas 知识库工作台 — 本地服务器（读为主，Markdown 支持在线编辑与安全删除）
 * 数据源：Obsidian 主库（iCloud 同步目录），零依赖 Node.js
 * API:
 *   GET  /                  前端页面
 *   GET  /api/tree          分类目录树（notes/）
 *   GET  /api/cards?dir=    文档卡片列表（默认全部，按修改时间倒序）
 *   GET  /api/doc?path=     单篇文档原文（相对 notes/）
 *   PUT  /api/doc?path=     保存 Markdown 原文（原子写入，限 .md）
 *   DELETE /api/doc?path=   移入库内 .trash/（保留目录结构，可恢复）
 *   GET  /api/search?q=     全文检索（返回命中片段）
 *   GET  /files/*           静态资源（notes/ 及 resources/，防路径穿越）
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const auth = require('./auth');
const shares = require('./shares');
const readBody = require('./request-body');
const versionOf = require('./document-version');

const VAULT = path.resolve(process.env.ATLAS_VAULT || '/Users/lrwei91/Library/Mobile Documents/iCloud~md~obsidian/Documents/主库');
const NOTES = path.join(VAULT, 'notes');
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 4317);
const noteCache = require('./note-cache')();
const documents = require('./documents')(VAULT, safeResolve, noteCache);

const IGNORE_FILES = new Set(['.DS_Store', '.obsidian', '.trash']);
const MIME = {
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.avif': 'image/avif', '.bmp': 'image/bmp', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.ogv': 'video/ogg', '.mov': 'video/quicktime',
  '.pdf': 'application/pdf', '.sh': 'text/plain; charset=utf-8',
  '.yml': 'text/plain; charset=utf-8', '.yaml': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
};

/* ---------- 工具 ---------- */

function safeResolve(base, rel) {
  const resolved = path.resolve(base, rel);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) return null;
  try {
    const realBase = fs.realpathSync(base);
    const real = fs.realpathSync(resolved);
    if (real !== realBase && !real.startsWith(realBase + path.sep)) return null;
    if (path.relative(realBase, real).split(path.sep).some(part => part.startsWith('.'))) return null;
    return real;
  } catch { return null; }
}

function statOrNull(p) {
  try { return fs.statSync(p); } catch { return null; }
}

/* 解析「即将创建」的路径：目标文件尚不存在，realpathSync 会失败，
   因此只校验 base 的realpath 与父目录的 realpath，并拒绝隐藏段与穿越。 */
function safeResolveForCreate(base, rel) {
  const resolved = path.resolve(base, rel);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) return null;
  const dir = path.dirname(resolved);
  let realDir;
  try { realDir = fs.realpathSync(dir); } catch { return null; }   // 父目录必须已存在
  let realBase;
  try { realBase = fs.realpathSync(base); } catch { return null; }
  if (realDir !== realBase && !realDir.startsWith(realBase + path.sep)) return null;
  // 必须用 realDir 计算相对路径：软链目录（如 /var→ /private/var）会让原始 dir 算出大量 '..' 而被误判为穿越
  const rest = path.relative(realBase, realDir);
  if (rest.split(path.sep).some(part => part.startsWith('.'))) return null;
  return path.join(realDir, path.basename(resolved));
}

function excerptFrom(content) {
  const lines = content.split('\n');
  let inFence = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('```')) { inFence = !inFence; continue; }
    if (inFence) continue;
    if (!line || line.startsWith('#') || line.startsWith('---')) continue;
    const text = line
      .replace(/!?\[\[[^\]]*\]\]/g, (m) => (m.startsWith('!') ? '[图片]' : m.replace(/[[\]]/g, '').split('|').pop()))
      .replace(/[*_`>~\[\]]/g, '')
      .replace(/^[-+*]\s+/, '');
    if (text.length > 8) {
      return text.length > 110 ? text.slice(0, 110) + '…' : text;
    }
  }
  return '';
}

function walk(dir, cb) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
  for (const e of entries) {
    if (IGNORE_FILES.has(e.name) || e.name.startsWith('.') || e.isSymbolicLink()) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, cb);
    else cb(full);
  }
}

function relToNotes(full) { return path.relative(NOTES, full).split(path.sep).join('/'); }

/* 卡片封面：取正文首张图片（Obsidian ![[...]] 与 Markdown/HTML 图片），视频不算。
   命中本地文件时返回可访问的 /files/ 路径，避免前端二次解析。 */
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp)$/i;
function coverFrom(content, rel) {
  const source = content.replace(/^[\s\S]*?(?:\r?\n)?---[\s\S]*?(?:\r?\n)?(?:---|\.\.\.)[\s\S]*?(?:\r?\n)?/, '');
  const patterns = [
    /!\[\[([^\]\n|]+?)(?:\|[^\]\n]*)?\]\]/g,          // Obsidian 内嵌图片
    /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,       // Markdown 图片
    /<img[^>]+src=["']([^"']+)["']/gi,                  // HTML 图片
  ];
  const candidates = [];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(source))) {
      const raw = m[1].split(/[?#]/)[0].trim();
      if (raw && !/^(https?:|data:|file:)/i.test(raw)) candidates.push(raw);
      if (candidates.length >= 8) break;
    }
    if (candidates.length) break;
  }
  for (const raw of candidates) {
    let target = decodeURIComponent(raw).replace(/^\/files\//, '').replace(/^\.\//, '');
    const bases = [
      path.posix.join('notes', path.posix.dirname(rel), target),
      target.replace(/^\//, ''),
      'resources/' + path.posix.basename(target),
    ];
    for (const candidate of bases) {
      if (!IMAGE_EXT.test(candidate)) continue;
      const abs = safeResolve(VAULT, candidate);
      if (abs && statOrNull(abs)?.isFile()) {
        // safeResolve 返回 realpath，VAULT 未必是；两侧都取realpath 再求相对路径，
        // 否则软链目录（如 /var → /private/var）会算出带 ../../ 的越界路径
        let relToVault;
        try { relToVault = path.relative(fs.realpathSync(VAULT), abs); }
        catch { relToVault = path.relative(VAULT, abs); }
        const normalized = relToVault.split(path.sep).join('/');
        if (normalized.startsWith('..')) continue;   // 越界则不作为封面
        return '/files/' + normalized;
      }
    }
  }
  return null;
}

/* ---------- API 实现 ---------- */

function buildTree() {
  function scan(dir) {
    const children = [];
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return children; }
    entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
    for (const e of entries) {
      if (IGNORE_FILES.has(e.name) || e.name.startsWith('.')) continue;
      if (e.isDirectory()) {
        children.push({
          name: e.name,
          relPath: relToNotes(path.join(dir, e.name)),
          children: scan(path.join(dir, e.name)),
        });
      }
    }
    return children;
  }
  return { name: '全部笔记', relPath: '', children: scan(NOTES) };
}

function buildCards(dirFilter) {
  const cards = [];
  const liveFiles = new Set();
  walk(NOTES, (full) => {
    liveFiles.add(full);
    const rel = relToNotes(full);
    if (dirFilter && !(rel + '/').startsWith(dirFilter.replace(/\/+$/, '') + '/')) return;
    const st = statOrNull(full);
    if (!st) return;
    if (path.extname(full).toLowerCase() !== '.md') {
      cards.push({ relPath: rel, title: path.basename(rel), isMarkdown: false, mtime: st.mtimeMs, size: st.size, excerpt: '', dir: path.dirname(rel) === '.' ? '' : path.dirname(rel) });
      return;
    }
    let content = '';
    try { content = noteCache.read(full, st).content; } catch { return; }
    const titleLine = (content.match(/^#\s+(.+)$/m) || [])[1];
    cards.push({
      relPath: rel,
      title: (titleLine || path.basename(rel, '.md')).trim().slice(0, 80),
      isMarkdown: true,
      mtime: st.mtimeMs,
      size: st.size,
      excerpt: excerptFrom(content),
      dir: path.dirname(rel) === '.' ? '' : path.dirname(rel),
      chars: content.length,
      cover: coverFrom(content, rel),
    });
  });
  noteCache.prune(liveFiles);
  cards.sort((a, b) => b.mtime - a.mtime);
  return cards;
}

function searchDocs(q) {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const results = [];
  walk(NOTES, (full) => {
    if (path.extname(full).toLowerCase() !== '.md') return;
    const st = statOrNull(full);
    if (!st) return;
    let content, lower;
    try { ({ content, lower } = noteCache.read(full, st)); } catch { return; }
    if (!terms.every((t) => lower.includes(t))) return;
    const titleLine = (content.match(/^#\s+(.+)$/m) || [])[1];
    const snippets = [];
    const lines = content.split('\n');
    let inFence = false;
    for (let i = 0; i < lines.length && snippets.length < 3; i++) {
      const line = lines[i];
      if (line.trim().startsWith('```')) inFence = !inFence;
      const l = line.toLowerCase();
      if (terms.some((t) => l.includes(t))) {
        const s = line.trim();
        if (s) snippets.push(s.length > 160 ? s.slice(0, 160) + '…' : s);
      }
    }
    results.push({
      relPath: relToNotes(full),
      title: (titleLine || path.basename(full, '.md')).trim().slice(0, 80),
      mtime: st.mtimeMs,
      dir: path.dirname(relToNotes(full)) === '.' ? '' : path.dirname(relToNotes(full)),
      snippets,
    });
  });
  results.sort((a, b) => b.mtime - a.mtime);
  return results;
}

/* ---------- HTTP ---------- */

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function sendFile(req, res, absPath) {
  const st = statOrNull(absPath);
  if (!st || !st.isFile()) { res.writeHead(404); res.end('Not found'); return; }
  const headers = {
    'Content-Type': MIME[path.extname(absPath).toLowerCase()] || 'application/octet-stream',
    'Content-Length': st.size, 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes',
  };
  let start = 0, end = st.size - 1, status = 200;
  if (req.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (match && (match[1] || match[2])) {
      if (!match[1]) { const count = Number(match[2]); start = Math.max(0, st.size - count); }
      else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
    }
    if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= st.size || (!match[1] && Number(match[2]) === 0)) {
      res.writeHead(416, { ...headers, 'Content-Length': 0, 'Content-Range': `bytes */${st.size}` }); res.end(); return;
    }
    status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
    headers['Content-Length'] = end - start + 1;
  }
  res.writeHead(status, headers);
  if (req.method === 'HEAD' || st.size === 0) { res.end(); return; }
  const stream = fs.createReadStream(absPath, { start, end });
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; media-src 'self' https:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  try {
    const u = new URL(req.url, 'http://localhost');
    const p = decodeURIComponent(u.pathname);
    if (process.env.ATLAS_PUBLIC_URL && req.headers['x-forwarded-proto'] === 'http') {
      res.writeHead(308, { Location: process.env.ATLAS_PUBLIC_URL + u.pathname + u.search, 'Cache-Control': 'no-store' });
      res.end(); return;
    }
    if (await auth.handle(req, res, p)) return;
    if (p === '/login') { sendFile(req, res, path.join(PUBLIC_DIR, 'login.html')); return; }
    if (['/reader.js', '/vendor/marked.min.js', '/vendor/highlight.min.js', '/vendor/hl-theme.css'].includes(p) && req.method === 'GET') {
      sendFile(req, res, path.join(PUBLIC_DIR, p.slice(1))); return;
    }
    if (p.startsWith('/share/')) {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      const match = /^\/share\/([a-f0-9]{64})(?:\/(doc|file))?\/?$/.exec(p);
      const share = match && shares.get(match[1]);
      const doc = share && documents.read(share.relPath);
      if (!doc || !['GET', 'HEAD'].includes(req.method)) { sendJSON(res, 404, { error: '分享不存在或已取消' }); return; }
      if (!match[2]) { sendFile(req, res, path.join(PUBLIC_DIR, 'share.html')); return; }
      if (match[2] === 'doc') { sendJSON(res, 200, doc); return; }
      const asset = u.searchParams.get('path');
      const absolute = Object.values(doc.assets).includes(asset) ? safeResolve(VAULT, asset) : null;
      if (!absolute) { sendJSON(res, 404, { error: '图片不存在' }); return; }
      if (path.extname(absolute).toLowerCase() === '.svg') res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
      sendFile(req, res, absolute); return;
    }
    if (!auth.session(req)) {
      if (p.startsWith('/api/') || p.startsWith('/files/')) sendJSON(res, 401, { error: '请先登录' });
      else { res.writeHead(302, { Location: '/login', 'Cache-Control': 'no-store' }); res.end(); }
      return;
    }
    if (p === '/api/share') {
      const absolute = safeResolve(NOTES, u.searchParams.get('path') || '');
      const rel = absolute ? path.relative(fs.realpathSync(NOTES), absolute).split(path.sep).join('/') : '';
      if (!documents.read(rel)) { sendJSON(res, 404, { error: '只能分享现有 Markdown 文档' }); return; }
      if (req.method === 'POST' || req.method === 'DELETE') {
        const expected = process.env.ATLAS_PUBLIC_URL || `http://${req.headers.host}`;
        if (req.headers.origin !== expected) { sendJSON(res, 403, { error: '请求来源无效' }); return; }
        if (req.method === 'DELETE') shares.revoke(rel); else shares.create(rel);
      } else if (req.method !== 'GET') { sendJSON(res, 405, { error: 'method not allowed' }); return; }
      const token = shares.find(rel);
      sendJSON(res, 200, { url: token ? (process.env.ATLAS_PUBLIC_URL || '') + '/share/' + token : null }); return;
    }
    if (p === '/api/doc' && (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE')) {
      const expected = process.env.ATLAS_PUBLIC_URL || `http://${req.headers.host}`;
      if (req.headers.origin !== expected) { sendJSON(res, 403, { error: '请求来源无效' }); return; }
      const rel = u.searchParams.get('path') || '';
      if (req.method === 'POST') {
        // 创建新文档：仅允许 .md，父目录必须已存在，wx 排他创建避免覆盖同名文件
        const rel = u.searchParams.get('path') || '';
        if (path.extname(rel).toLowerCase() !== '.md') {
          sendJSON(res, 400, { error: '只能创建 Markdown 文档' }); return;
        }
        if (!rel || rel.includes('\0') || /(^|\/)\.\.?(\/|$)/.test(rel) || rel.split('/').some(part => !part)) {
          sendJSON(res, 400, { error: '路径格式无效' }); return;
        }
        const parentRel = path.posix.dirname(rel);
        const parentAbs = parentRel === '.' ? null : safeResolve(NOTES, parentRel);
        if (!parentRel || parentRel === '.' || !parentAbs || !statOrNull(parentAbs)?.isDirectory()) {
          sendJSON(res, 404, { error: '目标目录不存在，请先在 Obsidian 中创建' }); return;
        }
        const abs = safeResolveForCreate(NOTES, rel);
        if (!abs) { sendJSON(res, 400, { error: '路径不合法' }); return; }
        let title;
        try {
          const raw = await readBody(req, 64 * 1024);
          const payload = JSON.parse(raw);
          title = typeof payload.title === 'string' ? payload.title.trim() : '';
        } catch { sendJSON(res, 400, { error: '请求格式无效' }); return; }
        if (!title || title.length > 120) { sendJSON(res, 400, { error: '请填写标题（不超过 120 字）' }); return; }
        if (title.includes('\n') || title.includes('\r')) { sendJSON(res, 400, { error: '标题不能包含换行' }); return; }
        // 同名加时间戳后缀，绝不覆盖已有文档
        let target = abs, finalRel = rel;
        if (statOrNull(target)) {
          const ext = path.extname(abs), stem = abs.slice(0, -ext.length);
          finalRel = rel.slice(0, -4) + '-' + Date.now() + '.md';
          target = stem + '-' + Date.now() + ext;
        }
        try {
          fs.writeFileSync(target, `# ${title}\n\n`, { encoding: 'utf8', flag: 'wx', mode: 0o644 });
        } catch (e) {
          if (e.code === 'EEXIST') { sendJSON(res, 409, { error: '同名文档已存在' }); return; }
          sendJSON(res, 500, { error: '创建失败，原文件未改动' }); return;
        }
        const st = fs.statSync(target);
        sendJSON(res, 200, { ok: true, relPath: path.relative(fs.realpathSync(NOTES), target).split(path.sep).join('/'), version: versionOf(`# ${title}\n\n`), mtime: st.mtimeMs, size: st.size });
        return;
      }
      const abs = safeResolve(NOTES, rel);
      if (!abs || !statOrNull(abs) || !statOrNull(abs).isFile() || path.extname(abs).toLowerCase() !== '.md') {
        sendJSON(res, 404, { error: '文档不存在或不是 Markdown' }); return;
      }
      if (req.method === 'PUT') {
        let text;
        try { text = await readBody(req, 8 * 1024 * 1024); }
        catch { sendJSON(res, 413, { error: '内容过大' }); return; }
        let payload;
        try { payload = JSON.parse(text); } catch { sendJSON(res, 400, { error: '请求格式无效' }); return; }
        if (!payload || typeof payload.content !== 'string' || !payload.content.trim()) { sendJSON(res, 400, { error: '内容不能为空' }); return; }
        if (typeof payload.version !== 'string' || !/^[a-f0-9]{64}$/.test(payload.version)) {
          sendJSON(res, 428, { error: '请重新打开文档后保存，缺少有效的文档版本' }); return;
        }
        // 原子写入：先写临时文件再 rename，避免写一半损坏原文档
        const tmp = abs + '.atlas-tmp-' + process.pid;
        try {
          fs.writeFileSync(tmp, payload.content, 'utf8');
          // Revalidate after reading the request and preparing the new file.
          // No await between comparison and rename, so browser saves serialize.
          const current = safeResolve(NOTES, rel);
          if (current !== abs || versionOf(fs.readFileSync(abs, 'utf8')) !== payload.version) {
            fs.unlinkSync(tmp);
            sendJSON(res, 409, { error: '文档已被其他窗口或 Obsidian 修改，草稿已保留。请复制草稿，重新打开文档后合并修改。' }); return;
          }
          fs.renameSync(tmp, abs);
        } catch {
          try { fs.unlinkSync(tmp); } catch {}
          sendJSON(res, 500, { error: '写入失败，原文档未改动' }); return;
        }
        const st = fs.statSync(abs);
        sendJSON(res, 200, { ok: true, version: versionOf(payload.content), mtime: st.mtimeMs, size: st.size });
        return;
      }
      // DELETE：不移除数据，移入库内 .trash/（保留目录结构，可手动找回）
      const relPosix = path.relative(fs.realpathSync(NOTES), abs).split(path.sep).join('/');
      let dest = path.join(VAULT, '.trash', relPosix);
      if (statOrNull(dest)) {
        const ext = path.extname(dest);
        dest = dest.slice(0, -ext.length) + '.' + Date.now() + ext;
      }
      try {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.renameSync(abs, dest);
      } catch { sendJSON(res, 500, { error: '删除失败，文档未改动' }); return; }
      shares.revoke(relPosix);
      sendJSON(res, 200, { ok: true, trash: path.relative(VAULT, dest).split(path.sep).join('/') });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { sendJSON(res, 405, { error: 'method not allowed' }); return; }
    if (p === '/' || p === '/index.html') {
      sendFile(req, res, path.join(PUBLIC_DIR, 'index.html'));
      return;
    }
    if (p === '/api/tree') { sendJSON(res, 200, buildTree()); return; }
    if (p === '/api/cards') {
      const dir = u.searchParams.get('dir') || '';
      const sharedPaths = shares.paths();
      sendJSON(res, 200, { cards: buildCards(dir).map(card => ({ ...card, isShared: card.isMarkdown && sharedPaths.has(card.relPath) })) });
      return;
    }
    if (p === '/api/doc') {
      const rel = u.searchParams.get('path') || '';
      const abs = safeResolve(NOTES, rel);
      if (!abs || !statOrNull(abs)) { sendJSON(res, 404, { error: 'not found' }); return; }
      const st = fs.statSync(abs);
      if (!st.isFile()) { sendJSON(res, 404, { error: 'not found' }); return; }
      if (path.extname(abs).toLowerCase() === '.md') {
        sendJSON(res, 200, documents.read(rel)); return;
      } else {
        sendJSON(res, 200, { relPath: rel, isMarkdown: false, mtime: st.mtimeMs, size: st.size });
      }
      return;
    }
    if (p === '/api/search') {
      const q = (u.searchParams.get('q') || '').trim();
      sendJSON(res, 200, { query: q, results: searchDocs(q) });
      return;
    }
    if (p.startsWith('/vendor/')) {
      const abs = safeResolve(PUBLIC_DIR, p.slice(1));
      if (!abs || !statOrNull(abs) || !statOrNull(abs).isFile()) { res.writeHead(404); res.end('Not found'); return; }
      sendFile(req, res, abs);
      return;
    }
    if (p.startsWith('/files/')) {
      const rel = p.slice('/files/'.length);
      const abs = /^(notes|resources)\//.test(rel) ? safeResolve(VAULT, rel) : null;
      if (!abs || !statOrNull(abs) || !statOrNull(abs).isFile()) { res.writeHead(404); res.end('Not found'); return; }
      if (['.html', '.js', '.css', '.xml'].includes(path.extname(abs).toLowerCase())) {
        res.setHeader('Content-Disposition', 'attachment');
        res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
      }
      if (path.extname(abs).toLowerCase() === '.svg') res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
      sendFile(req, res, abs);
      return;
    }
    res.writeHead(404); res.end('Not found');
  } catch (err) {
    console.error('[error]', err);
    sendJSON(res, err instanceof URIError ? 400 : 500, { error: '请求无法处理' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const n = buildCards('');
  console.log(`Atlas 知识库工作台已启动: http://localhost:${server.address().port}`);
  console.log(`数据源: ${NOTES}`);
  console.log(`已索引 ${n.length} 个文件（其中 Markdown ${n.filter((c) => c.isMarkdown).length} 篇）`);
});
