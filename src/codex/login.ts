/**
 * Codex OAuth 登录（设备码流程）。
 *
 * 用 `codex login --device-auth` 同款的设备码授权方式：
 * 打开 https://auth.openai.com/codex/device，输入一次性验证码。
 * 不需要本地回调服务器，不受端口冲突影响。
 */

/** 设备授权端点。 */
const DEVICE_AUTH_URL = 'https://auth.openai.com/codex/device'

/** 设备码轮询端点。 */
const DEVICE_TOKEN_URL = 'https://auth.openai.com/oauth/token'

/** 当前活跃的设备码会话。 */
type DeviceSession = {
  userCode: string
  deviceCode: string
  interval: number
  expiresAt: number
  abortController: AbortController
}

let activeSession: DeviceSession | undefined

/**
 * 启动设备码登录流程。
 * 调用 OpenAI 的设备授权端点，获取一次性验证码。
 */
export async function startDeviceLogin(): Promise<{ url: string; userCode: string }> {
  if (activeSession !== undefined) {
    throw new Error('已有登录流程进行中，请先在浏览器中输入验证码')
  }

  // Request device code from OpenAI
  const res = await fetch(DEVICE_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: 'app_EMoamEEZ73f0CkXaXp7hrann',
      scope: 'openid profile email offline_access',
    }),
  })

  if (!res.ok) {
    // If the device auth endpoint doesn't work, fall back to PKCE URL
    // (user can use codex login --device-auth in terminal instead)
    throw new Error(`设备授权请求失败 (${res.status})。请在终端运行 codex login 完成登录。`)
  }

  const data = await res.json() as {
    device_code?: string
    user_code?: string
    verification_uri?: string
    interval?: number
    expires_in?: number
  }

  const userCode = data.user_code ?? data.verification_uri ?? ''
  const deviceCode = data.device_code ?? ''

  if (!deviceCode) {
    throw new Error('设备授权响应缺少 device_code')
  }

  activeSession = {
    userCode,
    deviceCode,
    interval: data.interval ?? 5,
    expiresAt: Date.now() + (data.expires_in ?? 900) * 1000,
    abortController: new AbortController(),
  }

  return { url: DEVICE_AUTH_URL, userCode }
}

/**
 * 轮询设备码状态，等待用户完成授权。
 * 返回凭据或抛出超时/取消错误。
 */
export async function pollDeviceLogin(options?: {
  timeoutMs?: number
  signal?: AbortSignal
}): Promise<{ accessToken: string; refreshToken?: string; accountId: string }> {
  if (activeSession === undefined) {
    throw new Error('没有活跃的登录流程')
  }

  const session = activeSession
  const timeout = options?.timeoutMs ?? 900_000

  const timeoutSignal = AbortSignal.timeout(timeout)
  const combinedSignal = options?.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal

  while (!combinedSignal.aborted) {
    if (Date.now() > session.expiresAt) {
      activeSession = undefined
      throw new Error('登录验证码已过期，请重试')
    }

    await new Promise(resolve => setTimeout(resolve, session.interval * 1000))

    try {
      const res = await fetch(DEVICE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code: session.deviceCode,
          client_id: 'app_EMoamEEZ73f0CkXaXp7hrann',
        }).toString(),
        signal: combinedSignal,
      })

      if (res.status === 400) {
        const err = await res.json() as { error?: string }
        if (err.error === 'authorization_pending') continue
        if (err.error === 'slow_down') { session.interval += 5; continue }
        activeSession = undefined
        throw new Error(`授权失败: ${err.error}`)
      }

      if (!res.ok) continue

      const data = await res.json() as {
        access_token: string
        refresh_token?: string
        id_token?: string
      }

      // Extract account_id
      let accountId = ''
      if (data.id_token) {
        try {
          const payload = JSON.parse(Buffer.from(data.id_token.split('.')[1]!, 'base64').toString())
          accountId = payload['sub'] ?? ''
        } catch { /* ignore */ }
      }

      const cred = { accessToken: data.access_token, refreshToken: data.refresh_token, accountId }
      await writeAuthJson(cred)
      activeSession = undefined
      return cred
    } catch (err) {
      if (combinedSignal.aborted) break
      // Network error, keep polling
      console.error(`[codex] poll error: ${err}`)
    }
  }

  activeSession = undefined
  throw new Error('登录超时')
}

/**
 * 取消当前登录流程。
 */
export function cancelLogin(): void {
  if (activeSession !== undefined) {
    activeSession.abortController.abort()
    activeSession = undefined
  }
}

/**
 * 写入凭据到 ~/.codex/auth.json。
 */
async function writeAuthJson(cred: { accessToken: string; refreshToken?: string; accountId: string }): Promise<void> {
  const { writeFile, mkdir, chmod } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const { homedir } = await import('node:os')

  const base = homedir()
  const authPath = join(base, '.codex', 'auth.json')
  await mkdir(join(base, '.codex'), { recursive: true, mode: 0o700 })

  let existing: Record<string, unknown> = {}
  try {
    const raw = await import('node:fs/promises').then(fs => fs.readFile(authPath, 'utf8'))
    existing = JSON.parse(raw)
  } catch { /* file doesn't exist */ }

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
