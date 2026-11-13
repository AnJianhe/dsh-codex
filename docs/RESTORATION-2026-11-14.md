# 2026-11-14 恢复记录

## 坐标

- 完整恢复前备份：`backup-pre-restore-2026-11-14`（含原有客户端文件删除）。
- 恢复基线：`6d0470f`，2026-11-10 21:38，PKCE 登录端口 1456。
- 未采用当天稍后的 device-code 登录切换；后续历史记录了该路径的 403。
- GitHub：`goodjin/dsh-codex`，私有仓库。私有仓库安装需要有权限的 GitHub 账号。

## 从基线保留与修复

保留 10 号的客户端界面、PKCE 登录和模型行架构。补入经过回归测试的 Responses 请求、工具 schema、工具调用块和历史回传修复；删除与 TSX 同名的旧 TS 客户端入口，避免产物覆盖。补齐两个宿主子路径导出，Git 安装通过 prepare 构建客户端。

模型 list/resolve/prepare 使用同一份能力描述，裸模型 ID 不再丢失 reasoning/context；不强行指定 high、不伪造 adapterDefaults、不覆盖用户选择。

## 验证

- 56 项单元/模拟流测试通过，含工具调用及结果回传、多块索引、完整最终块、模型能力一致性。
- 类型检查与客户端构建通过。
- 桌面 0.2.2-rc.1、CLI 0.2.1-rc.2 声明行检查通过。
- `scripts/check-host-contract.mjs` 使用两个真实宿主的 LlmRuntime.prepareCall 验证默认/low/high、拒绝未知强度、保留 context。
- 客户端降级激活检查通过。
- 77 个原会话工具定义的最小真实请求：HTTP 200、回复 OK、0 次工具调用。不发送会话正文。

这些检查不等于已完成用户原会话的完整任务。

## 独立的模型切换问题

会话 `session-6c4f7a0f-420c-40d7-84ea-502c932f9256` 的 reasoning mismatch 在适配器调用之前发生：旧 ACP 路由拒绝后台压缩，Superpowers 的 `model-switch-guard` 回退从旧请求头复制 high，而当前模型选择未指定强度。真实宿主拒绝这一变更。

此问题属于 dsh-superpowers 的切换回退逻辑，不在本次 Codex 仓库改动中处理。不能宣称恢复 Codex 即修复了该旧会话；应在对应仓库单独修复并验证。不要直接修改会话持久化日志。
