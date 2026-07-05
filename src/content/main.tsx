import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Check,
  ChevronDown,
  Link2,
  MessageCircle,
  RotateCcw,
  Ruler,
  Settings2,
  X
} from "lucide-react";
import cssText from "./content.css?inline";
import { MEASURE_COLORS, getElementDistanceLines } from "./measurementModel";
import type { MeasurementLine, PinnedMeasurement } from "./measurementModel";
import { createAnnotationDraft, getCssSelector, querySelectorDeep } from "./selector";
import {
  FONT_WEIGHT_OPTIONS,
  applyEditableStyleValue,
  captureInlineStyleSnapshot,
  compactPxNumber,
  createEditableStyleBaselineValues,
  createEditableStyleValues,
  createEditableStyleValuesWithChanges,
  cssColorToNativeInput,
  formatColor,
  formatNumericStyleValue,
  getBoxValue,
  getComputedBoxSnapshot,
  getEditableElementText,
  getEditableStyleChanges,
  getEditableStylePropertyForChange,
  getElementStyleTitle,
  getNumericAdjusterConfigs,
  isLayoutStyleRelevant,
  isTextContentEditable,
  isTextStyleRelevant,
  pxNumber,
  restoreInlineStyle,
  restoreInlineStyleSnapshot,
  roundToPrecision,
  setEditableElementText,
  styleValueMatches,
  swatchBackground
} from "./styleModel";
import type {
  ActiveNumericScrub,
  BoxSpacingProperty,
  EditableStyleValues,
  HoverInspection,
  IframeSelectionPayload,
  InlineStyleSnapshot,
  NumericAdjusterConfig,
  NumericAdjusterConfigs,
  NumericChangeHandler,
  NumericDragHandler,
  RectSnapshot,
  SerializableHoverInspection,
  StyleEditorHandle
} from "./styleTypes";
import { isExcludedUrl } from "../shared/excludedUrls";
import type { AnnotationDraft, AnnotationPinAnchor, AnnotationReference, AnnotationScreenshot, AnnotationStatus, AnnotationStyleChange, ContentMessage, DomAnnotation, ElementRect, FeedbackSeverity, MonitorEvent, MonitorSnapshot, PageContext } from "../shared/types";
import { deleteAnnotation, getAnnotations, saveAnnotation, subscribeAnnotations, updateAnnotationScreenshot, updateAnnotationStatus } from "../shared/storage";
import { getPinPalette, getStatusLabel, normalizeAnnotationStatus, severityLabels, statusLabels } from "../shared/status";
import { getVisibleAnnotationComment } from "../shared/styleChanges";
import { getAnnotationTitle } from "../shared/annotationDisplay";

