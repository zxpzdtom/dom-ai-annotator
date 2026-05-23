import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AlertTriangle, Ban, Check, Clipboard, Filter, MessageCircle, Network, Ruler, TerminalSquare, Trash2, Type, X } from "lucide-react";
import cssText from "./content.css?inline";
import { createAnnotationDraft, getCssSelector } from "./selector";
import { isExcludedUrl } from "../shared/excludedUrls";
import type { AnnotationDraft, AnnotationPinAnchor, AnnotationStatus, ContentMessage, DomAnnotation, FeedbackSeverity, MonitorEvent, MonitorSnapshot } from "../shared/types";
import { deleteAnnotation, getAnnotations, saveAnnotation, subscribeAnnotations, updateAnnotationFeedback, updateAnnotationScreenshot, updateAnnotationStatus } from "../shared/storage";
import { getPinPalette, getStatusLabel, normalizeAnnotationStatus, severityLabels, statusLabels } from "../shared/status";
import { writeClipboardText } from "../shared/clipboard";

const ROOT_ID = "dom-ai-annotator-root";
const COMPOSER_WIDTH = 430;
const COMPOSER_ESTIMATED_HEIGHT = 560;
const COMPOSER_MIN_VISIBLE_HEIGHT = 360;
const EDGE_GAP = 16;
const PIN_COLLAPSED_WIDTH = 44;
const PIN_COLLAPSED_HEIGHT = 38;
const PIN_EXPANDED_WIDTH = 380;
const PIN_CARD_ESTIMATED_HEIGHT = 318;
const PIN_GAP = 8;
const SMALL_TARGET_MIN_WIDTH = 96;
const SMALL_TARGET_MIN_HEIGHT = 44;
const HOVER_LABEL_GAP = 8;
const HOVER_LABEL_HEIGHT = 34;
const HOVER_LABEL_MAX_WIDTH = 320;
const HOVER_LABEL_VIEWPORT_GAP = 8;
const MEASURE_COLORS = ["#2563eb", "#dc2626", "#7c3aed", "#ea580c", "#0891b2", "#16a34a"];
const MONITOR_SCRIPT_ID = "dom-ai-monitor-bridge-script";
const MAX_MONITOR_EVENTS = 400;
const MONITOR_EVENT_NAME = "dom-ai-monitor-event";
const COMMENT_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    <path d="M8.2 25.8v-5.2A8.7 8.7 0 0 1 5.5 14.2C5.5 9 9.7 5 15.1 5h4.7c5.4 0 9.7 4 9.7 9.2s-4.3 9.2-9.7 9.2h-6.4l-5.2 2.4Z" fill="white" stroke="black" stroke-width="3.2" stroke-linejoin="round"/>
    <path d="M8.2 25.8v-5.2A8.7 8.7 0 0 1 5.5 14.2C5.5 9 9.7 5 15.1 5h4.7c5.4 0 9.7 4 9.7 9.2s-4.3 9.2-9.7 9.2h-6.4l-5.2 2.4Z" fill="white" stroke="white" stroke-width="1.2" stroke-linejoin="round"/>
    <path d="M13.3 14.2h.01M17.5 14.2h.01M21.7 14.2h.01" stroke="#0f9f78" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M8.2 25.8v-5.2" stroke="#0f9f78" stroke-width="1.4" stroke-linecap="round"/>
  </svg>`
)}") 9 9, crosshair`;

type ComposerState = {
  draft: AnnotationDraft;
  inspection: HoverInspection;
  editingAnnotation?: DomAnnotation;
};

type HoverInspection = {
  key: string;
  label: string;
  element?: Element;
  viewportRect: RectSnapshot;
  documentRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  fontSize: string;
  lineHeight: string;
  fontWeight: string;
  fontFamily: string;
  color: string;
  backgroundColor: string;
  display: string;
  position: string;
  opacity: string;
  zIndex: string;
  gap: string;
  margin: string;
  padding: string;
  borderRadius: string;
};

type RectSnapshot = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ViewportOffset = {
  x: number;
  y: number;
};

type MeasurementLine = {
  key: string;
  orientation: "horizontal" | "vertical";
  x: number;
  y: number;
  length: number;
  label: string;
  labelX: number;
  labelY: number;
};

type PinnedMeasurement = {
  key: string;
  color: string;
  from: HoverInspection;
  to: HoverInspection;
  measurements: MeasurementLine[];
};

type DocumentSize = {
  width: number;
  height: number;
};

type ColorMode = "rgb" | "hex" | "hsl";

declare global {
  interface Window {
    __DOM_AI_OPEN_MONITOR_REQUESTED__?: boolean;
  }
}

let monitorEnabled = false;
let monitorEvents: MonitorEvent[] = [];
let monitorBridgeInjected = false;

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data as { source?: string; type?: string; event?: MonitorEvent };
  if (data?.source !== "DOM_AI_MONITOR_BRIDGE") return;

  if (data.type === "ready") {
    monitorBridgeInjected = true;
    return;
  }

  if (data.type !== "event" || !data.event) return;
  const item = data.event;
  monitorEvents = [item, ...monitorEvents].slice(0, MAX_MONITOR_EVENTS);
  window.dispatchEvent(new CustomEvent(MONITOR_EVENT_NAME, { detail: item }));
  void chrome.runtime.sendMessage({ type: "DOM_AI_MONITOR_EVENT", event: item });
});

function getMonitorSnapshot(): MonitorSnapshot {
  return {
    events: monitorEvents,
    enabled: monitorEnabled
  };
}

function enableMonitor(): MonitorSnapshot {
  monitorEnabled = true;
  injectMonitorBridge();
  return getMonitorSnapshot();
}

function clearMonitor(): MonitorSnapshot {
  monitorEvents = [];
  return getMonitorSnapshot();
}

function injectMonitorBridge() {
  if (monitorBridgeInjected || document.getElementById(MONITOR_SCRIPT_ID)) {
    monitorBridgeInjected = true;
    return;
  }

  const script = document.createElement("script");
  script.id = MONITOR_SCRIPT_ID;
  script.src = chrome.runtime.getURL("monitorBridge.js");
  script.async = false;
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
}

