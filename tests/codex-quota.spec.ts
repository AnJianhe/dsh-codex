import { afterEach, describe, it, expect, vi } from 'vitest'
const auth = vi.hoisted(() => ({ current: { accessToken: 'fake', accountId: 'account-a' } as {accessToken: string; accountId: string} | undefined }))
vi.mock('../src/codex/auth.ts', () => ({ loadCredential: async () => auth.current }))
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.resetModules() })
const payload = { plan_type: 'pro', rate_limit: { primary_window: { used_percent: 42, limit_window_seconds: 18000, reset_at: 2000000000 } } }

describe('official quota cache', () => {
  it('deduplicates requests and retains stale snapshots on failures', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000000); auth.current = { accessToken: 'fake', accountId: 'a' }
    const fetcher = vi.fn(async () => new Response(JSON.stringify(payload)))
    vi.stubGlobal('fetch', fetcher)
    const { readQuota } = await import('../src/codex/quota.ts')
    const replies = await Promise.all([readQuota(),readQuota()])
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(replies[0]).toMatchObject({ ok: true, stale: false, snapshot: { source: 'official-usage', quota: { primaryPercent: 42, primaryWindowMinutes: 300 } } })
    vi.setSystemTime(1060001); fetcher.mockRejectedValueOnce(new TypeError('network down'))
    expect(await readQuota()).toMatchObject({ ok: true, stale: true, snapshot: replies[0]?.snapshot, error: expect.any(String) })
  })
  it('clears old account data on logout and never substitutes zero for missing fields', async () => {
    auth.current = { accessToken: 'fake', accountId: 'a' }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload))))
    const { readQuota } = await import('../src/codex/quota.ts')
    await readQuota(); auth.current = undefined
    expect(await readQuota()).toEqual({ ok: false, stale: false, error: '未登录 Codex' })
    auth.current = { accessToken: 'fake', accountId: 'b' }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ plan_type: 'plus' }))))
    expect((await readQuota()).snapshot?.quota).toEqual({ planType: 'plus' })
  })
  it('ignores an old account request finishing after a switch', async () => {
    auth.current = { accessToken: 'fake', accountId: 'a' }
    let resolve!: (response: Response) => void
    const first = new Promise<Response>(r => { resolve = r })
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce(new Response(JSON.stringify({plan_type:'plus'}))))
    const { readQuota } = await import('../src/codex/quota.ts')
    const previous = readQuota(); await Promise.resolve(); await Promise.resolve()
    auth.current = { accessToken: 'fake', accountId: 'b' }; await readQuota()
    resolve(new Response(JSON.stringify(payload))); await previous
    expect((await readQuota()).snapshot?.quota).toEqual({planType:'plus'})
  })
  it('retains header snapshots after 30s and marks an elapsed reset stale', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000000)
    auth.current = { accessToken: 'fake', accountId: 'a' }
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const { updateQuota, getQuota, readQuota } = await import('../src/codex/quota.ts')
    updateQuota({'x-codex-primary-used-percent':'0','x-codex-primary-reset-after-seconds':'30'}, 'a')
    vi.setSystemTime(1031000)
    expect(getQuota()?.primaryPercent).toBe(0)
    expect(await readQuota()).toMatchObject({stale:true,snapshot:{quota:{primaryResetAt:1030}}})
  })
})
