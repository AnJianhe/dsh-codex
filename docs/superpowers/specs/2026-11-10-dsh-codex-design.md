# dsh-codex — Direct Codex Model Row Design

## Goal

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin (`@goodjin2/dsh-codex`) that puts **Codex** (ChatGPT subscription) models into DSH as a **model row** — DSH's own loop stays in charge (its tools, its approvals, its orchestration); this row only answers "what does the model say next" by calling OpenAI's `/responses` endpoint directly over HTTP POST, authenticated with the local Codex CLI's OAuth credential.

No ACP transport, no child process, no `codex-acp` runtime dependency, no WASM signing. Requests are plain HTTPS with a Bearer token from `~/.codex/auth.json`.

## Architecture

### Three layers

1. **`src/codex/`** — credential management, catalog, request building, streaming, quota extraction
2. **`src/modelkit/`** — model-row machinery (adapter, provider route, runtime ledger, effort folding, selection), adapted from `dsh-qoder`
3. **`src/client/`** — browser-side settings section (account status, model checklist, re-login)

### Host-side mount

- `src/entry.ts` — empty host-side entry (browser code is in `lib/client.js`)
- `cordis.patch.yml` — two rows:
  - `acp-codex-global` — the model row preset (presetId, agent, hideFromRoster, collapseEfforts, efforts union, static model fallback list)
  - `acp-codex-quota` — the quota route (webServer route serving cached `x-codex-*` headers)

## Components

### `src/codex/auth.ts`

Reads and refreshes `~/.codex/auth.json`:

