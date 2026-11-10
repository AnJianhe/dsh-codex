# dsh-codex Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a DSH plugin (`@goodjin2/dsh-codex`) that puts Codex (ChatGPT subscription) models into DSH as a model row, calling the `/responses` HTTP endpoint directly with the local Codex CLI's OAuth credential.

**Architecture:** Three layers mirroring `dsh-qoder`: `src/codex/` (credential, catalog, request, stream, quota), `src/modelkit/` (model-row machinery copied from dsh-qoder), `src/client/` (browser settings section). Host-side entry mounts the model row preset and quota route via cordis.patch.yml.

**Tech Stack:** TypeScript (ESM, NodeNext), vitest, tsdown, schemastery, proper-lockfile. No new npm dependencies beyond what dsh-qoder uses.

**Spec:** `docs/superpowers/specs/2026-11-10-dsh-codex-design.md`

## Global Constraints

- No new npm dependencies beyond: `proper-lockfile`, `@deepseek-ai/schemastery`, peer DSH client UI packages, dev tooling (typescript, vitest, tsdown, lightningcss)
- Credential (access token, refresh token, account ID) never appears in logs, error messages, or route responses
- `~/.codex/auth.json` written with `0600` permissions, directory `0700`
- Model catalog read from `~/.codex/models_cache.json` (no network call for catalog)
- Effort levels filtered per-model from the catalog (not a global union in the model row)
- Static fallback models match the verified catalog from the 2026-11-10 investigation
- All error messages in Chinese, credential-safe
- Package name: `@goodjin2/dsh-codex`, presetId: `acp-codex-global`

## Review Focus

1. **Token leakage in error paths** — any thrown error, logged message, or route response must not contain the access token, refresh token, or account ID. Test: assert error strings do not contain known token substrings.
2. **401 refresh loop** — on HTTP 401 from `/responses`, the plugin must refresh the token exactly once and retry; a second 401 must yield "登录已过期" and not loop. Test: inject 401-then-200 and 401-then-401 fetch stubs.
3. **Truncated SSE stream** — if the upstream closes the connection mid-frame, salvage `finish_reason` if present; otherwise throw "没有收到结束帧". Test: feed a truncated final frame.
4. **Missing credential** — if `~/.codex/auth.json` is absent or malformed, yield a clear "未找到 Codex 登录凭据" error, not a crash. Test: inject a missing file path.
5. **Quota header parsing** — `x-codex-*` headers may be absent (e.g., cached response, proxy stripping); quota route must return `ok: false` gracefully, not crash. Test: inject a response with no `x-codex-*` headers.

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `tsconfig.json`, `tsdown.config.ts`, `vitest.config.ts`, `.gitignore`, `LICENSE`
- Create: `src/entry.ts` (stub — just `name` and empty `apply`)
- Create: `cordis.patch.yml` (stub — empty insert)
- Test: `tests/scaffold.spec.ts`

