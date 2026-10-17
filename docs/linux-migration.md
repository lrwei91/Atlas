# Atlas 服务器迁移

目标：Linux 服务器运行 Atlas，本机保留 iCloud/Obsidian 主库；两端仅同步
`notes/`、`resources/` 和 Atlas 的 `.trash/`，网页编辑也同步回本机。
目标公网入口为 `https://note.lrwei91.cn`；原入口保留至新端验收完成。

本文说明部署流程和模板；当前服务器部署已完成，公网域名尚未切换。

## 目录与进程

| 路径 | 内容 |
| --- | --- |
| `/opt/atlas` | 当前工作区的程序与静态资源，不包含 `.local/` 或 `node_modules/` |
| `/srv/atlas/vault` | 笔记、附件和库内回收站 |
| `/var/lib/atlas/state` | `admin.json` 与新分享的 `shares.json` |
| `/var/lib/atlas/syncthing` | 独立同步实例配置、证书和数据库 |
| `/etc/atlas/atlas.env` | 环境变量，权限 0600 |

Atlas 和同步进程使用专用 `atlas` 用户。模板假定 Node 位于 `/usr/local/bin/node`、
Syncthing 位于 `/usr/local/bin/syncthing`；安装时必须按服务器实际路径核对。
程序只监听 `127.0.0.1:4317`，Caddy 提供 HTTPS。
为 Caddy 服务设置 `ATLAS_DOMAIN=note.lrwei91.cn`，Atlas 的环境变量使用
`deploy/atlas.env.example` 中相同的 HTTPS 地址。

`atlas.service` 在启动前要求已有管理员文件，防止数据没迁完就开放首次初始化。
原管理员文件通过受保护的 SSH 通道复制，内容不得进入终端输出或仓库。
原分享状态已按用户要求清空；分享仅由 Atlas 服务器提供，不复制 GitHub 凭据。
会话不持久化，迁移后需重新登录。

## 双向同步

采用 Atlas 专用 Syncthing 实例，不复用或改写其他项目的同步配置。
分别创建三个 send-receive 文件夹：`notes`、`resources`、`.trash`。
不共享整个知识库根目录，不同步 `.git/`、`.obsidian/`、Atlas 程序、
登录状态、Cloudflare 凭据或同步实例的证书。

两端开启文件版本保留，保留冲突副本；并发编辑后由用户选择合并内容。
同步状态未到达 Up to Date 前，不能宣称两端一致。
同步版本保留处理的是从另一端收到的变更，不能替代独立备份。
首次配对使用空的服务器目录；同步完整性确认前，Atlas 仅供私有验证。
排除 `.DS_Store` 和 `.icloud` 占位文件，检查本机文件确实可读后再同步。

GUI/API 和同步协议仅监听回环地址，通过 SSH 转发连接；服务器不开放公网同步端口，
关闭不需要的全局发现、局域网发现、NAT 穿透和公共中继，使用指定服务器地址。
只接受核对过的两端设备 ID。

## 执行顺序

1. 确认 SSH 身份和主机指纹，读取系统、磁盘、已有进程与防火墙状态。
2. 备份本机笔记与状态，记录文件数和哈希；保留原服务和 Cloudflare Tunnel。
3. 安装所需运行时，建立专用用户与目录，传输程序及管理员状态；分享状态使用空文件。
4. 配对同步实例，等待笔记和附件同步完成；核对文件数、哈希和中文路径。
5. 安装 systemd 单元，先经 SSH 转发验证登录、目录、搜索、附件与视频 Range。
6. 通过临时测试笔记验证本机到服务器、网页编辑回本机、删除回收站和冲突保留。
7. 验证服务器站内分享、附件隔离和撤销；旧分享全部失效，不做旧格式迁移。
8. 确认域名备案、HTTPS 与 DNS 修改权限，配置 Caddy 后再切换域名。
9. 从公网验证原域名、登录、附件、分享及同步，最后停用 Atlas 专属 CF 隧道。

广州是中国大陆节点，公网网站需满足火山引擎备案条件；未确认备案前不切换公网入口。
若尚未具备备案条件，可通过 SSH 私有转发测试，保留原公网服务。

## 回退

切换前冻结旧端的网页写入，等待同步一致并备份。迁移期间避免两套 Atlas 同时写入。
需要回退时先暂停新端写入与同步，保全新端变更，再恢复原 DNS 和本机服务；
不得用旧快照覆盖迁移后新增内容。确认回退后再合并变更并恢复同步。

## 备案前私有运行

服务器运行时设置 `ATLAS_PUBLIC_URL=http://127.0.0.1:4318`，本机 SSH 将
`127.0.0.1:4318` 转发到服务器 `127.0.0.1:4317`。本机访问
`http://127.0.0.1:4318/login`；这个地址生成的分享链接只能用于本机私有验证，
不能作为公网分享链接。备案完成后，再将运行时地址改成目标 HTTPS 域名并重启服务。

本机独立 LaunchAgent：`com.lrwei91.atlas-server-access` 负责 SSH 转发，
`com.lrwei91.atlas-sync` 负责同步。SSH 配置与专用密钥放在 `~/.ssh/`，
避免 macOS 后台 SSH 进程读取 Documents 内的配置被隐私权限阻断。

## 来源

- [Syncthing 同步与冲突](https://docs.syncthing.net/users/syncing.html)
- [Syncthing 文件版本保留](https://docs.syncthing.net/users/versioning.html)
- [Syncthing 防火墙](https://docs.syncthing.net/users/firewall.html)
- [火山引擎备案云资源要求](https://docs.volcengine.com/docs/Record/Preparingtofilecloudresources?lang=zh)
