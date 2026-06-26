/**
 * DOM AI Annotator — Agent Bridge Host (ISOLATED world)
 *
 * Listens for dom-ai-api-request events from the MAIN world bridge,
 * executes operations on chrome.storage, and writes responses back
 * via DOM attributes.
 *
 * It keeps a lightweight annotation cache in the ISOLATED world so the
 * MAIN world agentBridge can read it synchronously through the event bridge.
 *
 * NOTE: This file must be self-contained (no imports from other modules)
 * because it is injected via chrome.scripting.executeScript which does not
 * support ES module imports in content script context.
 */

const REQUEST_ATTR = "data-dom-ai-request";
const RESPONSE_ATTR = "data-dom-ai-response";
const REQUEST_EVENT = "dom-ai-api-request";
const LOCATION_CHANGE_EVENT = "dom-ai-location-change";
const DEBUG_CONSOLE_EVENT = "dom-ai-debug-console-event";
const STORAGE_KEY = "domAiAnnotations";
const HOST_INSTALLED_KEY = "__DOM_AI_AGENT_BRIDGE_HOST_INSTALLED__";

type AnnotationStatus = "pending" | "sent" | "changed" | "needs_work" | "passed" | "skipped";

const VALID_STATUSES: AnnotationStatus[] = ["pending", "sent", "changed", "needs_work", "passed", "skipped"];

// Legacy status normalization (same as shared/storage.ts)
function normalizeStatus(status: string): AnnotationStatus {
  if (status === "acknowledged") return "sent";
  if (status === "resolved") return "passed";
  if (status === "rejected") return "skipped";
  return status as AnnotationStatus;
}

const API_DESCRIPTOR = {
  hint: "Use window.__domAiAPI in evaluate_script to interact with DOM AI Annotator. All methods are synchronous and return { success, data?, error? }.",
  methods: {
    getSummary: { args: "", description: "Page overview: annotations + console errors + network failures" },
    getAnnotations: { args: "options?: {status?, severity?}", description: "Get DOM annotations for this page" },
    getConsoleErrors: { args: "options?: {severity?, limit?}", description: "Get console error/warn messages" },
    getNetworkIssues: { args: "options?: {statusFilter?, limit?}", description: "Get failed network requests" },
    getSuspicious: { args: "options?: {limit?}", description: "Get all suspicious events combined" },
    resolveAnnotation: { args: "id: string", description: "Mark annotation as passed" },
    updateAnnotationStatus: { args: "id, status", description: "Update annotation status" },
    help: { args: "", description: "Show available methods" }
  }
};

// --- Inline Storage Access (self-contained, no imports) ---

interface StoredAnnotation {
  id: string;
  url: string;
  status: string;
  [key: string]: unknown;
}

interface DebugEvent {
  id: string;
  kind: string;
  severity: string;
  timestamp: string;
  pageUrl: string;
  title: string;
  message: string;
  [key: string]: unknown;
}

async function getAllAnnotations(): Promise<StoredAnnotation[]> {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const items = data[STORAGE_KEY] ?? [];
  return (items as StoredAnnotation[]).map((a) => ({
    ...a,
    status: normalizeStatus(a.status)
  }));
}

async function updateStatus(id: string, status: AnnotationStatus): Promise<void> {
  const annotations = await getAllAnnotations();
  const now = new Date().toISOString();
  await chrome.storage.local.set({
    [STORAGE_KEY]: annotations.map((item) =>
      item.id === id ? { ...item, status, updatedAt: now } : item
    )
  });
}

async function clearFixFlag(id: string): Promise<void> {
  const annotations = await getAllAnnotations();
  const now = new Date().toISOString();
  await chrome.storage.local.set({
    [STORAGE_KEY]: annotations.map((item) =>
      item.id === id ? { ...item, fixRequested: false, updatedAt: now } : item
    )
  });
}

async function captureAfterForAnnotation(id: string): Promise<void> {
  try {
    const annotations = await getAllAnnotations();
    const annotation = annotations.find((a) => a.id === id);
    if (!annotation) return;
    const rect = annotation.rect as { x?: number; y?: number; width?: number; height?: number } | undefined;

    const response = await chrome.runtime.sendMessage({
      type: "DOM_AI_CAPTURE_SCREENSHOT",
      rect: rect ? { x: Math.round(rect.x ?? 0), y: Math.round(rect.y ?? 0), width: Math.round(rect.width ?? 0), height: Math.round(rect.height ?? 0) } : undefined,
    });

    if (!response?.success) return;
    const now = new Date().toISOString();
    await chrome.storage.local.set({
      [STORAGE_KEY]: annotations.map((item) =>
        item.id === id
          ? {
              ...item,
              screenshotAfter: {
                dataUrl: response.data.dataUrl,
                capturedAt: response.data.capturedAt,
                visibleRect: response.data.visibleRect,
              },
              updatedAt: now,
            }
          : item
      ),
    });
    scheduleDomSync();
  } catch {
    // Screenshot capture is best-effort
  }
}

// --- DOM Data Sync ---

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let cachedPayload: Record<string, unknown> = {
  version: "1.0",
  page: location.href,
  title: document.title,
  updatedAt: new Date().toISOString(),
  annotations: [],
  debugEvents: [],
  api: API_DESCRIPTOR
};
let cachedDebugEvents: DebugEvent[] = [];

