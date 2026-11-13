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


describe('Codex tool schemas', () => {
  const build = (parameters?: Record<string, unknown>) => buildResponsesBody({
    model: 'gpt-6-astra', messages: [],
    tools: [{ name: 'kernel_definition_publish', parameters }],
  }).tools as { type: string; name: string; parameters: Record<string, unknown>; strict: boolean }[]

  it('opts out of strict conversion and preserves DSH open objects and optional fields', () => {
    const parameters = {
      type: 'object', additionalProperties: false,
      properties: {
        requestId: { type: 'string' },
        definition: { type: 'object', description: 'Declarative definition' },
        note: { type: 'string' },
      },
      required: ['requestId', 'definition'],
    }
    const snapshot = structuredClone(parameters)
    expect(build(parameters)[0]).toEqual({
      type: 'function', name: 'kernel_definition_publish', description: undefined,
      parameters, strict: false,
    })
    expect(parameters).toEqual(snapshot)
  })

  it('supports empty tools and object schemas with omitted type', () => {
    expect(build()[0]!.parameters).toEqual({ type: 'object', properties: {} })
    expect(build({ properties: { value: { type: 'string' } } })[0]!.parameters.type).toBe('object')
  })

  it.each([
    ['oneOf', [{ type: 'object' }]], ['anyOf', [{ type: 'object' }]],
    ['allOf', [{ type: 'object' }]], ['enum', [{}]], ['const', false], ['not', false],
  ])('rejects unsupported root %s without corrupting tool arguments', (key, value) => {
    expect(() => build({ type: 'object', [key as string]: value })).toThrow(
      expect.objectContaining({ code: 'unsupported-tool-schema', message: expect.stringContaining('kernel_definition_publish') }),
    )
  })

  it('preserves supported nested constraints', () => {
    const schema = { type: 'object', properties: { kind: { enum: ['a', 'b'] }, value: { anyOf: [{ type: 'string' }, { type: 'number' }] } } }
    expect(build(schema)[0]!.parameters).toEqual(schema)
  })

  it('rejects scalar arguments instead of inventing a value wrapper', () => {
    expect(() => build({ type: 'string' })).toThrow('kernel_definition_publish')
  })
})
