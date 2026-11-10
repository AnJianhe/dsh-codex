import { describe, it, expect } from 'vitest'
import { loadCatalog, BUILTIN_MODELS } from '../src/codex/catalog.ts'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'

async function makeTempHome(): Promise<string> {
  return join(tmpdir(), `codex-cat-test-${randomBytes(4).toString('hex')}`)
}

describe('loadCatalog', () => {
  it('returns empty array when models_cache.json is missing', async () => {
    const home = await makeTempHome()
    const result = await loadCatalog({ home })
    expect(result).toEqual([])
  })

  it('parses models from models_cache.json', async () => {
    const home = await makeTempHome()
    const codexDir = join(home, '.codex')
    await mkdir(codexDir, { recursive: true })
    await writeFile(join(codexDir, 'models_cache.json'), JSON.stringify({
      models: [
        { slug: 'gpt-6.1-sol', display_name: 'GPT-6.1-Sol', description: 'Latest.', context_window: 500000, supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }], supported_in_api: true, visibility: 'list' },
        { slug: 'gpt-reserve', display_name: 'Reserve', context_window: 272000, supported_reasoning_levels: [{ effort: 'low' }], supported_in_api: true, visibility: 'hide' },
      ],
    }))
    const result = await loadCatalog({ home })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('gpt-6.1-sol')
    expect(result[0].contextWindow).toBe(500000)
    expect(result[0].efforts).toContain('high')
  })

  it('returns empty array for malformed cache', async () => {
    const home = await makeTempHome()
    await mkdir(join(home, '.codex'), { recursive: true })
    await writeFile(join(home, '.codex', 'models_cache.json'), 'not json')
    const result = await loadCatalog({ home })
    expect(result).toEqual([])
  })
})

describe('BUILTIN_MODELS', () => {
  it('contains verified models from investigation', () => {
    const ids = BUILTIN_MODELS.map(m => m.id)
    expect(ids).toContain('gpt-6.1-sol')
    expect(ids).toContain('gpt-6-astra')
    expect(BUILTIN_MODELS.length).toBeGreaterThanOrEqual(5)
  })
})
