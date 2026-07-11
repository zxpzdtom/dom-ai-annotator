import { isExcludedUrl } from "./shared/excludedUrls";
import type { MonitorEvent, MonitorEventKind, PageContext, RuntimeMessage } from "./shared/types";

const DEBUG_STORAGE_PREFIX = "domAiDebugEvents:";
const PANEL_ACTIVATION_PREFIX = "domAiPanelActivation:";
const MAX_DEBUG_EVENTS = 600;
const PANEL_HEARTBEAT_TIMEOUT_MS = 2500;
const panelHeartbeats = new Map<number, number>();
const openPanelTabs = new Set<number>();
const modernSidePanel = chrome.sidePanel as typeof chrome.sidePanel & {
  close?: (options: { tabId?: number; windowId?: number }) => Promise<void>;
  onOpened?: { addListener: (listener: (info: { tabId?: number; windowId: number; path: string }) => void) => void };
  onClosed?: { addListener: (listener: (info: { tabId?: number; windowId: number; path: string }) => void) => void };
};

// The panel is opened explicitly below from a user gesture. Keeping Chrome's
// automatic action behavior enabled can restore it during page navigation.
void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });

chrome.runtime.onInstalled.addListener(() => {
  void resetAllTabsSidePanel();
});

chrome.runtime.onStartup.addListener(() => {
  void resetAllTabsSidePanel();
});

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id) void prepareTabSidePanel(tab.id, tab.url);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "complete") {
    void prepareTabSidePanel(tabId, tab.url);
  }
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  void transferPanelActivation(removedTabId, addedTabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  openPanelTabs.delete(tabId);
  panelHeartbeats.delete(tabId);
  void removePanelActivation(tabId);
});

chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return;
  if (isExcludedUrl(tab.url ?? "")) return;

  if (isTabPanelOpen(tab.id)) {
    closeTabSidePanel(tab.id, tab.windowId);
    return;
  }

  // open() must run synchronously inside the action click so Chrome preserves
  // the user gesture. Configuration is prepared when the tab is created.
  const openPanel = chrome.sidePanel.open({ tabId: tab.id });
  openPanelTabs.add(tab.id);
  panelHeartbeats.set(tab.id, Date.now());
  void markTabPanelActivated(tab.id);
  void openPanel
    .then(() => handlePanelOpened(tab.id!))
    .catch(() => handlePanelClosed(tab.id!));
});

chrome.commands.onCommand.addListener(async (command) => {
  const tab = await getActiveTab();
  if (!tab?.id) return;
  if (isExcludedUrl(tab.url ?? "")) return;

  if (command === "start-picking") {
    openPanelTabs.add(tab.id);
    panelHeartbeats.set(tab.id, Date.now());
    void markTabPanelActivated(tab.id);
    await chrome.sidePanel.open({ tabId: tab.id });
    await handlePanelOpened(tab.id);
    await sendContentMessage(tab.id, { type: "DOM_AI_START_PICKING" });
  }
});

if (modernSidePanel.onOpened) {
  modernSidePanel.onOpened.addListener((info) => {
    if (info.tabId) void handlePanelOpened(info.tabId);
  });
}

if (modernSidePanel.onClosed) {
  modernSidePanel.onClosed.addListener((info) => {
    if (info.tabId) void handlePanelClosed(info.tabId);
  });
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
    void isTabPanelActivated(message.tabId).then((active) => {
      if (active) {
        panelHeartbeats.set(message.tabId, Date.now());
        openPanelTabs.add(message.tabId);
      } else {
        panelHeartbeats.delete(message.tabId);
        openPanelTabs.delete(message.tabId);
      }
      sendResponse({ active });
    });
    return true;
  }

  if (message.type === "DOM_AI_PANEL_CLOSED") {
    void handlePanelClosed(message.tabId).then(() => {
      sendResponse({ active: false });
    });
    return true;
  }

  if (message.type === "DOM_AI_GET_PANEL_STATE") {
    const tabId = message.tabId ?? sender.tab?.id ?? 0;
    void isTabPanelActivated(tabId).then((active) => sendResponse({ active }));
    return true;
  }
});

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function resetAllTabsSidePanel() {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  await clearPanelActivations();
  openPanelTabs.clear();
  panelHeartbeats.clear();
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map((tab) => (tab.id ? prepareTabSidePanel(tab.id, tab.url) : Promise.resolve(false))));
}

