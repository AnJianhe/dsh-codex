import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

/** A Codex model entry. */
export type CodexModel = {
  id: string
  name: string
  description?: string
  contextWindow: number
  efforts: readonly string[]
}

type ModelCacheEntry = {
  slug?: string
  display_name?: string
  description?: string
  context_window?: number
  supported_reasoning_levels?: { effort?: string }[]
  supported_in_api?: boolean
  visibility?: string
}

type ModelCache = {
  models?: ModelCacheEntry[]
}

/**
 * Load the model catalog from `~/.codex/models_cache.json`.
 * Filters to visible, API-supported models. Returns [] if missing or malformed.
 */
export async function loadCatalog(options?: { home?: string }): Promise<readonly CodexModel[]> {
  const home = options?.home ?? homedir()
  const cachePath = join(home, '.codex', 'models_cache.json')
  let raw: string
  try {
    raw = await readFile(cachePath, 'utf8')
  } catch {
    return []
  }
  let parsed: ModelCache
  try {
    parsed = JSON.parse(raw) as ModelCache
  } catch {
    return []
  }
  if (!Array.isArray(parsed.models)) return []
  return parsed.models
    .filter(m => m.visibility === 'list' && m.supported_in_api === true && m.slug)
    .map(m => ({
      id: m.slug!,
      name: m.display_name ?? m.slug!,
      description: m.description,
      contextWindow: m.context_window ?? 0,
      efforts: (m.supported_reasoning_levels ?? [])
        .map(l => l.effort)
        .filter((e): e is string => e !== undefined),
    }))
}

/**
 * Static fallback model list — verified from the 2026-11-10 investigation.
 * Used when models_cache.json is unavailable.
 * GPT-5.6 variants don't support 'ultra' effort; all newer models support the full range.
 */
const FULL_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const
const NO_ULTRA_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

export const BUILTIN_MODELS: readonly CodexModel[] = [
  { id: 'gpt-6.1-sol', name: 'GPT-6.1-Sol', description: '最新旗舰 · 500k 上下文', contextWindow: 500000, efforts: FULL_EFFORTS },
  { id: 'gpt-6.1-terra', name: 'GPT-6.1-Terra', contextWindow: 500000, efforts: FULL_EFFORTS },
  { id: 'gpt-6-astra', name: 'GPT-6-Astra', contextWindow: 272000, efforts: FULL_EFFORTS },
  { id: 'gpt-6-sol', name: 'GPT-6-Sol', contextWindow: 272000, efforts: FULL_EFFORTS },
  { id: 'gpt-6-luna', name: 'GPT-6-Luna', contextWindow: 272000, efforts: FULL_EFFORTS },
  { id: 'gpt-5.6-sol', name: 'GPT-5.6-Sol', contextWindow: 272000, efforts: NO_ULTRA_EFFORTS },
  { id: 'gpt-5.6-terra', name: 'GPT-5.6-Terra', contextWindow: 272000, efforts: NO_ULTRA_EFFORTS },
  { id: 'gpt-5.6-luna', name: 'GPT-5.6-Luna', contextWindow: 272000, efforts: NO_ULTRA_EFFORTS },
]
