import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  Ban,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronDown,
  Clipboard,
  Code2,
  Crosshair,
  Eraser,
  FileInput,
  Filter,
  Globe2,
  Info,
  ListChecks,
  Network,
  Pencil,
  Ruler,
  TerminalSquare,
  Trash2,
  Wand2,
  X
} from "lucide-react";
import "./index.css";
import type { AnnotationStatus, DomAnnotation, MonitorEvent, MonitorEventKind, MonitorSnapshot, RuntimeMessage } from "../shared/types";
import { JsonTree } from "./JsonTree";
import { useColumnResize } from "./useColumnResize";
import { getStatusTone, severityLabels, statusLabels, type Tone } from "../shared/status";
import {
  clearAnnotationsForUrl,
  deleteAnnotation,
  getAnnotations,
  normalizeStatus,
  saveAnnotations,
  subscribeAnnotations,
  updateAnnotationStatus,
  updateAnnotationStatusesForUrl
} from "../shared/storage";
import { exportAnnotationsAsMarkdown, importAnnotationsFromMarkdown } from "../shared/exporters";
import { getExcludedUrlReason, isExcludedUrl } from "../shared/excludedUrls";
import { writeClipboardText } from "../shared/clipboard";

type ActiveTab = {
  id?: number;
  url?: string;
  title?: string;
};

const statusOptions: AnnotationStatus[] = ["pending", "sent", "changed", "needs_work", "passed", "skipped"];
type StatusFilter = "all" | AnnotationStatus;
type PanelMode = "annotations" | "monitor";
type MonitorFilter = "all" | MonitorEventKind | "alerts";
type MonitorView = "console" | "network";
type NetworkSortKey = "name" | "status" | "type" | "time";
type NetworkSortState = { key: NetworkSortKey; direction: "asc" | "desc" } | null;
type ImportSummary = {
  total: number;
  currentPageCount: number;
  urls: Array<{ url: string; count: number }>;
  hasUrlConflict: boolean;
};

const monitorFilterLabels: Record<MonitorFilter, string> = {
  all: "All",
  console: "Console",
  network: "Network",
  error: "Errors",
  alerts: "Warnings"
};

const filterLabels: Record<StatusFilter, string> = {
  all: "全部",
  pending: "待处理",
  sent: "已发送",
  changed: "已修改",
  needs_work: "仍有问题",
  passed: "已通过",
  skipped: "不处理"
};

