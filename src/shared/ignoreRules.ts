import type { MonitorEvent } from "./types";

// ─── Ignore Rules ─────────────────────────────────────────────────────────────

export interface IgnoreRules {
  urlPatterns: string[];
  messagePatterns: string[];
  domains: string[];
}

const IGNORE_STORAGE_KEY = "domAiIgnoreRules";
const DEFAULT_IGNORE_RULES: IgnoreRules = { urlPatterns: [], messagePatterns: [], domains: [] };

export async function getIgnoreRules(): Promise<IgnoreRules> {
  const data = await chrome.storage.local.get(IGNORE_STORAGE_KEY);
  const stored = data[IGNORE_STORAGE_KEY];
  if (!stored || typeof stored !== "object") return { ...DEFAULT_IGNORE_RULES };
  return {
    urlPatterns: Array.isArray(stored.urlPatterns) ? stored.urlPatterns : [],
    messagePatterns: Array.isArray(stored.messagePatterns) ? stored.messagePatterns : [],
    domains: Array.isArray(stored.domains) ? stored.domains : [],
  };
}

export async function saveIgnoreRules(rules: IgnoreRules): Promise<void> {
  await chrome.storage.local.set({ [IGNORE_STORAGE_KEY]: rules });
}

// ─── Suspicious Rules ─────────────────────────────────────────────────────────

/** What field/aspect of the event to inspect */
export type RuleTarget =
  | "console-message"   // Console log/warn/error message text
  | "console-level"     // Console severity: error, warn, log, info
  | "url"               // Request URL (network events)
  | "status-code"       // HTTP status code (number)
  | "response-body"     // Response body text
  | "request-method"    // HTTP method: GET, POST, etc.
  | "request-type"      // Request type: fetch, xhr, beacon, resource, websocket
  | "response-type"     // Response content-type
  | "duration"          // Request duration in milliseconds (number)
  | "network-error";    // Network failure (no response)

/** How to compare the target value against the rule value */
export type RuleOperator =
  | "contains"          // case-insensitive substring match
  | "not-contains"      // does NOT contain (case-insensitive)
  | "equals"            // exact match (case-insensitive for strings, exact for numbers)
  | "not-equals"        // does NOT equal
  | "matches"           // regex match
  | "gte"              // >= (numeric comparison)
  | "lte"              // <= (numeric comparison)
  | "exists";           // field exists / is truthy (value ignored)

/** A single condition within a rule */
export interface RuleCondition {
  target: RuleTarget;
  operator: RuleOperator;
  value: string;        // user-entered value (interpreted based on operator)
}

/** Severity level for matched events */
export type RuleSeverity = "error" | "warn" | "info";

export interface SuspiciousRule {
  id: string;
  enabled: boolean;
  label: string;
  description: string;
  severity: RuleSeverity;
  conditions: RuleCondition[];  // ALL conditions must match (AND logic)
}

// Legacy type for backwards compat during migration
export type SuspiciousRuleKind =
  | "console-error" | "console-warn"
  | "http-4xx" | "http-5xx"
  | "network-failed"
  | "body-success-false" | "body-error-field" | "body-error-message"
  | "custom";

