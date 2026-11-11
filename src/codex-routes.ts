/**
 * Codex 宿主路由：会话状态、模型清单、登录。
 *
 * GET /acp-codex/session → 登录状态
 * GET/POST /acp-codex/models → 模型清单
 * POST /acp-codex/login → 启动 OAuth 登录流程（PKCE）
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { loadCredential } from './codex/auth.ts'
import { loadCatalog } from './codex/catalog.ts'
import { startCodexLogin } from './codex/login.ts'

export const name = 'acp-codex-routes'
export const inject = ['webServer', 'connection']

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

function send(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}

/**
 * 注册 Codex 宿主路由。
 */
export function apply(ctx: RouteContext): void {
  ctx.effect(() => {
    // GET /acp-codex/session — 登录状态
    ctx.webServer.register({
      kind: 'exact',
      path: '/acp-codex/session',
      async handler(req, res) {
        const admission = ctx.connection.admit(req)
        if ('rejection' in admission) { res.writeHead(admission.rejection); res.end('unauthorized'); return }
        if (req.method !== 'GET') { res.writeHead(405, { Allow: 'GET' }); res.end('method not allowed'); return }
        try {
          const cred = await loadCredential()
          send(res, { ok: true, signedIn: cred !== undefined })
        } catch {
          send(res, { ok: false, error: '读取凭据失败' })
        }
      },
    })

    // GET /acp-codex/models — 模型清单
    ctx.webServer.register({
      kind: 'exact',
      path: '/acp-codex/models',
      async handler(req, res) {
        const admission = ctx.connection.admit(req)
        if ('rejection' in admission) { res.writeHead(admission.rejection); res.end('unauthorized'); return }
        if (req.method !== 'GET') { res.writeHead(405, { Allow: 'GET' }); res.end('method not allowed'); return }
        try {
          const catalog = await loadCatalog()
          send(res, {
            ok: true,
            models: catalog.map(m => ({
              id: m.id,
              name: m.name,
              contextWindow: m.contextWindow,
              efforts: m.efforts,
            })),
          })
        } catch {
          send(res, { ok: false, error: '读取模型清单失败' })
        }
      },
    })

    // POST /acp-codex/login — 启动 OAuth 登录
    ctx.webServer.register({
      kind: 'exact',
      path: '/acp-codex/login',
      async handler(req, res) {
        console.error('[codex-routes] login handler called', req.method)
        const admission = ctx.connection.admit(req)
        if ('rejection' in admission) { res.writeHead(admission.rejection); res.end('unauthorized'); return }
        if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }); res.end('method not allowed'); return }
        try {
          console.error('[codex-routes] calling startCodexLogin')
          const { url } = await startCodexLogin()
          console.error('[codex-routes] success')
          send(res, { ok: true, url })
        } catch (err) {
          console.error('[codex-routes] error:', err instanceof Error ? err.message : String(err))
          send(res, { ok: false, error: err instanceof Error ? err.message : String(err) })
        }
      },
    })
  })
}
