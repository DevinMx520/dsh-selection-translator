# 发布清单

当前状态：仓库已 `git init`、已提交到 `main`、已添加 `origin`，只差在 GitHub 建仓库并 push。

- 仓库：https://github.com/DevinMx520/dsh-selection-translator
- 包名：`dsh-selection-translator`
- 版本：`0.1.0`

## 1. 创建 GitHub 仓库

在 https://github.com/new 新建 **Public** 仓库，名称必须是 `dsh-selection-translator`，**不要**勾选自动生成 README / .gitignore / LICENSE（本地已经有）。

## 2. 推送代码

```powershell
cd D:\deepseek-harness\default-workspace\dsh-selection-translator
git push -u origin main
```

首次推送会弹出 Git Credential Manager 的浏览器登录，按提示授权 GitHub 即可。

## 3. 发布到 npm（可选，但推荐）

只发 GitHub 也能用，只是别人需要 clone 后从本地目录安装；发布到 npm 后插件管理器可以直接按包名安装。

```powershell
npm login
npm pack --dry-run   # 检查实际会发布的文件
npm publish          # 未占用包名，无需 --access public
```

发布后验证：

```powershell
npm view dsh-selection-translator version
```

## 4. 安装方式

- **npm**：Harness 插件管理器中安装 `dsh-selection-translator`。
- **本地/源码**：`git clone` 后用插件管理器从本地目录安装。

## 5. 后续发布

1. 修改 `package.json` 的 `version`（例如 `0.1.1`）。
2. `git add . && git commit -m "chore: release 0.1.1" && git push`。
3. `npm publish`。
4. 如果 GitHub 仓库地址或用户名变了，同步修改 `repository` / `homepage` / `bugs`。

## 注意

- `client.js` 里 `window.__ModuleLoader__.load({ id: ... })` 的 id **必须等于** `package.json` 的 `name`；`cordis.patch.yml` 中本插件那一行的 `name` 也必须一致。改包名时三处一起改。
- 不要提交 `node_modules/`、`*.log`、个人 profile 配置。
- 插件会挂载 `@deepseek-ai/dsh-experimental-translator`；如果用户同时启用了其他也挂载 translator 的 bundle，可能冲突，README 已注明。
- 翻译会把选中文本发往 Bing 匿名端点，README 已注明隐私影响。
- 如果 GitHub 账号没有添加提交邮箱 `2080133287@qq.com`，提交不会关联到你的头像；可在 GitHub 的 Email settings 里添加该邮箱。
