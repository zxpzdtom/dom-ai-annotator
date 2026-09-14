import {
  deleteAnnotation,
  getAnnotations,
  normalizeStatus,
  saveAnnotation,
  updateAnnotationStatus
} from "../shared/storage";
import type {
  AnnotationScreenshot,
  AnnotationScreenshotVariant,
  AnnotationStatus,
  DomAnnotation,
  FeedbackSeverity,
  FeedbackType
} from "../shared/types";

type JsonSchema = Record<string, unknown>;

type WebMcpTool = {
  name: string;
  title?: string;
  description: string;
  inputSchema: JsonSchema;
  execute: (input: Record<string, unknown>) => unknown | Promise<unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    untrustedContentHint?: boolean;
    consequentialHint?: boolean;
  };
};

type WebMcpModelContext = {
  registerTool: (tool: WebMcpTool, options?: { signal?: AbortSignal }) => void | Promise<void>;
};

type WebMcpDocument = Document & {
  modelContext?: WebMcpModelContext;
};

const annotationStatuses: AnnotationStatus[] = ["pending", "sent", "changed", "needs_work", "passed", "skipped"];
const feedbackSeverities: FeedbackSeverity[] = ["blocking", "important", "suggestion"];
const feedbackTypes: FeedbackType[] = ["bug", "style", "copy", "layout", "interaction", "question"];
const screenshotVariants: AnnotationScreenshotVariant[] = ["before", "after"];

export function installDomReviewWebMcp(): void {
  if (window.top !== window) return;

  const modelContext = (document as WebMcpDocument).modelContext;
  if (!modelContext?.registerTool) return;

  void registerDomReviewTools(modelContext, location.href);
}

async function registerDomReviewTools(modelContext: WebMcpModelContext, currentPageUrl: string) {
  for (const tool of createDomReviewTools(currentPageUrl)) {
    try {
      await modelContext.registerTool(tool);
    } catch (error) {
      console.debug(`[DOM Review] Unable to register WebMCP tool ${tool.name}.`, error);
    }
  }
}

