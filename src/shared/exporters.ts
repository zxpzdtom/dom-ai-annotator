import type { DomAnnotation } from "./types";
import { normalizeStatus } from "./storage";
import { severityLabels, statusLabels } from "./status";

export function exportAnnotationsAsJson(annotations: DomAnnotation[]): string {
  return JSON.stringify(stripScreenshots(annotations), null, 2);
}

export function exportAnnotationsAsMarkdown(annotations: DomAnnotation[]): string {
  const visible = [...annotations].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

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
      item.feedback.expected ? "**期望效果**" : undefined,
      item.feedback.expected ? "" : undefined,
      item.feedback.expected,
      ""
    ].filter(Boolean) as string[])
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
    const comment = getMarkdownBlock(body, "反馈") || title.trim();

    if (!url || !selector || !rect || !viewport || !comment.trim()) continue;

    const now = new Date().toISOString();
    const xpath = getMarkdownCodeBullet(body, "XPath");
    const element = parseMarkdownElement(getMarkdownCodeBullet(body, "元素"));
    const severity = parseSeverityLabel(getMarkdownBullet(body, "优先级"));
    const status = parseStatusLabel(getMarkdownBullet(body, "状态"));
    const computedStyles = parseKeyStyles(getMarkdownBullet(body, "关键样式"));
    const expected = getMarkdownBlock(body, "期望效果");

    annotations.push({
      id: createReadableMarkdownAnnotationId(url, selector, comment, annotations.length),
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
