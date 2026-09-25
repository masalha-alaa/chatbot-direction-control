(() => {
  "use strict";

  /**
   * Shared settings API for the popup, content scripts and service worker.
   * Each execution context owns a cache initialized from chrome.storage.local.
   * Storage events keep those caches current independently of popup lifetime;
   * there is no polling and enabled()/get() never perform storage I/O.
   *
   * Names are "enabled" or "<site>.<feature>"; the storage key adds PREFIX.
   * Missing/non-boolean values use defaults. Gemini intentionally has no
   * composer setting; ChatGPT alone has middleClick and rtlPunctuation.
   * Individual choices are retained when the master switch or a dependency
   * disables their effective behavior. Per-message alignment uses other keys.
   *
   * @typedef {"chatgpt"|"claude"|"gemini"|"grok"} SiteId
   * @typedef {"rememberAlignment"|"composer"|"user"|"assistant"|
   *   "rtlPunctuation"|"middleClick"} FeatureKey
   */

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

  // Register before the initial read so a newer event cannot be overwritten
  // by that read's stale snapshot. Ignore unrelated alignment-storage events.
  // Removal or an invalid value resets only that preference to its default.
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

  /**
   * Completes the initial load and notifies subscribers, even on read failure.
   * Read failures are exposed through error; effective features stay disabled.
   * get() may expose defaults before this resolves, so UI consumers await it.
   * @type {Promise<void>}
   */
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
    /** Last initial-load error, cleared by a successful set(). */
    get error() { return loadError; },
    /**
     * Read the raw cached preference, without applying the master/dependencies.
     * Use for checkbox state so temporarily disabled choices stay visible.
     * @param {string} name Unprefixed setting name, e.g. "chatgpt.user".
     * @returns {boolean|undefined} Undefined for an unsupported name.
     */
    get: name => values.get(name),
    /**
     * Check effective behavior using only cached values. Returns false until
     * loading finishes, on load failure, or for unsupported/disabled features.
     * RTL punctuation additionally requires user or assistant controls enabled;
     * the direction controller separately limits it to enabled roles/RTL text.
     * Safe to call from input handlers without asynchronous work or disk reads.
     * @param {SiteId} site
     * @param {FeatureKey} feature
     * @returns {boolean}
     */
    enabled(site, feature) {
      if (!loaded || loadError || !values.get("enabled") || !values.get(`${site}.${feature}`)) return false;
      return feature !== "rtlPunctuation" || values.get(`${site}.user`) || values.get(`${site}.assistant`);
    },
    /**
     * Subscribe within this context; the callback receives no arguments and
     * should reread cached settings. It runs on initial-load completion (if
     * registered in time), relevant storage events, and successful set() calls.
     * Notifications can repeat for one write; callbacks must tolerate that.
     * Registration does not invoke the callback or keep the popup/worker alive.
     * @param {() => void} listener Synchronous callback.
     * @returns {() => boolean} Unsubscribe; reports whether it was registered.
     */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /**
     * Persist one raw preference. Writes are serialized within this context;
     * separate keys keep writes to different settings from replacing each other.
     * For concurrent writes to the same key across contexts, storage order wins.
     * The cache is updated only after a successful write (or a storage event).
     * Failure rejects without blocking subsequent writes; callers report it.
     * @param {string} name Supported, unprefixed setting name.
     * @param {boolean} value
     * @returns {Promise<void>} Rejects on invalid input or storage failure.
     */
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
