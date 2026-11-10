import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

/** OAuth client_id extracted from Codex CLI's access token claims. */
export const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'

/** OAuth token refresh endpoint. */
export const CODEX_REFRESH_URL = 'https://auth.openai.com/oauth/token'

/** Codex OAuth credential. */
export type CodexCredential = {
  accessToken: string
  refreshToken?: string
  accountId: string
  expiresAt?: number
}

type AuthJson = {
  auth_mode?: string
  tokens?: {
    access_token?: string
    refresh_token?: string
    account_id?: string
    expires_at?: number
  }
  last_refresh?: string
}

/**
 * Read the Codex CLI OAuth credential from `~/.codex/auth.json`.
 * Returns `undefined` if the file is missing, malformed, or lacks required fields.
 */
export async function loadCredential(options?: { home?: string }): Promise<CodexCredential | undefined> {
  const home = options?.home ?? homedir()
  const authPath = join(home, '.codex', 'auth.json')
  let raw: string
  try {
    raw = await readFile(authPath, 'utf8')
  } catch {
    return undefined
  }
  let parsed: AuthJson
  try {
    parsed = JSON.parse(raw) as AuthJson
  } catch {
    return undefined
  }
  const tokens = parsed.tokens
  if (!tokens?.access_token || !tokens?.account_id) return undefined
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    accountId: tokens.account_id,
    expiresAt: tokens.expires_at,
  }
}

/**
 * Refresh the Codex OAuth token via the refresh_token grant.
 * Writes the new token set back to `~/.codex/auth.json` with 0600 permissions.
 * Throws if the credential has no refresh_token or the refresh request fails.
 */
export async function refreshCredential(
  credential: CodexCredential,
  options?: { home?: string; fetchImpl?: typeof fetch },
): Promise<CodexCredential> {
  if (!credential.refreshToken) {
    throw new Error('Codex 登录已过期，请重新登录')
  }
  const fetchImpl = options?.fetchImpl ?? fetch
  const res = await fetchImpl(CODEX_REFRESH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: CODEX_CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: credential.refreshToken,
    }),
  })
  if (!res.ok) {
    throw new Error(`Codex token 刷新失败 (${res.status})`)
  }
  const data = (await res.json()) as {
    access_token: string
    refresh_token?: string
    expires_in?: number
  }
  const newCred: CodexCredential = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? credential.refreshToken,
    accountId: credential.accountId,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
  }
  // Write back to auth.json
  const home = options?.home ?? homedir()
  const authPath = join(home, '.codex', 'auth.json')
  let raw: string
  try {
    raw = await readFile(authPath, 'utf8')
  } catch {
    raw = '{}'
  }
  let parsed: AuthJson
  try {
    parsed = JSON.parse(raw) as AuthJson
  } catch {
    parsed = {}
  }
  parsed.tokens = {
    access_token: newCred.accessToken,
    refresh_token: newCred.refreshToken,
    account_id: newCred.accountId,
    expires_at: newCred.expiresAt,
  }
  parsed.last_refresh = new Date().toISOString()
  await mkdir(join(home, '.codex'), { recursive: true, mode: 0o700 })
  await writeFile(authPath, JSON.stringify(parsed, null, 2), { mode: 0o600 })
  await chmod(authPath, 0o600)
  return newCred
}
