import type { AnnotationReference, DomAnnotation } from "./types";
import { normalizeStatus } from "./storage";
import { severityLabels, statusLabels } from "./status";
import {
  formatAnnotationFeedbackForMarkdown,
  formatStyleChangesForMarkdown,
  parseStyleChanges,
  stripGeneratedStyleComment
} from "./styleChanges";

export function exportAnnotationsAsJson(annotations: DomAnnotation[]): string {
  return JSON.stringify(stripScreenshots(annotations), null, 2);
}

export function exportAnnotationsAsMarkdown(
  annotations: DomAnnotation[],
  options: { includeImportPayload?: boolean } = {}
): string {
  const visible = stripScreenshots(annotations).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return [
    "# 给 AI 实现的 UI 反馈",
    "",
    "请修复下面的 UI 反馈。请结合 selector、DOM 上下文、元素位置和视觉说明定位相关组件。修改完成后，总结哪些标注已解决，并说明无法安全修改的内容。",
    "",
    ...visible.flatMap((item, index) => [
      `## ${index + 1}. ${formatAnnotationHeading(item)}`,
      "",
      `- 状态: ${statusLabels[normalizeStatus(item.status)]}`,
      `- URL: ${item.url}`,
      `- 页面标题: ${item.title || "未命名页面"}`,
      item.context ? `- 页面上下文: ${formatPageContext(item)}` : undefined,
      `- Selector: \`${item.selector}\``,
      item.xpath ? `- XPath: \`${item.xpath}\`` : undefined,
      `- 元素: \`${describeElement(item)}\``,
      `- 位置: x=${Math.round(item.rect.x)}, y=${Math.round(item.rect.y)}, width=${Math.round(item.rect.width)}, height=${Math.round(item.rect.height)}`,
      `- 视口: ${item.viewport.width}x${item.viewport.height} @ ${item.viewport.devicePixelRatio}x`,
      `- 优先级: ${severityLabels[item.feedback.severity]}`,
      `- 关键样式: ${formatKeyStyles(item)}`,
      item.styleChanges?.length ? `- 样式变更: ${formatStyleChanges(item.styleChanges)}` : undefined,
      item.references?.length ? `- 引用对象: ${item.references.map((reference) => reference.label).join(", ")}` : undefined,
      "",
      "**反馈**",
      "",
      formatAnnotationFeedbackForMarkdown(item),
      "",
      item.references?.length ? "**涉及对象**" : undefined,
      item.references?.length ? "" : undefined,
      item.references?.length ? formatReferencedObjects(item) : undefined,
      item.references?.length ? "" : undefined,
      item.feedback.expected ? "**期望效果**" : undefined,
      item.feedback.expected ? "" : undefined,
      item.feedback.expected,
      ""
    ].filter(Boolean) as string[]),
    ...(options.includeImportPayload ? [
      "",
      "<!-- DOM_AI_ANNOTATIONS_START",
      encodeAnnotationsPayload(visible),
      "DOM_AI_ANNOTATIONS_END -->"
    ] : [])
  ].join("\n");
}

export function importAnnotationsFromMarkdown(markdown: string): DomAnnotation[] {
  const match = markdown.match(/<!--\s*DOM_AI_ANNOTATIONS_START\s*([\s\S]*?)\s*DOM_AI_ANNOTATIONS_END\s*-->/);
  if (match) {
    try {
      const decoded = decodeURIComponent(escape(atob(match[1].trim())));
      const parsed = JSON.parse(decoded);
      if (Array.isArray(parsed)) return parsed.filter(isDomAnnotation);
    } catch {
      return [];
    }
  }

  return importAnnotationsFromReadableMarkdown(markdown);
}

