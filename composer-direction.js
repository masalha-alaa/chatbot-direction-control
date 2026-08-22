(() => {
  "use strict";

  /**
   * Generic composer keyboard-shortcut controller.
   * Site-specific editor discovery is delegated to site-adapters.js.
   */

  const extensionApi = globalThis.ChatDirectionControl;
  const site = extensionApi?.getCurrentSiteAdapter?.();
  if (!site) return;

  const COMPOSER_BLOCK_SELECTOR = "p, div";
  const LEFT_CHORD = Object.freeze(["ControlLeft", "ShiftLeft"]);
  const RIGHT_CHORD = Object.freeze(["ControlRight", "ShiftRight"]);
  const DIRECTION_LTR = "ltr";
  const DIRECTION_RTL = "rtl";

  const directionKeys = new Set([
    ...LEFT_CHORD,
    ...RIGHT_CHORD
  ]);
  const pressedKeys = new Set();

  function setDirection(editor, direction) {
    const textAlign = direction === DIRECTION_RTL ? "right" : "left";

    editor.setAttribute("dir", direction);
    editor.style.setProperty("direction", direction, "important");
    editor.style.setProperty("text-align", textAlign, "important");

    // Contenteditable editors often store each visual line in child blocks.
    // Updating those blocks makes already-entered text move immediately.
    if (editor.isContentEditable) {
      for (const child of editor.querySelectorAll(COMPOSER_BLOCK_SELECTOR)) {
        child.style.setProperty("direction", direction, "important");
        child.style.setProperty("text-align", textAlign, "important");
      }
    }

    // Preserve the user's caret/focus after changing direction.
    editor.focus({ preventScroll: true });
  }

  function chordIsPressed(chord) {
    return chord.every((keyCode) => pressedKeys.has(keyCode));
  }

  document.addEventListener(
    "keydown",
    (event) => {
      if (!directionKeys.has(event.code)) return;

      pressedKeys.add(event.code);

      const editor = site.findComposerEditor(document.activeElement);
      if (!editor) return;

      if (chordIsPressed(RIGHT_CHORD)) {
        event.preventDefault();
        event.stopPropagation();
        setDirection(editor, DIRECTION_RTL);
      } else if (chordIsPressed(LEFT_CHORD)) {
        event.preventDefault();
        event.stopPropagation();
        setDirection(editor, DIRECTION_LTR);
      }
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
