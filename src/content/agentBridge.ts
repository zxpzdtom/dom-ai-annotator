/**
 * DOM AI Annotator — Agent API Bridge (MAIN world)
 *
 * Exposes window.__domAiAPI for programmatic access by AI agents via
 * Chrome DevTools MCP's evaluate_script.
 *
 * Read operations pull data from:
 *   - DOM JSON block (#dom-ai-data) for annotations (synced by ISOLATED world)
 *   - window.__DOM_AI_DEVTOOLS_CONSOLE__ for console events
 *   - window.__DOM_AI_NETWORK_EVENTS__ for network events
 *
 * Write operations use CustomEvent + DOM attributes to bridge into the
 * ISOLATED world (which has chrome.storage access).
 *
 * Usage (from evaluate_script):
 *   () => window.__domAiAPI.getSummary()
 *   () => window.__domAiAPI.getAnnotations()
 *   () => window.__domAiAPI.getConsoleErrors()
 *   () => window.__domAiAPI.getNetworkIssues()
 *   () => window.__domAiAPI.resolveAnnotation("annotation-id")
 */

import type { MonitorEvent } from "../shared/types";

declare global {
  interface Window {
    __domAiAPI?: DomAiAPI;
    __DOM_AI_DEVTOOLS_CONSOLE__?: MonitorEvent[];
    __DOM_AI_NETWORK_EVENTS__?: MonitorEvent[];
  }
}

type ApiResult = { success: true; data?: unknown } | { success: false; error: string };

interface DomAiAPI {
  version: string;
  getAnnotations(options?: { status?: string; severity?: string }): ApiResult;
  getConsoleErrors(options?: { severity?: string; limit?: number }): ApiResult;
  getNetworkIssues(options?: { statusFilter?: string; limit?: number }): ApiResult;
  getSuspicious(options?: { limit?: number }): ApiResult;
  getSummary(): ApiResult;
  getPendingFixes(): ApiResult;
  resolveAnnotation(id: string): ApiResult;
  updateAnnotationStatus(id: string, status: string): ApiResult;
  clearFixRequested(id: string): ApiResult;
  captureAfterScreenshot(id: string): ApiResult;
  help(): ApiResult;
}

const REQUEST_ATTR = "data-dom-ai-request";
const RESPONSE_ATTR = "data-dom-ai-response";
const REQUEST_EVENT = "dom-ai-api-request";
const DATA_ELEMENT_ID = "dom-ai-data";

let requestCounter = 0;

function sendCommand(method: string, params: Record<string, unknown> = {}): ApiResult {
  const requestId = `req_${++requestCounter}_${Date.now()}`;
  const request = { requestId, method, params };

  document.documentElement.setAttribute(REQUEST_ATTR, JSON.stringify(request));
  document.dispatchEvent(new CustomEvent(REQUEST_EVENT));

  const raw = document.documentElement.getAttribute(RESPONSE_ATTR);
  document.documentElement.removeAttribute(REQUEST_ATTR);
  document.documentElement.removeAttribute(RESPONSE_ATTR);

  if (!raw) {
    return { success: false, error: "No response from extension. Is DOM AI Annotator loaded and active?" };
  }
  try {
    return JSON.parse(raw) as ApiResult;
  } catch (e) {
    return { success: false, error: `Invalid response: ${(e as Error).message}` };
  }
}

function readDomData(): { annotations: unknown[]; api?: unknown } {
  const el = document.getElementById(DATA_ELEMENT_ID);
  if (!el) return { annotations: [] };
  try {
    return JSON.parse(el.textContent || "{}");
  } catch {
    return { annotations: [] };
  }
}

function isSuspiciousEvent(event: MonitorEvent): boolean {
  if (event.kind !== "network") {
    return event.severity === "error" || event.severity === "warn";
  }
  const body = `${event.responseBody || ""} ${event.statusText || ""}`.toLowerCase();
  return event.ok === false || (event.status || 0) >= 400 || /error|exception|failed|fail|timeout|denied/.test(body);
}

