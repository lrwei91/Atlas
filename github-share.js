'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const repo = process.env.ATLAS_SHARE_REPO || 'https://github.com/lrwei91/Share.git';
const root = path.join(process.env.ATLAS_STATE_DIR || path.join(__dirname, '.local'), 'share-repository');
const baseUrl = (process.env.ATLAS_SHARE_URL || 'https://lrwei91.github.io/Share').replace(/\/$/, '');
let queue = Promise.resolve();
const git = args => run('git', ['-c', 'credential.helper=!gh auth git-credential', ...args], { cwd: root, timeout: 120000, maxBuffer: 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
function serial(work) { const result = queue.then(work); queue = result.catch(() => {}); return result; }
async function prepare() {
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  try { await fs.access(path.join(root, '.git')); }
  catch { await git(['init', '-b', 'main']); await git(['remote', 'add', 'origin', repo]); }
  const origin = (await git(['remote', 'get-url', 'origin'])).stdout.trim();
  if (origin !== repo) throw Error('分享仓库地址与本地缓存不一致');
  if ((await git(['status', '--porcelain'])).stdout.trim()) throw Error('分享仓库缓存有未提交改动，请先处理');
  await git(['fetch', 'origin']);
  const refs = (await git(['ls-remote', '--heads', 'origin', 'main'])).stdout.trim();
  if (refs) {
    // Dedicated generated checkout; fast-forward only, never overwrite remote changes.
    const local = await git(['rev-parse', '--verify', 'HEAD']).catch(() => null);
    if (local) await git(['merge', '--ff-only', 'origin/main']);
    else await git(['checkout', '-B', 'main', 'origin/main']);
  } else if ((await git(['ls-remote', '--heads', 'origin'])).stdout.trim()) throw Error('分享仓库没有 main 分支，请先配置分享分支');
}
async function commit(message) {
  await git(['add', '--', 'documents', '.nojekyll', 'index.html']);
  if ((await git(['diff', '--cached', '--name-only'])).stdout.trim()) {
    await git(['-c', 'user.name=Atlas', '-c', 'user.email=atlas@users.noreply.github.com', 'commit', '-m', message]);
  }
  await git(['push', 'origin', 'HEAD:main']);
  const sha = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  const remote = (await git(['ls-remote', 'origin', 'refs/heads/main'])).stdout.split(/\s/)[0];
  if (sha !== remote) throw Error('分享提交的远端校验失败，请重试');
  return sha;
}
function directory(id) { if (!/^[A-Za-z0-9_-]{22}$/.test(id)) throw Error('分享标识无效'); return path.join(root, 'documents', id); }
module.exports = {
  initialize: () => serial(async () => {
    await prepare(); await fs.mkdir(path.join(root, 'documents'), { recursive: true });
    await fs.writeFile(path.join(root, '.nojekyll'), '');
    try { await fs.access(path.join(root, 'index.html')); } catch { await fs.writeFile(path.join(root, 'index.html'), '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>分享文档</title><p>请使用单篇文档的分享链接访问。</p></html>'); }
    return commit('初始化静态文档分享');
  }),
  publish: (id, files) => serial(async () => {
    directory(id);
    for (const name of files.keys()) if (!/^(index\.html|document\.md|assets\/[a-f0-9]{24}\.[a-z0-9]+)$/.test(name)) throw Error('导出文件名无效');
    await prepare();
    const dest = directory(id);
    await fs.rm(dest, { recursive: true, force: true }); await fs.mkdir(dest, { recursive: true });
    for (const [name, body] of files) {
      if (!/^(index\.html|document\.md|assets\/[a-f0-9]{24}\.[a-z0-9]+)$/.test(name)) throw Error('导出文件名无效');
      const full = path.join(dest, name); await fs.mkdir(path.dirname(full), { recursive: true }); await fs.writeFile(full, body);
    }
    await fs.writeFile(path.join(root, '.nojekyll'), '');
    const commitSha = await commit('发布分享文档');
    return { url: `${baseUrl}/documents/${id}/`, commitSha, publishedAt: new Date().toISOString() };
  }),
  revoke: id => serial(async () => { await prepare(); await fs.rm(directory(id), { recursive: true, force: true }); await commit('取消文档分享'); }),
};