function importAnnotationsFromReadableMarkdown(markdown: string): DomAnnotation[] {
  const annotations: DomAnnotation[] = [];
  const headings = Array.from(markdown.matchAll(/^##\s+\d+\.\s+(.+?)\s*$/gm));

  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const title = heading[1];
    const bodyStart = heading.index + heading[0].length;
    const bodyEnd = headings[index + 1]?.index ?? markdown.length;
    const body = markdown.slice(bodyStart, bodyEnd);
    const url = getMarkdownBullet(body, "URL");
    const selector = getMarkdownCodeBullet(body, "Selector");
    const rect = parseMarkdownRect(getMarkdownBullet(body, "位置"));
    const viewport = parseMarkdownViewport(getMarkdownBullet(body, "视口"));
    const styleChanges = parseStyleChanges(getMarkdownBullet(body, "样式变更"));
    const feedbackBlock = getMarkdownBlock(body, "反馈") || title.trim();
    const comment = stripGeneratedStyleComment(feedbackBlock, styleChanges);

    if (!url || !selector || !rect || !viewport || (!comment.trim() && !styleChanges.length)) continue;

    const now = new Date().toISOString();
    const xpath = getMarkdownCodeBullet(body, "XPath");
    const element = parseMarkdownElement(getMarkdownCodeBullet(body, "元素"));
    const severity = parseSeverityLabel(getMarkdownBullet(body, "优先级"));
    const status = parseStatusLabel(getMarkdownBullet(body, "状态"));
    const computedStyles = parseKeyStyles(getMarkdownBullet(body, "关键样式"));
    const expected = getMarkdownBlock(body, "期望效果");
    const references = parseReferencedObjects(getMarkdownBlock(body, "涉及对象"), getMarkdownBullet(body, "页面标题") || "未命名页面");

    annotations.push({
      id: createReadableMarkdownAnnotationId(url, selector, comment || formatStyleChangesForMarkdown(styleChanges), annotations.length),
      url,
      title: getMarkdownBullet(body, "页面标题") || "未命名页面",
      createdAt: now,
      updatedAt: now,
      selector,
      xpath,
      element,
      rect,
      viewport,
      computedStyles,
      feedback: {
        comment: comment.trim(),
        expected: expected?.trim() || undefined,
        type: "bug",
        severity
      },
      styleChanges: styleChanges.length ? styleChanges : undefined,
      references: references.length ? references : undefined,
      status
    });
  }

  return annotations;
}

function stripScreenshots(annotations: DomAnnotation[]): DomAnnotation[] {
  return annotations.map((annotation) => ({
    ...annotation,
    screenshot: undefined,
    screenshotAfter: undefined
  }));
}

function formatAnnotationHeading(annotation: DomAnnotation): string {
  const target = describeElement(annotation);
  const referenceCount = annotation.references?.length ?? 0;
  if (referenceCount) return `组合反馈 · ${target} · 引用 ${referenceCount} 个对象`;
  return target || "未命名反馈";
}

function encodeAnnotationsPayload(annotations: DomAnnotation[]): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(annotations))));
}

function getMarkdownBullet(markdown: string, label: string): string | undefined {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(new RegExp(`^- ${escapedLabel}: (.*)$`, "m"));
  return match?.[1]?.trim();
}

function getMarkdownCodeBullet(markdown: string, label: string): string | undefined {
  const value = getMarkdownBullet(markdown, label);
  return value?.match(/^`([\s\S]*)`$/)?.[1] ?? value;
}

function getMarkdownBlock(markdown: string, label: string): string | undefined {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(new RegExp(`\\*\\*${escapedLabel}\\*\\*\\s*\\n\\s*([\\s\\S]*?)(?=\\n##\\s+\\d+\\.|\\n\\*\\*[^\\n]+\\*\\*|\\s*$)`));
  return match?.[1]?.trim();
}

function parseMarkdownRect(value?: string): DomAnnotation["rect"] | undefined {
  const match = value?.match(/x=(-?\d+(?:\.\d+)?),\s*y=(-?\d+(?:\.\d+)?),\s*width=(-?\d+(?:\.\d+)?),\s*height=(-?\d+(?:\.\d+)?)/);
  if (!match) return undefined;
  const [, x, y, width, height] = match;
  return {
    x: Number(x),
    y: Number(y),
    width: Number(width),
    height: Number(height),
    scrollX: 0,
    scrollY: 0
  };
}

function parseMarkdownViewport(value?: string): DomAnnotation["viewport"] | undefined {
  const match = value?.match(/(\d+)x(\d+)\s*@\s*(\d+(?:\.\d+)?)x/);
  if (!match) return undefined;
  const [, width, height, devicePixelRatio] = match;
  return {
    width: Number(width),
    height: Number(height),
    devicePixelRatio: Number(devicePixelRatio),
    userAgent: ""
  };
}

