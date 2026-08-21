(() => {
  "use strict";

  /** Gemini DOM adapter. Keep all Gemini-specific selectors in this file. */

  const api = globalThis.ChatDirectionControl;
  if (!api) return;

  const { ROLE_USER, ROLE_ASSISTANT } = api;
  const { getEditableRoot, firstElement } = api.dom;

  // Gemini can wrap a single action button in several layers. Bound the
  // fallback search so it cannot climb into unrelated conversation UI.
  const MAX_ACTION_BAR_ANCESTORS = 4;
  const MIN_ACTION_BUTTONS = 2;

  function actionBarFromButton(button) {
    if (!(button instanceof HTMLElement)) return null;

    let candidate = button.parentElement;
    let fallback = candidate;

    for (
      let level = 0;
      candidate && level < MAX_ACTION_BAR_ANCESTORS;
      level += 1
    ) {
      if (candidate.querySelectorAll("button").length >= MIN_ACTION_BUTTONS) {
        return candidate;
      }

      fallback = candidate;
      candidate = candidate.parentElement;
    }

    return fallback;
  }

  api.registerAdapter({
    id: "gemini",

    matches(pageLocation) {
      return pageLocation.hostname === "gemini.google.com";
    },

    findComposerEditor(activeElement) {
      const editor = getEditableRoot(activeElement);
      if (!editor) return null;

      const isPromptEditor =
        editor.matches('.ql-editor[contenteditable="true"]') ||
        editor.matches('[contenteditable="true"][role="textbox"]') ||
        Boolean(editor.closest("rich-textarea")) ||
        Boolean(editor.closest("input-area-v2")) ||
        /prompt/i.test(editor.getAttribute("aria-label") || "");

      return isPromptEditor ? editor : null;
    },

    getMessages() {
      // Prefer Gemini's semantic custom elements. The fallback covers UI
      // variants that render equivalent turns without those elements.
      const semanticMessages = [...document.querySelectorAll(
        "user-query, model-response"
      )];
      if (semanticMessages.length) return semanticMessages;

      return [...document.querySelectorAll(
        '.user-query, [data-message-author="user"], .model-response-container, [data-message-author="assistant"]'
      )];
    },

    getRole(message) {
      if (message.matches?.('user-query, .user-query, [data-message-author="user"]')) {
        return ROLE_USER;
      }

      if (message.matches?.('model-response, .model-response-container, [data-message-author="assistant"]')) {
        return ROLE_ASSISTANT;
      }

      return null;
    },

    getTurn(message) {
      return (
        message.closest("user-query, model-response") ||
        message.closest(".user-query-container, .model-response-container, .response-container") ||
        message
      );
    },

    findActionBar(turn, role) {
      if (!turn) return null;

      if (role === ROLE_ASSISTANT) {
        const exact = firstElement(turn, [
          "message-actions .buttons-container-v2",
          ".response-container-footer .buttons-container-v2",
          ".response-container-footer"
        ]);
        if (exact) return exact;
      } else if (role === ROLE_USER) {
        const editHost = turn.querySelector('[data-test-id="prompt-edit-button"]');
        const editButton = editHost?.matches?.("button")
          ? editHost
          : editHost?.querySelector?.("button");

        const copyIcon = turn.querySelector(
          'mat-icon[fonticon="content_copy"], mat-icon[fonticon="copy"], mat-icon[data-mat-icon-name="content_copy"], mat-icon[data-mat-icon-name="copy"]'
        );
        const copyButton = copyIcon?.closest?.("button");

        const exact = actionBarFromButton(editButton || copyButton);
        if (exact) return exact;
      }

      const actionButton = firstElement(turn, [
        'button[aria-label*="Copy" i]',
        '[data-test-id="prompt-edit-button"] button',
        'button[data-test-id="prompt-edit-button"]',
        'button[aria-label*="Edit" i]',
        'button[aria-label*="More" i]',
        'button[aria-label*="option" i]',
        'button[aria-label*="Redo" i]',
        'button[aria-label*="Retry" i]'
      ]);
      if (!actionButton) return null;

      return (
        actionButton.closest(
          ".buttons-container-v2, .buttons-container, .response-actions, .actions-container, [class*='action-buttons'], [class*='buttons-container']"
        ) || actionBarFromButton(actionButton)
      );
    },

    getDirectionTarget(message, role) {
      if (role === ROLE_USER) {
        // Align only text inside the user bubble; never move the bubble itself.
        return firstElement(message, [
          ".query-text",
          '[class*="query-text"]',
          ".query-content"
        ]);
      }

      return firstElement(message, [
        ".markdown.markdown-main-panel",
        ".markdown-main-panel",
        "message-content .markdown",
        "message-content",
        ".model-response-text",
        ".response-content",
        ".markdown"
      ]);
    }
  });
})();
