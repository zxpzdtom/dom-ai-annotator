import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ChevronDown, Code2, Link2, MessageCircle, Palette, Ruler, Trash2, Type, X } from "lucide-react";
import cssText from "./content.css?inline";
import { createAnnotationDraft, getCssSelector, querySelectorDeep } from "./selector";
import { isExcludedUrl } from "../shared/excludedUrls";
import type { AnnotationDraft, AnnotationPinAnchor, AnnotationReference, AnnotationScreenshot, AnnotationStatus, ContentMessage, DomAnnotation, ElementRect, FeedbackSeverity, MonitorEvent, MonitorSnapshot, PageContext } from "../shared/types";
import { deleteAnnotation, getAnnotations, saveAnnotation, subscribeAnnotations, updateAnnotationFeedback, updateAnnotationScreenshot, updateAnnotationStatus } from "../shared/storage";
import { getPinPalette, getStatusLabel, normalizeAnnotationStatus, severityLabels, statusLabels } from "../shared/status";
import { writeClipboardText } from "../shared/clipboard";

const ROOT_ID = "dom-ai-annotator-root";
const COMPOSER_WIDTH = 430;
const COMPOSER_ESTIMATED_HEIGHT = 400;
const COMPOSER_MIN_VISIBLE_HEIGHT = 360;
const EDGE_GAP = 16;
const PIN_COLLAPSED_WIDTH = 44;
const PIN_COLLAPSED_HEIGHT = 38;
const PIN_EXPANDED_WIDTH = 380;
const PIN_CARD_ESTIMATED_HEIGHT = 318;
const PIN_GAP = 8;
const HOVER_LABEL_GAP = 8;
const HOVER_LABEL_HEIGHT = 34;
const HOVER_LABEL_MAX_WIDTH = 320;
const HOVER_LABEL_VIEWPORT_GAP = 8;
const MAX_ANNOTATION_SCREENSHOT_DIMENSION = 960;
const MEASURE_COLORS = ["#2563eb", "#dc2626", "#7c3aed", "#ea580c", "#0891b2", "#16a34a"];
const MONITOR_SCRIPT_ID = "dom-ai-monitor-bridge-script";
const MAX_MONITOR_EVENTS = 400;
const MONITOR_EVENT_NAME = "dom-ai-monitor-event";
const INITIAL_PIN_REFRESH_DELAYS = [250, 800, 1800, 3500, 6000];
const PANEL_VISIBILITY_EVENT = "dom-ai-panel-visibility";
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
  initialScreenshot?: AnnotationScreenshot;
  editingAnnotation?: DomAnnotation;
};

type PendingAnnotationReference = AnnotationReference & {
  nonce: number;
};

type ReferenceEditorToken = {
  id: string;
  label: string;
  title: string;
  referenceId?: string;
  removable: boolean;
};

