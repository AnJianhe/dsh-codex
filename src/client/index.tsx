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
import { useState, useEffect, useCallback } from 'react'

import { NAMESPACE, fallbackT, zh, en } from './locales.ts'

export const name = '@goodjin2/dsh-codex'

export const inject = ['slots', 'remote', 'sessions', 'locale', 'uiConversation', 'uiWorkspace']

type Log = (message: string) => void

type RuntimeT = (key: string, params?: Record<string, string | number>) => string

function boundMethod(obj: unknown, name: string): Function | undefined {
  const value = obj === null || obj === undefined ? undefined : (obj as Record<string, unknown>)[name]
  return typeof value === 'function' ? (value as Function) : undefined
}

function safeRegister(label: string, fn: () => void | (() => void), log: Log): void {
  try {
    fn()
  } catch (error) {
    log(`${label}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** 设置侧栏的插槽面。 */
type AccountSlotHost = {
  inject(key: string, callback: () => unknown): unknown
  register(options: {
    name: string
    id?: string
    order?: number
    label?: () => string
    locale?: string
    inject?: () => unknown
  }, component: unknown): unknown
}

/** 设置里的行 id。 */
const CODEX_ACCOUNT_SECTION_ID = 'codex-account'

/** 行在设置侧栏里的顺序。 */
const CODEX_ACCOUNT_SECTION_ORDER = 131

/** 宿主路由路径。 */
const CODEX_SESSION_URL = '/acp-codex/session'
const CODEX_MODELS_URL = '/acp-codex/models'

type CodexAccountState = {
  readonly signedIn: boolean
  readonly reason?: string
}

/** Codex 账号部分的 React 组件。 */
function CodexAccountSection() {
  const [state, setState] = useState<CodexAccountState>({ signedIn: false })
  const [models, setModels] = useState<readonly { id: string; name: string }[]>([])

  const refresh = useCallback(async () => {
    try {
      const sessionRes = await fetch(CODEX_SESSION_URL).then(r => r.json())
      setState({ signedIn: sessionRes.signedIn === true })
    } catch {
      setState({ signedIn: false, reason: '无法连接宿主' })
    }
    try {
      const modelsRes = await fetch(CODEX_MODELS_URL).then(r => r.json())
      setModels(Array.isArray(modelsRes.models) ? modelsRes.models : [])
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  return (
    <div data-codex-account="root" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div data-codex-account="status">
        {state.signedIn ? '已登录 Codex' : '未登录 Codex：请在终端运行 codex login'}
      </div>
      <div data-codex-account="models">
        可用模型 {models.length} 个
        <ul style={{ margin: 0, paddingLeft: '18px' }}>
          {models.map(m => (
            <li key={m.id}>{m.name}（{m.id}）</li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/**
 * 注册 Codex 账号设置段。
 */
function registerCodexAccountSection(slots: AccountSlotHost, label: () => string, t?: RuntimeT): void {
  slots.inject('settings.section', () => slots.register(
    {
      name: 'settings.section',
      id: CODEX_ACCOUNT_SECTION_ID,
      order: CODEX_ACCOUNT_SECTION_ORDER,
      label,
      locale: NAMESPACE,
      inject: () => ({ t }),
    },
    CodexAccountSection,
  ))
}

/**
 * Codex 浏览器侧 apply 入口。
 */
export function apply(ctx: unknown, _config: unknown, log?: Log): () => void {
  const t: RuntimeT = (key, params) => fallbackT(key, params)
  const say: Log = typeof log === 'function'
    ? log
    : (message) => { console.warn(`[codex-client] ${message}`) }

  // 注册本插件的词典
  const registerLocale = ctx !== null && ctx !== undefined
    ? (ctx as Record<string, unknown>)['locale']
    : undefined
  if (registerLocale !== undefined && typeof registerLocale === 'object') {
    const register = boundMethod(registerLocale, 'register')
    if (typeof register === 'function') {
      try {
        const dispose = (register as Function).call(registerLocale, NAMESPACE, { zh: { ...zh }, en: { ...en } })
        const effect = boundMethod(ctx, 'effect')
        if (typeof dispose === 'function' && effect !== undefined) {
          (effect as Function).call(ctx, () => dispose, 'codex: locale dictionaries')
        }
      } catch (error) {
        say(`locale dictionaries: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  // Codex 账号设置段
  safeRegister('codex account section', () => {
    const slots = (ctx as { slots: unknown }).slots
    registerCodexAccountSection(slots as never, () => t('codex.section.label'), t)
  }, say)

  return () => {}
}
