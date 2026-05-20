/**
 * DOM AI Annotator — Agent Bridge Host (ISOLATED world)
 *
 * Listens for dom-ai-api-request events from the MAIN world bridge,
 * executes operations on chrome.storage, and writes responses back
 * via DOM attributes.
 *
 * Also syncs annotation data to a hidden <script> DOM element so the
 * MAIN world agentBridge can read it synchronously.
 *
 * NOTE: This file must be self-contained (no imports from other modules)
 * because it is injected via chrome.scripting.executeScript which does not
 * support ES module imports in content script context.
 */

const REQUEST_ATTR = "data-dom-ai-request";
const RESPONSE_ATTR = "data-dom-ai-response";
const REQUEST_EVENT = "dom-ai-api-request";
const DATA_ELEMENT_ID = "dom-ai-data";
const STORAGE_KEY = "domAiAnnotations";

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
let hostInitialized = false;

function scheduleDomSync() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => void syncAnnotationsToDom(), 300);
}

async function syncAnnotationsToDom() {
  try {
    const annotations = await getAllAnnotations();
    const pageAnnotations = annotations.filter((a) => a.url === location.href);

    let el = document.getElementById(DATA_ELEMENT_ID) as HTMLScriptElement | null;
    if (!el) {
      el = document.createElement("script");
      el.type = "application/json";
      el.id = DATA_ELEMENT_ID;
      el.style.display = "none";
      (document.body || document.documentElement).appendChild(el);
    }

    const payload = {
      version: "1.0",
      page: location.href,
      title: document.title,
      updatedAt: new Date().toISOString(),
      annotations: pageAnnotations,
      api: API_DESCRIPTOR
    };

    el.textContent = JSON.stringify(payload, null, 2);
  } catch (e) {
    console.warn("[DOM AI] Failed to sync annotations to DOM:", e);
  }
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
  if (hostInitialized) return;
  hostInitialized = true;

  // Listen for API requests from MAIN world
  document.addEventListener(REQUEST_EVENT, handleRequest);

  // Initial sync
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void syncAnnotationsToDom());
  } else {
    void syncAnnotationsToDom();
  }

  // Re-sync when storage changes
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes[STORAGE_KEY]) {
      scheduleDomSync();
    }
  });

  // Re-sync on SPA navigation
  let lastUrl = location.href;
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      scheduleDomSync();
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

initAgentBridgeHost();
