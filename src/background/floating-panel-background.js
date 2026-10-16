/* Native menu routing only. Selected content stays inside its source tab. */
(() => {
  "use strict";
  const MENU_ID = "cdc:pin-floating-panel";
  const DIAGRAM_MENU_ID = "cdc:pin-svg-diagram";
  const settings = globalThis.ChatDirectionSettings;
  // Keep old test harnesses / unsupported environments usable without this API.
  if (!chrome.contextMenus) return;

  const patterns = chrome.runtime.getManifest().content_scripts.flatMap(script => script.matches);
  const properties = { title: "Pin to floating panel", contexts: ["selection", "page"],
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
      // Image contexts are separate so other chatbots keep text/math-only menus.
      const diagramMenu = { title: "Pin diagram to floating panel", contexts: ["image"],
        documentUrlPatterns: ["https://chatgpt.com/*"],
        visible: available.includes("https://chatgpt.com/*") };
      try {
        await chrome.contextMenus.update(DIAGRAM_MENU_ID, diagramMenu);
      } catch {
        await new Promise(resolve => chrome.contextMenus.create({ id: DIAGRAM_MENU_ID, ...diagramMenu }, () => {
          if (chrome.runtime.lastError) console.debug("Diagram menu:", chrome.runtime.lastError.message);
          resolve();
        }));
      }
    });
  }
  settings.subscribe(syncMenu);
  syncMenu();

  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    const diagram = info.menuItemId === DIAGRAM_MENU_ID;
    if ((!diagram && info.menuItemId !== MENU_ID) || !Number.isInteger(tab?.id) || info.editable ||
        (diagram ? info.mediaType !== "image" || !/^data:image\/svg\+xml[;,]/i.test(info.srcUrl || "") : info.mediaType) ||
        (info.frameId != null && info.frameId !== 0)) return;
    try {
      const source = new URL(info.pageUrl);
      const site = ChatDirectionControl.getCurrentSiteAdapter(source);
      await settings.ready;
      if (source.protocol !== "https:" || !site || !settings.enabled(site.id, "floatingPanel")) return;
      if (diagram && site.id !== "chatgpt") return;
      await chrome.tabs.sendMessage(tab.id, { type: MENU_ID, ...(diagram ? { diagram: true } : {}) }, { frameId: 0 });
    } catch (error) {
      // Existing tabs need one refresh after loading/reloading the extension.
      console.debug("Floating panel could not reach this tab; refresh it:", error);
    }
  });
})();
