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
  let nextComposerInstanceId = 1;

  function chordIsPressed(chord) {
    return chord.every((keyCode) => pressedKeys.has(keyCode));
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

  document.addEventListener(
    "keydown",
    (event) => {
      if (!directionKeys.has(event.code)) return;

      pressedKeys.add(event.code);

      const editor = site.findComposerEditor(document.activeElement);
      if (!editor) return;

      let direction = null;
      if (chordIsPressed(RIGHT_CHORD)) {
        direction = DIRECTION_RTL;
      } else if (chordIsPressed(LEFT_CHORD)) {
        direction = DIRECTION_LTR;
      }
      if (!direction) return;

      // Paragraph direction handling is opt-in per site adapter. Sites without
      // an explicit implementation keep their browser/page-native behavior.
      if (
        !editor.isContentEditable ||
        typeof site.getComposerTextBlocks !== "function"
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setParagraphDirection(editor, direction);
    },
    true
  );

  document.addEventListener(
    "keyup",
    (event) => {
      pressedKeys.delete(event.code);
    },
    true
  );

  window.addEventListener("blur", () => pressedKeys.clear());
})();
