import { name } from '../src/entry.ts'
import { describe, it, expect } from 'vitest'

describe('scaffold', () => {
  it('exports the correct plugin name', () => {
    expect(name).toBe('@goodjin2/dsh-codex')
  })
})
