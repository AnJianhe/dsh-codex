import { describe, it, expect } from 'vitest'
import { buildResponsesBody } from '../src/codex/request.ts'

describe('buildResponsesBody', () => {
  it('builds a minimal body with model and input', () => {
    const body = buildResponsesBody({ model: 'gpt-6-astra', messages: [{ role: 'user', content: 'Hello' }] })
    expect(body.model).toBe('gpt-6-astra')
    expect(body.stream).toBe(true)
    expect(Array.isArray(body.input)).toBe(true)
  })

  it('includes system as instructions', () => {
    const body = buildResponsesBody({ model: 'gpt-6-astra', messages: [{ role: 'user', content: 'Hi' }], system: 'You are helpful.' })
    expect(body.instructions).toBe('You are helpful.')
  })

  it('includes reasoning when effort is set', () => {
    const body = buildResponsesBody({ model: 'gpt-6.1-sol', messages: [{ role: 'user', content: 'Hi' }], reasoningEffort: 'high' })
    expect(body.reasoning).toEqual({ effort: 'high', summary: 'auto' })
  })

  it('maps messages to input items with correct content types', () => {
    const body = buildResponsesBody({
      model: 'gpt-6-astra',
      messages: [
        { role: 'user', content: 'First' },
        { role: 'assistant', content: 'Response' },
      ],
    })
    const input = body.input as { type: string; role: string; content: { type: string; text: string }[] }[]
    expect(input[0]!.content[0]!.type).toBe('input_text')
    expect(input[1]!.content[0]!.type).toBe('output_text')
  })
})