function parseMarkdownElement(value?: string): DomAnnotation["element"] {
  if (!value) return { tag: "element" };

  const labelMatch = value.match(/\s\(([\s\S]*)\)$/);
  const withoutLabel = labelMatch ? value.slice(0, labelMatch.index).trim() : value.trim();
  const tag = withoutLabel.match(/^[^.#\s(]+/)?.[0] || "element";
  const id = withoutLabel.match(/#([^.#\s(]+)/)?.[1];
  const classes = Array.from(withoutLabel.matchAll(/\.([^.#\s(]+)/g), (match) => match[1]);

  return {
    tag,
    id,
    className: classes.length ? classes.join(" ") : undefined,
    text: labelMatch?.[1]
  };
}

function parseSeverityLabel(value?: string): DomAnnotation["feedback"]["severity"] {
  const entry = Object.entries(severityLabels).find(([, label]) => label === value);
  return (entry?.[0] as DomAnnotation["feedback"]["severity"] | undefined) ?? "important";
}

function parseStatusLabel(value?: string): DomAnnotation["status"] {
  const entry = Object.entries(statusLabels).find(([, label]) => label === value);
  return (entry?.[0] as DomAnnotation["status"] | undefined) ?? "pending";
}

function parseKeyStyles(value?: string): Record<string, string> {
  if (!value || value === "无关键样式快照") return {};

  return value.split(";").reduce<Record<string, string>>((styles, entry) => {
    const [key, ...rest] = entry.split("=");
    const name = normalizeExportedStyleName(key?.trim());
    const styleValue = rest.join("=").trim();
    if (name && styleValue) styles[name] = styleValue;
    return styles;
  }, {});
}

function parseReferencedObjects(markdown: string | undefined, fallbackTitle: string): AnnotationReference[] {
  if (!markdown) return [];

  const references: AnnotationReference[] = [];
  const headings = Array.from(markdown.matchAll(/^###\s+(.+?)\s*$/gm));

  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const headingText = heading[1].trim();
    const label = headingText.match(/^(对象\s+\d+)/)?.[1];
    if (!label || label === "对象 1") continue;

    const bodyStart = heading.index + heading[0].length;
    const bodyEnd = headings[index + 1]?.index ?? markdown.length;
    const body = markdown.slice(bodyStart, bodyEnd);
    const url = getMarkdownBullet(body, "URL");
    const selector = getMarkdownCodeBullet(body, "Selector");
    const rect = parseMarkdownRect(getMarkdownBullet(body, "位置"));
    const viewport = parseMarkdownViewport(getMarkdownBullet(body, "视口"));

    if (!url || !selector || !rect || !viewport) continue;

    references.push({
      id: createReadableMarkdownAnnotationId(url, selector, label, references.length),
      label,
      role: "reference",
      url,
      title: fallbackTitle,
      selector,
      xpath: getMarkdownCodeBullet(body, "XPath"),
      element: parseMarkdownElement(getMarkdownCodeBullet(body, "元素")),
      rect,
      viewport,
      computedStyles: parseKeyStyles(getMarkdownBullet(body, "关键样式"))
    });
  }

  return references;
}

function normalizeExportedStyleName(name?: string): string | undefined {
  const styleNames: Record<string, string> = {
    "font-size": "fontSize",
    "line-height": "lineHeight",
    "font-weight": "fontWeight",
    background: "backgroundColor",
    "border-radius": "borderRadius",
    "z-index": "zIndex"
  };

  return name ? (styleNames[name] ?? name) : undefined;
}

function createReadableMarkdownAnnotationId(url: string, selector: string, comment: string, index: number): string {
  const input = `${url}\n${selector}\n${comment}\n${index}`;
  let hash = 0;

  for (let i = 0; i < input.length; i += 1) {
    hash = Math.imul(31, hash) + input.charCodeAt(i) | 0;
  }

  return `md-${Math.abs(hash).toString(36)}-${index + 1}`;
}

function isDomAnnotation(value: unknown): value is DomAnnotation {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<DomAnnotation>;
  return (
    typeof item.id === "string" &&
    typeof item.url === "string" &&
    typeof item.selector === "string" &&
    typeof item.createdAt === "string" &&
    typeof item.updatedAt === "string" &&
    Boolean(item.rect) &&
    Boolean(item.viewport) &&
    Boolean(item.element) &&
    Boolean(item.feedback)
  );
}

function describeElement(annotation: DomAnnotation): string {
  const { element } = annotation;
  const id = element.id ? `#${element.id}` : "";
  const classes = element.className ? `.${element.className.trim().split(/\s+/).slice(0, 4).join(".")}` : "";
  const label = element.ariaLabel || element.role || element.text;
  return `${element.tag}${id}${classes}${label ? ` (${label.slice(0, 80)})` : ""}`;
}

function formatPageContext(annotation: DomAnnotation): string {
  const context = annotation.context;
  if (!context) return "top";

  const parts: string[] = [context.kind];
  if (context.topUrl && context.topUrl !== annotation.url) parts.push(`top=${context.topUrl}`);
  if (context.hostUrl && context.hostUrl !== annotation.url) parts.push(`host=${context.hostUrl}`);
  if (context.frameId !== undefined) parts.push(`frameId=${context.frameId}`);
  return parts.join("; ");
}

function formatKeyStyles(annotation: DomAnnotation): string {
  const styles = annotation.computedStyles;
  const entries = [
    ["display", styles.display],
    ["position", styles.position],
    ["font-size", styles.fontSize],
    ["line-height", styles.lineHeight],
    ["font-weight", styles.fontWeight],
    ["color", styles.color],
    ["background", styles.backgroundColor],
    ["margin", styles.margin],
    ["padding", styles.padding],
    ["gap", styles.gap],
    ["border-radius", styles.borderRadius],
    ["border-color", styles.borderColor],
    ["border-width", styles.borderWidth],
    ["width", styles.width],
    ["height", styles.height],
    ["opacity", styles.opacity],
    ["z-index", styles.zIndex]
  ].filter(([, value]) => value && value !== "normal" && value !== "none" && value !== "auto");

  return entries.map(([key, value]) => `${key}=${value}`).join("; ") || "无关键样式快照";
}

function formatReferencedObjects(annotation: DomAnnotation): string {
  return [
    formatObjectDetails("对象 1（修改目标）", annotation),
    ...(annotation.references ?? []).map((reference) => formatObjectDetails(`${reference.label}（参考对象）`, reference))
  ].join("\n\n");
}

function formatObjectDetails(
  title: string,
  item: Pick<DomAnnotation, "selector" | "xpath" | "element" | "rect" | "viewport" | "computedStyles" | "url">
): string {
  return [
    `### ${title}`,
    "",
    `- URL: ${item.url}`,
    `- Selector: \`${item.selector}\``,
    item.xpath ? `- XPath: \`${item.xpath}\`` : undefined,
    `- 元素: \`${describeElementLike(item.element)}\``,
    `- 位置: x=${Math.round(item.rect.x)}, y=${Math.round(item.rect.y)}, width=${Math.round(item.rect.width)}, height=${Math.round(item.rect.height)}`,
    `- 视口: ${item.viewport.width}x${item.viewport.height} @ ${item.viewport.devicePixelRatio}x`,
    `- 关键样式: ${formatStyleSnapshot(item.computedStyles)}`
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function describeElementLike(element: DomAnnotation["element"]): string {
  const id = element.id ? `#${element.id}` : "";
  const classes = element.className ? `.${element.className.trim().split(/\s+/).slice(0, 4).join(".")}` : "";
  const label = element.ariaLabel || element.role || element.text;
  return `${element.tag}${id}${classes}${label ? ` (${label.slice(0, 80)})` : ""}`;
}

function formatStyleSnapshot(styles: Record<string, string>): string {
  const entries = [
    ["display", styles.display],
    ["position", styles.position],
    ["font-size", styles.fontSize],
    ["line-height", styles.lineHeight],
    ["font-weight", styles.fontWeight],
    ["color", styles.color],
    ["background", styles.backgroundColor],
    ["margin", styles.margin],
    ["padding", styles.padding],
    ["gap", styles.gap],
    ["border-radius", styles.borderRadius],
    ["border-color", styles.borderColor],
    ["border-width", styles.borderWidth],
    ["width", styles.width],
    ["height", styles.height],
    ["opacity", styles.opacity],
    ["z-index", styles.zIndex]
  ].filter(([, value]) => value && value !== "normal" && value !== "none" && value !== "auto");

  return entries.map(([key, value]) => `${key}=${value}`).join("; ") || "无关键样式快照";
}

function formatStyleChanges(changes: NonNullable<DomAnnotation["styleChanges"]>): string {
  return formatStyleChangesForMarkdown(changes);
}
