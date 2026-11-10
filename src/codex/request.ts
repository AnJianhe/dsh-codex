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
  messages: readonly { role: string; content: string }[]
  system?: string
  tools?: readonly { name: string; description?: string; parameters?: Record<string, unknown> }[]
  reasoningEffort?: string
  maxTokens?: number
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: input.model,
    stream: true,
    store: false,
    input: input.messages.map(m => ({
      type: 'message',
      role: m.role,
      content: [{
        type: m.role === 'assistant' ? 'output_text' : 'input_text',
        text: m.content,
      }],
    })),
  }
  if (input.system !== undefined) {
    body.instructions = input.system
  }
  if (input.reasoningEffort !== undefined) {
    body.reasoning = { effort: input.reasoningEffort, summary: 'auto' }
  }
  if (input.tools !== undefined && input.tools.length > 0) {
    body.tools = input.tools
  }
  if (input.maxTokens !== undefined) {
    body.max_output_tokens = input.maxTokens
  }
  return body
}
