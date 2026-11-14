import { afterEach, describe, expect, it, vi } from 'vitest'
import { describeError } from '../src/codex/diagnostics.ts'
import { codexModelStream } from '../src/codex-model.ts'

vi.mock('../src/codex/auth.ts', () => ({ loadCredential: vi.fn(async () => ({ accessToken: 'private-access', refreshToken: 'private-refresh', accountId: 'private-account' })), refreshCredential: vi.fn() }))
vi.mock('../src/codex/quota.ts', () => ({ updateQuota: vi.fn() }))
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

async function failStream(error: unknown, signal?: AbortSignal, payload?: string) {
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    if (payload !== undefined) { controller.enqueue(new TextEncoder().encode(payload)); controller.close() }
    else controller.error(error)
  } })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { headers: { 'x-request-id': 'req_test' } })))
  const stream = codexModelStream({ presets: { codex: { agent: 'codex-global', models: [] } } })
  const chunks = []
  for await (const chunk of stream('codex', { provider: 'codex', model: 'model', signal })!) chunks.push(chunk)
  return { chunks, body }
}

describe('stream diagnostics', () => {
  it('shows the original read error, cause code and request id in UI and logs', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const cause = Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' })
    const { chunks, body } = await failStream(new TypeError('terminated', { cause }))
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: {
      code: 'UND_ERR_SOCKET', message: 'Codex 响应流读取失败：TypeError: terminated ← caused by: Error [UND_ERR_SOCKET]: other side closed (request_id=req_test)',
    } } })
    expect(log).toHaveBeenCalledWith('[codex]', expect.stringContaining('UND_ERR_SOCKET'))
    expect(body.locked).toBe(false)
    expect(JSON.parse(JSON.stringify(chunks))).toEqual(chunks)
  })

  it('marks cancellation as aborted and retains the original message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const controller = new AbortController(); controller.abort()
    const { chunks } = await failStream(new DOMException('The operation was aborted', 'AbortError'), controller.signal)
    expect(chunks.at(-1)).toMatchObject({ reason: { kind: 'aborted', failure: { code: 'ABORTED', message: expect.stringContaining('AbortError: The operation was aborted') } } })
  })

  it('distinguishes parser exceptions from read failures', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { chunks } = await failStream(undefined, undefined, 'data: null\n\n')
    expect(chunks.at(-1)).toMatchObject({ reason: { failure: { message: expect.stringContaining('Codex 流式响应解析失败：TypeError:') } } })
  })

  it('redacts credentials from both the persisted error and diagnostic log', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new Error('private-access private-refresh private-account Bearer unknown-secret access_token=extra-secret https://user:password@proxy/?token=query-secret')
    const { chunks } = await failStream(error)
    const output = JSON.stringify([chunks, log.mock.calls])
    for (const secret of ['private-access', 'private-refresh', 'private-account', 'unknown-secret', 'extra-secret', 'query-secret', 'user:password']) expect(output).not.toContain(secret)
    expect(output).toContain('[REDACTED]')
  })

  it('handles string throws, circular causes and throwing getters safely', () => {
    expect(describeError('socket closed').detail).toContain('socket closed')
    const error = new Error('cycle'); error.cause = error
    expect(describeError(error).detail).toBe('Error: cycle')
    expect(() => describeError(new Proxy({}, { get() { throw new Error('getter') } }))).not.toThrow()
    expect(describeError(new Error('x'.repeat(10000))).detail.length).toBeLessThanOrEqual(2000)
  })
})
