import { useEffect, useState } from 'react'
import type { QuotaReply } from '../codex/quota.ts'

export function quotaLabels(reply: QuotaReply | undefined): { label: string; title: string }[] {
  if (!reply?.snapshot) return [{ label: reply?.error ?? '额度读取中…', title: 'Codex 官方额度；未返回的数据不会按 0 显示' }]
  const { quota: q, updatedAt, source } = reply.snapshot
  const suffix = reply.stale ? ' · 待刷新' : ''
  const detail = `来源：${source === 'official-usage' ? '官方用量接口' : '官方响应头'}；更新：${new Date(updatedAt).toLocaleString()}${q.planType ? `；套餐：${q.planType}` : ''}${reply.error ? `；${reply.error}` : ''}`
  const entries: { label: string; title: string }[] = []
  for (const [fallback, percent, minutes, resetAt] of [
    ['主窗口', q.primaryPercent, q.primaryWindowMinutes, q.primaryResetAt],
    ['次窗口', q.secondaryPercent, q.secondaryWindowMinutes, q.secondaryResetAt],
  ] as const) {
    if (percent === undefined) continue
    const window = !minutes ? fallback : minutes % 1440 === 0 ? `${minutes / 1440}天` : minutes % 60 === 0 ? `${minutes / 60}小时` : `${minutes}分钟`
    entries.push({ label: `${window} 已用 ${percent}%${suffix}`, title: `${detail}${resetAt === undefined ? '；重置时间未知' : `；重置：${new Date(resetAt * 1000).toLocaleString()}`}` })
  }
  if (q.creditsUnlimited === true) entries.push({ label: `积分不限${suffix}`, title: detail })
  else if (q.creditsBalance !== undefined) entries.push({ label: `积分 ${q.creditsBalance}${suffix}`, title: detail })
  if (!entries.length) entries.push({ label: `官方未提供用量数字${suffix}`, title: detail })
  return entries
}

export function CodexQuotaPills({ active = true }: { active?: boolean }) {
  const [reply, setReply] = useState<QuotaReply>()
  useEffect(() => {
    if (!active) return
    let disposed = false
    let busy = false
    const controller = new AbortController()
    async function refresh() {
      if (busy || document.visibilityState === 'hidden') return
      busy = true
      try {
        const response = await fetch('/acp-codex/quota', { signal: controller.signal, cache: 'no-store' })
        if (!response.ok) throw new Error('quota unavailable')
        const next = await response.json() as QuotaReply
        if (!disposed) setReply(next)
      } catch {
        if (!disposed) setReply(previous => ({ ...previous, ok: previous?.snapshot !== undefined, stale: true, error: '额度连接失败' }))
      } finally { busy = false }
    }
    const tick = () => { refresh().catch(() => {}) }
    tick()
    const interval = setInterval(tick, 30_000)
    document.addEventListener('visibilitychange', tick)
    return () => { disposed = true; controller.abort(); clearInterval(interval); document.removeEventListener('visibilitychange', tick) }
  }, [active])
  if (!active) return null
  return <div data-codex-quota="official" aria-label="Codex 官方额度" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: 12 }}>
    <span>Codex</span>
    {quotaLabels(reply).map((item, index) => <span key={index} title={item.title} style={{ padding: '2px 8px', border: '1px solid currentColor', borderRadius: 999, opacity: reply?.stale ? 0.65 : 0.85 }}>{item.label}</span>)}
  </div>
}
type Directory = { current?: { provider?: string } }
type Hook = <T>(selector: (snapshot: Directory) => T) => T
export function CodexQuotaDock({ useCodexQuotaDirectory }: { useCodexQuotaDirectory?: Hook }) {
  const provider = useCodexQuotaDirectory?.(value => value.current?.provider)
  return <CodexQuotaPills active={provider === 'acp:acp-codex-global'} />
}
export function registerQuotaDock(ctx: { slots: { inject(name: string, fn: () => unknown): unknown; register(options: unknown, component: unknown): unknown }; modelDirectories?: { directoryFor(id: string): { store: unknown } } }): void {
  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock', id: 'codex-direct-official-quota', order: 16,
    inject: (sessionId: string) => {
      try {
        const store = ctx.modelDirectories?.directoryFor(sessionId).store
        return { hooks: store ? { codexQuotaDirectory: store } : {} }
      } catch { return { hooks: {} } }
    },
  }, CodexQuotaDock))
}