function App() {
  const [isPicking, setPicking] = useState(false);
  const [isMeasuring, setMeasuring] = useState(false);
  const [hoverInspection, setHoverInspection] = useState<HoverInspection | null>(null);
  const [measureAnchor, setMeasureAnchor] = useState<HoverInspection | null>(null);
  const [measureHover, setMeasureHover] = useState<HoverInspection | null>(null);
  const [measurePaused, setMeasurePaused] = useState(false);
  const [pinnedMeasurements, setPinnedMeasurements] = useState<PinnedMeasurement[]>([]);
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [resumePickingAfterComposer, setResumePickingAfterComposer] = useState(false);
  const [annotations, setAnnotations] = useState<DomAnnotation[]>([]);
  const [focusedAnnotationId, setFocusedAnnotationId] = useState<string | null>(null);
  const [hoveredAnnotationId, setHoveredAnnotationId] = useState<string | null>(null);
  const [documentSize, setDocumentSize] = useState<DocumentSize>(() => getDocumentSize());
  const [viewportOffset, setViewportOffset] = useState<ViewportOffset>(() => ({ x: window.scrollX, y: window.scrollY }));
  const [monitorOpen, setMonitorOpen] = useState(() => Boolean(window.__DOM_AI_OPEN_MONITOR_REQUESTED__));
  const [monitorView, setMonitorView] = useState<"console" | "network">("console");
  const [monitorItems, setMonitorItems] = useState<MonitorEvent[]>(() => monitorEvents);
  const [monitorSelectedIds, setMonitorSelectedIds] = useState<string[]>([]);
  const [monitorSearch, setMonitorSearch] = useState("");
  const focusTimerRef = useRef<number | null>(null);

  useEffect(() => {
    enableMonitor();
    setMonitorItems(getMonitorSnapshot().events);
    const listener = (event: Event) => {
      const item = (event as CustomEvent<MonitorEvent>).detail;
      setMonitorItems((items) => [item, ...items.filter((existing) => existing.id !== item.id)].slice(0, MAX_MONITOR_EVENTS));
    };
    window.addEventListener(MONITOR_EVENT_NAME, listener);
    return () => window.removeEventListener(MONITOR_EVENT_NAME, listener);
  }, []);

  useEffect(() => {
    const openMonitor = () => {
      window.__DOM_AI_OPEN_MONITOR_REQUESTED__ = true;
      setMonitorOpen(true);
    };
    window.addEventListener("DOM_AI_OPEN_MONITOR", openMonitor);
    return () => window.removeEventListener("DOM_AI_OPEN_MONITOR", openMonitor);
  }, []);

  const refreshAnnotations = useCallback(async () => {
    const items = await getAnnotations();
    setAnnotations(items.filter((item) => item.url === location.href));
  }, []);

  useEffect(() => {
    void refreshAnnotations();
    return subscribeAnnotations(refreshAnnotations);
  }, [refreshAnnotations]);

  useEffect(() => {
    let frame = 0;

    const updateDocumentSize = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        setDocumentSize(getDocumentSize());
        setViewportOffset({ x: window.scrollX, y: window.scrollY });
      });
    };

    window.addEventListener("scroll", updateDocumentSize, true);
    window.addEventListener("resize", updateDocumentSize);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", updateDocumentSize, true);
      window.removeEventListener("resize", updateDocumentSize);
    };
  }, []);

  useEffect(() => {
    const listener = (message: ContentMessage, _sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => {
      if (message.type === "DOM_AI_START_PICKING") {
        setMeasuring(false);
        setResumePickingAfterComposer(false);
        setMeasureAnchor(null);
        setMeasureHover(null);
        setMeasurePaused(false);
        setPinnedMeasurements([]);
        setPicking(true);
      }
      if (message.type === "DOM_AI_STOP_PICKING") {
        setPicking(false);
        setResumePickingAfterComposer(false);
      }
      if (message.type === "DOM_AI_START_MEASURING") {
        setPicking(false);
        setComposer(null);
        setResumePickingAfterComposer(false);
        setMeasureAnchor(null);
        setMeasureHover(null);
        setMeasurePaused(false);
        setPinnedMeasurements([]);
        setMeasuring(true);
      }
      if (message.type === "DOM_AI_STOP_MEASURING") {
        setMeasuring(false);
        setMeasureAnchor(null);
        setMeasureHover(null);
        setMeasurePaused(false);
        setPinnedMeasurements([]);
      }
      if (message.type === "DOM_AI_REFRESH_PINS") void refreshAnnotations();
      if (message.type === "DOM_AI_FOCUS_ANNOTATION") focusAndHighlightAnnotation(message.id, annotations);
      if (message.type === "DOM_AI_EDIT_ANNOTATION") openAnnotationEditor(message.id, annotations);
      if (message.type === "DOM_AI_MONITOR_ENABLE") {
        sendResponse(enableMonitor());
        return true;
      }
      if (message.type === "DOM_AI_MONITOR_CLEAR") {
        sendResponse(clearMonitor());
        return true;
      }
      if (message.type === "DOM_AI_SHOW_IMAGE_PREVIEW") {
        showImagePreviewOverlay(message.dataUrl);
      }
      if (message.type === "DOM_AI_CLOSE_IMAGE_PREVIEW") {
        document.getElementById("dom-ai-img-preview")?.remove();
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [annotations, refreshAnnotations]);

  useEffect(() => {
    const cursor = isPicking ? COMMENT_CURSOR : isMeasuring && !measurePaused ? "crosshair" : "";
    document.body.style.cursor = cursor;
    document.documentElement.style.cursor = cursor;

    return () => {
      document.body.style.cursor = "";
      document.documentElement.style.cursor = "";
    };
  }, [isMeasuring, isPicking, measurePaused]);

  useEffect(() => {
    const onToolShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableEvent(event)) return;

      if (event.key.toLowerCase() === "c" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        event.stopPropagation();
        setComposer(null);
        setResumePickingAfterComposer(false);
        setMeasuring(false);
        setMeasurePaused(false);
        setPinnedMeasurements([]);
        setPicking(true);
        return;
      }

      if (event.key.toLowerCase() === "m" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        event.stopPropagation();
        setComposer(null);
        setResumePickingAfterComposer(false);
        setPicking(false);
        if (isMeasuring) {
          setMeasureAnchor(null);
          setMeasureHover(null);
          setMeasurePaused(false);
          return;
        }
        setMeasureAnchor(null);
        setMeasureHover(null);
        setMeasurePaused(false);
        setPinnedMeasurements([]);
        setMeasuring(true);
        return;
      }

      if (event.key === "Escape" && (isPicking || isMeasuring)) {
        event.preventDefault();
        event.stopPropagation();
        if (isMeasuring && (measurePaused || (!measureAnchor && !measureHover && !pinnedMeasurements.length))) {
          setMeasuring(false);
          setMeasurePaused(false);
          setPinnedMeasurements([]);
          return;
        }
        if (isMeasuring) {
          setMeasureAnchor(null);
          setMeasureHover(null);
          setMeasurePaused(true);
          return;
        }
        setPicking(false);
        setResumePickingAfterComposer(false);
      }
    };

    window.addEventListener("keydown", onToolShortcut, true);
    return () => window.removeEventListener("keydown", onToolShortcut, true);
  }, [isMeasuring, isPicking, measureAnchor, measureHover, measurePaused, pinnedMeasurements.length]);

  useEffect(() => {
    if (!isPicking) {
      setHoverInspection(null);
      return;
    }

    const onMove = (event: MouseEvent) => {
      if (measurePaused) return;
      const element = getTargetElement(event);
      if (!element) return;
      setDocumentSize(getDocumentSize());
      setHoverInspection(getElementInspection(element));
    };

    const onClick = (event: MouseEvent) => {
      if (measurePaused) return;
      const element = getTargetElement(event);
      if (!element) return;
      event.preventDefault();
      event.stopPropagation();
      setResumePickingAfterComposer(true);
      const inspection = getElementInspection(element);
      setComposer({
        draft: createAnnotationDraft(element, getPreferredAnnotationPinAnchor(inspection, {
          x: event.clientX + window.scrollX,
          y: event.clientY + window.scrollY
        })),
        inspection
      });
      setPicking(false);
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setPicking(false);
      setResumePickingAfterComposer(false);
    };

    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("keydown", onKey, true);

    return () => {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [isPicking]);

  useEffect(() => {
    if (!isMeasuring || measurePaused) {
      setMeasureAnchor(null);
      setMeasureHover(null);
      return;
    }

    const onMove = (event: MouseEvent) => {
      const element = getTargetElement(event);
      if (!element) return;
      setDocumentSize(getDocumentSize());
      setMeasureHover(getElementInspection(element));
    };

    const onClick = (event: MouseEvent) => {
      const element = getTargetElement(event);
      if (!element) return;
      event.preventDefault();
      event.stopPropagation();
      const inspection = getElementInspection(element);
      setMeasureHover(inspection);

      setMeasureAnchor((anchor) => {
        if (!anchor) return inspection;
        if (isSameInspectionTarget(anchor, inspection)) return anchor;

        const pairKey = getMeasurementPairKey(anchor, inspection);
        const measurements = getElementDistanceLines(anchor.documentRect, inspection.documentRect);
        setPinnedMeasurements((items) =>
          items.some((item) => item.key === pairKey)
            ? items
            : [...items, { key: pairKey, color: MEASURE_COLORS[items.length % MEASURE_COLORS.length], from: anchor, to: inspection, measurements }]
        );
        setMeasureHover(null);
        return null;
      });
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (measurePaused || (!measureAnchor && !measureHover && !pinnedMeasurements.length)) {
        setMeasuring(false);
        setMeasurePaused(false);
        setPinnedMeasurements([]);
        return;
      }
      setMeasureAnchor(null);
      setMeasureHover(null);
      setMeasurePaused(true);
    };

    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("keydown", onKey, true);

    return () => {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [isMeasuring, measureAnchor, measureHover, measurePaused, pinnedMeasurements.length]);

  const sortedAnnotations = useMemo(
    () => [...annotations].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [annotations]
  );

  function closeComposer() {
    setComposer(null);
    if (resumePickingAfterComposer) setPicking(true);
    setResumePickingAfterComposer(false);
  }

  function focusAndHighlightAnnotation(id: string, items: DomAnnotation[]) {
    focusAnnotation(id, items);
    setFocusedAnnotationId(id);
    if (focusTimerRef.current) window.clearTimeout(focusTimerRef.current);
    focusTimerRef.current = window.setTimeout(() => {
      setFocusedAnnotationId(null);
      focusTimerRef.current = null;
    }, 1600);
  }

  function openAnnotationEditor(id: string, items: DomAnnotation[]) {
    const annotation = items.find((item) => item.id === id);
    if (!annotation) return;
    setPicking(false);
    setResumePickingAfterComposer(false);
    setMeasuring(false);
    setMeasureAnchor(null);
    setMeasureHover(null);
    setMeasurePaused(false);
    setPinnedMeasurements([]);
    focusAnnotation(id, items);
    setComposer({
      draft: getAnnotationDraft(annotation),
      inspection: getInspectionForAnnotation(annotation),
      editingAnnotation: annotation
    });
  }

  function startPickingMode() {
    setComposer(null);
    setResumePickingAfterComposer(false);
    setMeasuring(false);
    setMeasureAnchor(null);
    setMeasureHover(null);
    setMeasurePaused(false);
    setPicking(true);
  }

  function startMeasuringMode() {
    setComposer(null);
    setResumePickingAfterComposer(false);
    setPicking(false);
    setMeasureAnchor(null);
    setMeasureHover(null);
    setMeasurePaused(false);
    setMeasuring(true);
  }

  function toggleMeasuringMode() {
    if (isMeasuring) {
      stopCurrentMode();
      return;
    }
    startMeasuringMode();
  }

  function stopCurrentMode() {
    setPicking(false);
    setResumePickingAfterComposer(false);
    setMeasuring(false);
    setMeasureAnchor(null);
    setMeasureHover(null);
    setMeasurePaused(false);
  }

  function openSidePanel() {
    void chrome.runtime.sendMessage({ type: "DOM_AI_OPEN_SIDE_PANEL" });
  }

  const filteredMonitorItems = useMemo(
    () => monitorItems.filter((item) => item.pageUrl === location.href).filter((item) => matchesMonitorSearch(item, monitorSearch)),
    [monitorItems, monitorSearch]
  );
  const visibleMonitorItems = useMemo(
    () => filteredMonitorItems.filter((item) => (monitorView === "network" ? item.kind === "network" : item.kind !== "network")),
    [filteredMonitorItems, monitorView]
  );
  const monitorAlertCount = useMemo(() => monitorItems.filter(isMonitorAlert).length, [monitorItems]);

  function toggleMonitorSelected(id: string) {
    setMonitorSelectedIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);
  }

  async function copyMonitorItems() {
    const selected = monitorItems.filter((item) => monitorSelectedIds.includes(item.id));
    const items = selected.length ? selected : monitorItems.filter(isMonitorAlert);
    if (!items.length) return;
    await writeClipboardText(exportMonitorEventsAsMarkdown(items));
  }

  return (
    <div className="dom-ai-root">
      <div
        className="dom-ai-document-layer"
        style={{
          width: documentSize.width,
          height: documentSize.height,
          transform: `translate(${-viewportOffset.x}px, ${-viewportOffset.y}px)`
        }}
      >
        {isPicking && hoverInspection ? (
          <>
            <div
              className="dom-ai-highlight"
              style={getHighlightStyle(hoverInspection)}
            />
            <div
              className="dom-ai-hover-label"
              style={getHoverLabelStyle(hoverInspection, hoverInspection.label, `${Math.round(hoverInspection.documentRect.width)} x ${Math.round(hoverInspection.documentRect.height)}`)}
            >
              <span>{hoverInspection.label}</span>
              <b>{Math.round(hoverInspection.documentRect.width)} x {Math.round(hoverInspection.documentRect.height)}</b>
            </div>
          </>
        ) : null}

        {isMeasuring ? (
          <MeasureLayer anchor={measurePaused ? null : measureAnchor} hover={measurePaused ? null : measureHover} pinnedMeasurements={pinnedMeasurements} />
        ) : null}

        {focusedAnnotationId ? (
          <FocusedAnnotationOverlay annotation={sortedAnnotations.find((item) => item.id === focusedAnnotationId)} />
        ) : null}

        {hoveredAnnotationId && hoveredAnnotationId !== focusedAnnotationId ? (
          <FocusedAnnotationOverlay annotation={sortedAnnotations.find((item) => item.id === hoveredAnnotationId)} subtle />
        ) : null}

        {sortedAnnotations.map((annotation, index) => (
          <AnnotationPin
            key={annotation.id}
            annotation={annotation}
            index={index}
            focused={focusedAnnotationId === annotation.id}
            onEdit={() => openAnnotationEditor(annotation.id, sortedAnnotations)}
            onStatusChange={async (status) => {
              await updateAnnotationStatus(annotation.id, status);
              await refreshAnnotations();
            }}
            onDelete={async () => {
              await deleteAnnotation(annotation.id);
              await refreshAnnotations();
            }}
            onHoverChange={(hovered) => setHoveredAnnotationId(hovered ? annotation.id : null)}
          />
        ))}

        {composer ? (
          <div
            className="dom-ai-composer-anchor"
            style={{
              left: composer.inspection.documentRect.x,
              top: composer.inspection.documentRect.y,
              width: composer.inspection.documentRect.width,
              height: composer.inspection.documentRect.height
            }}
          />
        ) : null}

        {composer ? <Composer state={composer} onCancel={closeComposer} onSaved={() => {
          closeComposer();
          void refreshAnnotations();
        }} onDeleted={() => {
          closeComposer();
          void refreshAnnotations();
        }} /> : null}
      </div>

      <FloatingToolBar
        isPicking={isPicking}
        isMeasuring={isMeasuring}
        onPick={startPickingMode}
        onMeasure={toggleMeasuringMode}
        onOpenPanel={openSidePanel}
        onOpenMonitor={() => setMonitorOpen(true)}
        monitorAlertCount={monitorAlertCount}
        onCancel={stopCurrentMode}
      />

      <MiniDevTools
        open={monitorOpen}
        view={monitorView}
        events={visibleMonitorItems}
        allEvents={monitorItems}
        selectedIds={monitorSelectedIds}
        search={monitorSearch}
        alertCount={monitorAlertCount}
        onOpenChange={setMonitorOpen}
        onViewChange={setMonitorView}
        onSearchChange={setMonitorSearch}
        onToggleSelected={toggleMonitorSelected}
        onClear={() => {
          clearMonitor();
          setMonitorItems([]);
          setMonitorSelectedIds([]);
        }}
        onCopy={() => void copyMonitorItems()}
        onSelectAll={() => setMonitorSelectedIds(visibleMonitorItems.map((item) => item.id))}
        onClearSelection={() => setMonitorSelectedIds([])}
      />

    </div>
  );
}

function AnnotationPin({
  annotation,
  index,
  focused,
  onEdit,
  onStatusChange,
  onDelete,
  onHoverChange
}: {
  annotation: DomAnnotation;
  index: number;
  focused: boolean;
  onEdit: () => void;
  onStatusChange: (status: AnnotationStatus) => void;
  onDelete: () => void;
  onHoverChange: (hovered: boolean) => void;
}) {
  const [isDismissed, setIsDismissed] = useState(false);
  const palette = getPinPalette(annotation.status);
  const position = getAnnotationPinPosition(annotation);
  const normalizedStatus = normalizeAnnotationStatus(annotation.status);
  const title = getAnnotationTitle(annotation);
  const statusOptions: AnnotationStatus[] = ["pending", "sent", "changed", "needs_work", "passed", "skipped"];
  const style = {
    left: position.left,
    top: position.top,
    "--dom-ai-pin-card-top": `${position.cardTop}px`,
    "--dom-ai-pin-bg": palette.bg,
    "--dom-ai-pin-hover-bg": palette.hover,
    "--dom-ai-pin-badge-bg": palette.badge
  } as React.CSSProperties;

  return (
    <div
      className={`dom-ai-pin dom-ai-pin-placement-${position.placement} dom-ai-pin-card-side-${position.cardSide} dom-ai-interactive ${focused ? "dom-ai-pin-focused" : ""} ${isDismissed ? "dom-ai-pin-dismissed" : ""}`}
      style={style}
      onMouseEnter={() => {
        setIsDismissed(false);
        onHoverChange(true);
      }}
      onMouseLeave={() => {
        onHoverChange(false);
      }}
      onFocus={() => onHoverChange(true)}
      onBlur={() => onHoverChange(false)}
    >
      <button
        type="button"
        className="dom-ai-pin-marker"
        aria-label={`查看第 ${index + 1} 条评论`}
        onClick={(event) => {
          event.stopPropagation();
          setIsDismissed(false);
          onHoverChange(true);
        }}
      >
        <span className="dom-ai-pin-number">{index + 1}</span>
      </button>
      <section className="dom-ai-pin-card" aria-label={`第 ${index + 1} 条评论`}>
        <header className="dom-ai-pin-card-header">
          <span className="dom-ai-pin-card-index">{index + 1}</span>
          <div className="dom-ai-pin-card-title">
            <strong>{title}</strong>
            <code>{annotation.selector}</code>
          </div>
          <button
            type="button"
            className="dom-ai-pin-card-close"
            aria-label="收起评论"
            onClick={(event) => {
              event.stopPropagation();
              setIsDismissed(true);
              onHoverChange(false);
            }}
          >
            <X size={18} />
          </button>
        </header>
        <div className="dom-ai-pin-card-body">
          <div className="dom-ai-pin-card-meta">
            <span className={`dom-ai-pin-severity dom-ai-pin-severity-${annotation.feedback.severity}`}>
              <i />
              {severityLabels[annotation.feedback.severity]}
            </span>
            <span>{formatRelativeTime(annotation.updatedAt)}</span>
          </div>
          <p>{annotation.feedback.comment}</p>
          <span className="dom-ai-pin-card-caption">状态</span>
          <div className="dom-ai-pin-status-row">
            {statusOptions.map((status) => {
              const statusPalette = getPinPalette(status);
              const active = normalizedStatus === status;
              return (
                <button
                  key={status}
                  type="button"
                  className={`dom-ai-pin-status-chip ${active ? "dom-ai-pin-status-chip-active" : ""}`}
                  style={{ "--dom-ai-status-color": statusPalette.bg } as React.CSSProperties}
                  onClick={(event) => {
                    event.stopPropagation();
                    onStatusChange(status);
                  }}
                >
                  <i />
                  {statusLabels[status]}
                </button>
              );
            })}
          </div>
        </div>
        <footer className="dom-ai-pin-card-footer">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onEdit();
            }}
          >
            编辑
          </button>
          <button
            type="button"
            className="dom-ai-pin-card-delete"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
          >
            删除
          </button>
        </footer>
      </section>
    </div>
  );
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

function FloatingToolBar({
  isPicking,
  isMeasuring,
  onPick,
  onMeasure,
  onOpenPanel,
  onOpenMonitor,
  monitorAlertCount,
  onCancel
}: {
  isPicking: boolean;
  isMeasuring: boolean;
  onPick: () => void;
  onMeasure: () => void;
  onOpenPanel: () => void;
  onOpenMonitor: () => void;
  monitorAlertCount: number;
  onCancel: () => void;
}) {
  if (isPicking || isMeasuring) {
    return (
      <div className={`dom-ai-mode-bar dom-ai-interactive ${isMeasuring ? "dom-ai-mode-bar-measuring" : ""}`}>
        <span className="dom-ai-mode-indicator">
          {isPicking ? <ReviewCursorIcon /> : <Ruler size={18} />}
        </span>
        <span className="dom-ai-mode-title">{isPicking ? "选择需要标注的元素" : "选择元素测量距离"}</span>
        <button type="button" className="dom-ai-mode-cancel" onClick={onCancel}>
          取消
          <kbd>Esc</kbd>
        </button>
      </div>
    );
  }

  return (
    <div className="dom-ai-tool-bar dom-ai-scroll-mask-x dom-ai-interactive">
      <button
        type="button"
        className={`dom-ai-tool-button dom-ai-tool-button-primary ${isPicking ? "dom-ai-tool-button-active" : ""}`}
        onClick={onPick}
      >
        <ReviewCursorIcon />
        <span>标注</span>
        <kbd>C</kbd>
      </button>
      <button
        type="button"
        className={`dom-ai-tool-button ${isMeasuring ? "dom-ai-tool-button-active" : ""}`}
        onClick={onMeasure}
      >
        <Ruler size={15} />
        <span>测量</span>
        <kbd>M</kbd>
      </button>
      <span className="dom-ai-tool-divider" />
      <button type="button" className="dom-ai-tool-button dom-ai-tool-button-monitor" onClick={onOpenMonitor}>
        <TerminalSquare size={15} />
        <span>Monitor</span>
        {monitorAlertCount ? <b>{monitorAlertCount}</b> : null}
      </button>
      <button type="button" className="dom-ai-tool-button dom-ai-tool-button-muted" onClick={onOpenPanel}>
        <kbd>⌥⇧C</kbd>
        <span>打开扩展</span>
      </button>
    </div>
  );
}

function ReviewCursorIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 20 20" fill="currentColor" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3l7 17 2-7 7-2z" />
    </svg>
  );
}

function MiniDevTools({
  open,
  view,
  events,
  allEvents,
  selectedIds,
  search,
  alertCount,
  onOpenChange,
  onViewChange,
  onSearchChange,
  onToggleSelected,
  onClear,
  onCopy,
  onSelectAll,
  onClearSelection
}: {
  open: boolean;
  view: "console" | "network";
  events: MonitorEvent[];
  allEvents: MonitorEvent[];
  selectedIds: string[];
  search: string;
  alertCount: number;
  onOpenChange: (open: boolean) => void;
  onViewChange: (view: "console" | "network") => void;
  onSearchChange: (search: string) => void;
  onToggleSelected: (id: string) => void;
  onClear: () => void;
  onCopy: () => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
}) {
  const selectedNetworkEvent = view === "network" ? events.find((event) => selectedIds.includes(event.id)) : undefined;
  const consoleCount = allEvents.filter((event) => event.kind !== "network").length;
  const networkCount = allEvents.filter((event) => event.kind === "network").length;

  if (!open) {
    return (
      <button type="button" className="dom-ai-devtools-launcher dom-ai-interactive" onClick={() => onOpenChange(true)}>
        <TerminalSquare size={16} />
        <span>Monitor</span>
        {alertCount ? <b>{alertCount}</b> : null}
      </button>
    );
  }

  return (
    <section className="dom-ai-devtools dom-ai-interactive" aria-label="DOM Review DevTools">
      <header className="dom-ai-devtools-tabs">
        <button type="button" className={view === "console" ? "dom-ai-devtools-tab-active" : ""} onClick={() => onViewChange("console")}>
          Console <span>{consoleCount}</span>
        </button>
        <button type="button" className={view === "network" ? "dom-ai-devtools-tab-active" : ""} onClick={() => onViewChange("network")}>
          Network <span>{networkCount}</span>
        </button>
        <button type="button" className="dom-ai-devtools-close" onClick={() => onOpenChange(false)} aria-label="关闭监控面板">
          <X size={17} />
        </button>
      </header>
      <div className="dom-ai-devtools-toolbar">
        <button type="button" className="dom-ai-devtools-icon-button dom-ai-devtools-danger" onClick={onClear} title="Clear">
          <Ban size={16} />
        </button>
        <button type="button" className="dom-ai-devtools-icon-button" onClick={selectedIds.length ? onClearSelection : onSelectAll} title="Select visible">
          <Check size={16} />
        </button>
        <button type="button" className="dom-ai-devtools-icon-button" onClick={onCopy} title="Copy selected to AI">
          <Clipboard size={16} />
        </button>
        <div className="dom-ai-devtools-filter">
          <Filter size={14} />
          <input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Filter" />
        </div>
        <span className="dom-ai-devtools-count">{selectedIds.length ? `${selectedIds.length} selected` : `${events.length} visible`}</span>
      </div>
      <div className="dom-ai-devtools-body">
        {view === "console" ? (
          <ConsolePane events={events.filter((event) => event.kind !== "network")} selectedIds={selectedIds} onToggleSelected={onToggleSelected} />
        ) : (
          <>
            <NetworkPane events={events.filter((event) => event.kind === "network")} selectedIds={selectedIds} onToggleSelected={onToggleSelected} />
            {selectedNetworkEvent ? <NetworkInspector event={selectedNetworkEvent} /> : null}
          </>
        )}
      </div>
    </section>
  );
}

function ConsolePane({ events, selectedIds, onToggleSelected }: { events: MonitorEvent[]; selectedIds: string[]; onToggleSelected: (id: string) => void }) {
  if (!events.length) return <div className="dom-ai-devtools-empty">No console messages</div>;
  return (
    <div className="dom-ai-console-pane">
      {events.map((event) => (
        <button key={event.id} type="button" className={`dom-ai-console-row dom-ai-console-row-${getMonitorToneName(event)} ${selectedIds.includes(event.id) ? "dom-ai-devtools-row-selected" : ""}`} onClick={() => onToggleSelected(event.id)}>
          <span>{event.severity === "warn" || event.severity === "error" || event.kind === "error" ? <AlertTriangle size={15} /> : "›"}</span>
          <code>{event.message}</code>
          {event.details || event.stack ? <pre>{event.details || event.stack}</pre> : null}
        </button>
      ))}
    </div>
  );
}

function NetworkPane({ events, selectedIds, onToggleSelected }: { events: MonitorEvent[]; selectedIds: string[]; onToggleSelected: (id: string) => void }) {
  if (!events.length) return <div className="dom-ai-devtools-empty">No network requests</div>;
  return (
    <div className="dom-ai-network-pane">
      <div className="dom-ai-network-head">
        <span>Name</span>
        <span>Status</span>
        <span>Type</span>
        <span>Method</span>
        <span>Time</span>
      </div>
      {events.map((event) => (
        <button key={event.id} type="button" className={`dom-ai-network-row ${selectedIds.includes(event.id) ? "dom-ai-devtools-row-selected" : ""}`} onClick={() => onToggleSelected(event.id)}>
          <span>{getNetworkName(event.message)}</span>
          <span className={event.ok === false ? "dom-ai-network-bad" : ""}>{event.status ?? "failed"}</span>
          <span>{event.responseType || event.requestType || "fetch"}</span>
          <span>{event.method || "GET"}</span>
          <span>{event.durationMs ?? 0} ms</span>
        </button>
      ))}
    </div>
  );
}

function NetworkInspector({ event }: { event: MonitorEvent }) {
  return (
    <aside className="dom-ai-network-inspector">
      <div className="dom-ai-network-inspector-tabs">
        <span>Headers</span>
        <span className="dom-ai-network-inspector-active">Preview</span>
        <span>Response</span>
        <span>Payload</span>
      </div>
      <div className="dom-ai-network-inspector-body">
        <InspectorBlock title="General" rows={{
          "Request URL": event.message.replace(/^\S+\s+/, ""),
          "Request Method": event.method || "GET",
          "Status Code": event.status ? `${event.status} ${event.statusText || ""}` : "failed",
          "Duration": `${event.durationMs ?? 0} ms`
        }} />
        <InspectorBlock title="Request Headers" rows={event.requestHeaders || {}} />
        {event.requestBody ? <InspectorText title="Payload" value={event.requestBody} /> : null}
        <InspectorBlock title="Response Headers" rows={event.responseHeaders || {}} />
        {event.responseBody ? <InspectorText title="Response" value={event.responseBody} /> : null}
      </div>
    </aside>
  );
}

function InspectorBlock({ title, rows }: { title: string; rows: Record<string, string> }) {
  const entries = Object.entries(rows);
  if (!entries.length) return null;
  return (
    <section className="dom-ai-inspector-block">
      <h3>{title}</h3>
      {entries.map(([key, value]) => (
        <p key={key}><b>{key}:</b> <span>{value}</span></p>
      ))}
    </section>
  );
}

function InspectorText({ title, value }: { title: string; value: string }) {
  return (
    <section className="dom-ai-inspector-block">
      <h3>{title}</h3>
      <pre>{formatJsonLike(value)}</pre>
    </section>
  );
}

function getMonitorToneName(event: MonitorEvent) {
  if (event.severity === "error" || event.kind === "error" || event.ok === false) return "error";
  if (event.severity === "warn") return "warn";
  return "info";
}

function isMonitorAlert(event: MonitorEvent) {
  return event.severity === "warn" || event.severity === "error" || event.kind === "error" || event.ok === false;
}

function matchesMonitorSearch(event: MonitorEvent, search: string) {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  return [event.message, event.details, event.stack, event.requestBody, event.responseBody, event.statusText]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(query));
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

function formatJsonLike(value: string) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function exportMonitorEventsAsMarkdown(events: MonitorEvent[]) {
  return [
    "# Runtime context for AI",
    "",
    ...events.map((event, index) => [
      `## ${index + 1}. ${event.kind.toUpperCase()} ${event.method || ""} ${event.status ?? ""}`.trim(),
      `- URL: ${event.message.replace(/^\S+\s+/, "")}`,
      event.requestBody ? `- Request body:\n\n\`\`\`text\n${event.requestBody}\n\`\`\`` : "",
      event.responseBody ? `- Response body:\n\n\`\`\`text\n${event.responseBody}\n\`\`\`` : "",
      event.details ? `- Details: ${event.details}` : ""
    ].filter(Boolean).join("\n\n"))
  ].join("\n");
}

type AnnotationPinPosition = {
  left: number;
  top: number;
  placement: PinPlacement;
  cardSide: "right" | "left";
  cardTop: number;
};

type PinPlacement = "right" | "left" | "bottom" | "top";

type PinCandidate = {
  anchor: AnnotationPinAnchor;
  placement: PinPlacement;
};

function getAnnotationPinPosition(annotation: DomAnnotation): AnnotationPinPosition {
  const rect = getAnnotationDocumentRect(annotation);
  const candidate = getPreferredAnnotationPinCandidateFromRect(rect, annotation.pin);
  const { anchor } = candidate;
  const viewportLeft = window.scrollX;
  const viewportRight = window.scrollX + window.innerWidth;
  const viewportTop = window.scrollY + EDGE_GAP;
  const viewportBottom = window.scrollY + window.innerHeight - EDGE_GAP;
  const canExpandRight = anchor.x + PIN_EXPANDED_WIDTH <= viewportRight - EDGE_GAP;
  const canExpandLeft = anchor.x - PIN_EXPANDED_WIDTH >= viewportLeft + EDGE_GAP;
  const markerRect = getPinMarkerRect(anchor, candidate.placement);
  const cardTop = getPinCardTopOffset(markerRect.y, viewportTop, viewportBottom);
  const cardSide = !canExpandRight && canExpandLeft ? "left" : "right";

  return {
    left: anchor.x,
    top: anchor.y,
    placement: candidate.placement,
    cardSide,
    cardTop
  };
}

function getPreferredAnnotationPinAnchor(inspection: HoverInspection, clickPoint: AnnotationPinAnchor): AnnotationPinAnchor {
  return getPreferredAnnotationPinCandidateFromRect(inspection.documentRect, clickPoint).anchor;
}

function getPreferredAnnotationPinCandidateFromRect(rect: HoverInspection["documentRect"], preferredPoint?: AnnotationPinAnchor): PinCandidate {
  const shouldAvoidTarget = rect.width < SMALL_TARGET_MIN_WIDTH || rect.height < SMALL_TARGET_MIN_HEIGHT;
  const preferredCandidate = preferredPoint ? inferPinCandidateFromPoint(rect, preferredPoint) : null;
  const markerOverlapsTarget = preferredCandidate ? markerRectOverlapsTarget(getPinMarkerRect(preferredCandidate.anchor, preferredCandidate.placement), rect) : false;
  if (preferredCandidate && !shouldAvoidTarget && !markerOverlapsTarget) return preferredCandidate;

  const viewportLeft = window.scrollX + EDGE_GAP;
  const viewportRight = window.scrollX + window.innerWidth - EDGE_GAP;
  const viewportTop = window.scrollY + EDGE_GAP;
  const viewportBottom = window.scrollY + window.innerHeight - EDGE_GAP;
  const candidates: PinCandidate[] = [
    {
      anchor: { x: rect.x + rect.width + PIN_GAP, y: rect.y + rect.height / 2 },
      placement: "right"
    },
    {
      anchor: { x: rect.x - PIN_GAP, y: rect.y + rect.height / 2 },
      placement: "left"
    },
    {
      anchor: { x: rect.x + rect.width / 2, y: rect.y + rect.height + PIN_GAP },
      placement: "bottom"
    },
    {
      anchor: { x: rect.x + rect.width / 2, y: rect.y - PIN_GAP },
      placement: "top"
    }
  ];

  const visibleCandidate = candidates.find(({ anchor, placement }) => {
    const marker = getPinMarkerRect(anchor, placement);
    return (
      marker.x >= viewportLeft &&
      marker.x + marker.width <= viewportRight &&
      marker.y >= viewportTop &&
      marker.y + marker.height <= viewportBottom &&
      !markerRectOverlapsTarget(marker, rect)
    );
  });

  if (visibleCandidate) return visibleCandidate;

  return {
    anchor: {
      x: rect.x + rect.width + PIN_GAP,
      y: rect.y + rect.height / 2
    },
    placement: "right"
  };
}

function inferPinCandidateFromPoint(rect: HoverInspection["documentRect"], point: AnnotationPinAnchor): PinCandidate {
  const distances = [
    { placement: "right" as const, value: Math.abs(point.x - (rect.x + rect.width)) },
    { placement: "left" as const, value: Math.abs(point.x - rect.x) },
    { placement: "bottom" as const, value: Math.abs(point.y - (rect.y + rect.height)) },
    { placement: "top" as const, value: Math.abs(point.y - rect.y) }
  ].sort((a, b) => a.value - b.value);
  return { anchor: point, placement: distances[0].placement };
}

function getPinCardTopOffset(markerTop: number, viewportTop: number, viewportBottom: number): number {
  const preferredCardTop = markerTop - PIN_CARD_ESTIMATED_HEIGHT / 2;
  const clampedCardTop = clamp(preferredCardTop, viewportTop, Math.max(viewportTop, viewportBottom - PIN_CARD_ESTIMATED_HEIGHT));
  return clampedCardTop - markerTop;
}

function getPinMarkerRect(anchor: AnnotationPinAnchor, placement: PinPlacement): HoverInspection["documentRect"] {
  if (placement === "left") {
    return { x: anchor.x - PIN_COLLAPSED_WIDTH, y: anchor.y - PIN_COLLAPSED_HEIGHT / 2, width: PIN_COLLAPSED_WIDTH, height: PIN_COLLAPSED_HEIGHT };
  }
  if (placement === "bottom") {
    return { x: anchor.x - PIN_COLLAPSED_WIDTH / 2, y: anchor.y, width: PIN_COLLAPSED_WIDTH, height: PIN_COLLAPSED_HEIGHT };
  }
  if (placement === "top") {
    return { x: anchor.x - PIN_COLLAPSED_WIDTH / 2, y: anchor.y - PIN_COLLAPSED_HEIGHT, width: PIN_COLLAPSED_WIDTH, height: PIN_COLLAPSED_HEIGHT };
  }
  return { x: anchor.x, y: anchor.y - PIN_COLLAPSED_HEIGHT / 2, width: PIN_COLLAPSED_WIDTH, height: PIN_COLLAPSED_HEIGHT };
}

function markerRectOverlapsTarget(marker: HoverInspection["documentRect"], target: HoverInspection["documentRect"]): boolean {
  return !(
    marker.x >= target.x + target.width ||
    marker.x + marker.width <= target.x ||
    marker.y >= target.y + target.height ||
    marker.y + marker.height <= target.y
  );
}

function FocusedAnnotationOverlay({ annotation, subtle = false }: { annotation?: DomAnnotation; subtle?: boolean }) {
  if (!annotation) return null;
  const palette = getPinPalette(annotation.status);
  const rect = getAnnotationDocumentRect(annotation);
  const borderRadius = getAnnotationBorderRadius(annotation);
  return (
    <div
      className={`dom-ai-focused-annotation ${subtle ? "dom-ai-focused-annotation-subtle" : ""}`}
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        borderRadius,
        "--dom-ai-focus-color": palette.bg,
        "--dom-ai-focus-glow": palette.ring
      } as React.CSSProperties}
    />
  );
}

