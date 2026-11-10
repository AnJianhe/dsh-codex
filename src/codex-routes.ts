/**
 * Codex 宿主路由：会话状态与模型清单。
 *
 * GET /acp-codex/session → 登录状态
 * GET/POST /acp-codex/models → 模型清单
 */

import { loadCredential } from './codex/auth.ts'
import { loadCatalog } from './codex/catalog.ts'

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
  })
}
