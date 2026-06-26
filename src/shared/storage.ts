import type { AnnotationStatus, DomAnnotation, LegacyAnnotationStatus } from "./types";

const STORAGE_KEY = "domAiAnnotations";
const SCREENSHOT_STORAGE_KEY = "domAiAnnotationScreenshots";

type AnnotationScreenshots = Pick<DomAnnotation, "screenshot" | "screenshotAfter">;
type ScreenshotStore = Record<string, AnnotationScreenshots>;

type StoreShape = {
  [STORAGE_KEY]?: DomAnnotation[];
  [SCREENSHOT_STORAGE_KEY]?: ScreenshotStore;
};

type AnnotationStoreSnapshot = {
  annotations: DomAnnotation[];
  screenshots: ScreenshotStore;
  screenshotsChanged: boolean;
};

export async function getAnnotations(): Promise<DomAnnotation[]> {
  return (await getAnnotationStoreSnapshot()).annotations;
}

export async function saveAnnotation(annotation: DomAnnotation): Promise<void> {
  const snapshot = await getAnnotationStoreSnapshot();
  const nextAnnotations = [annotation, ...snapshot.annotations.filter((item) => item.id !== annotation.id)];
  const screenshots = withAnnotationScreenshots(snapshot.screenshots, annotation);
  await writeAnnotationMetadata(nextAnnotations, screenshots, snapshot.screenshotsChanged || screenshots !== snapshot.screenshots);
}

export async function saveAnnotations(importedAnnotations: DomAnnotation[]): Promise<void> {
  const snapshot = await getAnnotationStoreSnapshot();
  const importedIds = new Set(importedAnnotations.map((item) => item.id));
  const screenshots = importedAnnotations.reduce(
    (store, annotation) => withAnnotationScreenshots(store, annotation),
    snapshot.screenshots
  );
  await writeAnnotationMetadata(
    [...importedAnnotations, ...snapshot.annotations.filter((item) => !importedIds.has(item.id))],
    screenshots,
    snapshot.screenshotsChanged || screenshots !== snapshot.screenshots
  );
}

export async function updateAnnotationStatus(id: string, status: AnnotationStatus): Promise<void> {
  const snapshot = await getAnnotationStoreSnapshot();
  const now = new Date().toISOString();
  await writeAnnotationMetadata(
    snapshot.annotations.map((item) => item.id === id ? { ...item, status, updatedAt: now } : item),
    snapshot.screenshots,
    snapshot.screenshotsChanged
  );
}

export async function updateAnnotationFeedback(
  id: string,
  feedback: Pick<DomAnnotation["feedback"], "comment" | "severity">
): Promise<void> {
  const snapshot = await getAnnotationStoreSnapshot();
  const now = new Date().toISOString();
  await writeAnnotationMetadata(
    snapshot.annotations.map((item) =>
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
    ),
    snapshot.screenshots,
    snapshot.screenshotsChanged
  );
}

export async function updateAnnotationStatusesForUrl(
  url: string,
  fromStatuses: AnnotationStatus[],
  toStatus: AnnotationStatus
): Promise<void> {
  const snapshot = await getAnnotationStoreSnapshot();
  const now = new Date().toISOString();
  const fromSet = new Set(fromStatuses);
  await writeAnnotationMetadata(
    snapshot.annotations.map((item) =>
      item.url === url && fromSet.has(normalizeStatus(item.status))
        ? { ...item, status: toStatus, updatedAt: now }
        : item
    ),
    snapshot.screenshots,
    snapshot.screenshotsChanged
  );
}

export async function updateAnnotationStatusesByIds(
  ids: string[],
  fromStatuses: AnnotationStatus[],
  toStatus: AnnotationStatus
): Promise<void> {
  if (!ids.length) return;

  const snapshot = await getAnnotationStoreSnapshot();
  const now = new Date().toISOString();
  const idSet = new Set(ids);
  const fromSet = new Set(fromStatuses);
  await writeAnnotationMetadata(
    snapshot.annotations.map((item) =>
      idSet.has(item.id) && fromSet.has(normalizeStatus(item.status))
        ? { ...item, status: toStatus, updatedAt: now }
        : item
    ),
    snapshot.screenshots,
    snapshot.screenshotsChanged
  );
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
  const snapshot = await getAnnotationStoreSnapshot();
  const removedIds = new Set([id]);
  await writeAnnotationMetadata(
    snapshot.annotations.filter((item) => item.id !== id),
    omitScreenshotIds(snapshot.screenshots, removedIds),
    true
  );
}

export async function deleteAnnotationsByIds(ids: string[]): Promise<void> {
  if (!ids.length) return;

  const snapshot = await getAnnotationStoreSnapshot();
  const idSet = new Set(ids);
  await writeAnnotationMetadata(
    snapshot.annotations.filter((item) => !idSet.has(item.id)),
    omitScreenshotIds(snapshot.screenshots, idSet),
    true
  );
}

