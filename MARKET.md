# 提交到插件市场

DSH 插件市场的目录来自 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)，收录方式是向那个仓库提一个**只包含一个 YAML 文件**的 PR。

## 1. 前置条件

- [ ] 仓库已公开：https://github.com/DevinMx520/dsh-selection-translator
- [ ] `package.json` 已声明 `dsh.bundle`（本仓库已满足）
- [ ] 仓库创建满 **1 天**（CI 自动检查；今天是 2026-10-18，最早明天再提）
- [ ] 给仓库加 `dsh-plugin` topic：仓库首页 → About 右侧齿轮 → Topics 填 `dsh-plugin`

## 2. 要提交的条目

在 awesome-dsh-plugin 仓库里新建文件：

`data/plugins/DevinMx520__dsh-selection-translator.yml`

内容：

```yaml
url: https://github.com/DevinMx520/dsh-selection-translator
name: DevinMx520/dsh-selection-translator
category: ui
description:
  en: "Adds a right-click menu to selected text in the Harness Web UI that replaces it with a Simplified Chinese translation in place, and restores the original on a second right-click."
  zh: "在 Harness Web UI 中为选中文字添加右键翻译菜单，可就地替换为简体中文译文，再次右键还原原文。"
```

注意：

- `url` 必须与仓库地址完全一致。
- 只加这一个文件，**不要**手工编辑 README（README 由脚本生成）。
- 描述里不要写营销词，只写插件实际做的事。

## 3. 提 PR 的步骤（网页版最省事）

1. 打开 https://github.com/awesome-dsh-plugin/awesome-dsh-plugin
2. 点 `Fork` 建一个自己的副本。
3. 在自己的副本里进入 `data/plugins/` → `Add file` → `Create new file`。
4. 文件名填 `DevinMx520__dsh-selection-translator.yml`，粘贴上面的内容。
5. `Commit changes` 到新分支 → `Contribute` → `Open pull request`。
6. PR 标题可以写：`Add dsh-selection-translator`。

CI 会检查条目数量、`dsh.bundle`、仓库年龄和格式；通过后维护者会读源码并合并，站点和插件市场通常一天内收录。

## 4. 可选但推荐

- **发布 npm**：市场安装会优先用预构建包，免去构建授权步骤；收录本身不依赖 npm。发布后 `package.json` 的 `repository` 必须指回本仓库（已填好）。
- **加截图**：在 README 里放一张右键菜单截图（GitHub 托管的图片），市场会从 README 自动抽取展示。截图对收录成功率帮助很大。
- **GitHub Release tarball**：仓库可源码安装（纯 JS、无构建脚本），所以不是必需。

## 5. 以后更新

改完代码后正常 `git push` 即可，市场会按 npm 版本或仓库 commit 检测更新。条目本身只有描述需要更新时才改 YAML。
