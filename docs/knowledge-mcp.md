# 知识库 MCP

Atlas 网页与独立 MCP 进程共用 `knowledge.js` 的检索实现、`documents.js` 的文档解析和 `note-cache.js` 的缓存策略；两个进程各有自己的内存缓存。MCP 读取服务器知识库，不改写 Markdown、同步配置、Atlas 登录或分享状态。

## 状态与边界

- 已部署于独立的 `/opt/atlas-mcp/current`，公网端点为 `https://mcp.lrwei91.online/note`。部署快照见 [2026-10-17 验收记录](mcp-deployment-2026-10-17.md)。
- 已实现 Streamable HTTP：`POST /note`，无状态 JSON 响应，使用官方 TypeScript SDK。认证后的 GET/DELETE 返回 405，不提供旧版独立 SSE 端点。
- 四个只读工具，无写入、删除、命令执行、外部 URL 抓取或跨库路径入口。
- 使用独立客户端 Bearer Token；服务只保存 Token 的 SHA-256。仅支持能主动设置 Authorization 请求头的客户端，尚未实现 OAuth、自动授权发现和网页登录流程。
- Muse 的接口形态参考已有 `v9-data-api` 项目的 `API.md`；不能据此声称 Muse 已连接此服务。
- 本地全量回归、服务器 MCP 回归、独立隧道及公网真实读取已通过；当前 Codex 聊天已直接使用 MCP 搜索和读取真实笔记。Muse 界面、其他设备、长期负载和重启整机尚未验证。
- 经用户确认，Muse/Codex 的权限都为整个 `notes/`。已在本机 Codex 配置中添加 `atlas_knowledge`，通过凭据 helper 取认证头；没有在 TOML 中保存 Token，也没有复用 V9 服务的凭据或域名入口。
- 端点已按用户要求改为 `/note`，旧 `/mcp` 返回 404；Token 不变。Codex 配置已更新，地址变更前建立的聊天连接需要重新连接 MCP。

## 工具

| 工具 | 输入与返回 |
| --- | --- |
| `list_notes` | `directory`（相对 notes/，可选）、`offset`、`limit`；返回允许访问的 Markdown 路径与下一页 offset |
| `search_notes` | `query`、`offset`、`limit`；空白分词后要求全部关键词命中，返回标题、修改时间、路径和最多三个片段；按修改时间降序 |
| `read_note` | `path`；可选 `heading`、`startLine`、`startColumn`、`maxLines`、`maxChars`、`version`；返回原文、标题目录、附件路径、版本和 next 游标 |
| `get_attachment` | `document`、`path`，可选文档 `version`；附件必须由可读文档引用；图片返回 image 内容，其他类型返回二进制 resource |

`path` 相对 `notes/`，附件路径相对知识库根目录。中文路径直接使用 JSON 字符串。目录权限同时检查请求路径与真实路径，拒绝隐藏路径和越界路径；扫描跳过符号链接。

`read_note` 的行号从 1 开始，列号从 0 开始（UTF-16 单元）。将 `next` 的字段原样传回，并携带上一页的 `version` 及相同 `heading`。连续页面的 `text` 可以直接拼接，换行保留。文档已修改时，旧版本游标被拒绝。章节只支持 ATX 标题，包含下级章节；代码块与 frontmatter 中的伪标题不参与匹配，同名标题需改用行号。

附件属于文档授权的一部分：允许文档引用的 `resources/` 附件可读；位于 `notes/` 的附件还需满足该客户端的目录权限。不向客户端提供任意附件读取接口。内嵌 data URI 保留在原文中，目前不作为单独附件返回。

文档版本为原文 SHA-256；附件另返回自身 SHA-256。`mtime` 为文件修改时间，不代表同步完成时间。读取与搜索标明 `source=server-vault`、`syncStatus=unknown`，没有接入 Syncthing 实时状态，不能声称与 Mac 即时一致。

## 限制

- 默认每页 20 条，最多 50 条；查询最长 500 字符。
- 正文默认 120 行、12,000 字符，每次最多 500 行、20,000 字符；标题目录与附件列表各返回前 100 项并标记是否截断。
- 文档默认上限 4 MiB，可通过 `ATLAS_MCP_MAX_NOTE_BYTES` 配置，最大允许 64 MiB；当前生产为 16 MiB，覆盖部署时所有可见笔记（最大约 9.2 MiB）。超限文档不进入 MCP 搜索；附件上限 512 KiB，大文件需在 Atlas 中打开。
- 当前为带内容缓存的目录扫描和关键词检索，不是持久化全文索引或语义检索；尚无远程性能提升结论。
- 每客户端每分钟最多 120 个 POST 请求，同时最多 8 个请求；初始化也计入。限额在进程重启后重置，未认证请求的限速应由私有网络或部署入口补充。
- 请求体最多 64 KiB；仅 `/healthz` 无需认证，返回存活状态，不披露文件或同步信息。
- 服务只绑定 `127.0.0.1`。Host 必须在允许列表；携带 Origin 的请求必须匹配显式允许列表。不接受 URL 查询参数传 Token，也不设置通配 CORS。
- Cloudflare Browser Integrity Check 会拒绝默认 Python-urllib User-Agent，返回 403/1010；Node、Codex、HTTPX、Requests 的请求已通过检查。用 urllib 时应设置正常客户端标识，例如 `User-Agent: AtlasMCP/1.0`。尚未获得修改该项 WAF 配置的管理权限，未改变全站安全设置。

