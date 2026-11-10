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

    // Register settings section
    try {
      registerCodexAccountSection(clientCtx, log)
    } catch (err) {
      log(`[codex-client] settings section failed: ${err}`)
    }
  } catch (err) {
    // 最后一道：任何穿透都只降级，不让 fiber 把整行标记成 failed。
    try { console.error(`[codex-client] activation degraded: ${err}`) } catch { /* ignore */ }
  }
}