**Interfaces:**
- Produces: a project that passes `pnpm typecheck` and `pnpm test` with zero tests failing (scaffold test asserts `name === '@goodjin2/dsh-codex'`)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/scaffold.spec.ts
import { name } from '../src/entry.ts'
import { describe, it, expect } from 'vitest'
describe('scaffold', () => {
  it('exports the correct plugin name', () => {
    expect(name).toBe('@goodjin2/dsh-codex')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/scaffold.spec.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Create project scaffold**

Create all config files mirroring dsh-qoder's structure:
- `package.json` — name `@goodjin2/dsh-codex`, same scripts/deps/peerDeps as dsh-qoder, no WASM files, add `codex-quota` and `codex-routes` subpath exports
- `tsconfig.base.json` — identical to dsh-qoder
- `tsconfig.json` — extends base, `outDir: "lib"`, include src and tests
- `tsdown.config.ts` — adapted from dsh-qoder (change id to `@goodjin2/dsh-codex`, cssPrefix to `\0codex-css:`)
- `vitest.config.ts` — standard vitest config with node environment
- `.gitignore` — `node_modules/`, `lib/`, `*.js.map`
- `LICENSE` — MIT
- `src/entry.ts` — stub with `export const name = '@goodjin2/dsh-codex'` and empty `apply`
- `cordis.patch.yml` — stub with empty insert section

- [ ] **Step 4: Install dependencies and run test**

Run: `pnpm install && pnpm exec vitest run tests/scaffold.spec.ts`
Expected: PASS

- [ ] **Step 5: Run typecheck**

Run: `pnpm typecheck`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: project scaffold for dsh-codex"
```

---

### Task 2: Codex Auth (Credential Read + Refresh)

**Files:**
- Create: `src/codex/auth.ts`
- Test: `tests/codex-auth.spec.ts`

**Interfaces:**
- Produces:
  - `type CodexCredential = { accessToken: string; refreshToken?: string; accountId: string; expiresAt?: number }`
  - `loadCredential(options?: { home?: string }): Promise<CodexCredential | undefined>`
  - `refreshCredential(credential: CodexCredential, options?: { home?: string; fetchImpl?: typeof fetch }): Promise<CodexCredential>`
  - `CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'`
  - `CODEX_REFRESH_URL = 'https://auth.openai.com/oauth/token'`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/codex-auth.spec.ts
import { describe, it, expect, vi } from 'vitest'
import { loadCredential, refreshCredential, CODEX_CLIENT_ID, CODEX_REFRESH_URL } from '../src/codex/auth.ts'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'

async function makeTempHome(): Promise<string> {
  const dir = join(tmpdir(), `codex-auth-test-${randomBytes(4).toString('hex')}`)
  await mkdir(dir, { recursive: true })
  return dir
}

describe('loadCredential', () => {
  it('returns undefined when auth.json is missing', async () => {
    const home = await makeTempHome()
    const result = await loadCredential({ home })
    expect(result).toBeUndefined()
  })

  it('returns credential from a valid auth.json', async () => {
    const home = await makeTempHome()
    await mkdir(join(home, '.codex'), { recursive: true })
    await writeFile(join(home, '.codex', 'auth.json'), JSON.stringify({
      auth_mode: 'chatgpt',
      tokens: {
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        account_id: 'test-account-id',
      },
      last_refresh: '2026-11-07T13:23:44.637165Z',
    }), { mode: 0o600 })
    const result = await loadCredential({ home })
    expect(result).toBeDefined()
    expect(result!.accessToken).toBe('test-access-token')
    expect(result!.refreshToken).toBe('test-refresh-token')
    expect(result!.accountId).toBe('test-account-id')
  })

  it('returns undefined for malformed auth.json', async () => {
    const home = await makeTempHome()
    await mkdir(join(home, '.codex'), { recursive: true })
    await writeFile(join(home, '.codex', 'auth.json'), 'not json', { mode: 0o600 })
    const result = await loadCredential({ home })
    expect(result).toBeUndefined()
  })

  it('returns undefined when tokens are missing', async () => {
    const home = await makeTempHome()
    await mkdir(join(home, '.codex'), { recursive: true })
    await writeFile(join(home, '.codex', 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt' }), { mode: 0o600 })
    const result = await loadCredential({ home })
    expect(result).toBeUndefined()
  })
})

describe('refreshCredential', () => {
  it('posts refresh_token and writes new tokens back', async () => {
    const home = await makeTempHome()
    await mkdir(join(home, '.codex'), { recursive: true })
    await writeFile(join(home, '.codex', 'auth.json'), JSON.stringify({
      auth_mode: 'chatgpt',
      tokens: { access_token: 'old', refresh_token: 'rt', account_id: 'acc' },
      last_refresh: '2026-11-07T00:00:00Z',
    }), { mode: 0o600 })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 86400,
      }),
    })
    const result = await refreshCredential(
      { accessToken: 'old', refreshToken: 'rt', accountId: 'acc' },
      { home, fetchImpl: fetchMock as unknown as typeof fetch },
    )
    expect(result.accessToken).toBe('new-access')
    expect(fetchMock).toHaveBeenCalledWith(
      CODEX_REFRESH_URL,
      expect.objectContaining({ method: 'POST' }),
    )
    const written = JSON.parse(await readFile(join(home, '.codex', 'auth.json'), 'utf8'))
    expect(written.tokens.access_token).toBe('new-access')
  })

  it('throws on refresh failure', async () => {
    const home = await makeTempHome()
    await mkdir(join(home, '.codex'), { recursive: true })
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400 })
    await expect(refreshCredential(
      { accessToken: 'old', refreshToken: 'rt', accountId: 'acc' },
      { home, fetchImpl: fetchMock as unknown as typeof fetch },
    )).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/codex-auth.spec.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `src/codex/auth.ts`**

Implement `loadCredential` (reads `~/.codex/auth.json`, returns `CodexCredential` or `undefined`) and `refreshCredential` (POSTs to `CODEX_REFRESH_URL` with `{ client_id, grant_type: 'refresh_token', refresh_token }`, writes updated tokens back to `~/.codex/auth.json` with `0600` permissions, returns new credential). Handle missing `refreshToken` by throwing "Codex 登录已过期，请重新登录".

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/codex-auth.spec.ts`
Expected: PASS (all 6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/codex/auth.ts tests/codex-auth.spec.ts
git commit -m "feat(codex): OAuth credential read and refresh"
```

---

### Task 3: Codex Endpoints + Quota Header Parsing

**Files:**
- Create: `src/codex/endpoints.ts`
- Test: `tests/codex-endpoints.spec.ts`

**Interfaces:**
- Consumes: `CodexCredential` from auth (Task 2)
- Produces:
  - `CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses'`
  - `CODEX_UA_VERSION = '0.166.0'`
  - `buildHeaders(credential: CodexCredential, model?: string): Record<string, string>`
  - `type CodexQuota = { planType?: string; primaryPercent?: number; primaryWindowMinutes?: number; primaryResetAfterSeconds?: number; secondaryPercent?: number; secondaryWindowMinutes?: number; secondaryResetAfterSeconds?: number; creditsHasCredits?: boolean; creditsBalance?: number }`
  - `parseQuotaHeaders(headers: Record<string, string>): CodexQuota | undefined`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/codex-endpoints.spec.ts
import { describe, it, expect } from 'vitest'
import { CODEX_RESPONSES_URL, CODEX_UA_VERSION, buildHeaders, parseQuotaHeaders } from '../src/codex/endpoints.ts'
import type { CodexCredential } from '../src/codex/auth.ts'

const cred: CodexCredential = { accessToken: 'tok123', refreshToken: 'rt', accountId: 'acc-123' }

describe('buildHeaders', () => {
  it('includes Authorization, account-id, originator, user-agent', () => {
    const h = buildHeaders(cred)
    expect(h['Authorization']).toBe('Bearer tok123')
    expect(h['chatgpt-account-id']).toBe('acc-123')
    expect(h['originator']).toBe('codex_cli_rs')
    expect(h['user-agent']).toBe(`codex_cli_rs/${CODEX_UA_VERSION}`)
    expect(h['Content-Type']).toBe('application/json')
    expect(h['Accept']).toBe('text/event-stream')
  })
})

describe('parseQuotaHeaders', () => {
  it('extracts quota fields from x-codex-* headers', () => {
    const q = parseQuotaHeaders({
      'x-codex-plan-type': 'pro',
      'x-codex-primary-used-percent': '42',
      'x-codex-primary-window-minutes': '10080',
      'x-codex-primary-reset-after-seconds': '532360',
      'x-codex-secondary-used-percent': '10',
      'x-codex-credits-has-credits': 'False',
    })
    expect(q).toBeDefined()
    expect(q!.planType).toBe('pro')
    expect(q!.primaryPercent).toBe(42)
    expect(q!.primaryWindowMinutes).toBe(10080)
    expect(q!.creditsHasCredits).toBe(false)
  })

  it('returns undefined when no x-codex-* headers present', () => {
    const q = parseQuotaHeaders({ 'content-type': 'text/event-stream' })
    expect(q).toBeUndefined()
  })

  it('handles partial headers gracefully', () => {
    const q = parseQuotaHeaders({ 'x-codex-plan-type': 'plus' })
    expect(q).toBeDefined()
    expect(q!.planType).toBe('plus')
    expect(q!.primaryPercent).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/codex-endpoints.spec.ts`
Expected: FAIL

- [ ] **Step 3: Implement `src/codex/endpoints.ts`**

`buildHeaders` returns the 6 headers. `parseQuotaHeaders` scans for keys starting with `x-codex-`, maps them to the `CodexQuota` type (string → number via `Number()`, `has-credits` → boolean via `=== 'True'`), returns `undefined` if no `x-codex-*` keys found.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/codex-endpoints.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/codex/endpoints.ts tests/codex-endpoints.spec.ts
git commit -m "feat(codex): endpoints and quota header parsing"
```

---

### Task 4: Codex Model Catalog

**Files:**
- Create: `src/codex/catalog.ts`
- Test: `tests/codex-catalog.spec.ts`

**Interfaces:**
- Produces:
  - `type CodexModel = { id: string; name: string; description?: string; contextWindow: number; efforts: readonly string[] }`
  - `loadCatalog(options?: { home?: string }): Promise<readonly CodexModel[]>`
  - `BUILTIN_MODELS: readonly CodexModel[]`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/codex-catalog.spec.ts
import { describe, it, expect } from 'vitest'
import { loadCatalog, BUILTIN_MODELS } from '../src/codex/catalog.ts'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'

async function makeTempHome(): Promise<string> {
  return join(tmpdir(), `codex-cat-test-${randomBytes(4).toString('hex')}`)
}

describe('loadCatalog', () => {
  it('returns empty array when models_cache.json is missing', async () => {
    const home = await makeTempHome()
    const result = await loadCatalog({ home })
    expect(result).toEqual([])
  })

  it('parses models from models_cache.json', async () => {
    const home = await makeTempHome()
    const codexDir = join(home, '.codex')
    await mkdir(codexDir, { recursive: true })
    await writeFile(join(codexDir, 'models_cache.json'), JSON.stringify({
      models: [
        { slug: 'gpt-6.1-sol', display_name: 'GPT-6.1-Sol', description: 'Latest.', context_window: 500000, supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }], supported_in_api: true, visibility: 'list' },
        { slug: 'gpt-reserve', display_name: 'Reserve', context_window: 272000, supported_reasoning_levels: [{ effort: 'low' }], supported_in_api: true, visibility: 'hide' },
      ],
    }))
    const result = await loadCatalog({ home })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('gpt-6.1-sol')
    expect(result[0].contextWindow).toBe(500000)
    expect(result[0].efforts).toContain('high')
  })

  it('returns empty array for malformed cache', async () => {
    const home = await makeTempHome()
    await mkdir(join(home, '.codex'), { recursive: true })
    await writeFile(join(home, '.codex', 'models_cache.json'), 'not json')
    const result = await loadCatalog({ home })
    expect(result).toEqual([])
  })
})

describe('BUILTIN_MODELS', () => {
  it('contains verified models from investigation', () => {
    const ids = BUILTIN_MODELS.map(m => m.id)
    expect(ids).toContain('gpt-6.1-sol')
    expect(ids).toContain('gpt-6-astra')
    expect(BUILTIN_MODELS.length).toBeGreaterThanOrEqual(5)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/codex-catalog.spec.ts`
Expected: FAIL

- [ ] **Step 3: Implement `src/codex/catalog.ts`**

`loadCatalog` reads `~/.codex/models_cache.json`, filters to `visibility: 'list'` and `supported_in_api: true`, maps `slug` → `id`, `display_name` → `name`, extracts `efforts` from `supported_reasoning_levels[*].effort`. `BUILTIN_MODELS` is a hardcoded list: gpt-6.1-sol (500k), gpt-6-astra (272k), gpt-6.1-terra (500k), gpt-6-sol (272k), gpt-6-luna (272k), gpt-5.6-sol (272k), gpt-5.6-terra (272k), gpt-5.6-luna (272k) — all with efforts `['low','medium','high','xhigh','max','ultra']` except 5.6 variants which have `['low','medium','high','xhigh','max']`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/codex-catalog.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/codex/catalog.ts tests/codex-catalog.spec.ts
git commit -m "feat(codex): model catalog from local cache with fallback"
```

---

### Task 5: Codex Request Builder + SSE Stream Parser

**Files:**
- Create: `src/codex/request.ts`, `src/codex/stream.ts`
- Test: `tests/codex-request.spec.ts`, `tests/codex-stream.spec.ts`

**Interfaces:**
- Produces:
  - `buildResponsesBody(input: { model: string; messages: readonly { role: string; content: string }[]; system?: string; tools?: readonly { name: string; description?: string; parameters?: Record<string, unknown> }[]; reasoningEffort?: string; maxTokens?: number }): Record<string, unknown>`
  - `type ResponsesEvent = { type: 'text'; text: string } | { type: 'reasoning'; text: string } | { type: 'tool_call'; id: string; name: string; arguments: string } | { type: 'finish'; reason: string } | { type: 'error'; code: string; message: string }`
  - `parseResponsesStream(source: AsyncIterable<string | Uint8Array>): AsyncGenerator<ResponsesEvent>`
  - `class CodexStreamError extends Error`

- [ ] **Step 1: Write the failing tests for request builder**

```typescript
// tests/codex-request.spec.ts
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
    expect(input[0].content[0].type).toBe('input_text')
    expect(input[1].content[0].type).toBe('output_text')
  })
})
```

- [ ] **Step 2: Write the failing tests for stream parser**

```typescript
// tests/codex-stream.spec.ts
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
    ]))) events.push(e)
    expect(events).toEqual([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' world' },
    ])
  })

  it('parses reasoning delta events', async () => {
    const events: unknown[] = []
    for await (const e of parseResponsesStream(mockSSE([
      'data: {"type":"response.reasoning_summary_text.delta","delta":"Thinking..."}\n',
    ]))) events.push(e)
    expect(events).toEqual([{ type: 'reasoning', text: 'Thinking...' }])
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/codex-request.spec.ts tests/codex-stream.spec.ts`
Expected: FAIL

- [ ] **Step 4: Implement `src/codex/request.ts` and `src/codex/stream.ts`**

`request.ts`: `buildResponsesBody` maps DSH messages to Codex `/responses` input format. User messages → `content: [{ type: 'input_text', text }]`, assistant → `content: [{ type: 'output_text', text }]`. System → `instructions`. Reasoning effort → `reasoning: { effort, summary: 'auto' }`. Always `stream: true`.

`stream.ts`: `parseResponsesStream` reads SSE lines, parses `data:` payloads. Maps `response.output_text.delta` → `{ type: 'text', text: delta }`, `response.reasoning_summary_text.delta` → `{ type: 'reasoning', text: delta }`, `response.function_call_arguments.delta` → buffer per item_id (emit on `response.output_item.done`), `error` → `{ type: 'error', code, message }`, `response.completed` → `{ type: 'finish', reason: 'stop' }`. Throws `CodexStreamError` if stream ends without completed/finish and no finish_reason salvaged.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/codex-request.spec.ts tests/codex-stream.spec.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/codex/request.ts src/codex/stream.ts tests/codex-request.spec.ts tests/codex-stream.spec.ts
git commit -m "feat(codex): request builder and SSE stream parser"
```

---

### Task 6: Model Kit (adapted from dsh-qoder)

**Files:**
- Create: `src/modelkit/types.ts`, `src/modelkit/provider-route.ts`, `src/modelkit/runtime-models.ts`, `src/modelkit/efforts.ts`, `src/modelkit/selection.ts`, `src/modelkit/model-row-adapter.ts`, `src/modelkit/index.ts`
- Test: `tests/modelkit-efforts.spec.ts`

**Interfaces:**
- Produces: identical exports to `dsh-qoder/src/modelkit/` — `ModelTurnRequest`, `ModelStreamChunk`, `CatalogModel`, `CatalogEffort`, `providerRoute`, `runtimeModels`, `collapseEfforts`, `readSelection`, `modelRowAdapter`, `ReportedModel`

- [ ] **Step 1: Write the failing test for effort folding**

```typescript
// tests/modelkit-efforts.spec.ts
import { describe, it, expect } from 'vitest'
import { collapseEfforts } from '../src/modelkit/efforts.ts'

describe('collapseEfforts', () => {
  it('collapses base[effort] ids into one entry with efforts array', () => {
    const models = [
      { id: 'gpt-6.1-sol[low]', name: '6.1 Sol (low)' },
      { id: 'gpt-6.1-sol[high]', name: '6.1 Sol (high)' },
      { id: 'gpt-6-astra[medium]', name: '6 Astra (medium)' },
    ]
    const result = collapseEfforts(models)
    expect(result).toHaveLength(2)
    const sol = result.find(m => m.baseId === 'gpt-6.1-sol')
    expect(sol).toBeDefined()
    expect(sol!.efforts).toHaveLength(2)
  })

  it('keeps bare ids as-is', () => {
    const models = [{ id: 'auto', name: 'Auto' }]
    const result = collapseEfforts(models)
    expect(result).toHaveLength(1)
    expect(result[0].efforts).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/modelkit-efforts.spec.ts`
Expected: FAIL

- [ ] **Step 3: Copy and adapt modelkit from dsh-qoder**

Copy all 7 files from `dsh-qoder/src/modelkit/` into `dsh-codex/src/modelkit/`. Rename internal references from "qoder" to "codex" in comments. The effort folding regex and logic remain identical.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/modelkit-efforts.spec.ts`
Expected: PASS

- [ ] **Step 5: Run typecheck**

Run: `pnpm typecheck`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/modelkit/ tests/modelkit-efforts.spec.ts
git commit -m "feat(modelkit): model row machinery adapted from dsh-qoder"
```

---

### Task 7: Codex Model Plugin (Stream Adapter)

**Files:**
- Create: `src/codex-model.ts`, `src/registry.ts`
- Test: `tests/codex-model.spec.ts`

**Interfaces:**
- Consumes: `ModelTurnRequest`, `ModelStreamChunk` from modelkit; `loadCredential`, `refreshCredential` from auth; `buildHeaders` from endpoints; `buildResponsesBody` from request; `parseResponsesStream` from stream; `loadCatalog` from catalog; `parseQuotaHeaders` from endpoints
- Produces:
  - `type CodexReportedModel = { id: string; name: string; description?: string; contextWindow?: number }`
  - `codexModelStream(config: PresetConfig, deps?: { onRuntimeModels?: (presetId: string, models: CodexReportedModel[]) => void }): (presetId: string, request: ModelTurnRequest) => AsyncGenerator<ModelStreamChunk>`
  - `mergeDeclaredModels(declared: readonly { id: string; name: string; description?: string; contextWindow?: number }[], runtime: readonly CodexReportedModel[]): CodexReportedModel[]`
  - `refreshCodexModels(): Promise<void>`
  - `type PresetConfig = { presets: Record<string, { agent?: string; models?: { id: string; name: string; description?: string; contextWindow?: number }[] }> }`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/codex-model.spec.ts
import { describe, it, expect } from 'vitest'
import { codexModelStream, mergeDeclaredModels } from '../src/codex-model.ts'
import type { PresetConfig } from '../src/registry.ts'

const presetConfig: PresetConfig = {
  presets: {
    'acp-codex-global': {
      agent: 'codex-global',
      models: [{ id: 'gpt-6-astra', name: 'GPT-6 Astra', contextWindow: 272000 }],
    },
  },
}

describe('mergeDeclaredModels', () => {
  it('prefers runtime metadata, falls back to declared', () => {
    const declared = [
      { id: 'gpt-6-astra', name: 'GPT-6 Astra', contextWindow: 272000 },
      { id: 'old-model', name: 'Old Model', contextWindow: 100000 },
    ]
    const runtime = [{ id: 'gpt-6-astra', name: 'GPT-6 Astra (updated)', contextWindow: 280000 }]
    const merged = mergeDeclaredModels(declared, runtime)
    expect(merged).toHaveLength(2)
    const astra = merged.find(m => m.id === 'gpt-6-astra')!
    expect(astra.name).toBe('GPT-6 Astra (updated)')
    expect(astra.contextWindow).toBe(280000)
  })
})

describe('codexModelStream', () => {
  it('returns undefined for non-codex preset', () => {
    const stream = codexModelStream(presetConfig)
    const result = stream('other-preset', { provider: 'x', model: 'y' })
    expect(result).toBeUndefined()
  })

  it('returns a generator for acp-codex-global preset', () => {
    const stream = codexModelStream(presetConfig)
    const result = stream('acp-codex-global', { provider: 'acp:acp-codex-global', model: 'gpt-6-astra' })
    expect(result).toBeDefined()
    expect(typeof result!.next).toBe('function')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/codex-model.spec.ts`
Expected: FAIL

- [ ] **Step 3: Implement `src/registry.ts` and `src/codex-model.ts`**

`registry.ts`: `PresetConfig` type (same shape as dsh-qoder's, with `agent?: string` and `models?`).

`codex-model.ts`: The stream function:
1. Checks `preset.agent === 'codex-global'`
2. Loads credential via `loadCredential()` — if undefined, yield error chunk "未找到 Codex 登录凭据，请在终端运行 codex login"
3. Builds request body via `buildResponsesBody()`
4. POSTs to `CODEX_RESPONSES_URL` with `buildHeaders()` and `signal` from request
5. On 401: `refreshCredential()` → retry once → if still 401, yield finish with error "Codex 登录已过期，请重新登录"
6. Parses response via `parseResponsesStream()`
7. Maps `ResponsesEvent` → `ModelStreamChunk`: text → `text-delta`, reasoning → `reasoning-delta`, tool_call → `tool-call-delta`, finish → `finish`, error → `finish` with error reason
8. After response: `parseQuotaHeaders(Object.fromEntries(response.headers))` → `updateQuota()`
9. Publishes catalog to runtime ledger via `onRuntimeModels`

Also implement `mergeDeclaredModels` (runtime wins, declared fills gaps) and `refreshCodexModels` (reloads catalog, republishes).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/codex-model.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/codex-model.ts src/registry.ts tests/codex-model.spec.ts
git commit -m "feat(codex): model plugin stream adapter"
```

---

### Task 8: Quota Route + Host Entry + Cordis Patch

**Files:**
- Create: `src/codex/quota.ts`
- Modify: `src/entry.ts` (replace stub with full implementation)
- Modify: `cordis.patch.yml` (replace stub with full rows)
- Test: `tests/codex-quota.spec.ts`, `tests/codex-wiring.spec.ts`

**Interfaces:**
- Consumes: `getQuota` from quota.ts; `codexModelStream` from codex-model; `runtimeModels`, `modelRowAdapter`, `providerRoute` from modelkit
- Produces:
  - `updateQuota(headers: Record<string, string>): void`
  - `getQuota(): CodexQuota | undefined`
  - `registerQuotaRoute(ctx: { effect: Function; webServer: { register: Function } }): void`
  - `apply(ctx: unknown, config: Config): void` in entry.ts
  - Two rows in `cordis.patch.yml`: model row + quota route

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/codex-quota.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { updateQuota, getQuota, registerQuotaRoute } from '../src/codex/quota.ts'

describe('quota cache and route', () => {
  it('stores and returns quota from headers', () => {
    updateQuota({ 'x-codex-plan-type': 'pro', 'x-codex-primary-used-percent': '55' })
    const q = getQuota()
    expect(q).toBeDefined()
    expect(q!.planType).toBe('pro')
    expect(q!.primaryPercent).toBe(55)
  })

  it('registers a GET route', () => {
    const registered: { path: string }[] = []
    const ctx = {
      effect: (fn: () => unknown) => fn(),
      webServer: { register: (route: { path: string }) => { registered.push(route); return () => {} } },
    }
    registerQuotaRoute(ctx)
    expect(registered).toHaveLength(1)
    expect(registered[0].path).toBe('/acp-codex/quota')
  })
})
```

```typescript
// tests/codex-wiring.spec.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

describe('wiring', () => {
  it('cordis.patch.yml has acp-codex-global row', () => {
    const content = readFileSync(fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)), 'utf8')
    expect(content).toContain('acp-codex-global')
    expect(content).toContain('collapseEfforts')
  })

  it('cordis.patch.yml has acp-codex-quota row', () => {
    const content = readFileSync(fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)), 'utf8')
    expect(content).toContain('acp-codex-quota')
  })

  it('package.json declares dsh.bundle.patch and dsh.client.platform', () => {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))
    expect(pkg.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(pkg.dsh.client.platform).toBe('web')
  })

  it('entry.ts exports name and apply', () => {
    const content = readFileSync(fileURLToPath(new URL('../src/entry.ts', import.meta.url)), 'utf8')
    expect(content).toContain("export const name = '@goodjin2/dsh-codex'")
    expect(content).toContain('export function apply')
    expect(content).toContain('modelRowAdapter')
    expect(content).toContain('providerRoute')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/codex-quota.spec.ts tests/codex-wiring.spec.ts`
Expected: FAIL

- [ ] **Step 3: Implement quota.ts, entry.ts (full), cordis.patch.yml**

`quota.ts`: module-level cache. `updateQuota` parses and stores. `getQuota` returns cached or undefined. `registerQuotaRoute` registers `GET /acp-codex/quota` returning `{ ok: true, quota }` or `{ ok: false, error: '尚无推理数据' }`.

`entry.ts` (full): exports `name`, `Config` schema, `apply(ctx, config)` — builds PresetConfig, creates runtime ledger, creates modelRowAdapter with codexModelStream, gets host LLM registry, registers adapter. Same pattern as dsh-qoder's entry.ts.

`cordis.patch.yml`: two rows:
- `acp-codex-global`: presetId, agent `codex-global`, hideFromRoster true, collapseEfforts true, efforts union, static model fallback list
- `acp-codex-quota`: name `@goodjin2/dsh-codex/codex-quota`, inject `['webServer', 'connection']`

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/codex-quota.spec.ts tests/codex-wiring.spec.ts`
Expected: PASS

- [ ] **Step 5: Run full suite and typecheck**

Run: `pnpm typecheck && pnpm test`
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add src/codex/quota.ts src/entry.ts cordis.patch.yml tests/codex-quota.spec.ts tests/codex-wiring.spec.ts
git commit -m "feat: quota route, host entry, and cordis patch wiring"
```

---

### Task 9: Browser Settings Client

**Files:**
- Create: `src/client/index.ts`, `src/client/account-panel.tsx`, `src/client/model-checklist.tsx`, `src/client/locales.ts`
- Test: `tests/codex-client-wiring.spec.ts`

**Interfaces:**
- Produces:
  - `src/client/index.ts` — exports `name` and `apply`
  - `lib/client.js` — built via `pnpm build:client`

- [ ] **Step 1: Write the failing wiring test**

```typescript
// tests/codex-client-wiring.spec.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

describe('client wiring', () => {
  it('package.json exports ./client pointing to lib/client.js', () => {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))
    expect(pkg.exports['./client']).toBeDefined()
    expect(pkg.exports['./client'].default).toContain('lib/client.js')
  })

  it('client index exports name and apply', () => {
    const content = readFileSync(fileURLToPath(new URL('../src/client/index.ts', import.meta.url)), 'utf8')
    expect(content).toContain('export const name')
    expect(content).toContain('export function apply')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/codex-client-wiring.spec.ts`
Expected: FAIL

- [ ] **Step 3: Create client files adapted from dsh-qoder**

Adapt `dsh-qoder/src/client/` files:
- `index.ts` — exports name and apply (registers settings section)
- `account-panel.tsx` — account status card
- `model-checklist.tsx` — model checklist
- `locales.ts` — i18n strings ("Codex 账号", etc.)

- [ ] **Step 4: Build client and run test**

Run: `pnpm build:client && pnpm exec vitest run tests/codex-client-wiring.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/client/ tests/codex-client-wiring.spec.ts
git commit -m "feat(client): browser settings section"
```

---

### Task 10: Host Routes (Session/Models) + Final Integration

**Files:**
- Create: `src/codex-routes.ts`
- Modify: `cordis.patch.yml` (add routes row)
- Test: `tests/codex-routes.spec.ts`, `tests/codex-final.spec.ts`

**Interfaces:**
- Produces:
  - `registerCodexRoutes(ctx: { effect: Function; webServer: { register: Function } }): void`
  - Routes: `GET /acp-codex/session`, `GET/POST /acp-codex/models`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/codex-routes.spec.ts
import { describe, it, expect } from 'vitest'
import { registerCodexRoutes } from '../src/codex-routes.ts'

describe('registerCodexRoutes', () => {
  it('registers session and models routes', () => {
    const registered: { path: string }[] = []
    const ctx = {
      effect: (fn: () => unknown) => fn(),
      webServer: { register: (route: { path: string }) => { registered.push(route); return () => {} } },
    }
    registerCodexRoutes(ctx)
    const paths = registered.map(r => r.path)
    expect(paths).toContain('/acp-codex/session')
    expect(paths).toContain('/acp-codex/models')
  })
})
```

```typescript
// tests/codex-final.spec.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

describe('final wiring', () => {
  it('has all required source files', () => {
    const files = [
      'src/entry.ts', 'src/codex-model.ts', 'src/registry.ts',
      'src/codex/auth.ts', 'src/codex/endpoints.ts', 'src/codex/catalog.ts',
      'src/codex/request.ts', 'src/codex/stream.ts', 'src/codex/quota.ts',
      'src/modelkit/types.ts', 'src/modelkit/index.ts',
      'src/client/index.ts', 'cordis.patch.yml',
    ]
    for (const f of files) {
      readFileSync(fileURLToPath(new URL(`../${f}`, import.meta.url)))
    }
  })

  it('no hardcoded credentials in source', () => {
    const files = ['src/entry.ts', 'src/codex-model.ts', 'src/codex/auth.ts']
    for (const f of files) {
      const content = readFileSync(fileURLToPath(new URL(`../${f}`, import.meta.url)), 'utf8')
      expect(content).not.toMatch(/Bearer [A-Za-z0-9_-]{20,}/)
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/codex-routes.spec.ts tests/codex-final.spec.ts`
Expected: FAIL

- [ ] **Step 3: Implement `src/codex-routes.ts` and update cordis.patch.yml**

`codex-routes.ts`: registers `GET /acp-codex/session` (reads auth.json, returns signed-in status) and `GET/POST /acp-codex/models` (reads catalog + selection, returns models list).

Add `acp-codex-routes` row to `cordis.patch.yml`.

- [ ] **Step 4: Run all tests**

Run: `pnpm typecheck && pnpm test && pnpm build:client`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add src/codex-routes.ts cordis.patch.yml tests/codex-routes.spec.ts tests/codex-final.spec.ts
git commit -m "feat: host routes and final integration test"
```

---

### Task 11: README + Final Verification

**Files:**
- Create: `README.md`, `README.zh.md`

- [ ] **Step 1: Write README.md and README.zh.md**

Brief description, install, configuration, development commands. Mirror dsh-qoder's README structure.

- [ ] **Step 2: Run full suite one final time**

Run: `pnpm typecheck && pnpm test && pnpm build:client`
Expected: all pass

- [ ] **Step 3: Commit**

```bash
git add README.md README.zh.md
git commit -m "docs: README files"
```

---

## Self-Review

**Spec coverage:**
- ✅ Auth (read + refresh) → Task 2
- ✅ Endpoints + quota headers → Task 3
- ✅ Model catalog → Task 4
- ✅ Request builder → Task 5
- ✅ SSE stream parser → Task 5
- ✅ Model kit → Task 6
- ✅ Model plugin stream → Task 7
- ✅ Quota route + host entry + cordis patch → Task 8
- ✅ Browser settings client → Task 9
- ✅ Host routes (session/models) → Task 10
- ✅ README + final verification → Task 11

**Type consistency:** `CodexCredential` (Task 2) consumed in Tasks 3/7/8. `CodexModel` (Task 4) consumed in Tasks 7/8/10. `CodexQuota` (Task 3) consumed in Task 8. `ResponsesEvent` (Task 5) consumed in Task 7. `ModelStreamChunk` from modelkit (Task 6) consumed in Task 7. `PresetConfig` (Task 7) consumed in Task 8.

**Review Focus coverage:**
1. Token leakage → Task 10 (no hardcoded credentials test)
2. 401 refresh loop → Task 7 (stream adapter handles 401-retry-401)
3. Truncated SSE → Task 5 (CodexStreamError)
4. Missing credential → Task 2 (loadCredential returns undefined)
5. Quota header absence → Task 3 (parseQuotaHeaders returns undefined)
