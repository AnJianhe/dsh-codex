import { describe, it, expect } from 'vitest'
import { collapseEffortModels } from '../src/modelkit/efforts.ts'

describe('collapseEffortModels', () => {
  it('collapses base[effort] ids into one entry with efforts array', () => {
    const models = [
      { id: 'gpt-6.1-sol[low]', name: '6.1 Sol (low)' },
      { id: 'gpt-6.1-sol[high]', name: '6.1 Sol (high)' },
      { id: 'gpt-6-astra[medium]', name: '6 Astra (medium)' },
    ]
    const result = collapseEffortModels(models)
    expect(result).toHaveLength(2)
    const sol = result.find(m => m.baseId === 'gpt-6.1-sol')
    expect(sol).toBeDefined()
    expect(sol!.efforts).toHaveLength(2)
  })

  it('keeps bare ids as-is', () => {
    const models = [{ id: 'auto', name: 'Auto' }]
    const result = collapseEffortModels(models)
    expect(result).toHaveLength(1)
    expect(result[0]!.efforts).toBeUndefined()
  })
})
