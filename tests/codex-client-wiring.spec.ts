import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

describe('client wiring', () => {
  it('package.json exports ./client pointing to lib/client.js', () => {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))
    expect(pkg.exports['./client']).toBeDefined()
    expect(pkg.exports['./client'].default).toContain('lib/client.js')
  })

  it('client index exports name and apply', () => {
    const content = readFileSync(fileURLToPath(new URL('../src/client/index.ts', import.meta.url)), 'utf8')
    expect(content).toContain('export const name')
    expect(content).toContain('export function apply')
  })
})
