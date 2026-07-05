import type { AnnotationStyleChange } from "../shared/types";
import type {
  ColorMode,
  EditableStyleField,
  EditableStyleValues,
  HoverInspection,
  InlineStyleSnapshot,
  NumericAdjusterConfig,
  NumericAdjusterConfigs
} from "./styleTypes";

export const FONT_WEIGHT_OPTIONS = ["400", "500", "600", "700", "800", "900"];

const EDITABLE_STYLE_FIELDS: EditableStyleField[] = [
  { property: "textContent", label: "文本" },
  { property: "color", cssProperty: "color", label: "文本颜色" },
  { property: "backgroundColor", cssProperty: "background-color", label: "背景" },
  { property: "opacity", cssProperty: "opacity", label: "Opacity" },
  { property: "fontFamily", cssProperty: "font-family", label: "字体" },
  { property: "fontSize", cssProperty: "font-size", label: "字号" },
  { property: "fontWeight", cssProperty: "font-weight", label: "字重" },
  { property: "lineHeight", cssProperty: "line-height", label: "行高" },
  { property: "textAlign", cssProperty: "text-align", label: "对齐" },
  { property: "flexDirection", cssProperty: "flex-direction", label: "布局方向" },
  { property: "gridAutoFlow", cssProperty: "grid-auto-flow", label: "布局方向" },
  { property: "justifyContent", cssProperty: "justify-content", label: "分布" },
  { property: "alignItems", cssProperty: "align-items", label: "对齐" },
  { property: "rowGap", cssProperty: "row-gap", label: "间距垂直" },
  { property: "columnGap", cssProperty: "column-gap", label: "间距水平" },
  { property: "borderRadius", cssProperty: "border-radius", label: "边框圆角半径" },
  { property: "borderColor", cssProperty: "border-color", label: "边框颜色" },
  { property: "borderWidth", cssProperty: "border-width", label: "边框宽度" },
  { property: "width", cssProperty: "width", label: "宽度" },
  { property: "height", cssProperty: "height", label: "高度" },
  { property: "marginTop", cssProperty: "margin-top", label: "外边距上" },
  { property: "marginRight", cssProperty: "margin-right", label: "外边距右" },
  { property: "marginBottom", cssProperty: "margin-bottom", label: "外边距下" },
  { property: "marginLeft", cssProperty: "margin-left", label: "外边距左" },
  { property: "paddingTop", cssProperty: "padding-top", label: "内边距上" },
  { property: "paddingRight", cssProperty: "padding-right", label: "内边距右" },
  { property: "paddingBottom", cssProperty: "padding-bottom", label: "内边距下" },
  { property: "paddingLeft", cssProperty: "padding-left", label: "内边距左" }
];

export function getBoxValue(styles: CSSStyleDeclaration, prefix: "margin" | "padding"): string {
  const top = compactPx(styles.getPropertyValue(`${prefix}-top`));
  const right = compactPx(styles.getPropertyValue(`${prefix}-right`));
  const bottom = compactPx(styles.getPropertyValue(`${prefix}-bottom`));
  const left = compactPx(styles.getPropertyValue(`${prefix}-left`));
  return `${top} ${right} ${bottom} ${left}`;
}

export function getComputedBoxSnapshot(styles: Record<string, string>, prefix: "margin" | "padding"): string {
  const shorthand = styles[prefix];
  if (shorthand) return shorthand;
  return [
    styles[`${prefix}Top`],
    styles[`${prefix}Right`],
    styles[`${prefix}Bottom`],
    styles[`${prefix}Left`]
  ].filter(Boolean).join(" ") || "-";
}

function compactPx(value: string): string {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return value;
  return `${Math.round(parsed * 10) / 10}px`;
}

export function compactPxNumber(value: number): string {
  if (!Number.isFinite(value)) return "-";
  return `${Math.round(value * 10) / 10}px`;
}

export function compactUnitValue(value: string): string {
  if (!value) return "-";
  return compactPx(value);
}

function compactGapValue(value: string): string {
  if (!value || value === "normal" || value === "-") return "0px";
  return compactPx(value);
}

