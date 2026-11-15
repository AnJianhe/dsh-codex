/** Read only diagnostic fields; never serialize a request, response, or error object. */
function field(value: unknown, key: string): unknown {
  try { return value !== null && (typeof value === 'object' || typeof value === 'function') ? Reflect.get(value, key) : undefined } catch { return undefined }
}

export function redactDiagnostic(text: string, secrets: readonly string[] = []): string {
  for (const secret of [...secrets].filter(Boolean).sort((a, b) => b.length - a.length)) text = text.split(secret).join('[REDACTED]')
  return text
    .replace(/Bearer\s+[^\s,"';]+/gi, 'Bearer [REDACTED]')
    .replace(/((?:access_token|refresh_token|api_key|authorization|chatgpt-account-id)["']?\s*[:=]\s*["']?)[^\s,"';&}]+/gi, '$1[REDACTED]')
    .replace(/([?&](?:token|key|secret|password)=)[^\s&#]+/gi, '$1[REDACTED]')
    .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/gi, 'https://[REDACTED]@')
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 2000)
}

/** A bounded, cycle-safe cause chain suitable for both UI and persistent logs. */
export function describeError(error: unknown, secrets: readonly string[] = []): { detail: string; code?: string } {
  const parts: string[] = []
  const seen = new Set<unknown>()
  let current = error
  let code: string | undefined
  for (let depth = 0; depth < 5 && current !== undefined && !seen.has(current); depth++) {
    seen.add(current)
    const name = field(current, 'name')
    const message = field(current, 'message')
    const errorCode = field(current, 'code')
    if (typeof errorCode === 'string' && errorCode.length > 0) code = errorCode
    const label = typeof name === 'string' ? name : 'Error'
    const text = typeof message === 'string' ? message : typeof current === 'string' ? current : '未知异常（未提供 message）'
    parts.push(`${label}${typeof errorCode === 'string' ? ` [${errorCode}]` : ''}: ${text}`)
    current = field(current, 'cause')
  }
  return { detail: redactDiagnostic(parts.join(' ← caused by: ') || '未知异常', secrets), ...(code === undefined ? {} : { code: redactDiagnostic(code, secrets) }) }
}

/** Match DSH's built-in retry codes without treating arbitrary parser errors as transient. */
export function recoveryCode(code: string | undefined): string | undefined {
  if (code && /^(UND_ERR_(CONNECT|HEADERS|BODY)_TIMEOUT|ETIMEDOUT)$/.test(code)) return 'TIMEOUT'
  if (code && /^(UND_ERR_SOCKET|ECONNRESET|ECONNREFUSED|ECONNABORTED|EPIPE|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH)$/.test(code)) return 'TRANSPORT'
  return code
}
