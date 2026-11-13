import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { apply, inject } from '../src/entry.ts'

describe('wiring', () => {
  it('cordis.patch.yml has acp-codex-global row', () => {
    const content = readFileSync(fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)), 'utf8')
    expect(content).toContain('acp-codex-global')
    expect(content).toContain('collapseEfforts')
  })

  it('cordis.patch.yml has acp-codex-quota row', () => {
    const content = readFileSync(fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)), 'utf8')
    expect(content).toContain('acp-codex-quota')
  })

  it('package.json declares dsh.bundle.patch and dsh.client.platform', () => {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))
    expect(pkg.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(pkg.dsh.client.platform).toBe('web')
  })

  it('entry.ts exports name and apply', () => {
    const content = readFileSync(fileURLToPath(new URL('../src/entry.ts', import.meta.url)), 'utf8')
    expect(content).toContain("export const name = '@goodjin2/dsh-codex'")
    expect(content).toContain('export function apply')
    expect(content).toContain('modelRowAdapter')
    expect(content).toContain('providerRoute')
  })
})

it('registers its model row under the host declared-service guard', () => {
  const providers: string[] = []
  const ctx = { get(key: string) {
    if (!inject.includes(key)) throw new Error(`undeclared service: ${key}`)
    return { registerAdapter(routes: string[]) { providers.push(...routes) } }
  } }
  apply(ctx, { presetId: 'codex-wiring-test', agent: 'test' })
  expect(providers).toEqual(['acp:codex-wiring-test'])
})