function Composer({
  state,
  onCancel,
  onSaved,
  onDeleted
}: {
  state: ComposerState;
  onCancel: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [comment, setComment] = useState(state.editingAnnotation?.feedback.comment ?? "");
  const [severity, setSeverity] = useState<FeedbackSeverity>(state.editingAnnotation?.feedback.severity ?? "important");
  const [colorMode, setColorMode] = useState<ColorMode>("rgb");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const canSave = comment.trim().length > 0;
  const position = getComposerPosition(state.inspection.documentRect);

  const save = useCallback(async () => {
    if (!canSave) return;

    if (state.editingAnnotation) {
      await updateAnnotationFeedback(state.editingAnnotation.id, {
        comment: comment.trim(),
        severity
      });
      onSaved();
      return;
    }

    const now = new Date().toISOString();
    const newId = crypto.randomUUID();
    await saveAnnotation({
      ...state.draft,
      id: newId,
      createdAt: now,
      updatedAt: now,
      feedback: {
        comment: comment.trim(),
        expected: undefined,
        type: "style",
        severity
      },
      status: "pending"
    });
    onSaved();
    // Capture "before" screenshot in background (non-blocking)
    void captureAnnotationScreenshot(newId, state.inspection.viewportRect);
  }, [canSave, comment, onSaved, severity, state.draft, state.editingAnnotation]);

  const remove = useCallback(async () => {
    if (!state.editingAnnotation) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    await deleteAnnotation(state.editingAnnotation.id);
    onDeleted();
  }, [confirmDelete, onDeleted, state.editingAnnotation]);

  useEffect(() => {
    setComment(state.editingAnnotation?.feedback.comment ?? "");
    setSeverity(state.editingAnnotation?.feedback.severity ?? "important");
    setConfirmDelete(false);
  }, [state.editingAnnotation?.id]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
        return;
      }

      if (isSaveKeyboardShortcut(event)) {
        event.preventDefault();
        event.stopPropagation();
        void save();
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onCancel, save]);

  return (
    <section
      className="dom-ai-composer dom-ai-interactive absolute w-[430px] rounded-2xl bg-white p-2 text-ink-900 shadow-panel ring-1 ring-black/5"
      data-anchor-ready="true"
      style={{
        left: position.left,
        top: position.top
      }}
    >
      <div className="rounded-xl bg-ink-50 px-3 py-2.5 shadow-[inset_0_0_0_1px_rgba(17,24,39,0.06)]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-600 text-white shadow-soft">
                <MessageCircle size={15} strokeWidth={2.4} />
              </span>
              <div className="text-sm font-bold">{state.editingAnnotation ? "编辑评论" : "添加评论"}</div>
            </div>
            <div className="mt-1 max-w-[330px] truncate font-mono text-[11px] text-ink-500">{state.draft.selector}</div>
          </div>
          <button
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-500 transition-colors duration-150 hover:bg-white hover:text-ink-900 active:scale-[0.96]"
            aria-label="关闭编辑框"
            onClick={onCancel}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <ElementDetails inspection={state.inspection} colorMode={colorMode} onColorModeChange={setColorMode} />

      <div className="mt-3 flex items-center justify-between gap-2">
        <label className="text-xs font-bold text-ink-700" htmlFor="dom-ai-comment">
          评论内容
        </label>
        <span className="text-[11px] font-semibold text-ink-400">⌘/Ctrl + Enter 保存，Enter 换行，Esc 取消</span>
      </div>
      <textarea
        id="dom-ai-comment"
        className="mt-1 min-h-[118px] w-full resize-none rounded-xl bg-white px-3 py-2.5 text-sm leading-5 text-ink-900 shadow-[inset_0_0_0_1px_rgba(17,24,39,0.1)] outline-none transition-shadow duration-150 placeholder:text-ink-500 focus:shadow-[inset_0_0_0_2px_rgba(15,159,120,0.45)]"
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (!isSaveKeyboardShortcut(event)) return;
          event.preventDefault();
          event.stopPropagation();
          void save();
        }}
        placeholder="例如：移动端 CTA 按钮距离标题太近。"
        autoFocus
      />

      <div className="mt-2.5">
        <PriorityControl value={severity} onChange={setSeverity} />
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        {state.editingAnnotation ? (
          <button
            className={`inline-flex h-[34px] items-center justify-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition-[background-color,transform] duration-150 active:scale-[0.96] ${
              confirmDelete ? "bg-red-50 text-red-700 shadow-[inset_0_0_0_1px_rgba(185,28,28,0.18)] hover:bg-red-100" : "bg-white text-ink-500 shadow-[inset_0_0_0_1px_rgba(17,24,39,0.12)] hover:bg-ink-50 hover:text-red-700"
            }`}
            onClick={() => void remove()}
          >
            <Trash2 size={14} />
            {confirmDelete ? "确认删除" : "删除"}
          </button>
        ) : <span />}
        <div className="flex justify-end gap-2">
          <button
            className="inline-flex h-[34px] items-center justify-center rounded-lg bg-white px-2.5 text-xs font-semibold text-ink-800 shadow-[inset_0_0_0_1px_rgba(17,24,39,0.12)] transition-[background-color,transform] duration-150 hover:bg-ink-50 active:scale-[0.96]"
            onClick={onCancel}
          >
            取消
          </button>
          <button
            className="inline-flex h-[34px] items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-2.5 text-xs font-semibold text-white shadow-soft transition-[background-color,transform] duration-150 hover:bg-brand-700 active:scale-[0.96] disabled:cursor-not-allowed disabled:bg-ink-200 disabled:text-ink-500"
            disabled={!canSave}
            onClick={() => void save()}
            title="Cmd/Ctrl + Enter"
          >
            保存
          </button>
        </div>
      </div>
    </section>
  );
}

