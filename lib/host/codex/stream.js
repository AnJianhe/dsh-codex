/** Error thrown when the Codex /responses stream is truncated without a finish frame. */
export class CodexStreamError extends Error {
    constructor(message) {
        super(message);
        this.name = 'CodexStreamError';
    }
}
/**
 * Parse the Codex /responses SSE stream.
 *
 * Reads `data:` lines from the async source, parses JSON payloads,
 * and yields ResponsesEvent objects. Buffers function_call_arguments per
 * item_id and emits tool_call events on response.output_item.done.
 *
 * Throws CodexStreamError if the stream ends without a completed/finish event
 * and no finish_reason was salvaged from any frame.
 */
export async function* parseResponsesStream(source) {
    let buffer = '';
    let sawFinish = false;
    // Buffer for function_call_arguments per item_id
    const toolArgs = new Map();
    const decoder = new TextDecoder();
    for await (const chunk of source) {
        const text = typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
        buffer += text;
        // Process complete lines
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:'))
                continue;
            const payload = trimmed.slice(5).trim();
            if (!payload)
                continue;
            let parsed;
            try {
                parsed = JSON.parse(payload);
            }
            catch {
                continue;
            }
            const type = parsed.type;
            if (type === 'response.output_text.delta') {
                yield { type: 'text', text: parsed.delta };
            }
            else if (type === 'response.reasoning_summary_text.delta') {
                yield { type: 'reasoning', text: parsed.delta };
            }
            else if (type === 'response.reasoning_text.delta') {
                yield { type: 'reasoning', text: parsed.delta };
            }
            else if (type === 'response.function_call_arguments.delta') {
                const itemId = parsed.item_id;
                const entry = toolArgs.get(itemId) ?? { id: itemId, name: '', args: '' };
                entry.args += parsed.delta;
                toolArgs.set(itemId, entry);
            }
            else if (type === 'response.output_item.done') {
                const item = parsed.item;
                if (item?.type === 'function_call') {
                    const itemId = item.item_id ?? item.id ?? '';
                    const name = item.name ?? '';
                    const buffered = toolArgs.get(itemId);
                    const args = item.arguments ?? buffered?.args ?? '';
                    const callId = item.call_id ?? itemId;
                    yield { type: 'tool_call', id: callId, name, arguments: args };
                    toolArgs.delete(itemId);
                }
            }
            else if (type === 'response.completed') {
                sawFinish = true;
                const response = parsed.response;
                const status = response?.status ?? 'completed';
                yield { type: 'finish', reason: status === 'completed' ? 'stop' : status };
                return;
            }
            else if (type === 'error') {
                const error = parsed.error;
                yield {
                    type: 'error',
                    code: error?.code ?? parsed.code ?? 'unknown',
                    message: error?.message ?? parsed.message ?? '未知错误',
                };
                sawFinish = true;
                return;
            }
            else if (type === 'response.failed') {
                const error = parsed.error;
                yield {
                    type: 'error',
                    code: error?.code ?? 'response_failed',
                    message: error?.message ?? '响应失败',
                };
                sawFinish = true;
                return;
            }
        }
    }
    // Stream ended without a completed/finish event
    if (!sawFinish) {
        throw new CodexStreamError('Codex 流式响应中断：没有收到结束帧');
    }
}
