import { useEffect, useState } from 'react'
import { IconDatabaseOutlineRegular, IconGaugeOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { QuotaReply } from '../codex/quota.ts'

type QuotaLabel = { label: string; title: string; percent?: number; shortWindow?: boolean }

export function quotaLabels(reply: QuotaReply | undefined): QuotaLabel[] {
  if (!reply?.snapshot) return [{ label: reply?.error ?? '额度读取中…', title: 'Codex 官方额度；未返回的数据不会按 0 显示' }]
  const { quota: q, updatedAt, source } = reply.snapshot
  const suffix = reply.stale ? ' · 待刷新' : ''
  const detail = `来源：${source === 'official-usage' ? '官方用量接口' : '官方响应头'}；更新：${new Date(updatedAt).toLocaleString()}${q.planType ? `；套餐：${q.planType}` : ''}${reply.error ? `；${reply.error}` : ''}`
  const entries: QuotaLabel[] = []
  for (const [fallback, percent, minutes, resetAt] of [
    ['主窗口', q.primaryPercent, q.primaryWindowMinutes, q.primaryResetAt],
    ['次窗口', q.secondaryPercent, q.secondaryWindowMinutes, q.secondaryResetAt],
  ] as const) {
    if (percent === undefined) continue
    const window = !minutes ? fallback : minutes % 1440 === 0 ? `${minutes / 1440}天` : minutes % 60 === 0 ? `${minutes / 60}小时` : `${minutes}分钟`
    entries.push({ percent, shortWindow: minutes !== undefined && minutes < 1440, label: `${window} ${percent}%${suffix}`, title: `已用 ${percent}%；${detail}${resetAt === undefined ? '；重置时间未知' : `；重置：${new Date(resetAt * 1000).toLocaleString()}`}` })
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
  return <div data-codex-quota="official" aria-label="Codex 官方额度" style={{
    display: 'flex', justifyContent: 'center', gap: '12px', flexWrap: 'wrap',
    fontSize: 'calc(var(--dsh-content-font-size-secondary, 13px) - 1px)',
    color: 'var(--dsw-alias-label-tertiary)',
  }}>
    {quotaLabels(reply).map((item, index) => {
      const tone = item.percent === undefined ? undefined : item.percent >= 80 ? 'danger' : item.percent >= 50 ? 'warn' : undefined
      const color = tone === 'danger' ? 'var(--dsw-static-red-500)' : tone === 'warn' ? 'var(--dsw-alias-state-warn-label)' : undefined
      const Icon = item.shortWindow ? IconGaugeOutlineRegular : IconDatabaseOutlineRegular
      return <span key={index} title={item.title} data-tone={tone} style={{
        display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '1px 8px',
        borderRadius: '999px', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
        color, opacity: reply?.stale ? 0.65 : undefined,
      }}><Icon /><span>{item.label}</span></span>
    })}
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
