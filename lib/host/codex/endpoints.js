/** Codex /responses endpoint URL. */
export const CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses';
/** User-Agent version string matching the Codex CLI. */
export const CODEX_UA_VERSION = '0.166.0';
/** Build request headers for the Codex /responses endpoint. */
export function buildHeaders(credential, _model) {
    return {
        'Authorization': `Bearer ${credential.accessToken}`,
        'chatgpt-account-id': credential.accountId,
        'originator': 'codex_cli_rs',
        'user-agent': `codex_cli_rs/${CODEX_UA_VERSION}`,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
    };
}
export const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
function record(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function number(value) {
    if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim()))
        return undefined;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
}
function bool(value) {
    if (typeof value === 'boolean')
        return value;
    if (typeof value === 'string' && /^(true|false)$/i.test(value))
        return value.toLowerCase() === 'true';
    return undefined;
}
function compact(value) {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
}
function reset(at, after, now) {
    const absolute = number(at), seconds = number(after);
    return absolute ?? (seconds === undefined ? undefined : Math.floor(now / 1000) + seconds);
}
/** Official response header names, including absolute reset-at (not a sliding countdown). */
export function parseQuotaHeaders(headers, now = Date.now()) {
    const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    return compact({
        planType: h['x-codex-plan-type'] || undefined,
        primaryPercent: number(h['x-codex-primary-used-percent']),
        primaryWindowMinutes: number(h['x-codex-primary-window-minutes']),
        primaryResetAt: reset(h['x-codex-primary-reset-at'], h['x-codex-primary-reset-after-seconds'], now),
        secondaryPercent: number(h['x-codex-secondary-used-percent']),
        secondaryWindowMinutes: number(h['x-codex-secondary-window-minutes']),
        secondaryResetAt: reset(h['x-codex-secondary-reset-at'], h['x-codex-secondary-reset-after-seconds'], now),
        creditsHasCredits: bool(h['x-codex-credits-has-credits']),
        creditsUnlimited: bool(h['x-codex-credits-unlimited']),
        creditsBalance: number(h['x-codex-credits-balance']),
    });
}
/** Parse only the ordinary Codex limits; do not mix additional/model-specific limits into them. */
export function parseUsageQuota(payload, now = Date.now()) {
    const p = record(payload), limit = record(p.rate_limit), primary = record(limit.primary_window), secondary = record(limit.secondary_window), credits = record(p.credits);
    const minutes = (value) => { const seconds = number(value); return seconds === undefined ? undefined : seconds / 60; };
    return compact({
        planType: typeof p.plan_type === 'string' && p.plan_type ? p.plan_type : undefined,
        primaryPercent: number(primary.used_percent), primaryWindowMinutes: minutes(primary.limit_window_seconds),
        primaryResetAt: reset(primary.reset_at, primary.reset_after_seconds, now),
        secondaryPercent: number(secondary.used_percent), secondaryWindowMinutes: minutes(secondary.limit_window_seconds),
        secondaryResetAt: reset(secondary.reset_at, secondary.reset_after_seconds, now),
        creditsHasCredits: bool(credits.has_credits), creditsUnlimited: bool(credits.unlimited), creditsBalance: number(credits.balance),
    });
}
