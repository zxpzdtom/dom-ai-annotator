import type { AnnotationStatus, DomAnnotation, FeedbackSeverity, LegacyAnnotationStatus } from "./types";

export type Tone = "brand" | "note" | "neutral" | "danger" | "success";

export const statusLabels: Record<AnnotationStatus, string> = {
  pending: "待处理",
  sent: "已发送",
  changed: "已修改",
  needs_work: "仍有问题",
  passed: "已通过",
  skipped: "不处理"
};

export const legacyStatusLabels: Record<LegacyAnnotationStatus, string> = {
  acknowledged: "已发送",
  resolved: "已通过",
  rejected: "不处理"
};

export const severityLabels: Record<FeedbackSeverity, string> = {
  blocking: "阻塞",
  important: "重要",
  suggestion: "建议"
};

export const pinPalettes: Record<AnnotationStatus, { bg: string; hover: string; badge: string; ring: string }> = {
  pending: { bg: "#64748b", hover: "#475569", badge: "#0f172a", ring: "rgba(100, 116, 139, 0.28)" },
  sent: { bg: "#0f9f78", hover: "#087c62", badge: "#064e3b", ring: "rgba(15, 159, 120, 0.3)" },
  changed: { bg: "#ea580c", hover: "#c2410c", badge: "#7c2d12", ring: "rgba(234, 88, 12, 0.3)" },
  needs_work: { bg: "#dc2626", hover: "#b91c1c", badge: "#7f1d1d", ring: "rgba(220, 38, 38, 0.3)" },
  passed: { bg: "#16a34a", hover: "#15803d", badge: "#14532d", ring: "rgba(22, 163, 74, 0.3)" },
  skipped: { bg: "#475569", hover: "#334155", badge: "#0f172a", ring: "rgba(71, 85, 105, 0.26)" }
};

export function normalizeAnnotationStatus(status: DomAnnotation["status"]): AnnotationStatus {
  if (status === "acknowledged") return "sent";
  if (status === "resolved") return "passed";
  if (status === "rejected") return "skipped";
  return status;
}

export function getStatusLabel(status: DomAnnotation["status"]): string {
  return status in legacyStatusLabels
    ? legacyStatusLabels[status as LegacyAnnotationStatus]
    : statusLabels[normalizeAnnotationStatus(status)];
}

export function getStatusTone(status: DomAnnotation["status"]): Tone {
  const normalized = normalizeAnnotationStatus(status);
  if (normalized === "passed") return "success";
  if (normalized === "needs_work") return "danger";
  if (normalized === "changed") return "note";
  if (normalized === "sent") return "brand";
  return "neutral";
}

export function getSeverityTone(severity: FeedbackSeverity): "danger" | "note" | "neutral" {
  if (severity === "blocking") return "danger";
  if (severity === "important") return "note";
  return "neutral";
}

export function getPinPalette(status: DomAnnotation["status"]) {
  return pinPalettes[normalizeAnnotationStatus(status)];
}
