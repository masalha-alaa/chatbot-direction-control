(() => {
  "use strict";

  /** Claude DOM adapter. Keep all Claude-specific selectors in this file. */

  const api = globalThis.ChatDirectionControl;
  if (!api) return;

  const { ROLE_USER, ROLE_ASSISTANT } = api;
  const { getEditableRoot, firstElement } = api.dom;

  const PRIMARY_MESSAGE_SELECTOR = [
    '[data-testid="user-message"]',
    '.font-claude-response'
  ].join(',');

  const CLAUDE_ACTION_BAR_SELECTOR = [
    'div[role="group"][aria-label="Message actions"]',
    'div[role="group"][aria-label*="Message actions" i]'
  ].join(',');

  const MAX_TURN_ANCESTORS = 8;
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

  function containsAnotherPrimaryMessage(container, message) {
    if (!(container instanceof Element)) return false;

    return [...container.querySelectorAll(PRIMARY_MESSAGE_SELECTOR)].some(
      (candidate) => candidate !== message && !message.contains(candidate)
    );
  }

  function findTurnAroundMessage(message) {
    const streamingTurn = message.closest('[data-test-render-count], [data-is-streaming]');
    if (streamingTurn && !containsAnotherPrimaryMessage(streamingTurn, message)) {
      return streamingTurn;
    }

    let candidate = message;
    for (let level = 0; candidate && level < MAX_TURN_ANCESTORS; level += 1) {
      if (candidate.querySelector?.(CLAUDE_ACTION_BAR_SELECTOR)) {
        return candidate;
      }

      const parent = candidate.parentElement;
      if (!parent || containsAnotherPrimaryMessage(parent, message)) break;
      candidate = parent;
    }

    return message.parentElement || message;
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

      if (candidate.querySelectorAll('button').length >= MIN_ACTION_BUTTONS) {
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

  api.registerAdapter({
    id: "claude",

    matches(pageLocation) {
      return pageLocation.hostname === "claude.ai";
    },

    findComposerEditor(activeElement) {
      const editor = getEditableRoot(activeElement);
      if (!editor) return null;

      // Claude's Tiptap/ProseMirror composer exposes a stable chat-input testid.
      if (
        editor.matches('[data-testid="chat-input"]') ||
        editor.closest('[data-testid="chat-input"]')
      ) {
        return editor;
      }

      // Fallback for UI variants where the testid moves/disappears. Restrict
      // ProseMirror matching to a composer shell with a send control so an
      // editable artifact/panel is not mistaken for the chat composer.
      const composerShell = editor.closest('fieldset, form');
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

    getMessages() {
      const userMessages = firstAvailableSelector([
        '[data-testid="user-message"]',
        '[data-testid="human-message"]',
        '.font-user-message',
        '[data-testid="message-human"]',
        '.user-message'
      ]);

      const assistantMessages = firstAvailableSelector([
        '.font-claude-response',
        '[data-testid="assistant-message"]',
        '[data-testid="ai-message"]',
        '.font-claude-message',
        '[data-testid="message-assistant"]',
        '.assistant-message'
      ]);

      return sortByDocumentOrder([...new Set([
        ...userMessages,
        ...assistantMessages
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
          '.font-claude-response, [data-testid="assistant-message"], [data-testid="ai-message"], .font-claude-message, [data-testid="message-assistant"], .assistant-message'
        )
      ) {
        return ROLE_ASSISTANT;
      }

      return null;
    },

    getTurn(message) {
      return findTurnAroundMessage(message);
    },

    findActionBar(turn, role) {
      if (!(turn instanceof HTMLElement)) return null;

      const semanticBar = turn.querySelector(CLAUDE_ACTION_BAR_SELECTOR);
      if (semanticBar) {
        return role === ROLE_USER
          ? useNativeUserActionVisibility(turn, semanticBar)
          : semanticBar;
      }

      // action-bar-copy is a stable Claude turn-level control. Edit is useful
      // for user messages, while Copy/Retry cover assistant UI variants.
      const actionButton = firstElement(turn, [
        '[data-testid="action-bar-copy"]',
        '[data-testid="action-bar-edit"]',
        'button[aria-label*="Copy" i]',
        'button[aria-label*="Edit" i]',
        'button[aria-label*="Retry" i]'
      ]);
      const actionBar = actionBarFromButton(actionButton);
      if (!actionBar) return null;

      return role === ROLE_USER
        ? useNativeUserActionVisibility(turn, actionBar)
        : actionBar;
    },

    getDirectionTarget(message, role) {
      if (role === ROLE_USER) {
        // data-testid=user-message is the message body, not the outer bubble.
        // Prefer a nested text wrapper when Claude supplies one.
        return firstElement(message, [
          '.font-user-message',
          '[class*="whitespace-pre-wrap"]',
          '.prose'
        ]) || message;
      }

      return firstElement(message, [
        '.standard-markdown',
        '.progressive-markdown',
        '.prose'
      ]) || message;
    }
  });
})();
