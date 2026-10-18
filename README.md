# 划词翻译 · DSH Selection Translator

在 **DeepSeek Harness Web UI** 里选中文字后右键，菜单中除了「复制」还会多出「翻译成中文」。点击后，选中的英文会在原位置直接被中文替换；再次右键被翻译的文字，菜单变为「取消翻译」，点击即可还原原文。

![plugin icon](icon.svg)

## 功能

- 选中文字右键 → **复制 / 翻译成中文**
- 翻译结果**就地覆盖**选区，不弹窗、不新增消息
- 被翻译的片段带点状下划线，再次右键 → **取消翻译** 还原原文
- 中英混合选区会整体翻译成中文
- 菜单文案固定为中文（不跟随界面语言）

## 安装

发布到 npm 后，在 Harness 的插件管理器中安装：

```
dsh-selection-translator
```

本地开发时，克隆仓库后在插件管理器中从本地目录安装，或把该目录加为 profile 的依赖。

安装后会同时挂载 Harness 自带的 `@deepseek-ai/dsh-experimental-translator`，用于提供匿名翻译服务，无需账号或 API Key。

## 使用

1. 在对话、工具输出或任意可选中的文本上拖选内容。
2. 在选区上点右键，选择「翻译成中文」。
3. 中文就地覆盖原文。
4. 对中文片段再次右键，选择「取消翻译」恢复原文。

## 隐私

选中的文本会离开本机，发往 Harness 的匿名翻译提供方（当前为 Microsoft Bing 的 Edge 翻译端点）。本插件自身不保存原文或译文，也不会随翻译请求发送会话 ID；翻译由 Harness 的 `translator` 服务完成，结果不落盘。

如果文本涉及敏感信息，请不要使用翻译功能。

## 已知限制

- 按段落/文本节点分别翻译，长文本会自动分段，翻译过程中菜单里显示进度条；极短片段（尤其是被行内代码切开的两段）译文可能不如整段通顺。
- 完整选中的段落会保留段落、标题、列表和行内代码/代码块；加粗、链接等不承载代码语义的内联样式会被拍平。
- 消息被 React 重新渲染（例如流式输出或切换会话）时，翻译片段可能丢失，原文会重新出现；重新翻译即可。
- 插件会插入 `@deepseek-ai/dsh-experimental-translator` 行；如果其他 bundle 也挂载了 translator，可能产生服务冲突。
- 百度翻译的公开接口需要 appid 和签名，本插件没有使用百度。

## 工作原理

- `client.js`：在 `shell.overlay` 槽位注册浮动菜单。Electron 桌面端的「复制」菜单由主进程生成，仅靠 DOM 的 `preventDefault()` 无法压制，因此右键按下时先保存选区再清空选区，让原生菜单没有可显示条目。
  - 完整选中的段落整段翻译，行内代码/代码块用占位符保留并原样放回；不完整的段落按文本节点逐段替换，保留原有 DOM 结构。
  - 长文本按 8 个片段一批发送，菜单里显示进度条；关闭菜单会取消进行中的翻译。
- `index.js`：Host 半注册同源路由 `POST /api/dsh/selection-translator`，调用 Harness 的 `translator` 服务把文本翻译成中文；超过 3500 字符的片段会自动切块翻译后拼接。
- `cordis.patch.yml`：同时挂载 translator 服务和本插件。

## 开发与发布

见 [PUBLISHING.md](PUBLISHING.md)；上架 DSH 插件市场见 [MARKET.md](MARKET.md)。

## License

[MIT](LICENSE)
