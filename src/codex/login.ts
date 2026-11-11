/**
 * Codex OAuth 登录（PKCE 流程，与 codex login 简化模式相同）。
 *
 * 启动本地回调服务器，用户在浏览器里授权后自动获取 token。
 */

import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { ServerResponse, IncomingMessage } from 'node:http'

/** OAuth client_id。 */
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'

/** OAuth 授权端点。 */
const AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize'

/** Token 交换端点。 */
const TOKEN_URL = 'https://auth.openai.com/oauth/token'

/** 回调端口。 */
const CALLBACK_PORT = 1456

/** 登录会话。 */
type LoginSession = {
  verifier: string
  resolve: (cred: { accessToken: string; refreshToken?: string; accountId: string }) => void
  reject: (err: Error) => void
  server: ReturnType<typeof createServer>
}

let activeSession: LoginSession | undefined

/**
 * 启动 PKCE 登录流程。返回授权 URL，用户完成授权后回调自动换取 token。
 */
export async function startCodexLogin(): Promise<{ url: string; waitUntilDone: Promise<void> }> {
  if (activeSession !== undefined) {
    throw new Error('已有登录流程进行中')
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

  let resolveFn!: () => void
  let rejectFn!: (err: Error) => void
  const waitUntilDone = new Promise<void>((_resolve, reject) => {
    resolveFn = () => _resolve()
    rejectFn = reject
  })

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    handleCallback(req, res, verifier, state, resolveFn, rejectFn)
  })

  await new Promise<void>((resolve, reject) => {
    server.listen(CALLBACK_PORT, '127.0.0.1', () => {
      console.error('[codex-login] server listening on', CALLBACK_PORT)
      resolve()
    })
    server.on('error', (err: NodeJS.ErrnoException) => {
      console.error('[codex-login] server error:', err.code, err.message)
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`端口 ${CALLBACK_PORT} 已被占用`))
      } else {
        reject(err)
      }
    })
  })

  activeSession = {
    verifier,
    resolve: (cred) => {
      writeAuthJson(cred).catch(() => {})
      resolveFn()
      server.close()
      activeSession = undefined
    },
    reject: (err) => {
      rejectFn(err)
      server.close()
      activeSession = undefined
    },
    server,
  }

  return { url, waitUntilDone }
}

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
    res.writeHead(404); res.end('not found'); return
  }

  const code = url.searchParams.get('code')
  const stateParam = url.searchParams.get('state')
  const errorParam = url.searchParams.get('error')

  if (errorParam) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(`<h2>授权失败: ${errorParam}</h2>`)
    reject(new Error(`OAuth 授权失败: ${errorParam}`))
    return
  }

  if (!code || stateParam !== expectedState) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end('<h2>授权失败: 参数无效</h2>')
    reject(new Error('OAuth 回调参数无效'))
    return
  }

  try {
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
      throw new Error(`Token 交换失败 (${tokenRes.status})`)
    }

    const data = await tokenRes.json() as {
      access_token: string
      refresh_token?: string
      id_token?: string
    }

    let accountId = ''
    if (data.id_token) {
      try {
        const payload = JSON.parse(Buffer.from(data.id_token.split('.')[1]!, 'base64').toString())
        accountId = payload['sub'] ?? ''
      } catch { /* ignore */ }
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end('<html><body><h2>登录成功！</h2><p>可以关闭此页面。</p></body></html>')

    resolve({ accessToken: data.access_token, refreshToken: data.refresh_token, accountId })
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(`<h2>登录失败</h2><p>${err instanceof Error ? err.message : String(err)}</p>`)
    reject(err instanceof Error ? err : new Error(String(err)))
  }
}

async function writeAuthJson(cred: { accessToken: string; refreshToken?: string; accountId: string }): Promise<void> {
  const { writeFile, mkdir, chmod } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const { homedir } = await import('node:os')
  const authPath = join(homedir(), '.codex', 'auth.json')
  await mkdir(join(homedir(), '.codex'), { recursive: true, mode: 0o700 })

  let existing: Record<string, unknown> = {}
  try {
    const raw = await import('node:fs/promises').then(fs => fs.readFile(authPath, 'utf8'))
    existing = JSON.parse(raw)
  } catch { /* new file */ }

  existing.auth_mode = 'chatgpt'
  existing.tokens = { access_token: cred.accessToken, refresh_token: cred.refreshToken, account_id: cred.accountId }
  existing.last_refresh = new Date().toISOString()
  await writeFile(authPath, JSON.stringify(existing, null, 2), { mode: 0o600 })
  await chmod(authPath, 0o600)
}

export function cancelLogin(): void {
  if (activeSession !== undefined) {
    activeSession.server.close()
    activeSession.reject(new Error('登录已取消'))
    activeSession = undefined
  }
}
