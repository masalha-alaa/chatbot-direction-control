(() => {
  "use strict";

  // Independent keys prevent simultaneous popup writes from replacing other
  // preferences. Existing per-message alignment keys remain compatible.
  const PREFIX = "cdc:settings:";
  const common = { rememberAlignment: true, user: true, assistant: true };
  const defaults = {
    enabled: true,
    chatgpt: { ...common, composer: true, rtlPunctuation: false, middleClick: false },
    claude: { ...common, composer: true },
    gemini: { ...common },
    grok: { ...common, composer: true }
  };
  const values = new Map([["enabled", true]]);
  for (const [site, features] of Object.entries(defaults)) {
    if (site !== "enabled") {
      for (const [feature, value] of Object.entries(features)) values.set(`${site}.${feature}`, value);
    }
  }
  const fallback = new Map(values);
  const listeners = new Set();
  const changedDuringLoad = new Set();
  let loaded = false;
  let loadError = null;
  let writes = Promise.resolve();
  const notify = () => listeners.forEach(listener => listener());

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    let changed = false;
    for (const [key, change] of Object.entries(changes)) {
      if (!key.startsWith(PREFIX)) continue;
      const name = key.slice(PREFIX.length);
      if (!values.has(name)) continue;
      if (!loaded) changedDuringLoad.add(name);
      values.set(name, typeof change.newValue === "boolean" ? change.newValue : fallback.get(name));
      changed = true;
    }
    if (loaded && changed) notify();
  });

  const ready = (async () => {
    try {
      const saved = await chrome.storage.local.get([...values.keys()].map(name => PREFIX + name));
      for (const name of values.keys()) {
        if (!changedDuringLoad.has(name) && typeof saved[PREFIX + name] === "boolean") {
          values.set(name, saved[PREFIX + name]);
        }
      }
    } catch (error) {
      loadError = error;
      console.debug("Direction extension settings could not be loaded:", error);
    }
    loaded = true;
    changedDuringLoad.clear();
    notify();
  })();

  globalThis.ChatDirectionSettings = Object.freeze({
    ready,
    get error() { return loadError; },
    get: name => values.get(name),
    enabled(site, feature) {
      if (!loaded || loadError || !values.get("enabled") || !values.get(`${site}.${feature}`)) return false;
      return feature !== "rtlPunctuation" || values.get(`${site}.user`) || values.get(`${site}.assistant`);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(name, value) {
      if (!values.has(name) || typeof value !== "boolean") return Promise.reject(new TypeError("Unknown setting"));
      const operation = writes.catch(() => {}).then(async () => {
        await ready;
        await chrome.storage.local.set({ [PREFIX + name]: value });
        values.set(name, value);
        loadError = null;
        notify();
      });
      writes = operation;
      return operation;
    }
  });
})();
