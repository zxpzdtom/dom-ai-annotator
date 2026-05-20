import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AlertTriangle, Clipboard, Plus, Search, Settings, Trash2, X } from "lucide-react";
import "./index.css";
import type { MonitorEvent, MonitorSeverity } from "../shared/types";
import { useColumnResize } from "../shared/useColumnResize";
import { type IgnoreRules, type CustomSuspiciousRule, getIgnoreRules, saveIgnoreRules, isIgnored, matchCustomSuspicious } from "../shared/ignoreRules";

type View = "suspicious" | "console" | "network" | "settings";
type NetworkTypeFilter = "fetch-xhr" | "doc" | "css" | "js" | "img" | "font" | "media" | "ws" | "other";
type StatusFilter = "2xx" | "3xx" | "4xx" | "5xx" | "failed";
type SortKey = "name" | "status" | "type" | "method" | "time";
type SortState = { key: SortKey; direction: "asc" | "desc" } | null;

// Module-level ref for custom suspicious rules (updated by App component)
let _customSuspiciousRules: CustomSuspiciousRule[] = [];

const MAX_EVENTS = 600;
const BODY_LIMIT = 3000;
const CONSOLE_LEVELS: MonitorSeverity[] = ["error", "warn", "log", "info"];
const NETWORK_TYPES: Array<{ key: NetworkTypeFilter; label: string }> = [
  { key: "fetch-xhr", label: "Fetch/XHR" },
  { key: "doc", label: "Doc" },
  { key: "css", label: "CSS" },
  { key: "js", label: "JS" },
  { key: "img", label: "Img" },
  { key: "font", label: "Font" },
  { key: "media", label: "Media" },
  { key: "ws", label: "WS" },
  { key: "other", label: "Other" }
];
const STATUS_FILTERS: StatusFilter[] = ["4xx", "5xx", "2xx", "3xx", "failed"];

