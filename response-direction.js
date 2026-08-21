(() => {
  "use strict";

  const TOOLBAR_CLASS = "cgpt-direction-toolbar";
  const RTL_CLASS = "cgpt-force-rtl";
  const LTR_CLASS = "cgpt-force-ltr";
  let timer = null;

  function conversationKey() {
    return `${location.origin}${location.pathname}`;
  }

  function getTurn(node) {
    return node.closest("article")
      || node.closest('[data-testid^="conversation-turn-"]')
      || node.parentElement;
  }

  function getResponseId(node, turn) {
    const idNode =
      node.closest("[data-message-id]")
      || node.querySelector("[data-message-id]")
      || turn?.querySelector?.("[data-message-id]");

    const messageId = idNode?.getAttribute?.("data-message-id");
    if (messageId) return `message:${messageId}`;

    const testId = turn?.getAttribute?.("data-testid")
      || node.getAttribute?.("data-testid");
    if (testId) return `turn:${testId}`;

    const all = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
    return `index:${Math.max(0, all.indexOf(node))}`;
  }

  function storageKey(responseId) {
    return `cgpt-direction|${conversationKey()}|${responseId}`;
  }

  function findActionBar(turn) {
    if (!turn) return null;

    const actionButton =
      turn.querySelector('[data-testid="copy-turn-action-button"]')
      || turn.querySelector('button[data-testid*="turn-action"]');

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

  function setMode(node, mode) {
    node.classList.remove(RTL_CLASS, LTR_CLASS);

    if (mode === "rtl") {
      node.classList.add(RTL_CLASS);
      node.dataset.cgptDirection = "rtl";
    } else if (mode === "ltr") {
      node.classList.add(LTR_CLASS);
      node.dataset.cgptDirection = "ltr";
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

  function makeButton(mode, node, responseId) {
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
        const key = storageKey(responseId);
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

    /*
      Do not inject during "Thinking..." / streaming.
      The final response action bar is our signal that ChatGPT has finished
      rendering the answer.
    */
    const actionBar = findActionBar(turn);
    if (!actionBar) return;

    /*
      ChatGPT/React may replace the action bar when generation finishes.
      If an old toolbar exists somewhere else in the turn, move to the current
      final action bar by recreating it.
    */
    const existing = turn.querySelector(`.${TOOLBAR_CLASS}`);
    if (existing) {
      if (existing.parentElement === actionBar) return;
      existing.remove();
    }

    const responseId = getResponseId(node, turn);
    const toolbar = document.createElement("span");
    toolbar.className = TOOLBAR_CLASS;
    toolbar.setAttribute("role", "group");
    toolbar.setAttribute("aria-label", "Response text direction");

    toolbar.appendChild(makeButton("ltr", node, responseId));
    toolbar.appendChild(makeButton("rtl", node, responseId));
    actionBar.appendChild(toolbar);

    try {
      const key = storageKey(responseId);
      const saved = await chrome.storage.local.get(key);
      const mode = saved[key];
      if (mode === "rtl" || mode === "ltr") setMode(node, mode);
    } catch (err) {
      console.debug("Direction extension storage error:", err);
    }
  }

  function process() {
    document
      .querySelectorAll('[data-message-author-role="assistant"]')
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

  // Safety net for React updates after streaming finishes.
  setInterval(process, 750);
})();
