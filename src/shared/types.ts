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

export type ContentMessage =
  | { type: "DOM_AI_START_PICKING" }
  | { type: "DOM_AI_STOP_PICKING" }
  | { type: "DOM_AI_START_MEASURING" }
  | { type: "DOM_AI_STOP_MEASURING" }
  | { type: "DOM_AI_FOCUS_ANNOTATION"; id: string }
  | { type: "DOM_AI_EDIT_ANNOTATION"; id: string }
  | { type: "DOM_AI_REFRESH_PINS" };

export type RuntimeMessage =
  | ContentMessage
  | { type: "DOM_AI_DRAFT_READY"; draft: AnnotationDraft }
  | { type: "DOM_AI_OPEN_SIDE_PANEL" };
