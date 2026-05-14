import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { MessageCircle, Ruler, Trash2, Type, X } from "lucide-react";
import cssText from "./content.css?inline";
import { createAnnotationDraft } from "./selector";
import { isExcludedUrl } from "../shared/excludedUrls";
import type { AnnotationDraft, AnnotationStatus, ContentMessage, DomAnnotation, FeedbackSeverity } from "../shared/types";
import { deleteAnnotation, getAnnotations, saveAnnotation, subscribeAnnotations, updateAnnotationFeedback, updateAnnotationStatus } from "../shared/storage";
import { getPinPalette, getStatusLabel, normalizeAnnotationStatus, severityLabels, statusLabels } from "../shared/status";

const ROOT_ID = "dom-ai-annotator-root";
const COMPOSER_WIDTH = 430;
const COMPOSER_ESTIMATED_HEIGHT = 560;
const COMPOSER_MIN_VISIBLE_HEIGHT = 360;
const EDGE_GAP = 16;
const PIN_COLLAPSED_WIDTH = 44;
const PIN_EXPANDED_WIDTH = 380;
const PIN_GAP = 8;
const SMALL_TARGET_MIN_WIDTH = 96;
const SMALL_TARGET_MIN_HEIGHT = 44;
const MEASURE_COLORS = ["#2563eb", "#dc2626", "#7c3aed", "#ea580c", "#0891b2", "#16a34a"];
const COMMENT_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    <path d="M9 25.25v-5.4A8.2 8.2 0 0 1 6 13.5C6 8.8 9.8 5 14.5 5h5C24.2 5 28 8.8 28 13.5S24.2 22 19.5 22h-6.7L9 25.25Z" fill="white" stroke="black" stroke-width="3.2" stroke-linejoin="round"/>
    <path d="M9 25.25v-5.4A8.2 8.2 0 0 1 6 13.5C6 8.8 9.8 5 14.5 5h5C24.2 5 28 8.8 28 13.5S24.2 22 19.5 22h-6.7L9 25.25Z" fill="white" stroke="white" stroke-width="1.2" stroke-linejoin="round"/>
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
  const focusTimerRef = useRef<number | null>(null);

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
    const listener = (message: ContentMessage) => {
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
      setComposer({
        draft: createAnnotationDraft(element, {
          x: event.clientX + window.scrollX,
          y: event.clientY + window.scrollY
        }),
        inspection: getElementInspection(element)
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
        if (anchor.key === inspection.key) return anchor;

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
              style={{
                left: hoverInspection.documentRect.x,
                top: hoverInspection.documentRect.y,
                width: hoverInspection.documentRect.width,
                height: hoverInspection.documentRect.height
              }}
            />
            <div
              className="dom-ai-hover-label"
              style={{
                left: hoverInspection.documentRect.x,
                top: Math.max(8, hoverInspection.documentRect.y - 34)
              }}
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
        onCancel={stopCurrentMode}
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
    "--dom-ai-pin-bg": palette.bg,
    "--dom-ai-pin-hover-bg": palette.hover,
    "--dom-ai-pin-badge-bg": palette.badge
  } as React.CSSProperties;

  return (
    <div
      className={`dom-ai-pin dom-ai-pin-${position.side} dom-ai-interactive ${focused ? "dom-ai-pin-focused" : ""} ${isDismissed ? "dom-ai-pin-dismissed" : ""}`}
      style={style}
      onMouseEnter={() => {
        setIsDismissed(false);
        onHoverChange(true);
      }}
      onMouseLeave={() => {
        setIsDismissed(false);
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
  onCancel
}: {
  isPicking: boolean;
  isMeasuring: boolean;
  onPick: () => void;
  onMeasure: () => void;
  onOpenPanel: () => void;
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

function getAnnotationPinPosition(annotation: DomAnnotation): { left: number; top: number; side: "right" | "left" } {
  const rect = getAnnotationDocumentRect(annotation);
  const shouldAvoidTarget = rect.width < SMALL_TARGET_MIN_WIDTH || rect.height < SMALL_TARGET_MIN_HEIGHT;
  const anchor = shouldAvoidTarget ? {
    x: rect.x + rect.width + PIN_GAP,
    y: rect.y + rect.height / 2
  } : annotation.pin ?? {
    x: rect.x + rect.width + PIN_GAP,
    y: rect.y + rect.height / 2
  };
  const viewportLeft = window.scrollX;
  const viewportRight = window.scrollX + window.innerWidth;
  const canExpandRight = anchor.x + PIN_EXPANDED_WIDTH <= viewportRight - EDGE_GAP;
  const canExpandLeft = anchor.x - PIN_EXPANDED_WIDTH >= viewportLeft + EDGE_GAP;

  if (!canExpandRight && canExpandLeft) {
    return {
      left: Math.min(viewportRight - EDGE_GAP, anchor.x),
      top: anchor.y,
      side: "left"
    };
  }

  return {
    left: Math.min(Math.max(viewportLeft + EDGE_GAP, anchor.x), viewportRight - PIN_COLLAPSED_WIDTH - EDGE_GAP),
    top: anchor.y,
    side: "right"
  };
}

function FocusedAnnotationOverlay({ annotation, subtle = false }: { annotation?: DomAnnotation; subtle?: boolean }) {
  if (!annotation) return null;
  const palette = getPinPalette(annotation.status);
  const rect = getAnnotationDocumentRect(annotation);
  return (
    <div
      className={`dom-ai-focused-annotation ${subtle ? "dom-ai-focused-annotation-subtle" : ""}`}
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
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
    await saveAnnotation({
      ...state.draft,
      id: crypto.randomUUID(),
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
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
        return;
      }

      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
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
        placeholder="例如：移动端 CTA 按钮距离标题太近。"
        autoFocus
      />

      <div className="mt-3">
        <PriorityControl value={severity} onChange={setSeverity} />
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        {state.editingAnnotation ? (
          <button
            className={`inline-flex h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold transition-[background-color,transform] duration-150 active:scale-[0.96] ${
              confirmDelete ? "bg-red-50 text-red-700 shadow-[inset_0_0_0_1px_rgba(185,28,28,0.18)] hover:bg-red-100" : "bg-white text-ink-500 shadow-[inset_0_0_0_1px_rgba(17,24,39,0.12)] hover:bg-ink-50 hover:text-red-700"
            }`}
            onClick={() => void remove()}
          >
            <Trash2 size={15} />
            {confirmDelete ? "确认删除" : "删除"}
          </button>
        ) : <span />}
        <div className="flex justify-end gap-2">
          <button
            className="inline-flex h-10 items-center justify-center rounded-lg bg-white px-3 text-sm font-semibold text-ink-800 shadow-[inset_0_0_0_1px_rgba(17,24,39,0.12)] transition-[background-color,transform] duration-150 hover:bg-ink-50 active:scale-[0.96]"
            onClick={onCancel}
          >
            取消
          </button>
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-brand-600 px-3 text-sm font-semibold text-white shadow-soft transition-[background-color,transform] duration-150 hover:bg-brand-700 active:scale-[0.96] disabled:cursor-not-allowed disabled:bg-ink-200 disabled:text-ink-500"
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
  const measurements = anchor && hover && anchor !== hover
    ? getElementDistanceLines(anchor.documentRect, hover.documentRect)
    : [];

  return (
    <>
      {pinnedMeasurements.map((item) => (
        <MeasurementPair key={item.key} pair={item} />
      ))}
      {anchor ? (
        <div
          className="dom-ai-highlight dom-ai-measure-anchor"
          style={{
            left: anchor.documentRect.x,
            top: anchor.documentRect.y,
            width: anchor.documentRect.width,
            height: anchor.documentRect.height
          }}
        />
      ) : null}
      {hover ? (
        <>
          <div
            className="dom-ai-highlight"
            style={{
              left: hover.documentRect.x,
              top: hover.documentRect.y,
              width: hover.documentRect.width,
              height: hover.documentRect.height
            }}
          />
          <div
            className="dom-ai-hover-label"
            style={{
              left: hover.documentRect.x,
              top: Math.max(window.scrollY + 8, hover.documentRect.y - 34)
            }}
          >
            <span>{anchor ? "测量目标" : "测量起点"}</span>
            <b>{hover.label}</b>
          </div>
        </>
      ) : null}
      {measurements.length ? <MeasurementOverlay measurements={measurements} idPrefix="preview" /> : null}
      {anchor && hover && !measurements.length && anchor !== hover ? (
        <div
          className="dom-ai-measure-label"
          style={{
            left: (anchor.documentRect.x + hover.documentRect.x + hover.documentRect.width) / 2,
            top: (anchor.documentRect.y + hover.documentRect.y + hover.documentRect.height) / 2
          }}
        >
          0px
        </div>
      ) : null}
    </>
  );
}

function MeasurementPair({ pair }: { pair: PinnedMeasurement }) {
  return (
    <div
      className="dom-ai-measure-pinned-group"
      style={{ "--dom-ai-measure-color": pair.color } as React.CSSProperties}
    >
      <div
        className="dom-ai-highlight dom-ai-measure-pinned-box"
        style={{
          left: pair.from.documentRect.x,
          top: pair.from.documentRect.y,
          width: pair.from.documentRect.width,
          height: pair.from.documentRect.height
        }}
      />
      <div
        className="dom-ai-highlight dom-ai-measure-pinned-box"
        style={{
          left: pair.to.documentRect.x,
          top: pair.to.documentRect.y,
          width: pair.to.documentRect.width,
          height: pair.to.documentRect.height
        }}
      />
      {pair.measurements.length ? <MeasurementOverlay measurements={pair.measurements} idPrefix={pair.key} /> : (
        <div
          className="dom-ai-measure-label"
          style={{
            left: (pair.from.documentRect.x + pair.to.documentRect.x + pair.to.documentRect.width) / 2,
            top: (pair.from.documentRect.y + pair.to.documentRect.y + pair.to.documentRect.height) / 2
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
    await navigator.clipboard.writeText(`${label}: ${value || "-"}`);
    setCopiedKey(label);
    window.setTimeout(() => setCopiedKey(null), 900);
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
      <div className="text-xs font-bold text-ink-700">优先级</div>
      <div className="mt-1 grid grid-cols-3 gap-1 rounded-xl bg-ink-100 p-1">
        {options.map((option) => (
          <button
            key={option}
            className={`h-9 rounded-lg text-xs font-bold transition-[background-color,color,box-shadow,transform] duration-150 active:scale-[0.96] ${
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
  return [first.key, second.key].sort().join("::");
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