if (!window.__domAiAPI) {
  window.__domAiAPI = {
    version: "1.0",

    getAnnotations(options) {
      const data = readDomData();
      let annotations = data.annotations as Array<Record<string, unknown>>;

      if (options?.status) {
        annotations = annotations.filter((a) => a.status === options.status);
      }
      if (options?.severity) {
        annotations = annotations.filter((a) => {
          const feedback = a.feedback as { severity?: string } | undefined;
          return feedback?.severity === options.severity;
        });
      }

      return { success: true, data: annotations };
    },

    getConsoleErrors(options) {
      const events = window.__DOM_AI_DEVTOOLS_CONSOLE__ || [];
      const severity = options?.severity || "error";
      const limit = options?.limit || 30;

      const filtered = events.filter((e) => {
        if (severity === "all") return true;
        return e.severity === severity;
      });

      return {
        success: true,
        data: filtered.slice(0, limit).map((e) => ({
          id: e.id,
          severity: e.severity,
          message: e.message,
          stack: e.stack,
          source: e.source,
          line: e.line,
          column: e.column,
          timestamp: e.timestamp
        }))
      };
    },

    getNetworkIssues(options) {
      const events = window.__DOM_AI_NETWORK_EVENTS__ || [];
      const limit = options?.limit || 30;
      const statusFilter = options?.statusFilter || "failed";

      const filtered = events.filter((e) => {
        if (statusFilter === "all") return true;
        if (statusFilter === "failed") return e.ok === false || (e.status || 0) >= 400;
        if (statusFilter === "4xx") return (e.status || 0) >= 400 && (e.status || 0) < 500;
        if (statusFilter === "5xx") return (e.status || 0) >= 500;
        if (statusFilter === "slow") return (e.durationMs || 0) >= 3000;
        return true;
      });

      return {
        success: true,
        data: filtered.slice(0, limit).map((e) => ({
          id: e.id,
          method: e.method,
          url: e.message?.replace(/^\S+\s+/, ""),
          status: e.status,
          statusText: e.statusText,
          requestType: e.requestType,
          durationMs: e.durationMs,
          ok: e.ok,
          requestBody: e.requestBody,
          responseBody: e.responseBody?.slice(0, 2000),
          timestamp: e.timestamp
        }))
      };
    },

    getSuspicious(options) {
      const limit = options?.limit || 30;
      const consoleEvents = (window.__DOM_AI_DEVTOOLS_CONSOLE__ || []).filter(isSuspiciousEvent);
      const networkEvents = (window.__DOM_AI_NETWORK_EVENTS__ || []).filter(isSuspiciousEvent);

      const suspicious = [...consoleEvents, ...networkEvents]
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
        .slice(0, limit);

      return {
        success: true,
        data: suspicious.map((e) => ({
          id: e.id,
          kind: e.kind,
          severity: e.severity,
          message: e.message,
          status: e.status,
          method: e.method,
          stack: e.stack,
          source: e.source,
          timestamp: e.timestamp
        }))
      };
    },

    getSummary() {
      const data = readDomData();
      const annotations = data.annotations as Array<Record<string, unknown>>;
      const consoleEvents = window.__DOM_AI_DEVTOOLS_CONSOLE__ || [];
      const networkEvents = window.__DOM_AI_NETWORK_EVENTS__ || [];

      const pending = annotations.filter((a) => a.status === "pending" || a.status === "sent" || a.status === "needs_work");
      const consoleErrors = consoleEvents.filter((e) => e.severity === "error");
      const consoleWarns = consoleEvents.filter((e) => e.severity === "warn");
      const networkFailed = networkEvents.filter((e) => e.ok === false || (e.status || 0) >= 400);

      return {
        success: true,
        data: {
          page: window.location.href,
          title: document.title,
          annotations: {
            total: annotations.length,
            pending: pending.length,
            items: pending.slice(0, 10).map((a) => ({
              id: a.id,
              selector: a.selector,
              comment: (a.feedback as { comment?: string })?.comment,
              severity: (a.feedback as { severity?: string })?.severity,
              status: a.status
            }))
          },
          console: {
            errors: consoleErrors.length,
            warnings: consoleWarns.length,
            recentErrors: consoleErrors.slice(0, 5).map((e) => ({
              message: e.message,
              source: e.source,
              line: e.line
            }))
          },
          network: {
            failed: networkFailed.length,
            recentFailures: networkFailed.slice(0, 5).map((e) => ({
              method: e.method,
              url: e.message?.replace(/^\S+\s+/, ""),
              status: e.status
            }))
          }
        }
      };
    },

    resolveAnnotation(id) {
      if (!id) return { success: false, error: "id is required" };
      return sendCommand("resolveAnnotation", { id });
    },

    updateAnnotationStatus(id, status) {
      if (!id) return { success: false, error: "id is required" };
      if (!status) return { success: false, error: "status is required" };
      return sendCommand("updateAnnotationStatus", { id, status });
    },

    getPendingFixes() {
      const data = readDomData();
      const annotations = data.annotations as Array<Record<string, unknown>>;
      const fixes = annotations.filter((a) => a.fixRequested === true);
      return {
        success: true,
        data: fixes.map((a) => ({
          id: a.id,
          selector: a.selector,
          xpath: a.xpath,
          comment: (a.feedback as { comment?: string })?.comment,
          expected: (a.feedback as { expected?: string })?.expected,
          severity: (a.feedback as { severity?: string })?.severity,
          status: a.status,
          element: a.element,
          rect: a.rect,
          viewport: a.viewport,
          computedStyles: a.computedStyles,
        })),
      };
    },

    clearFixRequested(id) {
      if (!id) return { success: false, error: "id is required" };
      return sendCommand("clearFixRequested", { id });
    },

    captureAfterScreenshot(id) {
      if (!id) return { success: false, error: "id is required" };
      return sendCommand("captureAfterScreenshot", { id });
    },

    help() {
      return {
        success: true,
        data: {
          description: "DOM AI Annotator API — read UI annotations, console errors, and network issues from the page.",
          usage: "Call via Chrome DevTools MCP evaluate_script: () => window.__domAiAPI.methodName(args)",
          methods: {
            getSummary: {
              args: "",
              description: "Get a complete overview of the page: pending annotations count, console errors, network failures. Start here."
            },
            getAnnotations: {
              args: "options?: { status?: string, severity?: string }",
              description: "Get all DOM annotations for this page. Each contains selector, element info, computed styles, and feedback comment."
            },
            getConsoleErrors: {
              args: "options?: { severity?: 'error'|'warn'|'log'|'info'|'all', limit?: number }",
              description: "Get console messages. Defaults to 'error' severity, limit 30."
            },
            getNetworkIssues: {
              args: "options?: { statusFilter?: 'failed'|'4xx'|'5xx'|'slow'|'all', limit?: number }",
              description: "Get problematic network requests. Defaults to 'failed' filter, limit 30."
            },
            getSuspicious: {
              args: "options?: { limit?: number }",
              description: "Get all suspicious events (console errors + failed network) sorted by time."
            },
            resolveAnnotation: {
              args: "id: string",
              description: "Mark an annotation as resolved (status: 'passed')."
            },
            updateAnnotationStatus: {
              args: "id: string, status: 'pending'|'sent'|'changed'|'needs_work'|'passed'|'skipped'",
              description: "Update an annotation's status."
            },
            getPendingFixes: {
              args: "",
              description: "Get annotations flagged for AI fix (fixRequested=true). Use after user clicks 'Fix with AI' in the sidebar."
            },
            clearFixRequested: {
              args: "id: string",
              description: "Clear the fixRequested flag on an annotation after fixing."
            },
            captureAfterScreenshot: {
              args: "id: string",
              description: "Capture an 'after' screenshot for before/after comparison. Call after fixing a visual issue."
            },
            help: {
              args: "",
              description: "Show this help information."
            }
          }
        }
      };
    }
  };

  document.documentElement.setAttribute("data-dom-ai-api-ready", "true");
}