export const DEFAULT_SUSPICIOUS_RULES: SuspiciousRule[] = [
  {
    id: "builtin-console-error",
    enabled: true,
    label: "Console Error",
    description: "Flags console.error() calls and uncaught JavaScript errors",
    severity: "error",
    conditions: [{ target: "console-level", operator: "equals", value: "error" }],
  },
  {
    id: "builtin-console-warn",
    enabled: true,
    label: "Console Warning",
    description: "Flags console.warn() calls",
    severity: "warn",
    conditions: [{ target: "console-level", operator: "equals", value: "warn" }],
  },
  {
    id: "builtin-http-4xx",
    enabled: true,
    label: "HTTP 4xx Client Error",
    description: "HTTP 400–499 responses (not found, unauthorized, forbidden, etc.)",
    severity: "error",
    conditions: [
      { target: "status-code", operator: "gte", value: "400" },
      { target: "status-code", operator: "lte", value: "499" },
    ],
  },
  {
    id: "builtin-http-5xx",
    enabled: true,
    label: "HTTP 5xx Server Error",
    description: "HTTP 500–599 responses (internal server error, bad gateway, etc.)",
    severity: "error",
    conditions: [
      { target: "status-code", operator: "gte", value: "500" },
      { target: "status-code", operator: "lte", value: "599" },
    ],
  },
  {
    id: "builtin-network-failed",
    enabled: true,
    label: "Network Failed",
    description: "Requests with no response: DNS failure, connection refused, or CORS block",
    severity: "error",
    conditions: [{ target: "network-error", operator: "exists", value: "" }],
  },
  {
    id: "builtin-body-success-false",
    enabled: true,
    label: "API: success:false",
    description: 'Response body contains "success": false or "ok": false',
    severity: "warn",
    conditions: [{ target: "response-body", operator: "matches", value: '"(success|ok)"\\s*:\\s*false' }],
  },
  {
    id: "builtin-body-error-field",
    enabled: true,
    label: "API: error field",
    description: 'Response body contains "error", "errors", or "exception" key with a value',
    severity: "warn",
    conditions: [{ target: "response-body", operator: "matches", value: '"(errors?|exception)"\\s*:\\s*("(?:[^"\\\\]|\\\\.)+"|\\{|\\[)' }],
  },
  {
    id: "builtin-body-error-message",
    enabled: true,
    label: "API: error in message",
    description: 'The "message" or "msg" field contains error-related words',
    severity: "warn",
    conditions: [{ target: "response-body", operator: "matches", value: '"(?:message|msg)"\\s*:\\s*"[^"]*\\b(error|exception|failed|failure|timeout|timed out|denied|unauthorized|forbidden|not found|internal server)\\b' }],
  },
  {
    id: "builtin-slow-request",
    enabled: true,
    label: "Slow Request",
    description: "Network requests taking longer than 10 seconds",
    severity: "warn",
    conditions: [{ target: "duration", operator: "gte", value: "10000" }],
  },
];

const SUSPICIOUS_STORAGE_KEY = "domAiSuspiciousRules";

