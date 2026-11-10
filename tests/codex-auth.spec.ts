import { describe, it, expect, vi } from 'vitest'
import { loadCredential, refreshCredential, CODEX_CLIENT_ID, CODEX_REFRESH_URL } from '../src/codex/auth.ts'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'

async function makeTempHome(): Promise<string> {
  const dir = join(tmpdir(), `codex-auth-test-${randomBytes(4).toString('hex')}`)
  await mkdir(dir, { recursive: true })
  return dir
}

describe('loadCredential', () => {
  it('returns undefined when auth.json is missing', async () => {
    const home = await makeTempHome()
    const result = await loadCredential({ home })
    expect(result).toBeUndefined()
  })

  it('returns credential from a valid auth.json', async () => {
    const home = await makeTempHome()
    await mkdir(join(home, '.codex'), { recursive: true })
    await writeFile(join(home, '.codex', 'auth.json'), JSON.stringify({
      auth_mode: 'chatgpt',
      tokens: {
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        account_id: 'test-account-id',
      },
      last_refresh: '2026-11-07T13:23:44.637165Z',
    }), { mode: 0o600 })
    const result = await loadCredential({ home })
    expect(result).toBeDefined()
    expect(result!.accessToken).toBe('test-access-token')
    expect(result!.refreshToken).toBe('test-refresh-token')
    expect(result!.accountId).toBe('test-account-id')
  })

  it('returns undefined for malformed auth.json', async () => {
    const home = await makeTempHome()
    await mkdir(join(home, '.codex'), { recursive: true })
    await writeFile(join(home, '.codex', 'auth.json'), 'not json', { mode: 0o600 })
    const result = await loadCredential({ home })
    expect(result).toBeUndefined()
  })

  it('returns undefined when tokens are missing', async () => {
    const home = await makeTempHome()
    await mkdir(join(home, '.codex'), { recursive: true })
    await writeFile(join(home, '.codex', 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt' }), { mode: 0o600 })
    const result = await loadCredential({ home })
    expect(result).toBeUndefined()
  })
})

describe('refreshCredential', () => {
  it('posts refresh_token and writes new tokens back', async () => {
    const home = await makeTempHome()
    await mkdir(join(home, '.codex'), { recursive: true })
    await writeFile(join(home, '.codex', 'auth.json'), JSON.stringify({
      auth_mode: 'chatgpt',
      tokens: { access_token: 'old', refresh_token: 'rt', account_id: 'acc' },
      last_refresh: '2026-11-07T00:00:00Z',
    }), { mode: 0o600 })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 86400,
      }),
    })
    const result = await refreshCredential(
      { accessToken: 'old', refreshToken: 'rt', accountId: 'acc' },
      { home, fetchImpl: fetchMock as unknown as typeof fetch },
    )
    expect(result.accessToken).toBe('new-access')
    expect(fetchMock).toHaveBeenCalledWith(
      CODEX_REFRESH_URL,
      expect.objectContaining({ method: 'POST' }),
    )
    const written = JSON.parse(await readFile(join(home, '.codex', 'auth.json'), 'utf8'))
    expect(written.tokens.access_token).toBe('new-access')
  })

  it('throws on refresh failure', async () => {
    const home = await makeTempHome()
    await mkdir(join(home, '.codex'), { recursive: true })
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400 })
    await expect(refreshCredential(
      { accessToken: 'old', refreshToken: 'rt', accountId: 'acc' },
      { home, fetchImpl: fetchMock as unknown as typeof fetch },
    )).rejects.toThrow()
  })
})