- **`loadCredential(home?)`** — reads `~/.codex/auth.json`, returns `{ accessToken, refreshToken, accountId, expiresAt }` or `undefined` if missing/malformed
- **`refreshCredential(credential, home?)`** — POSTs to the Codex token refresh endpoint with `{ refresh_token, client_id }`, writes the new token set back to `~/.codex/auth.json`, returns updated credential. The refresh endpoint and client_id are derived from the codex CLI's behavior (observable from the access token's `client_id` claim: `app_EMoamEEZ73f0CkXaXp7hrann`).
- File I/O: `0600` permissions on the file, `0700` on the directory (matching the CLI's own behavior)

### `src/codex/endpoints.ts`

Constants and URL derivation:

- `CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses'`
- `CODEX_REFRESH_URL` — the OAuth token refresh endpoint
- `CODEX_CLIENT_ID` — from the access token's `client_id` claim
- `CODEX_UA_VERSION` — user-agent version string (matching the CLI's `codex_cli_rs/<version>`)
- `buildHeaders(credential, model?)` — constructs the request headers: `Authorization: Bearer <token>`, `chatgpt-account-id: <accountId>`, `originator: codex_cli_rs`, `user-agent: codex_cli_rs/<version>`, `Content-Type: application/json`, `Accept: text/event-stream`
- `parseQuotaHeaders(headers)` — extracts `x-codex-primary-used-percent`, `x-codex-primary-window-minutes`, `x-codex-primary-reset-after-seconds`, `x-codex-secondary-used-percent`, `x-codex-secondary-window-minutes`, `x-codex-secondary-reset-after-seconds`, `x-codex-plan-type`, `x-codex-credits-has-credits`, `x-codex-credits-balance` from a response's headers into a `CodexQuota` object

### `src/codex/catalog.ts`

Reads the model catalog:

- **`loadCatalog(home?)`** — reads `~/.codex/models_cache.json`, returns `CodexModel[]` with `{ id, name, description, contextWindow, efforts }` parsed from the cache entries. Returns `[]` if missing/malformed.
- **`BUILTIN_MODELS`** — static fallback list (the models verified in the investigation: gpt-6.1-sol, gpt-6-astra, gpt-6.1-terra, gpt-6-sol, gpt-6-luna, gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna, with their context windows and effort levels)
- `CodexModel` type: `{ id: string; name: string; description?: string; contextWindow: number; efforts: readonly string[] }`

### `src/codex/request.ts`

Builds the `/responses` request body:

- **`buildResponsesBody(input)`** — converts a DSH `ModelTurnRequest` into the Codex `/responses` JSON body:
  - `model`: the model slug
  - `instructions`: the system prompt (if any)
  - `input`: array of message items (`{ type: 'message', role: 'user'|'assistant', content: [{ type: 'input_text'|'output_text', text }] }`)
  - `tools`: tool definitions in the format the endpoint expects
  - `reasoning`: `{ effort: '<level>', summary: 'auto' }` when reasoning_effort is set
  - `stream: true`

### `src/codex/stream.ts`

Parses the SSE response stream:

- **`parseResponsesStream(source)`** — async generator that reads the SSE stream and yields `ResponsesEvent` objects:
  - `{ type: 'text'; text: string }` — output text delta
  - `{ type: 'reasoning'; text: string }` — reasoning/thinking delta
  - `{ type: 'tool_call'; id: string; name: string; arguments: string }` — a tool call from the model
  - `{ type: 'finish'; reason: string }` — stream complete
  - `{ type: 'error'; code: string; message: string }` — upstream error

### `src/codex/quota.ts`

Quota caching and serving:

- **`updateQuota(headers)`** — called after each inference response, parses `x-codex-*` headers, stores in a module-level cache with a timestamp
- **`getQuota()`** — returns the cached quota or `undefined`
- **`registerQuotaRoute(ctx)`** — registers a `GET /acp-codex/quota` webServer route. Cache TTL: 30 seconds.

### `src/modelkit/` (adapted from dsh-qoder)

Copied and adapted from `dsh-qoder/src/modelkit/`:

- `types.ts`, `model-row-adapter.ts`, `provider-route.ts`, `runtime-models.ts`, `selection.ts`, `efforts.ts`

### `src/codex-model.ts`

The model plugin entry point:

- Recognizes `presetId === 'acp-codex-global'`
- On each turn: load credential → build request body → POST to `/responses` → parse stream → yield DSH chunks
- On 401: refresh credential → retry once → if still 401, yield error
- After each response: update quota cache
- Publishes the catalog to the model ledger

### `src/client/` (adapted from dsh-qoder)

Browser-side settings section:

- `index.ts`, `account-panel.tsx`, `model-checklist.tsx`, `locales.ts`

### `src/registry.ts`

Preset config type definition (same shape as `dsh-qoder`'s).

## Data Flow

```
User selects model in DSH
  → DSH calls model row with ModelTurnRequest
    → codex-model.ts: loadCredential() from ~/.codex/auth.json
    → request.ts: buildResponsesBody(turn request)
    → fetch POST https://chatgpt.com/backend-api/codex/responses
      → 200: stream.ts parses SSE → yields chunks back to DSH
        → quota.ts: updateQuota(response.headers)
      → 401: auth.ts refreshCredential() → retry once
        → still 401: yield error "请重新登录"
    → modelkit: publish catalog to runtime ledger
  → DSH displays chunks in UI
```

## Error Handling

- **Missing credential**: yield error "未找到 Codex 登录凭据，请在终端运行 codex login"
- **Expired token (401)**: auto-refresh once → retry → if still 401, yield "Codex 登录已过期，请重新登录"
- **Network error**: yield error with the HTTP status code (no credential leakage)
- **Upstream error frame**: yield the error message
- **Truncated stream**: salvage finish reason if possible, else yield "没有收到结束帧"
- **Missing model cache**: use `BUILTIN_MODELS` fallback
- **All error messages**: credential-safe (no token, no account ID in error text)

## Testing

- **Unit tests** (vitest): all pure functions tested with injected fixtures
- **Integration test**: full turn cycle with a mock `/responses` server
- **Live test** (gated behind `CODEX_LIVE=1`): real credential + real endpoint
- **Wiring test**: asserts mount configuration correctness

## Constraints

- No new npm dependencies (only Node.js built-ins)
- Credential never appears in logs, errors, or route responses
- `~/.codex/auth.json` written with `0600` permissions
- Model catalog read from `~/.codex/models_cache.json` (no network call)
- Effort levels filtered per-model from the catalog
- Static fallback models match the verified catalog

## Scope Boundaries

**Does:** Provide Codex models as a DSH model row, handle auth, parse /responses SSE, show quota pill, provide settings UI.

**Does not:** Replace `dsh-acp-agent`'s `acp-codex` row, provide ACP transport, bundle WASM, spawn the codex binary.
