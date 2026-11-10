import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

describe('final wiring', () => {
  it('has all required source files', () => {
    const files = [
      'src/entry.ts', 'src/codex-model.ts', 'src/registry.ts',
      'src/codex/auth.ts', 'src/codex/endpoints.ts', 'src/codex/catalog.ts',
      'src/codex/request.ts', 'src/codex/stream.ts', 'src/codex/quota.ts',
      'src/modelkit/types.ts', 'src/modelkit/index.ts',
      'src/client/index.ts', 'cordis.patch.yml',
    ]
    for (const f of files) {
      readFileSync(fileURLToPath(new URL(`../${f}`, import.meta.url)))
    }
  })

  it('no hardcoded credentials in source', () => {
    const files = ['src/entry.ts', 'src/codex-model.ts', 'src/codex/auth.ts']
    for (const f of files) {
      const content = readFileSync(fileURLToPath(new URL(`../${f}`, import.meta.url)), 'utf8')
      expect(content).not.toMatch(/Bearer [A-Za-z0-9_-]{20,}/)
    }
  })
})
