/**
 * Codex 配额缓存与路由。
 *
 * 每次推理响应后从 x-codex-* 头更新缓存，GET /acp-codex/quota 路由对外提供。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { CodexQuota } from './endpoints.ts'
import { parseQuotaHeaders } from './endpoints.ts'

export const name = 'acp-codex-quota'
export const inject = ['webServer', 'connection']

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

function send(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}

type RouteContext = {
  effect: (fn: () => unknown) => unknown
  webServer: {
    register: (route: {
      kind: 'exact'
      path: string
      handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
    }) => (() => void) | void
  }
  connection: {
    admit: (req: IncomingMessage) => { rejection: number } | { peer: unknown }
  }
}

export function apply(ctx: RouteContext): void {
  ctx.effect(() => {
    ctx.webServer.register({
      kind: 'exact',
      path: '/acp-codex/quota',
      async handler(req, res) {
        const admission = ctx.connection.admit(req)
        if ('rejection' in admission) { res.writeHead(admission.rejection); res.end('unauthorized'); return }
        const quota = getQuota()
        if (quota === undefined) {
          send(res, { ok: false, error: '尚无推理数据' })
          return
        }
        send(res, { ok: true, quota })
      },
    })
  })
}