const ROOT_ID = "dom-ai-annotator-root";
const COMPOSER_WIDTH = 360;
const COMPOSER_ESTIMATED_HEIGHT = 400;
const COMPOSER_MIN_VISIBLE_HEIGHT = 360;
const COMPOSER_COMPACT_ESTIMATED_HEIGHT = 62;
const EDGE_GAP = 16;
const PIN_COLLAPSED_WIDTH = 32;
const PIN_COLLAPSED_HEIGHT = 28;
const PIN_EXPANDED_WIDTH = 380;
const PIN_CARD_ESTIMATED_HEIGHT = 318;
const PIN_GAP = 8;
const HOVER_LABEL_GAP = 8;
const HOVER_LABEL_HEIGHT = 34;
const HOVER_LABEL_MAX_WIDTH = 320;
const HOVER_LABEL_VIEWPORT_GAP = 8;
const MAX_ANNOTATION_SCREENSHOT_DIMENSION = 960;
const MONITOR_SCRIPT_ID = "dom-ai-monitor-bridge-script";
const MAX_MONITOR_EVENTS = 400;
const MONITOR_EVENT_NAME = "dom-ai-monitor-event";
const INITIAL_PIN_REFRESH_DELAYS = [250, 800, 1800, 3500, 6000];
const PANEL_VISIBILITY_EVENT = "dom-ai-panel-visibility";
const FLEX_DIRECTION_OPTIONS: SelectStyleOption[] = [
  { value: "row", label: "水平" },
  { value: "column", label: "垂直" },
  { value: "row-reverse", label: "水平反向" },
  { value: "column-reverse", label: "垂直反向" }
];
const GRID_AUTO_FLOW_OPTIONS: SelectStyleOption[] = [
  { value: "row", label: "水平" },
  { value: "row-reverse", label: "水平反向" },
  { value: "column", label: "垂直" },
  { value: "column-reverse", label: "垂直反向" }
];
const JUSTIFY_CONTENT_OPTIONS: SelectStyleOption[] = [
  { value: "flex-start", label: "开始" },
  { value: "center", label: "居中" },
  { value: "flex-end", label: "结束" },
  { value: "space-between", label: "两端对齐" },
  { value: "space-around", label: "四周留白" },
  { value: "space-evenly", label: "均匀分布" }
];
const ALIGN_ITEMS_OPTIONS: SelectStyleOption[] = [
  { value: "flex-start", label: "起始" },
  { value: "center", label: "居中" },
  { value: "flex-end", label: "结束" },
  { value: "stretch", label: "拉伸" },
  { value: "baseline", label: "基线" }
];
const DEFAULT_FONT_FAMILY_OPTIONS: SelectStyleOption[] = [
  { value: "Inter", label: "Inter" },
  { value: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif", label: "System" },
  { value: "Arial", label: "Arial" },
  { value: "serif", label: "Serif" },
  { value: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", label: "Mono" }
];
const PAGE_FONT_SCAN_LIMIT = 3000;
const COMMENT_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    <path d="M8.2 25.8v-5.2A8.7 8.7 0 0 1 5.5 14.2C5.5 9 9.7 5 15.1 5h4.7c5.4 0 9.7 4 9.7 9.2s-4.3 9.2-9.7 9.2h-6.4l-5.2 2.4Z" fill="white" stroke="black" stroke-width="3.2" stroke-linejoin="round"/>
    <path d="M8.2 25.8v-5.2A8.7 8.7 0 0 1 5.5 14.2C5.5 9 9.7 5 15.1 5h4.7c5.4 0 9.7 4 9.7 9.2s-4.3 9.2-9.7 9.2h-6.4l-5.2 2.4Z" fill="white" stroke="white" stroke-width="1.2" stroke-linejoin="round"/>
    <path d="M13.3 14.2h.01M17.5 14.2h.01M21.7 14.2h.01" stroke="#0f9f78" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M8.2 25.8v-5.2" stroke="#0f9f78" stroke-width="1.4" stroke-linecap="round"/>
  </svg>`
)}") 9 9, crosshair`;
const NUMERIC_SCRUB_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M8 1 11 4H9v4H7V4H5l3-3Z" fill="#475569"/>
    <path d="M8 15 5 12h2V8h2v4h2l-3 3Z" fill="#475569"/>
  </svg>`
)}") 8 8, ns-resize`;

type ComposerState = {
  draft: AnnotationDraft;
  inspection: HoverInspection;
  initialScreenshot?: AnnotationScreenshot;
  editingAnnotation?: DomAnnotation;
  remoteInlineStyleSnapshot?: InlineStyleSnapshot;
  fontFamilies?: string[];
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

type SelectStyleOption = {
  value: string;
  label: string;
};

type RemoteStyleTarget = {
  frameId?: number;
  selector: string;
  inlineStyleSnapshot: InlineStyleSnapshot;
  textContent: string;
};

type ViewportOffset = {
  x: number;
  y: number;
};

type DocumentSize = {
  width: number;
  height: number;
};

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

function postIframeSelectionToParent(payload: IframeSelectionPayload) {
  if (!isEmbeddedFrameWindow()) return false;
  window.parent.postMessage({
    source: "DOM_AI_ANNOTATOR",
    type: "DOM_AI_IFRAME_SELECTION_READY",
    payload
  }, "*");
  return true;
}

function shouldHandleRemoteStyleMessage(messageFrameId: number | undefined, context: PageContext): boolean {
  return context.frameId !== undefined && messageFrameId === context.frameId;
}

function getRemoteStyleElement(selector: string): HTMLElement | null {
  const element = querySelectorDeep(selector);
  return element instanceof HTMLElement ? element : null;
}

function applyRemoteStyleMessage(
  message: Extract<ContentMessage, { type: "DOM_AI_REMOTE_STYLE_APPLY" }>,
  context: PageContext
) {
  if (!shouldHandleRemoteStyleMessage(message.frameId, context)) return;
  const element = getRemoteStyleElement(message.selector);
  if (!element) return;
  applyEditableStyleValue(element, message.cssProperty, message.value);
}

function restoreRemoteStylePropertyMessage(
  message: Extract<ContentMessage, { type: "DOM_AI_REMOTE_STYLE_RESTORE_PROPERTY" }>,
  context: PageContext
) {
  if (!shouldHandleRemoteStyleMessage(message.frameId, context)) return;
  const element = getRemoteStyleElement(message.selector);
  if (!element) return;
  restoreInlineStyle(element, message.cssProperty, message.snapshot);
}

function restoreRemoteStyleMessage(
  message: Extract<ContentMessage, { type: "DOM_AI_REMOTE_STYLE_RESTORE" }>,
  context: PageContext
) {
  if (!shouldHandleRemoteStyleMessage(message.frameId, context)) return;
  const element = getRemoteStyleElement(message.selector);
  if (!element) return;
  restoreInlineStyleSnapshot(element, message.inlineStyleSnapshot);
  if (message.textContent !== undefined && isTextContentEditable(getElementInspection(element))) {
    setEditableElementText(element, message.textContent);
  }
}

function applyRemoteTextMessage(
  message: Extract<ContentMessage, { type: "DOM_AI_REMOTE_TEXT_APPLY" }>,
  context: PageContext
) {
  if (!shouldHandleRemoteStyleMessage(message.frameId, context)) return;
  const element = getRemoteStyleElement(message.selector);
  if (!element || !isTextContentEditable(getElementInspection(element))) return;
  setEditableElementText(element, message.value);
}

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
  const [allAnnotations, setAllAnnotations] = useState<DomAnnotation[]>([]);
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
  const lastChildFrameHoverAtRef = useRef(0);
  const lastIframeEscapeForwardedAtRef = useRef(0);

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
    void chrome.runtime.sendMessage({ type: "DOM_AI_GET_PANEL_STATE" })
      .then((response: { active?: boolean } | undefined) => {
        if (response?.active) setPanelVisible(true);
      })
      .catch(() => undefined);
  }, [setPanelVisible]);

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
    setAllAnnotations(items);
    setAnnotations(items.filter((item) => isAnnotationForCurrentDocument(item, pageContext)));
  }, [pageContext]);

  useEffect(() => {
    if (panelActive) void refreshAnnotations();
  }, [panelActive, refreshAnnotations]);

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
        setComposer(null);
        setMeasuring(false);
        setReferencePickingLabel(null);
        setPendingReference(null);
        setResumePickingAfterComposer(false);
        setMeasureAnchor(null);
        setMeasureHover(null);
        setMeasurePaused(false);
        setHoverInspection(null);
        setPicking(true);
      }
      if (message.type === "DOM_AI_STOP_PICKING") {
        setPicking(false);
        setResumePickingAfterComposer(false);
        setHoverInspection(null);
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
        lastChildFrameHoverAtRef.current = performance.now();
        setHoverInspection(null);
        setMeasureHover(null);
      }
      if (message.type === "DOM_AI_IFRAME_SELECTION_ADOPTED" && message.frameId !== pageContext.frameId) {
        setPicking(false);
        setReferencePickingLabel(null);
        setResumePickingAfterComposer(false);
        setHoverInspection(null);
      }
      if (message.type === "DOM_AI_REMOTE_STYLE_APPLY") {
        applyRemoteStyleMessage(message, pageContext);
      }
      if (message.type === "DOM_AI_REMOTE_STYLE_RESTORE_PROPERTY") {
        restoreRemoteStylePropertyMessage(message, pageContext);
      }
      if (message.type === "DOM_AI_REMOTE_STYLE_RESTORE") {
        restoreRemoteStyleMessage(message, pageContext);
      }
      if (message.type === "DOM_AI_REMOTE_TEXT_APPLY") {
        applyRemoteTextMessage(message, pageContext);
      }
      if (message.type === "DOM_AI_REFRESH_PINS") void refreshAnnotations();
      if (message.type === "DOM_AI_FOCUS_ANNOTATION") {
        const annotation = annotations.find((item) => item.id === message.id);
        if (!annotation || !shouldHandleAnnotationAction(annotation, pageContext)) return;
        setPanelVisible(true);
        focusAndHighlightAnnotation(message.id, annotations);
      }
      if (message.type === "DOM_AI_FOCUS_REFERENCE") {
        if (!shouldHandleAnnotationReferenceAction(message.reference, pageContext)) return;
        setPanelVisible(true);
        focusAndHighlightReference(message.reference);
      }
      if (message.type === "DOM_AI_EDIT_ANNOTATION") {
        const annotation = annotations.find((item) => item.id === message.id);
        if (!annotation || !shouldHandleAnnotationAction(annotation, pageContext)) return;
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
      if (message.type === "DOM_AI_SHOW_IMAGE_PREVIEW" && !isEmbeddedFrameWindow()) {
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
    if (isEmbeddedFrameWindow()) return;

    const onIframeSelection = (event: MessageEvent) => {
      const data = event.data as { source?: string; type?: string; payload?: IframeSelectionPayload };
      if (data?.source !== "DOM_AI_ANNOTATOR" || data.type !== "DOM_AI_IFRAME_SELECTION_READY" || !data.payload) return;
      const frameHost = getIframeHostForMessageSource(event.source);
      if (!frameHost) return;

      event.stopPropagation();
      const composerState = createTopComposerStateFromIframeSelection(data.payload, frameHost);
      setPanelVisible(true);
      setComposer(composerState);
      setPicking(false);
      setReferencePickingLabel(null);
      setResumePickingAfterComposer(false);
      setMeasuring(false);
      setMeasureAnchor(null);
      setMeasureHover(null);
      setMeasurePaused(false);
      setHoverInspection(null);
      void chrome.runtime.sendMessage({
        type: "DOM_AI_BROADCAST_CONTENT_MESSAGE",
        message: { type: "DOM_AI_IFRAME_SELECTION_ADOPTED", frameId: data.payload.context.frameId }
      });
      void chrome.runtime.sendMessage({
        type: "DOM_AI_BROADCAST_CONTENT_MESSAGE",
        message: { type: "DOM_AI_STOP_PICKING" }
      });
    };

    const onIframeEscape = (event: MessageEvent) => {
      const data = event.data as { source?: string; type?: string };
      if (data?.source !== "DOM_AI_ANNOTATOR" || data.type !== "DOM_AI_IFRAME_ESCAPE_KEY") return;
      if (!getIframeHostForMessageSource(event.source)) return;

      event.stopPropagation();
      if (composer) {
        closeComposer();
        return;
      }
      if (isPicking || isMeasuring) requestStopCurrentMode();
    };

    window.addEventListener("message", onIframeSelection);
    window.addEventListener("message", onIframeEscape);
    return () => {
      window.removeEventListener("message", onIframeSelection);
      window.removeEventListener("message", onIframeEscape);
    };
  }, [composer, isMeasuring, isPicking, setPanelVisible]);

  useEffect(() => {
    if (!panelActive || !isEmbeddedFrameWindow()) return;

    const forwardEscapeToParent = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.key !== "Escape") return;
      if (isEditableEvent(event)) return;
      const now = performance.now();
      if (now - lastIframeEscapeForwardedAtRef.current < 50) return;
      lastIframeEscapeForwardedAtRef.current = now;
      window.parent.postMessage({
        source: "DOM_AI_ANNOTATOR",
        type: "DOM_AI_IFRAME_ESCAPE_KEY"
      }, "*");
    };

    document.addEventListener("keydown", forwardEscapeToParent, true);
    window.addEventListener("keydown", forwardEscapeToParent, true);
    return () => {
      document.removeEventListener("keydown", forwardEscapeToParent, true);
      window.removeEventListener("keydown", forwardEscapeToParent, true);
    };
  }, [panelActive]);

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
      if (shouldDeferPointerToEmbeddedContent(event, lastChildFrameHoverAtRef.current)) {
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
      if (shouldDeferPointerToEmbeddedContent(event, lastChildFrameHoverAtRef.current)) {
        setHoverInspection(null);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      suppressNextPageClick();
      const inspection = getElementInspection(element);
      const context = getAnnotationPageContext(element, await getFramePageContext());
      void chrome.runtime.sendMessage({ type: "DOM_AI_PAGE_CONTEXT_SELECTED", context });
      const draft = createAnnotationDraft(element, getPreferredAnnotationPinAnchor(inspection, {
        x: event.clientX + window.scrollX,
        y: event.clientY + window.scrollY
      }), context);
      if (postIframeSelectionToParent({
        draft,
        inspection: serializeHoverInspection(inspection),
        inlineStyleSnapshot: element instanceof HTMLElement ? captureInlineStyleSnapshot(element) : {},
        fontFamilies: getPageFontFamilyOptions().map((option) => option.value),
        pointerViewport: { x: event.clientX, y: event.clientY, width: 0, height: 0 },
        context
      })) {
        setResumePickingAfterComposer(false);
        setPicking(false);
        setHoverInspection(null);
        void chrome.runtime.sendMessage({
          type: "DOM_AI_BROADCAST_CONTENT_MESSAGE",
          message: { type: "DOM_AI_IFRAME_SELECTION_ADOPTED", frameId: context.frameId }
        });
        void chrome.runtime.sendMessage({
          type: "DOM_AI_BROADCAST_CONTENT_MESSAGE",
          message: { type: "DOM_AI_STOP_PICKING" }
        });
        return;
      }

      setResumePickingAfterComposer(true);
      setPicking(false);
      const initialScreenshot = await captureAnnotationScreenshotData(draft.selector, draft.rect);
      setComposer({
        draft,
        inspection,
        initialScreenshot
      });
      void chrome.runtime.sendMessage({
        type: "DOM_AI_BROADCAST_CONTENT_MESSAGE",
        message: { type: "DOM_AI_STOP_PICKING" }
      });
    };

    const onClick = (event: MouseEvent) => {
      if (isInjectedEvent(event) || shouldDeferPointerToEmbeddedContent(event, lastChildFrameHoverAtRef.current)) return;
      event.preventDefault();
      event.stopPropagation();
    };

    const onOut = (event: MouseEvent) => {
      if (isPointerLeavingForEmbeddedContent(event, lastChildFrameHoverAtRef.current)) setHoverInspection(null);
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
      if (shouldDeferPointerToEmbeddedContent(event, lastChildFrameHoverAtRef.current)) {
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
      if (shouldDeferPointerToEmbeddedContent(event, lastChildFrameHoverAtRef.current)) {
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
      if (isInjectedEvent(event) || shouldDeferPointerToEmbeddedContent(event, lastChildFrameHoverAtRef.current)) return;
      event.preventDefault();
      event.stopPropagation();
    };

    const onOut = (event: MouseEvent) => {
      if (isPointerLeavingForEmbeddedContent(event, lastChildFrameHoverAtRef.current)) setHoverInspection(null);
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
      if (shouldDeferPointerToEmbeddedContent(event, lastChildFrameHoverAtRef.current)) {
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
      if (shouldDeferPointerToEmbeddedContent(event, lastChildFrameHoverAtRef.current)) {
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
      if (isInjectedEvent(event) || shouldDeferPointerToEmbeddedContent(event, lastChildFrameHoverAtRef.current)) return;
      event.preventDefault();
      event.stopPropagation();
    };

    const onOut = (event: MouseEvent) => {
      if (isPointerLeavingForEmbeddedContent(event, lastChildFrameHoverAtRef.current)) setMeasureHover(null);
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
  const sortedPageAnnotations = useMemo(
    () => allAnnotations
      .filter((item) => isAnnotationForCurrentPage(item, pageContext))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [allAnnotations, pageContext]
  );
  const pageAnnotationIndexById = useMemo(
    () => new Map(sortedPageAnnotations.map((annotation, index) => [annotation.id, index])),
    [sortedPageAnnotations]
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
    const inspection = getInspectionForAnnotation(annotation);
    const draft = {
      ...getAnnotationDraft(annotation),
      pin: getAnnotationLivePinAnchor(annotation, inspection.documentRect)
    };
    (document.activeElement as HTMLElement | null)?.blur?.();
    setPicking(false);
    setReferencePickingLabel(null);
    setResumePickingAfterComposer(false);
    setMeasuring(false);
    setMeasureAnchor(null);
    setMeasureHover(null);
    setMeasurePaused(false);
    setHoverInspection(null);
    setFocusedAnnotationId(null);
    setFocusedReference(null);
    setHoveredAnnotationId(null);
    focusAnnotation(id, items);
    setComposer({
      draft,
      inspection,
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

  const liveComposerInspection = composer ? getLiveInspection(composer.inspection) : null;

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

        {liveComposerInspection ? (
          <div
            className="dom-ai-highlight"
            style={getHighlightStyle(liveComposerInspection)}
          />
        ) : null}

        {sortedAnnotations.map((annotation, index) => (
          <AnnotationPin
            key={annotation.id}
            annotation={annotation}
            index={pageAnnotationIndexById.get(annotation.id) ?? index}
            focused={focusedAnnotationId === annotation.id}
            editing={composer?.editingAnnotation?.id === annotation.id}
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

        {composer && liveComposerInspection ? (
          <div
            className="dom-ai-composer-anchor"
            style={{
              left: liveComposerInspection.documentRect.x,
              top: liveComposerInspection.documentRect.y,
              width: liveComposerInspection.documentRect.width,
              height: liveComposerInspection.documentRect.height
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
  editing,
  onEdit,
  onStatusChange,
  onDelete,
  onHoverChange
}: {
  annotation: DomAnnotation;
  index: number;
  focused: boolean;
  editing: boolean;
  onEdit: () => void;
  onStatusChange: (status: AnnotationStatus) => void;
  onDelete: () => void;
  onHoverChange: (hovered: boolean) => void;
}) {
  const [isDismissed, setIsDismissed] = useState(false);
  const [isCardOpen, setIsCardOpen] = useState(false);
  const closeTimerRef = useRef<number | null>(null);
  const palette = getPinPalette(annotation.status);
  const position = getAnnotationPinPosition(annotation);
  const normalizedStatus = normalizeAnnotationStatus(annotation.status);
  const title = getAnnotationTitle(annotation);
  const statusOptions: AnnotationStatus[] = ["pending", "sent", "changed", "needs_work", "passed", "skipped"];

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current === null) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);

  const openCard = useCallback(() => {
    clearCloseTimer();
    setIsDismissed(false);
    setIsCardOpen(true);
    onHoverChange(true);
  }, [clearCloseTimer, onHoverChange]);

  const closeCard = useCallback(() => {
    clearCloseTimer();
    setIsCardOpen(false);
    onHoverChange(false);
  }, [clearCloseTimer, onHoverChange]);

  const scheduleCloseCard = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setIsCardOpen(false);
      onHoverChange(false);
      closeTimerRef.current = null;
    }, 180);
  }, [clearCloseTimer, onHoverChange]);

  useEffect(() => clearCloseTimer, [clearCloseTimer]);

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
      className={`dom-ai-pin dom-ai-pin-placement-${position.placement} dom-ai-pin-card-side-${position.cardSide} dom-ai-interactive ${focused ? "dom-ai-pin-focused" : ""} ${editing ? "dom-ai-pin-editing" : ""} ${isDismissed ? "dom-ai-pin-dismissed" : ""} ${isCardOpen ? "dom-ai-pin-card-open" : ""}`}
      style={style}
      onMouseEnter={openCard}
      onMouseLeave={scheduleCloseCard}
      onFocus={openCard}
      onBlur={(event) => {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        closeCard();
      }}
    >
      <button
        type="button"
        className="dom-ai-pin-marker"
        aria-label={`查看第 ${index + 1} 条评论`}
        onClick={(event) => {
          event.stopPropagation();
          openCard();
        }}
      >
        <span className="dom-ai-pin-number">{index + 1}</span>
      </button>
      <section
        className="dom-ai-pin-card"
        aria-label={`第 ${index + 1} 条评论`}
        onMouseEnter={openCard}
        onMouseLeave={scheduleCloseCard}
      >
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
              clearCloseTimer();
              setIsDismissed(true);
              closeCard();
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
          {getVisibleAnnotationComment(annotation) ? <p>{getVisibleAnnotationComment(annotation)}</p> : null}
          {annotation.styleChanges?.length ? (
            <div className="dom-ai-pin-style-changes" aria-label="样式变更">
              {annotation.styleChanges.slice(0, 3).map((change) => (
                <span key={change.property} title={`${change.previousValue || "-"} -> ${change.value || "-"}`}>
                  <b>{change.label}</b>
                  {change.value || "-"}
                </span>
              ))}
              {annotation.styleChanges.length > 3 ? <span>+{annotation.styleChanges.length - 3}</span> : null}
            </div>
          ) : null}
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
    const modeBarShadow = isMeasuring
      ? "shadow-[0_18px_48px_rgba(14,165,233,0.18),0_0_0_1.5px_rgba(56,189,248,0.62),inset_0_1px_0_rgba(255,255,255,0.26),inset_0_-1px_0_rgba(0,0,0,0.18)]"
      : "shadow-[0_18px_48px_rgba(15,159,120,0.18),0_0_0_1.5px_rgba(15,159,120,0.58),inset_0_1px_0_rgba(255,255,255,0.26),inset_0_-1px_0_rgba(0,0,0,0.18)]";
    const modeIndicatorClass = isMeasuring
      ? "grid h-[30px] w-[30px] place-items-center rounded-full text-sky-400 shadow-[inset_0_0_0_4px_rgba(56,189,248,0.22)]"
      : "grid h-[30px] w-[30px] place-items-center rounded-full text-[#2dd4aa] shadow-[inset_0_0_0_4px_rgba(15,159,120,0.24)]";

    return (
      <div className={`dom-ai-interactive fixed bottom-[max(18px,env(safe-area-inset-bottom))] left-1/2 z-[2147483647] inline-flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-3 rounded-full bg-slate-950/75 px-2.5 py-2 text-white backdrop-blur-3xl backdrop-saturate-150 max-[520px]:left-4 max-[520px]:right-4 max-[520px]:translate-x-0 ${modeBarShadow}`}>
        <span className={modeIndicatorClass}>
          {isPicking ? <ReviewCursorIcon /> : <Ruler size={18} />}
        </span>
        <span className="min-w-0 truncate text-[15px] font-[850] leading-none text-white/90">{isPicking ? "选择需要标注的元素" : "选择元素测量距离"}</span>
        <button
          type="button"
          className="inline-flex h-9 items-center gap-2 rounded-full border-0 bg-white/10 px-3 text-[13px] font-[850] text-white/90 transition-[background-color,transform] duration-150 hover:bg-white/15 active:scale-[0.96] [&_kbd]:inline-flex [&_kbd]:h-[22px] [&_kbd]:items-center [&_kbd]:rounded-[7px] [&_kbd]:bg-white/10 [&_kbd]:px-[7px] [&_kbd]:text-xs [&_kbd]:font-black [&_kbd]:leading-none [&_kbd]:text-white/80"
          onClick={onCancel}
        >
          取消
          <kbd>Esc</kbd>
        </button>
      </div>
    );
  }

  if (hidden) return null;

  const toolButtonClass = [
    "inline-flex h-9 min-w-0 items-center justify-center gap-2 rounded-full border-0 bg-transparent px-[13px]",
    "text-sm font-[820] leading-none text-white/80 transition-[background-color,color,transform,box-shadow] duration-150",
    "hover:bg-brand-600 hover:text-white hover:shadow-[0_10px_22px_rgba(15,159,120,0.24),inset_0_0_0_1px_rgba(255,255,255,0.28),inset_0_1px_0_rgba(255,255,255,0.18)] active:translate-y-px",
    "[&_svg]:shrink-0 [&_kbd]:inline-flex [&_kbd]:h-[22px] [&_kbd]:min-w-[22px] [&_kbd]:items-center [&_kbd]:justify-center [&_kbd]:rounded-lg",
    "[&_kbd]:bg-white/10 [&_kbd]:px-1.5 [&_kbd]:text-xs [&_kbd]:font-black [&_kbd]:leading-none [&_kbd]:text-white/80",
    "[&_kbd]:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)] hover:[&_kbd]:bg-white/20 hover:[&_kbd]:text-white"
  ].join(" ");

  return (
    <div className="dom-ai-interactive fixed bottom-[max(18px,env(safe-area-inset-bottom))] left-1/2 z-[2147483647] inline-flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-1.5 rounded-full bg-slate-950/75 p-1.5 text-white shadow-[0_18px_48px_rgba(15,23,42,0.22),0_0_0_1px_rgba(255,255,255,0.18),inset_0_1px_0_rgba(255,255,255,0.28),inset_0_-1px_0_rgba(0,0,0,0.18)] backdrop-blur-3xl backdrop-saturate-150 max-[520px]:left-4 max-[520px]:right-4 max-[520px]:max-w-none max-[520px]:translate-x-0 max-[520px]:justify-center max-[520px]:overflow-x-auto max-[520px]:[scrollbar-width:none] max-[520px]:[&::-webkit-scrollbar]:hidden">
      <button
        type="button"
        className={toolButtonClass}
        onClick={onPick}
      >
        <ReviewCursorIcon />
        <span>标注</span>
        <kbd>C</kbd>
      </button>
      <button
        type="button"
        className={toolButtonClass}
        onClick={onMeasure}
      >
        <Ruler size={15} />
        <span>测量</span>
        <kbd>M</kbd>
      </button>
      <button
        type="button"
        className="grid h-9 w-8 place-items-center rounded-full border-0 bg-transparent p-0 text-white/45 transition-[background-color,color,transform] duration-150 hover:bg-white/10 hover:text-white active:translate-y-px"
        aria-label="隐藏工具条"
        title="隐藏工具条"
        onClick={onDismiss}
      >
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
  const [comment, setComment] = useState(state.editingAnnotation ? getVisibleAnnotationComment(state.editingAnnotation) : "");
  const [severity, setSeverity] = useState<FeedbackSeverity>(state.editingAnnotation?.feedback.severity ?? "important");
  const [references, setReferences] = useState<AnnotationReference[]>(state.editingAnnotation?.references ?? []);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [liveInspection, setLiveInspection] = useState<HoverInspection>(state.inspection);
  const [manualPosition, setManualPosition] = useState<{ left: number; top: number } | null>(null);
  const shouldOpenDetailsOnEdit = Boolean(state.editingAnnotation?.styleChanges?.length);
  const [detailsOpen, setDetailsOpen] = useState(shouldOpenDetailsOnEdit);
  const [hasStyleChanges, setHasStyleChanges] = useState(false);
  const [styleChanges, setStyleChanges] = useState<AnnotationStyleChange[]>(state.editingAnnotation?.styleChanges ?? []);
  const [styleScrubbing, setStyleScrubbing] = useState(false);
  const editorRef = useRef<ReferenceTextEditorHandle | null>(null);
  const styleEditorRef = useRef<StyleEditorHandle | null>(null);
  const consumedReferenceNonceRef = useRef<number | null>(null);
  const completedRef = useRef(false);
  const canSave = comment.trim().length > 0 || styleChanges.length > 0;
  const styleEditorResetKey = state.editingAnnotation?.id ?? `${state.draft.context?.url ?? state.draft.url}|${state.draft.selector}`;
  const remoteStyleTarget = useMemo<RemoteStyleTarget | undefined>(() => {
    if (liveInspection.element || state.draft.context?.kind !== "iframe") return undefined;
    return {
      frameId: state.draft.context.frameId,
      selector: state.draft.selector,
      inlineStyleSnapshot: state.remoteInlineStyleSnapshot ?? {},
      textContent: liveInspection.textContent
    };
  }, [liveInspection.element, liveInspection.textContent, state.draft.context, state.draft.selector, state.remoteInlineStyleSnapshot]);
  const shouldRevertStyleEditorOnDispose = useCallback(() => !completedRef.current, []);
  const anchoredPosition = getComposerPosition(liveInspection.documentRect, state.draft.pin, detailsOpen);
  const position = manualPosition ?? anchoredPosition;
  const targetToken = useMemo<ReferenceEditorToken>(() => ({
    id: "target",
    label: "对象 1",
    title: liveInspection.label,
    removable: false
  }), [liveInspection.label]);
  const editorTokens = useMemo<ReferenceEditorToken[]>(
    () => [targetToken, ...references.map(referenceToEditorToken)],
    [references, targetToken]
  );

  const refreshLiveInspection = useCallback(() => {
    setLiveInspection((inspection) => getLiveInspection(inspection));
  }, []);

  const getDraftForSave = useCallback(() => {
    const element = liveInspection.element;
    if (!element?.isConnected || isInjectedElement(element)) return state.draft;
    return createAnnotationDraft(element, state.draft.pin, state.draft.context);
  }, [liveInspection.element, state.draft]);

  const startComposerDrag = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startY = event.clientY;
    const startPosition = position;

    const onMove = (moveEvent: PointerEvent) => {
      const next = clampComposerPosition(
        startPosition.left + moveEvent.clientX - startX,
        startPosition.top + moveEvent.clientY - startY,
        detailsOpen ? COMPOSER_MIN_VISIBLE_HEIGHT : COMPOSER_COMPACT_ESTIMATED_HEIGHT
      );
      setManualPosition(next);
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
    };

    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
  }, [detailsOpen, position]);

  const save = useCallback(async () => {
    if (!canSave) return;
    const trimmedComment = comment.trim();
    const feedbackComment = trimmedComment;
    const savedStyleChanges = styleChanges.length ? styleChanges : undefined;

    if (state.editingAnnotation) {
      const now = new Date().toISOString();
      const liveDraft = getDraftForSave();
      await saveAnnotation({
        ...state.editingAnnotation,
        ...liveDraft,
        id: state.editingAnnotation.id,
        createdAt: state.editingAnnotation.createdAt,
        updatedAt: now,
        feedback: {
          ...state.editingAnnotation.feedback,
          comment: feedbackComment,
          severity
        },
        references: references.length ? references : undefined,
        styleChanges: savedStyleChanges,
        status: state.editingAnnotation.status
      });
      completedRef.current = true;
      onSaved();
      return;
    }

    const now = new Date().toISOString();
    const newId = crypto.randomUUID();
    const liveDraft = getDraftForSave();
    const annotation: DomAnnotation = {
      ...liveDraft,
      id: newId,
      createdAt: now,
      updatedAt: now,
      feedback: {
        comment: feedbackComment,
        expected: undefined,
        type: "style",
        severity
      },
      references: references.length ? references : undefined,
      styleChanges: savedStyleChanges,
      status: "pending"
    };
    await saveAnnotation(annotation);
    if (state.initialScreenshot) {
      await updateAnnotationScreenshot(newId, "screenshot", state.initialScreenshot);
    }
    void chrome.runtime.sendMessage({ type: "DOM_AI_ANNOTATION_SAVED", annotation });
    completedRef.current = true;
    onSaved();
  }, [canSave, comment, getDraftForSave, onSaved, references, severity, state.editingAnnotation, state.initialScreenshot, styleChanges]);

  const cancel = useCallback(() => {
    styleEditorRef.current?.revertStyles();
    completedRef.current = true;
    onCancel();
  }, [onCancel]);

  const remove = useCallback(async () => {
    if (!state.editingAnnotation) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    await deleteAnnotation(state.editingAnnotation.id);
    completedRef.current = true;
    onDeleted();
  }, [confirmDelete, onDeleted, state.editingAnnotation]);

  useEffect(() => {
    completedRef.current = false;
    setComment(state.editingAnnotation ? getVisibleAnnotationComment(state.editingAnnotation) : "");
    setSeverity(state.editingAnnotation?.feedback.severity ?? "important");
    setReferences(state.editingAnnotation?.references ?? []);
    setConfirmDelete(false);
    setLiveInspection(state.inspection);
    setManualPosition(null);
    setDetailsOpen(Boolean(state.editingAnnotation?.styleChanges?.length));
    setHasStyleChanges(false);
    setStyleChanges(state.editingAnnotation?.styleChanges ?? []);
    setStyleScrubbing(false);
  }, [state.draft.selector, state.editingAnnotation?.id, state.inspection]);

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
        cancel();
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
  }, [cancel, referencePicking, save]);

  const composerStateClass = detailsOpen
    ? `dom-ai-composer-expanded ${styleScrubbing ? "dom-ai-composer-style-scrubbing" : ""}`
    : "dom-ai-composer-compact";

  return (
    <section
      className={`dom-ai-composer dom-ai-composer-shell t-resize dom-ai-interactive absolute text-ink-900 ${composerStateClass}`}
      data-anchor-ready="true"
      style={{
        left: position.left,
        top: position.top
      }}
    >
      {!detailsOpen ? (
        <div className="dom-ai-composer-compact-content dom-ai-content-swap">
          <button
            type="button"
            className="dom-ai-compact-style-button"
            aria-label="展开样式调整"
            title="展开样式调整"
            onClick={() => setDetailsOpen(true)}
          >
            <StyleTuneIcon size={16} />
          </button>
          <input
            className="dom-ai-compact-input"
            value={comment}
            placeholder={state.editingAnnotation ? "编辑评论..." : "添加评论..."}
            onChange={(event) => setComment(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void save();
              }
            }}
          />
          <button
            type="button"
            className="dom-ai-compact-drag-button dom-ai-drag-handle"
            aria-label="拖动评论面板"
            title="拖动评论面板"
            onPointerDown={startComposerDrag}
          >
            <CodexGripDots />
          </button>
          <button
            type="button"
            className="dom-ai-compact-save-button"
            disabled={!canSave}
            aria-label="保存评论"
            title="保存评论"
            onClick={() => void save()}
          >
            <Check size={14} />
          </button>
        </div>
      ) : null}

      {detailsOpen ? (
        <div className="dom-ai-composer-expanded-content dom-ai-content-swap">
          <div className="dom-ai-expanded-topbar">
            <button
              type="button"
              className="dom-ai-expanded-style-button"
              aria-label="收起样式调整"
              title="收起样式调整"
              onClick={() => {
                setStyleScrubbing(false);
                setDetailsOpen(false);
              }}
            >
              <StyleTuneIcon size={16} />
            </button>
            <input
              className="dom-ai-expanded-input"
              value={comment}
              placeholder="描述这些更改..."
              onChange={(event) => setComment(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void save();
                }
              }}
            />
          </div>

          <div
            className="dom-ai-target-strip dom-ai-drag-handle"
            aria-label="拖动样式面板"
            title="拖动样式面板"
            onPointerDown={startComposerDrag}
          >
            <span>{liveInspection.label}</span>
            <CodexGripDots />
          </div>

          <StyleEditor
            ref={styleEditorRef}
            inspection={liveInspection}
            resetKey={styleEditorResetKey}
            remoteTarget={remoteStyleTarget}
            fontFamilies={state.fontFamilies}
            baselineStyleChanges={state.editingAnnotation?.styleChanges}
            onChanged={refreshLiveInspection}
            onDirtyChange={setHasStyleChanges}
            onStyleChangesChange={setStyleChanges}
            onScrubActiveChange={setStyleScrubbing}
            shouldRevertOnDispose={shouldRevertStyleEditorOnDispose}
          />

          <div className="dom-ai-expanded-footer">
            <button
              type="button"
              className="dom-ai-expanded-cancel-button"
              onClick={cancel}
            >
              取消
            </button>
            <div className="dom-ai-expanded-footer-actions">
              <button
                type="button"
                className="dom-ai-expanded-confirm-button"
                disabled={!canSave}
                aria-label="保存评论"
                title="保存评论"
                onClick={() => void save()}
              >
                <Check size={14} />
              </button>
            </div>
          </div>
        </div>
      ) : null}

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

function getInitialFontFamilyOptions(value: string, computedValue: string, pageFontFamilies?: string[]): SelectStyleOption[] {
  const seen = new Set<string>();
  const options: SelectStyleOption[] = [];
  const addOption = (optionValue: string, label = optionValue) => {
    const normalized = normalizeFontFamilyName(optionValue);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    options.push({ value: optionValue, label });
  };

  splitFontFamilyList(computedValue).forEach((family) => addOption(family));
  if (pageFontFamilies) {
    pageFontFamilies.forEach((family) => addOption(family));
  } else {
    getPageFontFamilyOptions().forEach((option) => addOption(option.value, option.label));
  }
  if (value) addOption(value);
  DEFAULT_FONT_FAMILY_OPTIONS.forEach((option) => addOption(option.value, option.label));
  return options;
}

function getPageFontFamilyOptions(): SelectStyleOption[] {
  const seen = new Set<string>();
  const options: SelectStyleOption[] = [];
  const addFont = (fontFamily: string) => {
    const families = splitFontFamilyList(fontFamily);
    for (const family of families.length ? families : [fontFamily]) {
      const label = normalizeFontFamilyDisplay(family);
      const normalized = normalizeFontFamilyName(label);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      options.push({ value: label, label });
    }
  };

  try {
    document.fonts?.forEach((fontFace) => addFont(fontFace.family));
  } catch {
    // Some pages patch FontFaceSet accessors; computed styles below still cover visible fonts.
  }

  if (!document.body) return options;

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let scanned = 0;
  let node: Node | null = walker.currentNode;
  while (node && scanned < PAGE_FONT_SCAN_LIMIT) {
    if (node instanceof Element && !isInjectedElement(node)) {
      scanned += 1;
      const style = window.getComputedStyle(node);
      if (style.fontFamily) addFont(style.fontFamily);
    }
    node = walker.nextNode();
  }

  return options;
}

function mergeFontFamilyOptions(baseOptions: SelectStyleOption[], value: string): SelectStyleOption[] {
  const seen = new Set<string>();
  const options: SelectStyleOption[] = [];
  const addOption = (optionValue: string, label = optionValue) => {
    const normalized = normalizeFontFamilyName(optionValue);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    options.push({ value: optionValue, label });
  };

  baseOptions.forEach((option) => addOption(option.value, option.label));
  if (value) addOption(value);
  return options;
}

function splitFontFamilyList(value: string): string[] {
  const result: string[] = [];
  let current = "";
  let quote: string | null = null;

  for (const char of value) {
    if ((char === "\"" || char === "'") && (!quote || quote === char)) {
      quote = quote ? null : char;
      continue;
    }
    if (char === "," && !quote) {
      const item = normalizeFontFamilyDisplay(current);
      if (item) result.push(item);
      current = "";
      continue;
    }
    current += char;
  }

  const tail = normalizeFontFamilyDisplay(current);
  if (tail) result.push(tail);
  return result;
}

function normalizeFontFamilyDisplay(value: string): string {
  return value.trim().replace(/^["']|["']$/g, "");
}

function normalizeFontFamilyName(value: string): string {
  return normalizeFontFamilyDisplay(value).toLowerCase();
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

function applySavedStyleChangesToTarget(
  changes: AnnotationStyleChange[] | undefined,
  editableElement: HTMLElement | null,
  remoteTarget: RemoteStyleTarget | undefined,
  sendRemoteStyleMessage: (message: ContentMessage) => void,
  inspection: HoverInspection
) {
  if (!changes?.length) return;

  for (const change of changes) {
    const editableProperty = getEditableStylePropertyForChange(change.property);
    if (!editableProperty) continue;

    if (editableProperty === "textContent") {
      if (editableElement && isTextContentEditable(inspection)) {
        setEditableElementText(editableElement, change.value);
      } else if (remoteTarget) {
        sendRemoteStyleMessage({
          type: "DOM_AI_REMOTE_TEXT_APPLY",
          frameId: remoteTarget.frameId,
          selector: remoteTarget.selector,
          value: change.value
        });
      }
      continue;
    }

    if (editableElement) {
      applyEditableStyleValue(editableElement, change.property, change.value);
    } else if (remoteTarget) {
      sendRemoteStyleMessage({
        type: "DOM_AI_REMOTE_STYLE_APPLY",
        frameId: remoteTarget.frameId,
        selector: remoteTarget.selector,
        cssProperty: change.property,
        value: change.value
      });
    }
  }
}

const StyleEditor = React.forwardRef<StyleEditorHandle, {
  inspection: HoverInspection;
  resetKey: string;
  remoteTarget?: RemoteStyleTarget;
  fontFamilies?: string[];
  baselineStyleChanges?: AnnotationStyleChange[];
  onChanged: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onStyleChangesChange: (changes: AnnotationStyleChange[]) => void;
  onScrubActiveChange: (active: boolean) => void;
  shouldRevertOnDispose: () => boolean;
}>(function StyleEditor({
  inspection,
  resetKey,
  remoteTarget,
  fontFamilies,
  baselineStyleChanges,
  onChanged,
  onDirtyChange,
  onStyleChangesChange,
  onScrubActiveChange,
  shouldRevertOnDispose
}, ref) {
  const [values, setValues] = useState<EditableStyleValues>(() => createEditableStyleValuesWithChanges(inspection, baselineStyleChanges));
  const [baselineValues, setBaselineValues] = useState<EditableStyleValues>(() => createEditableStyleBaselineValues(inspection, baselineStyleChanges));
  const [linkedBoxValues, setLinkedBoxValues] = useState({
    size: false,
    marginBlock: false,
    marginInline: false,
    paddingBlock: false,
    paddingInline: false
  });
  const [activeNumericScrub, setActiveNumericScrub] = useState<ActiveNumericScrub>(null);
  const editableElement = inspection.element instanceof HTMLElement ? inspection.element : null;
  const inlineBaselineRef = useRef<InlineStyleSnapshot>({});
  const savedTextContentRef = useRef(inspection.textContent);
  const baselineOverrideProperties = useMemo(() => {
    const properties = new Set<keyof EditableStyleValues>();
    baselineStyleChanges?.forEach((change) => {
      const property = getEditableStylePropertyForChange(change.property);
      if (property) properties.add(property);
    });
    return properties;
  }, [baselineStyleChanges]);
  const sendRemoteStyleMessage = useCallback((message: ContentMessage) => {
    if (!remoteTarget) return;
    void chrome.runtime.sendMessage({
      type: "DOM_AI_BROADCAST_CONTENT_MESSAGE",
      message
    });
  }, [remoteTarget]);
  const textControlsVisible = isTextStyleRelevant(inspection);
  const textContentControlVisible = isTextContentEditable(inspection);
  const layoutControlsVisible = isLayoutStyleRelevant(inspection);
  const isGridLayout = inspection.display.includes("grid");
  const isFlexLayout = inspection.display.includes("flex");
  const directionalLayoutVisible = isGridLayout || isFlexLayout;

  useEffect(() => {
    const nextValues = createEditableStyleValuesWithChanges(inspection, baselineStyleChanges);
    const nextBaselineValues = createEditableStyleBaselineValues(inspection, baselineStyleChanges);
    setValues(nextValues);
    setBaselineValues(nextBaselineValues);
    setLinkedBoxValues({
      size: false,
      marginBlock: false,
      marginInline: false,
      paddingBlock: false,
      paddingInline: false
    });
    setActiveNumericScrub(null);
    savedTextContentRef.current = inspection.textContent;
    inlineBaselineRef.current = editableElement
      ? captureInlineStyleSnapshot(editableElement)
      : remoteTarget?.inlineStyleSnapshot ?? {};
    applySavedStyleChangesToTarget(
      baselineStyleChanges,
      editableElement,
      remoteTarget,
      sendRemoteStyleMessage,
      inspection
    );
    if (baselineStyleChanges?.length) window.requestAnimationFrame(onChanged);
  }, [baselineStyleChanges, editableElement, remoteTarget?.inlineStyleSnapshot, resetKey]);

  const setStyleValue = useCallback((property: keyof EditableStyleValues, cssProperty: string, value: string) => {
    setValues((current) => ({ ...current, [property]: value }));
    if (editableElement) {
      applyEditableStyleValue(editableElement, cssProperty, value);
    } else if (remoteTarget) {
      sendRemoteStyleMessage({
        type: "DOM_AI_REMOTE_STYLE_APPLY",
        frameId: remoteTarget.frameId,
        selector: remoteTarget.selector,
        cssProperty,
        value
      });
    } else {
      return;
    }
    window.requestAnimationFrame(onChanged);
  }, [editableElement, onChanged, remoteTarget, sendRemoteStyleMessage]);

  const resetStyleValue = useCallback((property: keyof EditableStyleValues, cssProperty: string) => {
    const baselineValue = baselineValues[property];
    const shouldApplySavedBaseline = baselineOverrideProperties.has(property);
    if (editableElement) {
      if (shouldApplySavedBaseline) {
        applyEditableStyleValue(editableElement, cssProperty, baselineValue);
      } else {
        restoreInlineStyle(editableElement, cssProperty, inlineBaselineRef.current[cssProperty]);
      }
      const nextInspection = getElementInspection(editableElement);
      setValues(createEditableStyleValues(nextInspection));
    } else if (remoteTarget) {
      if (shouldApplySavedBaseline) {
        sendRemoteStyleMessage({
          type: "DOM_AI_REMOTE_STYLE_APPLY",
          frameId: remoteTarget.frameId,
          selector: remoteTarget.selector,
          cssProperty,
          value: baselineValue
        });
      } else {
        sendRemoteStyleMessage({
          type: "DOM_AI_REMOTE_STYLE_RESTORE_PROPERTY",
          frameId: remoteTarget.frameId,
          selector: remoteTarget.selector,
          cssProperty,
          snapshot: inlineBaselineRef.current[cssProperty] ?? null
        });
      }
      setValues((current) => ({ ...current, [property]: baselineValue }));
    } else {
      return;
    }
    window.requestAnimationFrame(onChanged);
  }, [baselineOverrideProperties, baselineValues, editableElement, onChanged, remoteTarget, sendRemoteStyleMessage]);

  const setTextContentValue = useCallback((value: string) => {
    setValues((current) => ({ ...current, textContent: value }));
    if (editableElement && isTextContentEditable(inspection)) {
      setEditableElementText(editableElement, value);
    } else if (remoteTarget) {
      sendRemoteStyleMessage({
        type: "DOM_AI_REMOTE_TEXT_APPLY",
        frameId: remoteTarget.frameId,
        selector: remoteTarget.selector,
        value
      });
    } else {
      return;
    }
    window.requestAnimationFrame(onChanged);
  }, [editableElement, inspection, onChanged, remoteTarget, sendRemoteStyleMessage]);

  const resetTextContentValue = useCallback(() => {
    if (editableElement && isTextContentEditable(inspection)) {
      setEditableElementText(editableElement, baselineValues.textContent);
      const nextInspection = getElementInspection(editableElement);
      setValues(createEditableStyleValues(nextInspection));
    } else if (remoteTarget) {
      sendRemoteStyleMessage({
        type: "DOM_AI_REMOTE_TEXT_APPLY",
        frameId: remoteTarget.frameId,
        selector: remoteTarget.selector,
        value: baselineValues.textContent
      });
      setValues((current) => ({ ...current, textContent: baselineValues.textContent }));
    } else {
      return;
    }
    window.requestAnimationFrame(onChanged);
  }, [baselineValues.textContent, editableElement, inspection, onChanged, remoteTarget, sendRemoteStyleMessage]);

  const setNumericValueEntries = useCallback((rawEntries: Array<readonly [NumericAdjusterConfig, number | string]>) => {
    const entries = rawEntries.map(([item, rawValue]) => [item, formatNumericStyleValue(item, rawValue)] as const);

    setValues((current) => {
      const next = { ...current };
      for (const [item, value] of entries) {
        next[item.property] = value;
      }
      return next;
    });

    if (editableElement) {
      for (const [item, value] of entries) {
        applyEditableStyleValue(editableElement, item.cssProperty, value);
      }
    } else if (remoteTarget) {
      for (const [item, value] of entries) {
        sendRemoteStyleMessage({
          type: "DOM_AI_REMOTE_STYLE_APPLY",
          frameId: remoteTarget.frameId,
          selector: remoteTarget.selector,
          cssProperty: item.cssProperty,
          value
        });
      }
    } else {
      return;
    }
    window.requestAnimationFrame(onChanged);
  }, [editableElement, onChanged, remoteTarget, sendRemoteStyleMessage]);

  const setNumericValues = useCallback<NumericChangeHandler>((config, rawValue, linkedConfigs) => {
    const configs = linkedConfigs?.length ? linkedConfigs : [config];
    setNumericValueEntries(configs.map((item) => [item, rawValue] as const));
  }, [setNumericValueEntries]);

  const startNumericDrag = useCallback<NumericDragHandler>((config, event, linkedConfigs) => {
    if ((!editableElement && !remoteTarget) || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const input = event.currentTarget;
    const scrollContainer = input.closest(".dom-ai-property-list") as HTMLElement | null;
    const bodyStyle = document.body.style;
    const previousBodyCursor = bodyStyle.cursor;
    const previousBodyUserSelect = bodyStyle.userSelect;
    const previousInputCursor = input.style.cursor;
    const previousScrollOverflow = scrollContainer?.style.overflowY ?? "";
    const previousScrollOverscroll = scrollContainer?.style.overscrollBehavior ?? "";
    const startY = event.clientY;
    const dragConfigs = linkedConfigs?.length ? linkedConfigs : [config];
    const startValues = dragConfigs.map((item) => {
      const value = pxNumber(values[item.property]);
      return Number.isFinite(value) ? value : item.fallback;
    });
    let active = false;

    const activate = () => {
      if (active) return;
      active = true;
      if (input.ownerDocument.activeElement === input) input.blur();
      input.dataset.scrubbing = "true";
      input.style.cursor = NUMERIC_SCRUB_CURSOR;
      bodyStyle.cursor = NUMERIC_SCRUB_CURSOR;
      bodyStyle.userSelect = "none";
      if (scrollContainer) {
        scrollContainer.style.overflowY = "hidden";
        scrollContainer.style.overscrollBehavior = "none";
      }
    };

    const onMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientY - startY;
      if (!active && Math.abs(delta) < 4) return;
      activate();
      if (!active) return;
      moveEvent.preventDefault();
      const nextDelta = -delta * config.dragScale;
      setNumericValueEntries(dragConfigs.map((item, index) => [item, startValues[index] + nextDelta] as const));
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      bodyStyle.cursor = previousBodyCursor;
      bodyStyle.userSelect = previousBodyUserSelect;
      input.style.cursor = previousInputCursor;
      delete input.dataset.scrubbing;
      try {
        input.releasePointerCapture?.(event.pointerId);
      } catch {
        // Pointer capture can already be released by the browser on cancel.
      }
      if (scrollContainer) {
        scrollContainer.style.overflowY = previousScrollOverflow;
        scrollContainer.style.overscrollBehavior = previousScrollOverscroll;
      }
      if (!active) {
        input.focus();
        window.requestAnimationFrame(() => input.select());
      }
    };

    input.setPointerCapture?.(event.pointerId);
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
  }, [editableElement, remoteTarget, setNumericValueEntries, values]);

  const disabled = !editableElement && !remoteTarget;
  const numericConfigs = getNumericAdjusterConfigs(values);
  const activeScrubKeys = useMemo<ReadonlySet<keyof EditableStyleValues> | null>(() => {
    if (!activeNumericScrub) return null;
    return new Set([activeNumericScrub.property, ...activeNumericScrub.peerProperties]);
  }, [activeNumericScrub]);
  const showForScrub = useCallback((keys: readonly (keyof EditableStyleValues)[]) => {
    if (!activeScrubKeys) return true;
    return keys.some((key) => activeScrubKeys.has(key));
  }, [activeScrubKeys]);
  const hasStyleChanges = useMemo(() => {
    return (Object.keys(values) as Array<keyof EditableStyleValues>).some((property) => (
      !styleValueMatches(property, values[property], baselineValues[property])
    ));
  }, [baselineValues, values]);
  const styleChanges = useMemo(() => getEditableStyleChanges(values, baselineValues), [baselineValues, values]);
  const restoreCurrentTargetStyles = useCallback(() => {
    if (editableElement) {
      restoreInlineStyleSnapshot(editableElement, inlineBaselineRef.current);
      if (isTextContentEditable(inspection)) setEditableElementText(editableElement, savedTextContentRef.current);
      return true;
    }
    if (remoteTarget) {
      sendRemoteStyleMessage({
        type: "DOM_AI_REMOTE_STYLE_RESTORE",
        frameId: remoteTarget.frameId,
        selector: remoteTarget.selector,
        inlineStyleSnapshot: inlineBaselineRef.current,
        textContent: savedTextContentRef.current
      });
      return true;
    }
    return false;
  }, [editableElement, inspection, remoteTarget, sendRemoteStyleMessage]);
  const restoreOnDisposeRef = useRef(restoreCurrentTargetStyles);
  const shouldRevertOnDisposeRef = useRef(shouldRevertOnDispose);

  useEffect(() => {
    restoreOnDisposeRef.current = restoreCurrentTargetStyles;
  }, [restoreCurrentTargetStyles]);

  useEffect(() => {
    shouldRevertOnDisposeRef.current = shouldRevertOnDispose;
  }, [shouldRevertOnDispose]);

  useEffect(() => {
    return () => {
      if (shouldRevertOnDisposeRef.current()) {
        restoreOnDisposeRef.current();
      }
    };
  }, [resetKey]);

  useImperativeHandle(ref, () => ({
    revertStyles: () => {
      if (!restoreCurrentTargetStyles()) return;
      if (editableElement) {
        const nextInspection = getElementInspection(editableElement);
        setValues(createEditableStyleValues(nextInspection));
      } else if (remoteTarget) {
        setValues(baselineValues);
      }
      window.requestAnimationFrame(onChanged);
    }
  }), [baselineValues, editableElement, onChanged, remoteTarget, restoreCurrentTargetStyles]);

  useEffect(() => {
    onDirtyChange(hasStyleChanges);
  }, [hasStyleChanges, onDirtyChange]);

  useEffect(() => {
    onStyleChangesChange(styleChanges);
  }, [onStyleChangesChange, styleChanges]);

  useEffect(() => {
    onScrubActiveChange(Boolean(activeNumericScrub));
  }, [activeNumericScrub, onScrubActiveChange]);

  const resetIfEdited = useCallback((property: keyof EditableStyleValues, cssProperty: string) => {
    if (property === "textContent") {
      return styleValueMatches(property, values[property], baselineValues[property])
        ? undefined
        : resetTextContentValue;
    }
    return styleValueMatches(property, values[property], baselineValues[property])
      ? undefined
      : () => resetStyleValue(property, cssProperty);
  }, [baselineValues, resetStyleValue, resetTextContentValue, values]);

  return (
    <section className="dom-ai-style-panel">
      <div className={`dom-ai-property-list ${activeScrubKeys ? "dom-ai-property-list-scrubbing" : ""}`}>
        {!activeScrubKeys && textContentControlVisible ? (
          <TextInputStyleRow
            label="文本"
            value={values.textContent}
            disabled={disabled}
            onChange={setTextContentValue}
            onReset={resetIfEdited("textContent", "text")}
          />
        ) : null}
        {!activeScrubKeys ? (
          <>
            <ColorStyleRow
              label="文本颜色"
              value={values.color}
              disabled={disabled}
              onChange={(value) => setStyleValue("color", "color", value)}
              onReset={resetIfEdited("color", "color")}
            />
            <ColorStyleRow
              label="背景"
              value={values.backgroundColor}
              disabled={disabled}
              onChange={(value) => setStyleValue("backgroundColor", "background-color", value)}
              onReset={resetIfEdited("backgroundColor", "background-color")}
            />
          </>
        ) : null}
        {showForScrub(["opacity"]) ? (
          <NumericStyleRow
            config={numericConfigs.opacity}
            value={values.opacity}
            disabled={disabled}
            onChange={(value) => setNumericValues(numericConfigs.opacity, value)}
            onDragStart={startNumericDrag}
            onReset={resetIfEdited("opacity", "opacity")}
          />
        ) : null}

        {textControlsVisible ? (
          <>
            {!activeScrubKeys ? (
              <FontFamilyStyleRow
                label="字体"
                value={values.fontFamily}
                computedValue={inspection.fontFamily}
                pageFontFamilies={fontFamilies}
                optionKey={resetKey}
                disabled={disabled}
                onChange={(value) => setStyleValue("fontFamily", "font-family", value)}
                onReset={resetIfEdited("fontFamily", "font-family")}
              />
            ) : null}
            {showForScrub(["fontSize"]) ? (
              <NumericStyleRow
                config={numericConfigs.fontSize}
                value={values.fontSize}
                disabled={disabled}
                onChange={(value) => setNumericValues(numericConfigs.fontSize, value)}
                onDragStart={startNumericDrag}
                onReset={resetIfEdited("fontSize", "font-size")}
              />
            ) : null}
            {!activeScrubKeys ? (
              <TextSelectStyleRow
                label="字重"
                value={values.fontWeight}
                options={FONT_WEIGHT_OPTIONS}
                disabled={disabled}
                compact
                onChange={(value) => setStyleValue("fontWeight", "font-weight", value)}
                onReset={resetIfEdited("fontWeight", "font-weight")}
              />
            ) : null}
            {showForScrub(["lineHeight"]) ? (
              <NumericStyleRow
                config={numericConfigs.lineHeight}
                value={values.lineHeight}
                disabled={disabled}
                onChange={(value) => setNumericValues(numericConfigs.lineHeight, value)}
                onDragStart={startNumericDrag}
                onReset={resetIfEdited("lineHeight", "line-height")}
              />
            ) : null}
            {!activeScrubKeys ? (
              <AlignStyleRow
                value={values.textAlign}
                disabled={disabled}
                onChange={(value) => setStyleValue("textAlign", "text-align", value)}
                onReset={resetIfEdited("textAlign", "text-align")}
              />
            ) : null}
          </>
        ) : null}

        {!activeScrubKeys && (textContentControlVisible || textControlsVisible) ? <StyleSectionDivider /> : null}

        {layoutControlsVisible ? (
          <>
            {!activeScrubKeys && directionalLayoutVisible ? (
              <>
                <TextSelectStyleRow
                  label="布局方向"
                  value={isGridLayout ? values.gridAutoFlow : values.flexDirection}
                  options={isGridLayout ? GRID_AUTO_FLOW_OPTIONS : FLEX_DIRECTION_OPTIONS}
                  disabled={disabled}
                  onChange={(value) => setStyleValue(
                    isGridLayout ? "gridAutoFlow" : "flexDirection",
                    isGridLayout ? "grid-auto-flow" : "flex-direction",
                    value
                  )}
                  onReset={resetIfEdited(
                    isGridLayout ? "gridAutoFlow" : "flexDirection",
                    isGridLayout ? "grid-auto-flow" : "flex-direction"
                  )}
                />
                <TextSelectStyleRow
                  label="分布"
                  value={values.justifyContent}
                  options={JUSTIFY_CONTENT_OPTIONS}
                  disabled={disabled}
                  onChange={(value) => setStyleValue("justifyContent", "justify-content", value)}
                  onReset={resetIfEdited("justifyContent", "justify-content")}
                />
                <TextSelectStyleRow
                  label="对齐"
                  value={values.alignItems}
                  options={ALIGN_ITEMS_OPTIONS}
                  disabled={disabled}
                  onChange={(value) => setStyleValue("alignItems", "align-items", value)}
                  onReset={resetIfEdited("alignItems", "align-items")}
                />
              </>
            ) : null}
            {showForScrub(["columnGap", "rowGap"]) ? (
              <GapSpacingGroup
                values={values}
                configs={numericConfigs}
                disabled={disabled}
                activeScrubKeys={activeScrubKeys}
                onChange={setNumericValues}
                onDragStart={startNumericDrag}
                onReset={resetIfEdited}
              />
            ) : null}
          </>
        ) : null}

        {!activeScrubKeys && layoutControlsVisible ? <StyleSectionDivider /> : null}

        {showForScrub(["borderRadius"]) ? (
          <NumericStyleRow
            config={numericConfigs.borderRadius}
            value={values.borderRadius}
            disabled={disabled}
            onChange={(value) => setNumericValues(numericConfigs.borderRadius, value)}
            onDragStart={startNumericDrag}
            onReset={resetIfEdited("borderRadius", "border-radius")}
          />
        ) : null}
        {!activeScrubKeys ? (
          <ColorStyleRow
            label="边框颜色"
            value={values.borderColor}
            disabled={disabled}
            onChange={(value) => setStyleValue("borderColor", "border-color", value)}
            onReset={resetIfEdited("borderColor", "border-color")}
          />
        ) : null}
        {showForScrub(["borderWidth"]) ? (
          <NumericStyleRow
            config={numericConfigs.borderWidth}
            value={values.borderWidth}
            disabled={disabled}
            onChange={(value) => setNumericValues(numericConfigs.borderWidth, value)}
            onDragStart={startNumericDrag}
            onReset={resetIfEdited("borderWidth", "border-width")}
          />
        ) : null}
        {!activeScrubKeys ? <StyleSectionDivider /> : null}
        {showForScrub(["width", "height"]) ? (
          <SizeRows
            values={values}
            configs={numericConfigs}
            disabled={disabled}
            linked={linkedBoxValues.size}
            activeScrubKeys={activeScrubKeys}
            onLinkedChange={(linked) => setLinkedBoxValues((current) => ({ ...current, size: linked }))}
            onChange={setNumericValues}
            onDragStart={startNumericDrag}
            onReset={resetIfEdited}
          />
        ) : null}

        {!activeScrubKeys ? <StyleSectionDivider /> : null}

        {showForScrub(["marginTop", "marginRight", "marginBottom", "marginLeft"]) ? (
          <BoxSpacingGroup
            prefix="margin"
            values={values}
            configs={numericConfigs}
            disabled={disabled}
            linkedBlock={linkedBoxValues.marginBlock}
            linkedInline={linkedBoxValues.marginInline}
            activeScrubKeys={activeScrubKeys}
            onLinkedBlockChange={(linked) => setLinkedBoxValues((current) => ({ ...current, marginBlock: linked }))}
            onLinkedInlineChange={(linked) => setLinkedBoxValues((current) => ({ ...current, marginInline: linked }))}
            onChange={setNumericValues}
            onDragStart={startNumericDrag}
            onReset={resetIfEdited}
          />
        ) : null}

        {!activeScrubKeys ? <StyleSectionDivider /> : null}

        {showForScrub(["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"]) ? (
          <BoxSpacingGroup
            prefix="padding"
            values={values}
            configs={numericConfigs}
            disabled={disabled}
            linkedBlock={linkedBoxValues.paddingBlock}
            linkedInline={linkedBoxValues.paddingInline}
            activeScrubKeys={activeScrubKeys}
            onLinkedBlockChange={(linked) => setLinkedBoxValues((current) => ({ ...current, paddingBlock: linked }))}
            onLinkedInlineChange={(linked) => setLinkedBoxValues((current) => ({ ...current, paddingInline: linked }))}
            onChange={setNumericValues}
            onDragStart={startNumericDrag}
            onReset={resetIfEdited}
          />
        ) : null}
      </div>
    </section>
  );
});

function StyleSectionDivider() {
  return <div className="dom-ai-style-section-divider" aria-hidden="true" />;
}

function StyleRow({
  label,
  children,
  onReset
}: {
  label: string;
  children: React.ReactNode;
  onReset?: () => void;
}) {
  return (
    <div className="dom-ai-style-row">
      <span className="dom-ai-style-row-label">{label}</span>
      <div className="dom-ai-style-row-control">
        {onReset ? (
          <button type="button" className="dom-ai-row-reset" aria-label={`重置${label}`} title={`重置${label}`} onClick={onReset}>
            <RotateCcw size={13} />
          </button>
        ) : null}
        {children}
      </div>
    </div>
  );
}

function ColorStyleRow({
  label,
  value,
  disabled,
  onChange,
  onReset
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onReset?: () => void;
}) {
  const nativeInputRef = useRef<HTMLInputElement | null>(null);
  const pickerValue = cssColorToNativeInput(value);
  const displayValue = formatColor(value, "rgb");
  const openNativeColorPicker = useCallback(() => {
    const input = nativeInputRef.current;
    if (!input) return;
    const colorInput = input as HTMLInputElement & { showPicker?: () => void };
    try {
      if (colorInput.showPicker) {
        colorInput.showPicker();
        return;
      }
    } catch {
      // Fall back to click when showPicker is unavailable or blocked.
    }
    input.click();
  }, []);

  return (
    <StyleRow label={label} onReset={onReset}>
      <div className="dom-ai-color-popover-anchor">
        <button
          type="button"
          className="dom-ai-color-row-control"
          disabled={disabled}
          onClick={openNativeColorPicker}
        >
          <span className="dom-ai-color-swatch" style={{ background: swatchBackground(value) }} />
          <span>{displayValue}</span>
        </button>
        <input
          ref={nativeInputRef}
          className="dom-ai-native-color-input"
          type="color"
          disabled={disabled}
          tabIndex={-1}
          value={pickerValue}
          onInput={(event) => onChange(event.currentTarget.value)}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      </div>
    </StyleRow>
  );
}

function TextInputStyleRow({
  label,
  value,
  disabled,
  onChange,
  onReset
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onReset?: () => void;
}) {
  return (
    <StyleRow label={label} onReset={onReset}>
      <input
        className="dom-ai-text-style-input"
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        spellCheck={false}
      />
    </StyleRow>
  );
}

function FontFamilyStyleRow({
  label,
  value,
  computedValue,
  pageFontFamilies,
  optionKey,
  disabled,
  onChange,
  onReset
}: {
  label: string;
  value: string;
  computedValue: string;
  pageFontFamilies?: string[];
  optionKey: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onReset?: () => void;
}) {
  const initialOptionsRef = useRef<SelectStyleOption[] | null>(null);
  const initialOptionsKeyRef = useRef<string | null>(null);
  if (!initialOptionsRef.current || initialOptionsKeyRef.current !== optionKey) {
    initialOptionsRef.current = getInitialFontFamilyOptions(value, computedValue, pageFontFamilies);
    initialOptionsKeyRef.current = optionKey;
  }
  const options = useMemo(() => mergeFontFamilyOptions(initialOptionsRef.current ?? [], value), [value]);
  const optionValues = useMemo(() => options.map((option) => option.value), [options]);
  const activeValue = normalizeFontFamilyName(value);
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ left: number; top: number; width: number } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const portalRoot = containerRef.current?.closest(".dom-ai-root") ?? null;

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const menuHeight = Math.min(220, options.length * 28 + 8 + (!optionValues.includes(value) && value ? 28 : 0));
    const belowTop = rect.bottom + 5;
    const aboveTop = rect.top - menuHeight - 5;
    const shouldOpenAbove = belowTop + menuHeight > window.innerHeight - 8 && aboveTop >= 8;
    const top = shouldOpenAbove
      ? aboveTop
      : Math.min(belowTop, Math.max(8, window.innerHeight - menuHeight - 8));
    const width = Math.max(188, rect.width);
    const left = Math.min(
      Math.max(8, rect.right - width),
      Math.max(8, window.innerWidth - width - 8)
    );
    setMenuPosition({ left, top, width });
  }, [optionValues, options.length, value]);

  useEffect(() => {
    if (!open) return;
    updateMenuPosition();
    const closeFromDocument = (event: PointerEvent) => {
      const root = containerRef.current;
      const menuRoot = menuRef.current;
      const path = event.composedPath();
      if (!root) return;
      if (path.includes(root) || (menuRoot && path.includes(menuRoot))) return;
      setOpen(false);
    };
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeFromDocument, true);
    document.addEventListener("keydown", closeFromKeyboard, true);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      document.removeEventListener("pointerdown", closeFromDocument, true);
      document.removeEventListener("keydown", closeFromKeyboard, true);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open, updateMenuPosition]);

  const selectOption = useCallback((option: string) => {
    onChange(option);
    setOpen(false);
  }, [onChange]);

  const menu = open && menuPosition ? (
    <div
      ref={menuRef}
      className="dom-ai-select-menu dom-ai-select-menu-floating dom-ai-font-menu"
      role="listbox"
      style={{ left: menuPosition.left, top: menuPosition.top, width: menuPosition.width }}
    >
      {!optionValues.includes(value) && value ? (
        <button
          type="button"
          className="dom-ai-select-option dom-ai-select-option-active"
          role="option"
          aria-selected="true"
          title={value}
          onClick={() => selectOption(value)}
        >
          <span>{value}</span>
          <Check size={13} />
        </button>
      ) : null}
      {options.map((option) => {
        const selected = normalizeFontFamilyName(option.value) === activeValue;
        return (
          <button
            key={`${option.label}-${option.value}`}
            type="button"
            className={`dom-ai-select-option ${selected ? "dom-ai-select-option-active" : ""}`}
            role="option"
            aria-selected={selected}
            title={option.value}
            onClick={() => selectOption(option.value)}
          >
            <span>{option.label}</span>
            {selected ? <Check size={13} /> : null}
          </button>
        );
      })}
    </div>
  ) : null;

  return (
    <StyleRow label={label} onReset={onReset}>
      <div className="dom-ai-font-combobox" ref={containerRef}>
        <input
          className="dom-ai-font-input"
          disabled={disabled}
          value={value}
          title={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          spellCheck={false}
        />
        <button
          ref={triggerRef}
          type="button"
          className={`dom-ai-font-trigger ${open ? "dom-ai-font-trigger-open" : ""}`}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <ChevronDown size={15} />
        </button>
        {portalRoot && menu ? createPortal(menu, portalRoot) : menu}
      </div>
    </StyleRow>
  );
}

function TextSelectStyleRow({
  label,
  value,
  options,
  disabled,
  compact,
  onChange,
  onReset
}: {
  label: string;
  value: string;
  options: Array<string | SelectStyleOption>;
  disabled: boolean;
  compact?: boolean;
  onChange: (value: string) => void;
  onReset?: () => void;
}) {
  const normalizedOptions = useMemo<SelectStyleOption[]>(
    () => options.map((option) => typeof option === "string" ? { value: option, label: option } : option),
    [options]
  );
  const optionValues = useMemo(() => normalizedOptions.map((option) => option.value), [normalizedOptions]);
  const activeOption = normalizedOptions.find((option) => option.value === value);
  const fallbackValue = value || (normalizedOptions[0]?.value ?? "");
  const fallbackLabel = value || (normalizedOptions[0]?.label ?? "");
  const normalizedValue = activeOption?.value ?? fallbackValue;
  const normalizedLabel = activeOption?.label ?? fallbackLabel;
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ left: number; top: number; width: number } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const portalRoot = containerRef.current?.closest(".dom-ai-root") ?? null;

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const menuHeight = Math.min(220, normalizedOptions.length * 28 + 8 + (!optionValues.includes(value) && value ? 28 : 0));
    const belowTop = rect.bottom + 5;
    const aboveTop = rect.top - menuHeight - 5;
    const shouldOpenAbove = belowTop + menuHeight > window.innerHeight - 8 && aboveTop >= 8;
    const top = shouldOpenAbove
      ? aboveTop
      : Math.min(belowTop, Math.max(8, window.innerHeight - menuHeight - 8));
    const width = Math.max(128, rect.width);
    const left = Math.min(
      Math.max(8, rect.right - width),
      Math.max(8, window.innerWidth - width - 8)
    );
    setMenuPosition({ left, top, width });
  }, [normalizedOptions.length, optionValues, value]);

  useEffect(() => {
    if (!open) return;
    updateMenuPosition();
    const closeFromDocument = (event: PointerEvent) => {
      const root = containerRef.current;
      const menuRoot = menuRef.current;
      const path = event.composedPath();
      if (!root) return;
      if (path.includes(root) || (menuRoot && path.includes(menuRoot))) return;
      setOpen(false);
    };
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeFromDocument, true);
    document.addEventListener("keydown", closeFromKeyboard, true);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      document.removeEventListener("pointerdown", closeFromDocument, true);
      document.removeEventListener("keydown", closeFromKeyboard, true);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open, updateMenuPosition]);

  const selectOption = useCallback((option: string) => {
    onChange(option);
    setOpen(false);
  }, [onChange]);

  const menu = open && menuPosition ? (
    <div
      ref={menuRef}
      className="dom-ai-select-menu dom-ai-select-menu-floating"
      role="listbox"
      style={{ left: menuPosition.left, top: menuPosition.top, width: menuPosition.width }}
    >
      {!optionValues.includes(value) && value ? (
        <button
          type="button"
          className="dom-ai-select-option dom-ai-select-option-active"
          role="option"
          aria-selected="true"
          onClick={() => selectOption(value)}
        >
          <span>{value}</span>
          <Check size={13} />
        </button>
      ) : null}
      {normalizedOptions.map((option) => {
        const selected = option.value === normalizedValue;
        return (
          <button
            key={option.value}
            type="button"
            className={`dom-ai-select-option ${selected ? "dom-ai-select-option-active" : ""}`}
            role="option"
            aria-selected={selected}
            onClick={() => selectOption(option.value)}
          >
            <span>{option.label}</span>
            {selected ? <Check size={13} /> : null}
          </button>
        );
      })}
    </div>
  ) : null;

  return (
    <StyleRow label={label} onReset={onReset}>
      <div className={`dom-ai-select-control ${compact ? "dom-ai-select-control-compact" : ""}`} ref={containerRef}>
        <button
          ref={triggerRef}
          type="button"
          className={`dom-ai-select-trigger ${open ? "dom-ai-select-trigger-open" : ""}`}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <span>{normalizedLabel}</span>
          <ChevronDown size={15} />
        </button>
        {portalRoot && menu ? createPortal(menu, portalRoot) : menu}
      </div>
    </StyleRow>
  );
}

