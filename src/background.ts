import { isExcludedUrl } from "./shared/excludedUrls";
import type { MonitorEvent, MonitorEventKind, PageContext, RuntimeMessage } from "./shared/types";

const DEBUG_STORAGE_PREFIX = "domAiDebugEvents:";
const MAX_DEBUG_EVENTS = 600;
const PANEL_HEARTBEAT_TIMEOUT_MS = 2500;
const panelHeartbeats = new Map<number, number>();

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  void syncAllTabsSidePanel();
});

chrome.runtime.onStartup.addListener(() => {
  void syncAllTabsSidePanel();
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void syncTabSidePanel(tabId);
});

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id) void syncTabSidePanel(tab.id, tab.url);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "complete") {
    void syncTabSidePanel(tabId, tab.url);
  }
});

chrome.tabs.onReplaced.addListener((addedTabId) => {
  void syncTabSidePanel(addedTabId);
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  const enabled = await syncTabSidePanel(tab.id, tab.url);
  if (!enabled) return;
  await chrome.sidePanel.open({ tabId: tab.id });
  void sendContentMessage(tab.id, { type: "DOM_AI_REFRESH_PINS" });
});

chrome.commands.onCommand.addListener(async (command) => {
  const tab = await getActiveTab();
  if (!tab?.id) return;
  const enabled = await syncTabSidePanel(tab.id, tab.url);
  if (!enabled) return;

  if (command === "start-picking") {
    await chrome.sidePanel.open({ tabId: tab.id });
    await sendContentMessage(tab.id, { type: "DOM_AI_START_PICKING" });
  }
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  if (message.type === "DOM_AI_GET_FRAME_CONTEXT") {
    const context: PageContext = {
      kind: sender.frameId && sender.frameId > 0 ? "iframe" : "top",
      url: sender.url || "",
      title: sender.frameId && sender.frameId > 0 ? sender.url || "" : sender.tab?.title || "",
      topUrl: sender.tab?.url || sender.url || "",
      topTitle: sender.tab?.title || "",
      frameId: sender.frameId,
      parentFrameId: (sender as chrome.runtime.MessageSender & { parentFrameId?: number }).parentFrameId
    };
    sendResponse(context);
    return;
  }

  if (message.type === "DOM_AI_OPEN_SIDE_PANEL") {
    const tabId = sender.tab?.id;
    const url = sender.tab?.url ?? "";
    if (!tabId) return;
    void syncTabSidePanel(tabId, url).then((enabled) => {
      if (enabled) void chrome.sidePanel.open({ tabId });
    });
    return;
  }

  if (message.type === "DOM_AI_FRAME_HOVER_ACTIVE") {
    const tabId = sender.tab?.id;
    if (!tabId) return;
    void getTabFrameIds(tabId)
      .then((frameIds) => sendMessageToFrames(tabId, frameIds, {
        type: "DOM_AI_FRAME_HOVER_ACTIVE",
        frameId: sender.frameId
      }))
      .catch(() => undefined);
    return;
  }

  if (message.type === "DOM_AI_BROADCAST_CONTENT_MESSAGE") {
    const tabId = sender.tab?.id;
    if (!tabId) return;
    void sendContentMessage(tabId, message.message);
    return;
  }

  if (message.type === "DOM_AI_CAPTURE_SCREENSHOT") {
    const rect = (message as { rect?: { x: number; y: number; width: number; height: number } }).rect;
    const windowId = sender.tab?.windowId ?? chrome.windows.WINDOW_ID_CURRENT;
    chrome.tabs.captureVisibleTab(windowId, { format: "png" }, (dataUrl) => {
      if (chrome.runtime.lastError || !dataUrl) {
        sendResponse({ success: false, error: chrome.runtime.lastError?.message ?? "Capture failed" });
        return;
      }
      sendResponse({
        success: true,
        data: { dataUrl, capturedAt: new Date().toISOString(), visibleRect: rect || { x: 0, y: 0, width: 0, height: 0 } },
      });
    });
    return true; // async sendResponse
  }

  if (message.type === "DOM_AI_RECORD_DEBUG_EVENT") {
    const tabId = sender.tab?.id ?? 0;
    if (!tabId) return;
    void appendDebugEvent(tabId, message.event);
    return;
  }

  if (message.type === "DOM_AI_SET_DEBUG_EVENTS") {
    void setDebugEventsForKind(message.tabId, message.kind, message.events);
    return;
  }

  if (message.type === "DOM_AI_GET_DEBUG_EVENTS") {
    const tabId = message.tabId ?? sender.tab?.id ?? 0;
    void getDebugEvents(tabId).then((events) => sendResponse({ events }));
    return true;
  }

  if (message.type === "DOM_AI_CLEAR_DEBUG_EVENTS") {
    void clearDebugEvents(message.tabId, message.kind).then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.type === "DOM_AI_GET_DEBUG_STORAGE_CONTEXT") {
    sendResponse({ tabId: sender.tab?.id ?? 0 });
    return;
  }

  if (message.type === "DOM_AI_PANEL_HEARTBEAT") {
    panelHeartbeats.set(message.tabId, Date.now());
    sendResponse({ active: true });
    return;
  }

  if (message.type === "DOM_AI_PANEL_CLOSED") {
    panelHeartbeats.delete(message.tabId);
    void clearDebugEvents(message.tabId);
    sendResponse({ active: false });
    return;
  }

  if (message.type === "DOM_AI_GET_PANEL_STATE") {
    const tabId = message.tabId ?? sender.tab?.id ?? 0;
    sendResponse({ active: isPanelActive(tabId) });
    return;
  }
});

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function syncActiveTabSidePanel() {
  const tab = await getActiveTab();
  if (tab?.id) await syncTabSidePanel(tab.id, tab.url);
}

