(() => {
  "use strict";

  /**
   * Paragraph-level keyboard direction controller, gated by master + composer.
   * Listeners remain registered for this page; each key event reads the settings
   * cache so changes take effect immediately, including between press/release.
   * Gemini has no composer setting and its native shortcuts remain untouched.
   *
   * Disabling the feature removes its CSS overrides, returning composed text
   * to host styling. Paragraph choices stay in memory and are reapplied when
   * re-enabled on this page; they are not persisted by Remember alignment.
   */

  const extensionApi = globalThis.ChatDirectionControl;
  const site = extensionApi?.getCurrentSiteAdapter?.();
  if (!site) return;
  const settings = globalThis.ChatDirectionSettings;
  const enabled = () => settings.enabled(site.id, "composer");

  const LEFT_CHORD = Object.freeze(["ControlLeft", "ShiftLeft"]);
  const RIGHT_CHORD = Object.freeze(["ControlRight", "ShiftRight"]);
  const DIRECTION_LTR = "ltr";
  const DIRECTION_RTL = "rtl";
  const COMPOSER_INSTANCE_ATTRIBUTE = "data-cdc-composer-instance";
  const COMPOSER_STYLE_ID = "cdc-composer-direction-styles";

  const directionKeys = new Set([...LEFT_CHORD, ...RIGHT_CHORD]);
  const pressedKeys = new Set();
  const paragraphDirections = new Map();
  let pendingShortcut = null;
  let shortcutCancelled = false;
  let nextComposerInstanceId = 1;

  function chordIsPressed(chord) {
    return chord.every((keyCode) => pressedKeys.has(keyCode));
  }

  function noDirectionKeysPressed() {
    return [...directionKeys].every((keyCode) => !pressedKeys.has(keyCode));
  }

  function getSelectedParagraphs(editor, paragraphs) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return [];
    if (
      !editor.contains(selection.anchorNode) ||
      !editor.contains(selection.focusNode)
    ) {
      return [];
    }

    if (selection.isCollapsed) {
      return paragraphs.filter(
        (paragraph) =>
          paragraph === selection.anchorNode ||
          paragraph.contains(selection.anchorNode)
      );
    }

    const range = selection.getRangeAt(0);
    return paragraphs.filter((paragraph) => {
      try {
        return range.intersectsNode(paragraph);
      } catch {
        return false;
      }
    });
  }

  function getComposerInstanceId(editor) {
    let instanceId = editor.getAttribute(COMPOSER_INSTANCE_ATTRIBUTE);
    if (instanceId) return instanceId;

    instanceId = String(nextComposerInstanceId++);
    editor.setAttribute(COMPOSER_INSTANCE_ATTRIBUTE, instanceId);
    return instanceId;
  }

  /**
   * Rebuild this page's external CSS from saved paragraph positions, or remove
   * it when disabled. This deliberately changes existing text alignment too;
   * disabling is not limited to ignoring future keyboard shortcuts.
   */
  function rebuildParagraphStyles() {
    if (!enabled()) {
      document.getElementById(COMPOSER_STYLE_ID)?.remove();
      return;
    }
    const rules = [];

    for (const [key, direction] of paragraphDirections) {
      const [instanceId, childPosition] = key.split(":");
      const textAlign = direction === DIRECTION_RTL ? "right" : "left";

      rules.push(
        `[${COMPOSER_INSTANCE_ATTRIBUTE}="${instanceId}"] > :nth-child(${childPosition}) {` +
        ` direction: ${direction} !important;` +
        ` text-align: ${textAlign} !important;` +
        ` }`
      );
    }

    let styleElement = document.getElementById(COMPOSER_STYLE_ID);
    if (!styleElement) {
      styleElement = document.createElement("style");
      styleElement.id = COMPOSER_STYLE_ID;
      (document.head || document.documentElement).appendChild(styleElement);
    }
    styleElement.textContent = rules.join("\n");
  }

  /**
   * Update the current or selected paragraphs without mutating managed text DOM.
   * @param {HTMLElement} editor Active contenteditable composer.
   * @param {"ltr"|"rtl"} direction
   */
  function setParagraphDirection(editor, direction) {
    const paragraphs = site.getComposerTextBlocks(editor);
    const selectedParagraphs = getSelectedParagraphs(editor, paragraphs);
    if (!selectedParagraphs.length) return;

    const instanceId = getComposerInstanceId(editor);
    const children = [...editor.children];

    for (const paragraph of selectedParagraphs) {
      const childPosition = children.indexOf(paragraph) + 1;
      if (childPosition > 0) {
        paragraphDirections.set(`${instanceId}:${childPosition}`, direction);
      }
    }

    // Keep ProseMirror's managed paragraph DOM untouched. External CSS is not
    // reverted by its DOM reconciliation.
    rebuildParagraphStyles();
    editor.focus({ preventScroll: true });
  }

  function getPressedDirectionShortcut() {
    if (chordIsPressed(RIGHT_CHORD)) {
      return { chord: RIGHT_CHORD, direction: DIRECTION_RTL };
    }
    if (chordIsPressed(LEFT_CHORD)) {
      return { chord: LEFT_CHORD, direction: DIRECTION_LTR };
    }
    return null;
  }

  function isSupportedComposer(editor) {
    return (
      editor?.isContentEditable &&
      typeof site.getComposerTextBlocks === "function"
    );
  }

  document.addEventListener(
    "keydown",
    (event) => {
      if (!enabled()) return;
      if (!directionKeys.has(event.code)) {
        // Any other key used while Ctrl/Shift is already held means this is a
        // larger keyboard shortcut, not a direction-change gesture.
        if (pressedKeys.size > 0 && !event.repeat) {
          shortcutCancelled = true;
        }
        return;
      }

      pressedKeys.add(event.code);

      const shortcut = getPressedDirectionShortcut();
      if (!shortcut) return;

      // A third Ctrl/Shift key also turns this into a different gesture.
      if ([...pressedKeys].some((keyCode) => !shortcut.chord.includes(keyCode))) {
        shortcutCancelled = true;
      }

      const editor = site.findComposerEditor(document.activeElement);
      if (!isSupportedComposer(editor)) return;

      // Suppress the browser/site's native Ctrl+Shift direction behavior as
      // soon as the direction chord is complete. The extension applies its
      // direction only when one of the chord keys is released.
      event.preventDefault();
      event.stopPropagation();

      if (!pendingShortcut && !shortcutCancelled) {
        pendingShortcut = {
          chord: shortcut.chord,
          direction: shortcut.direction,
          editor,
        };
      }
    },
    true
  );

  document.addEventListener(
    "keyup",
    (event) => {
      if (!enabled()) return;
      const isDirectionKey = directionKeys.has(event.code);
      const shouldApply =
        isDirectionKey &&
        pendingShortcut &&
        pendingShortcut.chord.includes(event.code) &&
        !shortcutCancelled;

      const shortcutToApply = shouldApply ? pendingShortcut : null;

      if (
        isDirectionKey &&
        pendingShortcut &&
        pendingShortcut.chord.includes(event.code)
      ) {
        pendingShortcut = null;
      }

      pressedKeys.delete(event.code);

      if (shortcutToApply) {
        event.preventDefault();
        event.stopPropagation();
        setParagraphDirection(shortcutToApply.editor, shortcutToApply.direction);
      }

      // Once all Ctrl/Shift keys involved in direction shortcuts are released,
      // a previously cancelled shortcut can start fresh on the next chord.
      if (noDirectionKeysPressed()) {
        pendingShortcut = null;
        shortcutCancelled = false;
      }
    },
    true
  );

  // Cancel any incomplete chord on a settings notification so releasing its
  // keys cannot apply an old gesture after disable/re-enable. Keep paragraph
  // choices and update their visible styles according to the effective setting.
  settings.subscribe(() => {
    pressedKeys.clear();
    pendingShortcut = null;
    shortcutCancelled = false;
    if (paragraphDirections.size) rebuildParagraphStyles();
  });

  window.addEventListener("blur", () => {
    pressedKeys.clear();
    pendingShortcut = null;
    shortcutCancelled = false;
  });
})();
