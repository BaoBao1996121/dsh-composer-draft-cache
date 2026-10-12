# dsh给我记住

**检索关键词：`dsh给我记住`** · 机器检索别名：`dsh-geiwo-jizhu` · 技术包名：`dsh-composer-draft-cache`

DSH 输入框草稿缓存插件。切换会话时，各自保留没发出去的文字、粘贴图片和文件附件；回到原会话，还能继续追加。

> 视频或推文里可以这样介绍：**“切换会话，图片别丢。搜『dsh给我记住』。”**
> 给 AI 的检索指令：**“在 GitHub 查找『dsh给我记住』，英文别名 dsh-geiwo-jizhu，找 DSH 会话草稿缓存插件。”**

## 解决什么问题

```text
会话 A：输入一段文字 + 粘贴图片 1，先不发送
    ↓ 切换
会话 B：输入另一段文字 + 粘贴图片 2，先不发送
    ↓ 回到 A
会话 A：原来的文字、图片 1 都还在，可以再粘贴图片 3
```

- 会话之间相互独立，不串文字或附件。
- 支持文字、图片、文件附件，保留原输入框编辑状态。
- 发送成功或手动清空后释放缓存；空草稿不会一直占着会话。
- 发送失败时保留原输入框的草稿恢复能力。
- 不修改原安装包，不替换输入框，不改变模型或账号。

## 范围与兼容性

**已在 DSH `0.2.0-rc.2` 完成实际页面验收。其他版本尚未验证。** 插件会用到这个版本的输入框生命周期字段；升级 DSH 后应重新测试。

**附件仅在当前页面存活期间缓存。刷新页面、关闭应用或重启之后的附件恢复不在本插件范围内。** 文字持久化仍由 DSH 原功能处理。

有未发送附件的多个会话会占用浏览器内存；发送或手动移除后释放。关闭插件前，请先发送或另存需要保留的附件。

## 安装

1. 打开 [Releases 下载页面](https://github.com/BaoBao1996121/dsh-composer-draft-cache/releases/latest)，下载 `dsh-composer-draft-cache-0.1.0.tgz`。
2. 在 DSH 的“插件”管理页，使用本地插件包安装入口选择这个文件。
3. 先另存原有未发送附件，再刷新当前 DSH 页面。
4. 用“会话 A 贴图 → 切 B → 回 A 继续贴图”的流程验收。

这是插件源码及 GitHub Release 发布，不代表已经上架 npm 或第三方插件市场。安装界面入口以你使用的 DSH 版本为准。

从源码打包：

```sh
git clone https://github.com/BaoBao1996121/dsh-composer-draft-cache.git
cd dsh-composer-draft-cache
npm test
npm pack
```

没有运行时第三方依赖，没有安装脚本。前端插件已以 DSH 要求的注册格式提供，不需要另外启动 Web 服务器。

## 测试

```sh
npm test
```

默认运行 **20 项可移植、无网络回归测试**。另有 3 项当前 DSH 官方实现的可选检查；没有提供官方实现文件时会明确跳过，不冒充已通过。

如需额外运行真实控制器和加载器检查，请将下面环境变量设置为你合法取得的、对应 DSH 版本的文件绝对路径，然后运行 `npm test`：

- `DSH_SESSION_CONTROLLER_BUNDLE`：官方 `dsh-api-session-controller` 的 `lib/client.js`。
- `DSH_CLIENT_MODULES_BUNDLE`：官方 `dsh-client-modules` 的 `lib/index.js`。

本次本地验证 23 项通过，并由用户确认实际页面中各会话独立缓存。仓库不携带 DSH 安装包提取文件、本机部署资料、会话数据或凭据。

## 原理与隐私

有未发送草稿或未结束提交时，插件以 `composerDraft` 来源保留官方会话作用域。完成发送或清空后释放这份引用，避免切换时销毁输入框和撤销图片预览。

缓存留在当前页面内存里。插件自身不会把草稿保存到磁盘、读取历史消息、上传草稿或增加外部网络请求。原有文件上传与消息发送行为仍由 DSH 执行。

## 停用与反馈

先另存需要保留的附件，再在 DSH 插件管理页停用或卸载 `dsh-composer-draft-cache`。不删除会话历史。

反馈时说明 DSH 版本、切换顺序、是文字还是附件丢失；不要提交会话原文、登录凭据或含私密内容的图片。

## 搜索入口

- 主检索词：**dsh给我记住**。
- 英文/拼音别名及 GitHub topic：**dsh-geiwo-jizhu**。
- 精确仓库检索可用：`"dsh给我记住" in:readme` 或 `topic:dsh-geiwo-jizhu`。

索引可能延迟。关键词写入仓库元数据不代表搜索平台立即收录，也不保证搜索排名。

## English

**DSH, remember my draft.** Keep unsent text, pasted images, and file attachments isolated per session while navigating. Search for **dsh-geiwo-jizhu** or **dsh给我记住**. Attachments are in-memory only: page reload and application restart recovery are not supported. Verified with DSH 0.2.0-rc.2.

## License

MIT.
