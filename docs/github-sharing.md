# GitHub 静态分享

分享目标为 `https://github.com/lrwei91/Share`，页面由 GitHub Pages 的 `main` 分支根目录托管。

点击分享时，Atlas 将选中文档导出到 `documents/<分享标识>/`：

- `document.md`：去掉 YAML 元数据后的 Markdown 正文。
- `index.html`：使用 Atlas 阅读器渲染并清理后的静态页面，不请求 Atlas API。
- `assets/`：仅包含文档已解析引用的本地图片和视频，使用相对地址。

链接固定为 `https://lrwei91.github.io/Share/documents/<分享标识>/`。桌面端“更新并复制分享链接”、移动端复制分享会重新导出当前文档；普通保存文档不会自动更新已发布快照。外部图片和视频保留原地址，仍依赖对应来源。

现有本机分享链接继续兼容；再次分享后旧入口跳转到静态页面。没有自动批量上传或迁移知识库。取消分享及删除已分享文档时，先提交远端导出文件的删除，再清除本地分享状态。Pages 生效有延迟，Git 历史及第三方副本不因取消而清除。

## 运行条件

服务进程的 PATH 必须能够找到 `git` 和已登录的 `gh`，GitHub 账号须有 Share 仓库写权限。凭据由 GitHub CLI 管理，不写入项目或分享文件。常驻服务安装器会保存当前 PATH。

`ATLAS_SHARE_REPO` 可覆盖 Git 远端地址，`ATLAS_SHARE_URL` 可覆盖静态站点根地址。默认分别为上述 Share 仓库及 Pages 地址。本地导出仓库在 `ATLAS_STATE_DIR/share-repository`，和账户、分享状态一起位于忽略的私有状态目录中。地址改变时需人工检查已有缓存与发布链接，程序不会重置远端或强制推送。

单附件最大 90 MB，合计最大 250 MB。推送成功并核对远端提交后才写入分享状态；失败时保留旧状态。失败提交可在下一次分享时重试。主机代码和本地状态不会被上传到 Share。

## 验证

`npm test` 包含 `share-test.js`，使用临时本地 bare 仓库验证静态导出、媒体范围、HTML 清理、标题跳转、提交、更新、推送失败重试和撤销，不把测试文档推送到真实 GitHub 仓库。旧分享的鉴权、媒体范围及迁移回归仍由 `auth-test.js` 验证。
