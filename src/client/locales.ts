/**
 * Codex 浏览器侧的 locale 词典。
 *
 * 命名空间 `acpCodexClient`，只装 Codex 账号段与模型勾选用到的词条。
 */

export type ClientLocaleKey =
  | 'codex.section.label'
  | 'codex.account.signedIn' | 'codex.account.signedOut'
  | 'codex.account.relogin'
  | 'modelChecklist.title' | 'modelChecklist.search'
  | 'modelChecklist.summary' | 'modelChecklist.restore'
  | 'modelChecklist.empty'

export const NAMESPACE = 'acpCodexClient'

export const zh: Record<ClientLocaleKey, string> = {
  'codex.section.label': 'Codex 账号',
  'codex.account.signedIn': '已登录 Codex',
  'codex.account.signedOut': '未登录 Codex：请在终端运行 codex login',
  'codex.account.relogin': '重新登录',
  'modelChecklist.title': '模型',
  'modelChecklist.search': '搜模型名或 id',
  'modelChecklist.summary': '共 {total} 个模型，勾上的 {selected} 个会出现在模型选择器里。',
  'modelChecklist.restore': '恢复默认',
  'modelChecklist.empty': '没有匹配上的模型。',
}

export const en: Record<ClientLocaleKey, string> = {
  'codex.section.label': 'Codex account',
  'codex.account.signedIn': 'Signed in to Codex',
  'codex.account.signedOut': 'Not signed in to Codex: run codex login in terminal',
  'codex.account.relogin': 'Sign in again',
  'modelChecklist.title': 'Models',
  'modelChecklist.search': 'Search by name or id',
  'modelChecklist.summary': '{total} models available; {selected} selected show up in the model picker.',
  'modelChecklist.restore': 'Restore defaults',
  'modelChecklist.empty': 'No model matches.',
}

type Params = Readonly<Record<string, string | number>>

export type RuntimeT = (key: string, params?: Params) => string

function interpolate(template: string, params?: Params): string {
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? `{${key}}`))
}

export const fallbackT: RuntimeT = (key, params) => {
  const k = key as ClientLocaleKey
  return interpolate(zh[k] ?? key, params)
}

export function registerClientLocales(register: (dictionaries: { zh: Record<string, string>; en: Record<string, string> }) => void): void {
  register({ zh: { ...zh }, en: { ...en } })
}
