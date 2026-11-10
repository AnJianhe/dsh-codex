/**
 * Codex 浏览器侧入口。
 *
 * 注册 locale 词典和账号设置段。模型行、宿主路由在宿主侧；这里只把浏览器表面接进 DSH。
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SlotCore, SlotMap } from '@deepseek-ai/dsh-client-ui-slots'

import { createElement, useEffect, useState } from 'react'

import { registerClientLocales, NAMESPACE } from './locales.ts'

export const name = '@goodjin2/dsh-codex'

export type CodexClientContext = ClientContext & {
  readonly locale?: {
    readonly register?: (dictionaries: Record<string, unknown>) => unknown
    readonly getSnapshot?: () => { readonly active?: string }
  }
}

export const inject = ['slots', 'remote', 'sessions', 'locale', 'uiConversation', 'uiWorkspace']

type Log = (message: string) => void

function propertyOf(obj: unknown, name: string): unknown {
  return obj === null || obj === undefined ? undefined : (obj as unknown as Record<string, unknown>)[name]
}

function boundMethod(obj: unknown, name: string): Function | undefined {
  const value = propertyOf(obj, name)
  return typeof value === 'function' ? (value as Function) : undefined
}

/**
 * 注册 Codex 账号设置段。
 */
function registerCodexAccountSection(ctx: CodexClientContext, log: Log): void {
  const localeRegister = boundMethod(ctx.locale, 'register')
  if (localeRegister !== undefined) {
    try {
      localeRegister.call(ctx.locale, {
        [NAMESPACE]: {
          zh: {
            'codex.section.label': 'Codex 账号',
            'codex.account.signedIn': '已登录 Codex',
            'codex.account.signedOut': '未登录 Codex：请在终端运行 codex login',
          },
        },
      })
    } catch (err) {
      log(`[codex-client] locale register failed: ${err}`)
    }
  }
}

/** 设置段在 settings.section 座位上的 id。 */
const SECTION_ID = 'codex-account'

/** 账号设置段：登录状态 + 模型清单。数据来自宿主路由（/acp-codex/*）。 */
function CodexAccountSection(): ReturnType<typeof createElement> {
  const [signedIn, setSignedIn] = useState<boolean | undefined>(undefined)
  const [models, setModels] = useState<{ id: string; name: string }[]>([])
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const session = await fetch('/acp-codex/session').then(r => r.json()) as { signedIn?: boolean }
        if (!cancelled) setSignedIn(session.signedIn === true)
        const catalog = await fetch('/acp-codex/models').then(r => r.json()) as { models?: { id: string; name: string }[] }
        if (!cancelled) setModels(Array.isArray(catalog.models) ? catalog.models : [])
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (error !== undefined) return createElement('div', null, `Codex 状态获取失败：${error}`)
  const status = signedIn === undefined ? '查询中…' : signedIn ? '已登录 Codex' : '未登录 Codex：请在终端运行 codex login'
  return createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
    createElement('p', { style: { margin: '0' } }, status),
    createElement('p', { style: { margin: '0' } }, `可用模型 ${models.length} 个`),
    createElement('ul', { style: { margin: '0', paddingLeft: '18px' } },
      models.map(m => createElement('li', { key: m.id }, `${m.name}（${m.id}）`))))
}

/**
 * Codex 浏览器侧 apply 入口。
 *
 * 全体防御化（2026-11-10 现场）：行激活失败会让 web boot 报
 * 「entry did not activate」。渲染器里没有 process.stderr（原 log 实现一执行
 * 就 TypeError），guarded facade 上的服务属性访问也可能抛——任何一处都不能
 * 穿透 apply，否则整行 failed。降级语义：设置段不出现，但行激活成功。
 */
export function apply(ctx: unknown): void {
  // 渲染器没有 process.stderr；console.error 在沙箱渲染器里始终存在。
  const log: Log = (msg: string) => { try { console.error(msg) } catch { /* ignore */ } }
  try {
    const clientCtx = ctx as CodexClientContext

    // Register locales
    const localeRegister = boundMethod(propertyOf(clientCtx, 'locale'), 'register')
    if (localeRegister !== undefined) {
      try {
        registerClientLocales(localeRegister.bind(propertyOf(clientCtx, 'locale')) as (dictionaries: { zh: Record<string, string>; en: Record<string, string> }) => void)
      } catch (err) {
        log(`[codex-client] locale register failed: ${err}`)
      }
    }

    // Register settings section（Codex 账号段：登录状态 + 模型清单）
    try {
      const slots = propertyOf(clientCtx, 'slots')
      const slotsInject = boundMethod(slots, 'inject')
      const slotsRegister = boundMethod(slots, 'register')
      if (slotsInject !== undefined && slotsRegister !== undefined) {
        slotsInject.call(slots, () => slotsRegister.call(slots, {
          name: 'settings.section',
          id: SECTION_ID,
          label: 'Codex 账号',
          locale: NAMESPACE,
        }, CodexAccountSection))
      } else {
        log('[codex-client] slots service missing; settings section not registered')
      }
    } catch (err) {
      log(`[codex-client] settings section failed: ${err}`)
    }
  } catch (err) {
    // 最后一道：任何穿透都只降级，不让 fiber 把整行标记成 failed。
    try { console.error(`[codex-client] activation degraded: ${err}`) } catch { /* ignore */ }
  }
}
