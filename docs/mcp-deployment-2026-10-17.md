# 知识库 MCP 部署验收

verified_at: 2026-10-17 09:15:44 Asia/Shanghai

本记录为当时的运行快照，不保证后续状态不变。

## 已部署

- 用户批准 Muse、Codex 只读访问整个 `notes/`；附件限可读文档引用，位于 notes/ 的附件另做目录权限检查。
- 独立程序目录：`/opt/atlas-mcp/releases/f863ff16deaa3317`，`/opt/atlas-mcp/current` 指向该版本；部署包含逐文件 SHA-256 清单，服务器核对通过。
- `atlas-mcp.service`、`atlas-mcp-tunnel.service` 已启用并运行；Node v24.21.0，服务只监听回环 4320。
- 公网端点：`https://mcp.lrwei91.online/note`；按用户要求由原 `/mcp` 改为 `/note`，原路径返回 404。独立 Cloudflare Tunnel，HTTPS 不依赖 Mac，未开放服务器公网业务端口。
- 配置目录 `/etc/atlas-mcp`；服务以 atlas 用户运行，ProtectSystem=strict，知识库挂载为只读。
- Muse 与 Codex 的 Token 分别存入 Bitwarden：`ATLAS_MCP_MUSE_TOKEN`、`ATLAS_MCP_CODEX_TOKEN`；创建后已读回比对。服务器仅持有哈希，不持有客户端 Token 原文。
- 本机 Codex 新增 `atlas_knowledge` MCP，使用 owner-only 凭据文件与 header helper；TOML 不含 Token，原有配置条目保持不变。

## 已验证

- 本地 `npm test` 全量通过；服务器以 atlas 用户执行知识模块和 MCP 回归通过。
- 真实公网端点使用两组正式凭据，分别完成 initialize、tools/list、list_notes、read_note。
- 首次部署时 Codex 原生 app-server 发现四个工具；随后本聊天实际通过 MCP 搜索「知识」，得到 25 条命中，并读取带版本的正文。
- 公网目录分页返回全部 288 篇可见 Markdown；真实搜索、带版本读取和越界路径拒绝通过。
- 两篇超过默认 4 MiB 的现有笔记已读取，生产上限为 16 MiB，最大现有文件约 9.2 MiB。单次正文输出仍不超过 20,000 字符。
- Mac 与服务器的 notes/resources/trash 三组同步均 idle，待同步文件和字节、pullErrors 均为 0。notes 为 291 个同步文件，其中可见 Markdown 为 288 篇。
- 首次部署时服务器与 Mac 的 Node 请求均得到 `/healthz` 200、未认证 `/mcp` 401；路径变更后公网 `/note` 未认证返回 401，原 `/mcp` 返回 404。
- Node、Codex、HTTPX、Requests 和常规客户端标识可访问；凭据 helper 拒绝非 owner-only 文件，错误不泄露 Token。
- Atlas、Atlas 同步、测试工作台及其隧道进程与部署前一致；未替换网页程序、管理员状态或同步配置。

## 未验证与限制

- 尚未进入 Muse 界面实际添加连接；服务端已为其创建独立凭据，使用同凭据的官方 SDK 检查通过。
- 其他设备、Muse 图片/二进制资源显示、长期并发、整机重启和特定运营商网络未验证。
- Cloudflare 拦截默认 Python-urllib User-Agent（403/1010）；设置 `User-Agent: AtlasMCP/1.0` 后通过。现有管理凭据不能修改配置规则，未全站关闭 Browser Integrity Check。
- 搜索仍为缓存目录扫描与关键词匹配，不能声称远程 MCP 自动提速或具有语义检索。
- API 返回 `syncStatus=unknown`；本次独立检查同步正常，不代表每次请求都实时验证同步状态。
- 附件单次读取限 512 KiB；更大附件需通过 Atlas 阅读界面访问。
- 本轮未提交或推送代码，保留原有迁移工作区改动。

## 地址调整

用户要求端点改为 `mcp.lrwei91.online/note`。已同步修改服务路由、连接检查器、测试、隧道 ingress、Codex 配置和当前接入说明；没有更换 Token、开放目录或其他服务配置。新版本复用经 SHA-256 比对一致的 lockfile 依赖，服务器 MCP 回归通过，两组正式凭据的公网列表和正文读取通过；旧版本保留用于回退。地址变更前建立的当前聊天连接仍缓存旧 URL，需要重新连接 MCP；控制 socket 不可用，未重启应用或其他会话。

## 运维与回退

- 查看 `atlas-mcp` 和 `atlas-mcp-tunnel` 两个 systemd 服务；日志不应启用包含请求头的 debug 级别。
- 撤销客户端：从 `/etc/atlas-mcp/clients.json` 删除对应记录，再重启 MCP 服务；轮换时同时更新 Bitwarden 和该客户端的受保护凭据副本。
- 仅下线 MCP：停止并禁用上述两个服务，不影响 Atlas、同步或测试工作台。
- 后续版本先核对源码清单、安装 lockfile 依赖并运行 MCP 回归，再切换 current 链接和重启 MCP。回退时恢复上一 release 链接；不得覆盖知识库数据。