function NumericStyleRow({
  config,
  value,
  disabled,
  onChange,
  onDragStart,
  onReset
}: {
  config: NumericAdjusterConfig;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onDragStart: NumericDragHandler;
  onReset?: () => void;
}) {
  return (
    <StyleRow label={config.label} onReset={onReset}>
      <NumericInputControl
        config={config}
        value={value}
        disabled={disabled}
        onChange={onChange}
        onDragStart={onDragStart}
      />
    </StyleRow>
  );
}

function NumericInputControl({
  config,
  value,
  disabled,
  compact = false,
  linkedConfigs,
  onChange,
  onDragStart
}: {
  config: NumericAdjusterConfig;
  value: string;
  disabled: boolean;
  compact?: boolean;
  linkedConfigs?: NumericAdjusterConfig[];
  onChange: (value: string) => void;
  onDragStart: NumericDragHandler;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const skipBlurCommitRef = useRef(false);
  const [editing, setEditing] = useState(false);
  const numericValue = pxNumber(value);
  const displayValue = Number.isFinite(numericValue) ? `${roundToPrecision(numericValue, config.precision)}` : "";
  const focusValueRef = useRef(displayValue);
  const [draftValue, setDraftValue] = useState(displayValue);
  const renderedValue = editing ? draftValue : displayValue;

  useEffect(() => {
    if (!editing) setDraftValue(displayValue);
  }, [displayValue, editing]);

  const commitDraftValue = useCallback((nextValue: string) => {
    onChange(nextValue.trim());
  }, [onChange]);

  const updateDraftValue = useCallback((nextValue: string) => {
    setDraftValue(nextValue);
    commitDraftValue(nextValue);
  }, [commitDraftValue]);

  const handleFocus = useCallback(() => {
    skipBlurCommitRef.current = false;
    focusValueRef.current = displayValue;
    setEditing(true);
    setDraftValue(displayValue);
    window.requestAnimationFrame(() => inputRef.current?.select());
  }, [displayValue]);

  const handleBlur = useCallback(() => {
    setEditing(false);
    if (skipBlurCommitRef.current) {
      skipBlurCommitRef.current = false;
      setDraftValue(displayValue);
      return;
    }
    commitDraftValue(draftValue);
  }, [commitDraftValue, displayValue, draftValue]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      skipBlurCommitRef.current = true;
      setDraftValue(focusValueRef.current);
      commitDraftValue(focusValueRef.current);
      setEditing(false);
      event.currentTarget.blur();
    }
  }, [commitDraftValue]);

  return (
    <div className={`dom-ai-number-control ${compact ? "dom-ai-number-control-compact" : ""}`}>
      <input
        ref={inputRef}
        type="number"
        disabled={disabled}
        value={renderedValue}
        min={config.min}
        max={config.max}
        step={config.step}
        title="点击输入数值，按住上下拖动调整"
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onChange={(event) => updateDraftValue(event.currentTarget.value)}
        onPointerDown={(event) => onDragStart(config, event, linkedConfigs)}
        onWheel={(event) => {
          if (event.currentTarget.ownerDocument.activeElement === event.currentTarget) {
            event.currentTarget.blur();
          }
        }}
      />
      <span className="dom-ai-number-unit">{config.unit}</span>
    </div>
  );
}

