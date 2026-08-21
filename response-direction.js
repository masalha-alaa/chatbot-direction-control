(() => {
  "use strict";

  const TOOLBAR_CLASS = "cgpt-direction-toolbar";
  const RTL_CLASS = "cgpt-force-rtl";
  const LTR_CLASS = "cgpt-force-ltr";
  const USER_TARGET_CLASS = "cgpt-user-direction-target";
  const GEMINI_TARGET_CLASS = "cgpt-gemini-direction-target";
  const isGemini = location.hostname === "gemini.google.com";
  let timer = null;

  function conversationKey() {
    return `${location.origin}${location.pathname}`;
  }

  function getRole(node) {
    const chatGptRole = node.getAttribute?.("data-message-author-role");
    if (chatGptRole === "assistant" || chatGptRole === "user") return chatGptRole;

    if (node.matches?.('user-query, .user-query, [data-message-author="user"]')) {
      return "user";
    }

    if (node.matches?.('model-response, .model-response-container, [data-message-author="assistant"]')) {
      return "assistant";
    }

    return null;
  }

  function getMessages() {
    if (!isGemini) {
      return [...document.querySelectorAll(
        '[data-message-author-role="assistant"], [data-message-author-role="user"]'
      )];
    }

    const primary = [...document.querySelectorAll("user-query, model-response")];
    if (primary.length) return primary;

    return [...document.querySelectorAll(
      '.user-query, [data-message-author="user"], .model-response-container, [data-message-author="assistant"]'
    )];
  }

  function getTurn(node) {
    if (!isGemini) {
      return node.closest("article")
        || node.closest('[data-testid^="conversation-turn-"]')
        || node.parentElement;
    }

    return node.closest(
      ".user-query-container, .model-response-container, .response-container, user-query, model-response"
    ) || node.parentElement;
  }

  function getMessageId(node, turn) {
    const idNode =
      node.closest?.("[data-message-id]")
      || node.querySelector?.("[data-message-id]")
      || turn?.querySelector?.("[data-message-id]");

    const messageId = idNode?.getAttribute?.("data-message-id");
    if (messageId) return `message:${messageId}`;

    const testId = turn?.getAttribute?.("data-testid")
      || node.getAttribute?.("data-testid")
      || node.getAttribute?.("data-test-id");
    if (testId) return `turn:${testId}`;

    if (node.id) return `id:${node.id}`;

    const role = getRole(node) || "message";
    const sameRoleMessages = getMessages().filter((message) => getRole(message) === role);
    return `${role}:index:${Math.max(0, sameRoleMessages.indexOf(node))}`;
  }

  function storageKey(messageId) {
    return `cgpt-direction|${conversationKey()}|${messageId}`;
  }

  function findChatGptActionBar(turn) {
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

  function findGeminiActionBar(turn) {
    if (!turn) return null;

    const actionSelector = [
      'button[aria-label*="Copy" i]',
      'button[aria-label*="Edit" i]',
      'button[aria-label*="More" i]',
      'button[aria-label*="option" i]',
      'button[aria-label*="Redo" i]',
      'button[aria-label*="Retry" i]',
      'button[aria-label*="Good" i]',
      'button[aria-label*="Bad" i]'
    ].join(",");

    const scopes = [turn, turn.parentElement, turn.parentElement?.parentElement]
      .filter(Boolean);

    for (const scope of scopes) {
      // Do not climb into the full conversation history, where we could pick
      // another turn's action bar.
      if (scope.matches?.("infinite-scroller, .chat-history")) break;

      const button = scope.querySelector?.(actionSelector);
      if (!button) continue;

      const bar = button.closest?.(
        ".buttons-container, .response-actions, .actions-container, [class*='action-buttons'], [class*='buttons-container']"
      ) || button.parentElement;

      if (bar) return bar;
    }

    return null;
  }

  function findActionBar(turn) {
    return isGemini
      ? findGeminiActionBar(turn)
      : findChatGptActionBar(turn);
  }

  function getChatGptUserTextTarget(node) {
    const target =
      node.querySelector(".whitespace-pre-wrap")
      || node.querySelector('[class*="whitespace-pre-wrap"]')
      || node.querySelector(".markdown");

    return target instanceof HTMLElement ? target : null;
  }

  function getGeminiTextTarget(node) {
    const role = getRole(node);

    const target = role === "user"
      ? (
          node.querySelector(".query-text")
          || node.querySelector('[class*="query-text"]')
          || node.querySelector(".query-content")
        )
      : (
          node.querySelector("message-content")
          || node.querySelector(".model-response-text")
          || node.querySelector(".response-content")
          || node.querySelector(".markdown-main-panel")
          || node.querySelector(".markdown")
        );

    return target instanceof HTMLElement ? target : null;
  }

  function applyModeClasses(node, mode) {
    // Remove direction from message containers themselves. User bubbles must
    // stay exactly where the host UI places them.
    node.classList.remove(RTL_CLASS, LTR_CLASS);

    for (const oldTarget of node.querySelectorAll(
      `.${USER_TARGET_CLASS}, .${GEMINI_TARGET_CLASS}`
    )) {
      oldTarget.classList.remove(
        RTL_CLASS,
        LTR_CLASS,
        USER_TARGET_CLASS,
        GEMINI_TARGET_CLASS
      );
    }

    if (!isGemini) {
      const role = getRole(node);

      if (role === "assistant") {
        if (mode === "rtl") node.classList.add(RTL_CLASS);
        if (mode === "ltr") node.classList.add(LTR_CLASS);
        return;
      }

      const target = getChatGptUserTextTarget(node);
      if (!target) return;

      target.classList.add(USER_TARGET_CLASS);
      if (mode === "rtl") target.classList.add(RTL_CLASS);
      if (mode === "ltr") target.classList.add(LTR_CLASS);
      return;
    }

    const target = getGeminiTextTarget(node);
    if (!target) return;

    target.classList.add(GEMINI_TARGET_CLASS);
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
    if (!getRole(node)) return;

    const turn = getTurn(node);
    if (!turn) return;

    // The native action bar is also our completion signal. In particular,
    // Gemini and ChatGPT do not expose their final action controls until the
    // generated response is ready.
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
    toolbar.dataset.host = isGemini ? "gemini" : "chatgpt";
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
    getMessages().forEach(inject);
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

  // Safety net for host-framework updates after streaming/rendering finishes.
  setInterval(process, 750);
})();
