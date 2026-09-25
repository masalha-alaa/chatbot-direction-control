(() => {
  "use strict";

  /** ChatGPT DOM adapter. Keep all ChatGPT-specific selectors in this file. */

  const api = globalThis.ChatDirectionControl;
  if (!api) return;

  const { ROLE_USER, ROLE_ASSISTANT } = api;
  const { getEditableRoot, firstElement } = api.dom;

  const LEGACY_MESSAGE_SELECTOR =
    '[data-message-author-role="assistant"], [data-message-author-role="user"]';
  const ACTION_BAR_SELECTOR = ".turn-action-controls";
  const USER_COPY_BUTTON_SELECTOR = 'button[aria-label="Copy message"]';
  const ASSISTANT_COPY_BUTTON_SELECTOR = 'button[aria-label="Copy"]';
  const TURN_KEY_SELECTOR = "[data-turn-key]";
  const SIDEBAR_CONVERSATION_KEY_ATTRIBUTE = "data-sidebar-chatgpt-conversation-key";
  const CONVERSATION_ID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  const SIDEBAR_CONVERSATION_KEY_PATTERN = new RegExp(
    `^chatgpt:conversation:(${CONVERSATION_ID_PATTERN})$`, "i"
  );
  const CONVERSATION_PATH_PATTERN = new RegExp(`^/c/${CONVERSATION_ID_PATTERN}$`, "i");
  const SIDEBAR_PROJECT_ID_ATTRIBUTE = "data-app-action-sidebar-project-id";
  const PROJECT_ID_PATTERN = "g-p-[0-9a-f]{32}";
  const PROJECT_ID_REGEXP = new RegExp(`^${PROJECT_ID_PATTERN}$`, "i");
  const PROJECT_PATH_PATTERN = new RegExp(`^/g/${PROJECT_ID_PATTERN}/project$`, "i");

  // Feature flag for ChatGPT's RTL <bdi> trailing-punctuation correction.
  // Keep this as one switch so a future settings control can replace it.
  const BDI_PUNCTUATION_HELPER_ATTRIBUTE = "data-cdc-bidi-punct";
  const BDI_TRAILING_PUNCTUATION_RE = /[.!?؟…,:;،؛۔]+$/u;
  const NON_PROSE_BDI_ANCESTOR_SELECTOR = "pre, code, kbd, samp";

  // ChatGPT may wrap one native action button in an extra child container.
  const SINGLE_BUTTON_WRAPPER_MAX_BUTTONS = 1;

  function getCurrentActionBars() {
    const copyButtons = document.querySelectorAll(
      `${ACTION_BAR_SELECTOR} ${USER_COPY_BUTTON_SELECTOR}, ` +
      `${ACTION_BAR_SELECTOR} ${ASSISTANT_COPY_BUTTON_SELECTOR}`
    );

    return [...new Set(
      [...copyButtons]
        .map((button) => button.closest(ACTION_BAR_SELECTOR))
        .filter((bar) => bar instanceof HTMLElement)
    )];
  }

  function findClosestAncestorTarget(element, selectors) {
    for (
      let ancestor = element?.parentElement;
      ancestor && ancestor !== document.documentElement;
      ancestor = ancestor.parentElement
    ) {
      const target = firstElement(ancestor, selectors);
      if (target) return target;
    }

    return null;
  }

  function getLastTextNode(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let lastTextNode = null;

    for (
      let textNode = walker.nextNode();
      textNode;
      textNode = walker.nextNode()
    ) {
      lastTextNode = textNode;
    }

    return lastTextNode;
  }

  function restoreRtlBdiPunctuation(target) {
    target
      .querySelectorAll(`span[${BDI_PUNCTUATION_HELPER_ATTRIBUTE}]`)
      .forEach((helper) => {
        const bdi = helper.previousSibling;
        if (!(bdi instanceof HTMLElement) || bdi.tagName !== "BDI") return;

        const lastTextNode = getLastTextNode(bdi);
        if (!lastTextNode) return;

        lastTextNode.data += helper.textContent || "";
        helper.remove();
      });
  }

  function applyRtlBdiPunctuation(target) {
    for (const bdi of target.querySelectorAll("bdi")) {
      if (!(bdi instanceof HTMLElement)) continue;
      if (bdi.closest(NON_PROSE_BDI_ANCESTOR_SELECTOR)) continue;

      const nextSibling = bdi.nextSibling;
      if (
        nextSibling instanceof HTMLElement &&
        nextSibling.hasAttribute(BDI_PUNCTUATION_HELPER_ATTRIBUTE)
      ) {
        continue;
      }

      const lastTextNode = getLastTextNode(bdi);
      if (!lastTextNode) continue;

      const match = lastTextNode.data.match(BDI_TRAILING_PUNCTUATION_RE);
      if (!match) continue;

      const punctuation = match[0];
      const remainingText = bdi.textContent.slice(0, -punctuation.length);
      if (!remainingText.trim()) continue;

      lastTextNode.data = lastTextNode.data.slice(0, -punctuation.length);

      const helper = document.createElement("span");
      helper.setAttribute(BDI_PUNCTUATION_HELPER_ATTRIBUTE, "");
      helper.textContent = punctuation;
      bdi.after(helper);
    }
  }

  api.registerAdapter({
    id: "chatgpt",

    matches(pageLocation) {
      return pageLocation.hostname === "chatgpt.com";
    },

    /**
     * Recent chats expose a conversation key on their surrounding list item;
     * project folders expose a project ID directly on their row. Conversations
     * inside projects still lack an exposed ID and remain unsupported.
     * This hook is queried only on mouse events, with no observers or polling.
     */
    getSidebarConversationLink(target) {
      if (!(target instanceof Element)) return null;
      const row = target.closest('.sidebar-item[role="button"]');
      if (!row?.closest("#app-shell-sidebar")) return null;

      // Menu, pin, rename inputs, and any other nested controls retain their
      // native behavior, even when the pointer is over their child SVG/text.
      const control = target.closest(
        'button, a, input, textarea, select, [contenteditable="true"], [role="button"], [role="menuitem"]'
      );
      if (control !== row || row.getAttribute("aria-disabled") === "true") return null;

      // Live project-folder DOM verified on 2026-09-23. Read the ID only from
      // the folder row, never an ancestor of a nested project conversation.
      if (row.hasAttribute("data-app-action-sidebar-project-row")) {
        const projectId = row.getAttribute(SIDEBAR_PROJECT_ID_ATTRIBUTE);
        if (!PROJECT_ID_REGEXP.test(projectId || "")) return null;
        return { element: row, url: new URL(`/g/${projectId}/project`, location.origin).href };
      }

      if (row.closest("[data-sidebar-project-container-id]")
        ?.getAttribute("data-sidebar-project-container-id") !== "chats") return null;
      if (!row.querySelector("[data-thread-title]")) return null;

      const key = row.closest(`[${SIDEBAR_CONVERSATION_KEY_ATTRIBUTE}]`)
        ?.getAttribute(SIDEBAR_CONVERSATION_KEY_ATTRIBUTE);
      const match = SIDEBAR_CONVERSATION_KEY_PATTERN.exec(key || "");
      if (!match) return null;
      return { element: row, url: new URL(`/c/${match[1]}`, location.origin).href };
    },

    // Pure URL policy also used by the service worker. Never let a page-supplied
    // message turn this feature into an arbitrary-URL tab opener.
    isSidebarConversationUrl(url) {
      return url.protocol === "https:" &&
        url.hostname === "chatgpt.com" &&
        !url.port && !url.username && !url.password && !url.search && !url.hash &&
        (CONVERSATION_PATH_PATTERN.test(url.pathname) || PROJECT_PATH_PATTERN.test(url.pathname));
    },

    findComposerEditor(activeElement) {
      const editor = getEditableRoot(activeElement);
      if (!editor) return null;

      const composer =
        editor.closest("form") ||
        editor.closest('[data-testid*="composer"]') ||
        editor.closest('[class*="composer"]') ||
        editor.closest("#prompt-textarea");

      return composer ? editor : null;
    },

    getComposerTextBlocks(editor) {
      // Measured live DOM: ChatGPT's ProseMirror composer represents each
      // Enter-created logical line as a direct <p> child of the editable root.
      return [...editor.children].filter(
        (child) => child instanceof HTMLElement && child.tagName === "P"
      );
    },

    getMessages() {
      // Current ChatGPT no longer exposes data-message-author-role.
      // Its native per-message action bars remain
      // identifiable by their copy buttons, so use those bars as message
      // anchors. This also keeps user and assistant messages separate even
      // though ChatGPT now wraps both inside one conversation-turn container.
      const actionBars = getCurrentActionBars();
      if (actionBars.length > 0) return actionBars;

      // Preserve the original legacy message discovery.
      return [...document.querySelectorAll(LEGACY_MESSAGE_SELECTOR)];
    },

    getRole(message) {
      if (message.matches?.(ACTION_BAR_SELECTOR)) {
        if (message.querySelector(USER_COPY_BUTTON_SELECTOR)) return ROLE_USER;
        if (message.querySelector(ASSISTANT_COPY_BUTTON_SELECTOR)) {
          return ROLE_ASSISTANT;
        }
      }

      const role = message.getAttribute?.("data-message-author-role");
      return role === ROLE_USER || role === ROLE_ASSISTANT ? role : null;
    },

    getTurn(message) {
      return (
        (message.matches?.(ACTION_BAR_SELECTOR) ? message : null) ||
        message.closest("article") ||
        message.closest('[data-testid^="conversation-turn-"]') ||
        message.parentElement
      );
    },

    getMessageStorageId(message, turn) {
      const role = this.getRole(message);
      if (!role) return null;

      const turnWithKey =
        message.closest?.(TURN_KEY_SELECTOR) ||
        turn?.closest?.(TURN_KEY_SELECTOR);
      const turnKey = turnWithKey?.getAttribute?.("data-turn-key");

      // ChatGPT gives the user and assistant messages in one exchange the same
      // persistent turn key, so include the role to keep their settings distinct.
      return turnKey ? `${role}:turn:${turnKey}` : null;
    },

    findActionBar(turn) {
      if (!turn) return null;

      if (turn.matches?.(ACTION_BAR_SELECTOR)) return turn;

      const currentBar = turn.querySelector?.(ACTION_BAR_SELECTOR);
      if (currentBar instanceof HTMLElement) return currentBar;

      const actionButton = firstElement(turn, [
        '[data-testid="copy-turn-action-button"]',
        'button[data-testid*="turn-action"]',
        'button[data-testid*="copy"]',
        'button[data-testid*="edit"]',
        USER_COPY_BUTTON_SELECTOR,
        ASSISTANT_COPY_BUTTON_SELECTOR
      ]);
      if (!actionButton) return null;

      let bar = actionButton.parentElement;
      if (!bar) return null;

      if (bar.querySelectorAll("button").length <= SINGLE_BUTTON_WRAPPER_MAX_BUTTONS) {
        const parent = bar.parentElement;
        if (parent?.querySelector("button")) bar = parent;
      }

      return bar;
    },

    getDirectionTarget(message, role) {
      if (message.matches?.(ACTION_BAR_SELECTOR)) {
        if (role === ROLE_USER) {
          return findClosestAncestorTarget(message, [
            ".whitespace-pre-wrap",
            '[class*="whitespace-pre-wrap"]'
          ]);
        }

        return findClosestAncestorTarget(message, [
          '[class*="MarkdownRoot"]',
          ".markdown",
          '[class*="markdown"]'
        ]);
      }

      if (role === ROLE_USER) {
        // Align only text inside the user bubble; never move the bubble itself.
        return firstElement(message, [
          ".whitespace-pre-wrap",
          '[class*="whitespace-pre-wrap"]',
          ".markdown"
        ]);
      }

      // Isolate assistant text from the native action controls where possible.
      return firstElement(message, [
        ".markdown",
        '[class*="markdown"]'
      ]) || message;
    },

    onDirectionModeApplied({ target, mode, punctuationEnabled = false }) {
      if (!(target instanceof HTMLElement)) return;

      if (!punctuationEnabled || mode !== "rtl") {
        restoreRtlBdiPunctuation(target);
        return;
      }

      applyRtlBdiPunctuation(target);
    }
  });
})();
