(() => {
  "use strict";

  /**
   * Opt-in middle-click handling; all site selectors live in adapters.
   * Permanent page listeners check cached master + middleClick settings on both
   * press and release. Disabled events retain their normal browser behavior.
   * The worker independently checks its settings before actually opening a tab.
   */
  const site = globalThis.ChatDirectionControl?.getCurrentSiteAdapter();
  if (typeof site?.getSidebarConversationLink !== "function" ||
      typeof site?.isSidebarConversationUrl !== "function") return;

  const settings = globalThis.ChatDirectionSettings;
  const enabled = () => settings.enabled(site.id, "middleClick");
  const MIDDLE_BUTTON = 1;
  let pressedLink = null;
  // A preference change cancels a press, even if re-enabled before release.
  settings.subscribe(() => { pressedLink = null; });

  function isPlainMiddleClick(event) {
    return event.isTrusted && event.button === MIDDLE_BUTTON &&
      !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
  }

  function getLink(event) {
    const link = site.getSidebarConversationLink(event.target);
    if (!link) return null;
    try {
      const url = new URL(link.url);
      return url.origin === location.origin && site.isSidebarConversationUrl(url)
        ? link : null;
    } catch {
      return null;
    }
  }

  function consume(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  // Cancel Windows autoscroll at press time, but only over an eligible row.
  // Capturing on window runs before the host's delegated document handlers.
  window.addEventListener("mousedown", (event) => {
    pressedLink = null;
    if (!enabled() || !isPlainMiddleClick(event) || event.defaultPrevented) return;
    pressedLink = getLink(event);
    if (pressedLink) consume(event);
  }, true);

  // Open once on release, and only if the same row and URL are still under
  // the pointer. Re-rendered/recycled rows and release elsewhere cancel it.
  window.addEventListener("auxclick", (event) => {
    const pressed = pressedLink;
    pressedLink = null;
    if (!enabled() || !pressed || !isPlainMiddleClick(event) || event.defaultPrevented) return;
    const released = getLink(event);
    if (!released || released.element !== pressed.element || released.url !== pressed.url) return;
    consume(event);
    try {
      chrome.runtime.sendMessage({ type: "cdc:open-sidebar-tab", url: released.url })
        .then((result) => {
          if (!result?.ok) console.debug("Direction extension: could not open sidebar tab.");
        })
        .catch(() => console.debug("Direction extension: reload this page after reloading the extension."));
    } catch {
      console.debug("Direction extension: reload this page after reloading the extension.");
    }
  }, true);

  for (const eventName of ["blur", "pagehide", "dragstart", "pointercancel"]) {
    window.addEventListener(eventName, () => { pressedLink = null; }, true);
  }
})();