function scheduleDomSync() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => void syncAnnotationsCache(), 300);
}

async function syncAnnotationsCache() {
  try {
    const annotations = await getAllAnnotations();
    const pageAnnotations = annotations
      .filter((a) => a.url === location.href)
      .map(stripLargeAnnotationFields);

    cachedPayload = {
      version: "1.0",
      page: location.href,
      title: document.title,
      updatedAt: new Date().toISOString(),
      annotations: pageAnnotations,
      debugEvents: cachedDebugEvents,
      api: API_DESCRIPTOR
    };
  } catch (e) {
    console.warn("[DOM AI] Failed to sync annotations cache:", e);
  }
}

function syncDebugEventsCache() {
  chrome.runtime.sendMessage({ type: "DOM_AI_GET_DEBUG_EVENTS" }, (response?: { events?: DebugEvent[] }) => {
    if (chrome.runtime.lastError) return;
    cachedDebugEvents = Array.isArray(response?.events) ? response.events : [];
    cachedPayload = {
      ...cachedPayload,
      debugEvents: cachedDebugEvents,
      updatedAt: new Date().toISOString()
    };
  });
}

function handleDebugConsoleEvent(event: Event) {
  const detail = (event as CustomEvent<DebugEvent>).detail;
  if (!detail || typeof detail !== "object") return;
  void chrome.runtime.sendMessage({ type: "DOM_AI_RECORD_DEBUG_EVENT", event: detail });
}

function stripLargeAnnotationFields(annotation: StoredAnnotation): StoredAnnotation {
  const { screenshot: _screenshot, screenshotAfter: _screenshotAfter, ...rest } = annotation;
  return rest;
}

// --- Request Handler ---

function handleRequest() {
  const raw = document.documentElement.getAttribute(REQUEST_ATTR);
  if (!raw) return;

  let request: { requestId: string; method: string; params: Record<string, unknown> };
  try {
    request = JSON.parse(raw);
  } catch {
    respond(null, false, undefined, "Invalid request JSON");
    return;
  }

  const { requestId, method, params } = request;

  try {
    switch (method) {
      case "getDomData": {
        respond(requestId, true, cachedPayload);
        break;
      }

      case "resolveAnnotation": {
        const id = params.id as string;
        if (!id) {
          respond(requestId, false, undefined, "id is required");
          break;
        }
        void updateStatus(id, "passed").then(() => clearFixFlag(id)).then(() => scheduleDomSync());
        respond(requestId, true, { id, status: "passed" });
        break;
      }

      case "updateAnnotationStatus": {
        const id = params.id as string;
        const status = params.status as string;
        if (!id) {
          respond(requestId, false, undefined, "id is required");
          break;
        }
        if (!status || !VALID_STATUSES.includes(status as AnnotationStatus)) {
          respond(requestId, false, undefined, `Invalid status. Valid: ${VALID_STATUSES.join(", ")}`);
          break;
        }
        void updateStatus(id, status as AnnotationStatus).then(() => scheduleDomSync());
        respond(requestId, true, { id, status });
        break;
      }

      case "clearFixRequested": {
        const id = params.id as string;
        if (!id) {
          respond(requestId, false, undefined, "id is required");
          break;
        }
        void clearFixFlag(id).then(() => scheduleDomSync());
        respond(requestId, true, { id, fixRequested: false });
        break;
      }

      case "captureAfterScreenshot": {
        const id = params.id as string;
        if (!id) {
          respond(requestId, false, undefined, "id is required");
          break;
        }
        // Trigger screenshot capture asynchronously via background
        void captureAfterForAnnotation(id);
        respond(requestId, true, { id, status: "capturing" });
        break;
      }

      default:
        respond(requestId, false, undefined, `Unknown method: ${method}`);
    }
  } catch (e) {
    respond(requestId, false, undefined, `Internal error: ${(e as Error).message}`);
  }
}

function respond(requestId: string | null, success: boolean, data?: unknown, error?: string) {
  const response: Record<string, unknown> = { requestId, success };
  if (data !== undefined) response.data = data;
  if (error !== undefined) response.error = error;
  document.documentElement.setAttribute(RESPONSE_ATTR, JSON.stringify(response));
}

// --- Init ---

function initAgentBridgeHost() {
  const hostGlobal = globalThis as typeof globalThis & Record<string, unknown>;
  if (hostGlobal[HOST_INSTALLED_KEY]) return;
  hostGlobal[HOST_INSTALLED_KEY] = true;

  // Listen for API requests from MAIN world
  document.addEventListener(REQUEST_EVENT, handleRequest);
  document.addEventListener(DEBUG_CONSOLE_EVENT, handleDebugConsoleEvent);

  // Initial sync
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      void syncAnnotationsCache();
      syncDebugEventsCache();
    });
  } else {
    void syncAnnotationsCache();
    syncDebugEventsCache();
  }

  // Re-sync when storage changes
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes[STORAGE_KEY]) {
      scheduleDomSync();
    }
  });

  chrome.runtime.onMessage.addListener((message: { type?: string }) => {
    if (message.type === "DOM_AI_DEBUG_EVENTS_CHANGED") syncDebugEventsCache();
  });

  // MAIN world agentBridge emits this when History API or hash navigation changes the URL.
  document.addEventListener(LOCATION_CHANGE_EVENT, scheduleDomSync);
}

initAgentBridgeHost();
