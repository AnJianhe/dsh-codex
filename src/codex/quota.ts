/**
 * Codex 配额缓存与路由。
 *
 * 每次推理响应后从 x-codex-* 头更新缓存，GET /acp-codex/quota 路由对外提供。
 */

import type { CodexQuota } from './endpoints.ts'
import { parseQuotaHeaders } from './endpoints.ts'

/** 模块级配额缓存。 */
let cachedQuota: CodexQuota | undefined
let cachedAt = 0

/** 缓存 TTL：30 秒。 */
const CACHE_TTL_MS = 30_000

/**
 * 更新配额缓存（每次推理响应后调用）。
 * 接受原始响应头，内部解析 x-codex-* 字段。
 */
export function updateQuota(headers: Record<string, string>): void {
  const quota = parseQuotaHeaders(headers)
  if (quota !== undefined) {
    cachedQuota = quota
    cachedAt = Date.now()
  }
}

/**
 * 获取当前缓存的配额，如果过期则返回 undefined。
 */
export function getQuota(): CodexQuota | undefined {
  if (cachedQuota === undefined) return undefined
  if (Date.now() - cachedAt > CACHE_TTL_MS) return undefined
  return cachedQuota
}

/**
 * 注册配额路由。
 * GET /acp-codex/quota → { ok: true, quota } 或 { ok: false, error: '尚无推理数据' }
 */
export function registerQuotaRoute(ctx: {
  effect: (fn: () => unknown) => unknown
  webServer: { register: (route: { path: string; method: string; handler: () => unknown }) => () => void }
}): void {
  ctx.effect(() => {
    ctx.webServer.register({
      path: '/acp-codex/quota',
      method: 'GET',
      handler: () => {
        const quota = getQuota()
        if (quota === undefined) {
          return { ok: false, error: '尚无推理数据' }
        }
        return { ok: true, quota }
      },
    })
  })
}
