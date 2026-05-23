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
  | { type: "DOM_AI_CLOSE_IMAGE_PREVIEW" };

export type RuntimeMessage =
  | ContentMessage
  | { type: "DOM_AI_DRAFT_READY"; draft: AnnotationDraft }
  | { type: "DOM_AI_OPEN_SIDE_PANEL" }
  | { type: "DOM_AI_MONITOR_EVENT"; event: MonitorEvent }
  | { type: "DOM_AI_CAPTURE_SCREENSHOT"; rect?: { x: number; y: number; width: number; height: number } };
