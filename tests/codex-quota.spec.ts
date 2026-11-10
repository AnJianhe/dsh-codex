import { describe, it, expect } from 'vitest'
import { updateQuota, getQuota } from '../src/codex/quota.ts'

describe('quota cache', () => {
  it('stores and returns quota from headers', () => {
    updateQuota({ 'x-codex-plan-type': 'pro', 'x-codex-primary-used-percent': '55' })
    const q = getQuota()
    expect(q).toBeDefined()
    expect(q!.planType).toBe('pro')
    expect(q!.primaryPercent).toBe(55)
  })
})