function getAnnotationTargetLabel(annotation: DomAnnotation): string {
  const id = annotation.element.id ? `#${annotation.element.id}` : "";
  const className = annotation.element.className
    ? `.${annotation.element.className.trim().split(/\s+/).slice(0, 2).join(".")}`
    : "";
  return `${annotation.element.tag}${id}${className}`;
}

function MeasureLayer({
  anchor,
  hover,
  pinnedMeasurements
}: {
  anchor: HoverInspection | null;
  hover: HoverInspection | null;
  pinnedMeasurements: PinnedMeasurement[];
}) {
  const liveAnchor = anchor ? getLiveInspection(anchor) : null;
  const liveHover = hover ? getLiveInspection(hover) : null;
  const measurements = liveAnchor && liveHover && !isSameInspectionTarget(liveAnchor, liveHover)
    ? getElementDistanceLines(liveAnchor.documentRect, liveHover.documentRect)
    : [];

  return (
    <>
      {pinnedMeasurements.map((item) => (
        <MeasurementPair key={item.key} pair={item} />
      ))}
      {liveAnchor ? (
        <div
          className="dom-ai-highlight dom-ai-measure-anchor"
          style={getHighlightStyle(liveAnchor)}
        />
      ) : null}
      {liveHover ? (
        <>
          <div
            className="dom-ai-highlight"
            style={getHighlightStyle(liveHover)}
          />
          <div
            className="dom-ai-hover-label"
            style={getHoverLabelStyle(liveHover, liveAnchor ? "测量目标" : "测量起点", liveHover.label)}
          >
            <span>{liveAnchor ? "测量目标" : "测量起点"}</span>
            <b>{liveHover.label}</b>
          </div>
        </>
      ) : null}
      {measurements.length ? <MeasurementOverlay measurements={measurements} idPrefix="preview" /> : null}
      {liveAnchor && liveHover && !measurements.length && !isSameInspectionTarget(liveAnchor, liveHover) ? (
        <div
          className="dom-ai-measure-label"
          style={{
            left: (liveAnchor.documentRect.x + liveHover.documentRect.x + liveHover.documentRect.width) / 2,
            top: (liveAnchor.documentRect.y + liveHover.documentRect.y + liveHover.documentRect.height) / 2
          }}
        >
          0px
        </div>
      ) : null}
    </>
  );
}