function getPrimaryFontFamily(value: string): string {
  const [primary] = value.split(",");
  return (primary || value).trim().replace(/^["']|["']$/g, "") || "-";
}

export function formatColor(value: string, mode: ColorMode): string {
  const color = parseCssColor(value);
  if (!color) return value;
  if (mode === "rgb") return color.a < 1 ? `rgba(${color.r}, ${color.g}, ${color.b}, ${roundColor(color.a)})` : `rgb(${color.r}, ${color.g}, ${color.b})`;
  if (mode === "hex") return rgbToHex(color);
  return rgbToHsl(color);
}

export function parseCssColor(value: string): { r: number; g: number; b: number; a: number } | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  return parseCssRgb(normalized) ?? parseCssHex(normalized);
}

function parseCssRgb(value: string): { r: number; g: number; b: number; a: number } | null {
  const match = value.match(/^rgba?\((.+)\)$/i);
  if (!match) return null;
  const parts = match[1].split(/,\s*/).map((part) => part.trim());
  if (parts.length < 3) return null;
  const r = Number.parseFloat(parts[0]);
  const g = Number.parseFloat(parts[1]);
  const b = Number.parseFloat(parts[2]);
  const a = parts[3] === undefined ? 1 : Number.parseFloat(parts[3]);
  if (![r, g, b, a].every(Number.isFinite)) return null;
  return {
    r: clampColor(r),
    g: clampColor(g),
    b: clampColor(b),
    a: Math.min(1, Math.max(0, a))
  };
}

function parseCssHex(value: string): { r: number; g: number; b: number; a: number } | null {
  const match = value.match(/^#([0-9a-f]{3,8})$/i);
  if (!match) return null;
  const hex = match[1];
  const expand = (part: string) => part.length === 1 ? `${part}${part}` : part;
  const channels = hex.length <= 4
    ? [expand(hex[0]), expand(hex[1]), expand(hex[2]), hex[3] ? expand(hex[3]) : "ff"]
    : [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6), hex.slice(6, 8) || "ff"];
  const [r, g, b, alpha] = channels.map((channel) => Number.parseInt(channel, 16));
  if (![r, g, b, alpha].every(Number.isFinite)) return null;
  return {
    r,
    g,
    b,
    a: Math.round((alpha / 255) * 100) / 100
  };
}

function rgbToHex(color: { r: number; g: number; b: number; a: number }): string {
  const hex = [color.r, color.g, color.b].map((channel) => channel.toString(16).padStart(2, "0")).join("");
  if (color.a >= 1) return `#${hex}`;
  return `#${hex}${Math.round(color.a * 255).toString(16).padStart(2, "0")}`;
}

function rgbToHsl(color: { r: number; g: number; b: number; a: number }): string {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  let hue = 0;
  let saturation = 0;

  if (max !== min) {
    const delta = max - min;
    saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    if (max === r) hue = (g - b) / delta + (g < b ? 6 : 0);
    if (max === g) hue = (b - r) / delta + 2;
    if (max === b) hue = (r - g) / delta + 4;
    hue *= 60;
  }

  const hsl = `${Math.round(hue)} ${Math.round(saturation * 100)}% ${Math.round(lightness * 100)}%`;
  return color.a < 1 ? `hsl(${hsl} / ${roundColor(color.a)})` : `hsl(${hsl})`;
}

function clampColor(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function roundColor(value: number): number {
  return Math.round(value * 100) / 100;
}

export function getNumericAdjusterConfigs(values: EditableStyleValues): NumericAdjusterConfigs {
  return {
    fontSize: createNumericAdjuster("fontSize", "font-size", "字号", 6, 180, numericFallback(values.fontSize, 16), 0.42, "px", "px", 1, 1),
    lineHeight: createNumericAdjuster("lineHeight", "line-height", "行高", 6, 240, numericFallback(values.lineHeight, numericFallback(values.fontSize, 16) * 1.4), 0.42, "px", "px", 1, 1),
    opacity: createNumericAdjuster("opacity", "opacity", "Opacity", 0, 1, numericFallback(values.opacity, 1), 0.004, "", "", 0.01, 0.01),
    gap: createNumericAdjuster("gap", "gap", "间距", 0, 160, numericFallback(values.gap, 0), 0.3, "px", "px", 1, 1),
    rowGap: createNumericAdjuster("rowGap", "row-gap", "垂直", 0, 160, numericFallback(values.rowGap, numericFallback(values.gap, 0)), 0.3, "px", "px", 1, 1),
    columnGap: createNumericAdjuster("columnGap", "column-gap", "水平", 0, 160, numericFallback(values.columnGap, numericFallback(values.gap, 0)), 0.3, "px", "px", 1, 1),
    borderRadius: createNumericAdjuster("borderRadius", "border-radius", "边框圆角半径", 0, 160, numericFallback(values.borderRadius, 0), 0.3, "px", "px", 1, 1),
    borderWidth: createNumericAdjuster("borderWidth", "border-width", "边框宽度", 0, 48, numericFallback(values.borderWidth, 0), 0.2, "px", "px", 1, 1),
    width: createNumericAdjuster("width", "width", "宽度", 0, 2400, numericFallback(values.width, 0), 0.8, "px", "px", 1, 1),
    height: createNumericAdjuster("height", "height", "高度", 0, 2400, numericFallback(values.height, 0), 0.8, "px", "px", 1, 1),
    marginTop: createNumericAdjuster("marginTop", "margin-top", "上", -160, 240, numericFallback(values.marginTop, 0), 0.3, "px", "px", 1, 1),
    marginRight: createNumericAdjuster("marginRight", "margin-right", "右", -160, 240, numericFallback(values.marginRight, 0), 0.3, "px", "px", 1, 1),
    marginBottom: createNumericAdjuster("marginBottom", "margin-bottom", "下", -160, 240, numericFallback(values.marginBottom, 0), 0.3, "px", "px", 1, 1),
    marginLeft: createNumericAdjuster("marginLeft", "margin-left", "左", -160, 240, numericFallback(values.marginLeft, 0), 0.3, "px", "px", 1, 1),
    paddingTop: createNumericAdjuster("paddingTop", "padding-top", "上", 0, 240, numericFallback(values.paddingTop, 0), 0.3, "px", "px", 1, 1),
    paddingRight: createNumericAdjuster("paddingRight", "padding-right", "右", 0, 240, numericFallback(values.paddingRight, 0), 0.3, "px", "px", 1, 1),
    paddingBottom: createNumericAdjuster("paddingBottom", "padding-bottom", "下", 0, 240, numericFallback(values.paddingBottom, 0), 0.3, "px", "px", 1, 1),
    paddingLeft: createNumericAdjuster("paddingLeft", "padding-left", "左", 0, 240, numericFallback(values.paddingLeft, 0), 0.3, "px", "px", 1, 1)
  };
}

function createNumericAdjuster(
  property: keyof EditableStyleValues,
  cssProperty: string,
  label: string,
  min: number,
  max: number,
  fallback: number,
  dragScale: number,
  unit: string,
  cssUnit: string,
  step: number,
  precision: number
): NumericAdjusterConfig {
  return { property, cssProperty, label, min, max, fallback, dragScale, unit, cssUnit, step, precision };
}

export function isTextStyleRelevant(inspection: HoverInspection): boolean {
  const tag = inspection.element?.tagName.toLowerCase() ?? "";
  if (["img", "video", "canvas", "svg", "picture"].includes(tag)) return false;
  if (["h1", "h2", "h3", "h4", "h5", "h6", "p", "span", "a", "button", "label", "input", "textarea", "li", "td", "th"].includes(tag)) return true;
  const text = inspection.element?.textContent?.replace(/\s+/g, "").trim();
  return Boolean(text);
}

export function isTextContentEditable(inspection: HoverInspection): boolean {
  const element = inspection.element;
  if (!(element instanceof HTMLElement)) return inspection.textContent.trim().length > 0;
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return true;
  const tag = element.tagName.toLowerCase();
  if (["script", "style", "svg", "canvas", "img", "video", "picture"].includes(tag)) return false;
  return element.children.length === 0 && getEditableElementText(element).trim().length > 0;
}

export function getEditableElementText(element: Element | undefined): string {
  if (!element) return "";
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return element.value;
  return element.textContent ?? "";
}

export function setEditableElementText(element: Element, value: string) {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    element.value = value;
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  element.textContent = value;
}

export function isLayoutStyleRelevant(inspection: HoverInspection): boolean {
  return inspection.display.includes("flex") || inspection.display.includes("grid") || Boolean(inspection.gap && inspection.gap !== "normal" && inspection.gap !== "-");
}

export function getElementStyleTitle(inspection: HoverInspection): string {
  return inspection.element?.tagName.toLowerCase() || inspection.label || "元素";
}

export function createEditableStyleValues(inspection: HoverInspection): EditableStyleValues {
  const margin = splitBoxValue(inspection.margin);
  const padding = splitBoxValue(inspection.padding);
  return {
    textContent: inspection.textContent,
    fontSize: compactUnitValue(inspection.fontSize),
    lineHeight: compactUnitValue(inspection.lineHeight),
    fontWeight: inspection.fontWeight || "",
    fontFamily: getPrimaryFontFamily(inspection.fontFamily),
    color: inspection.color || "rgb(0, 0, 0)",
    backgroundColor: inspection.backgroundColor || "rgba(255, 255, 255, 0)",
    opacity: inspection.opacity || "1",
    textAlign: inspection.textAlign || "left",
    flexDirection: inspection.flexDirection || "row",
    justifyContent: normalizeJustifyContent(inspection.justifyContent),
    alignItems: normalizeAlignItems(inspection.alignItems),
    gridAutoFlow: inspection.gridAutoFlow || "row",
    gap: compactGapValue(inspection.gap),
    rowGap: compactGapValue(inspection.rowGap || inspection.gap),
    columnGap: compactGapValue(inspection.columnGap || inspection.gap),
    borderRadius: compactUnitValue(inspection.borderRadius),
    borderColor: inspection.borderColor || "rgba(0, 0, 0, 0)",
    borderWidth: compactUnitValue(inspection.borderWidth),
    width: compactUnitValue(inspection.width),
    height: compactUnitValue(inspection.height),
    marginTop: margin.top,
    marginRight: margin.right,
    marginBottom: margin.bottom,
    marginLeft: margin.left,
    paddingTop: padding.top,
    paddingRight: padding.right,
    paddingBottom: padding.bottom,
    paddingLeft: padding.left
  };
}

export function createEditableStyleValuesWithChanges(
  inspection: HoverInspection,
  changes: AnnotationStyleChange[] = []
): EditableStyleValues {
  const values = createEditableStyleValues(inspection);
  for (const change of changes) {
    const property = getEditableStylePropertyForChange(change.property);
    if (!property) continue;
    values[property] = change.value;
  }
  return values;
}

export function createEditableStyleBaselineValues(
  inspection: HoverInspection,
  changes: AnnotationStyleChange[] = []
): EditableStyleValues {
  const values = createEditableStyleValues(inspection);
  for (const change of changes) {
    const property = getEditableStylePropertyForChange(change.property);
    if (!property) continue;
    values[property] = change.previousValue;
  }
  return values;
}

export function getEditableStylePropertyForChange(property: string): keyof EditableStyleValues | null {
  const field = EDITABLE_STYLE_FIELDS.find((item) => (item.cssProperty ?? "text") === property);
  return field?.property ?? null;
}

function splitBoxValue(value: string): { top: string; right: string; bottom: string; left: string } {
  const parts = value.split(/\s+/).filter(Boolean);
  const [top = "0px", right = top, bottom = top, left = right] = parts;
  return { top, right, bottom, left };
}

function normalizeJustifyContent(value: string): string {
  if (!value || value === "normal" || value === "start") return "flex-start";
  if (value === "end") return "flex-end";
  return value;
}

function normalizeAlignItems(value: string): string {
  if (!value || value === "normal") return "stretch";
  if (value === "start") return "flex-start";
  if (value === "end") return "flex-end";
  return value;
}

export function pxNumber(value: string): number {
  if (!value || value === "normal" || value === "-") return Number.NaN;
  return Number.parseFloat(value);
}

export function roundToPrecision(value: number, step: number): number {
  if (step >= 1) return Math.round(value);
  const decimals = Math.max(0, Math.ceil(Math.abs(Math.log10(step))));
  return Number(value.toFixed(decimals));
}

function numericFallback(value: string, fallback: number): number {
  const parsed = pxNumber(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function formatNumericStyleValue(config: NumericAdjusterConfig, rawValue: number | string): string {
  const parsed = typeof rawValue === "number" ? rawValue : Number.parseFloat(rawValue);
  if (!Number.isFinite(parsed)) return "";
  const nextValue = clampNumber(parsed, config.min, config.max);
  const roundedValue = roundToPrecision(nextValue, config.precision);
  return `${roundedValue}${config.cssUnit}`;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function styleValueMatches(property: keyof EditableStyleValues, value: string, baseline: string): boolean {
  const current = value.trim();
  const previous = baseline.trim();
  if (property === "color" || property === "backgroundColor" || property === "borderColor") {
    const currentColor = parseCssColor(current);
    const previousColor = parseCssColor(previous);
    if (currentColor && previousColor) {
      return currentColor.r === previousColor.r
        && currentColor.g === previousColor.g
        && currentColor.b === previousColor.b
        && Math.abs(currentColor.a - previousColor.a) < 0.01;
    }
  }

  const currentNumber = pxNumber(current);
  const previousNumber = pxNumber(previous);
  if (Number.isFinite(currentNumber) && Number.isFinite(previousNumber)) {
    return Math.abs(currentNumber - previousNumber) < 0.01;
  }

  return current === previous;
}

export function getEditableStyleChanges(values: EditableStyleValues, baselineValues: EditableStyleValues): AnnotationStyleChange[] {
  return EDITABLE_STYLE_FIELDS.flatMap((field) => {
    const current = values[field.property];
    const previous = baselineValues[field.property];
    if (styleValueMatches(field.property, current, previous)) return [];
    return [{
      property: field.cssProperty ?? "text",
      label: field.label,
      previousValue: previous,
      value: current
    }];
  });
}

export function captureInlineStyleSnapshot(element: HTMLElement): InlineStyleSnapshot {
  return EDITABLE_STYLE_FIELDS.reduce<InlineStyleSnapshot>((snapshot, field) => {
    if (!field.cssProperty) return snapshot;
    const value = element.style.getPropertyValue(field.cssProperty);
    snapshot[field.cssProperty] = value
      ? { value, priority: element.style.getPropertyPriority(field.cssProperty) }
      : null;
    return snapshot;
  }, {});
}

export function restoreInlineStyleSnapshot(element: HTMLElement, snapshot: InlineStyleSnapshot) {
  for (const [property, value] of Object.entries(snapshot)) {
    restoreInlineStyle(element, property, value);
  }
}

export function restoreInlineStyle(element: HTMLElement, property: string, value: InlineStyleSnapshot[string]) {
  if (value) {
    element.style.setProperty(property, value.value, value.priority);
    return;
  }
  element.style.removeProperty(property);
}

export function applyEditableStyleValue(element: HTMLElement, cssProperty: string, value: string) {
  element.style.setProperty(cssProperty, value);
  const computedValue = getComputedStyle(element).getPropertyValue(cssProperty);
  if (!styleCssValueReflects(cssProperty, computedValue, value)) {
    element.style.setProperty(cssProperty, value, "important");
  }
}

function styleCssValueReflects(cssProperty: string, computedValue: string, expectedValue: string): boolean {
  if (cssProperty.includes("color")) {
    const computedColor = parseCssColor(computedValue);
    const expectedColor = parseCssColor(expectedValue);
    if (computedColor && expectedColor) {
      return computedColor.r === expectedColor.r
        && computedColor.g === expectedColor.g
        && computedColor.b === expectedColor.b
        && Math.abs(computedColor.a - expectedColor.a) < 0.01;
    }
  }

  const computedNumber = pxNumber(computedValue);
  const expectedNumber = pxNumber(expectedValue);
  if (Number.isFinite(computedNumber) && Number.isFinite(expectedNumber)) {
    const tolerance = cssProperty === "opacity" ? 0.01 : 0.5;
    return Math.abs(computedNumber - expectedNumber) <= tolerance;
  }

  return computedValue.trim() === expectedValue.trim();
}

export function cssColorToNativeInput(value: string): string {
  const color = parseCssColor(value);
  if (!color) return "#000000";
  return `#${[color.r, color.g, color.b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

export function swatchBackground(value: string): string {
  const color = parseCssColor(value);
  const displayValue = color ? formatColor(rgbToHex(color), "rgb") : value;
  if (color && color.a < 1) {
    return `linear-gradient(${displayValue}, ${displayValue}), conic-gradient(#d1d5db 25%, #fff 0 50%, #d1d5db 0 75%, #fff 0) 0 / 10px 10px`;
  }
  return displayValue;
}
