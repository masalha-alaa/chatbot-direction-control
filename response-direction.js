(() => {
  "use strict";

  const TOOLBAR_CLASS = "cgpt-direction-toolbar";
  const RTL_CLASS = "cgpt-force-rtl";
  const LTR_CLASS = "cgpt-force-ltr";
  const USER_TARGET_CLASS = "cgpt-user-direction-target";
  const MESSAGE_SELECTOR = '[data-message-author-role="assistant"], [data-message-author-role="user"]';
  let timer = null;

  function conversationKey() {
    return `${location.origin}${location.pathname}`;
  }

  function getTurn(node) {
    return node.closest("article")
      || node.closest('[data-testid^="conversation-turn-"]')
      || node.parentElement;
  }

  function getMessageId(node, turn) {
    const idNode =
      node.closest("[data-message-id]")
      || node.querySelector("[data-message-id]")
      || turn?.querySelector?.("[data-message-id]");

    const messageId = idNode?.getAttribute?.("data-message-id");
    if (messageId) return `message:${messageId}`;

    const testId = turn?.getAttribute?.("data-testid")
      || node.getAttribute?.("data-testid");
    if (testId) return `turn:${testId}`;

    const role = node.getAttribute("data-message-author-role") || "message";
    const sameRoleMessages = [...document.querySelectorAll(`[data-message-author-role="${role}"]`)];
    return `${role}:index:${Math.max(0, sameRoleMessages.indexOf(node))}`;
  }

  function storageKey(messageId) {
    return `cgpt-direction|${conversationKey()}|${messageId}`;
  }

  function findActionBar(turn) {
    if (!turn) return null;

    const actionButton =
      turn.querySelector('[data-testid="copy-turn-action-button"]')
      || turn.querySelector('button[data-testid*="turn-action"]')
      || turn.querySelector('button[data-testid*="copy"]')
      || turn.querySelector('button[data-testid*="edit"]');

    if (!actionButton) return null;

    let bar = actionButton.parentElement;

    if (bar && bar.querySelectorAll("button").length <= 1) {
      const parent = bar.parentElement;
      if (parent && parent.querySelectorAll("button").length >= 1) {
        bar = parent;
      }
    }

    return bar;
  }

  function getUserTextTarget(node) {
    const target =
      node.querySelector(".whitespace-pre-wrap")
      || node.querySelector('[class*="whitespace-pre-wrap"]')
      || node.querySelector(".markdown");

    return target instanceof HTMLElement ? target : null;
  }

  function applyModeClasses(node, mode) {
    const isUser = node.getAttribute("data-message-author-role") === "user";

    // Clean up the old implementation, which put direction classes on the
    // whole user-message container and could move the bubble itself.
    node.classList.remove(RTL_CLASS, LTR_CLASS);

    const turn = getTurn(node);
    turn?.querySelectorAll(".cgpt-user-actions-ltr, .cgpt-user-actions-rtl")
      .forEach((element) => {
        element.classList.remove("cgpt-user-actions-ltr", "cgpt-user-actions-rtl");
      });

    if (!isUser) {
      if (mode === "rtl") node.classList.add(RTL_CLASS);
      if (mode === "ltr") node.classList.add(LTR_CLASS);
      return;
    }

    for (const oldTarget of node.querySelectorAll(`.${USER_TARGET_CLASS}`)) {
      oldTarget.classList.remove(RTL_CLASS, LTR_CLASS, USER_TARGET_CLASS);
    }

    const target = getUserTextTarget(node);
    if (!target) return;

    target.classList.add(USER_TARGET_CLASS);
    if (mode === "rtl") target.classList.add(RTL_CLASS);
    if (mode === "ltr") target.classList.add(LTR_CLASS);
  }

  function setMode(node, mode) {
    applyModeClasses(node, mode);

    if (mode === "rtl" || mode === "ltr") {
      node.dataset.cgptDirection = mode;
    } else {
      delete node.dataset.cgptDirection;
    }

    const turn = getTurn(node);
    const toolbar = turn?.querySelector(`.${TOOLBAR_CLASS}`);
    if (!toolbar) return;

    for (const button of toolbar.querySelectorAll(".cgpt-direction-button")) {
      const active = button.dataset.mode === mode;
      button.classList.toggle("cgpt-direction-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  }

  function icon(side) {
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

  function makeButton(mode, node, messageId) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cgpt-direction-button";
    button.dataset.mode = mode;
    button.setAttribute("aria-pressed", "false");

    if (mode === "rtl") {
      button.title = "RTL + right align";
      button.setAttribute("aria-label", "Right-to-left + right align");
      button.innerHTML = icon("right");
    } else {
      button.title = "LTR + left align";
      button.setAttribute("aria-label", "Left-to-right + left align");
      button.innerHTML = icon("left");
    }

    button.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const current = node.dataset.cgptDirection;
      const next = current === mode ? null : mode;
      setMode(node, next);

      try {
        const key = storageKey(messageId);
        if (next) await chrome.storage.local.set({ [key]: next });
        else await chrome.storage.local.remove(key);
      } catch (err) {
        console.debug("Direction extension storage error:", err);
      }
    });

    return button;
  }

  async function inject(node) {
    if (!(node instanceof HTMLElement)) return;

    const turn = getTurn(node);
    if (!turn) return;

    const actionBar = findActionBar(turn);
    if (!actionBar) return;

    const existing = turn.querySelector(`.${TOOLBAR_CLASS}`);
    if (existing) {
      if (existing.parentElement === actionBar) {
        const current = node.dataset.cgptDirection;
        if (current === "rtl" || current === "ltr") {
          applyModeClasses(node, current);
        }
        return;
      }
      existing.remove();
    }

    const messageId = getMessageId(node, turn);
    const toolbar = document.createElement("span");
    toolbar.className = TOOLBAR_CLASS;
    toolbar.setAttribute("role", "group");
    toolbar.setAttribute("aria-label", "Message text direction");

    toolbar.appendChild(makeButton("ltr", node, messageId));
    toolbar.appendChild(makeButton("rtl", node, messageId));
    actionBar.appendChild(toolbar);

    try {
      const key = storageKey(messageId);
      const saved = await chrome.storage.local.get(key);
      const mode = saved[key];
      if (mode === "rtl" || mode === "ltr") setMode(node, mode);
    } catch (err) {
      console.debug("Direction extension storage error:", err);
    }
  }

  function process() {
    document
      .querySelectorAll(MESSAGE_SELECTOR)
      .forEach(inject);
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(process, 100);
  }

  process();

  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  setInterval(process, 750);
})();