function MeasurementPair({ pair }: { pair: PinnedMeasurement }) {
  const from = getLiveInspection(pair.from);
  const to = getLiveInspection(pair.to);
  const measurements = getElementDistanceLines(from.documentRect, to.documentRect);

  return (
    <div
      className="dom-ai-measure-pinned-group"
      style={{ "--dom-ai-measure-color": pair.color } as React.CSSProperties}
    >
      <div
        className="dom-ai-highlight dom-ai-measure-pinned-box"
        style={getHighlightStyle(from)}
      />
      <div
        className="dom-ai-highlight dom-ai-measure-pinned-box"
        style={getHighlightStyle(to)}
      />
      {measurements.length ? <MeasurementOverlay measurements={measurements} idPrefix={pair.key} /> : (
        <div
          className="dom-ai-measure-label"
          style={{
            left: (from.documentRect.x + to.documentRect.x + to.documentRect.width) / 2,
            top: (from.documentRect.y + to.documentRect.y + to.documentRect.height) / 2
          }}
        >
          0px
        </div>
      )}
    </div>
  );
}

function ElementDetails({
  inspection,
  colorMode,
  onColorModeChange
}: {
  inspection: HoverInspection;
  colorMode: ColorMode;
  onColorModeChange: (mode: ColorMode) => void;
}) {
  const size = `${Math.round(inspection.documentRect.width)} x ${Math.round(inspection.documentRect.height)}`;
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copyMetric = useCallback(async (label: string, value: string) => {
    try {
      await writeClipboardText(`${label}: ${value || "-"}`);
      setCopiedKey(label);
      window.setTimeout(() => setCopiedKey(null), 900);
    } catch {
      setCopiedKey(null);
    }
  }, []);

  return (
    <div className="mt-2 rounded-xl bg-white p-2 shadow-[inset_0_0_0_1px_rgba(17,24,39,0.08)]">
      <div className="grid grid-cols-3 gap-1.5">
        <LightMetric icon={<Ruler size={13} />} label="尺寸" value={size} copied={copiedKey === "尺寸"} onCopy={copyMetric} />
        <LightMetric label="Display" value={inspection.display} copied={copiedKey === "Display"} onCopy={copyMetric} />
        <LightMetric label="Position" value={inspection.position} copied={copiedKey === "Position"} onCopy={copyMetric} />
        <LightMetric label="Z-index" value={inspection.zIndex} copied={copiedKey === "Z-index"} onCopy={copyMetric} />
        <LightMetric icon={<Type size={13} />} label="字体" value={`${inspection.fontSize} / ${inspection.lineHeight}`} copied={copiedKey === "字体"} onCopy={copyMetric} />
        <LightMetric label="字重" value={inspection.fontWeight} copied={copiedKey === "字重"} onCopy={copyMetric} />
        <LightMetric label="圆角" value={inspection.borderRadius} copied={copiedKey === "圆角"} onCopy={copyMetric} />
        <LightMetric label="透明度" value={inspection.opacity} copied={copiedKey === "透明度"} onCopy={copyMetric} />
        <LightMetric label="Margin" value={inspection.margin} copied={copiedKey === "Margin"} onCopy={copyMetric} />
        <LightMetric label="Padding" value={inspection.padding} copied={copiedKey === "Padding"} onCopy={copyMetric} />
        <LightMetric label="Gap" value={inspection.gap} copied={copiedKey === "Gap"} onCopy={copyMetric} />
        <LightMetric label="字体名称" value={inspection.fontFamily} copied={copiedKey === "字体名称"} onCopy={copyMetric} />
      </div>
      <div className="mt-1.5 grid grid-cols-3 gap-1 rounded-lg bg-ink-100 p-1">
        {(["rgb", "hex", "hsl"] as ColorMode[]).map((mode) => (
          <button
            key={mode}
            className={`h-7 rounded-md text-[10px] font-extrabold uppercase transition-[background-color,color,box-shadow,transform] duration-150 active:scale-[0.96] ${
              colorMode === mode
                ? "bg-white text-ink-900 shadow-[0_1px_2px_rgba(17,24,39,0.12)]"
                : "text-ink-500 hover:bg-white/60 hover:text-ink-800"
            }`}
            type="button"
            onClick={() => onColorModeChange(mode)}
          >
            {mode}
          </button>
        ))}
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
        <LightColorMetric label="文字" value={inspection.color} mode={colorMode} copied={copiedKey === "文字"} onCopy={copyMetric} />
        <LightColorMetric label="背景" value={inspection.backgroundColor} mode={colorMode} copied={copiedKey === "背景"} onCopy={copyMetric} />
      </div>
    </div>
  );
}