export async function getSuspiciousRules(): Promise<SuspiciousRule[]> {
  const data = await chrome.storage.local.get([SUSPICIOUS_STORAGE_KEY, "domAiIgnoreRules"]);
  const stored = data[SUSPICIOUS_STORAGE_KEY];

  // Migrate old customSuspicious entries from domAiIgnoreRules
  const oldIgnore = data["domAiIgnoreRules"];
  const migratedCustom: SuspiciousRule[] = [];
  if (oldIgnore && Array.isArray(oldIgnore.customSuspicious) && oldIgnore.customSuspicious.length > 0) {
    for (const old of oldIgnore.customSuspicious) {
      if (old.urlPattern && old.bodyKeyword) {
        migratedCustom.push({
          id: `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          enabled: true,
          label: `${old.urlPattern} → "${old.bodyKeyword}"`,
          description: "Migrated custom rule",
          severity: "warn",
          conditions: [
            { target: "url", operator: "matches", value: globToRegexStr(old.urlPattern) },
            { target: "response-body", operator: "contains", value: old.bodyKeyword },
          ],
        });
      }
    }
    const cleanedIgnore = { ...oldIgnore };
    delete cleanedIgnore.customSuspicious;
    await chrome.storage.local.set({ domAiIgnoreRules: cleanedIgnore });
  }

  // Migrate old format (kind-based) to new format (condition-based)
  if (Array.isArray(stored) && stored.length > 0 && stored[0].kind && !stored[0].conditions) {
    const migrated = migrateOldRules(stored);
    const merged = [...migrated, ...migratedCustom];
    await chrome.storage.local.set({ [SUSPICIOUS_STORAGE_KEY]: merged });
    return merged;
  }

  if (!Array.isArray(stored)) {
    const initial = [...DEFAULT_SUSPICIOUS_RULES, ...migratedCustom];
    await chrome.storage.local.set({ [SUSPICIOUS_STORAGE_KEY]: initial });
    return initial;
  }

  // Validate stored rules
  const validated = stored.filter(
    (r: unknown): r is SuspiciousRule =>
      r !== null &&
      typeof r === "object" &&
      typeof (r as SuspiciousRule).id === "string" &&
      typeof (r as SuspiciousRule).enabled === "boolean" &&
      typeof (r as SuspiciousRule).label === "string" &&
      Array.isArray((r as SuspiciousRule).conditions)
  );

  if (migratedCustom.length) {
    const merged = [...validated, ...migratedCustom];
    await chrome.storage.local.set({ [SUSPICIOUS_STORAGE_KEY]: merged });
    return merged;
  }

  return validated;
}

/** Migrate old kind-based rules to new condition-based format */
function migrateOldRules(oldRules: Array<Record<string, unknown>>): SuspiciousRule[] {
  const result: SuspiciousRule[] = [];
  for (const old of oldRules) {
    const kind = old.kind as string;
    const base = {
      id: old.id as string || `migrated-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      enabled: old.enabled as boolean ?? true,
      label: old.label as string || kind,
      description: old.description as string || "",
    };
    switch (kind) {
      case "console-error":
        result.push({ ...base, severity: "error", conditions: [{ target: "console-level", operator: "equals", value: "error" }] });
        break;
      case "console-warn":
        result.push({ ...base, severity: "warn", conditions: [{ target: "console-level", operator: "equals", value: "warn" }] });
        break;
      case "http-4xx":
        result.push({ ...base, severity: "error", conditions: [{ target: "status-code", operator: "gte", value: "400" }, { target: "status-code", operator: "lte", value: "499" }] });
        break;
      case "http-5xx":
        result.push({ ...base, severity: "error", conditions: [{ target: "status-code", operator: "gte", value: "500" }, { target: "status-code", operator: "lte", value: "599" }] });
        break;
      case "network-failed":
        result.push({ ...base, severity: "error", conditions: [{ target: "network-error", operator: "exists", value: "" }] });
        break;
      case "body-success-false":
        result.push({ ...base, severity: "warn", conditions: [{ target: "response-body", operator: "matches", value: '"(success|ok)"\\s*:\\s*false' }] });
        break;
      case "body-error-field":
        result.push({ ...base, severity: "warn", conditions: [{ target: "response-body", operator: "matches", value: '"(errors?|exception)"\\s*:\\s*("(?:[^"\\\\]|\\\\.)+"|\\{|\\[)' }] });
        break;
      case "body-error-message":
        result.push({ ...base, severity: "warn", conditions: [{ target: "response-body", operator: "matches", value: '"(?:message|msg)"\\s*:\\s*"[^"]*\\b(error|exception|failed|failure|timeout|timed out|denied|unauthorized|forbidden|not found|internal server)\\b' }] });
        break;
      case "custom":
        result.push({
          ...base,
          severity: "warn",
          conditions: [
            ...(old.urlPattern ? [{ target: "url" as RuleTarget, operator: "matches" as RuleOperator, value: globToRegexStr(old.urlPattern as string) }] : []),
            ...(old.bodyKeyword ? [{ target: "response-body" as RuleTarget, operator: "contains" as RuleOperator, value: old.bodyKeyword as string }] : []),
          ],
        });
        break;
      default:
        // Unknown kind, skip
        break;
    }
  }
  return result;
}

export async function saveSuspiciousRules(rules: SuspiciousRule[]): Promise<void> {
  await chrome.storage.local.set({ [SUSPICIOUS_STORAGE_KEY]: rules });
}

// ─── Rule Evaluation ─────────────────────────────────────────────────────────

/**
 * Evaluate a single rule against an event. Returns true if ALL conditions match.
 */
export function evaluateRule(event: MonitorEvent, rule: SuspiciousRule): boolean {
  if (!rule.enabled || !rule.conditions.length) return false;
  return rule.conditions.every((cond) => evaluateCondition(event, cond));
}

function evaluateCondition(event: MonitorEvent, cond: RuleCondition): boolean {
  const fieldValue = getTargetValue(event, cond.target);
  if (fieldValue === null) return cond.operator === "not-contains" || cond.operator === "not-equals";

  switch (cond.operator) {
    case "contains":
      return String(fieldValue).toLowerCase().includes(cond.value.toLowerCase());
    case "not-contains":
      return !String(fieldValue).toLowerCase().includes(cond.value.toLowerCase());
    case "equals":
      if (typeof fieldValue === "number") return fieldValue === Number(cond.value);
      return String(fieldValue).toLowerCase() === cond.value.toLowerCase();
    case "not-equals":
      if (typeof fieldValue === "number") return fieldValue !== Number(cond.value);
      return String(fieldValue).toLowerCase() !== cond.value.toLowerCase();
    case "matches":
      try {
        return new RegExp(cond.value, "i").test(String(fieldValue));
      } catch {
        return false;
      }
    case "gte":
      return Number(fieldValue) >= Number(cond.value);
    case "lte":
      return Number(fieldValue) <= Number(cond.value);
    case "exists":
      return fieldValue !== null && fieldValue !== undefined && fieldValue !== "" && fieldValue !== 0;
  }
}

function getTargetValue(event: MonitorEvent, target: RuleTarget): string | number | null {
  switch (target) {
    case "console-message":
      return event.kind !== "network" ? event.message : null;
    case "console-level":
      return event.kind !== "network" ? event.severity : null;
    case "url":
      if (event.kind === "network") return event.message.replace(/^\S+\s+/, "");
      return event.pageUrl || null;
    case "status-code":
      return event.kind === "network" ? (event.status || null) : null;
    case "response-body":
      return event.kind === "network" ? (event.responseBody || null) : null;
    case "request-method":
      return event.kind === "network" ? (event.method || "GET") : null;
    case "request-type":
      return event.kind === "network" ? (event.requestType || null) : null;
    case "response-type":
      return event.kind === "network" ? (event.responseType || null) : null;
    case "duration":
      return event.kind === "network" ? (event.durationMs ?? null) : null;
    case "network-error":
      // Returns non-null if the network request failed (no status)
      if (event.kind === "network" && (!event.status || event.ok === false)) return "failed";
      return null;
  }
}

// ─── Glob / URL matching ───────────────────────────────────────────────────────

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, " ")
    .replace(/\*/g, "[^/]*")
    .replace(/ /g, ".*");
  return new RegExp(escaped, "i");
}

function globToRegexStr(pattern: string): string {
  return pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, " ")
    .replace(/\*/g, "[^/]*")
    .replace(/ /g, ".*");
}