function createDomReviewTools(currentPageUrl: string): WebMcpTool[] {
  return [
    {
      name: "dom_review_list_annotations",
      title: "List DOM Review annotations",
      description: "List DOM Review UI feedback for the current page. Use all_pages only when the user explicitly asks for annotations from other pages.",
      inputSchema: {
        type: "object",
        properties: {
          all_pages: { type: "boolean", description: "Return annotations from every saved page instead of only the current page." },
          url: { type: "string", description: "Filter by an exact page, top-page, or host URL." },
          status: { type: "string", enum: annotationStatuses },
          search: { type: "string", description: "Search comments, expected results, titles, URLs, and selectors." },
          limit: { type: "integer", minimum: 1, maximum: 500, default: 100 }
        },
        additionalProperties: false
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: (params) => listAnnotations(params, currentPageUrl)
    },
    {
      name: "dom_review_get_annotation",
      title: "Get a DOM Review annotation",
      description: "Get one DOM Review annotation by its stable ID, including its selector, XPath, element details, feedback, status, and captured styles.",
      inputSchema: objectSchema({ id: nonEmptyStringSchema("Stable DOM Review annotation ID.") }, ["id"]),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: (params) => getAnnotation(params)
    },
    {
      name: "dom_review_get_annotation_snapshot",
      title: "Get a DOM Review annotation snapshot",
      description: "Get snapshot metadata for one DOM Review annotation. Set include_data_url only when raw image data is explicitly needed; otherwise prefer dom_review_show_annotation_snapshot for visual inspection without a large Base64 result.",
      inputSchema: objectSchema({
        id: nonEmptyStringSchema("Stable DOM Review annotation ID."),
        variant: { type: "string", enum: screenshotVariants, default: "before", description: "Use before for the original snapshot or after for the verification snapshot." },
        include_data_url: { type: "boolean", default: false, description: "Include the image as a Base64 data URL. This can make the tool result large." }
      }, ["id"]),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: (params) => getAnnotationSnapshot(params)
    },
    {
      name: "dom_review_update_annotation",
      title: "Update a DOM Review annotation",
      description: "Edit a DOM Review annotation's feedback, title, severity, type, or status. Omitted fields are left unchanged.",
      inputSchema: objectSchema({
        id: nonEmptyStringSchema("Stable DOM Review annotation ID."),
        title: { type: "string" },
        comment: { type: "string" },
        expected: { type: ["string", "null"], description: "Set null to clear the expected result." },
        severity: { type: "string", enum: feedbackSeverities },
        feedback_type: { type: "string", enum: feedbackTypes },
        status: { type: "string", enum: annotationStatuses }
      }, ["id"]),
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: (params) => updateAnnotation(params)
    },
    {
      name: "dom_review_set_annotation_status",
      title: "Set a DOM Review annotation status",
      description: "Move a DOM Review annotation to any supported workflow status: pending, sent, changed, needs_work, passed, or skipped.",
      inputSchema: objectSchema({
        id: nonEmptyStringSchema("Stable DOM Review annotation ID."),
        status: { type: "string", enum: annotationStatuses }
      }, ["id", "status"]),
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: (params) => setAnnotationStatus(params)
    },
    {
      name: "dom_review_delete_annotation",
      title: "Delete a DOM Review annotation",
      description: "Delete one DOM Review annotation by its stable ID.",
      inputSchema: objectSchema({ id: nonEmptyStringSchema("Stable DOM Review annotation ID.") }, ["id"]),
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: (params) => removeAnnotation(params)
    },
    {
      name: "dom_review_focus_annotation",
      title: "Focus a DOM Review annotation",
      description: "Scroll to and highlight a DOM Review annotation on the currently open page.",
      inputSchema: objectSchema({ id: nonEmptyStringSchema("Stable DOM Review annotation ID.") }, ["id"]),
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: (params) => focusAnnotation(params)
    },
    {
      name: "dom_review_show_annotation_snapshot",
      title: "Show a DOM Review annotation snapshot",
      description: "Display an annotation snapshot in the current page for visual inspection. This avoids returning Base64 image data in the tool result.",
      inputSchema: objectSchema({
        id: nonEmptyStringSchema("Stable DOM Review annotation ID."),
        variant: { type: "string", enum: screenshotVariants, default: "before", description: "Use before for the original snapshot or after for the verification snapshot." }
      }, ["id"]),
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: (params) => showAnnotationSnapshot(params)
    },
    {
      name: "dom_review_hide_annotation_snapshot",
      title: "Hide the DOM Review annotation snapshot",
      description: "Close the annotation snapshot currently displayed on the page after visual inspection.",
      inputSchema: objectSchema({}),
      annotations: { readOnlyHint: false },
      execute: () => hideAnnotationSnapshot()
    }
  ];
}

async function listAnnotations(params: Record<string, unknown>, currentPageUrl: string) {
  const annotations = await getAnnotations();
  const requestedUrl = optionalString(params.url, "url");
  const url = requestedUrl ?? (params.all_pages === true ? undefined : currentPageUrl);
  const status = optionalAnnotationStatus(params.status);
  const search = optionalString(params.search, "search")?.trim().toLocaleLowerCase();
  const limit = optionalLimit(params.limit);

  const matching = annotations
    .filter((annotation) => !url || annotationMatchesUrl(annotation, url))
    .filter((annotation) => !status || normalizeStatus(annotation.status) === status)
    .filter((annotation) => {
      if (!search) return true;
      return [annotation.feedback.comment, annotation.feedback.expected, annotation.title, annotation.url, annotation.selector]
        .some((value) => value?.toLocaleLowerCase().includes(search));
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return {
    page_url: url,
    annotations: matching.slice(0, limit).map(serializeAnnotation),
    count: Math.min(matching.length, limit),
    total: matching.length
  };
}

async function getAnnotation(params: Record<string, unknown>) {
  const annotation = await requireAnnotation(requiredString(params.id, "id"));
  return { annotation: serializeAnnotation(annotation) };
}

async function getAnnotationSnapshot(params: Record<string, unknown>) {
  const id = requiredString(params.id, "id");
  const annotation = await requireAnnotation(id);
  const variant = optionalScreenshotVariant(params.variant);
  const screenshot = getSnapshot(annotation, variant);
  const includeDataUrl = optionalBoolean(params.include_data_url, "include_data_url") ?? false;

  return {
    annotation_id: id,
    variant,
    ...serializeScreenshot(screenshot),
    ...(includeDataUrl ? { data_url: screenshot.dataUrl } : {})
  };
}

async function updateAnnotation(params: Record<string, unknown>) {
  const annotation = await requireAnnotation(requiredString(params.id, "id"));
  const comment = optionalString(params.comment, "comment");
  const expected = optionalNullableString(params, "expected");
  const severity = optionalFeedbackSeverity(params.severity);
  const feedbackType = optionalFeedbackType(params.feedback_type);
  const title = optionalString(params.title, "title");
  const status = optionalAnnotationStatus(params.status);

  const next: DomAnnotation = {
    ...annotation,
    title: title ?? annotation.title,
    updatedAt: new Date().toISOString(),
    feedback: {
      ...annotation.feedback,
      comment: comment ?? annotation.feedback.comment,
      expected: expected.provided ? expected.value ?? undefined : annotation.feedback.expected,
      severity: severity ?? annotation.feedback.severity,
      type: feedbackType ?? annotation.feedback.type
    },
    status: status ?? annotation.status
  };
  await saveAnnotation(next);
  return { annotation: serializeAnnotation(next) };
}

async function setAnnotationStatus(params: Record<string, unknown>) {
  const id = requiredString(params.id, "id");
  await requireAnnotation(id);
  const status = requiredAnnotationStatus(params.status);
  await updateAnnotationStatus(id, status);
  return { annotation: serializeAnnotation(await requireAnnotation(id)) };
}

async function removeAnnotation(params: Record<string, unknown>) {
  const id = requiredString(params.id, "id");
  const annotation = await requireAnnotation(id);
  await deleteAnnotation(id);
  return { deleted: true, id, title: annotation.title };
}

async function focusAnnotation(params: Record<string, unknown>) {
  const id = requiredString(params.id, "id");
  await requireAnnotation(id);
  const response = await chrome.runtime.sendMessage({
    type: "DOM_AI_WEBMCP_FOCUS_ANNOTATION",
    id
  }) as { focused?: boolean; error?: string } | undefined;
  if (!response?.focused) throw new Error(response?.error || "Unable to focus the DOM Review annotation.");
  return response;
}

async function showAnnotationSnapshot(params: Record<string, unknown>) {
  const id = requiredString(params.id, "id");
  const annotation = await requireAnnotation(id);
  const variant = optionalScreenshotVariant(params.variant);
  getSnapshot(annotation, variant);

  const response = await chrome.runtime.sendMessage({
    type: "DOM_AI_WEBMCP_SHOW_ANNOTATION_SNAPSHOT",
    id,
    variant
  }) as { shown?: boolean; error?: string; captured_at?: string; visible_rect?: AnnotationScreenshot["visibleRect"] } | undefined;
  if (!response?.shown) throw new Error(response?.error || "Unable to show the DOM Review annotation snapshot.");
  return response;
}

function hideAnnotationSnapshot() {
  const preview = document.getElementById("dom-ai-img-preview");
  preview?.remove();
  return { hidden: Boolean(preview) };
}

async function requireAnnotation(id: string): Promise<DomAnnotation> {
  const annotation = (await getAnnotations()).find((item) => item.id === id);
  if (!annotation) throw new Error(`DOM Review annotation not found: ${id}`);
  return annotation;
}

function serializeAnnotation(annotation: DomAnnotation): Omit<DomAnnotation, "screenshot" | "screenshotAfter"> {
  const { screenshot: _screenshot, screenshotAfter: _screenshotAfter, ...metadata } = annotation;
  return metadata;
}

function getSnapshot(annotation: DomAnnotation, variant: AnnotationScreenshotVariant): AnnotationScreenshot {
  const screenshot = variant === "after" ? annotation.screenshotAfter : annotation.screenshot;
  if (!screenshot) throw new Error(`This annotation does not have a ${variant} snapshot.`);
  return screenshot;
}

function serializeScreenshot(screenshot: AnnotationScreenshot) {
  return {
    mime_type: dataUrlMimeType(screenshot.dataUrl),
    captured_at: screenshot.capturedAt,
    visible_rect: screenshot.visibleRect,
    byte_size: dataUrlByteLength(screenshot.dataUrl),
    data_url_characters: screenshot.dataUrl.length
  };
}

function dataUrlMimeType(dataUrl: string): string {
  return /^data:([^;,]+)/i.exec(dataUrl)?.[1] || "application/octet-stream";
}

function dataUrlByteLength(dataUrl: string): number {
  const separator = dataUrl.indexOf(",");
  if (separator < 0) return new TextEncoder().encode(dataUrl).length;

  const metadata = dataUrl.slice(0, separator);
  const payload = dataUrl.slice(separator + 1);
  if (!/;base64(?:;|$)/i.test(metadata)) {
    try {
      return new TextEncoder().encode(decodeURIComponent(payload)).length;
    } catch {
      return new TextEncoder().encode(payload).length;
    }
  }

  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor(payload.length * 3 / 4) - padding);
}

function annotationMatchesUrl(annotation: DomAnnotation, url: string): boolean {
  return annotation.url === url || annotation.context?.topUrl === url || annotation.context?.hostUrl === url;
}

function objectSchema(properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema {
  return { type: "object", properties, required, additionalProperties: false };
}

function nonEmptyStringSchema(description: string): JsonSchema {
  return { type: "string", minLength: 1, description };
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string.`);
  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${field} must be a string.`);
  return value;
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`${field} must be a boolean.`);
  return value;
}

function optionalScreenshotVariant(value: unknown): AnnotationScreenshotVariant {
  if (value === undefined) return "before";
  if (typeof value !== "string" || !screenshotVariants.includes(value as AnnotationScreenshotVariant)) {
    throw new Error(`variant must be one of: ${screenshotVariants.join(", ")}.`);
  }
  return value as AnnotationScreenshotVariant;
}

function optionalNullableString(params: Record<string, unknown>, field: string): { provided: boolean; value?: string | null } {
  if (!(field in params)) return { provided: false };
  const value = params[field];
  if (value !== null && typeof value !== "string") throw new Error(`${field} must be a string or null.`);
  return { provided: true, value };
}

function optionalLimit(value: unknown): number {
  if (value === undefined) return 100;
  if (typeof value !== "number" || !Number.isInteger(value)) throw new Error("limit must be an integer.");
  return Math.max(1, Math.min(500, value));
}

function requiredAnnotationStatus(value: unknown): AnnotationStatus {
  const status = optionalAnnotationStatus(value);
  if (!status) throw new Error(`status must be one of: ${annotationStatuses.join(", ")}.`);
  return status;
}

function optionalAnnotationStatus(value: unknown): AnnotationStatus | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !annotationStatuses.includes(value as AnnotationStatus)) {
    throw new Error(`status must be one of: ${annotationStatuses.join(", ")}.`);
  }
  return value as AnnotationStatus;
}

function optionalFeedbackSeverity(value: unknown): FeedbackSeverity | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !feedbackSeverities.includes(value as FeedbackSeverity)) {
    throw new Error(`severity must be one of: ${feedbackSeverities.join(", ")}.`);
  }
  return value as FeedbackSeverity;
}

function optionalFeedbackType(value: unknown): FeedbackType | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !feedbackTypes.includes(value as FeedbackType)) {
    throw new Error(`feedback_type must be one of: ${feedbackTypes.join(", ")}.`);
  }
  return value as FeedbackType;
}