async function syncAllTabsSidePanel() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map((tab) => (tab.id ? syncTabSidePanel(tab.id, tab.url) : Promise.resolve(false))));
  await syncActiveTabSidePanel();
}

async function syncTabSidePanel(tabId: number, url?: string): Promise<boolean> {
  const resolvedUrl = url ?? (await chrome.tabs.get(tabId).catch(() => undefined))?.url ?? "";
  const enabled = !isExcludedUrl(resolvedUrl);

  if (!enabled) {
    await chrome.sidePanel.setOptions({
      tabId,
      enabled: false
    });
    return false;
  }

  await chrome.sidePanel.setOptions({
    tabId,
    path: "src/sidepanel/index.html",
    enabled: true
  });
  return true;
}

async function sendContentMessage(tabId: number, message: unknown) {
  try {
    await injectContentScript(tabId);
  } catch {
    // Some frames may be restricted; still try to message frames that are available.
  }

  const frameIds = await getTabFrameIds(tabId);
  let delivered = await sendMessageToFrames(tabId, frameIds, message);
  if (!delivered) {
    await injectContentScript(tabId).catch(() => undefined);
    delivered = await sendMessageToFrames(tabId, await getTabFrameIds(tabId), message);
  }
  if (!delivered) {
    throw new Error("No content frame accepted the message.");
  }
}

async function getTabFrameIds(tabId: number): Promise<number[]> {
  const frames = await chrome.webNavigation.getAllFrames({ tabId }).catch(() => undefined);
  const ids = frames
    ?.map((frame) => frame.frameId)
    .filter((frameId): frameId is number => typeof frameId === "number");
  return ids?.length ? Array.from(new Set(ids)) : [0];
}

async function sendMessageToFrames(tabId: number, frameIds: number[], message: unknown): Promise<boolean> {
  const results = await Promise.allSettled(
    frameIds.map((frameId) => chrome.tabs.sendMessage(tabId, message, { frameId }))
  );
  return results.some((result) => result.status === "fulfilled");
}

async function injectContentScript(tabId: number) {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => import(chrome.runtime.getURL("content.js"))
  });
}

function debugStorageKey(tabId: number) {
  return `${DEBUG_STORAGE_PREFIX}${tabId}`;
}

async function getDebugEvents(tabId: number): Promise<MonitorEvent[]> {
  if (!tabId) return [];
  const key = debugStorageKey(tabId);
  const data = await chrome.storage.session.get(key);
  return Array.isArray(data[key]) ? data[key] as MonitorEvent[] : [];
}

async function writeDebugEvents(tabId: number, events: MonitorEvent[]) {
  if (!tabId) return;
  await chrome.storage.session.set({ [debugStorageKey(tabId)]: events.slice(0, MAX_DEBUG_EVENTS) });
  notifyDebugEventsChanged(tabId);
}

async function appendDebugEvent(tabId: number, event: MonitorEvent) {
  if (!isPanelActive(tabId)) return;
  const current = await getDebugEvents(tabId);
  await writeDebugEvents(tabId, [event, ...current.filter((item) => item.id !== event.id)]);
}

async function setDebugEventsForKind(tabId: number, kind: MonitorEventKind, events: MonitorEvent[]) {
  if (!isPanelActive(tabId)) return;
  const current = await getDebugEvents(tabId);
  const next = [
    ...events,
    ...current.filter((item) => item.kind !== kind)
  ].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  await writeDebugEvents(tabId, next);
}

async function clearDebugEvents(tabId: number, kind?: MonitorEventKind) {
  if (!kind) {
    await writeDebugEvents(tabId, []);
    return;
  }
  const current = await getDebugEvents(tabId);
  await writeDebugEvents(tabId, current.filter((item) => item.kind !== kind));
}

function notifyDebugEventsChanged(tabId: number) {
  void chrome.tabs.sendMessage(tabId, { type: "DOM_AI_DEBUG_EVENTS_CHANGED" }).catch(() => undefined);
}

function isPanelActive(tabId: number) {
  if (!tabId) return false;
  const lastSeen = panelHeartbeats.get(tabId) ?? 0;
  if (Date.now() - lastSeen <= PANEL_HEARTBEAT_TIMEOUT_MS) return true;
  panelHeartbeats.delete(tabId);
  return false;
}
