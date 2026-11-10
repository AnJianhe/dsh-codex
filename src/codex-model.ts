/**
 * Codex 模型插件——把 Codex /responses 端点的流式响应转成 DSH 模型流。
 *
 * DSH 的循环负责工具/审批/编排；这一行只回答「向模型要下一句话」。
 * 复用本地 Codex CLI 的 OAuth 凭据（~/.codex/auth.json），不需要 ACP 子进程。
 */

import type { ModelTurnRequest, ModelStreamChunk } from './modelkit/index.ts'
import type { PresetConfig } from './registry.ts'
import { loadCredential, refreshCredential } from './codex/auth.ts'
import { CODEX_RESPONSES_URL, buildHeaders } from './codex/endpoints.ts'
import { buildResponsesBody } from './codex/request.ts'
import { parseResponsesStream, CodexStreamError } from './codex/stream.ts'
import { loadCatalog } from './codex/catalog.ts'
import { updateQuota } from './codex/quota.ts'

/** 运行时清单写进目录账本时用的形状。 */
export type CodexReportedModel = {
  readonly id: string
  readonly name: string
  readonly description?: string | undefined
  readonly contextWindow?: number | undefined
}

/**
 * 运行时清单与声明清单合并出真正发布的那一份。
 * 运行时（catalog cache）优先；它没报的字段用声明兜底。
 */
export function mergeDeclaredModels(
  declared: readonly { id: string; name: string; description?: string; contextWindow?: number }[],
  runtime: readonly CodexReportedModel[],
): CodexReportedModel[] {
  const byId = new Map(runtime.map(m => [m.id, m]))
  return declared.map(entry => {
    const found = byId.get(entry.id)
    const name = found?.name ?? entry.name
    const description = found?.description ?? entry.description
    const contextWindow = found?.contextWindow ?? entry.contextWindow
    const result: CodexReportedModel & { description?: string; contextWindow?: number } = { id: entry.id, name }
    if (description !== undefined) result.description = description
    if (contextWindow !== undefined) result.contextWindow = contextWindow
    return result
  })
}

/** 每一行的清单发布口（写进目录的运行时账本）。 */
const publishers = new Map<string, (models: readonly CodexReportedModel[]) => void>()

/**
 * 重新加载模型清单并发布到运行时账本。
 */
export async function refreshCodexModels(): Promise<void> {
  const catalog = await loadCatalog()
  const reported: CodexReportedModel[] = catalog.map(m => ({
    id: m.id,
    name: m.name,
    ...(m.description === undefined ? {} : { description: m.description }),
    contextWindow: m.contextWindow,
  }))
  for (const publish of publishers.values()) {
    publish(reported)
  }
}

type StreamDeps = {
  onRuntimeModels?: (presetId: string, models: readonly CodexReportedModel[]) => void
}

/**
 * 创建 Codex 模型流函数。
 * 检查 preset 的 agent 是否为 'codex-global'，是则返回流函数，否则返回 undefined。
 */
export function codexModelStream(
  config: PresetConfig,
  deps?: StreamDeps,
): (presetId: string, request: ModelTurnRequest) => AsyncGenerator<ModelStreamChunk> | undefined {
  return (presetId: string, request: ModelTurnRequest): AsyncGenerator<ModelStreamChunk> | undefined => {
    const preset = config.presets[presetId]
    if (preset === undefined || preset.agent !== 'codex-global') return undefined

    // Register publisher for this preset
    if (deps?.onRuntimeModels) {
      publishers.set(presetId, (models) => deps.onRuntimeModels!(presetId, models))
      // Publish initial catalog
      loadCatalog().then(catalog => {
        const reported: CodexReportedModel[] = catalog.map(m => ({
          id: m.id,
          name: m.name,
          ...(m.description === undefined ? {} : { description: m.description }),
          contextWindow: m.contextWindow,
        }))
        deps.onRuntimeModels!(presetId, reported)
      }).catch(() => {})
    }

    return streamCodex(presetId, request)
  }
}

