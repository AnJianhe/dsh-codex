import { describe, it, expect } from 'vitest'
import { CODEX_RESPONSES_URL, CODEX_UA_VERSION, buildHeaders, parseQuotaHeaders } from '../src/codex/endpoints.ts'
import type { CodexCredential } from '../src/codex/auth.ts'

const cred: CodexCredential = { accessToken: 'tok123', refreshToken: 'rt', accountId: 'acc-123' }

describe('buildHeaders', () => {
  it('includes Authorization, account-id, originator, user-agent', () => {
    const h = buildHeaders(cred)
    expect(h['Authorization']).toBe('Bearer tok123')
    expect(h['chatgpt-account-id']).toBe('acc-123')
    expect(h['originator']).toBe('codex_cli_rs')
    expect(h['user-agent']).toBe(`codex_cli_rs/${CODEX_UA_VERSION}`)
    expect(h['Content-Type']).toBe('application/json')
    expect(h['Accept']).toBe('text/event-stream')
  })
})

describe('parseQuotaHeaders', () => {
  it('extracts quota fields from x-codex-* headers', () => {
    const q = parseQuotaHeaders({
      'x-codex-plan-type': 'pro',
      'x-codex-primary-used-percent': '42',
      'x-codex-primary-window-minutes': '10080',
      'x-codex-primary-reset-after-seconds': '532360',
      'x-codex-secondary-used-percent': '10',
      'x-codex-credits-has-credits': 'False',
    })
    expect(q).toBeDefined()
    expect(q!.planType).toBe('pro')
    expect(q!.primaryPercent).toBe(42)
    expect(q!.primaryWindowMinutes).toBe(10080)
    expect(q!.creditsHasCredits).toBe(false)
  })

  it('returns undefined when no x-codex-* headers present', () => {
    const q = parseQuotaHeaders({ 'content-type': 'text/event-stream' })
    expect(q).toBeUndefined()
  })

  it('handles partial headers gracefully', () => {
    const q = parseQuotaHeaders({ 'x-codex-plan-type': 'plus' })
    expect(q).toBeDefined()
    expect(q!.planType).toBe('plus')
    expect(q!.primaryPercent).toBeUndefined()
  })
})
