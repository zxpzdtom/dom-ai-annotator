import type { MonitorEvent, MonitorSeverity } from "../shared/types";

type BridgePayload =
  | { source: "DOM_AI_MONITOR_BRIDGE"; type: "event"; event: MonitorEvent }
  | { source: "DOM_AI_MONITOR_BRIDGE"; type: "ready" };

declare global {
  interface Window {
    __DOM_AI_MONITOR_BRIDGE_INSTALLED__?: boolean;
    __DOM_AI_DEVTOOLS_CONSOLE__?: MonitorEvent[];
    __DOM_AI_NETWORK_EVENTS__?: MonitorEvent[];
  }
}

const MAX_PREVIEW_LENGTH = 20000;

if (!window.__DOM_AI_MONITOR_BRIDGE_INSTALLED__) {
  window.__DOM_AI_MONITOR_BRIDGE_INSTALLED__ = true;
  installConsoleMonitor();
  installErrorMonitor();
  installNetworkMonitor();
  installBeaconMonitor();
  installResourceMonitor();
  installWebSocketMonitor();
  post({ source: "DOM_AI_MONITOR_BRIDGE", type: "ready" });
}

function installConsoleMonitor() {
  const original = { ...console };
  const methods: MonitorSeverity[] = ["log", "info", "warn", "error"];
  const timeLabels = new Map<string, number>();
  const countLabels = new Map<string, number>();

  for (const method of methods) {
    const originalMethod = original[method];
    if (typeof originalMethod !== "function") continue;

    console[method] = (...args: unknown[]) => {
      try {
        const formatted = args.length ? args.map(formatValue) : ["(empty)"];
        emit({
          kind: "console",
          severity: method,
          message: formatted.join(" "),
          details: args.length > 1 ? formatted.map((value, index) => `${index + 1}. ${value}`).join("\n") : undefined,
          stack: getStack()
        });
      } catch {
        // Preserve page behavior even if serialization fails.
      }
      originalMethod.apply(console, args);
    };
  }

  if (typeof original.debug === "function") {
    console.debug = (...args: unknown[]) => {
      emitConsole("log", args, getStack());
      original.debug.apply(console, args);
    };
  }

  if (typeof original.clear === "function") {
    console.clear = (...args: unknown[]) => {
      emitConsole("log", ["console.clear()"], getStack());
      original.clear.call(console);
    };
  }

  console.time = (label = "default") => {
    timeLabels.set(String(label), performance.now());
    original.time?.call(console, label);
  };

  console.timeLog = (label = "default", ...args: unknown[]) => {
    const elapsed = timeLabels.has(String(label)) ? Math.round((performance.now() - (timeLabels.get(String(label)) || 0)) * 100) / 100 : 0;
    emitConsole("log", [`${label}: ${elapsed} ms`, ...args], getStack());
    original.timeLog?.call(console, label, ...args);
  };

  console.timeEnd = (label = "default") => {
    const elapsed = timeLabels.has(String(label)) ? Math.round((performance.now() - (timeLabels.get(String(label)) || 0)) * 100) / 100 : 0;
    timeLabels.delete(String(label));
    emitConsole("log", [`${label}: ${elapsed} ms`], getStack());
    original.timeEnd?.call(console, label);
  };

  console.count = (label = "default") => {
    const key = String(label);
    const count = (countLabels.get(key) || 0) + 1;
    countLabels.set(key, count);
    emitConsole("log", [`${key}: ${count}`], getStack());
    original.count?.call(console, label);
  };

  console.countReset = (label = "default") => {
    countLabels.delete(String(label));
    original.countReset?.call(console, label);
  };

  console.assert = (condition?: boolean, ...args: unknown[]) => {
    if (!condition) emitConsole("error", ["Assertion failed:", ...args], getStack());
    original.assert?.call(console, condition, ...args);
  };

  console.dir = (...args: unknown[]) => {
    emitConsole("log", args, getStack());
    (original.dir as ((...items: unknown[]) => void) | undefined)?.apply(console, args);
  };

  console.table = (...args: unknown[]) => {
    emitConsole("log", args, getStack());
    (original.table as ((...items: unknown[]) => void) | undefined)?.apply(console, args);
  };

  const groupStack: string[] = [];
  console.group = (...args: unknown[]) => {
    groupStack.push(args.map(formatValue).join(" ") || "console.group");
    emitConsole("log", [`${"  ".repeat(groupStack.length - 1)}▼`, ...args], getStack());
    original.group?.apply(console, args);
  };
  console.groupCollapsed = (...args: unknown[]) => {
    groupStack.push(args.map(formatValue).join(" ") || "console.groupCollapsed");
    emitConsole("log", [`${"  ".repeat(groupStack.length - 1)}▶`, ...args], getStack());
    original.groupCollapsed?.apply(console, args);
  };
  console.groupEnd = () => {
    groupStack.pop();
    original.groupEnd?.call(console);
  };
}

