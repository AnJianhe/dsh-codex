/**
 * Codex 宿主路由：会话状态、模型清单、登录。
 *
 * GET /acp-codex/session → 登录状态
 * GET/POST /acp-codex/models → 模型清单
 * POST /acp-codex/login → 启动 OAuth 登录流程（PKCE）
 */

import { loadCredential } from './codex/auth.ts'
import { loadCatalog } from './codex/catalog.ts'
import { startCodexLogin } from './codex/login.ts'

/**
 * 注册 Codex 宿主路由。
 */
export function registerCodexRoutes(ctx: {
  effect: (fn: () => unknown) => unknown
  webServer: { register: (route: { path: string; method: string; handler: () => unknown }) => () => void }
}): void {
  ctx.effect(() => {
    // GET /acp-codex/session — 登录状态
    ctx.webServer.register({
      path: '/acp-codex/session',
      method: 'GET',
      handler: async () => {
        const cred = await loadCredential()
        if (cred === undefined) {
          return { signedIn: false }
        }
        return { signedIn: true }
      },
    })

    // GET /acp-codex/models — 模型清单
    ctx.webServer.register({
      path: '/acp-codex/models',
      method: 'GET',
      handler: async () => {
        const catalog = await loadCatalog()
        return {
          models: catalog.map(m => ({
            id: m.id,
            name: m.name,
            contextWindow: m.contextWindow,
            efforts: m.efforts,
          })),
        }
      },
    })

    // POST /acp-codex/login — 启动 OAuth 登录
    ctx.webServer.register({
      path: '/acp-codex/login',
      method: 'POST',
      handler: async () => {
        try {
          const { url } = await startCodexLogin({
            openUrl: (u: string) => {
              import('node:child_process').then(({ exec }) => {
                exec(`open "${u}"`)
              }).catch(() => {
                console.log(`[codex] 请在浏览器打开: ${u}`)
              })
            },
          })
          return { ok: true, url }
        } catch (err) {
          return {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          }
        }
      },
    })
  })
}
