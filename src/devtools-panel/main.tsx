import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AlertTriangle, Clipboard, Filter, Globe, Pencil, Plus, RotateCcw, Search, Settings, Trash2, X } from "lucide-react";
import "./index.css";
import type { MonitorEvent, MonitorSeverity } from "../shared/types";
import { useColumnResize } from "../shared/useColumnResize";
import {
  type IgnoreRules,
  type SuspiciousRule,
  type RuleTarget,
  type RuleOperator,
  type RuleCondition,
  type RuleSeverity,
  DEFAULT_SUSPICIOUS_RULES,
  getIgnoreRules,
  saveIgnoreRules,
  getSuspiciousRules,
  saveSuspiciousRules,
  isIgnored,
  evaluateRule,
} from "../shared/ignoreRules";
import { type Locale, type TranslationKey, getLocale, saveLocale, t } from "./locale";

// ─── Tailwind helper mappings ────────────────────────────────────────────────

const LEVEL_CLASS: Record<string, string> = {
  error: "text-red-600 font-bold",
  warn: "text-amber-700 font-bold",
  log: "",
  info: "",
};

const BADGE_CLASS: Record<string, string> = {
  console: "bg-blue-100 text-blue-700",
  http: "bg-amber-100 text-amber-800",
  network: "bg-red-100 text-red-800",
  body: "bg-emerald-100 text-emerald-800",
  custom: "bg-violet-100 text-violet-800",
  duration: "bg-violet-100 text-violet-800",
};

const SEVERITY_DOT_CLASS: Record<string, string> = {
  error: "bg-red-600",
  warn: "bg-amber-500",
  info: "bg-blue-500",
};

const statusBadClass = (event: MonitorEvent) =>
  event.ok === false || (event.status && event.status >= 400)
    ? "text-red-600 font-bold"
    : event.status && event.status >= 300
      ? "text-amber-700 font-bold"
      : "";

// ─── i18n Context ────────────────────────────────────────────────────────────

const LocaleContext = createContext<Locale>("en");

function useLocale(): Locale {
  return useContext(LocaleContext);
}

function useT() {
  const locale = useLocale();
  return (key: TranslationKey) => t(key, locale);
}

type View = "suspicious" | "console" | "network" | "ignore-rules" | "suspicious-rules";
type NetworkTypeFilter = "fetch-xhr" | "doc" | "css" | "js" | "img" | "font" | "media" | "ws" | "other";
type StatusFilter = "2xx" | "3xx" | "4xx" | "5xx" | "failed";
type SortKey = "name" | "status" | "type" | "method" | "time" | "level" | "message" | "count";
type SortState = { key: SortKey; direction: "asc" | "desc" } | null;

