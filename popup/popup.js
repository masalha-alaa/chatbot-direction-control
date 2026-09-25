(() => {
  "use strict";

  // UI-only prototype state. Content scripts do not read this key, and this
  // popup never writes chrome.storage or sends messages to a chatbot tab.
  const PREVIEW_STORAGE_KEY = "cdc:popup-ui-preview:v1";
  const PUNCTUATION_HELP =
    "Fix misplaced punctuation in messages set to right-to-left alignment";
  const popup = document.querySelector(".popup");
  const master = document.getElementById("enabled");
  const controls = [...document.querySelectorAll("input[data-site]")];
  const sections = [...document.querySelectorAll(".chatbot")];
  const punctuation = document.getElementById("chatgpt-rtlPunctuation");
  const userAlignment = document.getElementById("chatgpt-user");
  const assistantAlignment = document.getElementById("chatgpt-assistant");
  const status = document.getElementById("save-status");
  let storageAvailable = true;

  document.getElementById("extension-version").textContent =
    `v${chrome.runtime.getManifest().version}`;

  function restorePreview() {
    try {
      const saved = JSON.parse(localStorage.getItem(PREVIEW_STORAGE_KEY));
      if (!saved || typeof saved !== "object") return;
      if (typeof saved.enabled === "boolean") master.checked = saved.enabled;

      for (const input of controls) {
        const value = saved.sites?.[input.dataset.site]?.[input.dataset.key];
        if (typeof value === "boolean") input.checked = value;
      }
    } catch {
      // Keep the defaults usable if stored preview data cannot be read.
      storageAvailable = false;
    }
  }

  function render() {
    popup.classList.toggle("paused", !master.checked);
    for (const input of controls) input.disabled = !master.checked;

    const hasAlignmentButtons =
      userAlignment.checked || assistantAlignment.checked;
    punctuation.disabled = !master.checked || !hasAlignmentButtons;
    // Disabling a dependent control preserves its selected value.
    const help = PUNCTUATION_HELP + (hasAlignmentButtons ? "" :
      " — enable user or assistant alignment buttons to use this setting");
    punctuation.closest("label").title = help;
    document.getElementById("chatgpt-rtlPunctuation-details").textContent = help;

    for (const section of sections) {
      const inputs = [...section.querySelectorAll("input")];
      const enabled = inputs.filter((input) => input.checked && !input.disabled);
      section.querySelector(".count").textContent = master.checked
        ? `${enabled.length}/${inputs.length} on`
        : "Paused";
    }

    status.textContent = storageAvailable
      ? "UI preview · Changes affect this popup only"
      : "UI preview · Choices could not be saved";
  }

  function savePreview() {
    const sites = {};
    for (const input of controls) {
      const { site, key } = input.dataset;
      (sites[site] ??= {})[key] = input.checked;
    }

    try {
      localStorage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify({
        enabled: master.checked,
        sites
      }));
      storageAvailable = true;
    } catch {
      storageAvailable = false;
    }
    render();
  }

  master.addEventListener("change", savePreview);
  for (const input of controls) input.addEventListener("change", savePreview);
  restorePreview();
  render();
})();