function App() {
  const [view, setView] = useState<View>("suspicious");
  const [consoleEvents, setConsoleEvents] = useState<MonitorEvent[]>([]);
  const [networkEvents, setNetworkEvents] = useState<MonitorEvent[]>([]);
  const [consoleLevels, setConsoleLevels] = useState<Set<MonitorSeverity>>(() => new Set(["error", "warn"]));
  const [includeUnhandled, setIncludeUnhandled] = useState(true);
  const [networkTypes, setNetworkTypes] = useState<Set<NetworkTypeFilter>>(() => new Set(["fetch-xhr"]));
  const [statusFilters, setStatusFilters] = useState<Set<StatusFilter>>(() => new Set(["4xx", "5xx", "failed"]));
  const [keyword, setKeyword] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [activeId, setActiveId] = useState("");
  const [sort, setSort] = useState<SortState>(null);
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState("");
  const [detailOpen, setDetailOpen] = useState(true);
  const [detailWidth, setDetailWidth] = useState(360);
  const [ignoreRules, setIgnoreRules] = useState<IgnoreRules>({ urlPatterns: [], messagePatterns: [], domains: [], customSuspicious: [] });
  const detailResizing = useRef<{ startX: number; startWidth: number } | null>(null);
  const suspiciousOnly = view === "suspicious";

  // Detail panel resize via drag on its left border
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      const ctx = detailResizing.current;
      if (!ctx) return;
      const delta = ctx.startX - e.clientX;
      setDetailWidth(Math.max(200, Math.min(700, ctx.startWidth + delta)));
    }
    function onMouseUp() { detailResizing.current = null; }
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => { document.removeEventListener("mousemove", onMouseMove); document.removeEventListener("mouseup", onMouseUp); };
  }, []);

  useEffect(() => {
    getIgnoreRules().then((r) => { setIgnoreRules(r); _customSuspiciousRules = r.customSuspicious; }).catch(() => undefined);
  }, []);

  useEffect(() => {
    installConsoleHook();
    const timer = window.setInterval(() => {
      readConsoleEvents().then((items) => setConsoleEvents(dedupeConsole(items).slice(0, MAX_EVENTS))).catch(() => undefined);
    }, 800);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const devtools = chrome.devtools;
    const listener = (request: chrome.devtools.network.Request) => {
      request.getContent((content, encoding) => {
        setNetworkEvents((items) => [requestToMonitorEvent(request, content, encoding), ...items].slice(0, MAX_EVENTS));
      });
    };
    devtools.network.onRequestFinished.addListener(listener);
    return () => devtools.network.onRequestFinished.removeListener(listener);
  }, []);

  const allEvents = view === "console" ? consoleEvents : view === "network" ? networkEvents : [];
  const suspicious = useMemo(() => [...consoleEvents, ...networkEvents].filter((e) => !isIgnored(e, ignoreRules) && isSuspicious(e)), [consoleEvents, networkEvents, ignoreRules]);

  // Suspicious mode: split filtered results by kind for the stacked view
  const suspiciousFiltered = useMemo(() => {
    if (!suspiciousOnly) return { console: [] as MonitorEvent[], network: [] as MonitorEvent[] };
    const query = keyword.trim().toLowerCase();
    const all = [...consoleEvents, ...networkEvents].filter((event) => !isIgnored(event, ignoreRules) && isSuspicious(event) && matchesKeyword(event, query));
    return {
      console: all.filter((e) => e.kind !== "network"),
      network: sortNetwork(all.filter((e) => e.kind === "network"), sort),
    };
  }, [suspiciousOnly, keyword, consoleEvents, networkEvents, sort, ignoreRules]);

  // Normal mode: tab-based filtering
  const visibleEvents = useMemo(() => {
    if (suspiciousOnly || view === "settings") return [] as MonitorEvent[];
    const query = keyword.trim().toLowerCase();
    const filtered = allEvents.filter((event) => {
      if (isIgnored(event, ignoreRules)) return false;
      if (view === "console") {
        const unhandled = event.message.toLowerCase().includes("unhandled promise");
        if (unhandled && includeUnhandled) return matchesKeyword(event, query);
        if (!consoleLevels.has(event.severity)) return false;
      } else {
        if (!matchesNetworkType(event, networkTypes)) return false;
        if (!matchesStatus(event, statusFilters)) return false;
      }
      return matchesKeyword(event, query);
    });
    return view === "network" ? sortNetwork(filtered, sort) : filtered;
  }, [allEvents, consoleLevels, ignoreRules, includeUnhandled, keyword, networkTypes, sort, statusFilters, suspiciousOnly, view]);

  const suspiciousVisibleCount = suspiciousFiltered.console.length + suspiciousFiltered.network.length;
  const allEventsFlat = [...consoleEvents, ...networkEvents];
  const activeEvent = allEventsFlat.find((event) => event.id === activeId)
    || (suspiciousOnly ? (suspiciousFiltered.console[0] || suspiciousFiltered.network[0]) : visibleEvents[0]);
  const selectedEvents = allEventsFlat.filter((event) => selectedIds.has(event.id));
  const copyItems = selectedEvents.length ? selectedEvents : suspicious.slice(0, 20);

  const activateItem = useCallback((id: string) => {
    setActiveId(id);
    setDetailOpen(true);
  }, []);

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function copyForAi() {
    await navigator.clipboard.writeText(exportForAi(copyItems));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2000);
  }

  function clear() {
    if (view === "console") {
      clearConsoleEvents();
      setConsoleEvents([]);
    } else if (view === "network") {
      setNetworkEvents([]);
    } else {
      clearConsoleEvents();
      setConsoleEvents([]);
      setNetworkEvents([]);
    }
    setSelectedIds(new Set());
    setActiveId("");
  }

  return (
    <div className="app">
      <div className="tabs">
        <button className={`tab ${view === "suspicious" ? "active" : ""}`} onClick={() => setView("suspicious")}>
          <AlertTriangle size={14} /> Suspicious <span className="mono">{suspicious.length}</span>
        </button>
        <button className={`tab ${view === "console" ? "active" : ""}`} onClick={() => setView("console")}>
          Console <span className="mono">{consoleEvents.length}</span>
        </button>
        <button className={`tab ${view === "network" ? "active" : ""}`} onClick={() => setView("network")}>
          Network <span className="mono">{networkEvents.length}</span>
        </button>
        <button className={`tab ${view === "settings" ? "active" : ""}`} onClick={() => setView("settings")}>
          <Settings size={14} /> Ignore Rules
        </button>
      </div>

      {view !== "settings" && (
        <div className="toolbar">
          {view === "console" ? (
            <div className="toolbar-group">
              {CONSOLE_LEVELS.map((level) => (
                <button key={level} className={`chip ${consoleLevels.has(level) ? "active" : ""}`} onClick={() => setConsoleLevels(toggleSet(consoleLevels, level))}>
                  {level} <span className="mono">{consoleEvents.filter((event) => event.severity === level).length}</span>
                </button>
              ))}
              <button className={`chip ${includeUnhandled ? "active" : ""}`} onClick={() => setIncludeUnhandled(!includeUnhandled)}>
                unhandled
              </button>
            </div>
          ) : view === "network" ? (
            <div className="toolbar-group">
              {NETWORK_TYPES.map((item) => (
                <button key={item.key} className={`chip ${networkTypes.has(item.key) ? "active" : ""}`} onClick={() => setNetworkTypes(toggleSet(networkTypes, item.key))}>
                  {item.label}
                </button>
              ))}
              {STATUS_FILTERS.map((item) => (
                <button key={item} className={`chip ${statusFilters.has(item) ? "active" : ""}`} onClick={() => setStatusFilters(toggleSet(statusFilters, item))}>
                  {item}
                </button>
              ))}
            </div>
          ) : null}
          <label className="search">
            <Search size={15} />
            <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="Filter by url, token, errorCode..." />
          </label>
          <button className="chip" onClick={clear}>
            <Trash2 size={14} /> Clear
          </button>
        </div>
      )}

      <div className="main" style={view !== "settings" && detailOpen ? { gridTemplateColumns: `minmax(0, 1fr) auto ${detailWidth}px` } : { gridTemplateColumns: "1fr" }}>
        <div className="table-wrap">
          {view === "settings" ? (
            <SettingsPanel rules={ignoreRules} onChange={(rules) => { setIgnoreRules(rules); _customSuspiciousRules = rules.customSuspicious; void saveIgnoreRules(rules); }} />
          ) : suspiciousOnly ? (
            <SuspiciousView
              consoleEvents={suspiciousFiltered.console}
              networkEvents={suspiciousFiltered.network}
              selectedIds={selectedIds}
              activeId={activeEvent?.id || ""}
              sort={sort}
              onSort={setSort}
              onToggle={toggleSelected}
              onActivate={activateItem}
            />
          ) : visibleEvents.length ? (
            view === "console" ? (
              <ConsoleTable events={visibleEvents} selectedIds={selectedIds} activeId={activeEvent?.id || ""} onToggle={toggleSelected} onActivate={activateItem} />
            ) : (
              <NetworkTable events={visibleEvents} selectedIds={selectedIds} activeId={activeEvent?.id || ""} sort={sort} onSort={setSort} onToggle={toggleSelected} onActivate={activateItem} />
            )
          ) : (
            <div className="empty">No matching {view === "console" ? "console messages" : view === "network" ? "network requests" : "items"}</div>
          )}
        </div>
        {view !== "settings" && detailOpen && (
          <>
            <div className="detail-resize-handle" onMouseDown={(e) => { e.preventDefault(); detailResizing.current = { startX: e.clientX, startWidth: detailWidth }; }} />
            <Detail event={activeEvent} onClose={() => { setDetailOpen(false); setActiveId(""); }} />
          </>
        )}
      </div>

      <div className="footer">
        <span>{suspiciousOnly ? suspiciousVisibleCount : visibleEvents.length} visible</span>
        <span>{selectedIds.size} selected</span>
        <span>Estimated size: {formatBytes(exportForAi(copyItems).length)}</span>
        <span className="spacer" />
        <button onClick={() => setSelectedIds(new Set(
          suspiciousOnly
            ? [...suspiciousFiltered.console, ...suspiciousFiltered.network].map((e) => e.id)
            : visibleEvents.map((e) => e.id)
        ))}>Select visible</button>
        <button onClick={() => setSelectedIds(new Set())}>Clear selection</button>
        <button className="primary" onClick={() => void copyForAi()} disabled={!copyItems.length}>
          <Clipboard size={14} /> {copied ? "Copied" : "Copy for AI"}
        </button>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function ConsoleTable({ events, selectedIds, activeId, onToggle, onActivate }: { events: MonitorEvent[]; selectedIds: Set<string>; activeId: string; onToggle: (id: string) => void; onActivate: (id: string) => void }) {
  const { widths, onResizeStart } = useColumnResize([40, 90, 360, 190, 80, 76]);
  return (
    <table className="table">
      <colgroup>
        <col style={{ width: widths[0] }} />
        <col style={{ width: widths[1] }} />
        <col style={{ width: widths[2] }} />
        <col style={{ width: widths[3] }} />
        <col style={{ width: widths[4] }} />
        <col style={{ width: widths[5] }} />
      </colgroup>
      <thead>
        <tr>
          <th className="check-cell" />
          <th>Level<span className="col-resize-handle" onMouseDown={(e) => onResizeStart(1, e)} /></th>
          <th>Message<span className="col-resize-handle" onMouseDown={(e) => onResizeStart(2, e)} /></th>
          <th>Source<span className="col-resize-handle" onMouseDown={(e) => onResizeStart(3, e)} /></th>
          <th>Count<span className="col-resize-handle" onMouseDown={(e) => onResizeStart(4, e)} /></th>
          <th>Time</th>
        </tr>
      </thead>
      <tbody>
        {events.map((event) => (
          <tr key={event.id} className={event.id === activeId ? "selected" : ""} onClick={() => onActivate(event.id)}>
            <td><input type="checkbox" checked={selectedIds.has(event.id)} onChange={() => onToggle(event.id)} onClick={(click) => click.stopPropagation()} /></td>
            <td className={`level-${event.severity}`}>{event.severity}</td>
            <td className="mono">{event.message}</td>
            <td className="mono">{sourceLabel(event)}</td>
            <td className="mono">{event.details || "1"}</td>
            <td className="mono">{formatTime(event.timestamp)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function NetworkTable({ events, selectedIds, activeId, sort, onSort, onToggle, onActivate }: { events: MonitorEvent[]; selectedIds: Set<string>; activeId: string; sort: SortState; onSort: (sort: SortState) => void; onToggle: (id: string) => void; onActivate: (id: string) => void }) {
  const { widths, onResizeStart } = useColumnResize([40, 360, 76, 150, 86, 82]);
  const sortIcon = (key: SortKey) => sort?.key === key ? (sort.direction === "asc" ? " ▲" : " ▼") : "";
  return (
    <table className="table">
      <colgroup>
        <col style={{ width: widths[0] }} />
        <col style={{ width: widths[1] }} />
        <col style={{ width: widths[2] }} />
        <col style={{ width: widths[3] }} />
        <col style={{ width: widths[4] }} />
        <col style={{ width: widths[5] }} />
      </colgroup>
      <thead>
        <tr>
          <th className="check-cell" />
          <th onClick={() => onSort(nextSort(sort, "name"))}>Name{sortIcon("name")}<span className="col-resize-handle" onMouseDown={(e) => { e.stopPropagation(); onResizeStart(1, e); }} /></th>
          <th onClick={() => onSort(nextSort(sort, "status"))}>Status{sortIcon("status")}<span className="col-resize-handle" onMouseDown={(e) => { e.stopPropagation(); onResizeStart(2, e); }} /></th>
          <th onClick={() => onSort(nextSort(sort, "type"))}>Type{sortIcon("type")}<span className="col-resize-handle" onMouseDown={(e) => { e.stopPropagation(); onResizeStart(3, e); }} /></th>
          <th onClick={() => onSort(nextSort(sort, "method"))}>Method{sortIcon("method")}<span className="col-resize-handle" onMouseDown={(e) => { e.stopPropagation(); onResizeStart(4, e); }} /></th>
          <th onClick={() => onSort(nextSort(sort, "time"))}>Time{sortIcon("time")}</th>
        </tr>
      </thead>
      <tbody>
        {events.map((event) => (
          <tr key={event.id} className={event.id === activeId ? "selected" : ""} onClick={() => onActivate(event.id)}>
            <td><input type="checkbox" checked={selectedIds.has(event.id)} onChange={() => onToggle(event.id)} onClick={(click) => click.stopPropagation()} /></td>
            <td className="mono">{networkName(event.message)}</td>
            <td className={event.ok === false || (event.status || 0) >= 400 ? "status-bad" : (event.status || 0) >= 300 ? "status-warn" : ""}>{event.status ?? "failed"}</td>
            <td className="mono">{event.responseType || event.requestType || "fetch"}</td>
            <td className="mono">{event.method || "GET"}</td>
            <td className="mono">{event.durationMs ?? 0} ms</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Detail({ event, onClose }: { event?: MonitorEvent; onClose: () => void }) {
  if (!event) return (
    <aside className="detail">
      <div className="detail-head">
        <span>Details</span>
        <button onClick={onClose} title="Close panel"><X size={14} /></button>
      </div>
      <div className="empty">Select an item</div>
    </aside>
  );
  return (
    <aside className="detail">
      <div className="detail-head">
        <span>{event.kind === "network" ? networkName(event.message) : event.severity}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {getSuspiciousReason(event) ? <span className="level-warn" title={getSuspiciousReason(event)!.detail}>suspicious: {getSuspiciousReason(event)!.label}</span> : null}
          <button onClick={onClose} title="Close panel"><X size={14} /></button>
        </div>
      </div>
      <div className="detail-body">
        <Section title="General" rows={{
          Type: event.kind,
          URL: event.kind === "network" ? event.message.replace(/^\S+\s+/, "") : event.pageUrl,
          Method: event.method,
          Status: event.status ? `${event.status} ${event.statusText || ""}` : undefined,
          Duration: event.durationMs ? `${event.durationMs} ms` : undefined,
          Time: new Date(event.timestamp).toLocaleString()
        }} />
        {event.kind === "network" ? (
          <>
            <Section title="Request Headers" rows={event.requestHeaders} />
            {event.requestBody ? <TextBlock title="Payload" value={event.requestBody} /> : null}
            <Section title="Response Headers" rows={event.responseHeaders} />
            {event.responseBody ? <TextBlock title="Response" value={formatBody(event.responseBody)} /> : null}
          </>
        ) : (
          <>
            <TextBlock title="Message" value={event.message} />
            {event.stack ? <TextBlock title="Stack" value={event.stack} /> : null}
          </>
        )}
      </div>
    </aside>
  );
}

function Section({ title, rows }: { title: string; rows?: Record<string, unknown> }) {
  const entries = Object.entries(rows || {}).filter(([, value]) => value !== undefined && value !== "");
  if (!entries.length) return null;
  return <section className="detail-section"><h3>{title}</h3>{entries.map(([key, value]) => <p className="kv" key={key}><b>{key}:</b> {String(value)}</p>)}</section>;
}

function TextBlock({ title, value }: { title: string; value: string }) {
  return <section className="detail-section"><h3>{title}</h3><pre className="mono">{value}</pre></section>;
}

function installConsoleHook() {
  chrome.devtools.inspectedWindow.eval(`(${consoleHookSource})()`);
}

function readConsoleEvents(): Promise<MonitorEvent[]> {
  return new Promise((resolve, reject) => {
    chrome.devtools.inspectedWindow.eval("window.__DOM_AI_DEVTOOLS_CONSOLE__ || []", (result, exceptionInfo) => {
      if (exceptionInfo) reject(exceptionInfo);
      else resolve(Array.isArray(result) ? result as MonitorEvent[] : []);
    });
  });
}

function clearConsoleEvents() {
  chrome.devtools.inspectedWindow.eval("window.__DOM_AI_DEVTOOLS_CONSOLE__ = []");
}

function consoleHookSource() {
  const win = window as Window & { __DOM_AI_DEVTOOLS_HOOKED__?: boolean; __DOM_AI_DEVTOOLS_CONSOLE__?: MonitorEvent[] };
  if (win.__DOM_AI_DEVTOOLS_HOOKED__) return win.__DOM_AI_DEVTOOLS_CONSOLE__ || [];
  win.__DOM_AI_DEVTOOLS_HOOKED__ = true;
  win.__DOM_AI_DEVTOOLS_CONSOLE__ = win.__DOM_AI_DEVTOOLS_CONSOLE__ || [];
  const push = (event: Omit<MonitorEvent, "id" | "timestamp" | "pageUrl" | "title">) => {
    win.__DOM_AI_DEVTOOLS_CONSOLE__!.unshift({
      id: `console-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      pageUrl: location.href,
      title: document.title,
      ...event
    });
    win.__DOM_AI_DEVTOOLS_CONSOLE__ = win.__DOM_AI_DEVTOOLS_CONSOLE__!.slice(0, 600);
  };
  const format = (value: unknown) => {
    try {
      if (typeof value === "string") return value;
      if (value instanceof Error) return value.stack || value.message;
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  };
  (["error", "warn", "log", "info", "debug"] as Array<MonitorSeverity | "debug">).forEach((level) => {
    const original = console[level];
    if (typeof original !== "function") return;
    console[level] = (...args: unknown[]) => {
      const stack = new Error().stack;
      push({ kind: "console", severity: level === "debug" ? "log" : level, message: args.map(format).join(" "), stack });
      original.apply(console, args);
    };
  });
  window.addEventListener("error", (event) => {
    const error = event.error instanceof Error ? event.error : undefined;
    push({ kind: "error", severity: "error", message: error?.message || event.message || "Uncaught error", stack: error?.stack, source: event.filename, line: event.lineno, column: event.colno });
  }, true);
  window.addEventListener("unhandledrejection", (event) => {
    push({ kind: "error", severity: "error", message: `Unhandled promise rejection: ${format(event.reason)}`, stack: event.reason instanceof Error ? event.reason.stack : undefined });
  }, true);
  return win.__DOM_AI_DEVTOOLS_CONSOLE__;
}

function requestToMonitorEvent(request: chrome.devtools.network.Request, content: string, encoding: string): MonitorEvent {
  const mime = request.response.content.mimeType || "";
  const body = shouldKeepBody(mime) ? truncate(encoding === "base64" ? `[base64 ${content.length} chars omitted]` : content, BODY_LIMIT) : "";
  const url = request.request.url;
  const status = request.response.status || undefined;
  return {
    id: `network-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    kind: "network",
    severity: !status || status >= 400 ? "error" : status >= 300 || request.time > 3000 ? "warn" : "info",
    timestamp: new Date().toISOString(),
    pageUrl: url,
    title: chrome.devtools.inspectedWindow.tabId ? `tab:${chrome.devtools.inspectedWindow.tabId}` : "inspected page",
    message: `${request.request.method || "GET"} ${url}`,
    method: request.request.method || "GET",
    requestType: classifyRequestType(mime, url),
    requestHeaders: headersToObject(request.request.headers),
    requestBody: truncate(request.request.postData?.text || "", BODY_LIMIT) || undefined,
    status,
    statusText: request.response.statusText,
    responseHeaders: headersToObject(request.response.headers),
    responseBody: body || undefined,
    responseType: mime,
    durationMs: Math.round(request.time || 0),
    ok: Boolean(status && status >= 200 && status < 400)
  };
}

function headersToObject(headers: chrome.devtools.network.Request["request"]["headers"]): Record<string, string> {
  return (headers || []).reduce<Record<string, string>>((result, item) => {
    result[item.name] = item.value;
    return result;
  }, {});
}

function classifyRequestType(mime: string, url: string): MonitorEvent["requestType"] {
  const lower = `${mime} ${url}`.toLowerCase();
  if (lower.includes("websocket") || lower.startsWith("ws")) return "websocket";
  if (/json|fetch|xhr|graphql|api/.test(lower)) return "fetch";
  return "resource";
}

function networkBucket(event: MonitorEvent): NetworkTypeFilter {
  const type = String(event.responseType || "").toLowerCase();
  const url = event.message.toLowerCase();
  if (event.requestType === "fetch" || event.requestType === "xhr" || /json|graphql|\/api\//.test(`${type} ${url}`)) return "fetch-xhr";
  if (type.includes("html") || /\.html?(?:[?#]|$)/.test(url)) return "doc";
  if (type.includes("css") || /\.css(?:[?#]|$)/.test(url)) return "css";
  if (type.includes("javascript") || /\.(m?js|jsx|ts|tsx)(?:[?#]|$)/.test(url)) return "js";
  if (type.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg|ico|avif)(?:[?#]|$)/.test(url)) return "img";
  if (type.includes("font") || /\.(woff2?|ttf|otf|eot)(?:[?#]|$)/.test(url)) return "font";
  if (type.startsWith("audio/") || type.startsWith("video/") || /\.(mp4|webm|mp3|wav|ogg|mov)(?:[?#]|$)/.test(url)) return "media";
  if (event.requestType === "websocket") return "ws";
  return "other";
}

function matchesNetworkType(event: MonitorEvent, filters: Set<NetworkTypeFilter>) {
  return filters.has(networkBucket(event));
}

function matchesStatus(event: MonitorEvent, filters: Set<StatusFilter>) {
  const status = event.status || 0;
  if (!status) return filters.has("failed");
  if (status >= 200 && status < 300) return filters.has("2xx");
  if (status >= 300 && status < 400) return filters.has("3xx");
  if (status >= 400 && status < 500) return filters.has("4xx");
  if (status >= 500) return filters.has("5xx");
  return false;
}

function matchesKeyword(event: MonitorEvent, query: string) {
  if (!query) return true;
  return JSON.stringify(event).toLowerCase().includes(query);
}

type SuspiciousReason = {
  label: string;      // primary tag (e.g. "404", "error", "body")
  summary: string;    // human-readable one-liner shown alongside the tag
  detail: string;     // full reason for tooltip
  tone: "error" | "warn" | "info";
};

function getSuspiciousReason(event: MonitorEvent): SuspiciousReason | null {
  if (event.kind !== "network") {
    if (event.severity === "error") {
      const msg = event.message.slice(0, 80).split("\n")[0];
      return { label: "error", summary: msg, detail: `Console error: ${event.message.slice(0, 200)}`, tone: "error" };
    }
    if (event.severity === "warn") {
      const msg = event.message.slice(0, 80).split("\n")[0];
      return { label: "warn", summary: msg, detail: `Console warning: ${event.message.slice(0, 200)}`, tone: "warn" };
    }
    return null;
  }
  const isApi = networkBucket(event) === "fetch-xhr";
  const status = event.status || 0;
  const statusText = event.statusText || "";
  // Any request type: flag HTTP errors (status code)
  if (!status || event.ok === false) return { label: "failed", summary: "No response or network error", detail: "Request failed — the server did not respond, DNS lookup failed, or the connection was refused.", tone: "error" };
  if (status >= 500) return { label: `${status}`, summary: statusText || "Server Error", detail: `HTTP ${status} ${statusText} — the server returned an internal error.`, tone: "error" };
  if (status >= 400) return { label: `${status}`, summary: statusText || "Client Error", detail: `HTTP ${status} ${statusText} — the requested resource could not be served.`, tone: "error" };
  // Only API requests: also check response body for structured error signals
  if (isApi) {
    const bodySignal = detectBodyErrorSignal(event.responseBody || "");
    if (bodySignal) {
      return { label: bodySignal.label, summary: bodySignal.summary, detail: bodySignal.detail, tone: "warn" };
    }
  }
  // Custom suspicious rules (user-defined)
  if (_customSuspiciousRules.length) {
    const customMatch = matchCustomSuspicious(event, _customSuspiciousRules);
    if (customMatch) {
      return {
        label: `"${customMatch.matchedKeyword}"`,
        summary: `matched rule: ${customMatch.rule.urlPattern}`,
        detail: `Custom rule: URL matches "${customMatch.rule.urlPattern}" and body contains "${customMatch.matchedKeyword}": ${customMatch.context}`,
        tone: "warn"
      };
    }
  }
  return null;
}

/**
 * Detect structured error signals in API response bodies.
 *
 * Instead of blindly scanning for keywords like "error" or "timeout" (which
 * cause false positives on config fields like `{ "timeout": 30000 }`), we
 * look for patterns that indicate an actual error response:
 *
 * 1. JSON error keys — `"error":`, `"errors":`, `"exception":` as top-level
 *    fields (the value is a string/object, not a count or boolean)
 * 2. Explicit failure flags — `"success": false`, `"ok": false`
 * 3. Error messages — the value of `"message"` or `"msg"` fields containing
 *    error-related words
 */
function detectBodyErrorSignal(body: string): { label: string; summary: string; detail: string } | null {
  const lower = body.toLowerCase();

  // 1. "success": false / "ok": false — explicit failure flag
  const falseFlag = lower.match(/"(success|ok)"\s*:\s*false/);
  if (falseFlag) {
    const key = falseFlag[1];
    return { label: `${key}:false`, summary: `Response indicates failure`, detail: `Response body contains "${key}": false — the API explicitly reported a failed operation.` };
  }

  // 2. "error": "..." / "error": { ... } / "errors": [...] — error as a value field
  //    Exclude "error": null, "error": 0, "error": false, "error_count" etc.
  const errorKey = lower.match(/"(errors?|exception)"\s*:\s*("(?:[^"\\]|\\.)+"|{|\[)/);
  if (errorKey) {
    const key = errorKey[1];
    const valuePreview = errorKey[2].slice(0, 60);
    return { label: `"${key}"`, summary: `error field in response`, detail: `Response body contains "${key}": ${valuePreview}… — the API returned a structured error.` };
  }

  // 3. "message"/"msg" field containing error-related words
  const msgMatch = lower.match(/"(?:message|msg)"\s*:\s*"((?:[^"\\]|\\.){0,200})"/);
  if (msgMatch) {
    const msgValue = msgMatch[1];
    const errorWord = msgValue.match(/\b(error|exception|failed|failure|timeout|timed out|denied|unauthorized|forbidden|not found|internal server)\b/);
    if (errorWord) {
      return { label: `"${errorWord[1]}"`, summary: `in message field`, detail: `Response message contains "${errorWord[1]}": "${msgValue.slice(0, 120)}"` };
    }
  }

  return null;
}

function isSuspicious(event: MonitorEvent): boolean {
  return getSuspiciousReason(event) !== null;
}

function dedupeConsole(items: MonitorEvent[]) {
  const byKey = new Map<string, MonitorEvent & { count?: number }>();
  for (const item of items) {
    const key = `${item.kind}:${item.severity}:${item.message}:${item.source || ""}:${item.line || ""}`;
    const existing = byKey.get(key);
    if (existing) existing.count = (existing.count || 1) + 1;
    else byKey.set(key, { ...item, count: 1 });
  }
  return Array.from(byKey.values()).map((item) => ({ ...item, details: String(item.count || 1) }));
}

function sortNetwork(items: MonitorEvent[], sort: SortState) {
  if (!sort) return items;
  const sorted = [...items].sort((a, b) => {
    const av = sortValue(a, sort.key);
    const bv = sortValue(b, sort.key);
    if (typeof av === "number" && typeof bv === "number") return av - bv;
    return String(av).localeCompare(String(bv));
  });
  return sort.direction === "desc" ? sorted.reverse() : sorted;
}

function sortValue(event: MonitorEvent, key: SortKey) {
  if (key === "name") return networkName(event.message);
  if (key === "status") return event.status || 0;
  if (key === "type") return event.responseType || event.requestType || "";
  if (key === "method") return event.method || "";
  return event.durationMs || 0;
}

function nextSort(current: SortState, key: SortKey): SortState {
  if (!current || current.key !== key) return { key, direction: "asc" };
  if (current.direction === "asc") return { key, direction: "desc" };
  return null;
}

function toggleSet<T>(set: Set<T>, value: T) {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function shouldKeepBody(mime: string) {
  return /json|text|xml|html|javascript|form|graphql/i.test(mime);
}

function truncate(value: string, limit: number) {
  if (!value) return "";
  return value.length > limit ? `${value.slice(0, limit)}\n...[truncated ${value.length - limit} chars]` : value;
}

function formatBody(value: string) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function sourceLabel(event: MonitorEvent) {
  if (!event.source) return "";
  return `${event.source.split("/").pop() || event.source}${event.line ? `:${event.line}` : ""}`;
}

function networkName(message: string) {
  const url = message.replace(/^\S+\s+/, "");
  try {
    const parsed = new URL(url);
    return parsed.pathname.split("/").filter(Boolean).pop() || parsed.hostname;
  } catch {
    return url;
  }
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  return `${(size / 1024).toFixed(1)} KB`;
}

function exportForAi(events: MonitorEvent[]) {
  return events.map((event, index) => {
    const lines = [`## ${index + 1}. ${event.kind.toUpperCase()} ${event.severity}`];
    lines.push(`- time: ${event.timestamp}`);
    lines.push(`- message: ${event.message}`);
    if (event.status) lines.push(`- status: ${event.status} ${event.statusText || ""}`);
    if (event.method) lines.push(`- method: ${event.method}`);
    if (event.requestBody) lines.push(`- payload:\n\`\`\`\n${truncate(event.requestBody, BODY_LIMIT)}\n\`\`\``);
    if (event.responseBody) lines.push(`- response:\n\`\`\`\n${formatBody(truncate(event.responseBody, BODY_LIMIT))}\n\`\`\``);
    if (event.stack) lines.push(`- stack:\n\`\`\`\n${event.stack}\n\`\`\``);
    return lines.join("\n");
  }).join("\n\n");
}

function SuspiciousView({
  consoleEvents,
  networkEvents,
  selectedIds,
  activeId,
  sort,
  onSort,
  onToggle,
  onActivate,
}: {
  consoleEvents: MonitorEvent[];
  networkEvents: MonitorEvent[];
  selectedIds: Set<string>;
  activeId: string;
  sort: SortState;
  onSort: (s: SortState) => void;
  onToggle: (id: string) => void;
  onActivate: (id: string) => void;
}) {
  if (!consoleEvents.length && !networkEvents.length) {
    return <div className="empty">No suspicious items found</div>;
  }
  return (
    <div>
      {consoleEvents.length > 0 && (
        <div className="suspicious-section">
          <div className="suspicious-header">Console <span className="mono">{consoleEvents.length}</span></div>
          <SuspiciousConsoleTable events={consoleEvents} selectedIds={selectedIds} activeId={activeId} onToggle={onToggle} onActivate={onActivate} />
        </div>
      )}
      {networkEvents.length > 0 && (
        <div className="suspicious-section">
          <div className="suspicious-header">Network <span className="mono">{networkEvents.length}</span></div>
          <SuspiciousNetworkTable events={networkEvents} selectedIds={selectedIds} activeId={activeId} sort={sort} onSort={onSort} onToggle={onToggle} onActivate={onActivate} />
        </div>
      )}
    </div>
  );
}

function ReasonTag({ event }: { event: MonitorEvent }) {
  const reason = getSuspiciousReason(event);
  if (!reason) return null;
  const cls = reason.tone === "error" ? "reason-tag reason-error" : reason.tone === "warn" ? "reason-tag reason-warn" : "reason-tag reason-info";
  return (
    <span className={cls} title={reason.detail}>
      <b>{reason.label}</b> {reason.summary}
    </span>
  );
}

function SuspiciousConsoleTable({ events, selectedIds, activeId, onToggle, onActivate }: { events: MonitorEvent[]; selectedIds: Set<string>; activeId: string; onToggle: (id: string) => void; onActivate: (id: string) => void }) {
  const { widths, onResizeStart } = useColumnResize([40, 60, 400, 150, 70]);
  return (
    <table className="table">
      <colgroup>
        <col style={{ width: widths[0] }} />
        <col style={{ width: widths[1] }} />
        <col style={{ width: widths[2] }} />
        <col style={{ width: widths[3] }} />
        <col style={{ width: widths[4] }} />
      </colgroup>
      <thead>
        <tr>
          <th className="check-cell" />
          <th>Level<span className="col-resize-handle" onMouseDown={(e) => onResizeStart(1, e)} /></th>
          <th>Message<span className="col-resize-handle" onMouseDown={(e) => onResizeStart(2, e)} /></th>
          <th>Source<span className="col-resize-handle" onMouseDown={(e) => onResizeStart(3, e)} /></th>
          <th>Time</th>
        </tr>
      </thead>
      <tbody>
        {events.map((event) => (
          <tr key={event.id} className={event.id === activeId ? "selected" : ""} onClick={() => onActivate(event.id)}>
            <td><input type="checkbox" checked={selectedIds.has(event.id)} onChange={() => onToggle(event.id)} onClick={(click) => click.stopPropagation()} /></td>
            <td className={`level-${event.severity}`}>{event.severity}</td>
            <td className="mono">{event.message}</td>
            <td className="mono">{sourceLabel(event)}</td>
            <td className="mono">{formatTime(event.timestamp)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SuspiciousNetworkTable({ events, selectedIds, activeId, sort, onSort, onToggle, onActivate }: { events: MonitorEvent[]; selectedIds: Set<string>; activeId: string; sort: SortState; onSort: (sort: SortState) => void; onToggle: (id: string) => void; onActivate: (id: string) => void }) {
  const { widths, onResizeStart } = useColumnResize([40, 260, 56, 200, 90, 60, 70]);
  const sortIcon = (key: SortKey) => sort?.key === key ? (sort.direction === "asc" ? " ▲" : " ▼") : "";
  return (
    <table className="table">
      <colgroup>
        <col style={{ width: widths[0] }} />
        <col style={{ width: widths[1] }} />
        <col style={{ width: widths[2] }} />
        <col style={{ width: widths[3] }} />
        <col style={{ width: widths[4] }} />
        <col style={{ width: widths[5] }} />
        <col style={{ width: widths[6] }} />
      </colgroup>
      <thead>
        <tr>
          <th className="check-cell" />
          <th onClick={() => onSort(nextSort(sort, "name"))}>Name{sortIcon("name")}<span className="col-resize-handle" onMouseDown={(e) => { e.stopPropagation(); onResizeStart(1, e); }} /></th>
          <th onClick={() => onSort(nextSort(sort, "status"))}>Status{sortIcon("status")}<span className="col-resize-handle" onMouseDown={(e) => { e.stopPropagation(); onResizeStart(2, e); }} /></th>
          <th>Reason<span className="col-resize-handle" onMouseDown={(e) => onResizeStart(3, e)} /></th>
          <th onClick={() => onSort(nextSort(sort, "type"))}>Type{sortIcon("type")}<span className="col-resize-handle" onMouseDown={(e) => { e.stopPropagation(); onResizeStart(4, e); }} /></th>
          <th onClick={() => onSort(nextSort(sort, "method"))}>Method{sortIcon("method")}<span className="col-resize-handle" onMouseDown={(e) => { e.stopPropagation(); onResizeStart(5, e); }} /></th>
          <th onClick={() => onSort(nextSort(sort, "time"))}>Time{sortIcon("time")}</th>
        </tr>
      </thead>
      <tbody>
        {events.map((event) => (
          <tr key={event.id} className={event.id === activeId ? "selected" : ""} onClick={() => onActivate(event.id)} title={getSuspiciousReason(event)?.detail}>
            <td><input type="checkbox" checked={selectedIds.has(event.id)} onChange={() => onToggle(event.id)} onClick={(click) => click.stopPropagation()} /></td>
            <td className="mono">{networkName(event.message)}</td>
            <td className={event.ok === false || (event.status || 0) >= 400 ? "status-bad" : (event.status || 0) >= 300 ? "status-warn" : ""}>{event.status ?? "failed"}</td>
            <td><ReasonTag event={event} /></td>
            <td className="mono">{event.responseType || event.requestType || "fetch"}</td>
            <td className="mono">{event.method || "GET"}</td>
            <td className="mono">{event.durationMs ?? 0} ms</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SettingsPanel({ rules, onChange }: { rules: IgnoreRules; onChange: (rules: IgnoreRules) => void }) {
  const [urlInput, setUrlInput] = useState("");
  const [msgInput, setMsgInput] = useState("");
  const [domainInput, setDomainInput] = useState("");
  const [csUrlInput, setCsUrlInput] = useState("");
  const [csKeywordInput, setCsKeywordInput] = useState("");

  type StringField = "urlPatterns" | "messagePatterns" | "domains";

  function addStringRule(field: StringField, value: string) {
    const trimmed = value.trim();
    if (!trimmed || rules[field].includes(trimmed)) return;
    onChange({ ...rules, [field]: [...rules[field], trimmed] });
  }

  function removeStringRule(field: StringField, index: number) {
    onChange({ ...rules, [field]: rules[field].filter((_, i) => i !== index) });
  }

  function addCustomSuspicious() {
    const url = csUrlInput.trim();
    const keyword = csKeywordInput.trim();
    if (!url || !keyword) return;
    if (rules.customSuspicious.some((r) => r.urlPattern === url && r.bodyKeyword === keyword)) return;
    onChange({ ...rules, customSuspicious: [...rules.customSuspicious, { urlPattern: url, bodyKeyword: keyword }] });
    setCsUrlInput("");
    setCsKeywordInput("");
  }

  function removeCustomSuspicious(index: number) {
    onChange({ ...rules, customSuspicious: rules.customSuspicious.filter((_, i) => i !== index) });
  }

  return (
    <div className="settings-panel">
      <h2 className="settings-title">Ignore Rules</h2>

      <div className="settings-section">
        <h3>Ignored URL Patterns</h3>
        <p className="settings-hint">Glob patterns matched against network request URLs. Use <code>*</code> for any segment, <code>**</code> for any path.</p>
        <div className="rule-input">
          <input
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { addStringRule("urlPatterns", urlInput); setUrlInput(""); } }}
            placeholder="e.g. */hot-update*, *analytics*, */health"
          />
          <button onClick={() => { addStringRule("urlPatterns", urlInput); setUrlInput(""); }}><Plus size={14} /> Add</button>
        </div>
        <div className="rule-list">
          {rules.urlPatterns.map((pattern, i) => (
            <span className="rule-item" key={i}>
              <code>{pattern}</code>
              <button onClick={() => removeStringRule("urlPatterns", i)}><X size={12} /></button>
            </span>
          ))}
          {!rules.urlPatterns.length && <span className="rule-empty">No URL patterns configured</span>}
        </div>
      </div>

      <div className="settings-section">
        <h3>Ignored Console Messages</h3>
        <p className="settings-hint">Substring patterns matched against console messages (case-insensitive).</p>
        <div className="rule-input">
          <input
            value={msgInput}
            onChange={(e) => setMsgInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { addStringRule("messagePatterns", msgInput); setMsgInput(""); } }}
            placeholder="e.g. [HMR], DevTools failed, Download the React DevTools"
          />
          <button onClick={() => { addStringRule("messagePatterns", msgInput); setMsgInput(""); }}><Plus size={14} /> Add</button>
        </div>
        <div className="rule-list">
          {rules.messagePatterns.map((pattern, i) => (
            <span className="rule-item" key={i}>
              <code>{pattern}</code>
              <button onClick={() => removeStringRule("messagePatterns", i)}><X size={12} /></button>
            </span>
          ))}
          {!rules.messagePatterns.length && <span className="rule-empty">No message patterns configured</span>}
        </div>
      </div>

      <div className="settings-section">
        <h3>Ignored Domains</h3>
        <p className="settings-hint">Requests to these domains (and subdomains) will be hidden from all views.</p>
        <div className="rule-input">
          <input
            value={domainInput}
            onChange={(e) => setDomainInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { addStringRule("domains", domainInput); setDomainInput(""); } }}
            placeholder="e.g. analytics.google.com, sentry.io, hotjar.com"
          />
          <button onClick={() => { addStringRule("domains", domainInput); setDomainInput(""); }}><Plus size={14} /> Add</button>
        </div>
        <div className="rule-list">
          {rules.domains.map((domain, i) => (
            <span className="rule-item" key={i}>
              <code>{domain}</code>
              <button onClick={() => removeStringRule("domains", i)}><X size={12} /></button>
            </span>
          ))}
          {!rules.domains.length && <span className="rule-empty">No domains configured</span>}
        </div>
      </div>

      <h2 className="settings-title settings-title-top">Custom Suspicious Rules</h2>

      <div className="settings-section">
        <p className="settings-hint">Flag an API response as suspicious when its URL matches a pattern <b>and</b> its response body contains a specific keyword.</p>
        <div className="rule-input rule-input-dual">
          <input
            value={csUrlInput}
            onChange={(e) => setCsUrlInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addCustomSuspicious(); }}
            placeholder="URL pattern, e.g. */api/*, */graphql"
          />
          <input
            value={csKeywordInput}
            onChange={(e) => setCsKeywordInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addCustomSuspicious(); }}
            placeholder="Body keyword, e.g. error, failed, invalid"
          />
          <button onClick={addCustomSuspicious}><Plus size={14} /> Add</button>
        </div>
        <div className="rule-list">
          {rules.customSuspicious.map((rule, i) => (
            <span className="rule-item" key={i}>
              <code>{rule.urlPattern}</code>
              <span className="rule-arrow">→</span>
              <code>{rule.bodyKeyword}</code>
              <button onClick={() => removeCustomSuspicious(i)}><X size={12} /></button>
            </span>
          ))}
          {!rules.customSuspicious.length && <span className="rule-empty">No custom suspicious rules configured</span>}
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
