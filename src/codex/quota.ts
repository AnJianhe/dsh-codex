import type { IncomingMessage, ServerResponse } from 'node:http'
import { loadCredential } from './auth.ts'
import { buildHeaders, CODEX_USAGE_URL, parseQuotaHeaders, parseUsageQuota, type CodexQuota } from './endpoints.ts'

export const name = 'acp-codex-quota'
export const inject = ['webServer', 'connection']
export type QuotaSnapshot = { quota: CodexQuota; updatedAt: number; source: 'official-usage' | 'official-response' }
export type QuotaReply = { ok: boolean; snapshot?: QuotaSnapshot; stale: boolean; error?: string }
const REFRESH_MS = 60_000
let owner: string | undefined
let snapshot: QuotaSnapshot | undefined
let lastAttempt = -Infinity
let refreshError: string | undefined
let pending: Promise<void> | undefined
let generation = 0
function selectAccount(account: string | undefined): void {
  if (owner === account) return
  owner = account; snapshot = undefined; lastAttempt = -Infinity; refreshError = undefined; pending = undefined; generation++
}
export function updateQuota(headers: Record<string, string>, accountId?: string): void {
  selectAccount(accountId)
  const quota = parseQuotaHeaders(headers)
  if (quota) snapshot = { quota, updatedAt: Date.now(), source: 'official-response' }
}
/** Retain the last official snapshot; callers use readQuota metadata to show freshness. */
export function getQuota(): CodexQuota | undefined { return snapshot?.quota }
export async function readQuota(): Promise<QuotaReply> {
  const credential = await loadCredential()
  selectAccount(credential?.accountId)
  if (!credential) return { ok: false, stale: false, error: '未登录 Codex' }
  if (!pending && Date.now() - lastAttempt >= REFRESH_MS) {
    lastAttempt = Date.now()
    const epoch = generation, startedAt = lastAttempt
    const task = (async () => {
      try {
        const response = await fetch(CODEX_USAGE_URL, { headers: { ...buildHeaders(credential), Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
        if (epoch !== generation) return
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) snapshot = undefined
          throw new Error(response.status === 401 ? 'Codex 登录已过期，请重新登录' : `官方额度读取失败（HTTP ${response.status}）`)
        }
        const quota = parseUsageQuota(await response.json())
        if (epoch !== generation) return
        if (!quota) throw new Error('官方未返回可识别的额度数据')
        // An in-flight usage request must not overwrite a newer inference snapshot.
        if (!snapshot || snapshot.updatedAt <= startedAt) snapshot = { quota, updatedAt: Date.now(), source: 'official-usage' }
        refreshError = undefined
      } catch (error) {
        if (epoch === generation) {
          const known = error instanceof Error && (error.message.startsWith('官方') || error.message.startsWith('Codex 登录'))
          refreshError = known ? error.message : '官方额度暂时无法读取，请稍后重试'
        }
      }
    })()
    pending = task
    void task.finally(() => { if (pending === task) pending = undefined }).catch(() => {})
  }
  await pending
  if (credential.accountId !== owner) return { ok: false, stale: true, error: '账号已切换，等待刷新' }
  const now = Date.now(), q = snapshot?.quota
  const expiredWindow = [q?.primaryResetAt, q?.secondaryResetAt].some(at => at !== undefined && at * 1000 <= now)
  return {
    ok: snapshot !== undefined, ...(snapshot ? { snapshot } : {}),
    stale: snapshot !== undefined && (refreshError !== undefined || now - snapshot.updatedAt > 5 * REFRESH_MS || expiredWindow),
    ...(refreshError ? { error: refreshError } : {}),
  }
}
type RouteContext = {
  effect: (fn: () => unknown) => unknown
  webServer: { register: (route: { kind: 'exact'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> }) => (() => void) | void }
  connection: { admit: (req: IncomingMessage) => { rejection: number } | { peer: unknown } }
}
export function apply(ctx: RouteContext): void {
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/acp-codex/quota', async handler(req, res) {
    try {
      const admission = ctx.connection.admit(req)
      if ('rejection' in admission) { res.writeHead(admission.rejection); res.end('unauthorized'); return }
      const result = await readQuota()
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(result))
    } catch {
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, stale: false, error: '额度服务暂不可用' }))
    }
  } }))
}