function InlineNumericControl({
  config,
  value,
  disabled,
  compact = false,
  linkedConfigs,
  onChange,
  onDragStart
}: {
  config: NumericAdjusterConfig;
  value: string;
  disabled: boolean;
  compact?: boolean;
  linkedConfigs?: NumericAdjusterConfig[];
  onChange: (value: string) => void;
  onDragStart: NumericDragHandler;
}) {
  return (
    <NumericInputControl
      config={config}
      value={value}
      disabled={disabled}
      compact={compact}
      linkedConfigs={linkedConfigs}
      onChange={onChange}
      onDragStart={onDragStart}
    />
  );
}

function AlignStyleRow({
  value,
  disabled,
  onChange,
  onReset
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onReset?: () => void;
}) {
  const options = [
    { value: "left", label: "左对齐", icon: <AlignLeft size={15} /> },
    { value: "center", label: "居中", icon: <AlignCenter size={15} /> },
    { value: "right", label: "右对齐", icon: <AlignRight size={15} /> },
    { value: "justify", label: "两端", icon: <AlignJustify size={15} /> }
  ];
  return (
    <StyleRow label="对齐" onReset={onReset}>
      <div className="dom-ai-align-control">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={value === option.value ? "dom-ai-align-active" : ""}
            disabled={disabled}
            title={option.label}
            onClick={() => onChange(option.value)}
          >
            {option.icon}
          </button>
        ))}
      </div>
    </StyleRow>
  );
}

