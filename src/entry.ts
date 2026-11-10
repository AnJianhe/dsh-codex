/**
 * dsh-codex: Codex 模型行——直接 HTTP 调用 /responses 端点。
 *
 * 复用本地 Codex CLI 的 OAuth 凭据（~/.codex/auth.json），不需要 ACP 子进程、
 * 不需要 WASM 签名。DSH 自己的循环负责工具/审批/编排，这一行只回答「向模型要下一句话」。
 */

export const name = '@goodjin2/dsh-codex'

export function apply(_ctx: unknown, _config: unknown): void {
  // Stub — full implementation in Task 8
}
