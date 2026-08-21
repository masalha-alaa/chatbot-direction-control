(() => {
  "use strict";

  /** ChatGPT DOM adapter. Keep all ChatGPT-specific selectors in this file. */

  const api = globalThis.ChatDirectionControl;
  if (!api) return;

  const { ROLE_USER, ROLE_ASSISTANT } = api;
  const { getEditableRoot, firstElement } = api.dom;

  // ChatGPT may wrap one native action button in an extra child container.
  const SINGLE_BUTTON_WRAPPER_MAX_BUTTONS = 1;

  api.registerAdapter({
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

      if (bar.querySelectorAll("button").length <= SINGLE_BUTTON_WRAPPER_MAX_BUTTONS) {
        const parent = bar.parentElement;
        if (parent?.querySelector("button")) bar = parent;
      }

      return bar;
    },

    getDirectionTarget(message, role) {
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
    }
  });
})();
