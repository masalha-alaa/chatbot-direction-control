(() => {
  "use strict";

  /**
   * Registry and shared DOM helpers for chatbot adapters.
   *
   * Each supported chatbot registers one adapter from its own file. Core
   * extension modules depend only on the adapter contract, never on hostnames.
   */

  const GLOBAL_API_NAME = "ChatDirectionControl";
  const ROLE_USER = "user";
  const ROLE_ASSISTANT = "assistant";
  const REQUIRED_ADAPTER_METHODS = Object.freeze([
    "matches",
    "findComposerEditor",
    "getMessages",
    "getRole",
    "getTurn",
    "findActionBar",
    "getDirectionTarget"
  ]);

  const adapters = [];

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

  function validateAdapter(adapter) {
    if (!adapter || typeof adapter.id !== "string" || !adapter.id.trim()) {
      throw new TypeError("A site adapter requires a non-empty string id.");
    }

    for (const methodName of REQUIRED_ADAPTER_METHODS) {
      if (typeof adapter[methodName] !== "function") {
        throw new TypeError(
          `Site adapter "${adapter.id}" is missing ${methodName}().`
        );
      }
    }
  }

  function registerAdapter(adapter) {
    validateAdapter(adapter);

    if (adapters.some((registered) => registered.id === adapter.id)) {
      throw new Error(`Site adapter "${adapter.id}" is already registered.`);
    }

    adapters.push(Object.freeze(adapter));
  }

  const api = Object.freeze({
    ROLE_USER,
    ROLE_ASSISTANT,
    dom: Object.freeze({
      getEditableRoot,
      firstElement
    }),

    registerAdapter,

    getCurrentSiteAdapter(pageLocation = location) {
      return adapters.find((adapter) => adapter.matches(pageLocation)) || null;
    }
  });

  globalThis[GLOBAL_API_NAME] = api;
})();