function GapSpacingGroup({
  values,
  configs,
  disabled,
  activeScrubKeys,
  onChange,
  onDragStart,
  onReset
}: {
  values: EditableStyleValues;
  configs: NumericAdjusterConfigs;
  disabled: boolean;
  activeScrubKeys: ReadonlySet<keyof EditableStyleValues> | null;
  onChange: NumericChangeHandler;
  onDragStart: NumericDragHandler;
  onReset: (property: keyof EditableStyleValues, cssProperty: string) => (() => void) | undefined;
}) {
  const rows = [
    { label: "水平", key: "columnGap" as const, css: "column-gap" },
    { label: "垂直", key: "rowGap" as const, css: "row-gap" }
  ];
  const visibleRows = activeScrubKeys ? rows.filter((row) => activeScrubKeys.has(row.key)) : rows;
  const revealGroup = useCallback((event: React.SyntheticEvent<HTMLDetailsElement>) => {
    const group = event.currentTarget;
    if (!group.open) return;
    window.requestAnimationFrame(() => {
      group.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }, []);

  if (activeScrubKeys) {
    return (
      <div className="dom-ai-property-group dom-ai-property-group-scrubbing">
        <GapSpacingRows
          rows={visibleRows}
          values={values}
          configs={configs}
          disabled={disabled}
          onChange={onChange}
          onDragStart={onDragStart}
          onReset={onReset}
        />
      </div>
    );
  }

  return (
    <details className="dom-ai-property-group dom-ai-gap-property-group" onToggle={revealGroup}>
      <summary>
        <span className="dom-ai-property-summary-label">
          <ChevronDown className="dom-ai-summary-chevron" size={13} />
          <span>间距</span>
        </span>
        <span className="dom-ai-box-preview dom-ai-gap-preview" aria-label="间距预览">
          {rows.map((row) => (
            <BoxSpacingPreviewInput
              key={row.key}
              config={configs[row.key]}
              value={values[row.key]}
              disabled={disabled}
              onChange={(value) => onChange(configs[row.key], value)}
              onDragStart={onDragStart}
            />
          ))}
        </span>
      </summary>
      <GapSpacingRows
        rows={rows}
        values={values}
        configs={configs}
        disabled={disabled}
        onChange={onChange}
        onDragStart={onDragStart}
        onReset={onReset}
      />
    </details>
  );
}

function GapSpacingRows({
  rows,
  values,
  configs,
  disabled,
  onChange,
  onDragStart,
  onReset
}: {
  rows: Array<{ label: string; key: "columnGap" | "rowGap"; css: string }>;
  values: EditableStyleValues;
  configs: NumericAdjusterConfigs;
  disabled: boolean;
  onChange: NumericChangeHandler;
  onDragStart: NumericDragHandler;
  onReset: (property: keyof EditableStyleValues, cssProperty: string) => (() => void) | undefined;
}) {
  return (
    <div className="dom-ai-nested-property-list dom-ai-gap-rows">
      {rows.map((row) => {
        const reset = onReset(row.key, row.css);
        return (
          <div className="dom-ai-linked-dimension-row" key={row.key}>
            <span className="dom-ai-style-row-label">{row.label}</span>
            <div className="dom-ai-style-row-control">
              {reset ? (
                <button type="button" className="dom-ai-row-reset" aria-label={`重置${row.label}间距`} title={`重置${row.label}间距`} onClick={reset}>
                  <RotateCcw size={12} />
                </button>
              ) : null}
              <InlineNumericControl
                config={configs[row.key]}
                value={values[row.key]}
                disabled={disabled}
                compact
                onChange={(value) => onChange(configs[row.key], value)}
                onDragStart={onDragStart}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SizeRows({
  values,
  configs,
  disabled,
  linked,
  activeScrubKeys,
  onLinkedChange,
  onChange,
  onDragStart,
  onReset
}: {
  values: EditableStyleValues;
  configs: NumericAdjusterConfigs;
  disabled: boolean;
  linked: boolean;
  activeScrubKeys: ReadonlySet<keyof EditableStyleValues> | null;
  onLinkedChange: (linked: boolean) => void;
  onChange: NumericChangeHandler;
  onDragStart: NumericDragHandler;
  onReset: (property: keyof EditableStyleValues, cssProperty: string) => (() => void) | undefined;
}) {
  const rows = [
    { label: "宽度", key: "width" as const, css: "width" },
    { label: "高度", key: "height" as const, css: "height" }
  ];
  const visibleRows = activeScrubKeys ? rows.filter((row) => activeScrubKeys.has(row.key)) : rows;
  const showSizeLink = !activeScrubKeys || (visibleRows.some((row) => row.key === "width") && visibleRows.some((row) => row.key === "height"));

  return (
    <div className="dom-ai-linked-dimension-group">
      {visibleRows.map((row) => {
        const reset = onReset(row.key, row.css);
        const linkedConfigs = linked ? [configs.width, configs.height] : undefined;
        return (
          <div className="dom-ai-linked-dimension-row" key={row.key}>
            <span className={`dom-ai-style-row-label ${row.key === "width" && showSizeLink ? "dom-ai-linked-dimension-label" : ""}`}>
              {row.key === "width" && showSizeLink ? (
                <span className="dom-ai-linked-dimension-lines">
                  <ConnectorBracket />
                  <button
                    type="button"
                    className={`dom-ai-link-toggle ${linked ? "dom-ai-link-toggle-active" : ""}`}
                    aria-pressed={linked}
                    aria-label={linked ? "取消联动宽高" : "联动宽高"}
                    title={linked ? "取消联动宽高" : "联动宽高"}
                    onClick={() => onLinkedChange(!linked)}
                  >
                    <Link2 size={10} />
                  </button>
                </span>
              ) : null}
              <span>{row.label}</span>
            </span>
            <div className="dom-ai-style-row-control">
              {reset ? (
                <button type="button" className="dom-ai-row-reset" aria-label={`重置${row.label}`} title={`重置${row.label}`} onClick={reset}>
                  <RotateCcw size={12} />
                </button>
              ) : null}
              <InlineNumericControl
                config={configs[row.key]}
                value={values[row.key]}
                disabled={disabled}
                compact
                linkedConfigs={linkedConfigs}
                onChange={(value) => onChange(configs[row.key], value, linkedConfigs)}
                onDragStart={onDragStart}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BoxSpacingGroup({
  prefix,
  values,
  configs,
  disabled,
  linkedBlock,
  linkedInline,
  activeScrubKeys,
  onLinkedBlockChange,
  onLinkedInlineChange,
  onChange,
  onDragStart,
  onReset
}: {
  prefix: "margin" | "padding";
  values: EditableStyleValues;
  configs: NumericAdjusterConfigs;
  disabled: boolean;
  linkedBlock: boolean;
  linkedInline: boolean;
  activeScrubKeys: ReadonlySet<keyof EditableStyleValues> | null;
  onLinkedBlockChange: (linked: boolean) => void;
  onLinkedInlineChange: (linked: boolean) => void;
  onChange: NumericChangeHandler;
  onDragStart: NumericDragHandler;
  onReset: (property: keyof EditableStyleValues, cssProperty: string) => (() => void) | undefined;
}) {
  const label = prefix === "margin" ? "外边距" : "内边距";
  const revealGroup = useCallback((event: React.SyntheticEvent<HTMLDetailsElement>) => {
    const group = event.currentTarget;
    if (!group.open) return;
    window.requestAnimationFrame(() => {
      group.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  }, []);

  if (activeScrubKeys) {
    return (
      <div className="dom-ai-property-group dom-ai-property-group-scrubbing">
        <BoxSpacingRows
          prefix={prefix}
          values={values}
          configs={configs}
          disabled={disabled}
          linkedBlock={linkedBlock}
          linkedInline={linkedInline}
          activeScrubKeys={activeScrubKeys}
          onLinkedBlockChange={onLinkedBlockChange}
          onLinkedInlineChange={onLinkedInlineChange}
          onChange={onChange}
          onDragStart={onDragStart}
          onReset={onReset}
        />
      </div>
    );
  }

  return (
    <details className="dom-ai-property-group" onToggle={revealGroup}>
      <summary>
        <span className="dom-ai-property-summary-label">
          <ChevronDown className="dom-ai-summary-chevron" size={13} />
          <span>{label}</span>
        </span>
        <BoxSpacingPreview
          prefix={prefix}
          values={values}
          configs={configs}
          disabled={disabled}
          linkedBlock={linkedBlock}
          linkedInline={linkedInline}
          onChange={onChange}
          onDragStart={onDragStart}
        />
      </summary>
      <BoxSpacingRows
        prefix={prefix}
        values={values}
        configs={configs}
        disabled={disabled}
        linkedBlock={linkedBlock}
        linkedInline={linkedInline}
        activeScrubKeys={activeScrubKeys}
        onLinkedBlockChange={onLinkedBlockChange}
        onLinkedInlineChange={onLinkedInlineChange}
        onChange={onChange}
        onDragStart={onDragStart}
        onReset={onReset}
      />
    </details>
  );
}

function BoxSpacingPreview({
  prefix,
  values,
  configs,
  disabled,
  linkedBlock,
  linkedInline,
  onChange,
  onDragStart
}: {
  prefix: "margin" | "padding";
  values: EditableStyleValues;
  configs: NumericAdjusterConfigs;
  disabled: boolean;
  linkedBlock: boolean;
  linkedInline: boolean;
  onChange: NumericChangeHandler;
  onDragStart: NumericDragHandler;
}) {
  const keys: readonly BoxSpacingProperty[] = prefix === "margin"
    ? ["marginTop", "marginRight", "marginBottom", "marginLeft"]
    : ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"];
  const blockKeys: readonly BoxSpacingProperty[] = prefix === "margin"
    ? ["marginTop", "marginBottom"]
    : ["paddingTop", "paddingBottom"];
  const inlineKeys: readonly BoxSpacingProperty[] = prefix === "margin"
    ? ["marginLeft", "marginRight"]
    : ["paddingLeft", "paddingRight"];

  return (
    <span className="dom-ai-box-preview" aria-label={`${prefix === "margin" ? "外边距" : "内边距"}预览`}>
      {keys.map((key) => {
        const linkedConfigs = blockKeys.includes(key) && linkedBlock
          ? blockKeys.map((item) => configs[item])
          : inlineKeys.includes(key) && linkedInline
            ? inlineKeys.map((item) => configs[item])
            : undefined;
        return (
          <BoxSpacingPreviewInput
            key={key}
            config={configs[key]}
            value={values[key]}
            disabled={disabled}
            linkedConfigs={linkedConfigs}
            onChange={(value) => onChange(configs[key], value, linkedConfigs)}
            onDragStart={onDragStart}
          />
        );
      })}
    </span>
  );
}

function BoxSpacingPreviewInput({
  config,
  value,
  disabled,
  linkedConfigs,
  onChange,
  onDragStart
}: {
  config: NumericAdjusterConfig;
  value: string;
  disabled: boolean;
  linkedConfigs?: NumericAdjusterConfig[];
  onChange: (value: string) => void;
  onDragStart: NumericDragHandler;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const skipBlurCommitRef = useRef(false);
  const [editing, setEditing] = useState(false);
  const numericValue = pxNumber(value);
  const displayValue = Number.isFinite(numericValue) ? `${roundToPrecision(numericValue, config.precision)}` : "";
  const focusValueRef = useRef(displayValue);
  const [draftValue, setDraftValue] = useState(displayValue);
  const renderedValue = editing ? draftValue : displayValue;

  useEffect(() => {
    if (!editing) setDraftValue(displayValue);
  }, [displayValue, editing]);

  const stopSummaryToggle = useCallback((event: React.SyntheticEvent) => {
    event.stopPropagation();
  }, []);

  const handleFocus = useCallback((event: React.FocusEvent<HTMLInputElement>) => {
    event.stopPropagation();
    skipBlurCommitRef.current = false;
    focusValueRef.current = displayValue;
    setEditing(true);
    setDraftValue(displayValue);
    window.requestAnimationFrame(() => inputRef.current?.select());
  }, [displayValue]);

  const handleBlur = useCallback(() => {
    setEditing(false);
    if (skipBlurCommitRef.current) {
      skipBlurCommitRef.current = false;
      setDraftValue(displayValue);
      return;
    }
    onChange(draftValue.trim());
  }, [displayValue, draftValue, onChange]);

  const updateDraftValue = useCallback((nextValue: string) => {
    setDraftValue(nextValue);
    onChange(nextValue.trim());
  }, [onChange]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      skipBlurCommitRef.current = true;
      setDraftValue(focusValueRef.current);
      onChange(focusValueRef.current);
      setEditing(false);
      event.currentTarget.blur();
    }
  }, [onChange]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLInputElement>) => {
    event.stopPropagation();
    onDragStart(config, event, linkedConfigs);
  }, [config, linkedConfigs, onDragStart]);

  return (
    <input
      ref={inputRef}
      className="dom-ai-box-preview-input"
      type="number"
      disabled={disabled}
      value={renderedValue}
      min={config.min}
      max={config.max}
      step={config.step}
      title="点击输入数值，按住上下拖动调整"
      onClick={stopSummaryToggle}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      onChange={(event) => updateDraftValue(event.currentTarget.value)}
      onPointerDown={handlePointerDown}
      onWheel={(event) => {
        event.stopPropagation();
        if (event.currentTarget.ownerDocument.activeElement === event.currentTarget) {
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function BoxSpacingRows({
  prefix,
  values,
  configs,
  disabled,
  linkedBlock,
  linkedInline,
  activeScrubKeys,
  onLinkedBlockChange,
  onLinkedInlineChange,
  onChange,
  onDragStart,
  onReset
}: {
  prefix: "margin" | "padding";
  values: EditableStyleValues;
  configs: NumericAdjusterConfigs;
  disabled: boolean;
  linkedBlock: boolean;
  linkedInline: boolean;
  activeScrubKeys: ReadonlySet<keyof EditableStyleValues> | null;
  onLinkedBlockChange: (linked: boolean) => void;
  onLinkedInlineChange: (linked: boolean) => void;
  onChange: NumericChangeHandler;
  onDragStart: NumericDragHandler;
  onReset: (property: keyof EditableStyleValues, cssProperty: string) => (() => void) | undefined;
}) {
  const rows = prefix === "margin"
    ? [
        { label: "上", key: "marginTop" as const, css: "margin-top" },
        { label: "底部", key: "marginBottom" as const, css: "margin-bottom" },
        { label: "左", key: "marginLeft" as const, css: "margin-left" },
        { label: "右", key: "marginRight" as const, css: "margin-right" }
      ]
    : [
        { label: "上", key: "paddingTop" as const, css: "padding-top" },
        { label: "底部", key: "paddingBottom" as const, css: "padding-bottom" },
        { label: "左", key: "paddingLeft" as const, css: "padding-left" },
        { label: "右", key: "paddingRight" as const, css: "padding-right" }
      ];
  const blockKeys: readonly BoxSpacingProperty[] = prefix === "margin"
    ? ["marginTop", "marginBottom"]
    : ["paddingTop", "paddingBottom"];
  const inlineKeys: readonly BoxSpacingProperty[] = prefix === "margin"
    ? ["marginLeft", "marginRight"]
    : ["paddingLeft", "paddingRight"];
  const visibleRows = activeScrubKeys ? rows.filter((row) => activeScrubKeys.has(row.key)) : rows;
  const showBlockLink = visibleRows.some((row) => row.key === blockKeys[0])
    && visibleRows.some((row) => row.key === blockKeys[1]);
  const showInlineLink = visibleRows.some((row) => row.key === inlineKeys[0])
    && visibleRows.some((row) => row.key === inlineKeys[1]);

  return (
    <div className="dom-ai-nested-property-list">
      {visibleRows.map((row) => {
        const reset = onReset(row.key, row.css);
        const linkedConfigs = blockKeys.includes(row.key) && linkedBlock
          ? blockKeys.map((key) => configs[key])
          : inlineKeys.includes(row.key) && linkedInline
            ? inlineKeys.map((key) => configs[key])
            : undefined;
        return (
          <div className="dom-ai-linked-dimension-row" key={row.key}>
            <span className={`dom-ai-style-row-label ${
              (row.key === blockKeys[0] && showBlockLink) || (row.key === inlineKeys[0] && showInlineLink)
                ? "dom-ai-spacing-linked-label"
                : ""
            }`}>
              {row.key === blockKeys[0] && showBlockLink ? (
                <span className="dom-ai-spacing-link-glyph">
                  <ConnectorBracket />
                  <button
                    type="button"
                    className={`dom-ai-link-toggle ${linkedBlock ? "dom-ai-link-toggle-active" : ""}`}
                    aria-pressed={linkedBlock}
                    aria-label={linkedBlock ? "取消联动上下边距" : "联动上下边距"}
                    title={linkedBlock ? "取消联动上下边距" : "联动上下边距"}
                    onClick={() => onLinkedBlockChange(!linkedBlock)}
                  >
                    <Link2 size={10} />
                  </button>
                </span>
              ) : null}
              {row.key === inlineKeys[0] && showInlineLink ? (
                <span className="dom-ai-spacing-link-glyph">
                  <ConnectorBracket />
                  <button
                    type="button"
                    className={`dom-ai-link-toggle ${linkedInline ? "dom-ai-link-toggle-active" : ""}`}
                    aria-pressed={linkedInline}
                    aria-label={linkedInline ? "取消联动左右边距" : "联动左右边距"}
                    title={linkedInline ? "取消联动左右边距" : "联动左右边距"}
                    onClick={() => onLinkedInlineChange(!linkedInline)}
                  >
                    <Link2 size={10} />
                  </button>
                </span>
              ) : null}
              <span>{row.label}</span>
            </span>
            <div className="dom-ai-style-row-control">
              {reset ? (
                <button type="button" className="dom-ai-row-reset" aria-label={`重置${row.label}`} title={`重置${row.label}`} onClick={reset}>
                  <RotateCcw size={12} />
                </button>
              ) : null}
              <InlineNumericControl
                config={configs[row.key]}
                value={values[row.key]}
                disabled={disabled}
                compact
                linkedConfigs={linkedConfigs}
                onChange={(value) => onChange(configs[row.key], value, linkedConfigs)}
                onDragStart={onDragStart}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ConnectorBracket() {
  return (
    <svg aria-hidden="true" className="dom-ai-connector-bracket" fill="none" viewBox="0 0 36 62">
      <path d="M28 14H2M28 14V48M28 48H2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.2" />
    </svg>
  );
}

function StyleTuneIcon({ size }: { size: number }) {
  return <Settings2 aria-hidden="true" size={size} strokeWidth={2.15} />;
}

function CodexGripDots() {
  return (
    <span className="dom-ai-codex-grip" aria-hidden="true">
      {Array.from({ length: 6 }, (_, index) => (
        <i key={index} />
      ))}
    </span>
  );
}

function formatCompactNumber(value: string): string {
  const number = pxNumber(value);
  if (!Number.isFinite(number)) return "-";
  return `${roundToPrecision(number, 0.1)}`;
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

function shouldDeferPointerToEmbeddedContent(event: MouseEvent, lastChildFrameHoverAt = 0): boolean {
  if (isEmbeddedFrameWindow()) return false;
  const embeddedHost = document.elementsFromPoint(event.clientX, event.clientY).find(isEmbeddedContentHost);
  if (!embeddedHost) return false;
  return performance.now() - lastChildFrameHoverAt < 260;
}

function isPointerLeavingForEmbeddedContent(event: MouseEvent, lastChildFrameHoverAt = 0): boolean {
  if (isEmbeddedFrameWindow()) return false;
  if (performance.now() - lastChildFrameHoverAt >= 260) return false;
  if (event.relatedTarget instanceof Element && isEmbeddedContentHost(event.relatedTarget)) return true;
  return shouldDeferPointerToEmbeddedContent(event, lastChildFrameHoverAt);
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
  return shouldHandleAnnotationAction(annotation, context);
}

function isAnnotationForCurrentPage(annotation: DomAnnotation, context: PageContext): boolean {
  const targetContext = annotation.context;
  const currentTopUrl = context.topUrl || context.url || location.href;
  const targetTopUrl = targetContext?.topUrl
    || (targetContext?.kind === "top" ? targetContext.url : undefined)
    || annotation.url;
  return normalizeContextUrl(targetTopUrl) === normalizeContextUrl(currentTopUrl);
}

function shouldHandleAnnotationAction(annotation: DomAnnotation, context: PageContext): boolean {
  return shouldHandleTargetContext(annotation.context, annotation.url, context);
}

function shouldHandleAnnotationReferenceAction(reference: AnnotationReference, context: PageContext): boolean {
  return shouldHandleTargetContext(reference.context, reference.url, context);
}

function shouldHandleTargetContext(targetContext: PageContext | undefined, targetUrl: string, context: PageContext): boolean {
  if (!targetContext) {
    return !isEmbeddedFrameWindow() && normalizeContextUrl(targetUrl) === normalizeContextUrl(location.href);
  }

  if (targetContext.kind === "wujie" || targetContext.kind === "micro-app") {
    const targetTopUrl = targetContext.topUrl || targetContext.url;
    const currentTopUrl = context.topUrl || context.url;
    return !isEmbeddedFrameWindow() && normalizeContextUrl(targetTopUrl) === normalizeContextUrl(currentTopUrl);
  }

  const targetUrlMatches = normalizeContextUrl(targetContext.url || targetUrl) === normalizeContextUrl(context.url);
  if (!targetUrlMatches) return false;

  const targetKind = targetContext.kind;
  const currentKind = context.kind;
  if (targetKind === "top" || currentKind === "top") {
    return targetKind === currentKind;
  }

  const targetTopUrl = targetContext.topUrl || targetContext.hostUrl || "";
  const currentTopUrl = context.topUrl || context.hostUrl || "";
  if (targetTopUrl && currentTopUrl && normalizeContextUrl(targetTopUrl) !== normalizeContextUrl(currentTopUrl)) {
    return false;
  }

  const targetFrameId = targetContext.frameId ?? (targetContext.kind === "top" ? 0 : undefined);
  const currentFrameId = context.frameId ?? (context.kind === "top" ? 0 : undefined);

  if (targetFrameId !== undefined || currentFrameId !== undefined) {
    if (targetFrameId === currentFrameId) return true;
  }

  if (targetContext.hostSelector && context.hostSelector && targetContext.hostSelector !== context.hostSelector) {
    return false;
  }

  return targetKind === currentKind;
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
    textContent: getEditableElementText(element),
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
    textAlign: styles.textAlign,
    flexDirection: styles.flexDirection,
    justifyContent: styles.justifyContent,
    alignItems: styles.alignItems,
    gridAutoFlow: styles.gridAutoFlow,
    zIndex: styles.zIndex,
    gap: styles.gap,
    rowGap: styles.rowGap,
    columnGap: styles.columnGap,
    margin: getBoxValue(styles, "margin"),
    padding: getBoxValue(styles, "padding"),
    borderRadius: styles.borderRadius,
    borderColor: styles.borderColor,
    borderWidth: styles.borderWidth,
    width: styles.width,
    height: styles.height
  };
}

function serializeHoverInspection(inspection: HoverInspection): SerializableHoverInspection {
  const { element: _element, ...snapshot } = inspection;
  return snapshot;
}

function getIframeHostForMessageSource(source: MessageEventSource | null): HTMLIFrameElement | null {
  if (!source || typeof MessagePort !== "undefined" && source instanceof MessagePort) return null;
  return Array.from(document.querySelectorAll("iframe"))
    .find((iframe) => iframe.contentWindow === source) ?? null;
}

function createTopComposerStateFromIframeSelection(payload: IframeSelectionPayload, frameHost: HTMLIFrameElement): ComposerState {
  const frameRect = frameHost.getBoundingClientRect();
  const frameDocumentRect = {
    x: frameRect.left + window.scrollX,
    y: frameRect.top + window.scrollY,
    width: frameRect.width,
    height: frameRect.height
  };
  const viewportRect = {
    x: frameRect.left + payload.inspection.viewportRect.x,
    y: frameRect.top + payload.inspection.viewportRect.y,
    width: payload.inspection.viewportRect.width,
    height: payload.inspection.viewportRect.height
  };
  const documentRect = {
    x: frameDocumentRect.x + payload.inspection.viewportRect.x,
    y: frameDocumentRect.y + payload.inspection.viewportRect.y,
    width: payload.inspection.documentRect.width,
    height: payload.inspection.documentRect.height
  };
  const draftRect = {
    ...payload.draft.rect,
    x: viewportRect.x,
    y: viewportRect.y,
    scrollX: window.scrollX,
    scrollY: window.scrollY
  };
  const draftPin = payload.draft.pin
    ? {
        x: payload.pointerViewport
          ? frameDocumentRect.x + payload.pointerViewport.x
          : frameDocumentRect.x + (payload.draft.pin.x - payload.draft.rect.scrollX),
        y: payload.pointerViewport
          ? frameDocumentRect.y + payload.pointerViewport.y
          : frameDocumentRect.y + (payload.draft.pin.y - payload.draft.rect.scrollY)
      }
    : undefined;
  const draft = {
    ...payload.draft,
    rect: draftRect,
    pin: draftPin,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      userAgent: navigator.userAgent
    }
  };

  return {
    draft,
    inspection: {
      ...payload.inspection,
      key: `iframe-${payload.context.frameId ?? "unknown"}:${payload.inspection.key}`,
      viewportRect,
      documentRect
    },
    initialScreenshot: payload.initialScreenshot,
    remoteInlineStyleSnapshot: payload.inlineStyleSnapshot ?? {},
    fontFamilies: payload.fontFamilies
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
    textContent: annotation.element.text ?? "",
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
    textAlign: annotation.computedStyles.textAlign ?? "-",
    flexDirection: annotation.computedStyles.flexDirection ?? "row",
    justifyContent: annotation.computedStyles.justifyContent ?? "flex-start",
    alignItems: annotation.computedStyles.alignItems ?? "stretch",
    gridAutoFlow: annotation.computedStyles.gridAutoFlow ?? "row",
    zIndex: annotation.computedStyles.zIndex ?? "-",
    gap: annotation.computedStyles.gap ?? "-",
    rowGap: annotation.computedStyles.rowGap ?? annotation.computedStyles.gap ?? "-",
    columnGap: annotation.computedStyles.columnGap ?? annotation.computedStyles.gap ?? "-",
    margin: getComputedBoxSnapshot(annotation.computedStyles, "margin"),
    padding: getComputedBoxSnapshot(annotation.computedStyles, "padding"),
    borderRadius: annotation.computedStyles.borderRadius ?? "-",
    borderColor: annotation.computedStyles.borderColor ?? "rgba(0, 0, 0, 0)",
    borderWidth: annotation.computedStyles.borderWidth ?? "-",
    width: annotation.computedStyles.width ?? "-",
    height: annotation.computedStyles.height ?? "-"
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

function clampComposerPosition(left: number, top: number, estimatedHeight = COMPOSER_MIN_VISIBLE_HEIGHT): { left: number; top: number } {
  const viewportLeft = window.scrollX + EDGE_GAP;
  const viewportRight = window.scrollX + window.innerWidth - EDGE_GAP;
  const viewportTop = window.scrollY + EDGE_GAP;
  const viewportBottom = window.scrollY + window.innerHeight - EDGE_GAP;
  return {
    left: clamp(left, viewportLeft, Math.max(viewportLeft, viewportRight - COMPOSER_WIDTH)),
    top: clamp(top, viewportTop, Math.max(viewportTop, viewportBottom - estimatedHeight))
  };
}

function getComposerPosition(
  rect: HoverInspection["documentRect"],
  anchor?: AnnotationPinAnchor,
  expanded = false
): { left: number; top: number } {
  const estimatedHeight = expanded ? COMPOSER_MIN_VISIBLE_HEIGHT : COMPOSER_COMPACT_ESTIMATED_HEIGHT;
  const viewportTop = window.scrollY + EDGE_GAP;
  const viewportBottom = window.scrollY + window.innerHeight - EDGE_GAP;
  const viewportLeft = window.scrollX + EDGE_GAP;
  const viewportRight = window.scrollX + window.innerWidth - EDGE_GAP;
  const gap = 12;

  if (anchor) {
    const candidates = [
      { left: anchor.x + gap, top: anchor.y + gap },
      { left: anchor.x + gap, top: anchor.y - estimatedHeight / 2 + 16 },
      { left: anchor.x + gap, top: anchor.y - estimatedHeight - gap },
      { left: rect.x + rect.width + gap, top: rect.y + rect.height + gap },
      { left: rect.x + rect.width + gap, top: rect.y + rect.height / 2 - estimatedHeight / 2 },
      { left: anchor.x - COMPOSER_WIDTH - gap, top: anchor.y + gap },
      { left: anchor.x - COMPOSER_WIDTH - gap, top: anchor.y - estimatedHeight / 2 + 16 },
      { left: anchor.x - COMPOSER_WIDTH - gap, top: anchor.y - estimatedHeight - gap },
      { left: rect.x - COMPOSER_WIDTH - gap, top: rect.y + rect.height + gap },
      { left: rect.x - COMPOSER_WIDTH - gap, top: rect.y + rect.height / 2 - estimatedHeight / 2 }
    ];
    const fitting = candidates.find((candidate) => (
      candidate.left >= viewportLeft
      && candidate.left + COMPOSER_WIDTH <= viewportRight
      && candidate.top >= viewportTop
      && candidate.top + estimatedHeight <= viewportBottom
    ));
    if (fitting) return fitting;
    return clampComposerPosition(candidates[0].left, candidates[0].top, estimatedHeight);
  }

  const belowTop = rect.y + rect.height + 12;
  const aboveTop = rect.y - COMPOSER_ESTIMATED_HEIGHT - 12;
  const hasRoomBelow = viewportBottom - belowTop >= estimatedHeight;
  const preferredTop = hasRoomBelow ? belowTop : aboveTop;

  return {
    left: clampWithinDocument(rect.x, COMPOSER_WIDTH),
    top: Math.max(viewportTop, Math.min(preferredTop, viewportBottom - estimatedHeight))
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
  if (isEmbeddedFrameWindow()) return;

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
