import { describe, it, expect } from 'vitest'
import { parseResponsesStream, CodexStreamError } from '../src/codex/stream.ts'

async function* mockSSE(lines: string[]): AsyncGenerator<string> {
  for (const line of lines) yield line
}

describe('parseResponsesStream', () => {
  it('parses text delta events', async () => {
    const events: unknown[] = []
    for await (const e of parseResponsesStream(mockSSE([
      'data: {"type":"response.output_text.delta","delta":"Hello"}\n',
      'data: {"type":"response.output_text.delta","delta":" world"}\n',
      'data: {"type":"response.completed","response":{"status":"completed"}}\n',
    ]))) events.push(e)
    expect(events).toEqual([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' world' },
      { type: 'finish', reason: 'stop' },
    ])
  })

  it('parses reasoning delta events', async () => {
    const events: unknown[] = []
    for await (const e of parseResponsesStream(mockSSE([
      'data: {"type":"response.reasoning_summary_text.delta","delta":"Thinking..."}\n',
      'data: {"type":"response.completed","response":{"status":"completed"}}\n',
    ]))) events.push(e)
    expect(events).toEqual([
      { type: 'reasoning', text: 'Thinking...' },
      { type: 'finish', reason: 'stop' },
    ])
  })

  it('parses error events', async () => {
    const events: unknown[] = []
    for await (const e of parseResponsesStream(mockSSE([
      'data: {"type":"error","error":{"code":"invalid_request","message":"Bad request"}}\n',
    ]))) events.push(e)
    expect(events).toEqual([{ type: 'error', code: 'invalid_request', message: 'Bad request' }])
  })

  it('throws CodexStreamError on truncated stream without finish', async () => {
    const gen = parseResponsesStream(mockSSE([
      'data: {"type":"response.output_text.delta","delta":"partial"}\n',
    ]))
    const events: unknown[] = []
    let err: Error | undefined
    try {
      for await (const e of gen) events.push(e)
    } catch (e) { err = e as Error }
    expect(err).toBeInstanceOf(CodexStreamError)
    expect(err!.message).toContain('没有收到结束帧')
  })

  it('parses finish event', async () => {
    const events: unknown[] = []
    for await (const e of parseResponsesStream(mockSSE([
      'data: {"type":"response.completed","response":{"status":"completed"}}\n',
    ]))) events.push(e)
    expect(events).toHaveLength(1)
    expect((events[0] as { type: string }).type).toBe('finish')
  })
})
