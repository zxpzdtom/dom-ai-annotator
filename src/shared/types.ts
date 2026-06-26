export type FeedbackType = "bug" | "style" | "copy" | "layout" | "interaction" | "question";
export type FeedbackSeverity = "blocking" | "important" | "suggestion";
export type AnnotationStatus = "pending" | "sent" | "changed" | "needs_work" | "passed" | "skipped";
export type LegacyAnnotationStatus = "acknowledged" | "resolved" | "rejected";

export type ElementSummary = {
  tag: string;
  id?: string;
  className?: string;
  text?: string;
  role?: string;
  ariaLabel?: string;
};

export type ElementRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
};

export type AnnotationPinAnchor = {
  x: number;
  y: number;
};

export type ViewportSnapshot = {
  width: number;
  height: number;
  devicePixelRatio: number;
  userAgent: string;
};

export type PageContextKind = "top" | "iframe" | "micro-app" | "wujie";

export type PageContext = {
  kind: PageContextKind;
  url: string;
  title: string;
  topUrl?: string;
  topTitle?: string;
  frameId?: number;
  parentFrameId?: number;
  hostSelector?: string;
  hostUrl?: string;
};

export type AnnotationScreenshot = {
  dataUrl: string;
  capturedAt: string;
  visibleRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

export type DomAnnotation = {
  id: string;
  url: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  selector: string;
  xpath?: string;
  context?: PageContext;
  element: ElementSummary;
  rect: ElementRect;
  pin?: AnnotationPinAnchor;
  viewport: ViewportSnapshot;
  computedStyles: Record<string, string>;
  screenshot?: AnnotationScreenshot;
  screenshotAfter?: AnnotationScreenshot;
  fixRequested?: boolean;
  feedback: {
    comment: string;
    expected?: string;
    type: FeedbackType;
    severity: FeedbackSeverity;
  };
  status: AnnotationStatus | LegacyAnnotationStatus;
};

export type AnnotationDraft = Omit<
  DomAnnotation,
  "id" | "createdAt" | "updatedAt" | "feedback" | "status"
>;

export type MonitorEventKind = "console" | "network" | "error";
export type MonitorSeverity = "log" | "info" | "warn" | "error";

export type MonitorEvent = {
  id: string;
  kind: MonitorEventKind;
  severity: MonitorSeverity;
  timestamp: string;
  pageUrl: string;
  title: string;
  message: string;
  details?: string;
  stack?: string;
  source?: string;
  line?: number;
  column?: number;
  method?: string;
  requestType?: "fetch" | "xhr" | "beacon" | "resource" | "websocket";
  requestHeaders?: Record<string, string>;
  requestBody?: string;
  status?: number;
  statusText?: string;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  responseType?: string;
  durationMs?: number;
  ok?: boolean;
};

export type MonitorSnapshot = {
  events: MonitorEvent[];
  enabled: boolean;
};

export type ContentMessage =
  | { type: "DOM_AI_START_PICKING" }
  | { type: "DOM_AI_STOP_PICKING" }
  | { type: "DOM_AI_START_MEASURING" }
  | { type: "DOM_AI_STOP_MEASURING" }
  | { type: "DOM_AI_FOCUS_ANNOTATION"; id: string }
  | { type: "DOM_AI_EDIT_ANNOTATION"; id: string }
  | { type: "DOM_AI_REFRESH_PINS" }
  | { type: "DOM_AI_MONITOR_ENABLE" }
  | { type: "DOM_AI_MONITOR_CLEAR" }
  | { type: "DOM_AI_SHOW_IMAGE_PREVIEW"; dataUrl: string }
  | { type: "DOM_AI_CLOSE_IMAGE_PREVIEW" }
  | { type: "DOM_AI_FRAME_HOVER_ACTIVE"; frameId?: number };

export type RuntimeMessage =
  | ContentMessage
  | { type: "DOM_AI_DRAFT_READY"; draft: AnnotationDraft }
  | { type: "DOM_AI_PAGE_CONTEXT_SELECTED"; context: PageContext }
  | { type: "DOM_AI_ANNOTATION_SAVED"; annotation: DomAnnotation }
  | { type: "DOM_AI_BROADCAST_CONTENT_MESSAGE"; message: ContentMessage }
  | { type: "DOM_AI_OPEN_SIDE_PANEL" }
  | { type: "DOM_AI_GET_FRAME_CONTEXT" }
  | { type: "DOM_AI_MONITOR_EVENT"; event: MonitorEvent }
  | { type: "DOM_AI_RECORD_DEBUG_EVENT"; event: MonitorEvent }
  | { type: "DOM_AI_SET_DEBUG_EVENTS"; tabId: number; kind: MonitorEventKind; events: MonitorEvent[] }
  | { type: "DOM_AI_GET_DEBUG_EVENTS"; tabId?: number }
  | { type: "DOM_AI_CLEAR_DEBUG_EVENTS"; tabId: number; kind?: MonitorEventKind }
  | { type: "DOM_AI_DEBUG_EVENTS_CHANGED" }
  | { type: "DOM_AI_GET_DEBUG_STORAGE_CONTEXT" }
  | { type: "DOM_AI_PANEL_HEARTBEAT"; tabId: number }
  | { type: "DOM_AI_PANEL_CLOSED"; tabId: number }
  | { type: "DOM_AI_GET_PANEL_STATE"; tabId?: number }
  | { type: "DOM_AI_CAPTURE_SCREENSHOT"; rect?: { x: number; y: number; width: number; height: number } };