async function prepareTabSidePanel(tabId: number, url?: string) {
  await chrome.action.disable(tabId);
  const enabled = await configureTabSidePanel(tabId, url);
  if (enabled) await chrome.action.enable(tabId);
  return enabled;
}

async function configureTabSidePanel(tabId: number, url?: string): Promise<boolean> {
  const resolvedUrl = url ?? (await chrome.tabs.get(tabId).catch(() => undefined))?.url ?? "";
  const enabled = !isExcludedUrl(resolvedUrl);

  if (!enabled) {
    await chrome.sidePanel.setOptions({ tabId, enabled: false }).catch(() => undefined);
    return false;
  }

  await chrome.sidePanel.setOptions({
    tabId,
    path: "src/sidepanel/index.html",
    enabled: true
  });
  return true;
}

async function deactivateTabSidePanel(tabId: number) {
  openPanelTabs.delete(tabId);
  panelHeartbeats.delete(tabId);
  await removePanelActivation(tabId);
}

async function markTabPanelActivated(tabId: number) {
  await chrome.storage.session.set({ [panelActivationKey(tabId)]: true });
}

function isTabPanelOpen(tabId: number) {
  if (openPanelTabs.has(tabId)) return true;
  const lastSeen = panelHeartbeats.get(tabId) ?? 0;
  return Date.now() - lastSeen <= PANEL_HEARTBEAT_TIMEOUT_MS;
}

function closeTabSidePanel(tabId: number, windowId?: number) {
  openPanelTabs.delete(tabId);
  panelHeartbeats.delete(tabId);

  if (modernSidePanel.close) {
    void modernSidePanel.close({ tabId })
      .catch(async (error) => {
        if (windowId === undefined || !modernSidePanel.close) throw error;
        await modernSidePanel.close({ windowId });
      })
      .then(() => handlePanelClosed(tabId))
      .catch(() => {
        openPanelTabs.add(tabId);
        panelHeartbeats.set(tabId, Date.now());
      });
    return;
  }

  // Chrome <141 fallback: disabling an open tab-specific panel closes it.
  void chrome.sidePanel.setOptions({ tabId, enabled: false }).then(() => (
    configureTabSidePanel(tabId)
  )).then(() => handlePanelClosed(tabId)).catch(() => {
    openPanelTabs.add(tabId);
    panelHeartbeats.set(tabId, Date.now());
  });
}

async function handlePanelOpened(tabId: number) {
  openPanelTabs.add(tabId);
  panelHeartbeats.set(tabId, Date.now());
  await markTabPanelActivated(tabId);
  await sendContentMessage(tabId, { type: "DOM_AI_REFRESH_PINS" }).catch(() => undefined);
}

async function handlePanelClosed(tabId: number) {
  await Promise.all([
    hideTabContentUi(tabId),
    deactivateTabSidePanel(tabId),
    clearDebugEvents(tabId)
  ]);
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

function panelActivationKey(tabId: number) {
  return `${PANEL_ACTIVATION_PREFIX}${tabId}`;
}

async function isTabPanelActivated(tabId: number) {
  if (!tabId) return false;
  const key = panelActivationKey(tabId);
  const data = await chrome.storage.session.get(key);
  return data[key] === true;
}

async function removePanelActivation(tabId: number) {
  if (!tabId) return;
  await chrome.storage.session.remove(panelActivationKey(tabId));
}

async function transferPanelActivation(removedTabId: number, addedTabId: number) {
  const active = await isTabPanelActivated(removedTabId);
  await removePanelActivation(removedTabId);
  openPanelTabs.delete(removedTabId);
  panelHeartbeats.delete(removedTabId);
  const tab = await chrome.tabs.get(addedTabId).catch(() => undefined);
  await prepareTabSidePanel(addedTabId, tab?.url);
  if (active) await markTabPanelActivated(addedTabId);
}

async function clearPanelActivations() {
  const data = await chrome.storage.session.get(null);
  const keys = Object.keys(data).filter((key) => key.startsWith(PANEL_ACTIVATION_PREFIX));
  if (keys.length) await chrome.storage.session.remove(keys);
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
  if (!tabId) return false;
  if (!await isTabPanelActivated(tabId)) return false;
  const lastSeen = panelHeartbeats.get(tabId) ?? 0;
  if (Date.now() - lastSeen <= PANEL_HEARTBEAT_TIMEOUT_MS) return true;
  panelHeartbeats.delete(tabId);
  return false;
}