function LightMetric({
  icon,
  label,
  value,
  copied,
  onCopy
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  copied: boolean;
  onCopy: (label: string, value: string) => void;
}) {
  return (
    <button
      className="rounded-lg bg-ink-50 px-2 py-1.5 text-left transition-[background-color,box-shadow,transform] duration-150 hover:bg-white hover:shadow-[inset_0_0_0_1px_rgba(15,159,120,0.26)] active:scale-[0.96]"
      type="button"
      title={`复制 ${label}`}
      onClick={() => onCopy(label, value)}
    >
      <div className="flex items-center gap-1 text-[10px] font-bold uppercase text-ink-400">
        {icon}
        <span>{copied ? "已复制" : label}</span>
      </div>
      <div className="mt-0.5 truncate font-mono text-[11px] font-bold tabular-nums text-ink-800">{value || "-"}</div>
    </button>
  );
}

function LightColorMetric({
  label,
  value,
  mode,
  copied,
  onCopy
}: {
  label: string;
  value: string;
  mode: ColorMode;
  copied: boolean;
  onCopy: (label: string, value: string) => void;
}) {
  const displayValue = formatColor(value, mode);

  return (
    <button
      className="rounded-lg bg-ink-50 px-2 py-1.5 text-left transition-[background-color,box-shadow,transform] duration-150 hover:bg-white hover:shadow-[inset_0_0_0_1px_rgba(15,159,120,0.26)] active:scale-[0.96]"
      type="button"
      title={`复制 ${label}`}
      onClick={() => onCopy(label, displayValue)}
    >
      <div className="text-[10px] font-bold uppercase text-ink-400">{copied ? "已复制" : label}</div>
      <div className="mt-0.5 flex items-center gap-1.5">
        <span className="h-3.5 w-3.5 shrink-0 rounded-full shadow-[0_0_0_1px_rgba(17,24,39,0.16)]" style={{ backgroundColor: value }} />
        <span className="truncate font-mono text-[11px] font-bold text-ink-800">{displayValue}</span>
      </div>
    </button>
  );
}

function MeasurementOverlay({ measurements, idPrefix }: { measurements: MeasurementLine[]; idPrefix: string }) {
  return (
    <>
      {measurements.map((measurement) => (
        <div key={`${idPrefix}-${measurement.key}`}>
          <div
            className={`dom-ai-measure-line dom-ai-measure-line-${measurement.orientation}`}
            style={{
              left: measurement.x,
              top: measurement.y,
              width: measurement.orientation === "horizontal" ? measurement.length : undefined,
              height: measurement.orientation === "vertical" ? measurement.length : undefined
            }}
          />
          <div className="dom-ai-measure-label" style={{ left: measurement.labelX, top: measurement.labelY }}>
            {measurement.label}
          </div>
        </div>
      ))}
    </>
  );
}

function PriorityControl({
  value,
  onChange
}: {
  value: FeedbackSeverity;
  onChange: (value: FeedbackSeverity) => void;
}) {
  const options: FeedbackSeverity[] = ["important", "blocking", "suggestion"];

  return (
    <div>
      <div className="text-[11px] font-bold text-ink-700">优先级</div>
      <div className="mt-1 grid grid-cols-3 gap-1 rounded-lg bg-ink-100 p-1">
        {options.map((option) => (
          <button
            key={option}
            className={`h-[30px] rounded-md text-[11px] font-bold transition-[background-color,color,box-shadow,transform] duration-150 active:scale-[0.96] ${
              value === option
                ? "bg-white text-ink-900 shadow-[0_1px_2px_rgba(17,24,39,0.12)]"
                : "text-ink-500 hover:bg-white/60 hover:text-ink-800"
            }`}
            onClick={() => onChange(option)}
            type="button"
          >
            {severityLabels[option]}
          </button>
        ))}
      </div>
    </div>
  );
}

function getTargetElement(event: MouseEvent): Element | null {
  const path = event.composedPath();
  return path.find((node): node is Element => node instanceof Element && !isInjectedElement(node)) ?? null;
}

function isInjectedElement(element: Element): boolean {
  if (element.id === ROOT_ID) return true;
  if (element.closest?.(`#${ROOT_ID}`)) return true;
  const className = typeof (element as HTMLElement).className === "string" ? (element as HTMLElement).className : "";
  if (className.split(/\s+/).some((name) => name.startsWith("dom-ai-"))) return true;
  const root = element.getRootNode();
  return root instanceof ShadowRoot && root.host instanceof Element && root.host.id === ROOT_ID;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select";
}

function isEditableEvent(event: KeyboardEvent): boolean {
  const path = event.composedPath();
  return path.some((node) => isEditableTarget(node));
}

function getElementLabel(element: Element): string {
  const id = (element as HTMLElement).id ? `#${(element as HTMLElement).id}` : "";
  const className = typeof (element as HTMLElement).className === "string"
    ? `.${(element as HTMLElement).className.trim().split(/\s+/).slice(0, 2).join(".")}`
    : "";
  return `${element.tagName.toLowerCase()}${id}${className}`;
}

function isSaveKeyboardShortcut(event: KeyboardEvent | React.KeyboardEvent): boolean {
  return (event.key === "Enter" || event.code === "Enter" || event.code === "NumpadEnter") && (event.metaKey || event.ctrlKey);
}

function getElementInspection(element: Element): HoverInspection {
  const rect = element.getBoundingClientRect();
  const styles = window.getComputedStyle(element);
  const documentRect = {
    x: rect.left + window.scrollX,
    y: rect.top + window.scrollY,
    width: rect.width,
    height: rect.height
  };

  return {
    key: getElementMeasurementKey(element, documentRect),
    label: getElementLabel(element),
    element,
    viewportRect: rect,
    documentRect,
    fontSize: styles.fontSize,
    lineHeight: styles.lineHeight,
    fontWeight: styles.fontWeight,
    fontFamily: styles.fontFamily,
    color: styles.color,
    backgroundColor: styles.backgroundColor,
    display: styles.display,
    position: styles.position,
    opacity: styles.opacity,
    zIndex: styles.zIndex,
    gap: styles.gap,
    margin: getBoxValue(styles, "margin"),
    padding: getBoxValue(styles, "padding"),
    borderRadius: styles.borderRadius
  };
}

function getLiveInspection(inspection: HoverInspection): HoverInspection {
  if (!inspection.element?.isConnected || isInjectedElement(inspection.element)) return inspection;
  return getElementInspection(inspection.element);
}

function getHighlightStyle(inspection: HoverInspection): React.CSSProperties {
  return {
    left: inspection.documentRect.x,
    top: inspection.documentRect.y,
    width: inspection.documentRect.width,
    height: inspection.documentRect.height,
    borderRadius: normalizeBorderRadius(inspection.borderRadius)
  };
}