function emitConsole(severity: MonitorSeverity, args: unknown[], stack?: string) {
  const formatted = args.length ? args.map(formatValue) : ["(empty)"];
  emit({
    kind: "console",
    severity,
    message: formatted.join(" "),
    details: args.length > 1 ? formatted.map((value, index) => `${index + 1}. ${value}`).join("\n") : undefined,
    stack
  });
}

function installErrorMonitor() {
  window.addEventListener(
    "error",
    (event) => {
      const error = event.error instanceof Error ? event.error : undefined;
      emit({
        kind: "error",
        severity: "error",
        message: error?.message || event.message || "Uncaught error",
        details: event.filename,
        stack: error?.stack,
        source: event.filename,
        line: event.lineno,
        column: event.colno
      });
    },
    true
  );

  window.addEventListener(
    "unhandledrejection",
    (event) => {
      emit({
        kind: "error",
        severity: "error",
        message: `Unhandled promise rejection: ${formatValue(event.reason)}`,
        stack: event.reason instanceof Error ? event.reason.stack : undefined
      });
    },
    true
  );
}

function installNetworkMonitor() {
  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const startedAt = performance.now();
      const method = getFetchMethod(input, init);
      const url = getFetchUrl(input);
      const requestHeaders = getFetchHeaders(input, init);
      const requestBody = await getRequestBodyPreview(input, init);
      try {
        const response = await originalFetch.call(window, input, init);
        const responseBody = await getResponseBodyPreview(response);
        emitNetwork({
          requestType: "fetch",
          method,
          url,
          requestHeaders,
          requestBody,
          status: response.status,
          statusText: response.statusText,
          responseHeaders: headersToObject(response.headers),
          responseBody,
          responseType: response.headers.get("content-type") || undefined,
          ok: response.ok,
          durationMs: performance.now() - startedAt
        });
        return response;
      } catch (error) {
        emitNetwork({
          requestType: "fetch",
          method,
          url,
          requestHeaders,
          requestBody,
          ok: false,
          durationMs: performance.now() - startedAt,
          error: formatValue(error)
        });
        throw error;
      }
    };
  }

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function open(method: string, url: string | URL, ...rest: unknown[]) {
    this.__domAiMonitorMeta = {
      method: String(method || "GET").toUpperCase(),
      url: String(url || ""),
      requestHeaders: {}
    };
    return originalOpen.apply(this, [method, url, ...rest] as Parameters<XMLHttpRequest["open"]>);
  };

  XMLHttpRequest.prototype.setRequestHeader = function setRequestHeader(name: string, value: string) {
    if (this.__domAiMonitorMeta) this.__domAiMonitorMeta.requestHeaders[name] = value;
    return originalSetRequestHeader.call(this, name, value);
  };

  XMLHttpRequest.prototype.send = function send(...args: unknown[]) {
    const startedAt = performance.now();
    const meta = this.__domAiMonitorMeta ?? { method: "GET", url: "", requestHeaders: {} };
    const requestBody = formatRequestBody(args[0]);
    let completed = false;
    const record = () => {
      if (completed) return;
      completed = true;
      const contentType = this.getResponseHeader("content-type") || "";
      const responseBody = getXhrResponseBody(this, meta.url);
      emitNetwork({
        requestType: "xhr",
        method: meta.method,
        url: meta.url,
        requestHeaders: meta.requestHeaders,
        requestBody,
        status: this.status,
        statusText: this.statusText,
        responseHeaders: parseHeaderString(this.getAllResponseHeaders()),
        responseBody,
        responseType: this.responseType || contentType || undefined,
        ok: this.status >= 200 && this.status < 400,
        durationMs: performance.now() - startedAt
      });
    };
    const fail = () => {
      if (completed) return;
      completed = true;
      emitNetwork({
        requestType: "xhr",
        method: meta.method,
        url: meta.url,
        requestHeaders: meta.requestHeaders,
        requestBody,
        status: this.status || undefined,
        statusText: this.statusText,
        ok: false,
        durationMs: performance.now() - startedAt,
        error: "XMLHttpRequest failed"
      });
    };

    this.addEventListener("loadend", record, { once: true });
    this.addEventListener("error", fail, { once: true });
    this.addEventListener("timeout", fail, { once: true });
    this.addEventListener("abort", fail, { once: true });
    return originalSend.apply(this, args as [Document | XMLHttpRequestBodyInit | null | undefined]);
  };
}

