(() => {
  "use strict";

  /** Grok DOM adapter. Keep all Grok-specific selectors in this file. */

  const api = globalThis.ChatDirectionControl;
  if (!api) return;

  const { ROLE_USER, ROLE_ASSISTANT } = api;
  const { getEditableRoot, firstElement } = api.dom;

  const MESSAGE_SELECTOR = ".message-bubble";
  const ASSISTANT_MESSAGE_SELECTOR = '[data-testid="assistant-message"]';
  const ASSISTANT_CONTENT_SELECTOR = ".response-content-markdown";
  const ACTION_BAR_SELECTOR = ".action-buttons";

  // Bound DOM traversal so fallbacks cannot escape one message turn and attach
  // controls to the composer or to another turn if Grok changes its wrappers.
  const MAX_TURN_ANCESTORS = 6;
  const MAX_ACTION_BAR_ANCESTORS = 4;
  const MAX_COMPOSER_ANCESTORS = 5;
  const MIN_ACTION_BUTTONS = 2;
  const HIDDEN_OPACITY_THRESHOLD = 0.01;

  const SEND_BUTTON_SELECTOR = [
    'button[data-testid="chat-submit"]',
    'button[aria-label="Submit"]',
    'button[aria-label*="Send" i]',
    'button[type="submit"]'
  ].join(",");

  const TURN_ACTION_BUTTON_SELECTORS = Object.freeze([
    'button[aria-label*="Copy" i]',
    'button[aria-label*="Edit" i]',
    'button[aria-label*="Retry" i]',
    'button[aria-label*="Regenerate" i]',
    'button[aria-label*="Share" i]',
    '[data-testid*="copy" i]',
    '[data-testid*="edit" i]',
    '[data-testid*="retry" i]'
  ]);

  const USER_ACTION_BUTTON_SELECTORS = Object.freeze([
    'button[aria-label*="Edit" i]',
    '[data-testid*="edit" i]',
    'button[aria-label*="Copy" i]',
    '[data-testid*="copy" i]'
  ]);

  // Grok's native user actions are controlled by its own hover CSS and may be
  // hidden on a wrapper rather than on the button itself. Mirror their actual
  // computed visibility instead of guessing which generated hover container
  // Grok currently uses.
  const toolbarVisibilityBindings = new Map();
  let visibilitySyncFrame = null;

  function sortByDocumentOrder(elements) {
    return elements.sort((left, right) => {
      if (left === right) return 0;
      const relation = left.compareDocumentPosition(right);
      return relation & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
  }

  function isInsideMessageContent(element) {
    if (!(element instanceof Element)) return false;

    return Boolean(
      element.closest(
        `pre, code, ${ASSISTANT_CONTENT_SELECTOR}`
      )
    );
  }

  function firstTurnActionButton(root) {
    if (!(root instanceof Element)) return null;

    for (const selector of TURN_ACTION_BUTTON_SELECTORS) {
      for (const candidate of root.querySelectorAll(selector)) {
        if (candidate instanceof HTMLElement && !isInsideMessageContent(candidate)) {
          return candidate;
        }
      }
    }

    return null;
  }

  function firstUserActionButton(root) {
    if (!(root instanceof Element)) return null;

    for (const selector of USER_ACTION_BUTTON_SELECTORS) {
      for (const candidate of root.querySelectorAll(selector)) {
        if (candidate instanceof HTMLElement && !isInsideMessageContent(candidate)) {
          return candidate;
        }
      }
    }

    return null;
  }

  function containsAnotherMessage(container, message) {
    if (!(container instanceof Element)) return false;

    return [...container.querySelectorAll(MESSAGE_SELECTOR)].some(
      (candidate) => candidate !== message && !message.contains(candidate)
    );
  }

  function findTurnAroundMessage(message) {
    let candidate = message;

    for (
      let level = 0;
      candidate && level < MAX_TURN_ANCESTORS;
      level += 1
    ) {
      if (
        candidate.querySelector?.(ACTION_BAR_SELECTOR) ||
        firstTurnActionButton(candidate)
      ) {
        return candidate;
      }

      const parent = candidate.parentElement;
      if (!parent || containsAnotherMessage(parent, message)) break;
      candidate = parent;
    }

    return message.parentElement || message;
  }

  function actionBarFromButton(button) {
    if (!(button instanceof HTMLElement) || isInsideMessageContent(button)) {
      return null;
    }

    const namedBar = button.closest(ACTION_BAR_SELECTOR);
    if (namedBar) return namedBar;

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

  function ancestorWithSendButton(editor) {
    let candidate = editor.parentElement;

    for (
      let level = 0;
      candidate && level < MAX_COMPOSER_ANCESTORS;
      level += 1
    ) {
      if (candidate.querySelector(SEND_BUTTON_SELECTOR)) return candidate;
      candidate = candidate.parentElement;
    }

    return null;
  }

  function isEffectivelyVisible(element) {
    if (!(element instanceof HTMLElement) || !element.isConnected) return false;

    const bounds = element.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return false;

    let candidate = element;
    while (candidate instanceof HTMLElement) {
      const style = getComputedStyle(candidate);
      const opacity = Number.parseFloat(style.opacity);

      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.visibility === "collapse" ||
        (!Number.isNaN(opacity) && opacity <= HIDDEN_OPACITY_THRESHOLD)
      ) {
        return false;
      }

      if (candidate === document.body) break;
      candidate = candidate.parentElement;
    }

    return true;
  }

  function setToolbarVisible(toolbar, visible) {
    toolbar.style.setProperty("opacity", visible ? "1" : "0", "important");
    toolbar.style.setProperty(
      "visibility",
      visible ? "visible" : "hidden",
      "important"
    );
    toolbar.style.setProperty(
      "pointer-events",
      visible ? "auto" : "none",
      "important"
    );
  }

  function syncToolbarVisibility() {
    visibilitySyncFrame = null;

    for (const [toolbar, binding] of toolbarVisibilityBindings) {
      if (!toolbar.isConnected) {
        toolbarVisibilityBindings.delete(toolbar);
        continue;
      }

      const nativeAction =
        firstUserActionButton(binding.actionBar) ||
        firstUserActionButton(binding.turn);

      setToolbarVisible(toolbar, isEffectivelyVisible(nativeAction));
    }
  }

  function scheduleToolbarVisibilitySync() {
    if (visibilitySyncFrame != null) return;
    visibilitySyncFrame = requestAnimationFrame(syncToolbarVisibility);
  }

  // Pointer hover changes and native opacity transitions do not mutate the DOM,
  // so MutationObserver alone cannot detect them. One shared set of listeners
  // updates all Grok user toolbars without adding listeners per message.
  document.addEventListener("pointerover", scheduleToolbarVisibilitySync, true);
  document.addEventListener("pointerout", scheduleToolbarVisibilitySync, true);
  document.addEventListener("transitionend", scheduleToolbarVisibilitySync, true);
  window.addEventListener("blur", () => {
    for (const toolbar of toolbarVisibilityBindings.keys()) {
      setToolbarVisible(toolbar, false);
    }
  });

  api.registerAdapter({
    id: "grok",

    matches(pageLocation) {
      return pageLocation.hostname === "grok.com";
    },

    findComposerEditor(activeElement) {
      const editor = getEditableRoot(activeElement);
      if (!editor) return null;

      // Current Grok uses a Tiptap/ProseMirror editor labelled "Ask Grok
      // anything". Keep explicit textarea/testid variants for UI revisions.
      if (
        editor.matches('[aria-label="Ask Grok anything"]') ||
        editor.matches('[data-testid="grokInput"]') ||
        editor.matches('textarea[data-testid="grok-compose-input"]')
      ) {
        return editor;
      }

      const looksLikeGrokEditor =
        editor.matches('.tiptap.ProseMirror[contenteditable="true"]') ||
        editor.matches('div[contenteditable="true"][role="textbox"]') ||
        editor.matches('textarea[placeholder*="Grok" i]');

      return looksLikeGrokEditor && ancestorWithSendButton(editor)
        ? editor
        : null;
    },

    getMessages() {
      return sortByDocumentOrder(
        [...document.querySelectorAll(MESSAGE_SELECTOR)].filter(
          (message) => !message.parentElement?.closest(MESSAGE_SELECTOR)
        )
      );
    },

    getRole(message) {
      if (!(message instanceof HTMLElement) || !message.matches(MESSAGE_SELECTOR)) {
        return null;
      }

      if (
        message.matches(ASSISTANT_MESSAGE_SELECTOR) ||
        message.querySelector(ASSISTANT_MESSAGE_SELECTOR) ||
        message.matches(ASSISTANT_CONTENT_SELECTOR) ||
        message.querySelector(ASSISTANT_CONTENT_SELECTOR)
      ) {
        return ROLE_ASSISTANT;
      }

      // Grok exposes all conversation entries as message-bubble elements. Once
      // assistant markers are excluded, the remaining conversation bubble is
      // the user's message. This also avoids depending on generated Tailwind
      // color classes for role detection.
      return ROLE_USER;
    },

    getTurn(message) {
      return findTurnAroundMessage(message);
    },

    findActionBar(turn) {
      if (!(turn instanceof HTMLElement)) return null;

      const namedBar = turn.querySelector(ACTION_BAR_SELECTOR);
      if (namedBar instanceof HTMLElement) return namedBar;

      return actionBarFromButton(firstTurnActionButton(turn));
    },

    configureToolbar({ role, turn, actionBar, toolbar }) {
      if (
        role !== ROLE_USER ||
        !(turn instanceof HTMLElement) ||
        !(actionBar instanceof HTMLElement) ||
        !(toolbar instanceof HTMLElement)
      ) {
        return;
      }

      const isNewBinding = !toolbarVisibilityBindings.has(toolbar);
      toolbarVisibilityBindings.set(toolbar, { turn, actionBar });

      // Hide a newly injected user toolbar immediately. The scheduled sync will
      // reveal it only when Grok's own Edit/Copy control is actually visible.
      if (isNewBinding) setToolbarVisible(toolbar, false);
      scheduleToolbarVisibilitySync();
    },

    getDirectionTarget(message, role) {
      if (role === ROLE_ASSISTANT) {
        return firstElement(message, [
          ASSISTANT_CONTENT_SELECTOR,
          ".prose",
          '[class*="markdown"]'
        ]) || message;
      }

      // The message-bubble itself is the text bubble; its parent controls the
      // left/right placement. Applying text direction here does not move it.
      return firstElement(message, [
        ".whitespace-pre-wrap",
        ".prose",
        '[data-testid="user-message"]'
      ]) || message;
    }
  });
})();
