/* Native menu routing only. Selected content stays inside its source tab. */
(() => {
  "use strict";
  const MENU_ID = "cdc:pin-floating-panel";
  const settings = globalThis.ChatDirectionSettings;
  // Keep old test harnesses / unsupported environments usable without this API.
  if (!chrome.contextMenus) return;

  const patterns = chrome.runtime.getManifest().content_scripts.flatMap(script => script.matches);
  const properties = { title: "Pin to floating panel", contexts: ["selection", "image", "page"],
    documentUrlPatterns: patterns };
  let updates = Promise.resolve();

  // Menu entries survive worker suspension. Update first; create only if absent.
  // Serialize settings changes so an older update cannot win over a newer one.
  function syncMenu() {
    updates = updates.catch(() => {}).then(async () => {
      await settings.ready;
      const available = patterns.filter(pattern => {
        const site = ChatDirectionControl.getCurrentSiteAdapter(new URL(pattern.replace(/\*.*$/, "")));
        return site && settings.enabled(site.id, "floatingPanel");
      });
      const next = { ...properties, visible: available.length > 0,
        documentUrlPatterns: available.length ? available : patterns };
      try {
        await chrome.contextMenus.update(MENU_ID, next);
      } catch {
        await new Promise(resolve => chrome.contextMenus.create({ id: MENU_ID, ...next }, () => {
          if (chrome.runtime.lastError) console.debug("Floating panel menu:", chrome.runtime.lastError.message);
          resolve();
        }));
      }
    });
  }
  settings.subscribe(syncMenu);
  syncMenu();

  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== MENU_ID || !Number.isInteger(tab?.id) || info.editable ||
        (info.frameId != null && info.frameId !== 0)) return;
    try {
      const source = new URL(info.pageUrl);
      const site = ChatDirectionControl.getCurrentSiteAdapter(source);
      await settings.ready;
      if (source.protocol !== "https:" || !site || !settings.enabled(site.id, "floatingPanel")) return;
      await chrome.tabs.sendMessage(tab.id, { type: MENU_ID }, { frameId: 0 });
    } catch (error) {
      // Existing tabs need one refresh after loading/reloading the extension.
      console.debug("Floating panel could not reach this tab; refresh it:", error);
    }
  });
})();