function installBeaconMonitor() {
  const original = navigator.sendBeacon;
  if (typeof original !== "function") return;

  navigator.sendBeacon = (url: string | URL, data?: BodyInit | null) => {
    const startedAt = performance.now();
    const requestBody = formatRequestBody(data);
    const ok = original.call(navigator, url, data);
    emitNetwork({
      requestType: "beacon",
      method: "POST",
      url: String(url),
      requestHeaders: { "content-type": getBodyContentType(data) },
      requestBody,
      status: ok ? 0 : 500,
      statusText: ok ? "Sent" : "Failed",
      ok,
      durationMs: performance.now() - startedAt
    });
    return ok;
  };
}

function installResourceMonitor() {
  if (typeof PerformanceObserver === "undefined") return;
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const resource = entry as PerformanceResourceTiming;
        if (resource.initiatorType === "fetch" || resource.initiatorType === "xmlhttprequest" || resource.initiatorType === "beacon") continue;
        emitNetwork({
          requestType: "resource",
          method: "GET",
          url: resource.name,
          status: (resource as PerformanceResourceTiming & { responseStatus?: number }).responseStatus ?? (resource.encodedBodySize > 0 ? 200 : 0),
          statusText: "Resource",
          responseType: resource.initiatorType || "resource",
          durationMs: resource.duration,
          ok: true
        });
      }
    });
    observer.observe({ type: "resource", buffered: true });
  } catch {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const resource = entry as PerformanceResourceTiming;
          emitNetwork({
            requestType: "resource",
            method: "GET",
            url: resource.name,
            status: resource.encodedBodySize > 0 ? 200 : 0,
            statusText: "Resource",
            responseType: resource.initiatorType || "resource",
            durationMs: resource.duration,
            ok: true
          });
        }
      });
      observer.observe({ entryTypes: ["resource"] });
    } catch {
      // PerformanceObserver is unavailable or restricted.
    }
  }
}

