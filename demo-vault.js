'use strict';
/* 游客模式示例内容 —— 与本机主库完全隔离的固定数据集。
   游客会话只能读到本文件里的内容：目录树、卡片、原文、全文检索都走这里，
   不读 notes/ 与 resources/，也不写任何文件。
   数据全部内置，不依赖本机路径，因此临时库、公网、本地表现一致。 */
const reader = require('./public/reader.js');
const versionOf = require('./document-version');
const textCount = require('./text-count');

const DAY = 86400e3;

/* 示例配图：文档里写中文别名，映射到 public/covers/ 下真实存在的文件名 */
const IMAGES = {
  '交易系统封面.jpg': '01-trading.jpg',
  '选股信号封面.jpg': '02-signals.jpg',
  '股票投资封面.jpg': '04-investing.jpg',
};

const SOURCES = [
  {
    rel: '01-快速上手/欢迎使用 Atlas.md',
    age: 0.2,
    content: `# 欢迎使用 Atlas

你现在看到的是**游客模式**：页面、功能、渲染效果都是真的，但内容是内置的示例数据，与任何真实笔记库无关。

想看自己的内容，请退出后在登录页用管理员账号进入。

## 游客模式能做什么

- 浏览分类目录、卡片列表与侧栏日历
- 全文检索示例内容，命中后直接跳转到原文
- 阅读 Markdown：标题、列表、表格、代码块、引用、图片、双链跳转
- 桌面与手机两套布局，包括移动端双列瀑布流

## 游客模式不能做什么

- 新建、编辑、删除文档
- 生成免登录分享链接
- 访问主库里的任何一篇笔记或附件

> 写操作在服务端被直接拒绝，不只是把按钮藏起来。

下一步：[[浏览器与手机端差异|看看两端差别]]，或者直接打开 [[交易系统入门]]。
`,
  },
  {
    rel: '01-快速上手/浏览器与手机端差异.md',
    age: 1.4,
    content: `# 浏览器与手机端差异

同一份内容，桌面与手机是两套独立布局，互不影响。

| 能力 | 桌面（≥768px） | 手机（≤767px） |
| --- | --- | --- |
| 目录 | 左侧常驻侧栏 | 抽屉，边缘右滑打开 |
| 列表 | 单列大卡片 | 双列瀑布流 |
| 检索 | 顶栏输入框，\`/\` 聚焦 | 顶栏图标唤起搜索面板 |
| 账户 | 顶栏右侧 | 底栏「我的」独立页 |
| 详情工具 | 页面内按钮行 | 顶栏图标 + 更多菜单 |

## 断点

- \`≤767px\` 手机
- \`768–1023px\` 平板，沿用侧栏与单列列表
- \`≥1024px\` 桌面

## 阅读页返回

手机阅读页与「我的」页支持左缘右滑返回；纵向滚动、多指操作、编辑状态都不会误触返回。
连续打开多篇笔记时按浏览顺序逐级退回，并恢复列表滚动位置。

延伸阅读：[[Markdown 与双链速查]]
`,
  },
  {
    rel: '02-示例内容/交易系统入门.md',
    age: 0.6,
    cover: '交易系统封面.jpg',
    content: `# 交易系统入门

![[交易系统封面.jpg|640]]

这是一篇示例笔记，用来演示**图片、表格、代码块和双链**在阅读页里的渲染效果。

## 一个最小可用的交易系统

\`\`\`text
行情接入 → 信号计算 → 风控校验 → 下单 → 持仓核对
\`\`\`

任何一环缺失都会让策略结果不可复现。下面是一个最小的信号计算骨架：

\`\`\`python
def on_bar(bar, state):
    if not state.position and bar.close > bar.ma20:
        return Signal(side="buy", size=1.0, reason="上穿 MA20")
    if state.position and bar.close < bar.stop:
        return Signal(side="close", size=0.0, reason="触及止损")
    return None
\`\`\`

## 三条硬约束

1. 信号必须能被复现：同一根 K 线、同一份参数，输出必须一致
2. 下单前先过风控：单笔上限、单日次数、单标的敞口
3. 持仓以券商回报为准，不以本地推算为准

## 常见误区

| 误区 | 实际影响 |
| --- | --- |
| 用收盘价算信号、用开盘价成交 | 未来函数，回测虚高 |
| 忽略滑点与手续费 | 高频策略直接由盈转亏 |
| 只测策略不测异常 | 断连、重复下单无人拦截 |

接着看 [[选股信号检查清单]]，模板可以直接抄 [[股票投资笔记模板]]。
`,
  },
  {
    rel: '02-示例内容/选股信号检查清单.md',
    age: 2.2,
    cover: '选股信号封面.jpg',
    content: `# 选股信号检查清单

![[选股信号封面.jpg|640]]

一份可以逐条打勾的清单。示例数据同样支持检索，试试搜索「风控」。

## 信号层

- [ ] 指标口径写清楚：周期、复权方式、缺失值处理
- [ ] 信号触发条件与失效条件同时定义
- [ ] 同一标的的历史信号可回放，条数与回测报告一致

## 风控层

- [ ] 单笔最大亏损
- [ ] 单日最大交易次数
- [ ] 单标的与总仓位敞口上限
- [ ] 连续亏损后的自动降仓或停机

\`\`\`yaml
risk:
  max_loss_per_trade: 0.01
  max_trades_per_day: 3
  max_position_pct: 0.25
  stop_after_consecutive_losses: 3
\`\`\`

## 执行层

- [ ] 幂等：同一信号重复提交不会重复下单
- [ ] 断线重连后能补齐当日成交记录
- [ ] 券商回报与本地状态对得上

配套：[[交易系统入门]] 的三条硬约束。
`,
  },
  {
    rel: '03-模板/股票投资笔记模板.md',
    age: 4.5,
    cover: '股票投资封面.jpg',
    content: `# 股票投资笔记模板

![[股票投资封面.jpg|640]]

复制这份结构，逐周更新。字段保持一致，才好做纵向对比。

## 本周结论

- 结论：
- 信心：高 / 中 / 低
- 主要依据：

## 持仓

| 标的 | 成本 | 现价 | 浮动盈亏 | 仓位占比 |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |

## 待办

- [ ] 复核止损位
- [ ] 核对财报披露日期
- [ ] 更新 [[选股信号检查清单]]

## 复盘

写清楚**当时为什么买**和**现在为什么卖**，而不是只记结果。

---

模板来自示例内容，实际使用时新建自己的文档。
`,
  },
  {
    rel: '03-模板/周报模板.md',
    age: 6.1,
    content: `# 周报模板

字段固定为四段：**进展 → 本周目标 → 当前进度 → 说明**。没有内容的字段直接删掉，不要留空标题。

## 一、进展

- 完成了什么，落到哪个版本
- 缺陷（BUG）数量与修复情况

## 二、本周目标

1. 目标一
2. 目标二

## 三、当前进度

- 目标一：完成 / 进行中
- 目标二：完成 / 进行中

## 四、说明

需要对方决策或提供资源的事，写在这里。

---

用词统一：调测 / 缺陷（BUG）/ 累计 vs 本周，显式区分；日期补全为 \`9/23\` 这种形式。
`,
  },
  {
    rel: '04-参考/Markdown 与双链速查.md',
    age: 12.3,
    content: `# Markdown 与双链速查

阅读页和分享页共用一套渲染器，下面这些写法都能正常显示。

## 标题与列表

\`\`\`markdown
# 一级
## 二级
- 无序
1. 有序
\`\`\`

## 表格

| 列 A | 列 B |
| --- | --- |
| 1 | 2 |

## 引用与代码

> 引用块用于放结论和提示。

\`\`\`bash
npm test
\`\`\`

## 双链

- \`[[交易系统入门]]\` 按文件名跳转
- \`[[选股信号检查清单|自定义显示名]]\` 带别名的写法
- \`[[Markdown 与双链速查#双链]]\` 跳到本文档的小节

## 图片与视频

- \`![[图片.jpg]]\` Obsidian 内嵌写法
- \`![[图片.jpg|640]]\` 指定宽度
- \`![](图片.jpg)\` 标准 Markdown
- \`![[演示.mp4|640]]\` 视频按需加载，不自动播放

## 不生效的写法

HTML 里内嵌的 \`iframe\`、\`script\`、\`style\` 会被移除；带 \`on*\` 事件属性的元素同样会被清理。
`,
  },
];

