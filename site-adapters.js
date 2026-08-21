(() => {
  "use strict";

  /**
   * Site-specific DOM knowledge lives in this file.
   *
   * The rest of the extension works only with the adapter contract below, so
   * adding another chatbot does not require adding host checks throughout the
   * core direction/composer logic.
   *
   * Adapter contract:
   * - id: stable site identifier used for diagnostics/DOM metadata.
   * - matches(location): true when this adapter owns the current page.
   * - findComposerEditor(activeElement): returns the active prompt editor.
   * - getMessages(): returns all user/assistant message roots on the page.
   * - getRole(message): returns "user", "assistant", or null.
   * - getTurn(message): returns the DOM container that owns one message turn.
   * - findActionBar(turn, role): returns the native action-button container.
   * - getDirectionTarget(message, role): returns only the element whose text
   *   direction should change. This must not move user-message bubbles.
   */

  const GLOBAL_API_NAME = "ChatDirectionControl";
  const ROLE_USER = "user";
  const ROLE_ASSISTANT = "assistant";

  // Gemini sometimes wraps a single action button in several DOM layers.
  // This bounds the fallback search so we never walk arbitrarily far upward.
  const MAX_ACTION_BAR_ANCESTORS = 4;
  const MIN_ACTION_BUTTONS = 2;

  function isEditable(element) {
    if (!(element instanceof HTMLElement)) return false;

    return (
      element.tagName === "TEXTAREA" ||
      element.tagName === "INPUT" ||
      element.isContentEditable ||
      Boolean(element.closest('[contenteditable="true"]'))
    );
  }

  function getEditableRoot(activeElement) {
    if (!isEditable(activeElement)) return null;

    return (
      activeElement.closest('[contenteditable="true"]') ||
      activeElement.closest("textarea") ||
      activeElement.closest("input") ||
      activeElement
    );
  }

  function firstElement(root, selectors) {
    if (!root?.querySelector) return null;

    for (const selector of selectors) {
      const match = root.querySelector(selector);
      if (match instanceof HTMLElement) return match;
    }

    return null;
  }

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

  const chatGptAdapter = Object.freeze({
    id: "chatgpt",

    matches(pageLocation) {
      return (
        pageLocation.hostname === "chatgpt.com" ||
        pageLocation.hostname === "chat.openai.com"
      );
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

    getMessages() {
      return [...document.querySelectorAll(
        '[data-message-author-role="assistant"], [data-message-author-role="user"]'
      )];
    },

    getRole(message) {
      const role = message.getAttribute?.("data-message-author-role");
      return role === ROLE_USER || role === ROLE_ASSISTANT ? role : null;
    },

    getTurn(message) {
      return (
        message.closest("article") ||
        message.closest('[data-testid^="conversation-turn-"]') ||
        message.parentElement
      );
    },

    findActionBar(turn) {
      if (!turn) return null;

      const actionButton = firstElement(turn, [
        '[data-testid="copy-turn-action-button"]',
        'button[data-testid*="turn-action"]',
        'button[data-testid*="copy"]',
        'button[data-testid*="edit"]'
      ]);
      if (!actionButton) return null;

      let bar = actionButton.parentElement;
      if (!bar) return null;

      // ChatGPT may put one native button in a child wrapper. Prefer the
      // wrapper's parent so our two buttons sit beside the native controls.
      const SINGLE_BUTTON_WRAPPER_MAX_BUTTONS = 1;
      if (bar.querySelectorAll("button").length <= SINGLE_BUTTON_WRAPPER_MAX_BUTTONS) {
        const parent = bar.parentElement;
        if (parent?.querySelector("button")) bar = parent;
      }

      return bar;
    },

    getDirectionTarget(message, role) {
      if (role === ROLE_USER) {
        // Target the text inside the bubble, never the bubble container.
        return firstElement(message, [
          ".whitespace-pre-wrap",
          '[class*="whitespace-pre-wrap"]',
          ".markdown"
        ]);
      }

      // Assistant messages do not have the user-bubble placement problem, but
      // targeting markdown content still keeps native action controls isolated.
      return firstElement(message, [
        ".markdown",
        '[class*="markdown"]'
      ]) || message;
    }
  });

  const geminiAdapter = Object.freeze({
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
      // Prefer Gemini's semantic custom elements. The class/attribute fallback
      // covers UI variants that render the same turns without those elements.
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
        // As with ChatGPT, only align Gemini's text inside the user bubble.
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

  const siteAdapters = Object.freeze([
    chatGptAdapter,
    geminiAdapter
  ]);

  const api = Object.freeze({
    ROLE_USER,
    ROLE_ASSISTANT,

    getCurrentSiteAdapter(pageLocation = location) {
      return siteAdapters.find((adapter) => adapter.matches(pageLocation)) || null;
    }
  });

  globalThis[GLOBAL_API_NAME] = api;
})();