// Module-level ref for suspicious rules (updated by App component, used by getSuspiciousReason)
let _suspiciousRules: SuspiciousRule[] = [];

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
  const [ignoreRules, setIgnoreRules] = useState<IgnoreRules>({ urlPatterns: [], messagePatterns: [], domains: [] });
  const [suspiciousRules, setSuspiciousRules] = useState<SuspiciousRule[]>([]);
  const [locale, setLocaleState] = useState<Locale>("en");
  const detailResizing = useRef<{ startX: number; startWidth: number } | null>(null);
  const suspiciousOnly = view === "suspicious";
  const isSettingsView = view === "ignore-rules" || view === "suspicious-rules";

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
    getIgnoreRules().then((r) => setIgnoreRules(r)).catch(() => undefined);
    getSuspiciousRules().then((r) => { setSuspiciousRules(r); _suspiciousRules = r; }).catch(() => undefined);
    getLocale().then((l) => setLocaleState(l)).catch(() => undefined);
  }, []);

  function toggleLocale() {
    const next: Locale = locale === "en" ? "zh" : "en";
    setLocaleState(next);
    void saveLocale(next);
  }

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
  const suspicious = useMemo(() => [...consoleEvents, ...networkEvents].filter((e) => !isIgnored(e, ignoreRules) && isSuspicious(e)), [consoleEvents, networkEvents, ignoreRules, suspiciousRules]); // eslint-disable-line react-hooks/exhaustive-deps

  // Suspicious mode: split filtered results by kind for the stacked view
  const suspiciousFiltered = useMemo(() => {
    if (!suspiciousOnly) return { console: [] as MonitorEvent[], network: [] as MonitorEvent[] };
    const query = keyword.trim().toLowerCase();
    const all = [...consoleEvents, ...networkEvents].filter((event) => !isIgnored(event, ignoreRules) && isSuspicious(event) && matchesKeyword(event, query));
    return {
      console: all.filter((e) => e.kind !== "network"),
      network: sortEvents(all.filter((e) => e.kind === "network"), sort),
    };
  }, [suspiciousOnly, keyword, consoleEvents, networkEvents, sort, ignoreRules, suspiciousRules]); // eslint-disable-line react-hooks/exhaustive-deps

  // Normal mode: tab-based filtering
  const visibleEvents = useMemo(() => {
    if (suspiciousOnly || isSettingsView) return [] as MonitorEvent[];
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
    return sortEvents(filtered, sort);
  }, [allEvents, consoleLevels, ignoreRules, includeUnhandled, keyword, networkTypes, sort, statusFilters, suspiciousOnly, isSettingsView, view]);

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

  function toggleAll(ids: string[], select: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (select) {
        for (const id of ids) next.add(id);
      } else {
        for (const id of ids) next.delete(id);
      }
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

  function handleIgnoreRulesChange(rules: IgnoreRules) {
    setIgnoreRules(rules);
    void saveIgnoreRules(rules);
  }

  function handleSuspiciousRulesChange(rules: SuspiciousRule[]) {
    setSuspiciousRules(rules);
    _suspiciousRules = rules;
    void saveSuspiciousRules(rules);
  }

  const _ = (key: TranslationKey) => t(key, locale);

  return (
    <LocaleContext.Provider value={locale}>
    <div className="flex flex-col h-screen bg-white">
      <div className="flex items-end gap-1 px-2 border-b border-slate-300 bg-[#edf3fb]">
        <button className={`inline-flex items-center gap-[5px] h-10 border-0 border-b-2 border-transparent bg-transparent text-[#3c4043] px-3 font-semibold ${view === "suspicious" ? "!border-[#1a73e8] !text-[#0b57d0]" : ""}`} onClick={() => setView("suspicious")}>
          <AlertTriangle size={14} /> {_("tab.suspicious")} <span className="font-mono">{suspicious.length}</span>
        </button>
        <button className={`inline-flex items-center gap-[5px] h-10 border-0 border-b-2 border-transparent bg-transparent text-[#3c4043] px-3 font-semibold ${view === "console" ? "!border-[#1a73e8] !text-[#0b57d0]" : ""}`} onClick={() => setView("console")}>
          {_("tab.console")} <span className="font-mono">{consoleEvents.length}</span>
        </button>
        <button className={`inline-flex items-center gap-[5px] h-10 border-0 border-b-2 border-transparent bg-transparent text-[#3c4043] px-3 font-semibold ${view === "network" ? "!border-[#1a73e8] !text-[#0b57d0]" : ""}`} onClick={() => setView("network")}>
          {_("tab.network")} <span className="font-mono">{networkEvents.length}</span>
        </button>
        <button className={`inline-flex items-center gap-[5px] h-10 border-0 border-b-2 border-transparent bg-transparent text-[#3c4043] px-3 font-semibold ${view === "ignore-rules" ? "!border-[#1a73e8] !text-[#0b57d0]" : ""}`} onClick={() => setView("ignore-rules")}>
          <Filter size={14} /> {_("tab.ignoreRules")}
        </button>
        <button className={`inline-flex items-center gap-[5px] h-10 border-0 border-b-2 border-transparent bg-transparent text-[#3c4043] px-3 font-semibold ${view === "suspicious-rules" ? "!border-[#1a73e8] !text-[#0b57d0]" : ""}`} onClick={() => setView("suspicious-rules")}>
          <Settings size={14} /> {_("tab.suspiciousRules")}
        </button>
        <button className="inline-flex items-center gap-[5px] h-10 border-0 border-b-2 border-transparent bg-transparent text-[#3c4043] px-3 font-semibold ml-auto !text-[#5f6368] !font-medium text-xs hover:!text-[#1a73e8]" onClick={toggleLocale} title={_("lang.tooltip")}>
          <Globe size={14} /> {_("lang.toggle")}
        </button>
      </div>

      {!isSettingsView && (
        <div className="flex items-center gap-2 px-2 py-1.5 border-b border-[#dbe3ef] bg-[#f8fbff]">
          {view === "console" ? (
            <div className="flex items-center gap-1 min-w-0">
              {CONSOLE_LEVELS.map((level) => (
                <button key={level} className={`inline-flex items-center gap-[5px] h-7 rounded-full px-2.5 whitespace-nowrap ${consoleLevels.has(level) ? "border border-blue-300 bg-blue-100 text-[#0b57d0]" : "border border-slate-300 bg-white text-[#3c4043]"}`} onClick={() => setConsoleLevels(toggleSet(consoleLevels, level))}>
                  {level} <span className="font-mono">{consoleEvents.filter((event) => event.severity === level).length}</span>
                </button>
              ))}
              <button className={`inline-flex items-center gap-[5px] h-7 rounded-full px-2.5 whitespace-nowrap ${includeUnhandled ? "border border-blue-300 bg-blue-100 text-[#0b57d0]" : "border border-slate-300 bg-white text-[#3c4043]"}`} onClick={() => setIncludeUnhandled(!includeUnhandled)}>
                {_("toolbar.unhandled")}
              </button>
            </div>
          ) : view === "network" ? (
            <div className="flex items-center gap-1 min-w-0">
              {NETWORK_TYPES.map((item) => (
                <button key={item.key} className={`inline-flex items-center gap-[5px] h-7 rounded-full px-2.5 whitespace-nowrap ${networkTypes.has(item.key) ? "border border-blue-300 bg-blue-100 text-[#0b57d0]" : "border border-slate-300 bg-white text-[#3c4043]"}`} onClick={() => setNetworkTypes(toggleSet(networkTypes, item.key))}>
                  {item.label}
                </button>
              ))}
              {STATUS_FILTERS.map((item) => (
                <button key={item} className={`inline-flex items-center gap-[5px] h-7 rounded-full px-2.5 whitespace-nowrap ${statusFilters.has(item) ? "border border-blue-300 bg-blue-100 text-[#0b57d0]" : "border border-slate-300 bg-white text-[#3c4043]"}`} onClick={() => setStatusFilters(toggleSet(statusFilters, item))}>
                  {item}
                </button>
              ))}
            </div>
          ) : null}
          <label className="flex items-center gap-2 min-w-[180px] flex-1 max-w-[520px] h-[30px] rounded-full bg-[#eaf0f8] text-[#5f6368] px-[11px] transition-shadow duration-150 focus-within:shadow-[0_0_0_2px_rgba(26,115,232,0.3)]">
            <Search size={15} />
            <input className="min-w-0 flex-1 border-0 outline-none bg-transparent text-[#202124] text-xs" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder={_("toolbar.filter.placeholder")} />
          </label>
          <button className="inline-flex items-center gap-[5px] h-7 border border-slate-300 rounded-full bg-white text-[#3c4043] px-2.5 whitespace-nowrap" onClick={clear}>
            <Trash2 size={14} /> {_("toolbar.clear")}
          </button>
        </div>
      )}

      <div className="grid flex-1 min-h-0" style={!isSettingsView && detailOpen ? { gridTemplateColumns: `minmax(0, 1fr) auto ${detailWidth}px` } : { gridTemplateColumns: "1fr" }}>
        <div className="min-w-0 overflow-auto">
          {view === "ignore-rules" ? (
            <IgnoreRulesPanel rules={ignoreRules} onChange={handleIgnoreRulesChange} />
          ) : view === "suspicious-rules" ? (
            <SuspiciousRulesPanel rules={suspiciousRules} onChange={handleSuspiciousRulesChange} onToast={showToast} />
          ) : suspiciousOnly ? (
            <SuspiciousView
              consoleEvents={suspiciousFiltered.console}
              networkEvents={suspiciousFiltered.network}
              selectedIds={selectedIds}
              activeId={activeEvent?.id || ""}
              sort={sort}
              onSort={setSort}
              onToggle={toggleSelected}
              onToggleAll={toggleAll}
              onActivate={activateItem}
            />
          ) : visibleEvents.length ? (
            view === "console" ? (
              <ConsoleTable events={visibleEvents} selectedIds={selectedIds} activeId={activeEvent?.id || ""} sort={sort} onSort={setSort} onToggle={toggleSelected} onToggleAll={toggleAll} onActivate={activateItem} />
            ) : (
              <NetworkTable events={visibleEvents} selectedIds={selectedIds} activeId={activeEvent?.id || ""} sort={sort} onSort={setSort} onToggle={toggleSelected} onToggleAll={toggleAll} onActivate={activateItem} />
            )
          ) : (
            <div className="px-6 py-12 text-[#7b8494] text-center font-semibold">{view === "console" ? _("empty.console") : view === "network" ? _("empty.network") : _("empty.items")}</div>
          )}
        </div>
        {!isSettingsView && detailOpen && (
          <>
            <div className="w-[5px] cursor-col-resize bg-transparent transition-[background] duration-150 hover:bg-blue-300 active:bg-blue-300" onMouseDown={(e) => { e.preventDefault(); detailResizing.current = { startX: e.clientX, startWidth: detailWidth }; }} />
            <Detail event={activeEvent} onClose={() => { setDetailOpen(false); setActiveId(""); }} />
          </>
        )}
      </div>

      <div className="flex items-center gap-2.5 border-t border-slate-300 bg-[#f8fbff] px-2.5 text-[#5f6368] text-xs tabular-nums">
        <span>{suspiciousOnly ? suspiciousVisibleCount : visibleEvents.length} {_("footer.visible")}</span>
        {selectedIds.size > 0 && <span>{selectedIds.size} {_("footer.selected")}</span>}
        <span>{_("footer.estimatedSize")}: {formatBytes(exportForAi(copyItems).length)}</span>
        <span className="flex-1" />
        {selectedIds.size > 0 && (
          <button className="inline-flex items-center gap-[5px] h-7 border border-slate-300 rounded-md bg-white text-[#202124] px-2.5 transition-[background,transform] duration-150 active:scale-[0.96]" onClick={() => setSelectedIds(new Set())}>{_("footer.clearSelection")}</button>
        )}
        <button className="inline-flex items-center gap-[5px] h-7 border border-slate-300 rounded-md bg-white text-[#202124] px-2.5 transition-[background,transform] duration-150 active:scale-[0.96] !border-[#1a73e8] !bg-[#1a73e8] !text-white" onClick={() => void copyForAi()} disabled={!copyItems.length}>
          <Clipboard size={14} /> {copied ? _("footer.copied") : selectedIds.size > 0 ? `${_("footer.copyForAi")} (${selectedIds.size})` : _("footer.copyForAi")}
        </button>
      </div>
      {toast && <div className="fixed bottom-[52px] left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-lg bg-slate-800 text-slate-100 text-xs font-semibold shadow-lg animate-toast-in pointer-events-none z-10">{toast}</div>}
    </div>
    </LocaleContext.Provider>
  );
}

