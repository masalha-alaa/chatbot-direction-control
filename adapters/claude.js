(() => {
  "use strict";

  /** Claude DOM adapter. Keep all Claude-specific selectors in this file. */

  const api = globalThis.ChatDirectionControl;
  if (!api) return;

  const { ROLE_USER, ROLE_ASSISTANT } = api;
  const { getEditableRoot, firstElement } = api.dom;

  // Claude virtualizes conversation rows. data-index is the stable position of
  // a turn in the full conversation and survives DOM recycling while scrolling.
  const TURN_ROW_SELECTOR = "[data-index]";
  const TURN_INDEX_ATTRIBUTE = "data-index";
  const USER_MESSAGE_SELECTOR = '[data-testid="user-message"]';
  const ASSISTANT_MESSAGE_SELECTOR = ".standard-markdown";
  const THINKING_CONTAINER_SELECTOR = "[data-timeline-text]";

  const CLAUDE_ACTION_BAR_SELECTOR = [
    'div[role="group"][aria-label="Message actions"]',
    'div[role="group"][aria-label*="Message actions" i]'
  ].join(",");

  // Bound fallback ancestor traversal so a button search cannot climb into an
  // unrelated conversation row if Claude changes its action-bar wrappers.
  const MAX_ACTION_BAR_ANCESTORS = 4;
  const MIN_ACTION_BUTTONS = 2;

  // Claude user controls are hover-driven. Shared CSS recognizes this
  // attribute and hides our toolbar until the same turn is hovered/focused.
  const TOOLBAR_VISIBILITY_ATTRIBUTE = "data-cdc-toolbar-visibility";
  const TOOLBAR_VISIBILITY_HOVER = "hover";

  function sortByDocumentOrder(elements) {
    return elements.sort((left, right) => {
      if (left === right) return 0;
      const relation = left.compareDocumentPosition(right);
      return relation & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
  }

  function firstAvailableSelector(selectors) {
    for (const selector of selectors) {
      const matches = [...document.querySelectorAll(selector)];
      if (matches.length) return matches;
    }
    return [];
  }

  function isInsideCodeBlock(element) {
    if (!(element instanceof Element)) return false;

    return Boolean(
      element.closest(
        'code-block, pre, code, [data-test-id="code-content"], [class*="code-block"], [data-testid*="code-block"], [class*="markdown-code"]'
      )
    );
  }

  function actionBarFromButton(button) {
    if (!(button instanceof HTMLElement) || isInsideCodeBlock(button)) return null;

    const semanticBar = button.closest(CLAUDE_ACTION_BAR_SELECTOR);
    if (semanticBar) return semanticBar;

    let candidate = button.parentElement;
    let fallback = candidate;

    for (
      let level = 0;
      candidate && level < MAX_ACTION_BAR_ANCESTORS;
      level += 1
    ) {
      if (isInsideCodeBlock(candidate)) return null;

      if (candidate.querySelectorAll("button").length >= MIN_ACTION_BUTTONS) {
        return candidate;
      }

      fallback = candidate;
      candidate = candidate.parentElement;
    }

    return fallback;
  }

  function useNativeUserActionVisibility(turn, actionBar) {
    if (!(turn instanceof HTMLElement) || !(actionBar instanceof HTMLElement)) {
      return actionBar;
    }

    turn.setAttribute(
      TOOLBAR_VISIBILITY_ATTRIBUTE,
      TOOLBAR_VISIBILITY_HOVER
    );

    return actionBar;
  }

  function primaryAssistantMessages() {
    return [...document.querySelectorAll(ASSISTANT_MESSAGE_SELECTOR)].filter(
      (message) => !message.closest(THINKING_CONTAINER_SELECTOR)
    );
  }

  api.registerAdapter({
    id: "claude",

    matches(pageLocation) {
      return pageLocation.hostname === "claude.ai";
    },

    findComposerEditor(activeElement) {
      const editor = getEditableRoot(activeElement);
      if (!editor) return null;

      // Claude's Tiptap/ProseMirror composer exposes this stable testid.
      if (
        editor.matches('[data-testid="chat-input"]') ||
        editor.closest('[data-testid="chat-input"]')
      ) {
        return editor;
      }

      // Fallback for UI variants where the testid moves/disappears. Restrict
      // ProseMirror matching to a composer shell with a send control so an
      // editable artifact/panel is not mistaken for the chat composer.
      const composerShell = editor.closest("fieldset, form");
      const hasSendControl = Boolean(
        composerShell?.querySelector(
          'button[data-testid="send-button"], button[aria-label*="Send" i]'
        )
      );

      return editor.matches('.ProseMirror[contenteditable="true"][role="textbox"]') &&
        hasSendControl
        ? editor
        : null;
    },

    getComposerTextBlocks(editor) {
      return [...editor.children].filter(
        (child) => child instanceof HTMLElement && child.tagName === "P"
      );
    },

    getMessages() {
      const userMessages = firstAvailableSelector([
        USER_MESSAGE_SELECTOR,
        '[data-testid="human-message"]',
        ".font-user-message",
        '[data-testid="message-human"]',
        ".user-message"
      ]);

      const assistantMessages = primaryAssistantMessages();
      const assistantFallbacks = assistantMessages.length
        ? assistantMessages
        : firstAvailableSelector([
            '[data-testid="assistant-message"]',
            '[data-testid="ai-message"]',
            ".font-claude-response",
            ".font-claude-message",
            '[data-testid="message-assistant"]',
            ".assistant-message"
          ]);

      return sortByDocumentOrder([...new Set([
        ...userMessages,
        ...assistantFallbacks
      ])]);
    },

    getRole(message) {
      if (
        message.matches?.(
          '[data-testid="user-message"], [data-testid="human-message"], .font-user-message, [data-testid="message-human"], .user-message'
        )
      ) {
        return ROLE_USER;
      }

      if (
        message.matches?.(
          '.standard-markdown, [data-testid="assistant-message"], [data-testid="ai-message"], .font-claude-response, .font-claude-message, [data-testid="message-assistant"], .assistant-message'
        ) &&
        !message.closest?.(THINKING_CONTAINER_SELECTOR)
      ) {
        return ROLE_ASSISTANT;
      }

      return null;
    },

    getTurn(message) {
      return (
        message.closest(TURN_ROW_SELECTOR) ||
        message.closest('[data-test-render-count], [data-is-streaming]') ||
        message.parentElement ||
        message
      );
    },

    // Claude exposes no message-id attribute. Its virtualized row index is the
    // stable conversation-position identity, so use it for local persistence.
    getMessageStorageId(message, turn) {
      const row = turn?.matches?.(TURN_ROW_SELECTOR)
        ? turn
        : message.closest?.(TURN_ROW_SELECTOR);
      const index = row?.getAttribute?.(TURN_INDEX_ATTRIBUTE);
      return index == null ? null : `row:${index}`;
    },

    findActionBar(turn, role) {
      if (!(turn instanceof HTMLElement)) return null;

      if (role === ROLE_USER) {
        // action-bar-edit is user-exclusive; action-bar-copy is shared by both
        // roles. Starting from Edit prevents us from selecting an assistant bar.
        const editButton = firstElement(turn, [
          '[data-testid="action-bar-edit"]',
          'button[aria-label*="Edit" i]'
        ]);
        const userBar = actionBarFromButton(editButton);
        if (userBar) return useNativeUserActionVisibility(turn, userBar);
      }

      const semanticBar = turn.querySelector(CLAUDE_ACTION_BAR_SELECTOR);
      if (semanticBar) return semanticBar;

      const actionButton = firstElement(turn, [
        '[data-testid="action-bar-copy"]',
        '[data-testid="action-bar-retry"]',
        '[data-testid="action-bar-read-aloud"]',
        'button[aria-label*="Copy" i]',
        'button[aria-label*="Retry" i]'
      ]);
      const actionBar = actionBarFromButton(actionButton);
      if (!actionBar) return null;

      return role === ROLE_USER
        ? useNativeUserActionVisibility(turn, actionBar)
        : actionBar;
    },

    getDirectionTarget(message) {
      // Claude's measured message selectors are already the content bodies:
      // user-message contains the text paragraphs directly and standard-markdown
      // is the assistant prose container. Returning them avoids moving bubbles.
      return message;
    }
  });
})();
