import { describe, it, expect, vi, beforeEach } from 'vitest'
import { updateQuota, getQuota, registerQuotaRoute } from '../src/codex/quota.ts'

describe('quota cache and route', () => {
  it('stores and returns quota from headers', () => {
    updateQuota({ 'x-codex-plan-type': 'pro', 'x-codex-primary-used-percent': '55' })
    const q = getQuota()
    expect(q).toBeDefined()
    expect(q!.planType).toBe('pro')
    expect(q!.primaryPercent).toBe(55)
  })

  it('registers a GET route', () => {
    const registered: { path: string }[] = []
    const ctx = {
      effect: (fn: () => unknown) => fn(),
      webServer: { register: (route: { path: string }) => { registered.push(route); return () => {} } },
    }
    registerQuotaRoute(ctx)
    expect(registered).toHaveLength(1)
    expect(registered[0]!.path).toBe('/acp-codex/quota')
  })
})
