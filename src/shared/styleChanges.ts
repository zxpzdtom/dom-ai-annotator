import type { AnnotationStyleChange, DomAnnotation } from "./types";

const STYLE_CHANGE_LABELS: Record<string, string> = {
  text: "文本",
  color: "文本颜色",
  "background-color": "背景",
  opacity: "Opacity",
  "font-family": "字体",
  "font-size": "字号",
  "font-weight": "字重",
  "line-height": "行高",
  "text-align": "对齐",
  "flex-direction": "布局方向",
  "grid-auto-flow": "布局方向",
  "justify-content": "分布",
  "align-items": "对齐",
  "row-gap": "间距垂直",
  "column-gap": "间距水平",
  "border-radius": "边框圆角半径",
  "border-color": "边框颜色",
  "border-width": "边框宽度",
  width: "宽度",
  height: "高度",
  "margin-top": "外边距上",
  "margin-right": "外边距右",
  "margin-bottom": "外边距下",
  "margin-left": "外边距左",
  "padding-top": "内边距上",
  "padding-right": "内边距右",
  "padding-bottom": "内边距下",
  "padding-left": "内边距左"
};

export function formatStyleChangeSummary(changes: AnnotationStyleChange[]): string {
  if (!changes.length) return "";
  const preview = changes.slice(0, 3).map((change) => `${change.label} ${change.previousValue || "-"} -> ${change.value || "-"}`);
  const suffix = changes.length > preview.length ? `，另 ${changes.length - preview.length} 项` : "";
  return `调整样式：${preview.join("；")}${suffix}`;
}

export function formatStyleChangesForMarkdown(changes: AnnotationStyleChange[]): string {
  return changes.map((change) => `${change.property}: ${change.previousValue || "-"} -> ${change.value || "-"}`).join("; ");
}

export function getVisibleAnnotationComment(annotation: Pick<DomAnnotation, "feedback" | "styleChanges">): string {
  const comment = annotation.feedback.comment.trim();
  if (!comment) return "";
  return isGeneratedStyleComment(comment, annotation.styleChanges) ? "" : annotation.feedback.comment;
}

export function formatAnnotationFeedbackForMarkdown(annotation: Pick<DomAnnotation, "feedback" | "styleChanges">): string {
  return [
    getVisibleAnnotationComment(annotation).trim(),
    annotation.styleChanges?.length ? formatStyleChangeSummary(annotation.styleChanges) : ""
  ].filter(Boolean).join("\n\n");
}

export function stripGeneratedStyleComment(comment: string, changes?: AnnotationStyleChange[]): string {
  const trimmed = comment.trim();
  if (!trimmed || isGeneratedStyleComment(trimmed, changes)) return "";
  if (!changes?.length) return comment.trim();
  return trimmed
    .split(/\n{2,}/)
    .filter((block) => !isGeneratedStyleComment(block.trim(), changes))
    .join("\n\n")
    .trim();
}

export function parseStyleChanges(value?: string): AnnotationStyleChange[] {
  if (!value || value === "无") return [];
  return value.split(";").flatMap((part) => {
    const match = part.trim().match(/^([^:]+):\s*(.*?)\s*->\s*(.*)$/);
    if (!match) return [];
    const property = match[1].trim();
    return [{
      property,
      label: STYLE_CHANGE_LABELS[property] ?? property,
      previousValue: normalizeMarkdownStyleValue(match[2]),
      value: normalizeMarkdownStyleValue(match[3])
    }];
  });
}

function isGeneratedStyleComment(comment: string, changes?: AnnotationStyleChange[]): boolean {
  if (!changes?.length) return false;
  return comment.trim() === formatStyleChangeSummary(changes).trim();
}

function normalizeMarkdownStyleValue(value: string): string {
  const trimmed = value.trim();
  return trimmed === "-" ? "" : trimmed;
}
