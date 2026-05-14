import type { DomAnnotation } from "./types";
import { normalizeStatus } from "./storage";
import { severityLabels, statusLabels } from "./status";

export function exportAnnotationsAsJson(annotations: DomAnnotation[]): string {
  return JSON.stringify(stripScreenshots(annotations), null, 2);
}

export function exportAnnotationsAsMarkdown(annotations: DomAnnotation[]): string {
  const visible = [...annotations].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const portablePayload = encodePortableAnnotations(visible);

  return [
    "# 给 AI 实现的 UI 反馈",
    "",
    "请修复下面的 UI 反馈。请结合 selector、DOM 上下文、元素位置和视觉说明定位相关组件。修改完成后，总结哪些标注已解决，并说明无法安全修改的内容。",
    "",
    ...visible.flatMap((item, index) => [
      `## ${index + 1}. ${item.feedback.comment.split("\n")[0] || "未命名反馈"}`,
      "",
      `- 状态: ${statusLabels[normalizeStatus(item.status)]}`,
      `- URL: ${item.url}`,
      `- 页面标题: ${item.title || "未命名页面"}`,
      `- Selector: \`${item.selector}\``,
      item.xpath ? `- XPath: \`${item.xpath}\`` : undefined,
      `- 元素: \`${describeElement(item)}\``,
      `- 位置: x=${Math.round(item.rect.x)}, y=${Math.round(item.rect.y)}, width=${Math.round(item.rect.width)}, height=${Math.round(item.rect.height)}`,
      `- 视口: ${item.viewport.width}x${item.viewport.height} @ ${item.viewport.devicePixelRatio}x`,
      `- 优先级: ${severityLabels[item.feedback.severity]}`,
      `- 关键样式: ${formatKeyStyles(item)}`,
      "",
      "**反馈**",
      "",
      item.feedback.comment,
      "",
      item.feedback.expected ? "**期望效果**" : undefined,
      item.feedback.expected ? "" : undefined,
      item.feedback.expected,
      ""
    ].filter(Boolean) as string[]),
    "<!-- DOM_AI_ANNOTATIONS_START",
    portablePayload,
    "DOM_AI_ANNOTATIONS_END -->"
  ].join("\n");
}

export function importAnnotationsFromMarkdown(markdown: string): DomAnnotation[] {
  const match = markdown.match(/<!--\s*DOM_AI_ANNOTATIONS_START\s*([\s\S]*?)\s*DOM_AI_ANNOTATIONS_END\s*-->/);
  if (!match) return [];

  try {
    const decoded = decodeURIComponent(escape(atob(match[1].trim())));
    const parsed = JSON.parse(decoded);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isDomAnnotation);
  } catch {
    return [];
  }
}

function encodePortableAnnotations(annotations: DomAnnotation[]): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(stripScreenshots(annotations)))));
}

function stripScreenshots(annotations: DomAnnotation[]): DomAnnotation[] {
  return annotations.map((annotation) => ({
    ...annotation,
    screenshot: undefined
  }));
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
    ["opacity", styles.opacity],
    ["z-index", styles.zIndex]
  ].filter(([, value]) => value && value !== "normal" && value !== "none" && value !== "auto");

  return entries.map(([key, value]) => `${key}=${value}`).join("; ") || "无关键样式快照";
}
