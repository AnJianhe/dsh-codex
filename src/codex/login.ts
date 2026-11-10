/**
 * Codex OAuth 登录流程（PKCE）。
 *
 * 启动本地服务器接收 OAuth 回调，用户在浏览器里授权后自动获取 token。
 * 对应 `codex login` 的简化流程。
 */

import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { ServerResponse, IncomingMessage } from 'node:http'

/** OAuth client_id（与 Codex CLI 相同）。 */
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'

/** OAuth 授权端点。 */
const AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize'

/** Token 交换端点。 */
const TOKEN_URL = 'https://auth.openai.com/oauth/token'

/** 回调端口（与 Codex CLI 相同）。 */
const CALLBACK_PORT = 1455

/** 登录会话（等待回调中）。 */
type LoginSession = {
  verifier: string
  state: string
  resolve: (credential: { accessToken: string; refreshToken?: string; accountId: string }) => void
  reject: (err: Error) => void
  server: ReturnType<typeof createServer>
}

/** 当前活跃的登录会话（一次只允许一个）。 */
let activeSession: LoginSession | undefined

/**
 * 生成 PKCE 授权 URL 并启动本地回调服务器。
 * 用户在浏览器里完成授权后，回调会自动换取 token 并写入 ~/.codex/auth.json。
 */
export async function startCodexLogin(options?: {
  home?: string
  openUrl?: (url: string) => void
}): Promise<{ url: string; waitUntilDone: Promise<void> }> {
  if (activeSession !== undefined) {
    throw new Error('已有登录流程进行中，请先在浏览器中完成授权')
  }

  const verifier = randomBytes(48).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const state = randomBytes(16).toString('hex')

  const redirectUri = `http://127.0.0.1:${CALLBACK_PORT}/auth/callback`

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    scope: 'openid profile email offline_access api.connectors.read api.connectors.invoke',
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    originator: 'codex_cli_rs',
  })

  const url = `${AUTHORIZE_URL}?${params.toString()}`

  // These will be set once the session is created
  let onCredential!: () => void
  let onError!: (err: Error) => void
  const waitUntilDone = new Promise<void>((resolve, reject) => {
    onCredential = resolve
    onError = reject
  })

  const server = createServer((req, res) => {
    handleCallback(req, res, verifier, state, onCredential, onError)
  })

  await new Promise<void>((resolve, reject) => {
    server.listen(CALLBACK_PORT, '127.0.0.1', () => resolve())
    server.on('error', reject)
  })

  activeSession = {
    verifier,
    state,
    resolve: (cred) => {
      writeAuthJson(cred, options?.home).catch(() => {})
      onCredential()
      server.close()
      activeSession = undefined
    },
    reject: (err) => {
      onError(err)
      server.close()
      activeSession = undefined
    },
    server,
  }

  // Open browser
  const openFn = options?.openUrl ?? ((u: string) => {
    console.log(`[codex] 请在浏览器打开: ${u}`)
  })
  try {
    openFn(url)
  } catch {
    // If browser open fails, just log the URL
    console.log(`[codex] 请在浏览器打开: ${url}`)
  }

  return { url, waitUntilDone }
}

/**
 * 处理 OAuth 回调。
 */
async function handleCallback(
  req: IncomingMessage,
  res: ServerResponse,
  verifier: string,
  expectedState: string,
  resolve: LoginSession['resolve'],
  reject: LoginSession['reject'],
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${CALLBACK_PORT}`)

  if (url.pathname !== '/auth/callback') {
    res.writeHead(404)
    res.end('Not found')
    return
  }

  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  if (error) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(`<html><body><h2>授权失败</h2><p>${error}</p></body></html>`)
    reject(new Error(`OAuth 授权失败: ${error}`))
    return
  }

  if (!code || state !== expectedState) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end('<html><body><h2>授权失败</h2><p>无效的请求参数</p></body></html>')
    reject(new Error('OAuth 回调参数无效'))
    return
  }

  try {
    // Exchange code for tokens
    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        code,
        redirect_uri: `http://127.0.0.1:${CALLBACK_PORT}/auth/callback`,
        code_verifier: verifier,
      }).toString(),
    })

    if (!tokenRes.ok) {
      const text = await tokenRes.text()
      throw new Error(`Token 交换失败 (${tokenRes.status}): ${text}`)
    }

    const data = await tokenRes.json() as {
      access_token: string
      refresh_token?: string
      id_token?: string
    }

    // Extract account_id from id_token claims
    let accountId = ''
    if (data.id_token) {
      try {
        const payload = JSON.parse(Buffer.from(data.id_token.split('.')[1]!, 'base64').toString())
        accountId = payload['sub'] ?? ''
      } catch {
        // ignore parse errors
      }
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end('<html><body><h2>登录成功！</h2><p>可以关闭此页面，回到 DeepSeek Harness。</p></body></html>')

    resolve({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      accountId,
    })
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(`<html><body><h2>登录失败</h2><p>${err instanceof Error ? err.message : String(err)}</p></body></html>`)
    reject(err instanceof Error ? err : new Error(String(err)))
  }
}

/**
 * 写入凭据到 ~/.codex/auth.json。
 */
async function writeAuthJson(
  cred: { accessToken: string; refreshToken?: string; accountId: string },
  home?: string,
): Promise<void> {
  const { writeFile, mkdir, chmod } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const { homedir } = await import('node:os')

  const base = home ?? homedir()
  const authPath = join(base, '.codex', 'auth.json')
  await mkdir(join(base, '.codex'), { recursive: true, mode: 0o700 })

  let existing: Record<string, unknown> = {}
  try {
    const raw = await import('node:fs/promises').then(fs => fs.readFile(authPath, 'utf8'))
    existing = JSON.parse(raw)
  } catch {
    // file doesn't exist or is invalid
  }

  existing.auth_mode = 'chatgpt'
  existing.tokens = {
    access_token: cred.accessToken,
    refresh_token: cred.refreshToken,
    account_id: cred.accountId,
  }
  existing.last_refresh = new Date().toISOString()

  await writeFile(authPath, JSON.stringify(existing, null, 2), { mode: 0o600 })
  await chmod(authPath, 0o600)
}

/**
 * 取消当前登录流程（如果有）。
 */
export function cancelLogin(): void {
  if (activeSession !== undefined) {
    activeSession.server.close()
    activeSession.reject(new Error('登录已取消'))
    activeSession = undefined
  }
}
