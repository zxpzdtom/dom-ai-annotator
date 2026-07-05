import { compactPxNumber } from "./styleModel";
import type { HoverInspection } from "./styleTypes";

export const MEASURE_COLORS = ["#2563eb", "#dc2626", "#7c3aed", "#ea580c", "#0891b2", "#16a34a"];

export type MeasurementLine = {
  key: string;
  orientation: "horizontal" | "vertical";
  x: number;
  y: number;
  length: number;
  label: string;
  labelX: number;
  labelY: number;
};

export type PinnedMeasurement = {
  key: string;
  color: string;
  from: HoverInspection;
  to: HoverInspection;
  measurements: MeasurementLine[];
};

export function getElementDistanceLines(from: HoverInspection["documentRect"], to: HoverInspection["documentRect"]): MeasurementLine[] {
  if (containsRect(from, to)) return getContainedDistanceLines(to, from);
  if (containsRect(to, from)) return getContainedDistanceLines(from, to);

  const lines: MeasurementLine[] = [];
  const fromRight = from.x + from.width;
  const toRight = to.x + to.width;
  const fromBottom = from.y + from.height;
  const toBottom = to.y + to.height;
  const verticalGuideY = getOverlapCenter(from.y, fromBottom, to.y, toBottom) ?? midpoint(from.y, fromBottom, to.y, toBottom);
  const horizontalGuideX = getOverlapCenter(from.x, fromRight, to.x, toRight) ?? midpoint(from.x, fromRight, to.x, toRight);

  if (fromRight <= to.x) {
    lines.push(createHorizontalMeasure("between-horizontal", fromRight, verticalGuideY, to.x - fromRight));
  } else if (toRight <= from.x) {
    lines.push(createHorizontalMeasure("between-horizontal", toRight, verticalGuideY, from.x - toRight));
  }

  if (fromBottom <= to.y) {
    lines.push(createVerticalMeasure("between-vertical", horizontalGuideX, fromBottom, to.y - fromBottom));
  } else if (toBottom <= from.y) {
    lines.push(createVerticalMeasure("between-vertical", horizontalGuideX, toBottom, from.y - toBottom));
  }

  return lines.filter((line) => line.length > 0);
}

function getContainedDistanceLines(
  inner: HoverInspection["documentRect"],
  outer: HoverInspection["documentRect"]
): MeasurementLine[] {
  const innerRight = inner.x + inner.width;
  const outerRight = outer.x + outer.width;
  const innerBottom = inner.y + inner.height;
  const outerBottom = outer.y + outer.height;
  const centerX = inner.x + inner.width / 2;
  const centerY = inner.y + inner.height / 2;

  return [
    createVerticalMeasure("inside-top", centerX, outer.y, Math.max(0, inner.y - outer.y)),
    createHorizontalMeasure("inside-right", innerRight, centerY, Math.max(0, outerRight - innerRight)),
    createVerticalMeasure("inside-bottom", centerX, innerBottom, Math.max(0, outerBottom - innerBottom)),
    createHorizontalMeasure("inside-left", outer.x, centerY, Math.max(0, inner.x - outer.x))
  ];
}

function containsRect(outer: HoverInspection["documentRect"], inner: HoverInspection["documentRect"]): boolean {
  const outerRight = outer.x + outer.width;
  const outerBottom = outer.y + outer.height;
  const innerRight = inner.x + inner.width;
  const innerBottom = inner.y + inner.height;
  return outer.x <= inner.x && outer.y <= inner.y && outerRight >= innerRight && outerBottom >= innerBottom;
}

function createHorizontalMeasure(key: string, x: number, y: number, length: number): MeasurementLine {
  return {
    key,
    orientation: "horizontal",
    x,
    y,
    length,
    label: compactPxNumber(length),
    labelX: x + length / 2,
    labelY: y
  };
}

function createVerticalMeasure(key: string, x: number, y: number, length: number): MeasurementLine {
  return {
    key,
    orientation: "vertical",
    x,
    y,
    length,
    label: compactPxNumber(length),
    labelX: x,
    labelY: y + length / 2
  };
}

function getOverlapCenter(aStart: number, aEnd: number, bStart: number, bEnd: number): number | null {
  const start = Math.max(aStart, bStart);
  const end = Math.min(aEnd, bEnd);
  return start < end ? start + (end - start) / 2 : null;
}

function midpoint(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return (aStart + aEnd + bStart + bEnd) / 4;
}
