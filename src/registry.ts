/**
 * Preset configuration type — same shape as dsh-qoder's registry.
 * Each preset entry has an optional agent identifier and optional model list.
 */

export type PresetConfig = {
  presets: Record<string, {
    agent?: string
    models?: { id: string; name: string; description?: string; contextWindow?: number }[]
  }>
}