/* ---------- 索引（内容固定，构建一次） ---------- */

const NOTES = SOURCES.map((source, index) => {
  const content = source.content;
  const body = reader.body(content);
  const title = (body.match(/^#\s+(.+)$/m) || [])[1] || source.rel.split('/').pop().replace(/\.md$/, '');
  return {
    relPath: source.rel,
    dir: source.rel.split('/').slice(0, -1).join('/'),
    title,
    content,
    body,
    chars: textCount(content),
    size: Buffer.byteLength(content, 'utf8'),
    // 固定相对偏移：保证「今天 / 近 7 天 / 近 30 天」筛选都有内容
    mtime: Date.now() - source.age * DAY - index * 60000,
    cover: source.cover ? 'demo/' + IMAGES[source.cover] : null,
    excerpt: excerptFrom(content),
    version: versionOf(content),
    lower: content.toLowerCase(),
  };
});

const byRel = new Map(NOTES.map(note => [note.relPath, note]));

/* 文件名（不含扩展名，小写）→ 笔记；重名不唯一则不参与匹配 */
const byName = new Map();
for (const note of NOTES) {
  const stem = note.relPath.split('/').pop().replace(/\.md$/, '').toLowerCase();
  byName.set(stem, byName.has(stem) ? null : note.relPath);
}

/* ---------- 摘要 ---------- */

function excerptFrom(content) {
  let inFence = false;
  for (const raw of reader.body(content).split('\n')) {
    const line = raw.trim();
    if (line.startsWith('```')) { inFence = !inFence; continue; }
    if (inFence) continue;
    if (!line || line.startsWith('#') || line.startsWith('>') || line.startsWith('|') || line.startsWith('- [') || line.startsWith('-')) continue;
    const text = line
      .replace(/!\[\[[^\]]*\]\]/g, '[图片]')
      .replace(/\[\[([^\]\n|]+)(?:\|[^\]\n]*)?\]\]/g, (_, target) => target.trim().split('/').pop())
      .replace(/[*_`~\[\]]/g, '')
      .replace(/^[-+*]\s+/, '')
      .replace(/^#+\s*/, '')
      .trim();
    if (text.length > 12) return text.length > 110 ? text.slice(0, 110) + '…' : text;
  }
  return '';
}

/* ---------- 链接与附件解析 ----------
   与 documents.js 相同的约定：
   - assets 的键是渲染前的原始引用字符串（如「交易系统封面.jpg」）
   - links 的键是 prepare() 生成的最终 href（「#doc=」+ encodeURIComponent(原始引用)），
     因为 reader.render 就是用 a[href] 去查这张表
   对不存在的目标返回 missing，前端会禁用跳转。 */

function resolveNote(target, rel) {
  const clean = target.replace(/\\/g, '/').replace(/\.md$/i, '');
  if (!clean) return rel;
  const normalized = clean.replace(/^\.\//, '').replace(/^\/+/, '');
  if (byRel.has(normalized + '.md')) return normalized + '.md';
  if (byRel.has(normalized)) return normalized;
  const stem = normalized.split('/').pop().toLowerCase();
  if (byName.has(stem) && byName.get(stem)) return byName.get(stem);
  const matches = NOTES.filter(note => note.relPath.replace(/\.md$/i, '').toLowerCase().endsWith('/' + stem));
  return matches.length === 1 ? matches[0].relPath : null;
}

function buildMaps(note) {
  const links = Object.create(null);
  const assets = Object.create(null);
  for (const match of note.content.matchAll(/!\[\[([^\]\n|]+)(?:\|[^\]\n]*)?\]\]/g)) {
    const name = match[1].trim();
    if (IMAGES[name]) assets[name] = 'demo/' + IMAGES[name];
  }
  for (const match of note.content.matchAll(/(?<!!)\[\[([^\]\n|]+)(?:\|[^\]\n]*)?\]\]/g)) {
    const raw = match[1].trim();
    const href = '#doc=' + encodeURIComponent(raw);
    let [target, ...rest] = raw.split('#');
    const fragment = rest.join('#');
    try { target = decodeURIComponent(target); } catch {}
    const rel = resolveNote(target, note.relPath);
    if (!rel) { links[href] = { type: 'missing' }; continue; }
    links[href] = { type: 'document', path: rel, fragment };
    // 图片型双链同时登记为附件，renderer 才能换成可访问的 /files/ 地址
    if (IMAGES[target]) assets[href] = 'demo/' + IMAGES[target];
  }
  return { links, assets };
}

for (const note of NOTES) Object.assign(note, buildMaps(note));

/* ---------- 对外接口（形状与主库接口一致） ---------- */

function tree() {
  const root = { name: '全部笔记', relPath: '', children: [] };
  const index = new Map([['', root]]);
  for (const note of [...NOTES].sort((a, b) => a.relPath.localeCompare(b.relPath, 'zh-CN'))) {
    const parts = note.dir.split('/').filter(Boolean);
    let parent = root;
    let walked = '';
    for (const part of parts) {
      walked = walked ? walked + '/' + part : part;
      let node = index.get(walked);
      if (!node) {
        node = { name: part, relPath: walked, children: [] };
        index.set(walked, node);
        parent.children.push(node);
      }
      parent = node;
    }
  }
  return root;
}

function cards(dirFilter) {
  const list = NOTES.filter(note => !dirFilter || (note.relPath + '/').startsWith(dirFilter.replace(/\/+$/, '') + '/'));
  return list
    .map(note => ({
      relPath: note.relPath,
      isMarkdown: true,
      mtime: note.mtime,
      size: note.size,
      dir: note.dir,
      title: note.title,
      excerpt: note.excerpt,
      chars: note.chars,
      cover: note.cover ? '/files/' + note.cover : null,
      isShared: false,
    }))
    .sort((a, b) => b.mtime - a.mtime);
}

function read(rel) {
  const note = byRel.get(rel || '');
  if (!note) return null;
  return {
    relPath: note.relPath,
    title: note.title,
    isMarkdown: true,
    content: note.content,
    assets: note.assets,
    links: note.links,
    version: note.version,
    mtime: note.mtime,
    size: note.size,
  };
}

function search(q) {
  const terms = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const results = [];
  for (const note of NOTES) {
    if (!terms.every(term => note.lower.includes(term))) continue;
    const snippets = [];
    let inFence = false;
    for (const line of note.content.split('\n')) {
      if (line.trim().startsWith('```')) inFence = !inFence;
      if (snippets.length >= 3) break;
      const text = line.trim();
      if (!text || inFence || text.startsWith('---')) continue;
      if (terms.some(term => text.toLowerCase().includes(term))) snippets.push(text.length > 160 ? text.slice(0, 160) + '…' : text);
    }
    results.push({ relPath: note.relPath, title: note.title, mtime: note.mtime, dir: note.dir, snippets });
  }
  return results.sort((a, b) => b.mtime - a.mtime);
}

/* 示例配图：把 assets 里的 demo/01-trading.jpg 之类路径映射回 public/covers/ 下的真实文件名。
   不在白名单内一律返回 null，由调用方拒绝，避免路径穿越。 */
function image(pathname) {
  const name = String(pathname || '').replace(/^demo\//, '');
  return Object.values(IMAGES).includes(name) ? name : null;
}

module.exports = { tree, cards, read, search, image, count: NOTES.length };
