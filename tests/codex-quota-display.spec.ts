import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { createRequire } from 'node:module'
import type { ReactElement } from 'react'
const { renderToStaticMarkup } = createRequire(import.meta.url)('react-dom/server') as { renderToStaticMarkup(element: ReactElement): string }
// Host-provided browser icons are replaced for the Node renderer.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconDatabaseOutlineRegular: () => createElement('svg'),
  IconGaugeOutlineRegular: () => createElement('svg'),
}))
import { CodexQuotaDock, quotaLabels, registerQuotaDock } from '../src/client/quota-pill.tsx'
import { parseQuotaHeaders, parseUsageQuota } from '../src/codex/endpoints.ts'
describe('official quota values and display', () => {
  it('ignores malformed values and unrelated headers, preserves real zero', () => {
    expect(parseQuotaHeaders({'x-codex-promo-message':'hello'})).toBeUndefined()
    expect(parseQuotaHeaders({'X-Codex-Primary-Used-Percent':'0','x-codex-credits-balance':'NaN','x-codex-secondary-used-percent':'','x-codex-primary-reset-at':'1234'})).toEqual({primaryPercent:0,primaryResetAt:1234})
    expect(parseUsageQuota({rate_limit:{primary_window:{used_percent:Infinity}},credits:{balance:'oops'}})).toBeUndefined()
  })
  it('uses official window lengths and marks cached data without claiming a reset', () => {
    const labels = quotaLabels({ok:true,stale:true,snapshot:{source:'official-usage',updatedAt:1000,quota:{primaryPercent:100,primaryWindowMinutes:300,secondaryPercent:12.5,secondaryWindowMinutes:10080}}})
    expect(labels.map(v=>v.label)).toEqual(['5小时 100%','7天 12.5%'])
    expect(labels[0]?.title).toContain('重置时间未知')
    expect(labels.every(v => v.title.includes('待刷新') && v.title.includes(new Date(1000).toLocaleString()))).toBe(true)
    expect(quotaLabels({ok:false,stale:false,error:'未登录 Codex'})[0]?.label).toBe('未登录 Codex')
  })
  it('only shows the Direct Codex provider and survives unavailable directory services', () => {
    expect(renderToStaticMarkup(createElement(CodexQuotaDock, {useCodexQuotaDirectory: selector=>selector({current:{provider:'acp:acp-codex'}})}))).toBe('')
    expect(renderToStaticMarkup(createElement(CodexQuotaDock, {useCodexQuotaDirectory: selector=>selector({current:{provider:'acp:acp-codex-global'}})}))).toContain('data-codex-quota')
    let registration: any
    registerQuotaDock({slots:{inject:(_key,cb)=>cb(),register:(options)=>{registration=options}},modelDirectories:{directoryFor(){throw new Error('inactive')}}})
    expect(registration.name).toBe('conversation.composer.dock')
    expect(registration.inject('session')).toEqual({hooks:{}})
  })
})
