import type { DomAnnotation, ElementSummary } from "./types";

export function getAnnotationOriginalText(annotation: Pick<DomAnnotation, "element" | "styleChanges">): string {
  return normalizeDisplayText(
    annotation.styleChanges?.find((change) => change.property === "text")?.previousValue
  ) || normalizeDisplayText(annotation.element.text);
}

export function getAnnotationTitle(annotation: Pick<DomAnnotation, "element" | "styleChanges">): string {
  const ariaLabel = normalizeDisplayText(annotation.element.ariaLabel);
  if (ariaLabel) return ariaLabel;

  const originalText = getAnnotationOriginalText(annotation);
  if (originalText) return originalText;

  const role = normalizeDisplayText(annotation.element.role);
  const signature = getElementSignature(annotation.element);
  if (role) return signature ? `${role} · ${signature}` : role;

  return signature || annotation.element.tag.toUpperCase();
}

export function describeElementForDisplay(annotation: Pick<DomAnnotation, "element" | "styleChanges">): string {
  const label = normalizeDisplayText(annotation.element.ariaLabel)
    || normalizeDisplayText(annotation.element.role)
    || getAnnotationOriginalText(annotation);
  const signature = getElementSignature(annotation.element);
  return `${signature || annotation.element.tag}${label ? ` (${truncateLabel(label)})` : ""}`;
}

export function getAnnotationCodeSearchHints(annotation: Pick<DomAnnotation, "element" | "selector" | "xpath" | "styleChanges">): string[] {
  const hints = new Set<string>();
  const originalText = getAnnotationOriginalText(annotation);
  const currentText = normalizeDisplayText(annotation.element.text);

  addHint(hints, originalText && currentText && originalText !== currentText ? `原始文本: ${originalText}` : originalText ? `文本: ${originalText}` : "");
  if (currentText && currentText !== originalText) addHint(hints, `当前文本: ${currentText}`);
  addHint(hints, annotation.element.ariaLabel ? `aria-label: ${annotation.element.ariaLabel}` : "");
  addHint(hints, annotation.element.role ? `role: ${annotation.element.role}` : "");
  addHint(hints, annotation.element.id ? `id: ${annotation.element.id}` : "");

  for (const className of getStableClassNames(annotation.element.className).slice(0, 4)) {
    addHint(hints, `class: ${className}`);
  }

  addHint(hints, getSelectorTail(annotation.selector) ? `选择器片段: ${getSelectorTail(annotation.selector)}` : "");
  addHint(hints, annotation.xpath ? `XPath: ${annotation.xpath}` : "");

  return Array.from(hints);
}

function getElementSignature(element: ElementSummary): string {
  const tag = element.tag || "element";
  const id = element.id ? `#${element.id}` : "";
  const classes = getStableClassNames(element.className)
    .slice(0, 2)
    .map((className) => `.${className}`)
    .join("");
  return `${tag}${id}${classes}`;
}

function getStableClassNames(className?: string): string[] {
  return (className || "")
    .trim()
    .split(/\s+/)
    .filter((item) => item && !item.startsWith("dom-ai-"));
}

function getSelectorTail(selector: string): string {
  return selector.split(/\s*>\s*/).filter(Boolean).slice(-2).join(" > ");
}

function addHint(hints: Set<string>, value: string | undefined) {
  const normalized = normalizeDisplayText(value);
  if (normalized) hints.add(normalized);
}

function normalizeDisplayText(value?: string): string {
  return (value || "").replace(/\s+/g, " ").trim();
}

function truncateLabel(value: string): string {
  return value.length > 80 ? `${value.slice(0, 80)}...` : value;
}
