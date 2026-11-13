// Run with the target host's Node/Electron runtime and DSH_HOST_BASE set to its package.json.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { modelRowAdapter } from '../lib/src/modelkit/model-row-adapter.js'
const req = createRequire(process.env.DSH_HOST_BASE)
const { LlmRuntime } = await import(pathToFileURL(req.resolve('@deepseek-ai/dsh-llm')).href)
const adapter = modelRowAdapter({
  presetId: 'codex', displayName: 'Codex',
  declaredModels: [{ id: 'test', name: 'Test', contextWindow: 272000 }],
  efforts: [{ id: 'low' }, { id: 'high' }],
})
const runtime = Object.create(LlmRuntime.prototype)
const registration = { adapter, provider: { id: 'acp:codex' } }
runtime.registration = () => registration
for (const effort of [undefined, 'low', 'high']) {
  const config = { provider: 'acp:codex', model: 'test', ...(effort === undefined ? {} : { reasoningEffort: effort }) }
  const prepared = await runtime.prepareCall(config)
  assert.deepEqual(prepared.config, config)
  assert.equal(prepared.context.contextWindow, 272000)
}
await assert.rejects(runtime.prepareCall({ provider: 'acp:codex', model: 'test', reasoningEffort: 'unsupported' }))
console.log('PASS: real host prepareCall preserves default/low/high, rejects unsupported effort, retains context')