// ─── Table Components ─────────────────────────────────────────────────────────

const TH_CLASS = "sticky top-0 z-[1] h-[31px] border-b border-slate-300 border-r border-slate-200 bg-[#f6f8fb] text-[#3c4043] px-2 text-left font-bold relative";
const TD_CLASS = "h-8 border-b border-[#edf0f4] border-r border-[#edf0f4] px-2 overflow-hidden text-ellipsis whitespace-nowrap select-text";
const CHECK_CELL_TH = `${TH_CLASS} w-10 text-center`;
const CHECK_CELL_TD = `${TD_CLASS} w-10 text-center`;
const RESIZE_HANDLE = "absolute -right-[2px] top-0 w-[5px] h-full cursor-col-resize z-[3] select-none hover:bg-blue-300 active:bg-blue-300";

function SelectAllCheckbox({ events, selectedIds, onToggleAll }: { events: MonitorEvent[]; selectedIds: Set<string>; onToggleAll: (ids: string[], select: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const ids = events.map((e) => e.id);
  const selectedCount = ids.filter((id) => selectedIds.has(id)).length;
  const allSelected = ids.length > 0 && selectedCount === ids.length;
  const someSelected = selectedCount > 0 && !allSelected;

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = someSelected;
  }, [someSelected]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={allSelected}
      onChange={() => onToggleAll(ids, !allSelected)}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

function ConsoleTable({ events, selectedIds, activeId, sort, onSort, onToggle, onToggleAll, onActivate }: { events: MonitorEvent[]; selectedIds: Set<string>; activeId: string; sort: SortState; onSort: (sort: SortState) => void; onToggle: (id: string) => void; onToggleAll: (ids: string[], select: boolean) => void; onActivate: (id: string) => void }) {
  const _ = useT();
  const { widths, onResizeStart } = useColumnResize([40, 90, 440, 80, 76]);
  const sortIcon = (key: SortKey) => sort?.key === key ? (sort.direction === "asc" ? " ▲" : " ▼") : "";
  return (
    <table className="w-full min-w-[760px] border-collapse table-fixed text-xs">
      <colgroup>
        <col style={{ width: widths[0] }} />
        <col style={{ width: widths[1] }} />
        <col style={{ width: widths[2] }} />
        <col style={{ width: widths[3] }} />
        <col style={{ width: widths[4] }} />
      </colgroup>
      <thead>
        <tr>
          <th className={CHECK_CELL_TH}><SelectAllCheckbox events={events} selectedIds={selectedIds} onToggleAll={onToggleAll} /></th>
          <th className={`${TH_CLASS} cursor-pointer hover:bg-[#edf2fb]`} onClick={() => onSort(nextSort(sort, "level"))}>{_("table.level")}{sortIcon("level")}<span className={RESIZE_HANDLE} onMouseDown={(e) => { e.stopPropagation(); onResizeStart(1, e); }} /></th>
          <th className={`${TH_CLASS} cursor-pointer hover:bg-[#edf2fb]`} onClick={() => onSort(nextSort(sort, "message"))}>{_("table.message")}{sortIcon("message")}<span className={RESIZE_HANDLE} onMouseDown={(e) => { e.stopPropagation(); onResizeStart(2, e); }} /></th>
          <th className={`${TH_CLASS} cursor-pointer hover:bg-[#edf2fb]`} onClick={() => onSort(nextSort(sort, "count"))}>{_("table.count")}{sortIcon("count")}<span className={RESIZE_HANDLE} onMouseDown={(e) => { e.stopPropagation(); onResizeStart(3, e); }} /></th>
          <th className={`${TH_CLASS} cursor-pointer hover:bg-[#edf2fb]`} onClick={() => onSort(nextSort(sort, "time"))}>{_("table.time")}{sortIcon("time")}</th>
        </tr>
      </thead>
      <tbody>
        {events.map((event) => (
          <tr key={event.id} className={event.id === activeId ? "bg-[#dfe7f3]" : "even:bg-slate-50 hover:bg-[#dfe7f3]"} onClick={() => onActivate(event.id)}>
            <td className={CHECK_CELL_TD}><input type="checkbox" checked={selectedIds.has(event.id)} onChange={() => onToggle(event.id)} onClick={(click) => click.stopPropagation()} /></td>
            <td className={`${TD_CLASS} ${LEVEL_CLASS[event.severity] || ""}`}>{event.severity}</td>
            <td className={`${TD_CLASS} font-mono`}>{event.message}</td>
            <td className={`${TD_CLASS} font-mono`}>{event.details || "1"}</td>
            <td className={`${TD_CLASS} font-mono`}>{formatTime(event.timestamp)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function NetworkTable({ events, selectedIds, activeId, sort, onSort, onToggle, onToggleAll, onActivate }: { events: MonitorEvent[]; selectedIds: Set<string>; activeId: string; sort: SortState; onSort: (sort: SortState) => void; onToggle: (id: string) => void; onToggleAll: (ids: string[], select: boolean) => void; onActivate: (id: string) => void }) {
  const _ = useT();
  const { widths, onResizeStart } = useColumnResize([40, 360, 76, 150, 86, 82]);
  const sortIcon = (key: SortKey) => sort?.key === key ? (sort.direction === "asc" ? " ▲" : " ▼") : "";
  return (
    <table className="w-full min-w-[760px] border-collapse table-fixed text-xs">
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
          <th className={CHECK_CELL_TH}><SelectAllCheckbox events={events} selectedIds={selectedIds} onToggleAll={onToggleAll} /></th>
          <th className={TH_CLASS} onClick={() => onSort(nextSort(sort, "name"))}>{_("table.name")}{sortIcon("name")}<span className={RESIZE_HANDLE} onMouseDown={(e) => { e.stopPropagation(); onResizeStart(1, e); }} /></th>
          <th className={TH_CLASS} onClick={() => onSort(nextSort(sort, "status"))}>{_("table.status")}{sortIcon("status")}<span className={RESIZE_HANDLE} onMouseDown={(e) => { e.stopPropagation(); onResizeStart(2, e); }} /></th>
          <th className={TH_CLASS} onClick={() => onSort(nextSort(sort, "type"))}>{_("table.type")}{sortIcon("type")}<span className={RESIZE_HANDLE} onMouseDown={(e) => { e.stopPropagation(); onResizeStart(3, e); }} /></th>
          <th className={TH_CLASS} onClick={() => onSort(nextSort(sort, "method"))}>{_("table.method")}{sortIcon("method")}<span className={RESIZE_HANDLE} onMouseDown={(e) => { e.stopPropagation(); onResizeStart(4, e); }} /></th>
          <th className={TH_CLASS} onClick={() => onSort(nextSort(sort, "time"))}>{_("table.time")}{sortIcon("time")}</th>
        </tr>
      </thead>
      <tbody>
        {events.map((event) => (
          <tr key={event.id} className={event.id === activeId ? "bg-[#dfe7f3]" : "even:bg-slate-50 hover:bg-[#dfe7f3]"} onClick={() => onActivate(event.id)}>
            <td className={CHECK_CELL_TD}><input type="checkbox" checked={selectedIds.has(event.id)} onChange={() => onToggle(event.id)} onClick={(click) => click.stopPropagation()} /></td>
            <td className={`${TD_CLASS} font-mono`}>{networkName(event.message)}</td>
            <td className={`${TD_CLASS} ${statusBadClass(event)}`}>{event.status ?? "failed"}</td>
            <td className={`${TD_CLASS} font-mono`}>{event.responseType || event.requestType || "fetch"}</td>
            <td className={`${TD_CLASS} font-mono`}>{event.method || "GET"}</td>
            <td className={`${TD_CLASS} font-mono`}>{event.durationMs ?? 0} ms</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Detail({ event, onClose }: { event?: MonitorEvent; onClose: () => void }) {
  const _ = useT();
  if (!event) return (
    <aside className="min-w-0 overflow-auto bg-white">
      <div className="sticky top-0 z-[2] flex items-center justify-between gap-2 h-9 border-b border-[#dbe3ef] bg-[#f6f8fb] px-2.5 font-bold">
        <span>{_("detail.title")}</span>
        <button className="inline-flex items-center justify-center w-6 h-6 border-0 rounded bg-transparent text-[#5f6368] p-0 shrink-0 hover:bg-slate-200 hover:text-[#202124]" onClick={onClose} title="Close panel"><X size={14} /></button>
      </div>
      <div className="px-6 py-12 text-[#7b8494] text-center font-semibold">{_("detail.selectItem")}</div>
    </aside>
  );
  return (
    <aside className="min-w-0 overflow-auto bg-white">
      <div className="sticky top-0 z-[2] flex items-center justify-between gap-2 h-9 border-b border-[#dbe3ef] bg-[#f6f8fb] px-2.5 font-bold">
        <span>{event.kind === "network" ? networkName(event.message) : event.severity}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {getSuspiciousReason(event) ? <span className="text-amber-700 font-bold" title={getSuspiciousReason(event)!.detail}>suspicious: {getSuspiciousReason(event)!.label}</span> : null}
          <button className="inline-flex items-center justify-center w-6 h-6 border-0 rounded bg-transparent text-[#5f6368] p-0 shrink-0 hover:bg-slate-200 hover:text-[#202124]" onClick={onClose} title="Close panel"><X size={14} /></button>
        </div>
      </div>
      <div className="p-3 text-xs leading-[1.55]">
        <Section title={_("detail.general")} rows={{
          Type: event.kind,
          URL: event.kind === "network" ? event.message.replace(/^\S+\s+/, "") : event.pageUrl,
          Method: event.method,
          Status: event.status ? `${event.status} ${event.statusText || ""}` : undefined,
          Duration: event.durationMs ? `${event.durationMs} ms` : undefined,
          Time: new Date(event.timestamp).toLocaleString()
        }} />
        {event.kind === "network" ? (
          <>
            <Section title={_("detail.requestHeaders")} rows={event.requestHeaders} />
            {event.requestBody ? <TextBlock title={_("detail.payload")} value={event.requestBody} /> : null}
            <Section title={_("detail.responseHeaders")} rows={event.responseHeaders} />
            {event.responseBody ? <TextBlock title={_("detail.response")} value={formatBody(event.responseBody)} /> : null}
          </>
        ) : (
          <>
            <TextBlock title={_("detail.message")} value={event.message} />
            {event.stack ? <TextBlock title={_("detail.stack")} value={event.stack} /> : null}
          </>
        )}
      </div>
    </aside>
  );
}

function Section({ title, rows }: { title: string; rows?: Record<string, unknown> }) {
  const entries = Object.entries(rows || {}).filter(([, value]) => value !== undefined && value !== "");
  if (!entries.length) return null;
  return <section className="mb-3.5"><h3 className="m-0 mb-1.5 text-[13px] font-bold">{title}</h3>{entries.map(([key, value]) => <p className="mb-0.5 break-all" key={key}><b className="text-purple-600">{key}:</b> {String(value)}</p>)}</section>;
}

function TextBlock({ title, value }: { title: string; value: string }) {
  return <section className="mb-3.5"><h3 className="m-0 mb-1.5 text-[13px] font-bold">{title}</h3><pre className="font-mono">{value}</pre></section>;
}

// ─── Suspicious Detection ─────────────────────────────────────────────────────

type SuspiciousReason = {
  label: string;
  summary: string;
  detail: string;
  tone: "error" | "warn" | "info";
};

function getSuspiciousReason(event: MonitorEvent): SuspiciousReason | null {
  for (const rule of _suspiciousRules) {
    if (!rule.enabled) continue;
    if (evaluateRule(event, rule)) {
      // Build a summary from the rule
      const summary = event.kind === "network"
        ? (event.statusText || event.status ? `${event.status} ${event.statusText || ""}`.trim() : event.message.slice(0, 60))
        : event.message.slice(0, 80).split("\n")[0];
      return {
        label: rule.label,
        summary,
        detail: rule.description || rule.label,
        tone: rule.severity || "warn",
      };
    }
  }
  return null;
}

function isSuspicious(event: MonitorEvent): boolean {
  return getSuspiciousReason(event) !== null;
}

// ─── Suspicious View ──────────────────────────────────────────────────────────

function SuspiciousView({
  consoleEvents,
  networkEvents,
  selectedIds,
  activeId,
  sort,
  onSort,
  onToggle,
  onToggleAll,
  onActivate,
}: {
  consoleEvents: MonitorEvent[];
  networkEvents: MonitorEvent[];
  selectedIds: Set<string>;
  activeId: string;
  sort: SortState;
  onSort: (s: SortState) => void;
  onToggle: (id: string) => void;
  onToggleAll: (ids: string[], select: boolean) => void;
  onActivate: (id: string) => void;
}) {
  const _ = useT();
  if (!consoleEvents.length && !networkEvents.length) {
    return <div className="px-6 py-12 text-[#7b8494] text-center font-semibold">{_("empty.suspicious")}</div>;
  }
  return (
    <div>
      {consoleEvents.length > 0 && (
        <div className="mb-0.5">
          <div className="sticky top-0 z-[2] flex items-center gap-2 h-[30px] border-b border-[#e2d28a] bg-[#fef9c3] px-3 font-bold text-xs text-[#78350f]">{_("suspicious.console")} <span className="font-mono">{consoleEvents.length}</span></div>
          <SuspiciousConsoleTable events={consoleEvents} selectedIds={selectedIds} activeId={activeId} onToggle={onToggle} onToggleAll={onToggleAll} onActivate={onActivate} />
        </div>
      )}
      {networkEvents.length > 0 && (
        <div className="mb-0.5">
          <div className="sticky top-0 z-[2] flex items-center gap-2 h-[30px] border-b border-[#e2d28a] bg-[#fef9c3] px-3 font-bold text-xs text-[#78350f]">{_("suspicious.network")} <span className="font-mono">{networkEvents.length}</span></div>
          <SuspiciousNetworkTable events={networkEvents} selectedIds={selectedIds} activeId={activeId} sort={sort} onSort={onSort} onToggle={onToggle} onToggleAll={onToggleAll} onActivate={onActivate} />
        </div>
      )}
    </div>
  );
}

function ReasonTag({ event }: { event: MonitorEvent }) {
  const reason = getSuspiciousReason(event);
  if (!reason) return null;
  const toneClass = reason.tone === "error"
    ? "bg-red-50 text-red-600 border border-red-300"
    : reason.tone === "warn"
      ? "bg-amber-50 text-amber-700 border border-amber-300"
      : "bg-blue-50 text-blue-600 border border-blue-300";
  return (
    <span className={`inline-flex items-baseline gap-1 max-w-full h-5 leading-5 rounded px-1.5 text-[11px] font-medium whitespace-nowrap overflow-hidden text-ellipsis cursor-default ${toneClass}`} title={reason.detail}>
      <b className="font-extrabold shrink-0">{reason.label}</b> {reason.summary}
    </span>
  );
}

function SuspiciousConsoleTable({ events, selectedIds, activeId, onToggle, onToggleAll, onActivate }: { events: MonitorEvent[]; selectedIds: Set<string>; activeId: string; onToggle: (id: string) => void; onToggleAll: (ids: string[], select: boolean) => void; onActivate: (id: string) => void }) {
  const _ = useT();
  const { widths, onResizeStart } = useColumnResize([40, 60, 500, 70]);
  return (
    <table className="w-full min-w-[760px] border-collapse table-fixed text-xs">
      <colgroup>
        <col style={{ width: widths[0] }} />
        <col style={{ width: widths[1] }} />
        <col style={{ width: widths[2] }} />
        <col style={{ width: widths[3] }} />
      </colgroup>
      <thead>
        <tr>
          <th className={CHECK_CELL_TH}><SelectAllCheckbox events={events} selectedIds={selectedIds} onToggleAll={onToggleAll} /></th>
          <th className={TH_CLASS}>{_("table.level")}<span className={RESIZE_HANDLE} onMouseDown={(e) => onResizeStart(1, e)} /></th>
          <th className={TH_CLASS}>{_("table.message")}<span className={RESIZE_HANDLE} onMouseDown={(e) => onResizeStart(2, e)} /></th>
          <th className={TH_CLASS}>{_("table.time")}</th>
        </tr>
      </thead>
      <tbody>
        {events.map((event) => (
          <tr key={event.id} className={event.id === activeId ? "bg-[#dfe7f3]" : "even:bg-slate-50 hover:bg-[#dfe7f3]"} onClick={() => onActivate(event.id)}>
            <td className={CHECK_CELL_TD}><input type="checkbox" checked={selectedIds.has(event.id)} onChange={() => onToggle(event.id)} onClick={(click) => click.stopPropagation()} /></td>
            <td className={`${TD_CLASS} ${LEVEL_CLASS[event.severity] || ""}`}>{event.severity}</td>
            <td className={`${TD_CLASS} font-mono`}>{event.message}</td>
            <td className={`${TD_CLASS} font-mono`}>{formatTime(event.timestamp)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SuspiciousNetworkTable({ events, selectedIds, activeId, sort, onSort, onToggle, onToggleAll, onActivate }: { events: MonitorEvent[]; selectedIds: Set<string>; activeId: string; sort: SortState; onSort: (sort: SortState) => void; onToggle: (id: string) => void; onToggleAll: (ids: string[], select: boolean) => void; onActivate: (id: string) => void }) {
  const _ = useT();
  const { widths, onResizeStart } = useColumnResize([40, 260, 56, 200, 90, 60, 70]);
  const sortIcon = (key: SortKey) => sort?.key === key ? (sort.direction === "asc" ? " ▲" : " ▼") : "";
  return (
    <table className="w-full min-w-[760px] border-collapse table-fixed text-xs">
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
          <th className={CHECK_CELL_TH}><SelectAllCheckbox events={events} selectedIds={selectedIds} onToggleAll={onToggleAll} /></th>
          <th className={TH_CLASS} onClick={() => onSort(nextSort(sort, "name"))}>{_("table.name")}{sortIcon("name")}<span className={RESIZE_HANDLE} onMouseDown={(e) => { e.stopPropagation(); onResizeStart(1, e); }} /></th>
          <th className={TH_CLASS} onClick={() => onSort(nextSort(sort, "status"))}>{_("table.status")}{sortIcon("status")}<span className={RESIZE_HANDLE} onMouseDown={(e) => { e.stopPropagation(); onResizeStart(2, e); }} /></th>
          <th className={TH_CLASS}>{_("table.reason")}<span className={RESIZE_HANDLE} onMouseDown={(e) => onResizeStart(3, e)} /></th>
          <th className={TH_CLASS} onClick={() => onSort(nextSort(sort, "type"))}>{_("table.type")}{sortIcon("type")}<span className={RESIZE_HANDLE} onMouseDown={(e) => { e.stopPropagation(); onResizeStart(4, e); }} /></th>
          <th className={TH_CLASS} onClick={() => onSort(nextSort(sort, "method"))}>{_("table.method")}{sortIcon("method")}<span className={RESIZE_HANDLE} onMouseDown={(e) => { e.stopPropagation(); onResizeStart(5, e); }} /></th>
          <th className={TH_CLASS} onClick={() => onSort(nextSort(sort, "time"))}>{_("table.time")}{sortIcon("time")}</th>
        </tr>
      </thead>
      <tbody>
        {events.map((event) => (
          <tr key={event.id} className={event.id === activeId ? "bg-[#dfe7f3]" : "even:bg-slate-50 hover:bg-[#dfe7f3]"} onClick={() => onActivate(event.id)} title={getSuspiciousReason(event)?.detail}>
            <td className={CHECK_CELL_TD}><input type="checkbox" checked={selectedIds.has(event.id)} onChange={() => onToggle(event.id)} onClick={(click) => click.stopPropagation()} /></td>
            <td className={`${TD_CLASS} font-mono`}>{networkName(event.message)}</td>
            <td className={`${TD_CLASS} ${statusBadClass(event)}`}>{event.status ?? "failed"}</td>
            <td className={TD_CLASS}><ReasonTag event={event} /></td>
            <td className={`${TD_CLASS} font-mono`}>{event.responseType || event.requestType || "fetch"}</td>
            <td className={`${TD_CLASS} font-mono`}>{event.method || "GET"}</td>
            <td className={`${TD_CLASS} font-mono`}>{event.durationMs ?? 0} ms</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── Ignore Rules Panel ───────────────────────────────────────────────────────

function IgnoreRulesPanel({ rules, onChange }: { rules: IgnoreRules; onChange: (rules: IgnoreRules) => void }) {
  const _ = useT();
  const [urlInput, setUrlInput] = useState("");
  const [msgInput, setMsgInput] = useState("");
  const [domainInput, setDomainInput] = useState("");

  type StringField = "urlPatterns" | "messagePatterns" | "domains";

  function addStringRule(field: StringField, value: string) {
    const trimmed = value.trim();
    if (!trimmed || rules[field].includes(trimmed)) return;
    onChange({ ...rules, [field]: [...rules[field], trimmed] });
  }

  function removeStringRule(field: StringField, index: number) {
    onChange({ ...rules, [field]: rules[field].filter((_, i) => i !== index) });
  }

  return (
    <div className="p-5 px-6 overflow-auto max-w-[760px] text-[13px]">
      <h2 className="m-0 mb-1.5 text-[15px] font-extrabold text-[#0b57d0]">{_("ignoreRules.title")}</h2>
      <p className="m-0 mb-5 text-[#5f6368] text-xs leading-normal">{_("ignoreRules.desc")}</p>

      <div className="mb-7">
        <h3 className="m-0 mb-1 text-sm font-bold text-[#202124]">{_("ignoreRules.urlPatterns")}</h3>
        <p className="m-0 mb-2.5 text-[#5f6368] text-xs leading-[1.4]">{_("ignoreRules.urlHint")}</p>
        <div className="flex gap-1.5 mb-2.5">
          <input
            className="flex-1 h-8 border border-slate-300 rounded-md px-2.5 text-xs bg-white text-[#202124] focus:outline-none focus:border-[#1a73e8] focus:shadow-[0_0_0_2px_rgba(26,115,232,0.15)]"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { addStringRule("urlPatterns", urlInput); setUrlInput(""); } }}
            placeholder={_("ignoreRules.urlPlaceholder")}
          />
          <button className="inline-flex items-center gap-1 h-8 border border-slate-300 rounded-md bg-white text-[#202124] px-3 text-xs font-semibold whitespace-nowrap hover:bg-[#f6f8fb] hover:border-[#1a73e8] hover:text-[#1a73e8]" onClick={() => { addStringRule("urlPatterns", urlInput); setUrlInput(""); }}><Plus size={14} /> {_("ignoreRules.add")}</button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {rules.urlPatterns.map((pattern, i) => (
            <span className="inline-flex items-center gap-1.5 h-7 border border-slate-200 rounded-md bg-slate-50 pl-2.5 pr-1.5 text-xs" key={i}>
              <code className="font-mono text-[11px] text-slate-700">{pattern}</code>
              <button className="inline-flex items-center justify-center w-[18px] h-[18px] border-0 rounded-[3px] bg-transparent text-slate-400 p-0 hover:bg-red-200 hover:text-red-600" onClick={() => removeStringRule("urlPatterns", i)}><X size={12} /></button>
            </span>
          ))}
          {!rules.urlPatterns.length && <span className="text-slate-400 text-xs italic">{_("ignoreRules.noUrlPatterns")}</span>}
        </div>
      </div>

      <div className="mb-7">
        <h3 className="m-0 mb-1 text-sm font-bold text-[#202124]">{_("ignoreRules.consoleMessages")}</h3>
        <p className="m-0 mb-2.5 text-[#5f6368] text-xs leading-[1.4]">{_("ignoreRules.consoleMsgHint")}</p>
        <div className="flex gap-1.5 mb-2.5">
          <input
            className="flex-1 h-8 border border-slate-300 rounded-md px-2.5 text-xs bg-white text-[#202124] focus:outline-none focus:border-[#1a73e8] focus:shadow-[0_0_0_2px_rgba(26,115,232,0.15)]"
            value={msgInput}
            onChange={(e) => setMsgInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { addStringRule("messagePatterns", msgInput); setMsgInput(""); } }}
            placeholder={_("ignoreRules.consoleMsgPlaceholder")}
          />
          <button className="inline-flex items-center gap-1 h-8 border border-slate-300 rounded-md bg-white text-[#202124] px-3 text-xs font-semibold whitespace-nowrap hover:bg-[#f6f8fb] hover:border-[#1a73e8] hover:text-[#1a73e8]" onClick={() => { addStringRule("messagePatterns", msgInput); setMsgInput(""); }}><Plus size={14} /> {_("ignoreRules.add")}</button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {rules.messagePatterns.map((pattern, i) => (
            <span className="inline-flex items-center gap-1.5 h-7 border border-slate-200 rounded-md bg-slate-50 pl-2.5 pr-1.5 text-xs" key={i}>
              <code className="font-mono text-[11px] text-slate-700">{pattern}</code>
              <button className="inline-flex items-center justify-center w-[18px] h-[18px] border-0 rounded-[3px] bg-transparent text-slate-400 p-0 hover:bg-red-200 hover:text-red-600" onClick={() => removeStringRule("messagePatterns", i)}><X size={12} /></button>
            </span>
          ))}
          {!rules.messagePatterns.length && <span className="text-slate-400 text-xs italic">{_("ignoreRules.noMsgPatterns")}</span>}
        </div>
      </div>

      <div className="mb-7">
        <h3 className="m-0 mb-1 text-sm font-bold text-[#202124]">{_("ignoreRules.domains")}</h3>
        <p className="m-0 mb-2.5 text-[#5f6368] text-xs leading-[1.4]">{_("ignoreRules.domainsHint")}</p>
        <div className="flex gap-1.5 mb-2.5">
          <input
            className="flex-1 h-8 border border-slate-300 rounded-md px-2.5 text-xs bg-white text-[#202124] focus:outline-none focus:border-[#1a73e8] focus:shadow-[0_0_0_2px_rgba(26,115,232,0.15)]"
            value={domainInput}
            onChange={(e) => setDomainInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { addStringRule("domains", domainInput); setDomainInput(""); } }}
            placeholder={_("ignoreRules.domainsPlaceholder")}
          />
          <button className="inline-flex items-center gap-1 h-8 border border-slate-300 rounded-md bg-white text-[#202124] px-3 text-xs font-semibold whitespace-nowrap hover:bg-[#f6f8fb] hover:border-[#1a73e8] hover:text-[#1a73e8]" onClick={() => { addStringRule("domains", domainInput); setDomainInput(""); }}><Plus size={14} /> {_("ignoreRules.add")}</button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {rules.domains.map((domain, i) => (
            <span className="inline-flex items-center gap-1.5 h-7 border border-slate-200 rounded-md bg-slate-50 pl-2.5 pr-1.5 text-xs" key={i}>
              <code className="font-mono text-[11px] text-slate-700">{domain}</code>
              <button className="inline-flex items-center justify-center w-[18px] h-[18px] border-0 rounded-[3px] bg-transparent text-slate-400 p-0 hover:bg-red-200 hover:text-red-600" onClick={() => removeStringRule("domains", i)}><X size={12} /></button>
            </span>
          ))}
          {!rules.domains.length && <span className="text-slate-400 text-xs italic">{_("ignoreRules.noDomains")}</span>}
        </div>
      </div>
    </div>
  );
}

// ─── Suspicious Rules Panel ───────────────────────────────────────────────────

const RULE_TARGETS: RuleTarget[] = ["console-message", "console-level", "url", "status-code", "response-body", "request-method", "request-type", "response-type", "duration", "network-error"];
const RULE_OPERATORS: RuleOperator[] = ["contains", "not-contains", "equals", "not-equals", "matches", "gte", "lte", "exists"];
const SEVERITY_OPTIONS: RuleSeverity[] = ["error", "warn", "info"];

/** Get the primary badge category from a rule's conditions */
function getRuleBadgeCategory(rule: SuspiciousRule): string {
  if (!rule.conditions.length) return "custom";
  const firstTarget = rule.conditions[0].target;
  if (firstTarget.startsWith("console")) return "console";
  if (firstTarget === "status-code" || firstTarget === "request-method") return "http";
  if (firstTarget === "network-error") return "network";
  if (firstTarget === "response-body") return "body";
  if (firstTarget === "url") return "http";
  return "custom";
}

function RuleBadge({ rule }: { rule: SuspiciousRule }) {
  const label = getRuleBadgeCategory(rule);
  return <span className={`inline-flex items-center h-[18px] px-1.5 rounded text-[10px] font-bold uppercase tracking-wide shrink-0 ${BADGE_CLASS[label] || BADGE_CLASS.custom}`}>{label}</span>;
}

function ConditionSummary({ conditions }: { conditions: RuleCondition[] }) {
  const _ = useT();
  if (!conditions.length) return null;
  return (
    <span className="flex flex-wrap items-center gap-1 mt-1">
      {conditions.map((c, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="text-[9px] font-bold text-slate-400 tracking-[0.5px] px-0.5 leading-5">AND</span>}
          <span className="inline-flex items-center gap-[3px] h-5 px-1.5 rounded bg-slate-100 border border-slate-200 text-[10px] text-slate-600">
            <span className="font-semibold text-slate-700">{_(`target.${c.target}` as TranslationKey)}</span>
            <span className="text-slate-500">{_(`op.${c.operator}` as TranslationKey)}</span>
            {c.operator !== "exists" && <code className="font-mono text-[10px] text-[#0b57d0] max-w-[140px] overflow-hidden text-ellipsis whitespace-nowrap">{c.value.length > 30 ? c.value.slice(0, 30) + "…" : c.value}</code>}
          </span>
        </React.Fragment>
      ))}
    </span>
  );
}

function SuspiciousRulesPanel({
  rules,
  onChange,
  onToast,
}: {
  rules: SuspiciousRule[];
  onChange: (rules: SuspiciousRule[]) => void;
  onToast: (msg: string) => void;
}) {
  const _ = useT();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ label: string; description: string; severity: RuleSeverity; conditions: RuleCondition[] }>({ label: "", description: "", severity: "warn", conditions: [] });
  const [isNewRule, setIsNewRule] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const confirmResetTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const confirmDeleteTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);

  const activeCount = rules.filter((r) => r.enabled).length;

  function toggleRule(id: string) {
    onChange(rules.map((r) => r.id === id ? { ...r, enabled: !r.enabled } : r));
  }

  function deleteRule(id: string) {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      if (confirmDeleteTimerRef.current) window.clearTimeout(confirmDeleteTimerRef.current);
      confirmDeleteTimerRef.current = window.setTimeout(() => setConfirmDeleteId(null), 3000);
      return;
    }
    if (confirmDeleteTimerRef.current) window.clearTimeout(confirmDeleteTimerRef.current);
    setConfirmDeleteId(null);
    onChange(rules.filter((r) => r.id !== id));
  }

  function startEdit(rule: SuspiciousRule) {
    setEditingId(rule.id);
    setIsNewRule(false);
    setEditDraft({ label: rule.label, description: rule.description, severity: rule.severity || "warn", conditions: [...rule.conditions.map((c) => ({ ...c }))] });
  }

  function commitEdit(id: string) {
    onChange(rules.map((r) => r.id === id ? { ...r, label: editDraft.label, description: editDraft.description, severity: editDraft.severity, conditions: editDraft.conditions } : r));
    setEditingId(null);
    setIsNewRule(false);
    setEditDraft({ label: "", description: "", severity: "warn", conditions: [] });
  }

  function cancelEdit() {
    if (isNewRule && editingId) {
      onChange(rules.filter((r) => r.id !== editingId));
    }
    setEditingId(null);
    setIsNewRule(false);
    setEditDraft({ label: "", description: "", severity: "warn", conditions: [] });
  }

  function addRule() {
    const newId = `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const newRule: SuspiciousRule = {
      id: newId,
      enabled: true,
      label: "",
      description: "",
      severity: "warn",
      conditions: [{ target: "console-message", operator: "contains", value: "" }],
    };
    onChange([...rules, newRule]);
    setEditingId(newId);
    setIsNewRule(true);
    setEditDraft({ label: "", description: "", severity: "warn", conditions: [{ target: "console-message", operator: "contains", value: "" }] });
  }

  function handleReset() {
    if (!confirmReset) {
      setConfirmReset(true);
      if (confirmResetTimerRef.current) window.clearTimeout(confirmResetTimerRef.current);
      confirmResetTimerRef.current = window.setTimeout(() => setConfirmReset(false), 3000);
      return;
    }
    if (confirmResetTimerRef.current) window.clearTimeout(confirmResetTimerRef.current);
    onChange([...DEFAULT_SUSPICIOUS_RULES]);
    setConfirmReset(false);
    setEditingId(null);
    setIsNewRule(false);
    onToast(_("suspiciousRules.toastReset"));
  }

  function updateCondition(index: number, field: keyof RuleCondition, value: string) {
    setEditDraft((d) => {
      const conditions = [...d.conditions];
      conditions[index] = { ...conditions[index], [field]: value };
      return { ...d, conditions };
    });
  }

  function addCondition() {
    setEditDraft((d) => ({ ...d, conditions: [...d.conditions, { target: "url" as RuleTarget, operator: "contains" as RuleOperator, value: "" }] }));
  }

  function removeCondition(index: number) {
    setEditDraft((d) => ({ ...d, conditions: d.conditions.filter((_, i) => i !== index) }));
  }

  function renderRuleRow(rule: SuspiciousRule) {
    const isEditing = editingId === rule.id;

    if (isEditing) {
      return (
        <div key={rule.id} className="flex flex-col gap-2.5 px-3.5 py-3 bg-slate-50 border-b border-slate-200 last:border-b-0">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2.5">
              <label className="shrink-0 w-[90px] text-[11px] font-semibold text-slate-500 text-right">{_("suspiciousRules.editLabel")}</label>
              <input
                className="flex-1 h-[30px] border border-slate-300 rounded-[5px] px-[9px] text-xs bg-white text-[#202124] focus:outline-none focus:border-[#1a73e8] focus:shadow-[0_0_0_2px_rgba(26,115,232,0.15)]"
                value={editDraft.label}
                onChange={(e) => setEditDraft((d) => ({ ...d, label: e.target.value }))}
                onKeyDown={(e) => { if (e.key === "Escape") cancelEdit(); }}
                placeholder={_("suspiciousRules.editLabelPlaceholder")}
                autoFocus
              />
            </div>
            <div className="flex items-center gap-2.5">
              <label className="shrink-0 w-[90px] text-[11px] font-semibold text-slate-500 text-right">{_("suspiciousRules.editDesc")}</label>
              <input
                className="flex-1 h-[30px] border border-slate-300 rounded-[5px] px-[9px] text-xs bg-white text-[#202124] focus:outline-none focus:border-[#1a73e8] focus:shadow-[0_0_0_2px_rgba(26,115,232,0.15)]"
                value={editDraft.description}
                onChange={(e) => setEditDraft((d) => ({ ...d, description: e.target.value }))}
                onKeyDown={(e) => { if (e.key === "Escape") cancelEdit(); }}
                placeholder={_("suspiciousRules.editDescPlaceholder")}
              />
            </div>
            <div className="flex items-center gap-2.5">
              <label className="shrink-0 w-[90px] text-[11px] font-semibold text-slate-500 text-right">{_("suspiciousRules.severity")}</label>
              <select
                className="select-styled"
                value={editDraft.severity}
                onChange={(e) => setEditDraft((d) => ({ ...d, severity: e.target.value as RuleSeverity }))}
              >
                {SEVERITY_OPTIONS.map((s) => <option key={s} value={s}>{_(`severity.${s}` as TranslationKey)}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5 pt-2">
              <label className="text-[11px] font-semibold text-slate-500 mb-0.5">{_("suspiciousRules.conditions")}<span className="font-normal text-slate-400 ml-1">（多个条件为 AND 关系，全部满足才触发）</span></label>
              {editDraft.conditions.map((cond, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <div className="text-[10px] font-bold text-slate-400 tracking-[0.5px] pt-0.5 pl-1">AND</div>}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <select className="select-styled min-w-[120px]" value={cond.target} onChange={(e) => updateCondition(i, "target", e.target.value)}>
                      {RULE_TARGETS.map((t) => <option key={t} value={t}>{_(`target.${t}` as TranslationKey)}</option>)}
                    </select>
                    <select className="select-styled min-w-[120px]" value={cond.operator} onChange={(e) => updateCondition(i, "operator", e.target.value)}>
                      {RULE_OPERATORS.map((op) => <option key={op} value={op}>{_(`op.${op}` as TranslationKey)}</option>)}
                    </select>
                    {cond.operator !== "exists" ? (
                      <input
                        className="flex-[2] min-w-[320px] h-[30px] border border-slate-300 rounded-[5px] px-[9px] text-xs font-mono bg-white text-[#202124] focus:outline-none focus:border-[#1a73e8] focus:shadow-[0_0_0_2px_rgba(26,115,232,0.15)]"
                        value={cond.value}
                        onChange={(e) => updateCondition(i, "value", e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Escape") cancelEdit(); }}
                        placeholder={_("suspiciousRules.valuePlaceholder")}
                      />
                    ) : (
                      <span className="flex-[2] min-w-[320px] h-[30px] leading-[30px] px-[9px] text-xs text-slate-400 italic border border-dashed border-slate-200 rounded-[5px] bg-slate-50">{_("suspiciousRules.existsHint")}</span>
                    )}
                    <button className="inline-flex items-center justify-center w-[26px] h-[26px] border-0 rounded-[5px] bg-transparent text-slate-400 cursor-pointer transition-[background,color] duration-100 hover:bg-red-200 hover:text-red-600" onClick={() => removeCondition(i)} type="button"><X size={12} /></button>
                  </div>
                </React.Fragment>
              ))}
              <button className="inline-flex items-center gap-1 self-start h-[26px] px-2.5 border border-dashed border-slate-300 rounded-[5px] bg-transparent text-slate-500 text-[11px] font-semibold cursor-pointer mt-0.5 hover:border-[#1a73e8] hover:text-[#1a73e8] hover:bg-[#f0f7ff]" onClick={addCondition} type="button">{_("suspiciousRules.addCondition")}</button>
            </div>
          </div>
          <div className="flex gap-1.5 justify-end">
            <button className="h-7 px-3.5 border-0 rounded-[5px] bg-[#1a73e8] text-white text-xs font-semibold cursor-pointer hover:bg-[#1557b0]" onClick={() => commitEdit(rule.id)}>{_("suspiciousRules.save")}</button>
            <button className="h-7 px-3 border border-slate-300 rounded-[5px] bg-white text-slate-500 text-xs cursor-pointer hover:bg-slate-100 hover:text-slate-800" onClick={cancelEdit}>{_("suspiciousRules.cancel")}</button>
          </div>
        </div>
      );
    }

    return (
      <div key={rule.id} className={`flex items-start gap-2.5 px-3.5 py-2.5 border-b border-slate-100 transition-[background] duration-100 last:border-b-0 hover:bg-[#fafbff] ${rule.enabled ? "" : "opacity-45"}`}>
        <input
          type="checkbox"
          className="shrink-0 mt-[3px] w-3.5 h-3.5 accent-[#1a73e8] cursor-pointer"
          checked={rule.enabled}
          onChange={() => toggleRule(rule.id)}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-[7px] flex-wrap">
            <RuleBadge rule={rule} />
            <span className={`w-2 h-2 rounded-full shrink-0 ${SEVERITY_DOT_CLASS[rule.severity || "warn"] || SEVERITY_DOT_CLASS.warn}`} />
            <span className="text-[13px] font-semibold text-slate-800">{rule.label || <em className="text-slate-400 text-xs italic">{_("suspiciousRules.untitled")}</em>}</span>
          </div>
          {rule.description && <p className="mt-[3px] text-[11px] text-slate-500 leading-[1.45]">{rule.description}</p>}
          <ConditionSummary conditions={rule.conditions} />
        </div>
        <div className="flex items-center gap-0.5 shrink-0 mt-[1px]">
          <button className="inline-flex items-center justify-center w-[26px] h-[26px] border-0 rounded-[5px] bg-transparent text-slate-400 cursor-pointer transition-[background,color] duration-100 hover:bg-slate-200 hover:text-slate-800" onClick={() => startEdit(rule)}><Pencil size={13} /></button>
          <button
            className={`inline-flex items-center justify-center w-[26px] h-[26px] border-0 rounded-[5px] bg-transparent text-slate-400 cursor-pointer transition-[background,color] duration-100 hover:bg-red-200 hover:text-red-600 ${confirmDeleteId === rule.id ? "!w-auto !px-2 !bg-red-50 !border !border-red-200 !text-red-600 hover:!bg-red-200" : ""}`}
            onClick={() => deleteRule(rule.id)}
            onBlur={() => { if (confirmDeleteId === rule.id) setConfirmDeleteId(null); }}
            title={confirmDeleteId === rule.id ? _("suspiciousRules.confirmDelete") : undefined}
          >
            {confirmDeleteId === rule.id ? <span className="text-[11px] font-semibold whitespace-nowrap">{_("suspiciousRules.confirmDelete")}</span> : <X size={13} />}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-5 px-6 overflow-auto max-w-[760px] text-[13px]">
      <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
        <div>
          <h2 className="m-0 mb-1.5 text-[15px] font-extrabold text-[#0b57d0]">{_("suspiciousRules.title")}</h2>
          <p className="m-0 mb-5 text-[#5f6368] text-xs leading-normal">{_("suspiciousRules.desc")}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0 pt-0.5">
          <button className="inline-flex items-center gap-[5px] h-8 px-3.5 border border-[#1a73e8] rounded-md bg-[#1a73e8] text-white text-xs font-semibold whitespace-nowrap hover:bg-[#1557b0] hover:border-[#1557b0]" onClick={addRule}><Plus size={14} /> {_("suspiciousRules.addRule")}</button>
          <button
            className={`inline-flex items-center gap-[5px] h-8 px-3 border border-slate-300 rounded-md bg-white text-slate-500 text-xs font-medium whitespace-nowrap hover:border-red-600 hover:text-red-600 hover:bg-red-50 ${confirmReset ? "!border-red-600 !text-red-600 !bg-red-50 animate-pulse-red" : ""}`}
            onClick={handleReset}
          >
            <RotateCcw size={13} />
            {confirmReset ? _("suspiciousRules.confirmReset") : _("suspiciousRules.resetToDefaults")}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <div className="flex items-center gap-2 px-3.5 py-2 bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wide">{_("suspiciousRules.allRules")} <span className="font-normal text-[11px] text-slate-400 normal-case tracking-normal">{activeCount}/{rules.length} {_("suspiciousRules.active")}</span></div>
          {rules.length === 0
            ? <p className="text-slate-400 text-xs italic px-3.5 py-4">{_("suspiciousRules.noRules")}</p>
            : rules.map(renderRuleRow)
          }
        </div>
      </div>
    </div>
  );
}

// ─── Utility functions ────────────────────────────────────────────────────────

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

function sortEvents(items: MonitorEvent[], sort: SortState) {
  if (!sort) return items;
  const sorted = [...items].sort((a, b) => {
    const av = sortValue(a, sort.key);
    const bv = sortValue(b, sort.key);
    if (typeof av === "number" && typeof bv === "number") return av - bv;
    return String(av).localeCompare(String(bv));
  });
  return sort.direction === "desc" ? sorted.reverse() : sorted;
}

const SEVERITY_ORDER: Record<string, number> = { error: 0, warn: 1, log: 2, info: 3 };

function sortValue(event: MonitorEvent, key: SortKey) {
  if (key === "name") return networkName(event.message);
  if (key === "status") return event.status || 0;
  if (key === "type") return event.responseType || event.requestType || "";
  if (key === "method") return event.method || "";
  if (key === "level") return SEVERITY_ORDER[event.severity] ?? 9;
  if (key === "message") return event.message;
  if (key === "count") return parseInt(event.details || "1", 10) || 1;
  if (key === "time") return event.kind === "network" ? (event.durationMs || 0) : new Date(event.timestamp).getTime();
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

createRoot(document.getElementById("root")!).render(<App />);