## 本地检查

```bash
npm ci --ignore-scripts
npm run test:mcp
npm test
```

运行服务需要明确指定知识库路径和客户端文件，缺少配置会拒绝启动：

```bash
ATLAS_VAULT=/path/to/vault \
ATLAS_MCP_CLIENTS_FILE=/path/to/private/mcp-clients.json \
npm run start:mcp
```

客户端文件格式见 `deploy/mcp-clients.example.json`。示例中的 hash 和目录均为占位值，不能直接启动；正式配置放在仓库外，由服务用户读取。生产目录为 `/etc/atlas-mcp`（root:atlas，0750），hash 配置与连接器凭据为 root:atlas、0640；本机原始 Token 文件为用户独占、0600。`roots` 相对 `notes/`，例如 `["技术", "项目/Atlas"]`。`["*"]` 明确授权整个 notes/；空目录列表、相对穿越路径、无效 hash 或重复客户端均拒绝启动。

正式凭据应为每个 Agent 单独生成的高熵随机值，至少 32 字符；用户确认开放范围后再创建并通过秘密管理渠道交付，不写入 Markdown、Git、URL 或日志。SHA-256 不能弥补弱 Token。删除客户端记录或更换 hash 后重启服务，即可撤销旧 Token。

连接检查器从进程环境接收 Token，只输出检查结论，不输出正文、文件名或凭据：

```bash
# 用秘密管理器向进程注入 ATLAS_MCP_TOKEN，不在命令行或文档里粘贴真实值。
ATLAS_MCP_URL=https://approved-host.example.com/note node mcp-check.js
```

检查器实际执行 initialize、tools/list、list_notes 和 read_note。没有可读文档时失败；不会把空结果当成读取验证通过。

## 部署与客户端配置

1. 确认现有 Atlas 服务器上的路径、运行时、同步状态和批准开放的目录；核对实际部署账号和运行环境。
2. 为客户端配置独立凭据，并保存受保护的客户端文件；不复用网页管理员会话。
3. 按服务器实际路径调整 `deploy/atlas-mcp.service` 和 `deploy/atlas-mcp.env.example`，独立运行 MCP 服务。当前使用 `/opt/atlas-mcp/releases/<源码清单哈希>` 与 `current` 链接，依赖由 lockfile 安装。systemd 将文件系统设为只读，不能给该服务添加知识库写权限。
4. 当前远程入口采用独立 Cloudflare Tunnel，由 `atlas-mcp-tunnel.service` 运行，域名为 `mcp.lrwei91.online`；不依赖 Mac 常开，不改 Atlas 网页域名或现有隧道。`ATLAS_MCP_EDGE_PRIMARY/SECONDARY` 来自已验证的服务器连接配置。`deploy/Caddyfile.mcp.example` 是其他部署方式的可选模板，当前未安装 Caddy。
5. 将正式主机名加入 `ATLAS_MCP_ALLOWED_HOSTS`。不要通过允许任意 Host/Origin 来绕过验证，也不要开放 4320 到公网。
6. 客户端配置 Streamable HTTP，URL 为正式 `/note`，认证请求头为 `Authorization: Bearer <该客户端自己的 Token>`。Muse 可参考既有 V9 接入界面，但需要实际验证读取、图片及响应大小兼容性。
7. Codex 支持以环境变量提供 Bearer Token，其他设备可以采用以下配置示意；当前 Mac 使用 `http_headers_helper`，已连接，不需要把 Token 写入此配置：

```toml
[mcp_servers.atlas_knowledge]
url = "https://mcp.lrwei91.online/note"
bearer_token_env_var = "ATLAS_MCP_TOKEN"
```

原生客户端需分别验收连接、工具发现、中文搜索、章节分页、目录拒绝与附件显示。官方 SDK 本地通过不等于 Muse/Codex 已接入，配置被解析也不等于远程连接成功。

Muse 连接信息：Streamable HTTP；地址为 `https://mcp.lrwei91.online/note`；Bearer Token 从 Bitwarden 的 `ATLAS_MCP_MUSE_TOKEN` 复制。Codex 独立使用 `ATLAS_MCP_CODEX_TOKEN`。为其他 Agent 接入时应另建凭据，不共享这两组 Token。当前尚未登录或操作 Muse 的连接配置界面。

## 来源

- [Codex MCP 接入](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
- [MCP Streamable HTTP 传输](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
