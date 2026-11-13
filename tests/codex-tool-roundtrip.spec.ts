import { afterEach, describe, expect, it, vi } from 'vitest'
import { codexModelStream } from '../src/codex-model.ts'
import { buildResponsesBody } from '../src/codex/request.ts'

vi.mock('../src/codex/auth.ts', () => ({
  loadCredential: vi.fn(async () => ({ accessToken: 'test-only', accountId: 'test' })),
  refreshCredential: vi.fn(),
}))
vi.mock('../src/codex/quota.ts', () => ({ updateQuota: vi.fn() }))
afterEach(() => vi.unstubAllGlobals())

async function run(frames: unknown[]) {
  const sse = frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join('')
  vi.stubGlobal('fetch', vi.fn(async () => new Response(sse)))
  const stream = codexModelStream({ presets: { codex: { agent: 'codex-global', models: [] } } })
  const chunks = []
  for await (const chunk of stream('codex', { provider: 'codex', model: 'test' })!) chunks.push(chunk)
  return chunks
}
const completed = { type: 'response.completed', response: { status: 'completed' } }
const call = (id: string, name: string, args: string) => ({
  type: 'response.output_item.done',
  item: { type: 'function_call', id: `fc_${id}`, call_id: `call_${id}`, name, arguments: args },
})

describe('Codex tool stream contract', () => {
  it('finishes every mixed block with complete data and unique indexes', async () => {
    const chunks = await run([
      { type: 'response.reasoning_summary_text.delta', delta: 'Think' },
      { type: 'response.output_text.delta', delta: 'Hello' },
      { type: 'response.output_text.delta', delta: ' world' },
      { type: 'response.function_call_arguments.delta', item_id: 'fc_one', delta: '{"partial":' },
      call('one', 'inspect', '{"path":"."}'),
      call('two', 'inspect', '{}'),
      completed,
    ])
    const starts = chunks.filter(c => c.type === 'block-start')
    const ends = chunks.filter(c => c.type === 'block-end')
    expect(starts.map(c => c.index)).toEqual([0, 1, 2, 3])
    expect(ends.map(c => c.index)).toEqual([0, 1, 2, 3])
    expect(ends.map(c => c.block)).toEqual([
      { type: 'reasoning', text: 'Think' },
      { type: 'text', text: 'Hello world' },
      { type: 'tool-call', id: 'call_one', name: 'inspect', arguments: '{"path":"."}' },
      { type: 'tool-call', id: 'call_two', name: 'inspect', arguments: '{}' },
    ])
    for (const { block } of ends) {
      if (block.type !== 'tool-call') continue
      // Session.append requires lossless JSON, including the arguments property.
      const event = { turn: 1, step: 1, callId: block.id, name: block.name, arguments: block.arguments }
      expect(JSON.parse(JSON.stringify(event))).toStrictEqual(event)
      expect(typeof event.arguments).toBe('string')
    }
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'tool-calls' } })
  })

  it('replays completed calls with their matching DSH tool results', async () => {
    const chunks = await run([call('one', 'inspect', '{"path":"."}'), completed])
    const content = chunks.filter(c => c.type === 'block-end').map(c => c.block)
    const body = buildResponsesBody({ model: 'test', messages: [
      { role: 'assistant', content },
      { role: 'tool', toolCallId: 'call_one', content: 'result' },
    ] })
    expect(body.input).toEqual([
      { type: 'function_call', call_id: 'call_one', name: 'inspect', arguments: '{"path":"."}' },
      { type: 'function_call_output', call_id: 'call_one', output: 'result' },
    ])
    const legacy = buildResponsesBody({ model: 'test', messages: [
      { role: 'tool', tool_call_id: 'call_one', content: 'result' },
    ] })
    expect(legacy.input).toEqual([{ type: 'function_call_output', call_id: 'call_one', output: 'result' }])
  })

  it('closes text on normal completion and on a truncated response', async () => {
    for (const terminal of [[completed], []]) {
      const chunks = await run([{ type: 'response.output_text.delta', delta: 'Hello' }, ...terminal])
      expect(chunks[2]).toEqual({ type: 'block-end', index: 0, block: { type: 'text', text: 'Hello' } })
      expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: terminal.length ? 'stop' : 'error' } })
    }
  })
})
