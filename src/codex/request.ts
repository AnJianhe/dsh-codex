/**
 * Build the Codex /responses request body from a DSH ModelTurnRequest.
 *
 * Maps DSH messages to the Codex input format:
 * - user messages → content: [{ type: 'input_text', text }]
 * - assistant messages → content: [{ type: 'output_text', text }]
 * - system prompt → instructions
 * - reasoning effort → reasoning: { effort, summary: 'auto' }
 */
export function buildResponsesBody(input: {
  model: string
  messages: readonly { role: string; content: unknown }[]
  system?: string
  tools?: readonly { name: string; description?: string; parameters?: Record<string, unknown> }[]
  reasoningEffort?: string
  maxTokens?: number
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: input.model,
    stream: true,
    store: false,
    input: input.messages
      .filter(m => m.role !== 'system')
      .map(m => {
        // Content can be a plain string or an array of content parts
        let text: string
        if (typeof m.content === 'string') {
          text = m.content
        } else if (Array.isArray(m.content)) {
          text = (m.content as unknown[]).map(part => {
            if (typeof part === 'string') return part
            if (typeof part === 'object' && part !== null) {
              const p = part as Record<string, unknown>
              // Handle { type: 'text', text: '...' } and { type: 'input_text', text: '...' }
              const textVal = p['text']
              if (typeof textVal === 'string') return textVal
              // text might be an array itself
              if (Array.isArray(textVal)) {
                return (textVal as unknown[]).map(t => typeof t === 'string' ? t : '').join('')
              }
              // Handle nested content arrays
              if (Array.isArray(p['content'])) {
                return (p['content'] as unknown[]).map(c => {
                  if (typeof c === 'string') return c
                  if (typeof c === 'object' && c !== null) {
                    return String((c as Record<string, unknown>)['text'] ?? '')
                  }
                  return ''
                }).join('')
              }
              // Debug: log unexpected format
              console.error('[codex-request] unexpected content part:', JSON.stringify(p).slice(0, 200))
            }
            return ''
          }).join('')
        } else {
          text = String(m.content ?? '')
        }
        return {
          type: 'message',
          role: m.role,
          content: [{
            type: m.role === 'assistant' ? 'output_text' : 'input_text',
            text,
          }],
        }
      }),
  }
  if (input.system !== undefined) {
    body.instructions = input.system
  }
  if (input.reasoningEffort !== undefined) {
    body.reasoning = { effort: input.reasoningEffort, summary: 'auto' }
  }
  if (input.tools !== undefined && input.tools.length > 0) {
    body.tools = input.tools
      .filter(t => t != null)
      .map(t => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters }))
  }
  if (input.maxTokens !== undefined) {
    body.max_output_tokens = input.maxTokens
  }
  return body
}
