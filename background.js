"use strict";

// Adapters register without touching the DOM until a DOM hook is called.
// Reuse their pure URL policies so the tab service contains no host checks.
importScripts(
  "settings.js",
  "site-adapter-registry.js",
  "adapters/chatgpt.js",
  "adapters/gemini.js",
  "adapters/claude.js",
  "adapters/grok.js"
);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "cdc:open-sidebar-tab") return;

  // Accept only our top-level content script, from an opted-in site, and only
  // a same-origin conversation URL approved by that site's adapter.
  try {
    if (sender.id !== chrome.runtime.id || sender.frameId !== 0 ||
        !Number.isInteger(sender.tab?.id) || sender.tab.id < 0 ||
        !Number.isInteger(sender.tab.windowId) || sender.tab.windowId < 0 ||
        typeof message.url !== "string") throw new Error("Invalid sender");
    const source = new URL(sender.url);
    const destination = new URL(message.url);
    const site = globalThis.ChatDirectionControl.getCurrentSiteAdapter(source);
    if (source.protocol !== "https:" || source.origin !== destination.origin ||
        !site?.isSidebarConversationUrl?.(destination)) throw new Error("Invalid destination");

    // tabs.create does not require the broad "tabs" permission. active:false
    // keeps both the original tab's navigation and the user's focus unchanged.
    const settings = globalThis.ChatDirectionSettings;
    settings.ready.then(async () => {
      if (!settings.enabled(site.id, "middleClick")) {
        sendResponse({ ok: false });
        return;
      }
      try {
        await chrome.tabs.create({
          url: destination.href,
          active: false,
          windowId: sender.tab.windowId,
          openerTabId: sender.tab.id
        });
        sendResponse({ ok: true });
      } catch {
        sendResponse({ ok: false });
      }
    });
    return true; // Keep the message channel alive until tab creation finishes.
  } catch {
    sendResponse({ ok: false });
    return false;
  }
});
