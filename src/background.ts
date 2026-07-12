import { isExcludedUrl } from "./shared/excludedUrls";
import type { MonitorEvent, MonitorEventKind, PageContext, RuntimeMessage } from "./shared/types";

const DEBUG_STORAGE_PREFIX = "domAiDebugEvents:";
const SIDE_PANEL_PATH = "src/sidepanel/index.html";
const MAX_DEBUG_EVENTS = 600;
const PANEL_HEARTBEAT_TIMEOUT_MS = 2500;
const panelHeartbeats = new Map<number, number>();
const modernSidePanel = chrome.sidePanel as typeof chrome.sidePanel & {
  onOpened?: { addListener: (listener: (info: { tabId?: number; windowId: number; path: string }) => void) => void };
  onClosed?: { addListener: (listener: (info: { tabId?: number; windowId: number; path: string }) => void) => void };
};

// Match Chrome's native global side-panel model: Chrome owns the open/closed
// state and toolbar toggling. No per-tab options or custom state restoration.
void configureNativeSidePanel();

chrome.runtime.onInstalled.addListener(() => {
  void configureNativeSidePanel();
});

chrome.runtime.onStartup.addListener(() => {
  void configureNativeSidePanel();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  panelHeartbeats.delete(tabId);
});

chrome.commands.onCommand.addListener(async (command) => {
  const tab = await getActiveTab();
  if (!tab?.id) return;
  if (isExcludedUrl(tab.url ?? "")) return;

  if (command === "start-picking") {
    panelHeartbeats.set(tab.id, Date.now());
    await chrome.sidePanel.open({ windowId: tab.windowId });
    await handlePanelOpened(tab.id);
    await sendContentMessage(tab.id, { type: "DOM_AI_START_PICKING" });
  }
});

if (modernSidePanel.onOpened) {
  modernSidePanel.onOpened.addListener((info) => {
    void getActiveTabInWindow(info.windowId).then((tab) => {
      if (tab?.id) return handlePanelOpened(tab.id);
    });
  });
}

if (modernSidePanel.onClosed) {
  modernSidePanel.onClosed.addListener((info) => {
    void handleWindowPanelClosed(info.windowId);
  });
}

async function configureNativeSidePanel() {
  await Promise.all([
    chrome.action.setPopup({ popup: "" }),
    chrome.sidePanel.setOptions({ path: SIDE_PANEL_PATH, enabled: true }),
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  ]);
}

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
    return true;
  }

  if (message.type === "DOM_AI_PANEL_CLOSED") {
    void handlePanelDocumentClosed(message.tabId).then(() => {
      sendResponse({ active: false });
    });
    return true;
  }

  if (message.type === "DOM_AI_GET_PANEL_STATE") {
    const tabId = message.tabId ?? sender.tab?.id ?? 0;
    sendResponse({ active: isPanelHeartbeatActive(tabId) });
    return true;
  }
});

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function handlePanelDocumentClosed(tabId: number) {
  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  if (!tab) {
    panelHeartbeats.delete(tabId);
    return;
  }
  await handleWindowPanelClosed(tab.windowId);
}

async function hideTabContentUi(tabId: number) {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => {
      window.dispatchEvent(new CustomEvent("dom-ai-panel-visibility", {
        detail: { active: false }
      }));
    }
  }).catch(() => undefined);
}

async function getActiveTabInWindow(windowId: number) {
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  return tab;
}

async function handlePanelOpened(tabId: number) {
  panelHeartbeats.set(tabId, Date.now());
  await sendContentMessage(tabId, { type: "DOM_AI_REFRESH_PINS" }).catch(() => undefined);
}

async function handleWindowPanelClosed(windowId: number) {
  const tabs = await chrome.tabs.query({ windowId }).catch(() => []);
  await Promise.all(tabs.flatMap((tab) => tab.id ? [
    hideTabContentUi(tab.id),
    clearDebugEvents(tab.id)
  ] : []));
  for (const tab of tabs) {
    if (tab.id) panelHeartbeats.delete(tab.id);
  }
}

function isPanelHeartbeatActive(tabId: number) {
  if (!tabId) return false;
  const lastSeen = panelHeartbeats.get(tabId) ?? 0;
  if (Date.now() - lastSeen <= PANEL_HEARTBEAT_TIMEOUT_MS) return true;
  panelHeartbeats.delete(tabId);
  return false;
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
  if (!await isPanelActive(tabId)) return;
  const current = await getDebugEvents(tabId);
  await writeDebugEvents(tabId, [event, ...current.filter((item) => item.id !== event.id)]);
}

async function setDebugEventsForKind(tabId: number, kind: MonitorEventKind, events: MonitorEvent[]) {
  if (!await isPanelActive(tabId)) return;
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

async function isPanelActive(tabId: number) {
  return isPanelHeartbeatActive(tabId);
}