async function* streamCodex(
  _presetId: string,
  request: ModelTurnRequest,
): AsyncGenerator<ModelStreamChunk> {
  // 1. Load credential
  let credential = await loadCredential()
  if (credential === undefined) {
    yield {
      type: 'finish',
      reason: { kind: 'error', message: '未找到 Codex 登录凭据，请在终端运行 codex login' },
    }
    return
  }

  // 2. Build request body
  const messages = (request.messages ?? []) as { role: string; content: string }[]
  const body = buildResponsesBody({
    model: request.model,
    messages,
    system: typeof request.system === 'string' ? request.system : undefined,
    tools: request.tools,
    reasoningEffort: typeof request.reasoningEffort === 'string' ? request.reasoningEffort : undefined,
    maxTokens: typeof request.maxTokens === 'number' ? request.maxTokens : undefined,
  })

  const signal = request.signal as AbortSignal | undefined

  // 3. POST to /responses
  let res = await fetch(CODEX_RESPONSES_URL, {
    method: 'POST',
    headers: buildHeaders(credential, request.model),
    body: JSON.stringify(body),
    signal,
  })

  // 4. On 401: refresh token and retry once
  if (res.status === 401) {
    try {
      credential = await refreshCredential(credential)
    } catch {
      yield {
        type: 'finish',
        reason: { kind: 'error', message: 'Codex 登录已过期，请重新登录' },
      }
      return
    }
    res = await fetch(CODEX_RESPONSES_URL, {
      method: 'POST',
      headers: buildHeaders(credential, request.model),
      body: JSON.stringify(body),
      signal,
    })
    if (res.status === 401) {
      yield {
        type: 'finish',
        reason: { kind: 'error', message: 'Codex 登录已过期，请重新登录' },
      }
      return
    }
  }

  if (!res.ok) {
    yield {
      type: 'finish',
      reason: { kind: 'error', message: `Codex 请求失败 (${res.status})` },
    }
    return
  }

  // 5. Update quota from response headers
  const responseHeaders: Record<string, string> = {}
  res.headers.forEach((value, key) => { responseHeaders[key] = value })
  updateQuota(responseHeaders)

  // 6. Parse stream and yield chunks
  const bodyStream = res.body
  if (bodyStream === null) {
    yield {
      type: 'finish',
      reason: { kind: 'error', message: 'Codex 响应没有 body' },
    }
    return
  }

  // Convert ReadableStream to AsyncIterable<string | Uint8Array>
  const reader = bodyStream.getReader()
  const decoder = new TextDecoder()
  let textIndex = -1
  let reasoningIndex = -1
  let toolIndex = -1

  async function* toAsyncIterable(): AsyncGenerator<string | Uint8Array> {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      yield value
    }
  }

  try {
    for await (const event of parseResponsesStream(toAsyncIterable())) {
      switch (event.type) {
        case 'text': {
          if (textIndex === -1) {
            textIndex++
            yield { type: 'block-start', index: textIndex, blockType: 'text' }
          }
          yield { type: 'text-delta', index: textIndex, text: event.text }
          break
        }
        case 'reasoning': {
          if (reasoningIndex === -1) {
            reasoningIndex++
            yield { type: 'block-start', index: reasoningIndex, blockType: 'reasoning' }
          }
          yield { type: 'reasoning-delta', index: reasoningIndex, text: event.text }
          break
        }
        case 'tool_call': {
          toolIndex++
          yield { type: 'block-start', index: toolIndex, blockType: 'tool-call' }
          yield { type: 'tool-call-delta', index: toolIndex, id: event.id, name: event.name, argumentsDelta: event.arguments }
          yield { type: 'block-end', index: toolIndex, block: { type: 'tool-call', id: event.id, name: event.name } }
          break
        }
        case 'finish': {
          yield { type: 'finish', reason: { kind: event.reason } }
          return
        }
        case 'error': {
          yield { type: 'finish', reason: { kind: 'error', message: event.message } }
          return
        }
      }
    }
  } catch (err) {
    if (err instanceof CodexStreamError) {
      yield { type: 'finish', reason: { kind: 'error', message: err.message } }
    } else {
      yield { type: 'finish', reason: { kind: 'error', message: 'Codex 流式响应解析失败' } }
    }
  }
}
