import type { CodexCredential } from './auth.ts'

/** Codex /responses endpoint URL. */
export const CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses'

/** User-Agent version string matching the Codex CLI. */
export const CODEX_UA_VERSION = '0.166.0'

/** Build request headers for the Codex /responses endpoint. */
export function buildHeaders(credential: CodexCredential, _model?: string): Record<string, string> {
  return {
    'Authorization': `Bearer ${credential.accessToken}`,
    'chatgpt-account-id': credential.accountId,
    'originator': 'codex_cli_rs',
    'user-agent': `codex_cli_rs/${CODEX_UA_VERSION}`,
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream',
  }
}

/** Codex quota extracted from x-codex-* response headers. */
export type CodexQuota = {
  planType?: string
  primaryPercent?: number
  primaryWindowMinutes?: number
  primaryResetAfterSeconds?: number
  secondaryPercent?: number
  secondaryWindowMinutes?: number
  secondaryResetAfterSeconds?: number
  creditsHasCredits?: boolean
  creditsBalance?: number
}

/**
 * Parse x-codex-* headers into a CodexQuota object.
 * Returns undefined if no x-codex-* headers are present.
 */
export function parseQuotaHeaders(headers: Record<string, string>): CodexQuota | undefined {
  const codexKeys = Object.keys(headers).filter(k => k.startsWith('x-codex-'))
  if (codexKeys.length === 0) return undefined

  const quota: CodexQuota = {}
  const get = (suffix: string): string | undefined => {
    for (const k of codexKeys) {
      if (k === `x-codex-${suffix}`) return headers[k]
    }
    return undefined
  }

  const planType = get('plan-type')
  if (planType !== undefined) quota.planType = planType

  const pp = get('primary-used-percent')
  if (pp !== undefined) quota.primaryPercent = Number(pp)

  const pwm = get('primary-window-minutes')
  if (pwm !== undefined) quota.primaryWindowMinutes = Number(pwm)

  const prs = get('primary-reset-after-seconds')
  if (prs !== undefined) quota.primaryResetAfterSeconds = Number(prs)

  const sp = get('secondary-used-percent')
  if (sp !== undefined) quota.secondaryPercent = Number(sp)

  const swm = get('secondary-window-minutes')
  if (swm !== undefined) quota.secondaryWindowMinutes = Number(swm)

  const srs = get('secondary-reset-after-seconds')
  if (srs !== undefined) quota.secondaryResetAfterSeconds = Number(srs)

  const chc = get('credits-has-credits')
  if (chc !== undefined) quota.creditsHasCredits = chc === 'True'

  const cb = get('credits-balance')
  if (cb !== undefined) quota.creditsBalance = Number(cb)

  return quota
}
