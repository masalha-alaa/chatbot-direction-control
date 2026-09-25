(() => {
  "use strict";

  /**
   * Popup view of shared extension preferences. This document exists only while
   * the popup is open; saved values and page/worker listeners live independently.
   * Read raw values for checkbox state, then render effective UI dependencies.
   */
  const settings = globalThis.ChatDirectionSettings;
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

  /** Apply master/dependency disabling, effective counts and save status. */
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
      ? ""
      : "Choices could not be saved";
    status.closest("footer").hidden = storageAvailable;
  }

  /** Restore checkbox values from the shared cache, including hidden choices. */
  function restore() {
    master.checked = settings.get("enabled");
    for (const input of controls) {
      input.checked = settings.get(`${input.dataset.site}.${input.dataset.key}`);
    }
    render();
  }

  /**
   * Persist one changed checkbox; on failure restore cached state and show an
   * error. Each input's data-site/data-key maps directly to a settings API name.
   * @param {Event} event Checkbox change event.
   * @returns {Promise<void>}
   */
  async function save(event) {
    const input = event.target;
    const name = input === master ? "enabled" : `${input.dataset.site}.${input.dataset.key}`;
    try {
      await settings.set(name, input.checked);
      storageAvailable = true;
    } catch {
      storageAvailable = false;
    }
    restore();
  }

  master.disabled = true;
  for (const input of controls) input.disabled = true;
  master.addEventListener("change", save);
  for (const input of controls) input.addEventListener("change", save);
  settings.ready.then(() => {
    storageAvailable = !settings.error;
    master.disabled = false;
    restore();
    settings.subscribe(restore);
  });
})();