export async function clearAnnotationsForUrl(url: string): Promise<void> {
  const snapshot = await getAnnotationStoreSnapshot();
  const removedIds = new Set(snapshot.annotations.filter((item) => item.url === url).map((item) => item.id));
  await writeAnnotationMetadata(
    snapshot.annotations.filter((item) => item.url !== url),
    omitScreenshotIds(snapshot.screenshots, removedIds),
    true
  );
}

export async function markFixRequested(id: string, requested: boolean): Promise<void> {
  const snapshot = await getAnnotationStoreSnapshot();
  const now = new Date().toISOString();
  await writeAnnotationMetadata(
    snapshot.annotations.map((item) => item.id === id ? { ...item, fixRequested: requested, updatedAt: now } : item),
    snapshot.screenshots,
    snapshot.screenshotsChanged
  );
}

export async function updateAnnotationScreenshot(
  id: string,
  field: "screenshot" | "screenshotAfter",
  screenshot: import("./types").AnnotationScreenshot
): Promise<void> {
  const snapshot = await getAnnotationStoreSnapshot();
  const existing = snapshot.screenshots[id] ?? {};
  const now = new Date().toISOString();
  await chrome.storage.local.set({
    [STORAGE_KEY]: snapshot.annotations.map((item) => stripAnnotationScreenshots(item.id === id ? { ...item, updatedAt: now } : item)),
    [SCREENSHOT_STORAGE_KEY]: {
      ...snapshot.screenshots,
      [id]: {
        ...existing,
        [field]: screenshot
      }
    }
  });
}

export function subscribeAnnotations(callback: () => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
    if (areaName === "local" && (changes[STORAGE_KEY] || changes[SCREENSHOT_STORAGE_KEY])) {
      callback();
    }
  };

  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

async function getAnnotationStoreSnapshot(): Promise<AnnotationStoreSnapshot> {
  const data = (await chrome.storage.local.get([STORAGE_KEY, SCREENSHOT_STORAGE_KEY])) as StoreShape;
  const embedded = migrateEmbeddedScreenshots(data[STORAGE_KEY] ?? [], data[SCREENSHOT_STORAGE_KEY] ?? {});
  return {
    annotations: (data[STORAGE_KEY] ?? []).map((annotation) => mergeAnnotationScreenshots(normalizeAnnotationStatus(annotation), embedded.screenshots[annotation.id])),
    screenshots: embedded.screenshots,
    screenshotsChanged: embedded.changed
  };
}

async function writeAnnotationMetadata(annotations: DomAnnotation[], screenshots: ScreenshotStore, includeScreenshots: boolean): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEY]: annotations.map(stripAnnotationScreenshots),
    ...(includeScreenshots ? { [SCREENSHOT_STORAGE_KEY]: screenshots } : {})
  });
}

function mergeAnnotationScreenshots(annotation: DomAnnotation, screenshots?: AnnotationScreenshots): DomAnnotation {
  return {
    ...annotation,
    screenshot: screenshots?.screenshot ?? annotation.screenshot,
    screenshotAfter: screenshots?.screenshotAfter ?? annotation.screenshotAfter
  };
}

function stripAnnotationScreenshots(annotation: DomAnnotation): DomAnnotation {
  const { screenshot: _screenshot, screenshotAfter: _screenshotAfter, ...rest } = annotation;
  return rest;
}

function withAnnotationScreenshots(store: ScreenshotStore, annotation: DomAnnotation): ScreenshotStore {
  if (!annotation.screenshot && !annotation.screenshotAfter) return store;
  const existing = store[annotation.id];
  if (existing?.screenshot === annotation.screenshot && existing?.screenshotAfter === annotation.screenshotAfter) return store;
  return {
    ...store,
    [annotation.id]: {
      screenshot: annotation.screenshot ?? existing?.screenshot,
      screenshotAfter: annotation.screenshotAfter ?? existing?.screenshotAfter
    }
  };
}

function migrateEmbeddedScreenshots(annotations: DomAnnotation[], screenshots: ScreenshotStore): { screenshots: ScreenshotStore; changed: boolean } {
  let next = screenshots;

  for (const annotation of annotations) {
    const before = next;
    next = withAnnotationScreenshots(next, annotation);
    if (next !== before) continue;
  }

  return { screenshots: next, changed: next !== screenshots };
}

function omitScreenshotIds(store: ScreenshotStore, ids: Set<string>): ScreenshotStore {
  if (!ids.size) return store;
  return Object.fromEntries(Object.entries(store).filter(([id]) => !ids.has(id)));
}
