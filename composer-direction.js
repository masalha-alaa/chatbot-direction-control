(() => {
  "use strict";

  /** Generic composer keyboard-shortcut controller. */

  const extensionApi = globalThis.ChatDirectionControl;
  const site = extensionApi?.getCurrentSiteAdapter?.();
  if (!site) return;

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

  function rebuildParagraphStyles() {
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
      if (!directionKeys.has(event.code)) {
        if (pendingShortcut && !event.repeat) {
          shortcutCancelled = true;
        }
        return;
      }

      const wasAlreadyPressed = pressedKeys.has(event.code);
      pressedKeys.add(event.code);

      if (
        pendingShortcut &&
        !wasAlreadyPressed &&
        !pendingShortcut.chord.includes(event.code)
      ) {
        shortcutCancelled = true;
      }

      const shortcut = getPressedDirectionShortcut();
      if (!shortcut) return;

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

  window.addEventListener("blur", () => {
    pressedKeys.clear();
    pendingShortcut = null;
    shortcutCancelled = false;
  });
})();
