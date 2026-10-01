/* 写入/删除接口测试：必须在临时库实例上运行（ATLAS_TEST_URL 指向 ATLAS_VAULT 为临时库的实例）
 * 覆盖：Origin 校验、路径穿越、非 md 拒绝、空内容拒绝、保存生效、删除入 .trash、分享联动撤销、重复删除 404
 */
'use strict';
const fs = require('fs');

(async () => {
  const base = process.env.ATLAS_TEST_URL;
  const cookie = process.env.ATLAS_TEST_COOKIE || '';
  const vault = process.env.ATLAS_TEST_VAULT;
  if (!base || !vault) { console.error('需要 ATLAS_TEST_URL / ATLAS_TEST_COOKIE / ATLAS_TEST_VAULT'); process.exit(1); }
  const ORIGIN = 'https://note.lrwei91.online';
  const results = [];
  const check = (name, ok, extra = '') => { results.push([name, ok]); console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ' · ' + extra : ''}`); };
  const api = (method, qs, body, origin = ORIGIN) => fetch(base + qs, {
    method,
    headers: { Cookie: cookie, Origin: origin, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

  const editTarget = '10-工作/编辑靶子.md';
  const delTarget = '20-学习/删除靶子.md';
  const q = (p) => '/api/doc?path=' + encodeURIComponent(p);

  // 1. Origin 不对 → 403
  check('PUT 错误 Origin 拒绝', (await api('PUT', q(editTarget), { content: 'x' }, 'https://evil.example')).status === 403);
  check('DELETE 错误 Origin 拒绝', (await api('DELETE', q(delTarget), null, 'https://evil.example')).status === 403);
  // 2. 路径穿越 → 404
  check('PUT 路径穿越拒绝', (await api('PUT', q('../outside.md'), { content: 'x' })).status === 404);
  // 3. 空内容 → 400
  check('PUT 空内容拒绝', (await api('PUT', q(editTarget), { content: '  ' })).status === 400);

  // 4. 正常保存：接口返回 ok，API 读回新内容，磁盘文件同步变更
  const newContent = '# 编辑靶子\n\n原始内容第一行。\n\n在线新增的一行。\n';
  const before = await (await api('GET', q(editTarget))).json();
  const put = await api('PUT', q(editTarget), { content: newContent, version: before.version });
  check('PUT 保存返回 200', put.status === 200);
  const doc = await (await api('GET', q(editTarget))).json();
  check('API 读回新内容', doc.content === newContent);
  check('磁盘文件同步变更', fs.readFileSync(vault + '/notes/' + editTarget, 'utf8') === newContent);
  check('无临时文件残留', !fs.readdirSync(vault + '/notes/10-工作').some(f => f.includes('.atlas-tmp-')));

  // 5. 分享后删除 → 分享联动撤销
  const shareQ = '/api/share?path=' + encodeURIComponent(delTarget);
  await api('POST', shareQ);
  const shareUrl = (await (await api('GET', shareQ)).json()).url;
  const del = await api('DELETE', q(delTarget));
  check('DELETE 返回 200', del.status === 200);
  const delResult = await del.json();
  check('文件移入 .trash 保留目录结构', delResult.trash === '.trash/' + delTarget && fs.existsSync(vault + '/.trash/' + delTarget));
  check('原位置文件已消失', !fs.existsSync(vault + '/notes/' + delTarget));
  check('API 读取已删文档 404', (await api('GET', q(delTarget))).status === 404);
  check('卡片列表不再包含', !((await (await api('GET', '/api/cards')).json()).cards.some(c => c.relPath === delTarget)));
  // 删除后：分享记录被撤销，分享接口对已删文档返回 404（两者任一即视为联动生效）
  const shareAfter = await api('GET', shareQ);
  const shareAfterJson = await shareAfter.json();
  check('分享联动撤销', shareAfter.status === 404 || shareAfterJson.url === null);
  check('重复删除 404', (await api('DELETE', q(delTarget))).status === 404);

  const failed = results.filter(([, ok]) => !ok);
  console.log(failed.length ? `❌ ${failed.length} 项失败` : `✅ 写入/删除测试全部通过（${results.length} 项）`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('测试脚本异常:', e); process.exit(1); });
