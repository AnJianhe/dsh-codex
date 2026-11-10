import { describe, it, expect } from 'vitest'
import { registerCodexRoutes } from '../src/codex-routes.ts'

describe('registerCodexRoutes', () => {
  it('registers session and models routes', () => {
    const registered: { path: string }[] = []
    const ctx = {
      effect: (fn: () => unknown) => fn(),
      webServer: { register: (route: { path: string }) => { registered.push(route); return () => {} } },
    }
    registerCodexRoutes(ctx)
    const paths = registered.map(r => r.path)
    expect(paths).toContain('/acp-codex/session')
    expect(paths).toContain('/acp-codex/models')
  })
})