function installWebSocketMonitor() {
  const OriginalWebSocket = window.WebSocket;
  if (typeof OriginalWebSocket !== "function") return;

  window.WebSocket = new Proxy(OriginalWebSocket, {
    construct(target, args: [string | URL, string | string[] | undefined]) {
      const startedAt = performance.now();
      const url = String(args[0] || "");
      const socket = new target(...args);
      const id = `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const messages: string[] = [];
      const emitWs = (status: number, statusText: string, ok = true) => {
        emitNetwork({
          requestType: "websocket",
          method: "WS",
          url,
          status,
          statusText,
          responseBody: messages.slice(-50).join("\n"),
          responseType: "websocket",
          durationMs: performance.now() - startedAt,
          ok
        });
      };
      socket.addEventListener("open", () => emitWs(101, "Connected"));
      socket.addEventListener("message", (event) => {
        messages.push(`receive ${formatValue(event.data)}`);
        emitWs(101, "Message");
      });
      socket.addEventListener("error", () => emitWs(0, "Error", false));
      socket.addEventListener("close", (event) => emitWs(event.code, event.wasClean ? "Closed" : "Closed (abnormal)", event.wasClean));
      const originalSend = socket.send;
      socket.send = (data: string | ArrayBufferLike | Blob | ArrayBufferView) => {
        messages.push(`send ${formatValue(data)}`);
        emitWs(101, "Send");
        return originalSend.call(socket, data);
      };
      Object.defineProperty(socket, "__domAiMonitorWebSocketId", { value: id });
      return socket;
    }
  });
}

function emitNetwork(data: {
  requestType: "fetch" | "xhr" | "beacon" | "resource" | "websocket";
  method: string;
  url: string;
  requestHeaders?: Record<string, string>;
  requestBody?: string;
  status?: number;
  statusText?: string;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  responseType?: string;
  durationMs: number;
  ok: boolean;
  error?: string;
}) {
  const slow = data.durationMs >= 3000;
  const severity: MonitorSeverity = !data.ok ? "error" : slow ? "warn" : "info";
  const status = data.status ? `${data.status}${data.statusText ? ` ${data.statusText}` : ""}` : "failed";
  emit({
    kind: "network",
    severity,
    message: `${data.method} ${data.url}`,
    details: data.error || `${status} · ${Math.round(data.durationMs)} ms`,
    method: data.method,
    requestType: data.requestType,
    requestHeaders: data.requestHeaders,
    requestBody: data.requestBody,
    status: data.status,
    statusText: data.statusText,
    responseHeaders: data.responseHeaders,
    responseBody: data.responseBody,
    responseType: data.responseType,
    durationMs: Math.round(data.durationMs),
    ok: data.ok
  });
}

function emit(event: Omit<MonitorEvent, "id" | "timestamp" | "pageUrl" | "title">) {
  const item = {
    id: `monitor-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    pageUrl: window.location.href,
    title: document.title,
    ...event
  };
  if (item.kind === "network") {
    window.__DOM_AI_NETWORK_EVENTS__ = [item, ...(window.__DOM_AI_NETWORK_EVENTS__ || [])].slice(0, 200);
  } else {
    window.__DOM_AI_DEVTOOLS_CONSOLE__ = [item, ...(window.__DOM_AI_DEVTOOLS_CONSOLE__ || [])].slice(0, 600);
  }
  post({
    source: "DOM_AI_MONITOR_BRIDGE",
    type: "event",
    event: item
  });
}

function post(payload: BridgePayload) {
  window.postMessage(payload, "*");
}

function getFetchMethod(input: RequestInfo | URL, init?: RequestInit) {
  return (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
}

function getFetchUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function getFetchHeaders(input: RequestInfo | URL, init?: RequestInit): Record<string, string> {
  return {
    ...(input instanceof Request ? headersToObject(input.headers) : {}),
    ...(init?.headers ? headersToObject(new Headers(init.headers)) : {})
  };
}

async function getRequestBodyPreview(input: RequestInfo | URL, init?: RequestInit): Promise<string | undefined> {
  if (init?.body !== undefined) return formatRequestBody(init.body);
  if (input instanceof Request) {
    try {
      return await input.clone().text().then(truncate);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

async function getResponseBodyPreview(response: Response): Promise<string | undefined> {
  try {
    const type = response.headers.get("content-type") || "";
    if (/^image\//i.test(type)) {
      return await blobToDataUrl(await response.clone().blob());
    }
    if (!/json|text|xml|html|javascript|form|graphql/i.test(type)) return undefined;
    return truncate(await response.clone().text());
  } catch {
    return undefined;
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function headersToObject(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

function parseHeaderString(headers: string): Record<string, string> {
  return headers.split(/\r?\n/).reduce<Record<string, string>>((result, line) => {
    const index = line.indexOf(":");
    if (index > 0) result[line.slice(0, index).trim()] = line.slice(index + 1).trim();
    return result;
  }, {});
}

function formatRequestBody(body: unknown): string | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return truncate(body);
  if (body instanceof URLSearchParams) return truncate(body.toString());
  if (body instanceof FormData) {
    const entries: Record<string, string> = {};
    body.forEach((value, key) => {
      entries[key] = typeof value === "string" ? value : `[File ${value.name}]`;
    });
    return formatValue(entries);
  }
  if (body instanceof Blob) return `[Blob ${body.type || "application/octet-stream"} ${body.size} bytes]`;
  if (body instanceof ArrayBuffer) return `[ArrayBuffer ${body.byteLength} bytes]`;
  return formatValue(body);
}

function getBodyContentType(body: unknown): string {
  if (body instanceof Blob) return body.type || "application/octet-stream";
  if (body instanceof FormData) return "multipart/form-data";
  if (body instanceof URLSearchParams) return "application/x-www-form-urlencoded;charset=UTF-8";
  return "text/plain;charset=UTF-8";
}

function getXhrResponseBody(xhr: XMLHttpRequest, url?: string): string | undefined {
  try {
    const contentType = xhr.getResponseHeader("content-type") || "";
    if (/^image\//i.test(contentType)) {
      if (xhr.response instanceof Blob) return URL.createObjectURL(xhr.response);
      if (xhr.response instanceof ArrayBuffer) return arrayBufferToDataUrl(xhr.response, contentType);
      return url;
    }
    if (xhr.responseType && xhr.responseType !== "text" && xhr.responseType !== "json") return `[${xhr.responseType} response]`;
    const response = xhr.responseType === "json" ? xhr.response : xhr.responseText;
    return formatValue(response);
  } catch {
    return undefined;
  }
}

function arrayBufferToDataUrl(buffer: ArrayBuffer, contentType: string): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return `data:${contentType.split(";")[0]};base64,${btoa(binary)}`;
}

function formatValue(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "string") return truncate(value);
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
  if (value instanceof Error) return truncate(value.stack || value.message);
  if (value instanceof Element) return formatElementPreview(value);
  if (value instanceof Event) return `[${value.type} Event] ${formatPlainObjectPreview(value)}`;
  if (Array.isArray(value)) return truncate(`[${value.map(formatValue).join(", ")}]`);
  try {
    const json = JSON.stringify(value, getCircularReplacer(), 2);
    if (json && json !== "{}") return truncate(json);
    return truncate(formatPlainObjectPreview(value));
  } catch {
    return truncate(String(value));
  }
}

function formatElementPreview(element: Element): string {
  const id = element.id ? `#${element.id}` : "";
  const classes = typeof element.className === "string" && element.className
    ? `.${element.className.trim().split(/\s+/).slice(0, 4).join(".")}`
    : "";
  return `<${element.tagName.toLowerCase()}${id}${classes}>`;
}

function formatPlainObjectPreview(value: unknown): string {
  if (!value || typeof value !== "object") return String(value);
  const name = Object.prototype.toString.call(value).slice(8, -1);
  const entries = Object.keys(value as Record<string, unknown>).slice(0, 8).map((key) => {
    const item = (value as Record<string, unknown>)[key];
    if (item && typeof item === "object") return `${key}: ${Object.prototype.toString.call(item).slice(8, -1)}`;
    return `${key}: ${String(item)}`;
  });
  return entries.length ? `${name} { ${entries.join(", ")} }` : `${name} {}`;
}

function getCircularReplacer() {
  const seen = new WeakSet<object>();
  return (_key: string, value: unknown) => {
    if (typeof value !== "object" || value === null) return value;
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    return value;
  };
}

function truncate(value: string) {
  return value.length > MAX_PREVIEW_LENGTH ? `${value.slice(0, MAX_PREVIEW_LENGTH)}...` : value;
}

function getStack() {
  const stack = new Error().stack;
  if (!stack) return undefined;
  return stack.split("\n").slice(3).join("\n").trim() || undefined;
}

declare global {
  interface XMLHttpRequest {
    __domAiMonitorMeta?: {
      method: string;
      url: string;
      requestHeaders: Record<string, string>;
    };
  }
}