// ─── Ignore matching ──────────────────────────────────────────────────────────

export function isIgnored(event: MonitorEvent, rules: IgnoreRules): boolean {
  if (!rules.urlPatterns.length && !rules.messagePatterns.length && !rules.domains.length) {
    return false;
  }

  if (event.kind === "network") {
    const url = event.message.replace(/^\S+\s+/, "");

    if (rules.domains.length) {
      try {
        const hostname = new URL(url).hostname;
        if (rules.domains.some((d) => hostname === d || hostname.endsWith(`.${d}`))) {
          return true;
        }
      } catch {
        // Invalid URL
      }
    }

    if (rules.urlPatterns.some((pattern) => globToRegex(pattern).test(url))) {
      return true;
    }
  } else {
    if (rules.messagePatterns.length) {
      const msg = event.message.toLowerCase();
      if (rules.messagePatterns.some((pattern) => msg.includes(pattern.toLowerCase()))) {
        return true;
      }
    }

    if (rules.domains.length && event.source) {
      try {
        const hostname = new URL(event.source).hostname;
        if (rules.domains.some((d) => hostname === d || hostname.endsWith(`.${d}`))) {
          return true;
        }
      } catch {
        // source might not be a full URL
      }
    }
  }

  return false;
}

// ─── Legacy custom suspicious-rule helper ────────────────────────────────────

export function matchCustomSuspicious(
  event: MonitorEvent,
  rules: Array<{ urlPattern: string; bodyKeyword: string }>
): { matchedKeyword: string; context: string } | null {
  if (event.kind !== "network" || !rules.length || !event.responseBody) return null;

  const url = event.message.replace(/^\S+\s+/, "");
  const bodyLower = event.responseBody.toLowerCase();

  for (const rule of rules) {
    if (!globToRegex(rule.urlPattern).test(url)) continue;

    const keyword = rule.bodyKeyword.toLowerCase();
    const idx = bodyLower.indexOf(keyword);
    if (idx === -1) continue;

    const start = Math.max(0, idx - 30);
    const end = Math.min(bodyLower.length, idx + keyword.length + 30);
    const context = (start > 0 ? "…" : "") + event.responseBody.slice(start, end).trim() + (end < bodyLower.length ? "…" : "");

    return { matchedKeyword: rule.bodyKeyword, context };
  }

  return null;
}
