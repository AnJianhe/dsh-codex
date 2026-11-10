# @goodjin2/dsh-codex

DSH 插件：Codex 模型行 — 直接 HTTP 调用 Codex `/responses` 端点，复用本地 Codex CLI 的 OAuth 凭据。

## 安装

在 DSH profile 的 `package.json` 中添加：

```json
{
  "dependencies": {
    "@goodjin2/dsh-codex": "github:goodjin/dsh-codex"
  }
}
```

然后运行 `pnpm install` 并把 `insert` 段合并到 profile 的 `cordis.patch.yml`。

## 前提条件

- 本地已安装 Codex CLI 并完成登录（`codex login`）
- `~/.codex/auth.json` 存在且包含有效凭据

## 功能

- 将 Codex 模型（GPT-6.x、GPT-5.6 系列）作为 DSH 模型行
- 自动 OAuth 凭据读取与刷新
- 从 `~/.codex/models_cache.json` 读取模型目录（带静态回退）
- 配额信息从 `x-codex-*` 响应头提取
- 推理强度折叠（`base[effort]` → 一条 + 强度轴）

## 开发

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build:client
```

## 架构

- `src/codex/` — 凭据管理、目录、请求构建、流解析、配额提取
- `src/modelkit/` — 模型行机器（适配、类型、路由、运行时账本、强度折叠）
- `src/client/` — 浏览器侧设置段

## 许可证

MIT