type ReferenceTextEditorHandle = {
  focus: () => void;
  insertToken: (token: ReferenceEditorToken) => void;
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

let monitorEnabled = false;
let monitorEvents: MonitorEvent[] = [];
let monitorBridgeInjected = false;
let framePageContextPromise: Promise<PageContext> | null = null;

function getFallbackPageContext(): PageContext {
  return {
    kind: isEmbeddedFrameWindow() ? "iframe" : "top",
    url: location.href,
    title: document.title,
    topUrl: isEmbeddedFrameWindow() ? document.referrer || undefined : location.href,
    topTitle: isEmbeddedFrameWindow() ? undefined : document.title
  };
}

async function getFramePageContext(): Promise<PageContext> {
  if (!framePageContextPromise) {
    framePageContextPromise = chrome.runtime.sendMessage({ type: "DOM_AI_GET_FRAME_CONTEXT" })
      .then((context: PageContext | undefined) => ({
        ...getFallbackPageContext(),
        ...context,
        kind: context?.kind ?? (isEmbeddedFrameWindow() ? "iframe" : "top"),
        url: context?.url || location.href,
        title: context?.title || document.title
      }))
      .catch(() => getFallbackPageContext());
  }
  return framePageContextPromise;
}

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
  const [panelActive, setPanelActive] = useState(false);
  const [isPicking, setPicking] = useState(false);
  const [isMeasuring, setMeasuring] = useState(false);
  const [hoverInspection, setHoverInspection] = useState<HoverInspection | null>(null);
  const [measureAnchor, setMeasureAnchor] = useState<HoverInspection | null>(null);
  const [measureHover, setMeasureHover] = useState<HoverInspection | null>(null);
  const [measurePaused, setMeasurePaused] = useState(false);
  const [pinnedMeasurements, setPinnedMeasurements] = useState<PinnedMeasurement[]>([]);
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [referencePickingLabel, setReferencePickingLabel] = useState<string | null>(null);
  const [pendingReference, setPendingReference] = useState<PendingAnnotationReference | null>(null);
  const [resumePickingAfterComposer, setResumePickingAfterComposer] = useState(false);
  const [annotations, setAnnotations] = useState<DomAnnotation[]>([]);
  const [focusedAnnotationId, setFocusedAnnotationId] = useState<string | null>(null);
  const [focusedReference, setFocusedReference] = useState<AnnotationReference | null>(null);
  const [hoveredAnnotationId, setHoveredAnnotationId] = useState<string | null>(null);
  const [documentSize, setDocumentSize] = useState<DocumentSize>(() => getDocumentSize());
  const [viewportOffset, setViewportOffset] = useState<ViewportOffset>(() => ({ x: window.scrollX, y: window.scrollY }));
  const [pageContext, setPageContext] = useState<PageContext>(() => getFallbackPageContext());
  const [toolbarDismissed, setToolbarDismissed] = useState(false);
  const showFrameToolbar = !isEmbeddedFrameWindow();
  const focusTimerRef = useRef<number | null>(null);
  const lastFrameHoverSignalRef = useRef(0);

  const clearTransientUi = useCallback(() => {
    setPicking(false);
    setMeasuring(false);
    setHoverInspection(null);
    setMeasureAnchor(null);
    setMeasureHover(null);
    setMeasurePaused(false);
    setPinnedMeasurements([]);
    setComposer(null);
    setReferencePickingLabel(null);
    setPendingReference(null);
    setResumePickingAfterComposer(false);
    setFocusedAnnotationId(null);
    setFocusedReference(null);
    setHoveredAnnotationId(null);
    setToolbarDismissed(false);
    document.getElementById("dom-ai-img-preview")?.remove();
  }, []);

  const setPanelVisible = useCallback((active: boolean) => {
    if (!active) {
      setPanelActive(false);
      clearTransientUi();
      return;
    }

    setPanelActive(true);
  }, [clearTransientUi]);

  useEffect(() => {
    void getFramePageContext().then(setPageContext);
  }, []);

  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ active?: boolean }>).detail;
      setPanelVisible(Boolean(detail?.active));
    };

    window.addEventListener(PANEL_VISIBILITY_EVENT, listener);
    return () => window.removeEventListener(PANEL_VISIBILITY_EVENT, listener);
  }, [setPanelVisible]);

  const refreshAnnotations = useCallback(async () => {
    const items = await getAnnotations();
    setAnnotations(items.filter((item) => isAnnotationForCurrentDocument(item, pageContext)));
  }, [pageContext]);

  useEffect(() => {
    void refreshAnnotations();
    const timers = INITIAL_PIN_REFRESH_DELAYS.map((delayMs) =>
      window.setTimeout(() => void refreshAnnotations(), delayMs)
    );
    const onLoad = () => void refreshAnnotations();
    window.addEventListener("load", onLoad);
    const unsubscribe = subscribeAnnotations(refreshAnnotations);
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      window.removeEventListener("load", onLoad);
      unsubscribe();
    };
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
        setPanelVisible(true);
        setMeasuring(false);
        setReferencePickingLabel(null);
        setResumePickingAfterComposer(false);
        setMeasureAnchor(null);
        setMeasureHover(null);
        setMeasurePaused(false);
        setPicking(true);
      }
      if (message.type === "DOM_AI_STOP_PICKING") {
        setPicking(false);
        setResumePickingAfterComposer(false);
      }
      if (message.type === "DOM_AI_START_MEASURING") {
        setPanelVisible(true);
        setPicking(false);
        setComposer(null);
        setReferencePickingLabel(null);
        setResumePickingAfterComposer(false);
        setMeasureAnchor(null);
        setMeasureHover(null);
        setMeasurePaused(false);
        setMeasuring(true);
      }
      if (message.type === "DOM_AI_STOP_MEASURING") {
        setMeasuring(false);
        setMeasureAnchor(null);
        setMeasureHover(null);
        setMeasurePaused(false);
      }
      if (message.type === "DOM_AI_FRAME_HOVER_ACTIVE" && message.frameId !== pageContext.frameId) {
        setHoverInspection(null);
        setMeasureHover(null);
      }
      if (message.type === "DOM_AI_REFRESH_PINS") void refreshAnnotations();
      if (message.type === "DOM_AI_FOCUS_ANNOTATION") {
        setPanelVisible(true);
        focusAndHighlightAnnotation(message.id, annotations);
      }
      if (message.type === "DOM_AI_FOCUS_REFERENCE") {
        setPanelVisible(true);
        focusAndHighlightReference(message.reference);
      }
      if (message.type === "DOM_AI_EDIT_ANNOTATION") {
        setPanelVisible(true);
        openAnnotationEditor(message.id, annotations);
      }
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
  }, [annotations, refreshAnnotations, setPanelVisible]);

  useEffect(() => {
    const cursor = panelActive && (isPicking || referencePickingLabel) ? COMMENT_CURSOR : panelActive && isMeasuring && !measurePaused ? "crosshair" : "";
    document.body.style.cursor = cursor;
    document.documentElement.style.cursor = cursor;

    return () => {
      document.body.style.cursor = "";
      document.documentElement.style.cursor = "";
    };
  }, [isMeasuring, isPicking, measurePaused, panelActive, referencePickingLabel]);

  useEffect(() => {
    if (!panelActive) return;

    const onToolShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableEvent(event)) return;

      if (event.key.toLowerCase() === "c" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        event.stopPropagation();
        requestPickingMode();
        return;
      }

      if (event.key.toLowerCase() === "m" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        event.stopPropagation();
        requestMeasuringMode();
        return;
      }

      if (event.key === "Escape" && (isPicking || isMeasuring)) {
        event.preventDefault();
        event.stopPropagation();
        requestStopCurrentMode();
      }
    };

    window.addEventListener("keydown", onToolShortcut, true);
    return () => window.removeEventListener("keydown", onToolShortcut, true);
  }, [isMeasuring, isPicking, measureAnchor, measureHover, measurePaused, panelActive]);

  useEffect(() => {
    if (!panelActive || !isPicking) {
      setHoverInspection(null);
      return;
    }

    const onMove = (event: MouseEvent) => {
      if (measurePaused) return;
      notifyFrameHoverActive(pageContext, lastFrameHoverSignalRef);
      const element = getTargetElement(event);
      if (!element) return;
      if (shouldDeferPointerToEmbeddedContent(event)) {
        setHoverInspection(null);
        return;
      }
      setDocumentSize(getDocumentSize());
      setHoverInspection(getElementInspection(element));
    };

    const onPointerDown = async (event: PointerEvent) => {
      if (measurePaused) return;
      if (!isPrimaryPointerSelection(event)) return;
      if (isInjectedEvent(event)) return;
      const element = getTargetElement(event);
      if (!element) return;
      if (shouldDeferPointerToEmbeddedContent(event)) {
        setHoverInspection(null);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      suppressNextPageClick();
      setResumePickingAfterComposer(true);
      setPicking(false);
      const inspection = getElementInspection(element);
      const context = getAnnotationPageContext(element, await getFramePageContext());
      void chrome.runtime.sendMessage({ type: "DOM_AI_PAGE_CONTEXT_SELECTED", context });
      const draft = createAnnotationDraft(element, getPreferredAnnotationPinAnchor(inspection, {
        x: event.clientX + window.scrollX,
        y: event.clientY + window.scrollY
      }), context);
      const initialScreenshot = await captureAnnotationScreenshotData(draft.selector, draft.rect);
      setComposer({
        draft,
        inspection,
        initialScreenshot
      });
    };

    const onClick = (event: MouseEvent) => {
      if (isInjectedEvent(event) || shouldDeferPointerToEmbeddedContent(event)) return;
      event.preventDefault();
      event.stopPropagation();
    };

    const onOut = (event: MouseEvent) => {
      if (isPointerLeavingForEmbeddedContent(event)) setHoverInspection(null);
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      requestStopCurrentMode();
    };

    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mouseout", onOut, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("keydown", onKey, true);

    return () => {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("mouseout", onOut, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [isPicking, panelActive]);

  useEffect(() => {
    if (!panelActive || !referencePickingLabel || !composer) {
      if (!isPicking) setHoverInspection(null);
      return;
    }

    const onMove = (event: MouseEvent) => {
      notifyFrameHoverActive(pageContext, lastFrameHoverSignalRef);
      const element = getTargetElement(event);
      if (!element) return;
      if (shouldDeferPointerToEmbeddedContent(event)) {
        setHoverInspection(null);
        return;
      }
      setDocumentSize(getDocumentSize());
      setHoverInspection(getElementInspection(element));
    };

    const onPointerDown = async (event: PointerEvent) => {
      if (!isPrimaryPointerSelection(event)) return;
      if (isInjectedEvent(event)) return;
      const element = getTargetElement(event);
      if (!element) return;
      if (shouldDeferPointerToEmbeddedContent(event)) {
        setHoverInspection(null);
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      suppressNextPageClick();
      const context = getAnnotationPageContext(element, await getFramePageContext());
      void chrome.runtime.sendMessage({ type: "DOM_AI_PAGE_CONTEXT_SELECTED", context });
      setPendingReference({
        ...createAnnotationReference(element, referencePickingLabel, context),
        nonce: Date.now()
      });
      setReferencePickingLabel(null);
      setHoverInspection(null);
    };

    const onClick = (event: MouseEvent) => {
      if (isInjectedEvent(event) || shouldDeferPointerToEmbeddedContent(event)) return;
      event.preventDefault();
      event.stopPropagation();
    };

    const onOut = (event: MouseEvent) => {
      if (isPointerLeavingForEmbeddedContent(event)) setHoverInspection(null);
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setReferencePickingLabel(null);
      setHoverInspection(null);
    };

    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mouseout", onOut, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("keydown", onKey, true);

    return () => {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("mouseout", onOut, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [composer, isPicking, panelActive, pageContext, referencePickingLabel]);

  useEffect(() => {
    if (!panelActive || !isMeasuring || measurePaused) {
      setMeasureAnchor(null);
      setMeasureHover(null);
      return;
    }

    const onMove = (event: MouseEvent) => {
      notifyFrameHoverActive(pageContext, lastFrameHoverSignalRef);
      const element = getTargetElement(event);
      if (!element) return;
      if (shouldDeferPointerToEmbeddedContent(event)) {
        setMeasureHover(null);
        return;
      }
      setDocumentSize(getDocumentSize());
      setMeasureHover(getElementInspection(element));
    };

    const onPointerDown = (event: PointerEvent) => {
      if (!isPrimaryPointerSelection(event)) return;
      if (isInjectedEvent(event)) return;
      const element = getTargetElement(event);
      if (!element) return;
      if (shouldDeferPointerToEmbeddedContent(event)) {
        setMeasureHover(null);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      suppressNextPageClick();
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

    const onClick = (event: MouseEvent) => {
      if (isInjectedEvent(event) || shouldDeferPointerToEmbeddedContent(event)) return;
      event.preventDefault();
      event.stopPropagation();
    };

    const onOut = (event: MouseEvent) => {
      if (isPointerLeavingForEmbeddedContent(event)) setMeasureHover(null);
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      requestStopCurrentMode();
    };

    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mouseout", onOut, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("keydown", onKey, true);

    return () => {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("mouseout", onOut, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [isMeasuring, measureAnchor, measureHover, measurePaused, panelActive]);

  const sortedAnnotations = useMemo(
    () => [...annotations].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [annotations]
  );

  function closeComposer() {
    setComposer(null);
    setReferencePickingLabel(null);
    if (resumePickingAfterComposer) setPicking(true);
    setResumePickingAfterComposer(false);
  }

  function focusAndHighlightAnnotation(id: string, items: DomAnnotation[]) {
    focusAnnotation(id, items);
    setFocusedAnnotationId(id);
    setFocusedReference(null);
    if (focusTimerRef.current) window.clearTimeout(focusTimerRef.current);
    focusTimerRef.current = window.setTimeout(() => {
      setFocusedAnnotationId(null);
      focusTimerRef.current = null;
    }, 1600);
  }

  function focusAndHighlightReference(reference: AnnotationReference) {
    focusReference(reference);
    setFocusedReference(reference);
    setFocusedAnnotationId(null);
    if (focusTimerRef.current) window.clearTimeout(focusTimerRef.current);
    focusTimerRef.current = window.setTimeout(() => {
      setFocusedReference(null);
      focusTimerRef.current = null;
    }, 1600);
  }

  function openAnnotationEditor(id: string, items: DomAnnotation[]) {
    const annotation = items.find((item) => item.id === id);
    if (!annotation) return;
    setPicking(false);
    setReferencePickingLabel(null);
    setResumePickingAfterComposer(false);
    setMeasuring(false);
    setMeasureAnchor(null);
    setMeasureHover(null);
    setMeasurePaused(false);
    focusAnnotation(id, items);
    setComposer({
      draft: getAnnotationDraft(annotation),
      inspection: getInspectionForAnnotation(annotation),
      editingAnnotation: annotation
    });
  }

  function startPickingMode() {
    setComposer(null);
    setReferencePickingLabel(null);
    setResumePickingAfterComposer(false);
    setMeasuring(false);
    setMeasureAnchor(null);
    setMeasureHover(null);
    setMeasurePaused(false);
    setPicking(true);
  }

  function startMeasuringMode() {
    setComposer(null);
    setReferencePickingLabel(null);
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

  function broadcastContentMessage(message: ContentMessage, fallback: () => void) {
    void chrome.runtime.sendMessage({ type: "DOM_AI_BROADCAST_CONTENT_MESSAGE", message }).catch(fallback);
  }

  function requestPickingMode() {
    broadcastContentMessage({ type: "DOM_AI_START_PICKING" }, startPickingMode);
  }

  function requestMeasuringMode() {
    broadcastContentMessage({ type: "DOM_AI_START_MEASURING" }, startMeasuringMode);
  }

  function requestStopCurrentMode() {
    const message: ContentMessage = { type: isMeasuring ? "DOM_AI_STOP_MEASURING" : "DOM_AI_STOP_PICKING" };
    broadcastContentMessage(message, stopCurrentMode);
  }

  function stopCurrentMode() {
    setPicking(false);
    setReferencePickingLabel(null);
    setResumePickingAfterComposer(false);
    setMeasuring(false);
    setMeasureAnchor(null);
    setMeasureHover(null);
    setMeasurePaused(false);
  }

  if (!panelActive) return null;

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
        {(isPicking || referencePickingLabel) && hoverInspection ? (
          <>
            <div
              className="dom-ai-highlight"
              style={getHighlightStyle(hoverInspection)}
            />
            <div
              className="dom-ai-hover-label"
              style={getHoverLabelStyle(
                hoverInspection,
                referencePickingLabel ? `引用为${referencePickingLabel}` : hoverInspection.label,
                `${Math.round(hoverInspection.documentRect.width)} x ${Math.round(hoverInspection.documentRect.height)}`
              )}
            >
              <span>{referencePickingLabel ? `引用为${referencePickingLabel}` : hoverInspection.label}</span>
              <b>{Math.round(hoverInspection.documentRect.width)} x {Math.round(hoverInspection.documentRect.height)}</b>
            </div>
          </>
        ) : null}

        {isMeasuring || pinnedMeasurements.length ? (
          <MeasureLayer
            anchor={isMeasuring && !measurePaused ? measureAnchor : null}
            hover={isMeasuring && !measurePaused ? measureHover : null}
            pinnedMeasurements={pinnedMeasurements}
            removable={!isMeasuring}
            onRemovePinned={(key) => setPinnedMeasurements((items) => items.filter((item) => item.key !== key))}
          />
        ) : null}

        {focusedAnnotationId ? (
          <FocusedAnnotationOverlay annotation={sortedAnnotations.find((item) => item.id === focusedAnnotationId)} />
        ) : null}

        {focusedReference ? (
          <FocusedReferenceOverlay reference={focusedReference} />
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

        {composer ? <Composer
          state={composer}
          pendingReference={pendingReference}
          referencePicking={Boolean(referencePickingLabel)}
          onPickReference={(label) => {
            setPicking(false);
            setMeasuring(false);
            setMeasureAnchor(null);
            setMeasureHover(null);
            setMeasurePaused(false);
            setReferencePickingLabel(label);
          }}
          onReferenceConsumed={() => setPendingReference(null)}
          onCancel={closeComposer}
          onSaved={() => {
          closeComposer();
          void refreshAnnotations();
        }} onDeleted={() => {
          closeComposer();
          void refreshAnnotations();
        }} /> : null}
      </div>

      {showFrameToolbar ? <FloatingToolBar
        isPicking={isPicking}
        isMeasuring={isMeasuring}
        hidden={toolbarDismissed}
        onPick={requestPickingMode}
        onMeasure={requestMeasuringMode}
        onDismiss={() => setToolbarDismissed(true)}
        onCancel={requestStopCurrentMode}
      /> : null}
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
  hidden,
  onPick,
  onMeasure,
  onDismiss,
  onCancel
}: {
  isPicking: boolean;
  isMeasuring: boolean;
  hidden: boolean;
  onPick: () => void;
  onMeasure: () => void;
  onDismiss: () => void;
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

  if (hidden) return null;

  return (
    <div className="dom-ai-tool-bar dom-ai-interactive">
      <button
        type="button"
        className="dom-ai-tool-button dom-ai-tool-button-primary"
        onClick={onPick}
      >
        <ReviewCursorIcon />
        <span>标注</span>
        <kbd>C</kbd>
      </button>
      <button
        type="button"
        className="dom-ai-tool-button dom-ai-tool-button-measure"
        onClick={onMeasure}
      >
        <Ruler size={15} />
        <span>测量</span>
        <kbd>M</kbd>
      </button>
      <button type="button" className="dom-ai-tool-dismiss" aria-label="隐藏工具条" title="隐藏工具条" onClick={onDismiss}>
        <X size={14} />
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
  const candidate = getPreferredAnnotationPinCandidateFromRect(rect, getAnnotationLivePinAnchor(annotation, rect));
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
  const preferredCandidate = preferredPoint ? inferPinCandidateFromPoint(rect, preferredPoint) : null;
  const markerOverlapsTarget = preferredCandidate ? markerRectOverlapsTarget(getPinMarkerRect(preferredCandidate.anchor, preferredCandidate.placement), rect) : false;
  if (preferredCandidate && !markerOverlapsTarget) return preferredCandidate;

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

function getAnnotationLivePinAnchor(annotation: DomAnnotation, liveRect: HoverInspection["documentRect"]): AnnotationPinAnchor | undefined {
  if (!annotation.pin) return undefined;
  if (!getAnnotationElement(annotation)) return annotation.pin;

  const savedRect = getSavedAnnotationDocumentRect(annotation);
  const savedCandidate = inferPinCandidateFromPoint(savedRect, annotation.pin);
  if (savedCandidate.placement === "left") {
    return {
      x: liveRect.x - PIN_GAP,
      y: liveRect.y + (annotation.pin.y - savedRect.y)
    };
  }
  if (savedCandidate.placement === "bottom") {
    return {
      x: liveRect.x + (annotation.pin.x - savedRect.x),
      y: liveRect.y + liveRect.height + PIN_GAP
    };
  }
  if (savedCandidate.placement === "top") {
    return {
      x: liveRect.x + (annotation.pin.x - savedRect.x),
      y: liveRect.y - PIN_GAP
    };
  }
  return {
    x: liveRect.x + liveRect.width + PIN_GAP,
    y: liveRect.y + (annotation.pin.y - savedRect.y)
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

function FocusedReferenceOverlay({ reference }: { reference?: AnnotationReference }) {
  if (!reference) return null;
  const rect = getReferenceDocumentRect(reference);
  const borderRadius = getReferenceBorderRadius(reference);
  return (
    <div
      className="dom-ai-focused-annotation"
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        borderRadius,
        "--dom-ai-focus-color": "#0f9f78",
        "--dom-ai-focus-glow": "rgba(15, 159, 120, 0.24)"
      } as React.CSSProperties}
    />
  );
}

function Composer({
  state,
  pendingReference,
  referencePicking,
  onPickReference,
  onReferenceConsumed,
  onCancel,
  onSaved,
  onDeleted
}: {
  state: ComposerState;
  pendingReference: PendingAnnotationReference | null;
  referencePicking: boolean;
  onPickReference: (label: string) => void;
  onReferenceConsumed: () => void;
  onCancel: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [comment, setComment] = useState(state.editingAnnotation?.feedback.comment ?? "");
  const [severity, setSeverity] = useState<FeedbackSeverity>(state.editingAnnotation?.feedback.severity ?? "important");
  const [references, setReferences] = useState<AnnotationReference[]>(state.editingAnnotation?.references ?? []);
  const [colorMode, setColorMode] = useState<ColorMode>("rgb");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const editorRef = useRef<ReferenceTextEditorHandle | null>(null);
  const consumedReferenceNonceRef = useRef<number | null>(null);
  const canSave = comment.trim().length > 0;
  const position = getComposerPosition(state.inspection.documentRect);
  const targetToken = useMemo<ReferenceEditorToken>(() => ({
    id: "target",
    label: "对象 1",
    title: state.inspection.label,
    removable: false
  }), [state.inspection.label]);
  const editorTokens = useMemo<ReferenceEditorToken[]>(
    () => [targetToken, ...references.map(referenceToEditorToken)],
    [references, targetToken]
  );

  const save = useCallback(async () => {
    if (!canSave) return;

    if (state.editingAnnotation) {
      await updateAnnotationFeedback(state.editingAnnotation.id, {
        comment: comment.trim(),
        severity,
        references: references.length ? references : undefined
      });
      onSaved();
      return;
    }

    const now = new Date().toISOString();
    const newId = crypto.randomUUID();
    const annotation: DomAnnotation = {
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
      references: references.length ? references : undefined,
      status: "pending"
    };
    await saveAnnotation(annotation);
    if (state.initialScreenshot) {
      await updateAnnotationScreenshot(newId, "screenshot", state.initialScreenshot);
    }
    void chrome.runtime.sendMessage({ type: "DOM_AI_ANNOTATION_SAVED", annotation });
    onSaved();
  }, [canSave, comment, onSaved, references, severity, state.draft, state.editingAnnotation, state.initialScreenshot]);

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
    setReferences(state.editingAnnotation?.references ?? []);
    setConfirmDelete(false);
  }, [state.editingAnnotation?.id]);

  const insertReferenceToken = useCallback((token: ReferenceEditorToken) => {
    if (editorRef.current) {
      editorRef.current.insertToken(token);
      return;
    }
    setComment((value) => `${value}${value && !/\s$/.test(value) ? " " : ""}${token.label}`);
  }, []);

  useEffect(() => {
    if (!pendingReference || consumedReferenceNonceRef.current === pendingReference.nonce) return;
    consumedReferenceNonceRef.current = pendingReference.nonce;

    if (isSameAnnotationReferenceTarget(pendingReference, state.draft)) {
      insertReferenceToken(targetToken);
      onReferenceConsumed();
      return;
    }

    const existing = references.find((reference) => isSameAnnotationReferenceTarget(reference, pendingReference));
    if (existing) {
      insertReferenceToken(referenceToEditorToken(existing));
      onReferenceConsumed();
      return;
    }

    const { nonce: _nonce, ...reference } = pendingReference;
    setReferences((items) => [...items, reference]);
    insertReferenceToken(referenceToEditorToken(reference));
    onReferenceConsumed();
  }, [insertReferenceToken, onReferenceConsumed, pendingReference, references, state.draft, targetToken]);

  function removeReference(id: string) {
    setReferences((items) => items.filter((item) => item.id !== id));
  }

  function requestReferencePick() {
    onPickReference(getNextReferenceLabel(references));
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === "Escape") {
        if (referencePicking) return;
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
  }, [onCancel, referencePicking, save]);

  return (
    <section
      className="dom-ai-composer dom-ai-interactive absolute w-[430px] rounded-2xl bg-white p-2 text-ink-900 shadow-panel ring-1 ring-black/5"
      data-anchor-ready="true"
      style={{
        left: position.left,
        top: position.top
      }}
    >
      <div className="px-1 pb-1.5">
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
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-500 transition-colors duration-150 hover:bg-ink-50 hover:text-ink-900 active:scale-[0.96]"
            aria-label="关闭编辑框"
            onClick={onCancel}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="px-0.5 pb-1">
        <ElementDetails inspection={state.inspection} colorMode={colorMode} onColorModeChange={setColorMode} />

        <div className="mt-3 flex items-center justify-between gap-2">
          <label className="text-xs font-bold text-ink-700" htmlFor="dom-ai-comment">
            评论内容
          </label>
        </div>
        <ReferenceTextEditor
          ref={editorRef}
          resetKey={state.editingAnnotation?.id ?? state.draft.selector}
          value={comment}
          tokens={editorTokens}
          placeholder="例如：把对象 1 的颜色改成对象 2 的颜色。"
          onChange={setComment}
          onPickReference={requestReferencePick}
          onRemoveReference={removeReference}
          onSave={() => void save()}
          referencePicking={referencePicking}
        />

        <div className="mt-2.5">
          <PriorityControl value={severity} onChange={setSeverity} />
        </div>
      </div>

      <div className="mt-1.5 flex min-h-[38px] items-center justify-between gap-2 border-t border-ink-100 pt-1.5">
        {state.editingAnnotation ? (
          <button
            className={`inline-flex h-7 items-center justify-center gap-1 rounded-md px-2 text-[11px] font-semibold transition-[background-color,transform] duration-150 active:scale-[0.96] ${
              confirmDelete ? "bg-red-50 text-red-700 shadow-[inset_0_0_0_1px_rgba(185,28,28,0.18)] hover:bg-red-100" : "bg-white text-ink-500 shadow-[inset_0_0_0_1px_rgba(17,24,39,0.12)] hover:bg-ink-50 hover:text-red-700"
            }`}
            onClick={() => void remove()}
          >
            <Trash2 size={13} />
            {confirmDelete ? "确认删除" : "删除"}
          </button>
        ) : <span />}
        <div className="flex items-center justify-end gap-2">
          <button
            className="inline-flex h-[30px] items-center justify-center rounded-md bg-white px-2.5 text-[11px] font-semibold leading-none text-ink-800 shadow-[inset_0_0_0_1px_rgba(17,24,39,0.12)] transition-[background-color,transform] duration-150 hover:bg-ink-50 active:scale-[0.96]"
            onClick={onCancel}
          >
            取消
          </button>
          <button
            className="inline-flex h-[30px] items-center justify-center gap-1 rounded-md bg-brand-600 px-2.5 text-[11px] font-semibold leading-none text-white shadow-soft transition-[background-color,transform] duration-150 hover:bg-brand-700 active:scale-[0.96] disabled:cursor-not-allowed disabled:bg-ink-200 disabled:text-ink-500"
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

const ReferenceTextEditor = React.forwardRef<ReferenceTextEditorHandle, {
  resetKey: string;
  value: string;
  tokens: ReferenceEditorToken[];
  placeholder: string;
  onChange: (value: string) => void;
  onPickReference: () => void;
  onRemoveReference: (id: string) => void;
  onSave: () => void;
  referencePicking: boolean;
}>(function ReferenceTextEditor({
  resetKey,
  value,
  tokens,
  placeholder,
  onChange,
  onPickReference,
  onRemoveReference,
  onSave,
  referencePicking
}, ref) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const tokensRef = useRef(tokens);
  const composingRef = useRef(false);

  useEffect(() => {
    tokensRef.current = tokens;
  }, [tokens]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    renderReferenceEditorValue(editor, value, tokensRef.current, onRemoveReference);
    updateReferenceEditorEmptyState(editor);
    window.requestAnimationFrame(() => moveCaretToEditorEnd(editor));
  }, [resetKey]);

  const emitChange = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    updateReferenceEditorEmptyState(editor);
    onChange(readReferenceEditorText(editor));
  }, [onChange]);

  const handleEditorKeyDownCapture = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.nativeEvent.isComposing) return;

    if (isSaveKeyboardShortcut(event)) {
      event.preventDefault();
      onSave();
      return;
    }

    if (event.key === "Backspace" || event.key === "Delete") {
      const removed = removeAdjacentReferenceToken(editorRef.current, event.key, onRemoveReference);
      if (removed) {
        event.preventDefault();
        emitChange();
      }
    }
  }, [emitChange, onRemoveReference, onSave]);

  const stopEditorShortcutPropagation = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
  }, []);

  useImperativeHandle(ref, () => ({
    focus: () => editorRef.current?.focus(),
    insertToken: (token) => {
      const editor = editorRef.current;
      if (!editor) return;
      insertReferenceTokenIntoEditor(editor, token, onRemoveReference);
      updateReferenceEditorEmptyState(editor);
      onChange(readReferenceEditorText(editor));
    }
  }), [onChange, onRemoveReference]);

  return (
    <div
      className="mt-1 flex min-h-[112px] flex-col rounded-xl bg-white shadow-[inset_0_0_0_1px_rgba(17,24,39,0.1)] transition-shadow duration-150 focus-within:shadow-[inset_0_0_0_2px_rgba(15,159,120,0.45)]"
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button")) return;
        editorRef.current?.focus();
      }}
    >
      <div
        ref={editorRef}
        id="dom-ai-comment"
        className="min-h-[82px] flex-1 whitespace-pre-wrap break-words px-3 py-2.5 text-sm leading-7 text-ink-900 outline-none empty:before:pointer-events-none empty:before:text-ink-500 empty:before:content-[attr(data-placeholder)]"
        contentEditable
        role="textbox"
        aria-multiline="true"
        data-placeholder={placeholder}
        suppressContentEditableWarning
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          emitChange();
        }}
        onInput={() => {
          if (!composingRef.current) emitChange();
        }}
        onKeyDownCapture={handleEditorKeyDownCapture}
        onKeyUpCapture={stopEditorShortcutPropagation}
        onKeyPressCapture={stopEditorShortcutPropagation}
      />
      <div className="flex min-h-[34px] items-center justify-end gap-2 px-2 pb-2">
        <button
          className={`inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-lg px-2 text-[11px] font-bold leading-none transition-[background-color,color,transform,box-shadow] duration-150 active:scale-[0.96] ${
            referencePicking
              ? "bg-brand-600 text-white shadow-[0_6px_14px_rgba(15,159,120,0.2)]"
              : "text-ink-500 hover:bg-ink-50 hover:text-ink-900"
          }`}
          onClick={onPickReference}
          type="button"
        >
          <Link2 size={12} />
          {referencePicking ? "点击元素" : "添加引用"}
        </button>
      </div>
    </div>
  );
});

function referenceToEditorToken(reference: AnnotationReference): ReferenceEditorToken {
  return {
    id: `reference-${reference.id}`,
    label: reference.label,
    title: getReferenceTitle(reference),
    referenceId: reference.id,
    removable: true
  };
}

function renderReferenceEditorValue(
  editor: HTMLDivElement,
  value: string,
  tokens: ReferenceEditorToken[],
  onRemoveReference: (id: string) => void
) {
  editor.replaceChildren(...buildReferenceEditorNodes(value, tokens, onRemoveReference));
}

function buildReferenceEditorNodes(
  value: string,
  tokens: ReferenceEditorToken[],
  onRemoveReference: (id: string) => void
): Node[] {
  const sortedTokens = [...tokens].sort((a, b) => b.label.length - a.label.length);
  const nodes: Node[] = [];
  let index = 0;

  while (index < value.length) {
    const token = sortedTokens.find((item) => value.startsWith(item.label, index));
    if (token) {
      nodes.push(createReferenceTokenNode(token, onRemoveReference));
      index += token.label.length;
      continue;
    }

    let nextTokenIndex = value.length;
    for (const item of sortedTokens) {
      const found = value.indexOf(item.label, index + 1);
      if (found !== -1) nextTokenIndex = Math.min(nextTokenIndex, found);
    }
    nodes.push(document.createTextNode(value.slice(index, nextTokenIndex)));
    index = nextTokenIndex;
  }

  return nodes;
}

function createReferenceTokenNode(token: ReferenceEditorToken, onRemoveReference: (id: string) => void): HTMLElement {
  const chip = document.createElement("span");
  chip.className = "dom-ai-reference-token inline-flex h-[22px] max-w-full items-center gap-1 rounded-lg bg-brand-50 px-2 align-middle text-[11px] font-extrabold leading-none text-brand-800 shadow-[inset_0_0_0_1px_rgba(15,159,120,0.14)]";
  chip.contentEditable = "false";
  chip.dataset.referenceToken = "true";
  chip.dataset.referenceLabel = token.label;
  if (token.referenceId) chip.dataset.referenceId = token.referenceId;

  const label = document.createElement("span");
  label.className = "inline-flex h-[16px] shrink-0 items-center rounded-md bg-white/80 px-1.5 font-mono text-[10px] leading-none text-brand-700 shadow-[inset_0_0_0_1px_rgba(15,159,120,0.12)]";
  label.textContent = token.label;
  chip.append(label);

  const title = document.createElement("span");
  title.className = "min-w-0 max-w-[130px] truncate";
  title.textContent = token.title;
  chip.append(title);

  if (token.removable && token.referenceId) {
    const remove = document.createElement("button");
    remove.className = "-mr-1 inline-grid h-[18px] w-[18px] shrink-0 place-items-center rounded-md pb-px text-[13px] leading-none text-brand-500 transition-[background-color,color,transform] duration-150 hover:bg-white hover:text-brand-900 active:scale-[0.96]";
    remove.type = "button";
    remove.ariaLabel = `移除${token.label}`;
    remove.textContent = "×";
    remove.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      chip.remove();
      onRemoveReference(token.referenceId!);
      const editor = document.getElementById("dom-ai-comment");
      if (editor instanceof HTMLDivElement) {
        updateReferenceEditorEmptyState(editor);
        editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
        editor.focus();
      }
    });
    chip.append(remove);
  }

  return chip;
}

function insertReferenceTokenIntoEditor(
  editor: HTMLDivElement,
  token: ReferenceEditorToken,
  onRemoveReference: (id: string) => void
) {
  editor.focus();
  const selection = window.getSelection();
  const range = getEditorInsertionRange(editor, selection);
  const fragment = document.createDocumentFragment();
  const hasContent = readReferenceEditorText(editor).trim().length > 0;

  if (hasContent) fragment.append(document.createTextNode(" "));
  fragment.append(createReferenceTokenNode(token, onRemoveReference));
  const trailingSpace = document.createTextNode(" ");
  fragment.append(trailingSpace);
  range.deleteContents();
  range.insertNode(fragment);
  placeCaretAfterNode(trailingSpace);
}

function getEditorInsertionRange(editor: HTMLDivElement, selection: Selection | null): Range {
  if (selection?.rangeCount) {
    const range = selection.getRangeAt(0);
    if (editor.contains(range.commonAncestorContainer)) return range;
  }

  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  return range;
}

function readReferenceEditorText(editor: HTMLElement): string {
  return readReferenceEditorNodeText(editor).replace(/\u00a0/g, " ");
}

function readReferenceEditorNodeText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (!(node instanceof HTMLElement)) return "";
  if (node.dataset.referenceToken === "true") return node.dataset.referenceLabel ?? "";
  if (node.tagName === "BR") return "\n";

  const childText = Array.from(node.childNodes).map(readReferenceEditorNodeText).join("");
  if (node.tagName === "DIV" || node.tagName === "P") return `${childText}\n`;
  return childText;
}

function updateReferenceEditorEmptyState(editor: HTMLElement) {
  editor.toggleAttribute("data-empty", readReferenceEditorText(editor).trim().length === 0);
}

function moveCaretToEditorEnd(editor: HTMLElement) {
  editor.focus();
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function placeCaretAfterNode(node: Node) {
  const range = document.createRange();
  range.setStartAfter(node);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function removeAdjacentReferenceToken(
  editor: HTMLDivElement | null,
  key: "Backspace" | "Delete",
  onRemoveReference: (id: string) => void
): boolean {
  if (!editor) return false;
  const selection = window.getSelection();
  if (!selection?.rangeCount || !selection.isCollapsed) return false;
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.startContainer)) return false;

  const token = key === "Backspace"
    ? getReferenceTokenBeforeCaret(editor, range)
    : getReferenceTokenAfterCaret(editor, range);
  if (!token) return false;

  const referenceId = token.dataset.referenceId;
  token.remove();
  if (referenceId) onRemoveReference(referenceId);
  updateReferenceEditorEmptyState(editor);
  return true;
}

function getReferenceTokenBeforeCaret(editor: HTMLElement, range: Range): HTMLElement | null {
  const container = range.startContainer;
  const offset = range.startOffset;
  if (container.nodeType === Node.TEXT_NODE && offset > 0) return null;
  const candidate = container.nodeType === Node.TEXT_NODE
    ? getPreviousSignificantSibling(container)
    : getChildBeforeOffset(container, offset) ?? getPreviousSignificantSibling(container);
  return getReferenceTokenElement(candidate, editor);
}

function getReferenceTokenAfterCaret(editor: HTMLElement, range: Range): HTMLElement | null {
  const container = range.startContainer;
  const offset = range.startOffset;
  if (container.nodeType === Node.TEXT_NODE && offset < (container.textContent?.length ?? 0)) return null;
  const candidate = container.nodeType === Node.TEXT_NODE
    ? getNextSignificantSibling(container)
    : getChildAfterOffset(container, offset) ?? getNextSignificantSibling(container);
  return getReferenceTokenElement(candidate, editor);
}

function getChildBeforeOffset(container: Node, offset: number): Node | null {
  return container.childNodes[Math.max(0, offset - 1)] ?? null;
}

function getChildAfterOffset(container: Node, offset: number): Node | null {
  return container.childNodes[offset] ?? null;
}

function getPreviousSignificantSibling(node: Node): Node | null {
  let current: Node | null = node.previousSibling;
  while (current && current.nodeType === Node.TEXT_NODE && !current.textContent?.trim()) {
    current = current.previousSibling;
  }
  return current;
}

function getNextSignificantSibling(node: Node): Node | null {
  let current: Node | null = node.nextSibling;
  while (current && current.nodeType === Node.TEXT_NODE && !current.textContent?.trim()) {
    current = current.nextSibling;
  }
  return current;
}

function getReferenceTokenElement(node: Node | null, editor: HTMLElement): HTMLElement | null {
  if (!node || !editor.contains(node)) return null;
  if (node instanceof HTMLElement && node.dataset.referenceToken === "true") return node;
  if (node.parentElement?.dataset.referenceToken === "true") return node.parentElement;
  return null;
}

function getNextReferenceLabel(references: AnnotationReference[]): string {
  const used = new Set(references.map((item) => Number(item.label.match(/\d+/)?.[0])).filter((value) => Number.isFinite(value)));
  let next = 2;
  while (used.has(next)) next += 1;
  return `对象 ${next}`;
}

function getReferenceTitle(reference: AnnotationReference): string {
  const id = reference.element.id ? `#${reference.element.id}` : "";
  const className = reference.element.className
    ? `.${reference.element.className.trim().split(/\s+/).slice(0, 2).join(".")}`
    : "";
  return `${reference.element.tag}${id}${className}`;
}

function MeasureLayer({
  anchor,
  hover,
  pinnedMeasurements,
  removable,
  onRemovePinned
}: {
  anchor: HoverInspection | null;
  hover: HoverInspection | null;
  pinnedMeasurements: PinnedMeasurement[];
  removable: boolean;
  onRemovePinned: (key: string) => void;
}) {
  const liveAnchor = anchor ? getLiveInspection(anchor) : null;
  const liveHover = hover ? getLiveInspection(hover) : null;
  const measurements = liveAnchor && liveHover && !isSameInspectionTarget(liveAnchor, liveHover)
    ? getElementDistanceLines(liveAnchor.documentRect, liveHover.documentRect)
    : [];

  return (
    <>
      {pinnedMeasurements.map((item) => (
        <MeasurementPair key={item.key} pair={item} removable={removable} onRemove={() => onRemovePinned(item.key)} />
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

function MeasurementPair({ pair, removable, onRemove }: { pair: PinnedMeasurement; removable: boolean; onRemove: () => void }) {
  const from = getLiveInspection(pair.from);
  const to = getLiveInspection(pair.to);
  const measurements = getElementDistanceLines(from.documentRect, to.documentRect);

  return (
    <div
      className={`dom-ai-measure-pinned-group ${removable ? "dom-ai-measure-pinned-group-removable dom-ai-interactive" : ""}`}
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
      {measurements.length ? <MeasurementOverlay measurements={measurements} idPrefix={pair.key} removable={removable} onRemove={onRemove} /> : (
        <div
          className={`dom-ai-measure-label ${removable ? "dom-ai-measure-remove-target" : ""}`}
          title={removable ? "点击移除此比例尺" : undefined}
          style={{
            left: (from.documentRect.x + to.documentRect.x + to.documentRect.width) / 2,
            top: (from.documentRect.y + to.documentRect.y + to.documentRect.height) / 2
          }}
          onClick={removable ? (event) => {
            event.preventDefault();
            event.stopPropagation();
            onRemove();
          } : undefined}
          onPointerDown={removable ? (event) => {
            event.preventDefault();
            event.stopPropagation();
          } : undefined}
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
  const fontFamily = getPrimaryFontFamily(inspection.fontFamily);
  const reviewSummary = [
    size,
    `${compactUnitValue(inspection.fontSize)} / ${compactUnitValue(inspection.lineHeight)}`,
    fontFamily,
    formatColor(inspection.color, "rgb"),
    `opacity ${inspection.opacity || "-"}`
  ].filter(Boolean).join(" · ");
  const advancedSummary = [
    inspection.display && `display: ${inspection.display}`,
    inspection.position && `position: ${inspection.position}`,
    inspection.zIndex && `z-index: ${inspection.zIndex}`,
    inspection.gap && inspection.gap !== "normal" && `gap: ${inspection.gap}`
  ].filter(Boolean).join(" · ");

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
    <div className="mt-2 space-y-1.5">
      <div className="flex items-center gap-1.5 px-0.5 text-[11px] font-extrabold text-ink-800">
        <Palette size={13} />
        <span>元素样式</span>
      </div>

      <details className="dom-ai-style-details group rounded-lg bg-ink-50/80">
        <summary className="flex h-8 cursor-pointer list-none items-center gap-2 px-2 text-[10px] font-bold text-ink-400 transition-colors duration-150 hover:text-ink-700">
          <span className="inline-flex w-full min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap">
            <ChevronDown size={12} className="shrink-0 transition-transform duration-150 group-open:rotate-180" />
            <Palette size={12} className="shrink-0" />
            <span className="shrink-0 text-ink-600">设计验收</span>
            <span className="shrink-0">关键属性</span>
            <span className="min-w-0 flex-1 truncate font-mono">{reviewSummary}</span>
          </span>
        </summary>

        <div className="space-y-1.5 p-1 pt-0">
          <div className="grid grid-cols-3 rounded-lg bg-white shadow-[inset_0_0_0_1px_rgba(17,24,39,0.07)]">
            <LightMetric icon={<Ruler size={13} />} label="尺寸" value={size} copied={copiedKey === "尺寸"} onCopy={copyMetric} />
            <LightMetric icon={<Type size={13} />} label="字号 / 行高" value={`${compactUnitValue(inspection.fontSize)} / ${compactUnitValue(inspection.lineHeight)}`} copied={copiedKey === "字号 / 行高"} onCopy={copyMetric} />
            <LightMetric label="字重" value={inspection.fontWeight} copied={copiedKey === "字重"} onCopy={copyMetric} />
            <LightMetric label="圆角" value={inspection.borderRadius} copied={copiedKey === "圆角"} onCopy={copyMetric} />
            <LightMetric label="内边距" value={inspection.padding} copied={copiedKey === "内边距"} onCopy={copyMetric} />
            <LightMetric label="透明度" value={inspection.opacity} copied={copiedKey === "透明度"} onCopy={copyMetric} />
            <LightMetric className="col-span-3" label="字体" value={fontFamily} copied={copiedKey === "字体"} onCopy={copyMetric} />
          </div>

          <div className="grid grid-cols-3 gap-1 rounded-lg bg-ink-100 p-0.5">
            {(["rgb", "hex", "hsl"] as ColorMode[]).map((mode) => (
              <button
                key={mode}
                className={`h-6 rounded-md text-[10px] font-extrabold uppercase transition-[background-color,color,box-shadow,transform] duration-150 active:scale-[0.96] ${
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
          <div className="grid grid-cols-2 gap-1.5">
            <LightColorMetric label="文字 · Text" value={inspection.color} mode={colorMode} copied={copiedKey === "文字 · Text"} onCopy={copyMetric} />
            <LightColorMetric label="背景 · BG" value={inspection.backgroundColor} mode={colorMode} copied={copiedKey === "背景 · BG"} onCopy={copyMetric} />
          </div>
        </div>
      </details>

      <details className="dom-ai-style-details group rounded-lg bg-ink-50/80">
        <summary className="flex h-8 cursor-pointer list-none items-center gap-2 px-2 text-[10px] font-bold text-ink-400 transition-colors duration-150 hover:text-ink-700">
          <span className="inline-flex w-full min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap">
            <ChevronDown size={12} className="shrink-0 transition-transform duration-150 group-open:rotate-180" />
            <Code2 size={12} className="shrink-0" />
            <span className="shrink-0 text-ink-600">开发属性</span>
            <span className="min-w-0 flex-1 truncate font-mono">{advancedSummary || "display: - · position: - · z-index: - · gap: -"}</span>
          </span>
        </summary>
        <div className="grid grid-cols-3 gap-1 p-1 pt-0">
          <LightMetric label="Display" value={inspection.display} copied={copiedKey === "Display"} onCopy={copyMetric} />
          <LightMetric label="Position" value={inspection.position} copied={copiedKey === "Position"} onCopy={copyMetric} />
          <LightMetric label="Z-index" value={inspection.zIndex} copied={copiedKey === "Z-index"} onCopy={copyMetric} />
          <LightMetric label="Gap" value={inspection.gap} copied={copiedKey === "Gap"} onCopy={copyMetric} />
        </div>
      </details>
    </div>
  );
}

function LightMetric({
  icon,
  label,
  value,
  className = "",
  copied,
  onCopy
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  className?: string;
  copied: boolean;
  onCopy: (label: string, value: string) => void;
}) {
  return (
    <button
      className={`min-w-0 bg-white/35 px-2 py-1.5 text-left shadow-[inset_-1px_-1px_0_rgba(17,24,39,0.07)] transition-[background-color,box-shadow,transform] duration-150 hover:bg-white hover:shadow-[inset_0_0_0_1px_rgba(15,159,120,0.26)] active:scale-[0.96] ${className}`}
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

function MeasurementOverlay({
  measurements,
  idPrefix,
  removable = false,
  onRemove
}: {
  measurements: MeasurementLine[];
  idPrefix: string;
  removable?: boolean;
  onRemove?: () => void;
}) {
  const removeHandlers = removable && onRemove ? {
    title: "点击移除此比例尺",
    onClick: (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      onRemove();
    },
    onPointerDown: (event: React.PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
    }
  } : {};

  return (
    <>
      {measurements.map((measurement) => (
        <div key={`${idPrefix}-${measurement.key}`}>
          <div
            className={`dom-ai-measure-line dom-ai-measure-line-${measurement.orientation} ${removable ? "dom-ai-measure-remove-target" : ""}`}
            style={{
              left: measurement.x,
              top: measurement.y,
              width: measurement.orientation === "horizontal" ? measurement.length : undefined,
              height: measurement.orientation === "vertical" ? measurement.length : undefined
            }}
            {...removeHandlers}
          />
          <div
            className={`dom-ai-measure-label ${removable ? "dom-ai-measure-remove-target" : ""}`}
            style={{ left: measurement.labelX, top: measurement.labelY }}
            {...removeHandlers}
          >
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
      <div className="mt-1 grid grid-cols-3 gap-1 rounded-lg bg-ink-100 p-0.5">
        {options.map((option) => (
          <button
            key={option}
            className={`h-7 rounded-md text-[11px] font-bold transition-[background-color,color,box-shadow,transform] duration-150 active:scale-[0.96] ${
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
  const pathElement = path.find((node): node is Element => node instanceof Element && !isInjectedElement(node));
  if (pathElement) return pathElement;

  const hitElement = document.elementFromPoint(event.clientX, event.clientY);
  if (!hitElement || isInjectedElement(hitElement)) return null;
  return hitElement;
}

function shouldDeferPointerToEmbeddedContent(event: MouseEvent): boolean {
  if (isEmbeddedFrameWindow()) return false;
  return document.elementsFromPoint(event.clientX, event.clientY).some(isEmbeddedContentHost);
}

function isPointerLeavingForEmbeddedContent(event: MouseEvent): boolean {
  if (isEmbeddedFrameWindow()) return false;
  if (event.relatedTarget instanceof Element && isEmbeddedContentHost(event.relatedTarget)) return true;
  return shouldDeferPointerToEmbeddedContent(event);
}

function isEmbeddedContentHost(element: Element): boolean {
  const tagName = element.tagName.toLowerCase();
  return tagName === "iframe" || tagName === "wujie-app" || element.hasAttribute("data-micro-src");
}

function getAnnotationElement(annotation: DomAnnotation): Element | null {
  return resolveStoredElement({
    selector: annotation.selector,
    xpath: annotation.xpath,
    element: annotation.element,
    rect: getSavedAnnotationDocumentRect(annotation)
  });
}

function getReferenceElement(reference: AnnotationReference): Element | null {
  return resolveStoredElement({
    selector: reference.selector,
    xpath: reference.xpath,
    element: reference.element,
    rect: getSavedReferenceDocumentRect(reference)
  });
}

function resolveStoredElement(target: {
  selector: string;
  xpath?: string;
  element: DomAnnotation["element"];
  rect: HoverInspection["documentRect"];
}): Element | null {
  const selectorCandidate = querySelectorDeep(target.selector);
  if (selectorCandidate && elementMatchesStoredSummary(selectorCandidate, target.element)) {
    return selectorCandidate;
  }

  const xpathCandidate = target.xpath ? queryXPathElement(target.xpath) : null;
  if (xpathCandidate && elementMatchesStoredSummary(xpathCandidate, target.element)) {
    return xpathCandidate;
  }

  const closest = findClosestElementByStoredSummary(target.element, target.rect);
  if (closest) return closest;

  return selectorCandidate ?? xpathCandidate;
}

function queryXPathElement(xpath: string): Element | null {
  if (!xpath || xpath.includes("/shadow-root/")) return null;
  try {
    const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    return result.singleNodeValue instanceof Element ? result.singleNodeValue : null;
  } catch {
    return null;
  }
}

function elementMatchesStoredSummary(element: Element, summary: DomAnnotation["element"]): boolean {
  const htmlElement = element as HTMLElement;
  if (summary.tag && element.tagName.toLowerCase() !== summary.tag) return false;
  if (summary.id && htmlElement.id !== summary.id) return false;
  if (summary.ariaLabel && element.getAttribute("aria-label") !== summary.ariaLabel) return false;

  const currentText = normalizeComparableText(htmlElement.innerText || htmlElement.textContent || "");
  const savedText = normalizeComparableText(summary.text || "");
  if (savedText) {
    if (!currentText) return false;
    return currentText === savedText || currentText.startsWith(savedText) || savedText.startsWith(currentText);
  }

  if (summary.className) {
    const savedClasses = summary.className.trim().split(/\s+/).filter(Boolean);
    if (savedClasses.length && !savedClasses.every((className) => element.classList.contains(className))) return false;
  }

  return true;
}

function findClosestElementByStoredSummary(summary: DomAnnotation["element"], savedRect: HoverInspection["documentRect"]): Element | null {
  const tag = summary.tag || "*";
  const candidates = Array.from(document.getElementsByTagName(tag))
    .filter((element) => elementMatchesStoredSummary(element, summary));
  if (!candidates.length) return null;

  return candidates
    .map((element) => ({ element, distance: getElementDistanceFromSavedRect(element, savedRect) }))
    .sort((a, b) => a.distance - b.distance)[0]?.element ?? null;
}

function getElementDistanceFromSavedRect(element: Element, savedRect: HoverInspection["documentRect"]): number {
  const rect = element.getBoundingClientRect();
  const x = rect.left + window.scrollX;
  const y = rect.top + window.scrollY;
  return Math.abs(x - savedRect.x) + Math.abs(y - savedRect.y);
}

function normalizeComparableText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function notifyFrameHoverActive(context: PageContext, lastSignalRef: React.MutableRefObject<number>) {
  const now = performance.now();
  if (now - lastSignalRef.current < 80) return;
  lastSignalRef.current = now;
  void chrome.runtime.sendMessage({ type: "DOM_AI_FRAME_HOVER_ACTIVE", frameId: context.frameId });
}

function isAnnotationForCurrentDocument(annotation: DomAnnotation, context: PageContext): boolean {
  if (!annotation.context) return annotation.url === location.href;

  const sameContextUrl = normalizeContextUrl(annotation.context.url) === normalizeContextUrl(context.url);
  const sameAnnotationUrl = normalizeContextUrl(annotation.url) === normalizeContextUrl(context.url);

  if (
    annotation.context.frameId !== undefined &&
    context.frameId !== undefined &&
    annotation.context.frameId === context.frameId &&
    sameContextUrl
  ) {
    return true;
  }

  if (annotation.context.kind === "wujie" || annotation.context.kind === "micro-app") {
    const annotationTopUrl = annotation.context.topUrl || annotation.context.url;
    const currentTopUrl = context.topUrl || context.url;
    return normalizeContextUrl(annotationTopUrl) === normalizeContextUrl(currentTopUrl);
  }

  return sameContextUrl || sameAnnotationUrl;
}

function normalizeContextUrl(value: string | undefined): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.pathname !== "/" && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }
    return url.toString();
  } catch {
    return value.replace(/\/+$/, "");
  }
}

function getAnnotationPageContext(element: Element, baseContext: PageContext): PageContext {
  const ancestors = getElementComposedAncestors(element);
  const wujieHost = ancestors.find((item) => item.tagName.toLowerCase() === "wujie-app");
  if (wujieHost) {
    const hostUrl = wujieHost.getAttribute("data-wujie-url") || undefined;
    return {
      ...baseContext,
      kind: "wujie",
      url: hostUrl || baseContext.url,
      title: document.title,
      topUrl: baseContext.topUrl || location.href,
      topTitle: baseContext.topTitle || document.title,
      hostSelector: getCssSelector(wujieHost),
      hostUrl
    };
  }

  const microHost = ancestors.find((item) => item.hasAttribute("data-micro-src"));
  if (microHost) {
    const hostUrl = microHost.getAttribute("data-micro-src") || undefined;
    return {
      ...baseContext,
      kind: "micro-app",
      url: hostUrl || baseContext.url,
      title: document.title,
      topUrl: baseContext.topUrl || location.href,
      topTitle: baseContext.topTitle || document.title,
      hostSelector: getCssSelector(microHost),
      hostUrl
    };
  }

  return baseContext;
}

function getElementComposedAncestors(element: Element): Element[] {
  const ancestors: Element[] = [];
  let current: Element | null = element;

  while (current) {
    ancestors.push(current);
    if (current.parentElement) {
      current = current.parentElement;
      continue;
    }

    const root = current.getRootNode();
    current = root instanceof ShadowRoot && root.host instanceof Element ? root.host : null;
  }

  return ancestors;
}

function isEmbeddedFrameWindow(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

function isPrimaryPointerSelection(event: PointerEvent): boolean {
  return event.isPrimary !== false && event.button === 0;
}

function isInjectedElement(element: Element): boolean {
  if (element.id === ROOT_ID) return true;
  if (element.closest?.(`#${ROOT_ID}`)) return true;
  const className = typeof (element as HTMLElement).className === "string" ? (element as HTMLElement).className : "";
  if (className.split(/\s+/).some((name) => name.startsWith("dom-ai-"))) return true;
  const root = element.getRootNode();
  return root instanceof ShadowRoot && root.host instanceof Element && root.host.id === ROOT_ID;
}

function isInjectedEvent(event: Event): boolean {
  return event.composedPath().some((node) => node instanceof Element && isInjectedElement(node));
}

function suppressNextPageClick() {
  let timeout = 0;
  const cleanup = () => {
    window.clearTimeout(timeout);
    window.removeEventListener("click", blockClick, true);
    document.removeEventListener("click", blockClick, true);
  };
  const blockClick = (event: MouseEvent) => {
    if (isInjectedEvent(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    cleanup();
  };

  window.addEventListener("click", blockClick, true);
  document.addEventListener("click", blockClick, true);
  timeout = window.setTimeout(cleanup, 800);
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

function createAnnotationReference(element: Element, label: string, context: PageContext): AnnotationReference {
  const draft = createAnnotationDraft(element, undefined, context);
  return {
    id: crypto.randomUUID(),
    label,
    role: "reference",
    url: draft.url,
    title: draft.title,
    selector: draft.selector,
    xpath: draft.xpath,
    context: draft.context,
    element: draft.element,
    rect: draft.rect,
    viewport: draft.viewport,
    computedStyles: draft.computedStyles
  };
}

function isSameAnnotationReferenceTarget(
  a: Pick<AnnotationReference | AnnotationDraft, "selector" | "url" | "context">,
  b: Pick<AnnotationReference | AnnotationDraft, "selector" | "url" | "context">
): boolean {
  const aContextUrl = normalizeContextUrl(a.context?.url || a.url);
  const bContextUrl = normalizeContextUrl(b.context?.url || b.url);
  return a.selector === b.selector && aContextUrl === bContextUrl;
}

function getInspectionForAnnotation(annotation: DomAnnotation): HoverInspection {
  const liveElement = getAnnotationElement(annotation);
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
  const liveElement = getAnnotationElement(annotation);
  if (liveElement) {
    const rect = liveElement.getBoundingClientRect();
    return {
      x: rect.left + window.scrollX,
      y: rect.top + window.scrollY,
      width: rect.width,
      height: rect.height
    };
  }

  return getSavedAnnotationDocumentRect(annotation);
}

function getReferenceDocumentRect(reference: AnnotationReference): HoverInspection["documentRect"] {
  const liveElement = getReferenceElement(reference);
  if (liveElement) {
    const rect = liveElement.getBoundingClientRect();
    return {
      x: rect.left + window.scrollX,
      y: rect.top + window.scrollY,
      width: rect.width,
      height: rect.height
    };
  }

  return getSavedReferenceDocumentRect(reference);
}

function getSavedAnnotationDocumentRect(annotation: DomAnnotation): HoverInspection["documentRect"] {
  return {
    x: annotation.rect.x + annotation.rect.scrollX,
    y: annotation.rect.y + annotation.rect.scrollY,
    width: annotation.rect.width,
    height: annotation.rect.height
  };
}

function getSavedReferenceDocumentRect(reference: AnnotationReference): HoverInspection["documentRect"] {
  return {
    x: reference.rect.x + reference.rect.scrollX,
    y: reference.rect.y + reference.rect.scrollY,
    width: reference.rect.width,
    height: reference.rect.height
  };
}

function getAnnotationBorderRadius(annotation: DomAnnotation): string | undefined {
  const liveElement = getAnnotationElement(annotation);
  if (liveElement) return normalizeBorderRadius(window.getComputedStyle(liveElement).borderRadius);
  return normalizeBorderRadius(annotation.computedStyles.borderRadius);
}

function getReferenceBorderRadius(reference: AnnotationReference): string | undefined {
  const liveElement = getReferenceElement(reference);
  if (liveElement) return normalizeBorderRadius(window.getComputedStyle(liveElement).borderRadius);
  return normalizeBorderRadius(reference.computedStyles.borderRadius);
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

function compactUnitValue(value: string): string {
  if (!value) return "-";
  return compactPx(value);
}

function getPrimaryFontFamily(value: string): string {
  const [primary] = value.split(",");
  return (primary || value).trim().replace(/^["']|["']$/g, "") || "-";
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
  scrollToDocumentRect(rect);
}

function focusReference(reference: AnnotationReference) {
  const rect = getReferenceDocumentRect(reference);
  scrollToDocumentRect(rect);
}

function scrollToDocumentRect(rect: HoverInspection["documentRect"]) {
  const maxTop = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const targetTop = Math.min(maxTop, Math.max(0, rect.y - 120));
  window.scrollTo({
    top: targetTop,
    left: 0,
    behavior: "smooth"
  });
}

async function captureAnnotationScreenshotData(selector: string, savedRect: ElementRect): Promise<AnnotationScreenshot | undefined> {
  try {
    const viewportRect = getCurrentViewportRectForCapture(selector, savedRect);
    if (!viewportRect) return undefined;
    const response = await captureVisibleTabWithoutOverlay(viewportRect);
    if (!response?.success || !response.data) return undefined;
    const cropped = await cropScreenshot(response.data.dataUrl, viewportRect, window.devicePixelRatio);
    return {
      dataUrl: cropped,
      capturedAt: response.data.capturedAt,
      visibleRect: response.data.visibleRect
    };
  } catch {
    return undefined;
  }
}

async function captureVisibleTabWithoutOverlay(viewportRect: RectSnapshot): Promise<{ success: boolean; data?: { dataUrl: string; capturedAt: string; visibleRect: AnnotationScreenshot["visibleRect"] } }> {
  const host = document.getElementById(ROOT_ID);
  const previousVisibility = host?.style.visibility;
  if (host) host.style.visibility = "hidden";
  await nextAnimationFrame();
  try {
    return await chrome.runtime.sendMessage({
      type: "DOM_AI_CAPTURE_SCREENSHOT",
      rect: {
        x: Math.round(viewportRect.x),
        y: Math.round(viewportRect.y),
        width: Math.round(viewportRect.width),
        height: Math.round(viewportRect.height),
      },
    });
  } finally {
    if (host) host.style.visibility = previousVisibility ?? "";
  }
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function getCurrentViewportRectForCapture(selector: string, savedRect: ElementRect): RectSnapshot | null {
  const liveElement = querySelectorDeep(selector);
  if (liveElement) {
    const rect = liveElement.getBoundingClientRect();
    const topOffset = getFrameViewportOffsetToTop();
    if (!topOffset) return null;
    return {
      x: rect.x + topOffset.x,
      y: rect.y + topOffset.y,
      width: rect.width,
      height: rect.height
    };
  }

  const topOffset = getFrameViewportOffsetToTop();
  if (!topOffset) return null;
  return {
    x: savedRect.x + savedRect.scrollX - window.scrollX + topOffset.x,
    y: savedRect.y + savedRect.scrollY - window.scrollY + topOffset.y,
    width: savedRect.width,
    height: savedRect.height
  };
}

function getFrameViewportOffsetToTop(): { x: number; y: number } | null {
  let current: Window = window;
  let x = 0;
  let y = 0;

  while (true) {
    if (current === current.top) return { x, y };

    try {
      const frameElement = current.frameElement;
      if (!frameElement) return null;
      const rect = frameElement.getBoundingClientRect();
      x += rect.left;
      y += rect.top;
      current = current.parent;
    } catch {
      return null;
    }
  }
}

function cropScreenshot(fullDataUrl: string, rect: { x: number; y: number; width: number; height: number }, dpr: number): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const sx = Math.max(0, Math.round(rect.x * dpr));
      const sy = Math.max(0, Math.round(rect.y * dpr));
      const ex = Math.min(img.width, Math.round((rect.x + rect.width) * dpr));
      const ey = Math.min(img.height, Math.round((rect.y + rect.height) * dpr));
      const sw = ex - sx;
      const sh = ey - sy;
      if (sw <= 0 || sh <= 0) { resolve(fullDataUrl); return; }
      const scale = Math.min(1, MAX_ANNOTATION_SCREENSHOT_DIMENSION / sw, MAX_ANNOTATION_SCREENSHOT_DIMENSION / sh);
      const canvas = document.createElement("canvas");
      canvas.width = sw;
      canvas.height = sh;
      if (scale < 1) {
        canvas.width = Math.max(1, Math.round(sw * scale));
        canvas.height = Math.max(1, Math.round(sh * scale));
      }
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
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
  host.style.cssText = "position: fixed; inset: 0; width: 100vw; height: 100vh; overflow: visible; pointer-events: none; z-index: 2147483647;";
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = cssText;
  const app = document.createElement("div");
  shadow.append(style, app);
  document.documentElement.appendChild(host);
  createRoot(app).render(<App />);
}

mount();
