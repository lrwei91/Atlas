# Atlas 知识库工作台

自托管的本机知识库工作台。服务实时读取你机器上的笔记目录，不上传任何文件到服务器；所有页面与接口都需要登录。

## 特性

- **实时读取**：直接读本机 `notes/` 与 `resources/`，外部编辑、原子替换、新增、改名、删除在下次请求即生效，不依赖同步机制
- **在线编辑**：浏览器内改Markdown 原文，保存走临时文件 + 原子替换；基于文档版本的乐观并发控制，多窗口同时编辑不会互相覆盖
- **安全删除**：不进回收站，移入主库 `.trash/` 并保留目录结构，可随时找回
- **免登录分享**：单篇文档生成短链接，访客可看该文档及其引用的媒体，其余内容仍需登录
- **图片与视频**：支持 Markdown、HTML、Obsidian 双链三种写法，含本地视频 Range 分段播放与封面
- **移动端**：独立窄屏布局，含侧栏抽屉、日历、底部tab 与边缘滑动返回
- **PWA**：提供 `apple-touch-icon`，可添加到 iOS 主屏

## 快速开始

需要 Node.js 18+（用到原生fetch）。运行时依赖只有 `jsdom`，且仅测试使用。

```sh
npm install
npm start
```

打开 `http://127.0.0.1:4317/login`。首次进入需创建唯一管理员，凭据写在 `.local/setup-token`，创建完成后该文件自动删除。密码至少 12 位，只存哈希。

会话有效期 12 小时，服务重启后需重新登录。忘记密码时停止服务、移走 `.local/admin.json` 后重启，重新走初始化流程。

## 配置

全部通过环境变量，均为可选：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `4317` | 监听端口，仅绑定 `127.0.0.1` |
| `ATLAS_VAULT` | 硬编码的本机路径 | 笔记主库目录，**部署到其他机器时必须显式设置** |
| `ATLAS_STATE_DIR` | `<项目>/.local` | 凭据、分享记录与日志的存放目录 |
| `ATLAS_PUBLIC_URL` | 无 | 对外访问地址。公网部署必设，用于校验登录来源与签发 Secure Cookie |

`.local/` 已在 `.gitignore` 中，不要提交或公开。

## 部署

服务只监听回环地址，对外暴露需自行接入反向代理或隧道。仓库提供 `deploy/` 下三个脚本：

| 脚本 | 用途 |
|---|---|
| `install-local.py` | 将服务注册为用户级 LaunchAgent（macOS） |
| `install-cloudflare.py` | 将 Cloudflare Tunnel 注册为独立 LaunchAgent |
| `install-tunnel.py` | SSH 反向隧道备用方案 |

以 Cloudflare Tunnel 为例，不需要云服务器或本机入站端口：

```text
浏览器 → Cloudflare HTTPS → 加密 Tunnel → 127.0.0.1:4317 → 本机笔记目录
```

需要本机已装 `cloudflared`，隧道配置与凭据就绪后运行脚本，并确保 `ATLAS_PUBLIC_URL` 与隧道 ingress 一致。注意服务只在本机运行且保持唤醒，主机休眠或断网时访问不可用。

参考：[Cloudflare Tunnel 本地管理隧道文档](https://developers.cloudflare.com/tunnel/features/locally-managed-tunnels/create-local-tunnel/)。

## API

除登录与分享页外全部需要会话，且写操作校验请求来源。

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/tree` | 分类目录树 |
| `GET` | `/api/cards` | 卡片列表，支持 `dir` 筛选 |
| `GET` | `/api/search` | 全文检索，参数 `q` |
| `GET` | `/api/doc` | 读取文档，参数 `path`，返回 `version` |
| `POST` | `/api/doc` | 新建文档，仅 `.md`，同名自动加时间戳 |
| `PUT` | `/api/doc` | 保存文档，需同时提交 `content` 与 `version` |
| `DELETE` | `/api/doc` | 移入 `.trash/` |
| `POST` | `/api/share` | 创建或取消分享 |

`PUT /api/doc` 的版本校验：缺少 `version` 返回 `428`，文档已被外部修改返回 `409`（保留浏览器草稿，需手动合并）。

## 测试

```sh
npm test              # 功能回归，使用临时笔记库与临时账号，不触碰真实数据
npm run test:performance   # 性能与实时更新回归，输出预热后 9 次请求的中位耗时
```

回归覆盖首次初始化、会话与限速、路径穿越与符号链接隔离、附件权限、编辑版本冲突、分享范围与撤销、UTF-8 分块传输、移动端手势与缩放策略、页面缓存复用与失效。性能测试使用合成库（502篇笔记、500 张图片），其结果不代表真实设备表现。

浏览器模拟不能替代真机验收：缩放拦截、手势返回、辅助功能需在真实 iOS Safari 上确认。

## 数据与安全

- 所有笔记、搜索、附件、页面均需登录，公开路径仅有图标等静态资源
- 写入与删除接口要求已登录会话并校验 `Origin`
- 分享链接使用 128 位随机熵，仅暴露该文档内引用的媒体；已被访客保存的内容无法撤回
- 登录有限速；游客会话独立限速与会话上限，不影响管理员会话
- 路径穿越与软链越界按realpath 双重校验拦截

## 许可

[MIT](LICENSE)。`public/vendor/` 下的第三方库保留各自许可证。
