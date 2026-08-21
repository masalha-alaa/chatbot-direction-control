(() => {
  "use strict";

  const pressed = new Set();
  const isGemini = location.hostname === "gemini.google.com";

  function isEditable(element) {
    if (!element) return false;

    return (
      element.tagName === "TEXTAREA" ||
      element.tagName === "INPUT" ||
      element.isContentEditable ||
      Boolean(element.closest?.('[contenteditable="true"]'))
    );
  }

  function findComposerEditor() {
    const active = document.activeElement;
    if (!isEditable(active)) return null;

    const editor =
      active.closest?.('[contenteditable="true"]') ||
      active.closest?.("textarea") ||
      active.closest?.("input") ||
      active;

    if (isGemini) {
      const isGeminiEditor =
        editor.matches?.('.ql-editor[contenteditable="true"]') ||
        editor.matches?.('[contenteditable="true"][role="textbox"]') ||
        Boolean(editor.closest?.("rich-textarea")) ||
        Boolean(editor.closest?.("input-area-v2")) ||
        /prompt/i.test(editor.getAttribute?.("aria-label") || "");

      return isGeminiEditor ? editor : null;
    }

    // Restrict the shortcut to the ChatGPT composer area.
    const composer =
      editor.closest?.("form") ||
      editor.closest?.('[data-testid*="composer"]') ||
      editor.closest?.('[class*="composer"]') ||
      editor.closest?.("#prompt-textarea");

    return composer ? editor : null;
  }

  function setDirection(editor, direction) {
    const isRtl = direction === "rtl";

    editor.setAttribute("dir", direction);
    editor.style.setProperty("direction", direction, "important");
    editor.style.setProperty("text-align", isRtl ? "right" : "left", "important");

    // Both ChatGPT and Gemini use contenteditable editors with block children.
    // Apply alignment there too so existing text changes immediately.
    if (editor.isContentEditable) {
      for (const child of editor.querySelectorAll("p, div")) {
        child.style.setProperty("direction", direction, "important");
        child.style.setProperty("text-align", isRtl ? "right" : "left", "important");
      }
    }

    editor.focus({ preventScroll: true });
  }

  function matchesChord(side) {
    if (side === "right") {
      return pressed.has("ControlRight") && pressed.has("ShiftRight");
    }

    return pressed.has("ControlLeft") && pressed.has("ShiftLeft");
  }

  document.addEventListener(
    "keydown",
    (event) => {
      if (
        event.code !== "ControlLeft" &&
        event.code !== "ControlRight" &&
        event.code !== "ShiftLeft" &&
        event.code !== "ShiftRight"
      ) {
        return;
      }

      pressed.add(event.code);

      const editor = findComposerEditor();
      if (!editor) return;

      if (matchesChord("right")) {
        event.preventDefault();
        event.stopPropagation();
        setDirection(editor, "rtl");
      } else if (matchesChord("left")) {
        event.preventDefault();
        event.stopPropagation();
        setDirection(editor, "ltr");
      }
    },
    true
  );

  document.addEventListener(
    "keyup",
    (event) => {
      pressed.delete(event.code);
    },
    true
  );

  window.addEventListener("blur", () => pressed.clear());
})();
