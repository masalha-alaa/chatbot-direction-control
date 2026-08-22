(() => {
  "use strict";

  /**
   * Generic per-message direction controller.
   *
   * This file owns storage, buttons, persistence and DOM observation. It knows
   * nothing about chatbot-specific selectors; those live in adapter files.
   */

  const extensionApi = globalThis.ChatDirectionControl;
  const site = extensionApi?.getCurrentSiteAdapter?.();
  if (!site) return;

  const TOOLBAR_CLASS = "cgpt-direction-toolbar";
  const BUTTON_CLASS = "cgpt-direction-button";
  const ACTIVE_BUTTON_CLASS = "cgpt-direction-active";
  const DIRECTION_TARGET_CLASS = "cgpt-direction-target";
  const RTL_CLASS = "cgpt-force-rtl";
  const LTR_CLASS = "cgpt-force-ltr";

  const DIRECTION_LTR = "ltr";
  const DIRECTION_RTL = "rtl";
  const STORAGE_PREFIX = "cgpt-direction";

  // Debounce rapid framework mutations, then periodically rescan as a safety
  // net for action bars replaced asynchronously after streaming completes.
  const MUTATION_DEBOUNCE_MS = 100;
  const SAFETY_RESCAN_INTERVAL_MS = 750;

  let scheduledScan = null;

  function conversationKey() {
    return `${location.origin}${location.pathname}`;
  }

  function getTestId(element) {
    return (
      element?.getAttribute?.("data-testid") ||
      element?.getAttribute?.("data-test-id") ||
      null
    );
  }

  function isUniqueTestIdForRole(testId, role) {
    if (!testId) return false;

    let matches = 0;
    for (const candidate of site.getMessages()) {
      if (site.getRole(candidate) !== role) continue;

      const candidateTurn = site.getTurn(candidate);
      const candidateTestId = getTestId(candidateTurn) || getTestId(candidate);
      if (candidateTestId !== testId) continue;

      matches += 1;
      if (matches > 1) return false;
    }

    return matches === 1;
  }

  function getMessageId(message, turn) {
    // A host with its own stable turn identity can provide it without leaking
    // that host's DOM details into this generic controller.
    const adapterMessageId = site.getMessageStorageId?.(message, turn);
    if (adapterMessageId) return `site:${adapterMessageId}`;

    const idNode =
      message.closest?.("[data-message-id]") ||
      message.querySelector?.("[data-message-id]") ||
      turn?.querySelector?.("[data-message-id]");

    const messageId = idNode?.getAttribute?.("data-message-id");
    if (messageId) return `message:${messageId}`;

    const role = site.getRole(message) || "message";
    const testId = getTestId(turn) || getTestId(message);

    // Some hosts reuse one semantic testid for every message (for example,
    // Claude uses data-testid="user-message"). Such values are not safe
    // persistence keys, so use a testid only when it is unique for this role.
    if (isUniqueTestIdForRole(testId, role)) return `turn:${testId}`;

    if (message.id) return `id:${message.id}`;

    // Last-resort ID for hosts that expose no stable message identifier.
    // It remains deterministic within the current conversation ordering.
    const sameRoleMessages = site
      .getMessages()
      .filter((candidate) => site.getRole(candidate) === role);
    return `${role}:index:${Math.max(0, sameRoleMessages.indexOf(message))}`;
  }

  function storageKey(messageId) {
    return `${STORAGE_PREFIX}|${conversationKey()}|${messageId}`;
  }

  function clearDirectionClasses(message) {
    message.classList.remove(
      DIRECTION_TARGET_CLASS,
      RTL_CLASS,
      LTR_CLASS
    );

    for (const target of message.querySelectorAll(`.${DIRECTION_TARGET_CLASS}`)) {
      target.classList.remove(
        DIRECTION_TARGET_CLASS,
        RTL_CLASS,
        LTR_CLASS
      );
    }
  }

  function applyModeClasses(message, mode) {
    clearDirectionClasses(message);

    const role = site.getRole(message);
    if (!role) return;

    const target = site.getDirectionTarget(message, role);
    if (!(target instanceof HTMLElement)) return;

    target.classList.add(DIRECTION_TARGET_CLASS);
    if (mode === DIRECTION_RTL) target.classList.add(RTL_CLASS);
    if (mode === DIRECTION_LTR) target.classList.add(LTR_CLASS);
  }

  function findToolbar(message) {
    const role = site.getRole(message);
    const turn = site.getTurn(message);
    const actionBar = site.findActionBar(turn, role);

    return (
      actionBar?.querySelector(`.${TOOLBAR_CLASS}`) ||
      turn?.querySelector?.(`.${TOOLBAR_CLASS}`) ||
      null
    );
  }

  function setMode(message, mode) {
    applyModeClasses(message, mode);

    if (mode === DIRECTION_RTL || mode === DIRECTION_LTR) {
      message.dataset.cgptDirection = mode;
    } else {
      delete message.dataset.cgptDirection;
    }

    const toolbar = findToolbar(message);
    if (!toolbar) return;

    for (const button of toolbar.querySelectorAll(`.${BUTTON_CLASS}`)) {
      const active = button.dataset.mode === mode;
      button.classList.toggle(ACTIVE_BUTTON_CLASS, active);
      button.setAttribute("aria-pressed", String(active));
    }
  }

  function alignmentIcon(side) {
    // SVG path coordinates are icon geometry, not layout/behavior constants.
    return side === "left"
      ? `<svg viewBox="0 0 20 20" aria-hidden="true">
           <path d="M3 4.5h14M3 8h10M3 11.5h14M3 15h8"
             fill="none" stroke="currentColor" stroke-width="1.5"
             stroke-linecap="round"/>
         </svg>`
      : `<svg viewBox="0 0 20 20" aria-hidden="true">
           <path d="M3 4.5h14M7 8h10M3 11.5h14M9 15h8"
             fill="none" stroke="currentColor" stroke-width="1.5"
             stroke-linecap="round"/>
         </svg>`;
  }

  function createDirectionButton(mode, message, messageId) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = BUTTON_CLASS;
    button.dataset.mode = mode;
    button.setAttribute("aria-pressed", "false");

    if (mode === DIRECTION_RTL) {
      button.title = "RTL + right align";
      button.setAttribute("aria-label", "Right-to-left + right align");
      button.innerHTML = alignmentIcon("right");
    } else {
      button.title = "LTR + left align";
      button.setAttribute("aria-label", "Left-to-right + left align");
      button.innerHTML = alignmentIcon("left");
    }

    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();

      const currentMode = message.dataset.cgptDirection;
      const nextMode = currentMode === mode ? null : mode;
      setMode(message, nextMode);

      try {
        const key = storageKey(messageId);
        if (nextMode) {
          await chrome.storage.local.set({ [key]: nextMode });
        } else {
          await chrome.storage.local.remove(key);
        }
      } catch (error) {
        console.debug("Direction extension storage error:", error);
      }
    });

    return button;
  }

  function configureToolbar(message, turn, role, actionBar, toolbar) {
    site.configureToolbar?.({
      message,
      turn,
      role,
      actionBar,
      toolbar
    });
  }

  async function injectToolbar(message) {
    if (!(message instanceof HTMLElement)) return;

    const role = site.getRole(message);
    if (!role) return;

    const turn = site.getTurn(message);
    if (!turn) return;

    // Native action controls are the completion signal for generated replies.
    // Waiting for them prevents buttons from appearing during "Thinking...".
    const actionBar = site.findActionBar(turn, role);
    if (!actionBar) return;

    const existingToolbar = actionBar.querySelector(`.${TOOLBAR_CLASS}`);
    if (existingToolbar) {
      configureToolbar(message, turn, role, actionBar, existingToolbar);

      const currentMode = message.dataset.cgptDirection;
      if (currentMode === DIRECTION_RTL || currentMode === DIRECTION_LTR) {
        applyModeClasses(message, currentMode);
      }
      return;
    }

    // React/Angular may replace an action bar after render. Remove only stale
    // extension toolbars belonging to this same turn before inserting again.
    turn
      .querySelectorAll?.(`.${TOOLBAR_CLASS}`)
      .forEach((toolbar) => toolbar.remove());

    const messageId = getMessageId(message, turn);
    const toolbar = document.createElement("span");
    toolbar.className = TOOLBAR_CLASS;
    toolbar.dataset.site = site.id;
    toolbar.setAttribute("role", "group");
    toolbar.setAttribute("aria-label", "Message text direction");

    toolbar.appendChild(createDirectionButton(DIRECTION_LTR, message, messageId));
    toolbar.appendChild(createDirectionButton(DIRECTION_RTL, message, messageId));
    actionBar.appendChild(toolbar);
    configureToolbar(message, turn, role, actionBar, toolbar);

    try {
      const key = storageKey(messageId);
      const saved = await chrome.storage.local.get(key);
      const savedMode = saved[key];
      if (savedMode === DIRECTION_RTL || savedMode === DIRECTION_LTR) {
        setMode(message, savedMode);
      }
    } catch (error) {
      console.debug("Direction extension storage error:", error);
    }
  }

  function scanMessages() {
    site.getMessages().forEach(injectToolbar);
  }

  function scheduleScan() {
    clearTimeout(scheduledScan);
    scheduledScan = setTimeout(scanMessages, MUTATION_DEBOUNCE_MS);
  }

  scanMessages();

  new MutationObserver(scheduleScan).observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  setInterval(scanMessages, SAFETY_RESCAN_INTERVAL_MS);
})();