function getHoverLabelStyle(inspection: HoverInspection, label: string, badge: string): React.CSSProperties {
  const rect = inspection.documentRect;
  const labelWidth = estimateHoverLabelWidth(label, badge);
  const viewportLeft = window.scrollX + HOVER_LABEL_VIEWPORT_GAP;
  const viewportRight = window.scrollX + window.innerWidth - HOVER_LABEL_VIEWPORT_GAP;
  const viewportTop = window.scrollY + HOVER_LABEL_VIEWPORT_GAP;
  const viewportBottom = window.scrollY + window.innerHeight - HOVER_LABEL_VIEWPORT_GAP;
  const canFitAbove = rect.y - HOVER_LABEL_GAP - HOVER_LABEL_HEIGHT >= viewportTop;
  const canFitBelow = rect.y + rect.height + HOVER_LABEL_GAP + HOVER_LABEL_HEIGHT <= viewportBottom;
  const canFitRight = rect.x + rect.width + HOVER_LABEL_GAP + labelWidth <= viewportRight;
  const canFitLeft = rect.x - HOVER_LABEL_GAP - labelWidth >= viewportLeft;

  if (canFitAbove) {
    return {
      left: clamp(rect.x, viewportLeft, viewportRight - labelWidth),
      top: rect.y - HOVER_LABEL_GAP - HOVER_LABEL_HEIGHT,
      maxWidth: Math.min(HOVER_LABEL_MAX_WIDTH, viewportRight - viewportLeft)
    };
  }

  if (canFitBelow) {
    return {
      left: clamp(rect.x, viewportLeft, viewportRight - labelWidth),
      top: rect.y + rect.height + HOVER_LABEL_GAP,
      maxWidth: Math.min(HOVER_LABEL_MAX_WIDTH, viewportRight - viewportLeft)
    };
  }

  if (canFitRight) {
    return {
      left: rect.x + rect.width + HOVER_LABEL_GAP,
      top: clamp(rect.y + rect.height / 2 - HOVER_LABEL_HEIGHT / 2, viewportTop, viewportBottom - HOVER_LABEL_HEIGHT),
      maxWidth: Math.min(HOVER_LABEL_MAX_WIDTH, viewportRight - viewportLeft)
    };
  }

  if (canFitLeft) {
    return {
      left: rect.x - HOVER_LABEL_GAP - labelWidth,
      top: clamp(rect.y + rect.height / 2 - HOVER_LABEL_HEIGHT / 2, viewportTop, viewportBottom - HOVER_LABEL_HEIGHT),
      maxWidth: Math.min(HOVER_LABEL_MAX_WIDTH, viewportRight - viewportLeft)
    };
  }

  return {
    left: clamp(rect.x, viewportLeft, Math.max(viewportLeft, viewportRight - labelWidth)),
    top: clamp(rect.y - HOVER_LABEL_GAP - HOVER_LABEL_HEIGHT, viewportTop, Math.max(viewportTop, viewportBottom - HOVER_LABEL_HEIGHT)),
    maxWidth: Math.min(HOVER_LABEL_MAX_WIDTH, viewportRight - viewportLeft)
  };
}

function estimateHoverLabelWidth(label: string, badge: string): number {
  return Math.min(HOVER_LABEL_MAX_WIDTH, Math.max(96, label.length * 7 + badge.length * 7 + 36));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function normalizeBorderRadius(borderRadius: string | undefined): string | undefined {
  const value = borderRadius?.trim();
  return value && value !== "-" ? value : undefined;
}

function isSameInspectionTarget(a: HoverInspection, b: HoverInspection): boolean {
  if (a.element && b.element) return a.element === b.element;
  return a.key === b.key;
}

function getAnnotationDraft(annotation: DomAnnotation): AnnotationDraft {
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, feedback: _feedback, status: _status, ...draft } = annotation;
  return draft;
}

function getInspectionForAnnotation(annotation: DomAnnotation): HoverInspection {
  const liveElement = document.querySelector(annotation.selector);
  if (liveElement) return getElementInspection(liveElement);

  const documentRect = getAnnotationDocumentRect(annotation);

  return {
    key: `annotation-${annotation.id}`,
    label: getAnnotationTargetLabel(annotation),
    viewportRect: {
      x: annotation.rect.x,
      y: annotation.rect.y,
      width: annotation.rect.width,
      height: annotation.rect.height
    },
    documentRect,
    fontSize: annotation.computedStyles.fontSize ?? "-",
    lineHeight: annotation.computedStyles.lineHeight ?? "-",
    fontWeight: annotation.computedStyles.fontWeight ?? "-",
    fontFamily: annotation.computedStyles.fontFamily ?? "-",
    color: annotation.computedStyles.color ?? "rgba(0, 0, 0, 0)",
    backgroundColor: annotation.computedStyles.backgroundColor ?? "rgba(0, 0, 0, 0)",
    display: annotation.computedStyles.display ?? "-",
    position: annotation.computedStyles.position ?? "-",
    opacity: annotation.computedStyles.opacity ?? "-",
    zIndex: annotation.computedStyles.zIndex ?? "-",
    gap: annotation.computedStyles.gap ?? "-",
    margin: getComputedBoxSnapshot(annotation.computedStyles, "margin"),
    padding: getComputedBoxSnapshot(annotation.computedStyles, "padding"),
    borderRadius: annotation.computedStyles.borderRadius ?? "-"
  };
}

function getAnnotationDocumentRect(annotation: DomAnnotation): HoverInspection["documentRect"] {
  const liveElement = document.querySelector(annotation.selector);
  if (liveElement) {
    const rect = liveElement.getBoundingClientRect();
    return {
      x: rect.left + window.scrollX,
      y: rect.top + window.scrollY,
      width: rect.width,
      height: rect.height
    };
  }

  return {
    x: annotation.rect.x + annotation.rect.scrollX,
    y: annotation.rect.y + annotation.rect.scrollY,
    width: annotation.rect.width,
    height: annotation.rect.height
  };
}

function getAnnotationBorderRadius(annotation: DomAnnotation): string | undefined {
  const liveElement = document.querySelector(annotation.selector);
  if (liveElement) return normalizeBorderRadius(window.getComputedStyle(liveElement).borderRadius);
  return normalizeBorderRadius(annotation.computedStyles.borderRadius);
}

function getComputedBoxSnapshot(styles: Record<string, string>, prefix: "margin" | "padding"): string {
  const shorthand = styles[prefix];
  if (shorthand) return shorthand;
  return [
    styles[`${prefix}Top`],
    styles[`${prefix}Right`],
    styles[`${prefix}Bottom`],
    styles[`${prefix}Left`]
  ].filter(Boolean).join(" ") || "-";
}

function getElementMeasurementKey(element: Element, rect: HoverInspection["documentRect"]): string {
  return [
    getElementLabel(element),
    Math.round(rect.x),
    Math.round(rect.y),
    Math.round(rect.width),
    Math.round(rect.height)
  ].join("|");
}

function getMeasurementPairKey(first: HoverInspection, second: HoverInspection): string {
  return [getInspectionIdentity(first), getInspectionIdentity(second)].sort().join("::");
}

function getInspectionIdentity(inspection: HoverInspection): string {
  return inspection.element ? getCssSelector(inspection.element) : inspection.key;
}

function getElementDistanceLines(from: HoverInspection["documentRect"], to: HoverInspection["documentRect"]): MeasurementLine[] {
  if (containsRect(from, to)) return getContainedDistanceLines(to, from);
  if (containsRect(to, from)) return getContainedDistanceLines(from, to);

  const lines: MeasurementLine[] = [];
  const fromRight = from.x + from.width;
  const toRight = to.x + to.width;
  const fromBottom = from.y + from.height;
  const toBottom = to.y + to.height;
  const verticalGuideY = getOverlapCenter(from.y, fromBottom, to.y, toBottom) ?? midpoint(from.y, fromBottom, to.y, toBottom);
  const horizontalGuideX = getOverlapCenter(from.x, fromRight, to.x, toRight) ?? midpoint(from.x, fromRight, to.x, toRight);

  if (fromRight <= to.x) {
    lines.push(createHorizontalMeasure("between-horizontal", fromRight, verticalGuideY, to.x - fromRight));
  } else if (toRight <= from.x) {
    lines.push(createHorizontalMeasure("between-horizontal", toRight, verticalGuideY, from.x - toRight));
  }

  if (fromBottom <= to.y) {
    lines.push(createVerticalMeasure("between-vertical", horizontalGuideX, fromBottom, to.y - fromBottom));
  } else if (toBottom <= from.y) {
    lines.push(createVerticalMeasure("between-vertical", horizontalGuideX, toBottom, from.y - toBottom));
  }

  return lines.filter((line) => line.length > 0);
}

function getContainedDistanceLines(
  inner: HoverInspection["documentRect"],
  outer: HoverInspection["documentRect"]
): MeasurementLine[] {
  const innerRight = inner.x + inner.width;
  const outerRight = outer.x + outer.width;
  const innerBottom = inner.y + inner.height;
  const outerBottom = outer.y + outer.height;
  const centerX = inner.x + inner.width / 2;
  const centerY = inner.y + inner.height / 2;

  return [
    createVerticalMeasure("inside-top", centerX, outer.y, Math.max(0, inner.y - outer.y)),
    createHorizontalMeasure("inside-right", innerRight, centerY, Math.max(0, outerRight - innerRight)),
    createVerticalMeasure("inside-bottom", centerX, innerBottom, Math.max(0, outerBottom - innerBottom)),
    createHorizontalMeasure("inside-left", outer.x, centerY, Math.max(0, inner.x - outer.x))
  ];
}

function containsRect(outer: HoverInspection["documentRect"], inner: HoverInspection["documentRect"]): boolean {
  const outerRight = outer.x + outer.width;
  const outerBottom = outer.y + outer.height;
  const innerRight = inner.x + inner.width;
  const innerBottom = inner.y + inner.height;
  return outer.x <= inner.x && outer.y <= inner.y && outerRight >= innerRight && outerBottom >= innerBottom;
}

function createHorizontalMeasure(key: string, x: number, y: number, length: number): MeasurementLine {
  return {
    key,
    orientation: "horizontal",
    x,
    y,
    length,
    label: compactPxNumber(length),
    labelX: x + length / 2,
    labelY: y
  };
}

function createVerticalMeasure(key: string, x: number, y: number, length: number): MeasurementLine {
  return {
    key,
    orientation: "vertical",
    x,
    y,
    length,
    label: compactPxNumber(length),
    labelX: x,
    labelY: y + length / 2
  };
}

function getOverlapCenter(aStart: number, aEnd: number, bStart: number, bEnd: number): number | null {
  const start = Math.max(aStart, bStart);
  const end = Math.min(aEnd, bEnd);
  return start < end ? start + (end - start) / 2 : null;
}

function midpoint(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return (aStart + aEnd + bStart + bEnd) / 4;
}

function getBoxValue(styles: CSSStyleDeclaration, prefix: "margin" | "padding"): string {
  const top = compactPx(styles.getPropertyValue(`${prefix}-top`));
  const right = compactPx(styles.getPropertyValue(`${prefix}-right`));
  const bottom = compactPx(styles.getPropertyValue(`${prefix}-bottom`));
  const left = compactPx(styles.getPropertyValue(`${prefix}-left`));
  return `${top} ${right} ${bottom} ${left}`;
}

function compactPx(value: string): string {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return value;
  return `${Math.round(parsed * 10) / 10}px`;
}

function compactPxNumber(value: number): string {
  if (!Number.isFinite(value)) return "-";
  return `${Math.round(value * 10) / 10}px`;
}

