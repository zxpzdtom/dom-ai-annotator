import type { AnnotationStatus, DomAnnotation, LegacyAnnotationStatus } from "./types";

const STORAGE_KEY = "domAiAnnotations";

type StoreShape = {
  [STORAGE_KEY]?: DomAnnotation[];
};

export async function getAnnotations(): Promise<DomAnnotation[]> {
  const data = (await chrome.storage.local.get(STORAGE_KEY)) as StoreShape;
  return (data[STORAGE_KEY] ?? []).map(normalizeAnnotationStatus);
}

export async function saveAnnotation(annotation: DomAnnotation): Promise<void> {
  const annotations = await getAnnotations();
  await chrome.storage.local.set({
    [STORAGE_KEY]: [annotation, ...annotations.filter((item) => item.id !== annotation.id)]
  });
}

export async function saveAnnotations(importedAnnotations: DomAnnotation[]): Promise<void> {
  const annotations = await getAnnotations();
  const importedIds = new Set(importedAnnotations.map((item) => item.id));
  await chrome.storage.local.set({
    [STORAGE_KEY]: [...importedAnnotations, ...annotations.filter((item) => !importedIds.has(item.id))]
  });
}

export async function updateAnnotationStatus(id: string, status: AnnotationStatus): Promise<void> {
  const annotations = await getAnnotations();
  const now = new Date().toISOString();
  await chrome.storage.local.set({
    [STORAGE_KEY]: annotations.map((item) => (item.id === id ? { ...item, status, updatedAt: now } : item))
  });
}

export async function updateAnnotationFeedback(
  id: string,
  feedback: Pick<DomAnnotation["feedback"], "comment" | "severity">
): Promise<void> {
  const annotations = await getAnnotations();
  const now = new Date().toISOString();
  await chrome.storage.local.set({
    [STORAGE_KEY]: annotations.map((item) =>
      item.id === id
        ? {
            ...item,
            feedback: {
              ...item.feedback,
              comment: feedback.comment,
              severity: feedback.severity
            },
            updatedAt: now
          }
        : item
    )
  });
}

export async function updateAnnotationStatusesForUrl(
  url: string,
  fromStatuses: AnnotationStatus[],
  toStatus: AnnotationStatus
): Promise<void> {
  const annotations = await getAnnotations();
  const now = new Date().toISOString();
  const fromSet = new Set(fromStatuses);
  await chrome.storage.local.set({
    [STORAGE_KEY]: annotations.map((item) =>
      item.url === url && fromSet.has(normalizeStatus(item.status))
        ? { ...item, status: toStatus, updatedAt: now }
        : item
    )
  });
}

export function normalizeStatus(status: AnnotationStatus | LegacyAnnotationStatus): AnnotationStatus {
  if (status === "acknowledged") return "sent";
  if (status === "resolved") return "passed";
  if (status === "rejected") return "skipped";
  return status;
}

function normalizeAnnotationStatus(annotation: DomAnnotation): DomAnnotation {
  return {
    ...annotation,
    status: normalizeStatus(annotation.status)
  };
}

export async function deleteAnnotation(id: string): Promise<void> {
  const annotations = await getAnnotations();
  await chrome.storage.local.set({
    [STORAGE_KEY]: annotations.filter((item) => item.id !== id)
  });
}

export async function clearAnnotationsForUrl(url: string): Promise<void> {
  const annotations = await getAnnotations();
  await chrome.storage.local.set({
    [STORAGE_KEY]: annotations.filter((item) => item.url !== url)
  });
}

export async function markFixRequested(id: string, requested: boolean): Promise<void> {
  const annotations = await getAnnotations();
  const now = new Date().toISOString();
  await chrome.storage.local.set({
    [STORAGE_KEY]: annotations.map((item) =>
      item.id === id ? { ...item, fixRequested: requested, updatedAt: now } : item
    )
  });
}

export async function updateAnnotationScreenshot(
  id: string,
  field: "screenshot" | "screenshotAfter",
  screenshot: import("./types").AnnotationScreenshot
): Promise<void> {
  const annotations = await getAnnotations();
  const now = new Date().toISOString();
  await chrome.storage.local.set({
    [STORAGE_KEY]: annotations.map((item) =>
      item.id === id ? { ...item, [field]: screenshot, updatedAt: now } : item
    )
  });
}

export function subscribeAnnotations(callback: () => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
    if (areaName === "local" && changes[STORAGE_KEY]) {
      callback();
    }
  };

  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
