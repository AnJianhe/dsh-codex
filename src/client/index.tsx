/**
 * Codex 浏览器侧入口。
 *
 * 注册 locale 词典和账号设置段（与 Qoder/WorkBuddy 体验一致）：
 * 账号状态 + 登录按钮 + 模型勾选列表。
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

// --- 样式（与 Qoder 一致） ---

const ACCOUNT_COLUMN_STYLE = {
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
} as const

const ACCOUNT_BOX_STYLE = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
  padding: '10px 12px',
  border: '1px solid var(--dsw-alias-border-default, rgba(0,0,0,0.12))',
  borderRadius: '8px',
} as const

const ACCOUNT_ACTIONS_STYLE = {
  display: 'flex',
  gap: '8px',
  alignItems: 'center',
  flexWrap: 'wrap',
} as const

const ACCOUNT_BUTTON_STYLE = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '6px',
  minHeight: '28px',
  padding: '3px 12px',
  borderRadius: '6px',
  fontSize: 'var(--dsh-content-font-size-secondary, 13px)',
  lineHeight: '1.4',
  whiteSpace: 'nowrap',
} as const

// --- 类型 ---

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

const CODEX_ACCOUNT_SECTION_ID = 'codex-account'
const CODEX_ACCOUNT_SECTION_ORDER = 131

const CODEX_SESSION_URL = '/acp-codex/session'
const CODEX_MODELS_URL = '/acp-codex/models'
const CODEX_LOGIN_URL = '/acp-codex/login'

type CodexAccountState = {
  readonly signedIn: boolean
  readonly reason?: string
}

type ListedModel = {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly contextWindow?: number
  readonly efforts?: readonly string[]
}

type ModelChecklistState = {
  readonly models: readonly ListedModel[]
  readonly selected: readonly string[]
  readonly custom: boolean
  readonly default?: readonly string[]
}

// --- 数据读取 ---

async function readSession(): Promise<CodexAccountState> {
  const res = await fetch(CODEX_SESSION_URL).then(r => r.json())
  return { signedIn: res.signedIn === true }
}

async function readModels(): Promise<ModelChecklistState> {
  const res = await fetch(CODEX_MODELS_URL).then(r => r.json())
  const models: ListedModel[] = Array.isArray(res.models)
    ? res.models.map((m: Record<string, unknown>) => ({
        id: String(m['id'] ?? ''),
        name: String(m['name'] ?? m['id'] ?? ''),
        ...(typeof m['description'] === 'string' ? { description: m['description'] } : {}),
        ...(typeof m['contextWindow'] === 'number' ? { contextWindow: m['contextWindow'] } : {}),
        ...(Array.isArray(m['efforts']) ? { efforts: m['efforts'] as string[] } : {}),
      })).filter((m: ListedModel) => m.id !== '')
    : []
  return {
    models,
    selected: models.map((m: ListedModel) => m.id),
    custom: false,
    default: models.map((m: ListedModel) => m.id),
  }
}

async function saveSelection(ids: readonly string[]): Promise<void> {
  await fetch(CODEX_MODELS_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ids: [...ids] }),
  })
}

// --- 视图 ---

function filterModels(models: readonly ListedModel[], query: string): ListedModel[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return [...models]
  return models.filter(m =>
    m.name.toLowerCase().includes(needle) ||
    m.id.toLowerCase().includes(needle) ||
    (m.description ?? '').toLowerCase().includes(needle),
  )
}

function accountView(state: CodexAccountState, busy: boolean, onLogin?: () => void, onRefresh?: () => void) {
  return (
    <div data-codex-account="root" style={ACCOUNT_COLUMN_STYLE}>
      <div data-codex-account-box={true} style={ACCOUNT_BOX_STYLE}>
        {state.signedIn
          ? <span data-codex-account="signed-in">已登录 Codex</span>
          : (
            <>
              <span data-codex-account="signed-out">未登录 Codex</span>
              {state.reason && <span data-codex-reason="true">{state.reason}</span>}
            </>
          )}
      </div>
      <div data-codex-account-actions={true} style={ACCOUNT_ACTIONS_STYLE}>
        {!state.signedIn && (
          <button
            type="button"
            data-codex-login={true}
            style={ACCOUNT_BUTTON_STYLE}
            disabled={busy}
            onClick={() => { onLogin?.() }}
          >
            登录 Codex
          </button>
        )}
        <button
          type="button"
          data-codex-refresh={true}
          style={ACCOUNT_BUTTON_STYLE}
          disabled={busy}
          onClick={() => { onRefresh?.() }}
        >
          刷新状态
        </button>
      </div>
    </div>
  )
}

function checklistView(
  list: ModelChecklistState,
  query: string,
  onQueryChange: (v: string) => void,
  onToggle: (id: string, checked: boolean) => void,
  onRestoreDefault: () => void,
  busy: boolean,
) {
  const selected = new Set(list.selected)
  const visible = filterModels(list.models, query)
  return (
    <div data-codex-models="root" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <h4 data-codex-models-title={true}>模型</h4>
      <input
        type="search"
        data-codex-models-search={true}
        value={query}
        placeholder="搜模型名或 id"
        disabled={busy}
        onChange={(e: { target: { value: string } }) => { onQueryChange(e.target.value) }}
      />
      <p data-codex-models-summary={true}>
        共 {list.models.length} 个模型，已选 {list.selected.length} 个
      </p>
      {list.custom
        ? <span data-codex-models-custom={true}>当前用的是你自己勾的。</span>
        : <span data-codex-models-default={true}>当前用的是默认那一份。</span>}
      <div data-codex-models-list={true} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {visible.length === 0
          ? <p data-codex-models-empty={true}>没有匹配上的模型。</p>
          : visible.map(model => (
            <label key={model.id} data-codex-model-row={model.id} style={{ display: 'flex', gap: '8px', alignItems: 'baseline' }}>
              <input
                type="checkbox"
                data-codex-model-check={model.id}
                checked={selected.has(model.id)}
                disabled={busy}
                onChange={(e: { target: { checked: boolean } }) => { onToggle(model.id, e.target.checked) }}
              />
              <span data-codex-model-name="true">{model.name}</span>
              <code data-codex-model-id="true">{model.id}</code>
              {model.contextWindow !== undefined && (
                <span data-codex-model-context={true} style={{ opacity: 0.6, fontSize: '11px' }}>
                  {(model.contextWindow / 1000).toFixed(0)}k
                </span>
              )}
            </label>
          ))}
      </div>
      <button
        type="button"
        data-codex-models-restore={true}
        disabled={busy}
        onClick={() => { onRestoreDefault() }}
      >
        恢复默认
      </button>
    </div>
  )
}

/** 主组件。 */
function CodexSettingsSection() {
  const [account, setAccount] = useState<CodexAccountState>({ signedIn: false })
  const [models, setModels] = useState<ModelChecklistState | undefined>(undefined)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setBusy(true)
    try {
      setAccount(await readSession())
    } catch (e) {
      setAccount({ signedIn: false, reason: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }, [])

  const reloadModels = useCallback(async () => {
    try {
      setModels(await readModels())
    } catch {
      setModels(undefined)
    }
  }, [])

  useEffect(() => { void refresh(); void reloadModels() }, [refresh, reloadModels])

  const login = useCallback(async () => {
    setBusy(true)
    try {
      const res = await fetch(CODEX_LOGIN_URL, { method: 'POST' }).then(r => r.json())
      if (res.ok && res.url) {
        window.open(res.url, '_blank', 'noopener')
        // Poll for login completion
        const poll = setInterval(async () => {
          try {
            const s = await readSession()
            if (s.signedIn) {
              clearInterval(poll)
              setBusy(false)
              setAccount(s)
            }
          } catch { /* ignore */ }
        }, 2000)
        setTimeout(() => { clearInterval(poll); setBusy(false) }, 300_000)
      } else {
        setAccount({ signedIn: false, reason: res.error ?? '登录启动失败' })
        setBusy(false)
      }
    } catch (e) {
      setAccount({ signedIn: false, reason: e instanceof Error ? e.message : String(e) })
      setBusy(false)
    }
  }, [])

  const toggle = useCallback((id: string, checked: boolean) => {
    setModels(prev => {
      if (prev === undefined) return prev
      const current = prev.selected
      const next = checked
        ? [...current.filter(x => x !== id), id]
        : current.filter(x => x !== id)
      void saveSelection(next).catch(() => undefined)
      return { ...prev, selected: next, custom: true }
    })
  }, [])

  const restoreDefault = useCallback(() => {
    setModels(prev => {
      if (prev === undefined) return prev
      const defaults = prev.default ?? []
      void saveSelection(defaults).catch(() => undefined)
      return { ...prev, selected: defaults, custom: false }
    })
  }, [])

  return (
    <div data-codex-settings="root" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {accountView(account, busy, () => { void login() }, () => { void refresh() })}
      {models !== undefined && checklistView(
        models, query,
        (v: string) => { setQuery(v) },
        (id: string, checked: boolean) => { toggle(id, checked) },
        () => { restoreDefault() },
        busy,
      )}
    </div>
  )
}

// --- 注册 ---

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
    CodexSettingsSection,
  ))
}

export function apply(ctx: unknown, _config: unknown, log?: Log): () => void {
  const t: RuntimeT = (key, params) => fallbackT(key, params)
  const say: Log = typeof log === 'function'
    ? log
    : (message) => { console.warn(`[codex-client] ${message}`) }

  // 注册词典
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

  safeRegister('codex account section', () => {
    const slots = (ctx as { slots: unknown }).slots
    registerCodexAccountSection(slots as never, () => t('codex.section.label'), t)
  }, say)

  return () => {}
}