function formatColor(value: string, mode: ColorMode): string {
  const color = parseCssRgb(value);
  if (!color) return value;
  if (mode === "rgb") return color.a < 1 ? `rgba(${color.r}, ${color.g}, ${color.b}, ${roundColor(color.a)})` : `rgb(${color.r}, ${color.g}, ${color.b})`;
  if (mode === "hex") return rgbToHex(color);
  return rgbToHsl(color);
}

function parseCssRgb(value: string): { r: number; g: number; b: number; a: number } | null {
  const match = value.match(/^rgba?\((.+)\)$/i);
  if (!match) return null;
  const parts = match[1].split(/,\s*/).map((part) => part.trim());
  if (parts.length < 3) return null;
  const r = Number.parseFloat(parts[0]);
  const g = Number.parseFloat(parts[1]);
  const b = Number.parseFloat(parts[2]);
  const a = parts[3] === undefined ? 1 : Number.parseFloat(parts[3]);
  if (![r, g, b, a].every(Number.isFinite)) return null;
  return {
    r: clampColor(r),
    g: clampColor(g),
    b: clampColor(b),
    a: Math.min(1, Math.max(0, a))
  };
}

function rgbToHex(color: { r: number; g: number; b: number; a: number }): string {
  const hex = [color.r, color.g, color.b].map((channel) => channel.toString(16).padStart(2, "0")).join("");
  if (color.a >= 1) return `#${hex}`;
  return `#${hex}${Math.round(color.a * 255).toString(16).padStart(2, "0")}`;
}

function rgbToHsl(color: { r: number; g: number; b: number; a: number }): string {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  let hue = 0;
  let saturation = 0;

  if (max !== min) {
    const delta = max - min;
    saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    if (max === r) hue = (g - b) / delta + (g < b ? 6 : 0);
    if (max === g) hue = (b - r) / delta + 2;
    if (max === b) hue = (r - g) / delta + 4;
    hue *= 60;
  }

  const hsl = `${Math.round(hue)} ${Math.round(saturation * 100)}% ${Math.round(lightness * 100)}%`;
  return color.a < 1 ? `hsl(${hsl} / ${roundColor(color.a)})` : `hsl(${hsl})`;
}

function clampColor(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function roundColor(value: number): number {
  return Math.round(value * 100) / 100;
}

function getDocumentSize(): DocumentSize {
  const body = document.body;
  const element = document.documentElement;
  return {
    width: Math.max(body.scrollWidth, body.offsetWidth, element.clientWidth, element.scrollWidth, element.offsetWidth),
    height: Math.max(body.scrollHeight, body.offsetHeight, element.clientHeight, element.scrollHeight, element.offsetHeight)
  };
}

function clampWithinDocument(left: number, width: number): number {
  return Math.min(window.scrollX + window.innerWidth - width - 16, Math.max(window.scrollX + 16, left));
}

function getComposerPosition(rect: HoverInspection["documentRect"]): { left: number; top: number } {
  const viewportTop = window.scrollY + EDGE_GAP;
  const viewportBottom = window.scrollY + window.innerHeight - EDGE_GAP;
  const belowTop = rect.y + rect.height + 12;
  const aboveTop = rect.y - COMPOSER_ESTIMATED_HEIGHT - 12;
  const hasRoomBelow = viewportBottom - belowTop >= COMPOSER_MIN_VISIBLE_HEIGHT;
  const preferredTop = hasRoomBelow ? belowTop : aboveTop;

  return {
    left: clampWithinDocument(rect.x, COMPOSER_WIDTH),
    top: Math.max(viewportTop, Math.min(preferredTop, viewportBottom - COMPOSER_MIN_VISIBLE_HEIGHT))
  };
}

function focusAnnotation(id: string, annotations: DomAnnotation[]) {
  const annotation = annotations.find((item) => item.id === id);
  if (!annotation) return;
  const rect = getAnnotationDocumentRect(annotation);
  const maxTop = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const targetTop = Math.min(maxTop, Math.max(0, rect.y - 120));
  window.scrollTo({
    top: targetTop,
    left: 0,
    behavior: "smooth"
  });
}

async function captureAnnotationScreenshot(annotationId: string, viewportRect: { x: number; y: number; width: number; height: number }) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "DOM_AI_CAPTURE_SCREENSHOT",
      rect: {
        x: Math.round(viewportRect.x),
        y: Math.round(viewportRect.y),
        width: Math.round(viewportRect.width),
        height: Math.round(viewportRect.height),
      },
    });
    if (!response?.success) return;
    const cropped = await cropScreenshot(response.data.dataUrl, viewportRect, window.devicePixelRatio);
    await updateAnnotationScreenshot(annotationId, "screenshot", {
      dataUrl: cropped,
      capturedAt: response.data.capturedAt,
      visibleRect: response.data.visibleRect,
    });
  } catch {
    // Screenshot is non-critical; silently skip
  }
}

function cropScreenshot(fullDataUrl: string, rect: { x: number; y: number; width: number; height: number }, dpr: number): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const sx = Math.round(rect.x * dpr);
      const sy = Math.round(rect.y * dpr);
      const sw = Math.min(Math.round(rect.width * dpr), img.width - sx);
      const sh = Math.min(Math.round(rect.height * dpr), img.height - sy);
      if (sw <= 0 || sh <= 0) { resolve(fullDataUrl); return; }
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => resolve(fullDataUrl);
    img.src = fullDataUrl;
  });
}

/** Show image preview overlay directly on documentElement (outside Shadow DOM to avoid contain:layout issues) */
function showImagePreviewOverlay(dataUrl: string) {
  // Remove existing overlay if any
  document.getElementById("dom-ai-img-preview")?.remove();

  let scale = 1;
  let translateX = 0;
  let translateY = 0;
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let panStartTX = 0;
  let panStartTY = 0;

  const overlay = document.createElement("div");
  overlay.id = "dom-ai-img-preview";
  overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.82);backdrop-filter:blur(6px);cursor:zoom-out;font-family:Inter,system-ui,-apple-system,sans-serif;";

  function close() { overlay.remove(); document.removeEventListener("keydown", onKey); }
  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") close();
    if (e.key === "0") { scale = 1; translateX = 0; translateY = 0; applyTransform(); }
  }
  document.addEventListener("keydown", onKey);
  overlay.addEventListener("click", close);

  const inner = document.createElement("div");
  inner.style.cssText = "position:relative;max-width:94vw;max-height:94vh;display:flex;flex-direction:column;align-items:center;gap:10px;cursor:default;";
  inner.addEventListener("click", (e) => e.stopPropagation());
  overlay.appendChild(inner);

  // Close button
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "✕";
  closeBtn.style.cssText = "position:absolute;top:0;right:-36px;width:28px;height:28px;border-radius:50%;border:none;background:rgba(255,255,255,0.12);color:rgba(255,255,255,0.8);font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.15s;";
  closeBtn.addEventListener("mouseenter", () => { closeBtn.style.background = "rgba(255,255,255,0.25)"; });
  closeBtn.addEventListener("mouseleave", () => { closeBtn.style.background = "rgba(255,255,255,0.12)"; });
  closeBtn.addEventListener("click", close);
  inner.appendChild(closeBtn);

  // Zoom indicator
  const zoomIndicator = document.createElement("div");
  zoomIndicator.style.cssText = "position:absolute;bottom:8px;right:-36px;font-size:10px;font-weight:600;color:rgba(255,255,255,0.5);text-align:center;width:28px;display:none;";
  inner.appendChild(zoomIndicator);

  // Content area
  const content = document.createElement("div");
  content.style.cssText = "overflow:hidden;border-radius:8px;";
  inner.appendChild(content);

  // Zoom transform wrapper
  let transformTarget: HTMLElement | null = null;

  function applyTransform() {
    if (transformTarget) {
      transformTarget.style.transform = `scale(${scale}) translate(${translateX}px, ${translateY}px)`;
      transformTarget.style.cursor = scale > 1 ? "grab" : "default";
    }
    if (scale > 1.01) {
      zoomIndicator.textContent = `${Math.round(scale * 100)}%`;
      zoomIndicator.style.display = "block";
    } else {
      zoomIndicator.style.display = "none";
    }
  }

  // Zoom via wheel
  content.addEventListener("wheel", (e: WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const newScale = Math.max(0.5, Math.min(8, scale * factor));
    if (newScale === scale) return;

    if (transformTarget) {
      const rect = transformTarget.getBoundingClientRect();
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;
      const ds = newScale / scale;
      translateX = cx - ds * (cx - translateX);
      translateY = cy - ds * (cy - translateY);
    }
    scale = newScale;
    applyTransform();
  }, { passive: false });

  // Pan via pointer
  content.addEventListener("pointerdown", (e: PointerEvent) => {
    if (scale <= 1) return;
    isPanning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panStartTX = translateX;
    panStartTY = translateY;
    if (transformTarget) transformTarget.style.cursor = "grabbing";
  });
  content.addEventListener("pointermove", (e: PointerEvent) => {
    if (!isPanning) return;
    translateX = panStartTX + (e.clientX - panStartX) / scale;
    translateY = panStartTY + (e.clientY - panStartY) / scale;
    applyTransform();
  });
  content.addEventListener("pointerup", () => {
    isPanning = false;
    if (transformTarget) transformTarget.style.cursor = scale > 1 ? "grab" : "default";
  });

  // Double-click to toggle 2x zoom
  content.addEventListener("dblclick", (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (scale > 1.01) {
      scale = 1; translateX = 0; translateY = 0;
    } else {
      scale = 2;
      if (transformTarget) {
        const rect = transformTarget.getBoundingClientRect();
        translateX = (rect.width / 2 - (e.clientX - rect.left)) / scale;
        translateY = (rect.height / 2 - (e.clientY - rect.top)) / scale;
      }
    }
    applyTransform();
  });

  // Render image
  const wrapper = document.createElement("div");
  wrapper.style.cssText = "transform-origin:center center;will-change:transform;";
  transformTarget = wrapper;

  const img = document.createElement("img");
  img.src = dataUrl;
  img.alt = "快照";
  img.draggable = false;
  img.style.cssText = "display:block;max-width:88vw;max-height:88vh;border-radius:6px;object-fit:contain;";
  wrapper.appendChild(img);
  content.appendChild(wrapper);

  document.documentElement.appendChild(overlay);
}

function mount() {
  if (document.getElementById(ROOT_ID)) return;
  if (isExcludedUrl(window.location.href)) return;
  const host = document.createElement("div");
  host.id = ROOT_ID;
  host.style.cssText = "position: fixed; inset: 0; width: 0; height: 0; overflow: visible; pointer-events: none; z-index: 2147483647;";
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = cssText;
  const app = document.createElement("div");
  shadow.append(style, app);
  document.documentElement.appendChild(host);
  createRoot(app).render(<App />);
}

mount();