function App() {
  const [tab, setTab] = useState<ActiveTab | null>(null);
  const [annotations, setAnnotations] = useState<DomAnnotation[]>([]);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [isPicking, setIsPicking] = useState(false);
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [importedCount, setImportedCount] = useState<number | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [selectedPageUrl, setSelectedPageUrl] = useState("");
  const [confirmClearPage, setConfirmClearPage] = useState(false);
  const [pageLoadTick, setPageLoadTick] = useState(0);
  const [panelMode, setPanelMode] = useState<PanelMode>("annotations");
  const [monitorEvents, setMonitorEvents] = useState<MonitorEvent[]>([]);
  const [monitorSelectedIds, setMonitorSelectedIds] = useState<string[]>([]);
  const [monitorFilter, setMonitorFilter] = useState<MonitorFilter>("all");
  const [monitorView, setMonitorView] = useState<MonitorView>("console");
  const [monitorSearch, setMonitorSearch] = useState("");
  const [monitorCopied, setMonitorCopied] = useState(false);
  const [networkSort, setNetworkSort] = useState<NetworkSortState>(null);

  const loadTab = useCallback(async () => {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    setTab(active ? { id: active.id, url: active.url, title: active.title } : null);
  }, []);

  const refresh = useCallback(async () => {
    await loadTab();
    const all = await getAnnotations();
    setAnnotations(all);
  }, [loadTab]);

  useEffect(() => {
    void refresh();
    return subscribeAnnotations(() => void refresh());
  }, [refresh]);

  // Feature C: Track status changes for animations
  const prevStatusMap = useRef<Map<string, string>>(new Map());
  const [changedIds, setChangedIds] = useState<Map<string, "resolved" | "needs_work">>(new Map());
  const [reportOpen, setReportOpen] = useState(false);

  useEffect(() => {
    const nextMap = new Map(annotations.map((a) => [a.id, normalizeStatus(a.status)]));
    const changes = new Map<string, "resolved" | "needs_work">();
    for (const [id, newStatus] of nextMap) {
      const prev = prevStatusMap.current.get(id);
      if (prev && prev !== newStatus) {
        if (newStatus === "passed" || newStatus === "skipped") changes.set(id, "resolved");
        else if (newStatus === "needs_work") changes.set(id, "needs_work");
      }
    }
    prevStatusMap.current = nextMap;
    if (changes.size > 0) {
      setChangedIds((prev) => {
        const merged = new Map(prev);
        for (const [id, type] of changes) merged.set(id, type);
        return merged;
      });
      const timer = window.setTimeout(() => {
        setChangedIds((prev) => {
          const next = new Map(prev);
          for (const id of changes.keys()) next.delete(id);
          return next;
        });
      }, 1600);
      return () => window.clearTimeout(timer);
    }
  }, [annotations]);

  useEffect(() => {
    const handleTabActivated = () => {
      setPageLoadTick((tick) => tick + 1);
      void refresh();
    };
    const handleTabUpdated = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (tab?.id === tabId && (changeInfo.status === "complete" || changeInfo.url || changeInfo.title)) {
        if (changeInfo.status === "complete" || changeInfo.url) {
          setPageLoadTick((tick) => tick + 1);
        }
        void refresh();
      }
    };
    const handleWindowFocus = () => void refresh();

    chrome.tabs.onActivated.addListener(handleTabActivated);
    chrome.tabs.onUpdated.addListener(handleTabUpdated);
    chrome.windows.onFocusChanged.addListener(handleWindowFocus);
    window.addEventListener("focus", handleWindowFocus);

    return () => {
      chrome.tabs.onActivated.removeListener(handleTabActivated);
      chrome.tabs.onUpdated.removeListener(handleTabUpdated);
      chrome.windows.onFocusChanged.removeListener(handleWindowFocus);
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, [refresh, tab?.id]);

  const currentUrl = tab?.url ?? "";
  const currentExcludedReason = getExcludedUrlReason(currentUrl);
  const isCurrentPageExcluded = Boolean(currentExcludedReason);
  useEffect(() => {
    setError("");
    setIsPicking(false);
    setIsMeasuring(false);
  }, [currentUrl]);

  useEffect(() => {
    if (currentUrl && !isCurrentPageExcluded && !selectedPageUrl) setSelectedPageUrl(currentUrl);
  }, [currentUrl, isCurrentPageExcluded, selectedPageUrl]);

  const pageOptions = useMemo(() => {
    const byUrl = new Map<string, { url: string; title: string; count: number }>();
    for (const item of annotations) {
      if (isExcludedUrl(item.url)) continue;
      const existing = byUrl.get(item.url);
      byUrl.set(item.url, {
        url: item.url,
        title: item.title || item.url,
        count: (existing?.count ?? 0) + 1
      });
    }
    if (currentUrl && !isCurrentPageExcluded && !byUrl.has(currentUrl)) {
      byUrl.set(currentUrl, { url: currentUrl, title: tab?.title || "当前页面", count: 0 });
    }
    return Array.from(byUrl.values()).sort((a, b) => {
      if (a.url === currentUrl) return -1;
      if (b.url === currentUrl) return 1;
      return a.title.localeCompare(b.title);
    });
  }, [annotations, currentUrl, isCurrentPageExcluded, tab?.title]);

  useEffect(() => {
    if (selectedPageUrl && (isExcludedUrl(selectedPageUrl) || !pageOptions.some((item) => item.url === selectedPageUrl))) {
      setSelectedPageUrl("");
    }
  }, [pageOptions, selectedPageUrl]);

  const viewedUrl = selectedPageUrl || (!isCurrentPageExcluded ? currentUrl : pageOptions[0]?.url ?? "");
  const isViewingActivePage = Boolean(viewedUrl && viewedUrl === currentUrl);
  const pageAnnotations = useMemo(
    () =>
      annotations
        .filter((item) => item.url === viewedUrl)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [annotations, viewedUrl]
  );

  const filteredAnnotations = useMemo(
    () => pageAnnotations.filter((item) => matchesFilter(normalizeStatus(item.status), statusFilter)),
    [pageAnnotations, statusFilter]
  );
  const filterCounts = useMemo(
    () =>
      (Object.keys(filterLabels) as StatusFilter[]).reduce<Record<StatusFilter, number>>((counts, filter) => {
        counts[filter] = pageAnnotations.filter((item) => matchesFilter(normalizeStatus(item.status), filter)).length;
        return counts;
      }, { all: 0, pending: 0, sent: 0, changed: 0, needs_work: 0, passed: 0, skipped: 0 }),
    [pageAnnotations]
  );
  const selectedCount = selectedIds.length;
  const canInspect = Boolean(tab?.id && tab.url && isInspectableUrl(tab.url) && !isCurrentPageExcluded && isViewingActivePage);

  useEffect(() => {
    if (!tab?.id || !canInspect) return;
    void ensureContentScript(tab.id).then(async () => {
      await enableMonitor();
      setError((current) => (isContentScriptErrorText(current) ? "" : current));
    }).catch(() => {
      // Tool actions surface injection failures. Initial pin rendering can fail silently.
    });
  }, [canInspect, pageLoadTick, tab?.id]);

  useEffect(() => {
    setMonitorEvents([]);
    setMonitorSelectedIds([]);
    if (canInspect) void enableMonitor();
  }, [canInspect, currentUrl]);

  useEffect(() => {
    const listener = (message: RuntimeMessage) => {
      if (message.type !== "DOM_AI_MONITOR_EVENT") return;
      if (!isSamePageOrigin(message.event.pageUrl, currentUrl)) return;
      setMonitorEvents((items) => [message.event, ...items.filter((item) => item.id !== message.event.id)].slice(0, 800));
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [currentUrl]);

  useEffect(() => {
    setConfirmClearPage(false);
  }, [pageAnnotations.length, viewedUrl]);

  useEffect(() => {
    if (!confirmClearPage) return;
    const timer = window.setTimeout(() => setConfirmClearPage(false), 5000);
    return () => window.clearTimeout(timer);
  }, [confirmClearPage]);

  async function startPicking() {
    if (!tab?.id) return;
    setError("");
    try {
      await sendContentMessage(tab.id, { type: "DOM_AI_START_PICKING" });
      setIsPicking(true);
      setIsMeasuring(false);
    } catch (error) {
      setError(getContentScriptErrorMessage(error, "标注"));
    }
  }

  async function stopPicking() {
    if (!tab?.id) return;
    setIsPicking(false);
    try {
      await sendContentMessage(tab.id, { type: "DOM_AI_STOP_PICKING" });
    } catch {
      // The page may have navigated; locally leaving inspect mode is enough.
    }
  }

  async function startMeasuring() {
    if (!tab?.id) return;
    setError("");
    try {
      await sendContentMessage(tab.id, { type: "DOM_AI_START_MEASURING" });
      setIsMeasuring(true);
      setIsPicking(false);
    } catch (error) {
      setError(getContentScriptErrorMessage(error, "测量"));
    }
  }

  async function stopMeasuring() {
    if (!tab?.id) return;
    setIsMeasuring(false);
    try {
      await sendContentMessage(tab.id, { type: "DOM_AI_STOP_MEASURING" });
    } catch {
      // The page may have navigated; locally leaving measure mode is enough.
    }
  }

  async function cancelActiveTool() {
    if (isPicking) await stopPicking();
    if (isMeasuring) await stopMeasuring();
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableEvent(event)) return;

      if (event.key.toLowerCase() === "c" && !event.metaKey && !event.ctrlKey && !event.altKey && canInspect) {
        event.preventDefault();
        event.stopPropagation();
        void startPicking();
        return;
      }

      if (event.key.toLowerCase() === "m" && !event.metaKey && !event.ctrlKey && !event.altKey && canInspect) {
        event.preventDefault();
        event.stopPropagation();
        void (isMeasuring ? stopMeasuring() : startMeasuring());
        return;
      }

      if (event.key !== "Escape" || (!isPicking && !isMeasuring)) return;
      event.preventDefault();
      event.stopPropagation();
      if (isPicking) void stopPicking();
      if (isMeasuring) void stopMeasuring();
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [canInspect, isMeasuring, isPicking, tab?.id]);

  async function focusAnnotation(id: string) {
    if (!isViewingActivePage) {
      setError("当前正在查看其他页面的标注。请先打开原页面再定位。");
      return;
    }
    if (!tab?.id) return;
    await cancelActiveTool();
    setError("");
    try {
      await sendContentMessage(tab.id, { type: "DOM_AI_FOCUS_ANNOTATION", id });
    } catch (error) {
      setError(getContentScriptErrorMessage(error, "定位"));
    }
  }

  async function editAnnotation(id: string) {
    if (!isViewingActivePage) {
      setError("当前正在查看其他页面的标注。请先打开原页面再编辑。");
      return;
    }
    if (!tab?.id) return;
    await cancelActiveTool();
    setError("");
    try {
      await sendContentMessage(tab.id, { type: "DOM_AI_CLOSE_IMAGE_PREVIEW" });
      await sendContentMessage(tab.id, { type: "DOM_AI_EDIT_ANNOTATION", id });
    } catch (error) {
      setError(getContentScriptErrorMessage(error, "编辑"));
    }
  }

  async function copy() {
    setError("");
    try {
      await writeClipboardText(exportAnnotationsAsMarkdown(pageAnnotations));
      if (viewedUrl) {
        await updateAnnotationStatusesForUrl(viewedUrl, ["pending"], "sent");
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1300);
    } catch {
      setError("复制失败。请确认浏览器允许当前页面写入剪贴板，或稍后重试。");
    }
  }

  function pasteAnnotations() {
    setError("");
    setImportedCount(null);
    setImportSummary(null);
    setImportText("");
    setImportError("");
    setImportDialogOpen(true);
  }

  async function importAnnotationsText(text: string) {
    const imported = importAnnotationsFromMarkdown(text);
    if (!imported.length) {
      setImportError("没有找到可导入的 DOM AI 标注数据。请粘贴由本插件导出的完整反馈。");
      return;
    }

    setImportError("");
    await saveAnnotations(imported);
    const urlCounts = imported.reduce<Map<string, number>>((counts, item) => {
      counts.set(item.url, (counts.get(item.url) ?? 0) + 1);
      return counts;
    }, new Map());
    const importedUrls = Array.from(urlCounts.keys()).filter(Boolean);
    const currentPageCount = currentUrl ? (urlCounts.get(currentUrl) ?? 0) : 0;
    const urls = importedUrls.map((url) => ({ url, count: urlCounts.get(url) ?? 0 }));
    setImportSummary({
      total: imported.length,
      currentPageCount,
      urls,
      hasUrlConflict: Boolean(currentUrl && importedUrls.some((url) => url !== currentUrl))
    });
    if (importedUrls.length === 1) setSelectedPageUrl(importedUrls[0]);
    setImportedCount(imported.length);
    setImportDialogOpen(false);
    setImportText("");
    window.setTimeout(() => setImportedCount(null), 1600);
  }

  async function updateSelectedStatuses(ids: string[], status: AnnotationStatus) {
    await Promise.all(ids.map((id) => updateAnnotationStatus(id, status)));
  }

  async function deleteSelected() {
    await Promise.all(selectedIds.map((id) => deleteAnnotation(id)));
    setSelectedIds([]);
  }

  function toggleSelected(id: string) {
    setSelectedIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);
  }

  function toggleSelectionMode() {
    setSelectionMode((enabled) => {
      if (enabled) setSelectedIds([]);
      return !enabled;
    });
  }

  async function clearPage() {
    if (!viewedUrl || pageAnnotations.length === 0) return;
    if (!confirmClearPage) {
      setConfirmClearPage(true);
      return;
    }
    await clearAnnotationsForUrl(viewedUrl);
    setConfirmClearPage(false);
  }

  async function openUrl(url: string) {
    await chrome.tabs.create({ url });
  }

  async function enableMonitor() {
    if (!tab?.id || !canInspect) return;
    setError("");
    try {
      await ensureContentScript(tab.id);
      await ensurePageMonitorBridge(tab.id);
      const snapshot = await sendContentMessage<MonitorSnapshot>(tab.id, { type: "DOM_AI_MONITOR_ENABLE" });
      setMonitorEvents((snapshot?.events ?? []).filter((item) => isSamePageOrigin(item.pageUrl, currentUrl)));
    } catch (error) {
      setError(getContentScriptErrorMessage(error, "监控"));
    }
  }

  async function clearMonitor() {
    if (!tab?.id) return;
    try {
      const snapshot = await sendContentMessage<MonitorSnapshot>(tab.id, { type: "DOM_AI_MONITOR_CLEAR" });
      setMonitorEvents((snapshot?.events ?? []).filter((item) => isSamePageOrigin(item.pageUrl, currentUrl)));
      setMonitorSelectedIds([]);
    } catch {
      setMonitorEvents([]);
      setMonitorSelectedIds([]);
    }
  }

  function toggleMonitorSelected(id: string) {
    setMonitorSelectedIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);
  }

  async function copyMonitorContext() {
    const selected = monitorEvents.filter((item) => monitorSelectedIds.includes(item.id));
    const items = selected.length ? selected : monitorEvents.filter((item) => isMonitorAlert(item)).slice(0, 20);
    if (!items.length) return;
    try {
      await writeClipboardText(exportMonitorEventsAsMarkdown(items));
      setMonitorCopied(true);
      window.setTimeout(() => setMonitorCopied(false), 1300);
    } catch {
      setError("复制失败。请确认浏览器允许当前页面写入剪贴板，或稍后重试。");
    }
  }

  const filteredMonitorEvents = useMemo(
    () => monitorEvents.filter((item) => matchesMonitorFilter(item, monitorFilter)).filter((item) => matchesMonitorSearch(item, monitorSearch)),
    [monitorEvents, monitorFilter, monitorSearch]
  );
  const visibleMonitorEvents = useMemo(
    () => {
      const filtered = filteredMonitorEvents.filter((item) => monitorView === "network" ? item.kind === "network" : item.kind !== "network");
      if (monitorView !== "network" || !networkSort) return filtered;
      return sortNetworkEvents(filtered, networkSort);
    },
    [filteredMonitorEvents, monitorView, networkSort]
  );
  const monitorCounts = useMemo(
    () =>
      (Object.keys(monitorFilterLabels) as MonitorFilter[]).reduce<Record<MonitorFilter, number>>((counts, filter) => {
        counts[filter] = monitorEvents.filter((item) => matchesMonitorFilter(item, filter)).length;
        return counts;
      }, { all: 0, console: 0, network: 0, error: 0, alerts: 0 }),
    [monitorEvents]
  );
  const monitorAlertCount = monitorCounts.alerts;

  return (
    <main className="mx-auto flex h-dvh w-full max-w-[560px] flex-col overflow-hidden bg-[#f6f7f9] text-ink-900 shadow-[0_0_0_1px_rgba(17,24,39,0.06)]">
      <header className="shrink-0 border-b border-black/[0.06] bg-[#f6f7f9] px-4 pb-2 pt-2">
        {pageOptions.length ? (
          <PageDropdown
            options={pageOptions}
            value={viewedUrl}
            currentUrl={currentUrl}
            onChange={(url) => {
              setSelectedPageUrl(url);
              setError("");
            }}
          />
        ) : null}

        <div>
          {!isViewingActivePage && viewedUrl ? (
            <div className="mt-2 rounded-xl bg-note-50 px-3 py-2 text-xs font-semibold leading-5 text-note-700">
              <p>正在查看其他页面的标注。定位和编辑需要打开标注所属页面。</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                <button
                  className="h-8 rounded-lg bg-white px-2.5 text-xs font-bold text-note-700 shadow-[inset_0_0_0_1px_rgba(234,88,12,0.18)] transition-[background-color,transform] duration-150 hover:bg-note-100 active:scale-[0.96]"
                  onClick={() => void openUrl(viewedUrl)}
                >
                  打开标注所属页面
                </button>
                {currentUrl && !isCurrentPageExcluded ? (
                  <button
                    className="h-8 rounded-lg px-2.5 text-xs font-bold text-note-700 transition-[background-color,transform] duration-150 hover:bg-note-100 active:scale-[0.96]"
                    onClick={() => {
                      setSelectedPageUrl(currentUrl);
                      setError("");
                    }}
                  >
                    切回当前标签页
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
          {panelMode === "annotations" ? <div className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(104px,0.4fr)] gap-2">
            <button
              className="inline-flex h-9 min-w-0 items-center justify-center gap-2 rounded-xl bg-[#0b1120] px-3 text-[13px] font-bold text-white shadow-[0_8px_18px_rgba(17,24,39,0.14)] transition-[background-color,transform] duration-150 hover:bg-[#1f2937] active:scale-[0.96] disabled:cursor-not-allowed disabled:bg-ink-200 disabled:text-ink-500 disabled:shadow-none"
              disabled={!canInspect}
              onClick={() => void startPicking()}
            >
              <Crosshair size={16} />
              选择元素
              <ShortcutBadge active>C</ShortcutBadge>
            </button>
            <button
              className={`inline-flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-xl px-2.5 text-[13px] font-bold shadow-[inset_0_0_0_1px_rgba(17,24,39,0.1)] transition-[background-color,transform] duration-150 active:scale-[0.96] disabled:cursor-not-allowed disabled:bg-ink-200 disabled:text-ink-500 ${
                isMeasuring ? "bg-ink-950 text-white" : "bg-white text-ink-800 hover:bg-ink-50"
              }`}
              disabled={!canInspect}
              aria-label={isMeasuring ? "结束测量" : "开始测量"}
              title={isMeasuring ? "结束测量" : "测量"}
              onClick={() => void (isMeasuring ? stopMeasuring() : startMeasuring())}
            >
              <Ruler size={15} />
              <span className="whitespace-nowrap">{isMeasuring ? "结束" : "测量"}</span>
              <ShortcutBadge active={isMeasuring}>M</ShortcutBadge>
            </button>
          </div> : null}
          {panelMode === "annotations" ? <div className="scroll-mask-x scrollbar-none -mx-1 mt-2 flex gap-1 overflow-x-auto overflow-y-visible px-1 py-1">
            {(Object.keys(filterLabels) as StatusFilter[]).map((filter) => (
              <button
                key={filter}
                className={`inline-flex h-8 shrink-0 items-center gap-1 rounded-[10px] px-2 text-xs font-extrabold transition-[background-color,color,box-shadow,transform] duration-150 active:scale-[0.96] ${
                  statusFilter === filter
                    ? "bg-white text-ink-900 shadow-[inset_0_0_0_1px_rgba(17,24,39,0.12),0_1px_2px_rgba(17,24,39,0.08)]"
                    : "text-ink-500 hover:bg-white/70 hover:text-ink-800"
                }`}
                onClick={() => setStatusFilter(filter)}
              >
                {filter !== "all" ? <span className={`h-2 w-2 rounded-full ${getFilterDotClass(filter as AnnotationStatus)}`} /> : null}
                <span>{filterLabels[filter]}</span>
                <span className="text-ink-400 tabular-nums">{filterCounts[filter]}</span>
              </button>
            ))}
          </div> : (
            <div className="-mx-4 mt-2 border-y border-[#d0d7e2] bg-[#eef3fb]">
              <div className="flex h-9 items-center gap-1 overflow-x-auto px-2">
                <button
                  className={`h-8 border-b-2 px-3 text-[13px] font-semibold ${monitorView === "console" ? "border-blue-600 text-blue-700" : "border-transparent text-ink-700 hover:bg-white/60"}`}
                  onClick={() => {
                    setMonitorView("console");
                    setMonitorFilter("all");
                  }}
                >
                  Console
                </button>
                <button
                  className={`h-8 border-b-2 px-3 text-[13px] font-semibold ${monitorView === "network" ? "border-blue-600 text-blue-700" : "border-transparent text-ink-700 hover:bg-white/60"}`}
                  onClick={() => {
                    setMonitorView("network");
                    setMonitorFilter("network");
                  }}
                >
                  Network
                </button>
              </div>
              <div className="flex min-h-10 items-center gap-1 border-t border-[#d7deea] px-2 py-1">
                <button className="grid h-7 w-7 place-items-center rounded text-red-600 hover:bg-white" title="清空" onClick={() => void clearMonitor()}>
                  <Ban size={17} />
                </button>
                <span className="h-6 w-px bg-[#cbd5e1]" />
                <div className="flex h-7 min-w-0 flex-1 items-center gap-1 rounded-full bg-white px-2 shadow-[inset_0_0_0_1px_rgba(148,163,184,0.35)]">
                  <Filter size={14} className="shrink-0 text-ink-500" />
                  <input
                    className="min-w-0 flex-1 bg-transparent text-[13px] font-medium text-ink-900 outline-none placeholder:text-ink-400"
                    value={monitorSearch}
                    onChange={(event) => setMonitorSearch(event.target.value)}
                    placeholder="Filter"
                  />
                </div>
              </div>
              <div className="scroll-mask-x scrollbar-none flex gap-1 overflow-x-auto px-2 py-1">
                {((monitorView === "network" ? ["network", "alerts"] : ["all", "console", "error", "alerts"]) as MonitorFilter[]).map((filter) => (
                <button
                  key={filter}
                  className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-bold transition-[background-color,color,box-shadow] duration-150 ${
                    monitorFilter === filter
                      ? "bg-blue-100 text-blue-800 shadow-[inset_0_0_0_1px_rgba(37,99,235,0.16)]"
                      : "bg-white text-ink-700 shadow-[inset_0_0_0_1px_rgba(148,163,184,0.35)] hover:bg-blue-50"
                  }`}
                  onClick={() => setMonitorFilter(filter)}
                >
                  {filter === "network" ? <Network size={13} /> : filter === "alerts" || filter === "error" ? <AlertTriangle size={13} /> : filter === "console" ? <TerminalSquare size={13} /> : null}
                  <span>{monitorFilterLabels[filter]}</span>
                  <span className="text-ink-400 tabular-nums">{monitorCounts[filter]}</span>
                </button>
              ))}
              </div>
            </div>
          )}

          {currentExcludedReason ? (
            <div className="mt-2 rounded-xl bg-ink-50 px-3 py-2 text-xs font-semibold leading-5 text-ink-500 shadow-[inset_0_0_0_1px_rgba(17,24,39,0.06)]">
              当前页面已排除：{currentExcludedReason}
            </div>
          ) : null}
        </div>
        {error ? <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold leading-5 text-red-700">{error}</p> : null}
        {importSummary?.hasUrlConflict ? (
          <div className="mt-2 rounded-xl bg-brand-50 px-3 py-2 text-xs font-semibold leading-5 text-brand-800">
            <p>已导入 {importSummary.total} 条，其中当前页匹配 {importSummary.currentPageCount} 条。</p>
            <div className="mt-1 space-y-1">
              {importSummary.urls.map((item) => (
                <div key={item.url} className="flex items-center gap-2 rounded-lg bg-white px-2 py-1.5 shadow-[inset_0_0_0_1px_rgba(15,159,120,0.12)]">
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-brand-700">{item.url}</span>
                  <span className="shrink-0 rounded-md bg-brand-50 px-1.5 py-0.5 text-[10px] font-extrabold text-brand-700">{item.count} 条</span>
                  {item.url !== currentUrl ? (
                    <button
                      className="h-7 shrink-0 rounded-md px-2 text-[11px] font-bold text-brand-700 transition-[background-color,transform] duration-150 hover:bg-brand-100 active:scale-[0.96]"
                      onClick={() => void openUrl(item.url)}
                    >
                      打开
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </header>

      {importDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/28 p-4 backdrop-blur-sm">
          <div className="max-h-[calc(100dvh-32px)] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-3 shadow-[0_24px_70px_rgba(17,24,39,0.24)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-extrabold text-ink-950">粘贴导入标注</h2>
                <p className="mt-1 text-xs font-semibold leading-5 text-ink-500">
                  把复制的反馈粘贴到这里即可导入标点，插件不会主动读取剪贴板。
                </p>
              </div>
              <button
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-500 transition-colors duration-150 hover:bg-ink-50 hover:text-ink-900 active:scale-[0.96]"
                aria-label="关闭导入"
                onClick={() => {
                  setImportDialogOpen(false);
                  setImportError("");
                }}
              >
                <X size={16} />
              </button>
            </div>
            <textarea
              className="mt-3 min-h-44 w-full resize-y rounded-xl bg-ink-50 px-3 py-2.5 font-mono text-xs leading-5 text-ink-900 shadow-[inset_0_0_0_1px_rgba(17,24,39,0.08)] outline-none transition-shadow duration-150 placeholder:text-ink-400 focus:shadow-[inset_0_0_0_2px_rgba(15,159,120,0.4)]"
              value={importText}
              onChange={(event) => {
                setImportText(event.target.value);
                if (importError) setImportError("");
              }}
              placeholder="粘贴从“复制反馈”得到的 Markdown..."
              autoFocus
            />
            {importError ? (
              <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold leading-5 text-red-700">
                {importError}
              </p>
            ) : null}
            <div className="mt-3 flex justify-end gap-2">
              <button
                className="h-9 rounded-lg bg-white px-2.5 text-xs font-bold text-ink-700 shadow-[inset_0_0_0_1px_rgba(17,24,39,0.12)] transition-[background-color,transform] duration-150 hover:bg-ink-50 active:scale-[0.96]"
                onClick={() => {
                  setImportDialogOpen(false);
                  setImportError("");
                }}
              >
                取消
              </button>
              <button
                className="h-9 rounded-lg bg-brand-600 px-2.5 text-xs font-bold text-white shadow-[0_6px_14px_rgba(15,159,120,0.2)] transition-[background-color,transform] duration-150 hover:bg-brand-700 active:scale-[0.96]"
                onClick={() => void importAnnotationsText(importText)}
              >
                导入标注
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <section className="min-h-0 flex-1 overflow-y-auto bg-white">
        {panelMode === "monitor" ? (
          <MonitorPanel
            events={filteredMonitorEvents}
            visibleEvents={visibleMonitorEvents}
            selectedIds={monitorSelectedIds}
            onToggleSelected={toggleMonitorSelected}
            onSelectAllVisible={() => setMonitorSelectedIds(visibleMonitorEvents.map((item) => item.id))}
            onClearSelection={() => setMonitorSelectedIds([])}
            canInspect={canInspect}
            view={monitorView}
            counts={monitorCounts}
            networkSort={networkSort}
            onNetworkSort={setNetworkSort}
          />
        ) : pageAnnotations.length ? (
          <>
            <div className="sticky top-0 z-10 border-b border-black/[0.06] bg-[#f6f7f9]/94 px-4 py-2 backdrop-blur">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-extrabold text-ink-500">
                  {filterLabels[statusFilter]} <span className="text-ink-400 tabular-nums">{filteredAnnotations.length}</span>
                </p>
                <button
                  className={`h-8 shrink-0 rounded-lg px-2.5 text-xs font-bold transition-[background-color,color,box-shadow,transform] duration-150 active:scale-[0.96] ${
                    selectionMode ? "bg-ink-950 text-white shadow-[0_6px_14px_rgba(17,24,39,0.16)]" : "bg-white text-ink-700 shadow-[inset_0_0_0_1px_rgba(17,24,39,0.1)] hover:bg-ink-50"
                  }`}
                  onClick={toggleSelectionMode}
                >
                  {selectionMode ? "完成" : "多选"}
                </button>
              </div>
              {selectedCount ? (
                <div className="scroll-mask-x scrollbar-none mt-2 flex items-center gap-1.5 overflow-x-auto rounded-xl bg-white p-1.5 shadow-[0_8px_24px_rgba(17,24,39,0.05),inset_0_0_0_1px_rgba(17,24,39,0.06)]">
                  <span className="shrink-0 px-1.5 text-xs font-extrabold text-ink-800">已选 {selectedCount}</span>
                  <span className="shrink-0 text-[11px] font-bold text-ink-400">批量标为</span>
                  {statusOptions.map((status) => (
                    <button
                      key={status}
                      className={`h-8 shrink-0 rounded-lg px-2.5 text-xs font-bold transition-[background-color,transform] duration-150 active:scale-[0.96] ${getBatchStatusButtonClass(status)}`}
                      title={`将所选标注状态改为${statusLabels[status]}`}
                      onClick={() => void updateSelectedStatuses(selectedIds, status).then(() => setSelectedIds([]))}
                    >
                      {statusLabels[status]}
                    </button>
                  ))}
                  <button className="h-8 shrink-0 rounded-lg bg-red-50 px-2.5 text-xs font-bold text-red-700 transition-[background-color,transform] duration-150 hover:bg-red-100 active:scale-[0.96]" title="删除所选标注" onClick={() => void deleteSelected()}>删除</button>
                  <button className="ml-auto h-8 shrink-0 rounded-lg px-2 text-xs font-bold text-ink-500 hover:bg-ink-100 hover:text-ink-900" onClick={() => setSelectedIds([])}>取消</button>
                </div>
              ) : selectionMode ? (
                <p className="mt-2 text-[11px] font-semibold text-ink-400">勾选卡片后可批量操作</p>
              ) : null}
            </div>
            <div className="dom-ai-masonry bg-white">
            {filteredAnnotations.map((annotation, index) => (
              <AnnotationCard
                key={annotation.id}
                annotation={annotation}
                index={index}
                onFocus={() => void focusAnnotation(annotation.id)}
                onEdit={() => void editAnnotation(annotation.id)}
                onDelete={() => void deleteAnnotation(annotation.id)}
                onPreviewInPage={(dataUrl) => {
                  void cancelActiveTool();
                  if (tab?.id) void sendContentMessage(tab.id, { type: "DOM_AI_SHOW_IMAGE_PREVIEW", dataUrl });
                }}
                selected={selectedIds.includes(annotation.id)}
                onToggleSelected={() => toggleSelected(annotation.id)}
                selectionMode={selectionMode}
                changeType={changedIds.get(annotation.id)}
              />
            ))}
            {filteredAnnotations.length === 0 ? (
              <div className="rounded-2xl bg-white px-4 py-8 text-center shadow-[0_8px_24px_rgba(17,24,39,0.05),inset_0_0_0_1px_rgba(17,24,39,0.06)]">
                <p className="text-sm font-bold text-ink-900">当前筛选暂无反馈</p>
              </div>
            ) : null}
            </div>
          </>
        ) : (
          <div className="flex min-h-full items-center justify-center px-5 py-10">
          {isCurrentPageExcluded && !viewedUrl ? (
            <ExcludedState reason={currentExcludedReason || "当前页面已排除"} />
          ) : (
            <EmptyState onPick={() => void startPicking()} />
          )}
          </div>
        )}
      </section>

      <footer className="z-30 shrink-0 border-t border-black/[0.06] bg-[#f6f7f9]/92 px-3 py-2 backdrop-blur">
        {panelMode === "monitor" ? (
          <div className="flex items-center gap-2">
            <button
              className="inline-flex h-9 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl bg-[#0b1120] px-3 text-sm font-bold text-white shadow-[0_8px_18px_rgba(17,24,39,0.14)] transition-[background-color,transform] duration-150 hover:bg-[#1f2937] active:scale-[0.96] disabled:cursor-not-allowed disabled:bg-ink-200 disabled:text-ink-500 disabled:shadow-none"
              disabled={!monitorEvents.length}
              onClick={() => void copyMonitorContext()}
            >
              {monitorCopied ? <CheckCircle2 size={16} /> : <Clipboard size={16} />}
              <span className="truncate">{monitorCopied ? "已复制" : monitorSelectedIds.length ? `复制 ${monitorSelectedIds.length} 条` : "复制预警"}</span>
            </button>
            <button
              className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-3 text-sm font-bold text-ink-900 shadow-[inset_0_0_0_1px_rgba(17,24,39,0.1)] transition-[background-color,transform] duration-150 hover:bg-ink-50 active:scale-[0.96] disabled:cursor-not-allowed disabled:text-ink-300"
              disabled={!monitorEvents.length}
              onClick={() => void clearMonitor()}
            >
              <Eraser size={16} />
              清空
            </button>
          </div>
        ) : (
        <div className="flex items-center gap-2">
          {confirmClearPage ? (
            <>
              <p className="min-w-0 flex-1 truncate px-1 text-xs font-bold text-red-700">
                清空当前页面 {pageAnnotations.length} 条标注？
              </p>
              <button
                className="h-9 shrink-0 rounded-xl px-2.5 text-xs font-bold text-ink-500 transition-[background-color,color,transform] duration-150 hover:bg-ink-100 hover:text-ink-900 active:scale-[0.96]"
                onClick={() => setConfirmClearPage(false)}
              >
                取消
              </button>
              <button
                className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-red-600 px-2.5 text-xs font-bold text-white shadow-[0_8px_18px_rgba(220,38,38,0.22)] transition-[background-color,transform] duration-150 hover:bg-red-700 active:scale-[0.96]"
                onClick={() => void clearPage()}
              >
                <Trash2 size={15} />
                确认清空
              </button>
            </>
          ) : (
            <>
              <button
                className="inline-flex h-9 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl bg-white px-3 text-sm font-bold text-ink-900 shadow-[inset_0_0_0_1px_rgba(17,24,39,0.1)] transition-[background-color,transform] duration-150 hover:bg-ink-50 active:scale-[0.96] disabled:cursor-not-allowed disabled:text-ink-300"
                disabled={!pageAnnotations.length}
                onClick={() => void copy()}
              >
                {copied ? <CheckCircle2 size={16} /> : <Clipboard size={16} />}
                <span className="truncate">{copied ? "已复制" : "复制 Markdown"}</span>
              </button>
              <button
                className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-3 text-sm font-bold text-ink-900 shadow-[inset_0_0_0_1px_rgba(17,24,39,0.1)] transition-[background-color,transform] duration-150 hover:bg-ink-50 active:scale-[0.96]"
                onClick={pasteAnnotations}
              >
                <FileInput size={16} />
                <span>{importedCount ? `导入 ${importedCount}` : "导入"}</span>
              </button>
              <button
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-ink-700 shadow-[inset_0_0_0_1px_rgba(17,24,39,0.1)] transition-[background-color,color,transform] duration-150 hover:bg-ink-50 hover:text-ink-900 active:scale-[0.96] disabled:cursor-not-allowed disabled:bg-white disabled:text-ink-300 disabled:shadow-[inset_0_0_0_1px_rgba(17,24,39,0.08)]"
                disabled={!pageAnnotations.length}
                aria-label="查看报告"
                title="查看报告"
                onClick={() => setReportOpen(true)}
              >
                <BarChart3 size={17} />
              </button>
              <button
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-red-500 shadow-[inset_0_0_0_1px_rgba(17,24,39,0.1)] transition-[background-color,color,transform] duration-150 hover:bg-red-50 hover:text-red-700 active:scale-[0.96] disabled:cursor-not-allowed disabled:bg-white disabled:text-ink-300 disabled:shadow-[inset_0_0_0_1px_rgba(17,24,39,0.08)]"
                disabled={!pageAnnotations.length}
                aria-label="清空当前页面"
                title="清空当前页面"
                onClick={() => void clearPage()}
              >
                <Trash2 size={17} />
              </button>
            </>
          )}
        </div>
        )}
      </footer>
      {reportOpen && <SessionReport annotations={pageAnnotations} pageUrl={viewedUrl} onClose={() => setReportOpen(false)} />}
    </main>
  );
}

function AnnotationCard({
  annotation,
  index,
  onFocus,
  onEdit,
  onDelete,
  onPreviewInPage,
  selected,
  onToggleSelected,
  selectionMode,
  changeType
}: {
  annotation: DomAnnotation;
  index: number;
  onFocus: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onPreviewInPage: (dataUrl: string) => void;
  selected: boolean;
  onToggleSelected: () => void;
  selectionMode: boolean;
  changeType?: "resolved" | "needs_work";
}) {
  const status = normalizeStatus(annotation.status);
  const [fixCopied, setFixCopied] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const title = getAnnotationTitle(annotation);
  const rectText = `${Math.round(annotation.rect.width)}x${Math.round(annotation.rect.height)}`;

  function handleCardClick(event: React.MouseEvent<HTMLElement>) {
    if (selectionMode) {
      if ((event.target as HTMLElement).closest("[data-card-action]")) return;
      onToggleSelected();
      return;
    }
    if ((event.target as HTMLElement).closest("button, textarea, select, input")) return;
    onFocus();
  }

  return (
    <article
      className={`dom-ai-masonry-item relative overflow-visible border-b border-black/[0.06] px-3 py-3.5 text-ink-950 ${selected ? "bg-brand-50 outline outline-1 outline-brand-500" : ""} ${selectionMode ? "cursor-pointer transition-[background-color,transform] duration-150 hover:bg-brand-50/50 active:scale-[0.99]" : "cursor-pointer transition-colors duration-150 hover:bg-ink-50"} ${changeType === "resolved" ? "status-flash-resolved" : changeType === "needs_work" ? "status-flash-needs-work" : ""}`}
      onClick={handleCardClick}
    >
      <div className="grid grid-cols-[24px_minmax(0,1fr)] gap-1.5 pr-1">
        <div className="pt-0.5">
          {selectionMode ? (
            <button
              data-card-action="true"
              className={`grid h-[24px] w-6 shrink-0 place-items-center rounded-md text-xs font-bold transition-[background-color,box-shadow,transform] duration-150 active:scale-[0.96] ${selected ? "bg-brand-600 text-white shadow-[0_4px_10px_rgba(15,159,120,0.24)]" : "bg-ink-50 text-ink-300 shadow-[inset_0_0_0_1px_rgba(17,24,39,0.1)]"}`}
              onClick={onToggleSelected}
              aria-label={selected ? "取消选择" : "选择标注"}
            >
              {selected ? <Check size={13} strokeWidth={2.7} /> : null}
            </button>
          ) : (
            <span className={`relative grid h-[24px] w-6 shrink-0 place-items-center rounded-md text-[10px] font-extrabold leading-none text-white tabular-nums shadow-[0_4px_10px_rgba(17,24,39,0.1)] ${getStatusDotClass(status)}`}>
              {index + 1}
            </span>
          )}
        </div>
        <div className="min-w-0">
          <h3 className="min-w-0 truncate text-[14px] font-extrabold leading-5 text-ink-950">{title}</h3>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-semibold text-ink-400">
            <span>{formatRelativeTime(annotation.updatedAt)}</span>
            <span className="font-bold text-ink-300">·</span>
            <StatusPill status={status} compact />
            <SeverityPill severity={annotation.feedback.severity} compact />
          </div>
          <p className="mt-1.5 line-clamp-3 whitespace-pre-line text-[14px] font-bold leading-5 text-ink-950">{annotation.feedback.comment}</p>
          <div className="mt-2 flex max-w-full items-center gap-1.5 truncate font-mono text-[11px] font-semibold text-ink-500">
            <Code2 size={13} className="shrink-0 text-ink-400" />
            <span className="truncate">{annotation.selector}</span>
          </div>
          {annotation.screenshot && <ScreenshotPreview annotation={annotation} rectText={rectText} onPreviewInPage={onPreviewInPage} />}
          {!selectionMode && (
            <div className="mt-2 flex items-center gap-1.5">
              <button
                data-card-action="true"
                className={`inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-[11px] font-bold transition-[background-color,color,transform] duration-150 active:scale-[0.96] ${
                  fixCopied
                    ? "bg-brand-50 text-brand-700 shadow-[inset_0_0_0_1px_rgba(15,159,120,0.2)]"
                    : "bg-white text-ink-600 shadow-[inset_0_0_0_1px_rgba(17,24,39,0.1)] hover:bg-brand-50 hover:text-brand-700"
                }`}
                onClick={async (e) => {
                  e.stopPropagation();
                  await writeClipboardText(formatFixPrompt(annotation));
                  setFixCopied(true);
                  window.setTimeout(() => setFixCopied(false), 2000);
                }}
              >
                {fixCopied ? <CheckCircle2 size={12} /> : <Wand2 size={12} />}
                {fixCopied ? "已复制给 AI" : "Fix with AI"}
              </button>
              <button
                data-card-action="true"
                className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-bold text-ink-400 transition-[background-color,color,transform] duration-150 hover:bg-ink-100 hover:text-ink-700 active:scale-[0.96]"
                onClick={(e) => { e.stopPropagation(); onEdit(); }}
                aria-label="编辑"
              >
                <Pencil size={12} />
                编辑
              </button>
              <button
                data-card-action="true"
                className={`inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-bold transition-[background-color,color,transform] duration-150 active:scale-[0.96] ${
                  confirmingDelete
                    ? "bg-red-50 text-red-600 shadow-[inset_0_0_0_1px_rgba(239,68,68,0.2)]"
                    : "text-ink-400 hover:bg-red-50 hover:text-red-600"
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirmingDelete) {
                    onDelete();
                  } else {
                    setConfirmingDelete(true);
                    window.setTimeout(() => setConfirmingDelete(false), 3000);
                  }
                }}
                onBlur={() => setConfirmingDelete(false)}
                aria-label="删除"
              >
                <Trash2 size={12} />
                {confirmingDelete ? "确认删除?" : "删除"}
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function ScreenshotPreview({ annotation, rectText, onPreviewInPage }: { annotation: DomAnnotation; rectText: string; onPreviewInPage: (dataUrl: string) => void }) {
  const screenshot = annotation.screenshot;
  if (!screenshot) return null;

  return (
    <div
      className="mt-2 rounded-xl bg-ink-50 p-2 shadow-[inset_0_0_0_1px_rgba(17,24,39,0.06)] cursor-pointer transition-colors duration-150 hover:bg-ink-100"
      data-card-action="true"
      onClick={(e) => { e.stopPropagation(); onPreviewInPage(screenshot.dataUrl); }}
      title="在页面中预览大图"
    >
      <div className="mb-1.5 flex items-center justify-between">
        <span className="px-1 text-[11px] font-bold text-ink-500">快照</span>
        <span className="text-[11px] tabular-nums text-ink-400">{rectText} ↗</span>
      </div>
      <img
        src={screenshot.dataUrl}
        alt="快照"
        className="max-w-full max-h-48 rounded-lg border border-ink-200 pointer-events-none"
        loading="lazy"
      />
    </div>
  );
}

function MonitorPanel({
  events,
  visibleEvents,
  selectedIds,
  onToggleSelected,
  onSelectAllVisible,
  onClearSelection,
  canInspect,
  view,
  counts,
  networkSort,
  onNetworkSort
}: {
  events: MonitorEvent[];
  visibleEvents: MonitorEvent[];
  selectedIds: string[];
  onToggleSelected: (id: string) => void;
  onSelectAllVisible: () => void;
  onClearSelection: () => void;
  canInspect: boolean;
  view: MonitorView;
  counts: Record<MonitorFilter, number>;
  networkSort: NetworkSortState;
  onNetworkSort: (sort: NetworkSortState) => void;
}) {
  if (!canInspect) {
    return (
      <div className="flex min-h-full items-center justify-center px-5 py-10">
        <div className="w-full text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-ink-100 text-ink-500">
            <TerminalSquare size={22} />
          </div>
          <h2 className="mt-4 text-base font-bold text-ink-900">当前页面不能监控</h2>
          <p className="mx-auto mt-1 max-w-[280px] text-sm leading-5 text-ink-500">
            请切换到普通网页后再捕获 console、error 和 network 事件。
          </p>
        </div>
      </div>
    );
  }

  const selectedEvent = visibleEvents.find((event) => selectedIds.includes(event.id));

  return (
    <div className="flex min-h-full bg-white text-[13px] text-[#202124]">
      {view === "console" ? (
        <aside className="hidden w-[154px] shrink-0 border-r border-[#d0d7e2] bg-[#f8fbff] sm:block">
          <ConsoleSidebar counts={counts} />
        </aside>
      ) : null}
      <div className="min-w-0 flex-1">
        {view === "network" ? (
          <NetworkTable
            events={visibleEvents}
            selectedIds={selectedIds}
            onToggleSelected={onToggleSelected}
            onSelectAll={onSelectAllVisible}
            onClearSelection={onClearSelection}
            sort={networkSort}
            onSort={onNetworkSort}
          />
        ) : (
          <ConsoleLog events={visibleEvents} selectedIds={selectedIds} onToggleSelected={onToggleSelected} />
        )}
        {!visibleEvents.length ? (
          <div className="px-4 py-8 text-center text-sm font-medium text-ink-400">
            {events.length ? "当前筛选没有匹配项" : "等待页面输出 console、error 或 network 事件"}
          </div>
        ) : null}
      </div>
      {view === "network" && selectedEvent ? (
        <NetworkDetails event={selectedEvent} onClose={onClearSelection} />
      ) : null}
      <button
        className="fixed bottom-[58px] right-3 h-7 rounded-md bg-white px-2 text-xs font-bold text-ink-600 shadow-[0_6px_18px_rgba(17,24,39,0.14),inset_0_0_0_1px_rgba(148,163,184,0.35)] hover:bg-ink-50"
        onClick={selectedIds.length ? onClearSelection : onSelectAllVisible}
        disabled={!visibleEvents.length}
      >
        {selectedIds.length ? `取消 ${selectedIds.length}` : "全选可见"}
      </button>
    </div>
  );
}

function ConsoleSidebar({ counts }: { counts: Record<MonitorFilter, number> }) {
  return (
    <div className="py-2">
      <ConsoleSidebarRow icon={<ListChecks size={16} />} label="messages" value={counts.all} />
      <ConsoleSidebarRow icon={<AlertTriangle size={17} />} label="errors" value={counts.error} danger />
      <ConsoleSidebarRow icon={<AlertTriangle size={17} />} label="warnings" value={counts.alerts} warn />
      <ConsoleSidebarRow icon={<Info size={17} />} label="info" value={Math.max(0, counts.console - counts.alerts)} info />
    </div>
  );
}

function ConsoleSidebarRow({ icon, label, value, danger = false, warn = false, info = false }: { icon: React.ReactNode; label: string; value: number; danger?: boolean; warn?: boolean; info?: boolean }) {
  const color = danger ? "text-red-600" : warn ? "text-orange-600" : info ? "text-blue-600" : "text-ink-600";
  return (
    <div className="flex h-8 items-center gap-2 px-3 text-[13px] font-medium text-ink-700">
      <span className={color}>{icon}</span>
      <span className="tabular-nums">{value ? value : "No"}</span>
      <span>{label}</span>
    </div>
  );
}

function ConsoleLog({ events, selectedIds, onToggleSelected }: { events: MonitorEvent[]; selectedIds: string[]; onToggleSelected: (id: string) => void }) {
  return (
    <div>
      {events.map((event) => {
        const selected = selectedIds.includes(event.id);
        const tone = getMonitorTone(event);
        return (
          <button
            key={event.id}
            className={`grid w-full grid-cols-[24px_minmax(0,1fr)] gap-1 border-b border-[#edf0f4] px-3 py-1.5 text-left font-mono text-[13px] leading-5 ${selected ? "bg-blue-50" : tone.consoleClass}`}
            onClick={() => onToggleSelected(event.id)}
          >
            <span className={tone.iconClass}>{getConsoleIcon(event)}</span>
            <span className="min-w-0">
              <span className="break-words">{event.message}</span>
              {event.details || event.stack ? <span className="mt-0.5 block whitespace-pre-wrap break-words text-[#5f6368]">{event.details || event.stack}</span> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function NetworkTable({
  events,
  selectedIds,
  onToggleSelected,
  onSelectAll,
  onClearSelection,
  sort,
  onSort
}: {
  events: MonitorEvent[];
  selectedIds: string[];
  onToggleSelected: (id: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  sort: NetworkSortState;
  onSort: (sort: NetworkSortState) => void;
}) {
  const checkAllRef = useRef<HTMLInputElement>(null);
  const { widths, onResizeStart, isResizing } = useColumnResize([32, 280, 76, 86, 80]);

  const allSelected = events.length > 0 && events.every((e) => selectedIds.includes(e.id));
  const someSelected = !allSelected && events.some((e) => selectedIds.includes(e.id));

  useEffect(() => {
    if (checkAllRef.current) checkAllRef.current.indeterminate = someSelected;
  }, [someSelected]);

  const handleCheckAll = () => {
    if (allSelected || someSelected) onClearSelection();
    else onSelectAll();
  };

  const gridTemplate = widths.map((w) => `${w}px`).join(" ");

  const headerCell = (key: NetworkSortKey, label: string, colIndex: number) => (
    <div
      className="relative select-none border-r border-[#dbe3ef] px-2 py-1.5 cursor-pointer hover:bg-[#edf2fb]"
      onClick={() => onSort(nextNetworkSort(sort, key))}
    >
      <span>{label}</span>
      {sort?.key === key ? <span className="ml-0.5 text-blue-600">{sort.direction === "asc" ? " ▲" : " ▼"}</span> : null}
      <div
        className="absolute right-0 top-0 h-full w-[4px] cursor-col-resize hover:bg-blue-400"
        onMouseDown={(e) => onResizeStart(colIndex, e)}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );

  return (
    <div className="min-w-[600px] overflow-x-auto">
      <div
        className="grid h-8 border-b border-[#cbd5e1] bg-[#f6f8fb] text-left text-[12px] font-semibold text-[#3c4043]"
        style={{ gridTemplateColumns: gridTemplate }}
      >
        <div className="grid place-items-center border-r border-[#dbe3ef]">
          <input
            ref={checkAllRef}
            type="checkbox"
            checked={allSelected}
            onChange={handleCheckAll}
            className="h-3.5 w-3.5 cursor-pointer accent-blue-600"
          />
        </div>
        {headerCell("name", "Name", 1)}
        {headerCell("status", "Status", 2)}
        {headerCell("type", "Type", 3)}
        <div
          className="relative select-none px-2 py-1.5 cursor-pointer hover:bg-[#edf2fb]"
          onClick={() => onSort(nextNetworkSort(sort, "time"))}
        >
          <span>Time</span>
          {sort?.key === "time" ? <span className="ml-0.5 text-blue-600">{sort.direction === "asc" ? " ▲" : " ▼"}</span> : null}
        </div>
      </div>
      {events.map((event) => {
        const selected = selectedIds.includes(event.id);
        return (
          <div
            key={event.id}
            className={`grid h-8 w-full text-left font-mono text-[12px] cursor-pointer ${selected ? "bg-[#dfe7f3]" : "odd:bg-white even:bg-[#f7f9fc] hover:bg-[#edf2fb]"}`}
            style={{ gridTemplateColumns: gridTemplate }}
            onClick={() => { if (!isResizing()) onToggleSelected(event.id); }}
          >
            <div className="grid place-items-center border-r border-[#edf0f4]">
              <input
                type="checkbox"
                checked={selected}
                onChange={() => onToggleSelected(event.id)}
                onClick={(e) => e.stopPropagation()}
                className="h-3.5 w-3.5 cursor-pointer accent-blue-600"
              />
            </div>
            <div className="truncate border-r border-[#edf0f4] px-2 py-1.5">{getNetworkName(event.message)}</div>
            <div className={`border-r border-[#edf0f4] px-2 py-1.5 tabular-nums ${event.ok === false ? "text-red-700" : ""}`}>{event.status ?? "(failed)"}</div>
            <div className="border-r border-[#edf0f4] px-2 py-1.5">{event.requestType ?? "fetch"}</div>
            <div className="px-2 py-1.5 tabular-nums">{event.durationMs ?? 0} ms</div>
          </div>
        );
      })}
    </div>
  );
}

type DetailTab = "headers" | "preview" | "response";

function NetworkDetails({ event, onClose }: { event: MonitorEvent; onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<DetailTab>("preview");
  const tabs: { key: DetailTab; label: string }[] = [
    { key: "headers", label: "Headers" },
    { key: "preview", label: "Preview" },
    { key: "response", label: "Response" }
  ];

  const isJsonResponse = /json/i.test(event.responseType || "");
  const isImageResponse = /^image\//i.test(event.responseType || "");
  const isJsonRequestBody = (() => {
    if (!event.requestBody) return false;
    try { JSON.parse(event.requestBody); return true; } catch { return false; }
  })();

  const parsedResponseJson = useMemo(() => {
    if (!isJsonResponse || !event.responseBody) return null;
    try { return JSON.parse(event.responseBody); } catch { return null; }
  }, [event.responseBody, isJsonResponse]);

  const parsedRequestJson = useMemo(() => {
    if (!isJsonRequestBody || !event.requestBody) return null;
    try { return JSON.parse(event.requestBody); } catch { return null; }
  }, [event.requestBody, isJsonRequestBody]);

  return (
    <aside className="hidden w-[42%] min-w-[300px] shrink-0 border-l border-[#cbd5e1] bg-white lg:flex lg:flex-col">
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-[#dbe3ef] bg-[#f6f8fb] px-2">
        <button className="grid h-7 w-7 place-items-center rounded hover:bg-ink-100" onClick={onClose} aria-label="关闭详情">
          <X size={17} />
        </button>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={`h-9 border-b-2 px-1 pt-2 text-[13px] font-semibold ${activeTab === tab.key ? "border-blue-600 text-blue-700" : "border-transparent text-ink-600 hover:text-ink-800"}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-3 font-mono text-[12px] leading-5 text-[#202124]">
        {activeTab === "headers" ? (
          <div>
            <DetailSection title="General">
              <DetailKV label="URL" value={event.message.replace(/^\S+\s+/, "")} />
              <DetailKV label="Method" value={event.method ?? "GET"} />
              <DetailKV label="Status" value={`${event.status ?? "failed"} ${event.statusText || ""}`} valueClass={event.ok === false ? "text-red-600" : "text-blue-700"} />
              <DetailKV label="Duration" value={`${event.durationMs ?? 0} ms`} />
              <DetailKV label="Type" value={event.responseType || event.requestType || "unknown"} />
            </DetailSection>
            {event.requestHeaders && Object.keys(event.requestHeaders).length ? (
              <DetailSection title="Request Headers">
                {Object.entries(event.requestHeaders).map(([k, v]) => <DetailKV key={k} label={k} value={v} />)}
              </DetailSection>
            ) : null}
            {event.requestBody ? (
              <DetailSection title="Request Body">
                {parsedRequestJson ? <JsonTree data={parsedRequestJson} defaultExpandDepth={2} /> : <pre className="whitespace-pre-wrap break-words">{event.requestBody}</pre>}
              </DetailSection>
            ) : null}
            {event.responseHeaders && Object.keys(event.responseHeaders).length ? (
              <DetailSection title="Response Headers">
                {Object.entries(event.responseHeaders).map(([k, v]) => <DetailKV key={k} label={k} value={v} />)}
              </DetailSection>
            ) : null}
          </div>
        ) : activeTab === "preview" ? (
          <div>
            {isImageResponse && event.responseBody ? (
              <div>
                <p className="mb-2 text-[11px] font-semibold text-ink-500">Image Preview</p>
                <img src={event.responseBody} alt="Response preview" className="max-w-full rounded border border-ink-200" />
              </div>
            ) : parsedResponseJson ? (
              <div>
                <p className="mb-2 text-[11px] font-semibold text-ink-500">JSON Response</p>
                <JsonTree data={parsedResponseJson} defaultExpandDepth={2} />
              </div>
            ) : event.responseBody ? (
              <div>
                <p className="mb-2 text-[11px] font-semibold text-ink-500">Response Preview</p>
                <pre className="whitespace-pre-wrap break-words rounded bg-[#f8fafc] p-2">{event.responseBody}</pre>
              </div>
            ) : (
              <p className="text-center text-sm text-ink-400 py-6">No preview available</p>
            )}
          </div>
        ) : (
          <div>
            <p className="mb-2 text-[11px] font-semibold text-ink-500">Raw Response</p>
            {event.responseBody ? (
              <pre className="whitespace-pre-wrap break-words rounded bg-[#f8fafc] p-2">{event.responseBody}</pre>
            ) : (
              <p className="text-center text-sm text-ink-400 py-6">No response body</p>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-4">
      <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-500">{title}</h3>
      <div className="rounded border border-ink-100 bg-[#fafbfd] p-2">{children}</div>
    </section>
  );
}

function DetailKV({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <p className="py-0.5">
      <span className="font-semibold text-[#9c27b0]">{label}</span>: <span className={valueClass || ""}>{value}</span>
    </p>
  );
}

function getConsoleIcon(event: MonitorEvent) {
  if (event.severity === "error" || event.kind === "error") return <AlertTriangle size={16} fill="currentColor" />;
  if (event.severity === "warn") return <AlertTriangle size={16} fill="currentColor" />;
  return <span className="font-bold">&gt;</span>;
}

function getNetworkName(message: string) {
  const url = message.replace(/^\S+\s+/, "");
  try {
    const parsed = new URL(url);
    return parsed.pathname.split("/").filter(Boolean).pop() || parsed.hostname;
  } catch {
    return url;
  }
}

function nextNetworkSort(current: NetworkSortState, key: NetworkSortKey): NetworkSortState {
  if (!current || current.key !== key) return { key, direction: "asc" };
  if (current.direction === "asc") return { key, direction: "desc" };
  return null;
}

function sortNetworkEvents(events: MonitorEvent[], sort: NetworkSortState): MonitorEvent[] {
  if (!sort) return events;
  const sorted = [...events].sort((a, b) => {
    let cmp = 0;
    switch (sort.key) {
      case "name":
        cmp = getNetworkName(a.message).localeCompare(getNetworkName(b.message));
        break;
      case "status":
        cmp = (a.status ?? 0) - (b.status ?? 0);
        break;
      case "type":
        cmp = (a.requestType ?? "").localeCompare(b.requestType ?? "");
        break;
      case "time":
        cmp = (a.durationMs ?? 0) - (b.durationMs ?? 0);
        break;
    }
    return sort.direction === "desc" ? -cmp : cmp;
  });
  return sorted;
}


function ShortcutBadge({ active, children }: { active?: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex h-5 min-w-5 items-center justify-center rounded-md px-1.5 text-[10px] font-extrabold tabular-nums shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)] ${
        active ? "bg-white/12 text-white/75" : "bg-ink-100 text-ink-500"
      }`}
    >
      {children}
    </span>
  );
}

function PageDropdown({
  options,
  value,
  currentUrl,
  onChange
}: {
  options: Array<{ url: string; title: string; count: number }>;
  value: string;
  currentUrl: string;
  onChange: (url: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const idRef = React.useRef(`page-${Math.random().toString(36).slice(2, 10)}`);
  const anchorName = `--anchor-${idRef.current}`;
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const selected = options.find((item) => item.url === value) ?? options[0];

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (triggerRef.current?.contains(event.target as Node) || menuRef.current?.contains(event.target as Node)) return;
      setIsOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div>
      <button
        ref={triggerRef}
        type="button"
        className="flex h-11 w-full items-center justify-between gap-2 rounded-xl bg-ink-50 px-3 text-left shadow-[inset_0_0_0_1px_rgba(17,24,39,0.08)] transition-[background-color,box-shadow,transform] duration-150 hover:bg-white active:scale-[0.98]"
        style={{ anchorName } as React.CSSProperties}
        onClick={() => setIsOpen((open) => !open)}
      >
        {selected ? <SiteIcon url={selected.url} className="h-6 w-6" /> : null}
        <span className="min-w-0 flex-1 truncate text-xs font-extrabold text-ink-900">
          {selected?.url === currentUrl ? "当前页 · " : ""}{selected?.title ?? "选择页面"} ({selected?.count ?? 0})
        </span>
        <ChevronDown size={16} className={`shrink-0 text-ink-400 transition-transform duration-150 ${isOpen ? "rotate-180" : ""}`} />
      </button>

      <div
        ref={menuRef}
        className={`fixed z-[9999] max-h-80 w-[min(420px,calc(100vw-32px))] overflow-y-auto rounded-xl bg-white p-1.5 shadow-[0_18px_44px_rgba(17,24,39,0.16),0_0_0_1px_rgba(17,24,39,0.08)] transition-[opacity,transform] duration-150 ${
          isOpen ? "scale-100 opacity-100" : "pointer-events-none scale-95 opacity-0"
        }`}
        style={
          {
            positionAnchor: anchorName,
            top: "anchor(bottom)",
            left: "anchor(left)",
            translate: "0 6px",
            positionTryFallbacks: "flip-inline"
          } as React.CSSProperties
        }
      >
        {options.map((item) => {
          const isSelected = item.url === value;
          const isCurrent = item.url === currentUrl;
          return (
            <button
              key={item.url}
              type="button"
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors duration-150 ${
                isSelected ? "bg-brand-50 text-brand-700" : "text-ink-800 hover:bg-ink-50"
              }`}
              onClick={() => {
                onChange(item.url);
                setIsOpen(false);
              }}
            >
              <SiteIcon url={item.url} selected={isSelected} className="h-7 w-7" />
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-xs font-extrabold">{item.title}</span>
                  <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-extrabold ${isSelected ? "bg-white/80 text-brand-700" : "bg-ink-100 text-ink-500"}`}>
                    {item.count}
                  </span>
                  {isCurrent ? <span className="shrink-0 rounded-md bg-ink-950 px-1.5 py-0.5 text-[10px] font-extrabold text-white">当前页</span> : null}
                </span>
                <span className="mt-0.5 block truncate font-mono text-[10px] font-semibold text-ink-400">{item.url}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const faviconCandidatesCache = new Map<string, Promise<string[]>>();

function SiteIcon({ url, selected = false, className = "h-6 w-6" }: { url: string; selected?: boolean; className?: string }) {
  const [candidates, setCandidates] = useState<string[]>(() => getFallbackFaviconCandidates(url));
  const [candidateIndex, setCandidateIndex] = useState(0);
  const faviconUrl = candidates[candidateIndex] ?? "";
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setCandidates(getFallbackFaviconCandidates(url));
    setCandidateIndex(0);
    setFailed(false);

    void getFaviconCandidates(url).then((items) => {
      if (cancelled) return;
      setCandidates(items);
      setCandidateIndex(0);
      setFailed(false);
    });

    return () => {
      cancelled = true;
    };
  }, [url]);

  const useNextCandidate = () => {
    setCandidateIndex((index) => {
      const nextIndex = index + 1;
      if (nextIndex >= candidates.length) {
        setFailed(true);
        return index;
      }
      return nextIndex;
    });
  };

  const shellClass = `${className} grid shrink-0 place-items-center overflow-hidden rounded-lg ${
    selected
      ? "bg-white/90 text-brand-700 shadow-[inset_0_0_0_1px_rgba(15,159,120,0.14)]"
      : "bg-ink-100 text-ink-400 shadow-[inset_0_0_0_1px_rgba(17,24,39,0.08)]"
  }`;

  if (!faviconUrl || failed) {
    return (
      <span className={shellClass} aria-hidden="true">
        <Globe2 size={15} strokeWidth={2.3} />
      </span>
    );
  }

  return (
    <span className={shellClass} aria-hidden="true">
      <img
        src={faviconUrl}
        alt=""
        className="h-full w-full object-cover"
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={useNextCandidate}
      />
    </span>
  );
}

async function getFaviconCandidates(pageUrl: string): Promise<string[]> {
  const origin = getUrlOrigin(pageUrl);
  if (!origin) return [];

  const cached = faviconCandidatesCache.get(origin);
  if (cached) return cached;

  const request = discoverFaviconCandidates(pageUrl);
  faviconCandidatesCache.set(origin, request);
  return request;
}

async function discoverFaviconCandidates(pageUrl: string): Promise<string[]> {
  const fallback = getFallbackFaviconCandidates(pageUrl);

  try {
    const response = await fetch(pageUrl, { credentials: "omit" });
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const discovered = Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]'))
      .map((link) => link.getAttribute("href"))
      .filter((href): href is string => Boolean(href))
      .map((href) => resolveUrl(href, pageUrl))
      .filter((href): href is string => Boolean(href));

    return uniqueStrings([...discovered, ...fallback]);
  } catch {
    return fallback;
  }
}

function getFallbackFaviconCandidates(pageUrl: string): string[] {
  const origin = getUrlOrigin(pageUrl);
  if (!origin) return [];
  return [`${origin}/favicon.ico`, `${origin}/icon.png`, `${origin}/apple-touch-icon.png`];
}

function getUrlOrigin(pageUrl: string): string {
  try {
    const { origin } = new URL(pageUrl);
    return origin;
  } catch {
    return "";
  }
}

function resolveUrl(url: string, baseUrl: string): string {
  try {
    return new URL(url, baseUrl).href;
  } catch {
    return "";
  }
}

function uniqueStrings(items: string[]): string[] {
  return Array.from(new Set(items));
}

function StatusDropdown({ value, onChange, dark = false }: { value: AnnotationStatus; onChange: (status: AnnotationStatus) => void; dark?: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const idRef = React.useRef(`status-${Math.random().toString(36).slice(2, 10)}`);
  const anchorName = `--anchor-${idRef.current}`;
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (
        triggerRef.current?.contains(event.target as Node) ||
        menuRef.current?.contains(event.target as Node)
      ) {
        return;
      }
      setIsOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div>
      <button
        ref={triggerRef}
        type="button"
        className={`inline-flex h-9 w-full items-center justify-between gap-2 rounded-xl px-3 text-sm font-bold shadow-[inset_0_0_0_1px_rgba(17,24,39,0.08)] transition-[background-color,box-shadow,transform] duration-150 active:scale-[0.96] ${
          dark ? "bg-white/8 text-white/82 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] hover:bg-white/12" : "bg-ink-50 text-ink-800 hover:bg-white"
        }`}
        style={{ anchorName } as React.CSSProperties}
        onClick={() => {
          if (!isOpen) triggerRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
          setIsOpen((open) => !open);
        }}
      >
        <span>{statusLabels[value]}</span>
        <ChevronDown size={16} className={`${dark ? "text-white/42" : "text-ink-400"} transition-transform duration-150 ${isOpen ? "rotate-180" : ""}`} />
      </button>

      <div
        ref={menuRef}
        className={`scroll-mask-y fixed z-[9999] max-h-72 min-w-44 overflow-y-auto rounded-xl py-1.5 shadow-[0_18px_44px_rgba(17,24,39,0.16),0_0_0_1px_rgba(17,24,39,0.08)] transition-[opacity,transform] duration-150 ${
          isOpen ? "scale-100 opacity-100" : "pointer-events-none scale-95 opacity-0"
        } ${dark ? "bg-[linear-gradient(135deg,#075f4d,#0b1120)] shadow-[0_18px_44px_rgba(7,95,77,0.26),0_0_0_1px_rgba(215,248,235,0.14)]" : "bg-white"}`}
        style={
          {
            positionAnchor: anchorName,
            top: "anchor(bottom)",
            left: "anchor(left)",
            translate: "0 6px",
            positionTryFallbacks: "flip-inline"
          } as React.CSSProperties
        }
      >
        {statusOptions.map((status) => (
          <button
            key={status}
            type="button"
            className={`flex w-full items-center gap-2 px-3 py-2 text-sm font-semibold transition-colors duration-150 ${
              dark ? "bg-transparent text-white/86 hover:bg-white/8" : "bg-white text-ink-800 hover:bg-ink-50"
            }`}
            onClick={() => {
              onChange(status);
              setIsOpen(false);
            }}
          >
            <span className="grid h-4 w-4 place-items-center text-brand-600">
              {value === status ? <Check size={14} strokeWidth={2.6} /> : null}
            </span>
            <span className="flex-1 text-left">{statusLabels[status]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function matchesFilter(status: AnnotationStatus, filter: StatusFilter) {
  if (filter === "all") return true;
  return status === filter;
}

function matchesMonitorFilter(event: MonitorEvent, filter: MonitorFilter) {
  if (filter === "all") return true;
  if (filter === "alerts") return isMonitorAlert(event);
  return event.kind === filter;
}

function matchesMonitorSearch(event: MonitorEvent, search: string) {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  return [
    event.message,
    event.details,
    event.stack,
    event.source,
    event.method,
    event.status?.toString(),
    event.statusText
  ].filter(Boolean).some((value) => String(value).toLowerCase().includes(query));
}

function isMonitorAlert(event: MonitorEvent) {
  return event.severity === "warn" || event.severity === "error" || event.kind === "error" || event.ok === false;
}

function getMonitorTone(event: MonitorEvent) {
  if (event.severity === "error" || event.kind === "error" || event.ok === false) {
    return {
      rowClass: "bg-red-50/40 hover:bg-red-50",
      badgeClass: "bg-red-50 text-red-700 shadow-[inset_0_0_0_1px_rgba(248,113,113,0.18)]",
      consoleClass: "bg-[#fff0f0] text-[#202124]",
      iconClass: "text-red-600"
    };
  }
  if (event.severity === "warn") {
    return {
      rowClass: "bg-orange-50/35 hover:bg-orange-50",
      badgeClass: "bg-orange-50 text-orange-700 shadow-[inset_0_0_0_1px_rgba(251,146,60,0.2)]",
      consoleClass: "bg-[#fff8df] text-[#202124]",
      iconClass: "text-orange-600"
    };
  }
  if (event.kind === "network") {
    return {
      rowClass: "hover:bg-ink-50",
      badgeClass: "bg-blue-50 text-blue-700 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.14)]",
      consoleClass: "bg-white text-[#202124]",
      iconClass: "text-blue-600"
    };
  }
  return {
    rowClass: "hover:bg-ink-50",
    badgeClass: "bg-ink-100 text-ink-700 shadow-[inset_0_0_0_1px_rgba(101,116,135,0.14)]",
    consoleClass: "bg-white text-[#202124]",
    iconClass: "text-blue-600"
  };
}

function formatMonitorTime(value: string) {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(timestamp);
}

function exportMonitorEventsAsMarkdown(events: MonitorEvent[]) {
  const sorted = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return [
    "# Runtime context for AI",
    "",
    "请结合下面的 console、error 和 network 事件定位页面问题。优先处理 error、warning、失败请求和慢请求。",
    "",
    ...sorted.flatMap((event, index) => [
      `## ${index + 1}. ${event.kind.toUpperCase()} · ${event.severity.toUpperCase()}`,
      "",
      `- Time: ${event.timestamp}`,
      `- Page: ${event.title || "Untitled"}`,
      `- URL: ${event.pageUrl}`,
      event.method ? `- Method: ${event.method}` : undefined,
      event.status !== undefined ? `- Status: ${event.status}${event.statusText ? ` ${event.statusText}` : ""}` : undefined,
      event.durationMs !== undefined ? `- Duration: ${event.durationMs} ms` : undefined,
      event.source ? `- Source: ${event.source}${event.line ? `:${event.line}` : ""}${event.column ? `:${event.column}` : ""}` : undefined,
      "",
      "```text",
      event.message,
      event.details || event.stack ? "\n" + (event.details || event.stack) : "",
      "```",
      ""
    ].filter((line): line is string => line !== undefined))
  ].join("\n");
}

function StatusPill({ status, compact = false }: { status: AnnotationStatus; compact?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-lg font-extrabold leading-none ${compact ? "h-5 px-1.5 text-[11px]" : "h-7 px-2 text-[12px]"} ${getStatusPillClass(status)}`}>
      <i className={`${compact ? "h-1.5 w-1.5" : "h-2 w-2"} rounded-full bg-current`} />
      {statusLabels[status]}
    </span>
  );
}

function SeverityPill({ severity, compact = false }: { severity: DomAnnotation["feedback"]["severity"]; compact?: boolean }) {
  return (
    <span className={`inline-flex items-center rounded-lg font-extrabold leading-none ${compact ? "h-5 px-1.5 text-[11px]" : "h-7 px-2 text-[12px]"} ${getSeverityPillClass(severity)}`}>
      {severityLabels[severity]}
    </span>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: Tone }) {
  const styles = {
    brand: "bg-brand-50 text-brand-700",
    info: "bg-blue-50 text-blue-700",
    note: "bg-note-50 text-note-700",
    neutral: "bg-ink-100 text-ink-700",
    danger: "bg-red-50 text-red-700",
    success: "bg-emerald-50 text-emerald-700"
  };

  return <span className={`inline-flex h-7 items-center rounded-lg px-2 text-[11px] font-bold leading-none ${styles[tone]}`}>{children}</span>;
}

function getAnnotationTitle(annotation: DomAnnotation) {
  return annotation.element.text || annotation.element.ariaLabel || annotation.element.role || annotation.element.tag.toUpperCase();
}

function formatRelativeTime(value: string) {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "";
  const diffSeconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (diffSeconds < 60) return "刚刚";
  const diffMinutes = Math.round(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} 小时前`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 30) return `${diffDays} 天前`;
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(timestamp);
}

function getStatusDotClass(status: AnnotationStatus) {
  const styles: Record<AnnotationStatus, string> = {
    pending: "bg-slate-500",
    sent: "bg-blue-500",
    changed: "bg-orange-500",
    needs_work: "bg-red-500",
    passed: "bg-emerald-500",
    skipped: "bg-slate-600"
  };
  return styles[status];
}

function getFilterDotClass(status: AnnotationStatus) {
  return getStatusDotClass(status);
}

function getStatusPillClass(status: AnnotationStatus) {
  const styles: Record<AnnotationStatus, string> = {
    pending: "bg-slate-100 text-slate-700",
    sent: "bg-sky-50 text-sky-700",
    changed: "bg-orange-50 text-orange-700",
    needs_work: "bg-red-50 text-red-700",
    passed: "bg-emerald-50 text-emerald-700",
    skipped: "bg-slate-100 text-slate-700"
  };
  return styles[status];
}

function getSeverityPillClass(severity: DomAnnotation["feedback"]["severity"]) {
  const styles: Record<DomAnnotation["feedback"]["severity"], string> = {
    blocking: "bg-red-50 text-red-700 shadow-[inset_0_0_0_1px_rgba(248,113,113,0.18)]",
    important: "bg-orange-50 text-orange-700 shadow-[inset_0_0_0_1px_rgba(251,146,60,0.2)]",
    suggestion: "bg-ink-50 text-ink-600 shadow-[inset_0_0_0_1px_rgba(101,116,135,0.14)]"
  };
  return styles[severity];
}

function getBatchStatusButtonClass(status: AnnotationStatus) {
  const tone = getStatusTone(status);
  const styles: Record<Tone, string> = {
    brand: "bg-brand-50 text-brand-700 hover:bg-brand-100",
    info: "bg-blue-50 text-blue-700 hover:bg-blue-100",
    note: "bg-note-50 text-note-700 hover:bg-note-100",
    neutral: "bg-ink-100 text-ink-700 hover:bg-ink-200",
    danger: "bg-red-50 text-red-700 hover:bg-red-100",
    success: "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
  };
  return styles[tone];
}

function EmptyState({ onPick }: { onPick: () => void }) {
  return (
    <div className="w-full text-center">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-ink-950 text-white">
        <ListChecks size={22} />
      </div>
      <h2 className="mt-4 text-base font-bold text-ink-900">当前页面暂无反馈</h2>
      <p className="mx-auto mt-1 max-w-[260px] text-sm leading-5 text-ink-500">
        选择一个页面元素，写下问题或建议，然后导出给 AI 使用的修改说明。
      </p>
      <button
        className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#0b1120] px-3.5 text-[13px] font-bold text-white shadow-[0_8px_18px_rgba(17,24,39,0.16)] transition-[background-color,transform] duration-150 hover:bg-[#1f2937] active:scale-[0.96]"
        onClick={onPick}
      >
        <Crosshair size={16} />
        选择元素
      </button>
    </div>
  );
}

function ExcludedState({ reason }: { reason: string }) {
  return (
    <div className="w-full text-center">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-ink-100 text-ink-500">
        <X size={22} />
      </div>
      <h2 className="mt-4 text-base font-bold text-ink-900">当前页面不展示标注器</h2>
      <p className="mx-auto mt-1 max-w-[280px] text-sm leading-5 text-ink-500">
        {reason}。切换到普通网页后可以继续选择元素、测量距离和管理反馈。
      </p>
    </div>
  );
}

const CONTENT_SCRIPT_RETRY_DELAYS = [20, 60, 120, 240, 360];

async function sendContentMessage<T = void>(tabId: number, message: unknown): Promise<T> {
  await ensureContentScript(tabId);
  return sendTabMessageWithRetry<T>(tabId, message);
}

async function ensureContentScript(tabId: number) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "DOM_AI_REFRESH_PINS" });
    return;
  } catch {
    // The content script is not mounted yet.
  }

  await injectContentScript(tabId);
  await sendTabMessageWithRetry(tabId, { type: "DOM_AI_REFRESH_PINS" });
}

async function injectContentScript(tabId: number) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => import(chrome.runtime.getURL("content.js"))
  });
}

async function ensurePageMonitorBridge(tabId: number) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["monitorBridge.js"],
    world: "MAIN"
  });
}

async function sendTabMessageWithRetry<T = void>(tabId: number, message: unknown): Promise<T> {
  let lastError: unknown;
  for (const delayMs of CONTENT_SCRIPT_RETRY_DELAYS) {
    await delay(delayMs);
    try {
      return await chrome.tabs.sendMessage(tabId, message) as T;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isEditableEvent(event: KeyboardEvent): boolean {
  const path = event.composedPath();
  return path.some((node) => {
    if (!(node instanceof HTMLElement)) return false;
    const tagName = node.tagName.toLowerCase();
    return node.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select";
  });
}

function getContentScriptErrorMessage(error: unknown, actionLabel: string) {
  const message = error instanceof Error ? error.message : "";
  if (/^(chrome|chrome-extension|chrome-search|chrome-untrusted|edge|about|devtools|view-source|file:\/\/\/$)/i.test(message)) {
    return `当前页面不支持${actionLabel}。请避开 chrome://、扩展页面、浏览器内置页面或特殊文档。`;
  }
  return `当前页面暂时不能${actionLabel}。请确认页面已加载完成，或刷新后再试。`;
}

function isContentScriptErrorText(value: string): boolean {
  return value.startsWith("当前页面不支持") || value.startsWith("当前页面暂时不能");
}

function isInspectableUrl(url: string) {
  return /^(https?|file):/i.test(url) && !isExcludedUrl(url);
}

function isSamePageOrigin(urlA: string, urlB: string): boolean {
  try {
    const a = new URL(urlA);
    const b = new URL(urlB);
    return a.origin === b.origin && a.pathname === b.pathname;
  } catch {
    return urlA === urlB;
  }
}

// --- Feature D: Fix with AI prompt formatting ---

function formatFixPrompt(annotation: DomAnnotation): string {
  const status = normalizeStatus(annotation.status);
  const el = annotation.element;
  const elDesc = `${el.tag}${el.id ? `#${el.id}` : ""}${el.className ? `.${el.className.trim().split(/\s+/).slice(0, 4).join(".")}` : ""}${el.ariaLabel ? ` [aria-label="${el.ariaLabel}"]` : ""}`;
  const styles = annotation.computedStyles;
  const keyStyles = [
    styles.display && `display: ${styles.display}`,
    styles.position && `position: ${styles.position}`,
    styles.fontSize && `font-size: ${styles.fontSize}`,
    styles.color && `color: ${styles.color}`,
    styles.backgroundColor && `background: ${styles.backgroundColor}`,
  ].filter(Boolean).join("; ") || "none";

  return [
    "# AI Fix Request",
    "",
    "Please fix the following UI issue. Use the selector and element info to locate the component in the codebase.",
    "",
    `## Issue: ${annotation.feedback.comment.split("\n")[0]}`,
    "",
    `- **Selector:** \`${annotation.selector}\``,
    annotation.xpath ? `- **XPath:** \`${annotation.xpath}\`` : undefined,
    `- **Element:** \`${elDesc}\``,
    `- **URL:** ${annotation.url}`,
    `- **Position:** x=${Math.round(annotation.rect.x)}, y=${Math.round(annotation.rect.y)}, ${Math.round(annotation.rect.width)}×${Math.round(annotation.rect.height)}`,
    `- **Viewport:** ${annotation.viewport.width}×${annotation.viewport.height} @ ${annotation.viewport.devicePixelRatio}x`,
    `- **Severity:** ${severityLabels[annotation.feedback.severity]}`,
    `- **Status:** ${statusLabels[status]}`,
    `- **Key Styles:** ${keyStyles}`,
    "",
    "### Full Comment",
    "",
    annotation.feedback.comment,
    annotation.feedback.expected ? `\n### Expected\n\n${annotation.feedback.expected}` : undefined,
    "",
    "---",
    "After fixing, mark resolved via:",
    `\`window.__domAiAPI.resolveAnnotation("${annotation.id}")\``,
  ].filter((l): l is string => l !== undefined).join("\n");
}

// --- Feature E: Session Report ---

type ReportStats = {
  total: number;
  passed: number;
  resolutionRate: number;
  byStatus: Array<{ status: AnnotationStatus; count: number }>;
  bySeverity: Array<{ severity: DomAnnotation["feedback"]["severity"]; count: number }>;
  byType: Array<{ type: string; count: number }>;
  avgFixTimeMinutes: number | null;
};

function computeReportStats(annotations: DomAnnotation[]): ReportStats {
  const total = annotations.length;
  const statusCounts = new Map<AnnotationStatus, number>();
  const severityCounts = new Map<string, number>();
  const typeCounts = new Map<string, number>();
  let fixTotalMs = 0;
  let fixCount = 0;

  for (const a of annotations) {
    const s = normalizeStatus(a.status);
    statusCounts.set(s, (statusCounts.get(s) ?? 0) + 1);
    severityCounts.set(a.feedback.severity, (severityCounts.get(a.feedback.severity) ?? 0) + 1);
    typeCounts.set(a.feedback.type, (typeCounts.get(a.feedback.type) ?? 0) + 1);
    if (s === "passed" || s === "skipped") {
      const created = new Date(a.createdAt).getTime();
      const updated = new Date(a.updatedAt).getTime();
      if (updated > created) { fixTotalMs += updated - created; fixCount++; }
    }
  }

  const passed = statusCounts.get("passed") ?? 0;
  const allStatuses: AnnotationStatus[] = ["pending", "sent", "changed", "needs_work", "passed", "skipped"];
  const allSeverities: Array<DomAnnotation["feedback"]["severity"]> = ["blocking", "important", "suggestion"];

  return {
    total,
    passed,
    resolutionRate: total > 0 ? Math.round((passed / total) * 100) : 0,
    byStatus: allStatuses.map((s) => ({ status: s, count: statusCounts.get(s) ?? 0 })).filter((r) => r.count > 0),
    bySeverity: allSeverities.map((s) => ({ severity: s, count: severityCounts.get(s) ?? 0 })).filter((r) => r.count > 0),
    byType: Array.from(typeCounts.entries()).map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
    avgFixTimeMinutes: fixCount > 0 ? Math.round(fixTotalMs / fixCount / 60000) : null,
  };
}

function formatReportMarkdown(stats: ReportStats, pageUrl: string): string {
  return [
    "# 审查报告",
    "",
    `- 页面: ${pageUrl}`,
    `- 总计: ${stats.total}`,
    `- 已解决: ${stats.passed}`,
    `- 解决率: ${stats.resolutionRate}%`,
    stats.avgFixTimeMinutes !== null ? `- 平均修复时间: ${stats.avgFixTimeMinutes} 分钟` : undefined,
    "",
    "## 按状态",
    ...stats.byStatus.map((r) => `- ${statusLabels[r.status]}: ${r.count}`),
    "",
    "## 按优先级",
    ...stats.bySeverity.map((r) => `- ${severityLabels[r.severity]}: ${r.count}`),
    "",
    "## 按类型",
    ...stats.byType.map((r) => `- ${r.type}: ${r.count}`),
  ].filter((l): l is string => l !== undefined).join("\n");
}

function SessionReport({ annotations, pageUrl, onClose }: { annotations: DomAnnotation[]; pageUrl: string; onClose: () => void }) {
  const stats = useMemo(() => computeReportStats(annotations), [annotations]);
  const [reportCopied, setReportCopied] = useState(false);

  async function copyReport() {
    await writeClipboardText(formatReportMarkdown(stats, pageUrl));
    setReportCopied(true);
    window.setTimeout(() => setReportCopied(false), 1200);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/28 p-4 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="max-h-[calc(100dvh-32px)] w-full max-w-sm overflow-y-auto rounded-2xl bg-white p-4 shadow-[0_24px_70px_rgba(17,24,39,0.24)]">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-extrabold text-ink-950">审查报告</h2>
          <button className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-500 transition-colors duration-150 hover:bg-ink-50 hover:text-ink-900" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-ink-50 px-3 py-2.5 text-center">
            <div className="text-[10px] font-bold uppercase text-ink-400">总计</div>
            <div className="mt-0.5 text-lg font-extrabold tabular-nums text-ink-900">{stats.total}</div>
          </div>
          <div className="rounded-xl bg-ink-50 px-3 py-2.5 text-center">
            <div className="text-[10px] font-bold uppercase text-ink-400">已解决</div>
            <div className="mt-0.5 text-lg font-extrabold tabular-nums text-emerald-700">{stats.passed}</div>
          </div>
          <div className="rounded-xl bg-ink-50 px-3 py-2.5 text-center">
            <div className="text-[10px] font-bold uppercase text-ink-400">解决率</div>
            <div className="mt-0.5 text-lg font-extrabold tabular-nums text-ink-900">{stats.resolutionRate}%</div>
          </div>
        </div>

        <h3 className="mt-4 text-xs font-bold text-ink-500">按状态</h3>
        <div className="mt-1.5 space-y-1">
          {stats.byStatus.map((row) => (
            <div key={row.status} className="flex items-center justify-between rounded-lg bg-ink-50 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${getStatusDotClass(row.status)}`} />
                <span className="text-xs font-bold text-ink-800">{statusLabels[row.status]}</span>
              </div>
              <span className="text-xs font-extrabold tabular-nums text-ink-900">{row.count}</span>
            </div>
          ))}
        </div>

        <h3 className="mt-4 text-xs font-bold text-ink-500">按优先级</h3>
        <div className="mt-1.5 space-y-1">
          {stats.bySeverity.map((row) => (
            <div key={row.severity} className="flex items-center justify-between rounded-lg bg-ink-50 px-3 py-2">
              <span className="text-xs font-bold text-ink-800">{severityLabels[row.severity]}</span>
              <span className="text-xs font-extrabold tabular-nums text-ink-900">{row.count}</span>
            </div>
          ))}
        </div>

        {stats.byType.length > 0 && (
          <>
            <h3 className="mt-4 text-xs font-bold text-ink-500">按类型</h3>
            <div className="mt-1.5 space-y-1">
              {stats.byType.map((row) => (
                <div key={row.type} className="flex items-center justify-between rounded-lg bg-ink-50 px-3 py-2">
                  <span className="text-xs font-bold text-ink-800">{row.type}</span>
                  <span className="text-xs font-extrabold tabular-nums text-ink-900">{row.count}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {stats.avgFixTimeMinutes !== null && (
          <>
            <h3 className="mt-4 text-xs font-bold text-ink-500">修复时间</h3>
            <div className="mt-1.5 rounded-lg bg-ink-50 px-3 py-2">
              <span className="text-xs font-bold text-ink-800">
                平均 {stats.avgFixTimeMinutes < 60 ? `${stats.avgFixTimeMinutes} 分钟` : `${(stats.avgFixTimeMinutes / 60).toFixed(1)} 小时`}
              </span>
            </div>
          </>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button className="h-9 rounded-lg bg-white px-2.5 text-xs font-bold text-ink-700 shadow-[inset_0_0_0_1px_rgba(17,24,39,0.12)] transition-[background-color,transform] duration-150 hover:bg-ink-50 active:scale-[0.96]" onClick={onClose}>
            关闭
          </button>
          <button className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-2.5 text-xs font-bold text-white shadow-[0_6px_14px_rgba(15,159,120,0.2)] transition-[background-color,transform] duration-150 hover:bg-brand-700 active:scale-[0.96]" onClick={() => void copyReport()}>
            {reportCopied ? <CheckCircle2 size={14} /> : <Clipboard size={14} />}
            {reportCopied ? "已复制" : "复制报告"}
          </button>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
