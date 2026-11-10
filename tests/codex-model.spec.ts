import { describe, it, expect } from 'vitest'
import { codexModelStream, mergeDeclaredModels } from '../src/codex-model.ts'
import type { PresetConfig } from '../src/registry.ts'

const presetConfig: PresetConfig = {
  presets: {
    'acp-codex-global': {
      agent: 'codex-global',
      models: [{ id: 'gpt-6-astra', name: 'GPT-6 Astra', contextWindow: 272000 }],
    },
  },
}

describe('mergeDeclaredModels', () => {
  it('prefers runtime metadata, falls back to declared', () => {
    const declared = [
      { id: 'gpt-6-astra', name: 'GPT-6 Astra', contextWindow: 272000 },
      { id: 'old-model', name: 'Old Model', contextWindow: 100000 },
    ]
    const runtime = [{ id: 'gpt-6-astra', name: 'GPT-6 Astra (updated)', contextWindow: 280000 }]
    const merged = mergeDeclaredModels(declared, runtime)
    expect(merged).toHaveLength(2)
    const astra = merged.find(m => m.id === 'gpt-6-astra')!
    expect(astra.name).toBe('GPT-6 Astra (updated)')
    expect(astra.contextWindow).toBe(280000)
  })
})

describe('codexModelStream', () => {
  it('returns undefined for non-codex preset', () => {
    const stream = codexModelStream(presetConfig)
    const result = stream('other-preset', { provider: 'x', model: 'y' })
    expect(result).toBeUndefined()
  })

  it('returns a generator for acp-codex-global preset', () => {
    const stream = codexModelStream(presetConfig)
    const result = stream('acp-codex-global', { provider: 'acp:acp-codex-global', model: 'gpt-6-astra' })
    expect(result).toBeDefined()
    expect(typeof result!.next).toBe('function')
  })
})
