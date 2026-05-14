import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  Clipboard,
  Code2,
  Crosshair,
  FileInput,
  ListChecks,
  MoreHorizontal,
  RefreshCw,
  Ruler,
  Trash2,
  X
} from "lucide-react";
import "./index.css";
import type { AnnotationStatus, DomAnnotation } from "../shared/types";
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

type ActiveTab = {
  id?: number;
  url?: string;
  title?: string;
};

const statusOptions: AnnotationStatus[] = ["pending", "sent", "changed", "needs_work", "passed", "skipped"];
type StatusFilter = "all" | AnnotationStatus;
type ImportSummary = {
  total: number;
  currentPageCount: number;
  urls: Array<{ url: string; count: number }>;
  hasUrlConflict: boolean;
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

  useEffect(() => {
    const handleTabActivated = () => void refresh();
    const handleTabUpdated = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (tab?.id === tabId && (changeInfo.status === "complete" || changeInfo.url || changeInfo.title)) {
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

  const totalCount = pageAnnotations.length;
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
    } catch {
      setError("当前页面暂时不能标注。请刷新页面后再试，或避开 chrome:// 这类浏览器系统页面。");
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
    } catch {
      setError("当前页面暂时不能测量。请刷新页面后再试，或避开 chrome:// 这类浏览器系统页面。");
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || (!isPicking && !isMeasuring)) return;
      event.preventDefault();
      event.stopPropagation();
      if (isPicking) void stopPicking();
      if (isMeasuring) void stopMeasuring();
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [isMeasuring, isPicking, tab?.id]);

  async function focusAnnotation(id: string) {
    if (!isViewingActivePage) {
      setError("当前正在查看其他页面的标注。请先打开原页面再定位。");
      return;
    }
    if (!tab?.id) return;
    setError("");
    try {
      await sendContentMessage(tab.id, { type: "DOM_AI_FOCUS_ANNOTATION", id });
    } catch {
      setError("无法定位到页面标注。请确认当前标签页已加载完成。");
    }
  }

  async function editAnnotation(id: string) {
    if (!isViewingActivePage) {
      setError("当前正在查看其他页面的标注。请先打开原页面再编辑。");
      return;
    }
    if (!tab?.id) return;
    setError("");
    try {
      await sendContentMessage(tab.id, { type: "DOM_AI_EDIT_ANNOTATION", id });
    } catch {
      setError("无法打开页面编辑框。请确认当前标签页已加载完成。");
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(exportAnnotationsAsMarkdown(pageAnnotations));
    if (viewedUrl) {
      await updateAnnotationStatusesForUrl(viewedUrl, ["pending"], "sent");
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1300);
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

  return (
    <main className="mx-auto flex h-dvh w-full max-w-[560px] flex-col overflow-hidden bg-[#f6f7f9] text-ink-900 shadow-[0_0_0_1px_rgba(17,24,39,0.06)]">
      <header className="shrink-0 border-b border-black/[0.06] bg-[#f6f7f9] px-4 pb-2 pt-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ink-950 text-white shadow-[0_8px_18px_rgba(17,24,39,0.16)]">
              <Crosshair size={17} />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-[16px] font-extrabold leading-tight tracking-normal text-ink-950">DOM AI 标注器</h1>
              <p className="mt-0.5 truncate text-[11px] font-semibold text-ink-400">{totalCount} 条反馈 · {isViewingActivePage ? "当前页面" : "其他页面"}</p>
            </div>
          </div>
          <button
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-ink-500 shadow-[0_1px_2px_rgba(17,24,39,0.08),inset_0_0_0_1px_rgba(17,24,39,0.08)] transition-[background-color,color,transform] duration-150 hover:text-ink-900 active:scale-[0.96]"
            aria-label="刷新标注"
            onClick={() => void refresh()}
          >
            <RefreshCw size={17} />
          </button>
        </div>

        <div className="mt-2">
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
          <div className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(116px,0.42fr)] gap-2">
            <button
              className="inline-flex h-10 min-w-0 items-center justify-center gap-2 rounded-xl bg-[#0b1120] px-3 text-sm font-bold text-white shadow-[0_10px_22px_rgba(17,24,39,0.16)] transition-[background-color,transform] duration-150 hover:bg-[#1f2937] active:scale-[0.96] disabled:cursor-not-allowed disabled:bg-ink-200 disabled:text-ink-500 disabled:shadow-none"
              disabled={!canInspect}
              onClick={() => void startPicking()}
            >
              <Crosshair size={17} />
              选择元素
              <ShortcutBadge active>C</ShortcutBadge>
            </button>
            <button
              className={`inline-flex h-10 min-w-0 items-center justify-center gap-2 rounded-xl px-3 text-sm font-bold shadow-[inset_0_0_0_1px_rgba(17,24,39,0.1)] transition-[background-color,transform] duration-150 active:scale-[0.96] disabled:cursor-not-allowed disabled:bg-ink-200 disabled:text-ink-500 ${
                isMeasuring ? "bg-ink-950 text-white" : "bg-white text-ink-800 hover:bg-ink-50"
              }`}
              disabled={!canInspect}
              onClick={() => void (isMeasuring ? stopMeasuring() : startMeasuring())}
            >
              <Ruler size={16} />
              {isMeasuring ? "结束测量" : "测量"}
              <ShortcutBadge active={isMeasuring}>M</ShortcutBadge>
            </button>
          </div>
          <div className="scroll-mask-x scrollbar-none mt-2 flex gap-1 overflow-x-auto rounded-xl border-t border-black/[0.06] pt-2">
            {(Object.keys(filterLabels) as StatusFilter[]).map((filter) => (
              <button
                key={filter}
                className={`inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-2 text-xs font-extrabold transition-[background-color,color,box-shadow,transform] duration-150 active:scale-[0.96] ${
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
          </div>

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
        <div className="fixed inset-0 z-50 bg-ink-950/28 p-4 backdrop-blur-sm">
          <div className="mx-auto mt-10 max-w-xl rounded-2xl bg-white p-3 shadow-[0_24px_70px_rgba(17,24,39,0.24)]">
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
                className="h-10 rounded-xl bg-white px-3 text-sm font-bold text-ink-700 shadow-[inset_0_0_0_1px_rgba(17,24,39,0.12)] transition-[background-color,transform] duration-150 hover:bg-ink-50 active:scale-[0.96]"
                onClick={() => {
                  setImportDialogOpen(false);
                  setImportError("");
                }}
              >
                取消
              </button>
              <button
                className="h-10 rounded-xl bg-brand-600 px-3 text-sm font-bold text-white shadow-[0_8px_18px_rgba(15,159,120,0.22)] transition-[background-color,transform] duration-150 hover:bg-brand-700 active:scale-[0.96]"
                onClick={() => void importAnnotationsText(importText)}
              >
                导入标注
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <section className="min-h-0 flex-1 overflow-y-auto bg-white">
        {pageAnnotations.length ? (
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
            <div className="dom-ai-masonry border-y border-black/[0.06] bg-white">
            {filteredAnnotations.map((annotation, index) => (
              <AnnotationCard
                key={annotation.id}
                annotation={annotation}
                index={index}
                onFocus={() => void focusAnnotation(annotation.id)}
                onEdit={() => void editAnnotation(annotation.id)}
                onDelete={() => void deleteAnnotation(annotation.id)}
                selected={selectedIds.includes(annotation.id)}
                onToggleSelected={() => toggleSelected(annotation.id)}
                selectionMode={selectionMode}
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
          <div className="px-4 py-4">
          {isCurrentPageExcluded && !viewedUrl ? (
            <ExcludedState reason={currentExcludedReason || "当前页面已排除"} />
          ) : (
            <EmptyState onPick={() => void startPicking()} />
          )}
          </div>
        )}
      </section>

      <footer className="z-30 shrink-0 border-t border-black/[0.06] bg-[#f6f7f9]/92 px-3 py-2 backdrop-blur">
        <div className="flex items-center gap-2">
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
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl transition-[background-color,color,transform] duration-150 active:scale-[0.96] disabled:cursor-not-allowed disabled:text-white/25 ${
              confirmClearPage ? "bg-red-50 text-red-700 hover:bg-red-100" : "bg-white text-red-500 shadow-[inset_0_0_0_1px_rgba(17,24,39,0.1)] hover:bg-red-50 hover:text-red-700"
            }`}
            disabled={!pageAnnotations.length}
            aria-label={confirmClearPage ? `确认清空 ${pageAnnotations.length} 条` : "清空当前页面"}
            title={confirmClearPage ? `确认清空 ${pageAnnotations.length} 条` : "清空当前页面"}
            onClick={() => void clearPage()}
          >
            <Trash2 size={17} />
          </button>
          {confirmClearPage ? (
            <button
              className="h-9 shrink-0 rounded-xl px-2.5 text-xs font-bold text-ink-500 transition-[background-color,color,transform] duration-150 hover:bg-ink-100 hover:text-ink-900 active:scale-[0.96]"
              onClick={() => setConfirmClearPage(false)}
            >
              取消
            </button>
          ) : null}
        </div>
      </footer>
    </main>
  );
}

function AnnotationCard({
  annotation,
  index,
  onFocus,
  onEdit,
  onDelete,
  selected,
  onToggleSelected,
  selectionMode
}: {
  annotation: DomAnnotation;
  index: number;
  onFocus: () => void;
  onEdit: () => void;
  onDelete: () => void;
  selected: boolean;
  onToggleSelected: () => void;
  selectionMode: boolean;
}) {
  const status = normalizeStatus(annotation.status);
  const [menuOpen, setMenuOpen] = useState(false);
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
      className={`dom-ai-masonry-item relative overflow-visible border-b border-black/[0.06] px-3 py-3.5 text-ink-950 ${selected ? "bg-brand-50 outline outline-1 outline-brand-500" : ""} ${selectionMode ? "cursor-pointer transition-[background-color,transform] duration-150 hover:bg-brand-50/50 active:scale-[0.99]" : "cursor-pointer transition-colors duration-150 hover:bg-ink-50"}`}
      onClick={handleCardClick}
    >
      <div className="grid grid-cols-[36px_minmax(0,1fr)] gap-2 pr-8">
        <div className="pt-0.5">
          {selectionMode ? (
            <button
              data-card-action="true"
              className={`grid h-[32px] w-9 shrink-0 place-items-center rounded-[11px_11px_11px_4px] text-xs font-bold transition-[background-color,box-shadow,transform] duration-150 active:scale-[0.96] ${selected ? "bg-brand-600 text-white shadow-[0_8px_18px_rgba(15,159,120,0.24)]" : "bg-ink-50 text-ink-300 shadow-[inset_0_0_0_1px_rgba(17,24,39,0.1)]"}`}
              onClick={onToggleSelected}
              aria-label={selected ? "取消选择" : "选择标注"}
            >
              {selected ? <Check size={15} strokeWidth={2.7} /> : null}
            </button>
          ) : (
            <span className={`relative grid h-[32px] w-9 shrink-0 place-items-center rounded-[11px_11px_11px_4px] text-xs font-extrabold leading-none text-white tabular-nums shadow-[0_8px_18px_rgba(17,24,39,0.1),0_0_0_2px_rgba(255,255,255,0.96)] after:absolute after:bottom-[3px] after:left-[3px] after:h-2 after:w-2 after:rotate-45 after:rounded-[2px] after:bg-inherit after:content-[''] ${getStatusDotClass(status)}`}>
              {index + 1}
            </span>
          )}
        </div>
        <div className="min-w-0">
          <h3 className="min-w-0 truncate text-[14px] font-extrabold leading-5 text-ink-950">{title}</h3>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-semibold text-ink-400">
            <span>{formatRelativeTime(annotation.updatedAt)}</span>
            <span className="font-bold text-ink-300">·</span>
            <span className="tabular-nums">{rectText}</span>
            <span className="font-bold text-ink-300">·</span>
            <StatusPill status={status} compact />
            <SeverityPill severity={annotation.feedback.severity} compact />
          </div>
          <p className="mt-1.5 line-clamp-3 whitespace-pre-line text-[14px] font-bold leading-5 text-ink-950">{annotation.feedback.comment}</p>
          <div className="mt-2 flex max-w-full items-center gap-1.5 truncate font-mono text-[11px] font-semibold text-ink-500">
            <Code2 size={13} className="shrink-0 text-ink-400" />
            <span className="truncate">{annotation.selector}</span>
          </div>
        </div>
      </div>
      <CardActionMenu
        open={menuOpen}
        onOpenChange={setMenuOpen}
        onFocus={onFocus}
        onCopySelector={() => void navigator.clipboard?.writeText(annotation.selector)}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    </article>
  );
}

function CardActionMenu({
  open,
  onOpenChange,
  onFocus,
  onCopySelector,
  onEdit,
  onDelete
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFocus: () => void;
  onCopySelector: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const idRef = React.useRef(`card-menu-${Math.random().toString(36).slice(2, 10)}`);
  const anchorName = `--anchor-${idRef.current}`;
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (triggerRef.current?.contains(event.target as Node) || menuRef.current?.contains(event.target as Node)) return;
      onOpenChange(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onOpenChange, open]);

  const run = (action: () => void) => {
    action();
    onOpenChange(false);
  };

  return (
    <div data-card-action="true" className="absolute right-4 top-4">
      <button
        ref={triggerRef}
        type="button"
        className="grid h-8 w-8 place-items-center rounded-lg text-ink-400 transition-[background-color,color,transform] duration-150 hover:bg-ink-50 hover:text-ink-900 active:scale-[0.96]"
        style={{ anchorName } as React.CSSProperties}
        aria-label="更多操作"
        onClick={(event) => {
          event.stopPropagation();
          onOpenChange(!open);
        }}
      >
        <MoreHorizontal size={18} />
      </button>
      <div
        ref={menuRef}
        className={`fixed z-[9999] min-w-44 rounded-xl bg-white p-1.5 text-sm font-semibold text-ink-900 shadow-[0_18px_44px_rgba(17,24,39,0.16),0_0_0_1px_rgba(17,24,39,0.08)] transition-[opacity,transform] duration-150 ${
          open ? "scale-100 opacity-100" : "pointer-events-none scale-95 opacity-0"
        }`}
        style={
          {
            positionAnchor: anchorName,
            top: "anchor(bottom)",
            right: "anchor(right)",
            translate: "0 6px",
            positionTryFallbacks: "flip-block, flip-inline"
          } as React.CSSProperties
        }
      >
        <button className="flex h-10 w-full items-center rounded-lg px-3 text-left text-ink-800 transition-colors duration-150 hover:bg-ink-50" type="button" onClick={() => run(onFocus)}>
          定位元素
        </button>
        <button className="flex h-10 w-full items-center rounded-lg px-3 text-left text-ink-800 transition-colors duration-150 hover:bg-ink-50" type="button" onClick={() => run(onCopySelector)}>
          复制 selector
        </button>
        <button className="flex h-10 w-full items-center rounded-lg px-3 text-left text-ink-800 transition-colors duration-150 hover:bg-ink-50" type="button" onClick={() => run(onEdit)}>
          编辑
        </button>
        <button className="flex h-10 w-full items-center rounded-lg px-3 text-left text-red-600 transition-colors duration-150 hover:bg-red-50" type="button" onClick={() => run(onDelete)}>
          删除
        </button>
      </div>
    </div>
  );
}

function ShortcutBadge({ active, children }: { active?: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex h-6 min-w-6 items-center justify-center rounded-lg px-2 text-[11px] font-extrabold tabular-nums shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)] ${
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
    <div className="mt-2">
      <button
        ref={triggerRef}
        type="button"
        className="flex h-11 w-full items-center justify-between gap-2 rounded-xl bg-ink-50 px-3 text-left shadow-[inset_0_0_0_1px_rgba(17,24,39,0.08)] transition-[background-color,box-shadow,transform] duration-150 hover:bg-white active:scale-[0.98]"
        style={{ anchorName } as React.CSSProperties}
        onClick={() => setIsOpen((open) => !open)}
      >
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
              className={`flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors duration-150 ${
                isSelected ? "bg-brand-50 text-brand-700" : "text-ink-800 hover:bg-ink-50"
              }`}
              onClick={() => {
                onChange(item.url);
                setIsOpen(false);
              }}
            >
              <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center ${isSelected ? "text-brand-600" : "text-transparent"}`}>
                <Check size={14} strokeWidth={2.7} />
              </span>
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
    note: "bg-note-50 text-note-700 hover:bg-note-100",
    neutral: "bg-ink-100 text-ink-700 hover:bg-ink-200",
    danger: "bg-red-50 text-red-700 hover:bg-red-100",
    success: "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
  };
  return styles[tone];
}

function EmptyState({ onPick }: { onPick: () => void }) {
  return (
    <div className="rounded-2xl bg-white px-4 py-8 text-center shadow-[0_8px_24px_rgba(17,24,39,0.05),inset_0_0_0_1px_rgba(17,24,39,0.06)]">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-ink-950 text-white">
        <ListChecks size={22} />
      </div>
      <h2 className="mt-4 text-base font-bold text-ink-900">当前页面暂无反馈</h2>
      <p className="mx-auto mt-1 max-w-[260px] text-sm leading-5 text-ink-500">
        选择一个页面元素，写下问题或建议，然后导出给 AI 使用的修改说明。
      </p>
      <button
        className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#0b1120] px-4 text-sm font-bold text-white shadow-[0_10px_22px_rgba(17,24,39,0.18)] transition-[background-color,transform] duration-150 hover:bg-[#1f2937] active:scale-[0.96]"
        onClick={onPick}
      >
        <Crosshair size={17} />
        选择元素
      </button>
    </div>
  );
}

function ExcludedState({ reason }: { reason: string }) {
  return (
    <div className="rounded-2xl bg-white px-4 py-8 text-center shadow-[0_8px_24px_rgba(17,24,39,0.05),inset_0_0_0_1px_rgba(17,24,39,0.06)]">
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

async function sendContentMessage(tabId: number, message: unknown) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content-loader.js"]
    });
    await chrome.tabs.sendMessage(tabId, message);
  }
}

function isInspectableUrl(url: string) {
  return /^(https?|file):/i.test(url) && !isExcludedUrl(url);
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
