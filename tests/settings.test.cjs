const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { parseHTML } = require("linkedom");
const { storageHarness } = require("./storage-harness.cjs");
const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const run = (context, file) => vm.runInContext(read(file), context, { filename: file });
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function settingsContext(store, extra = {}) {
  const context = vm.createContext({ console, ...extra, chrome: { storage: store.storage, runtime: { getManifest: () => ({ version: "1.1.0" }) } } });
  run(context, "settings.js");
  return context;
}

test("all supported defaults, independent writes, reload and cross-context updates", async () => {
  const store = storageHarness();
  const a = settingsContext(store).ChatDirectionSettings;
  const b = settingsContext(store).ChatDirectionSettings;
  assert.equal(a.enabled("chatgpt", "user"), false, "wait for persisted settings");
  await Promise.all([a.ready, b.ready]);
  for (const site of ["chatgpt", "claude", "gemini", "grok"]) {
    for (const feature of ["rememberAlignment", "user", "assistant"]) assert.equal(a.enabled(site, feature), true);
    assert.equal(a.enabled(site, "composer"), site !== "gemini");
  }
  assert.equal(a.enabled("chatgpt", "middleClick"), false);
  assert.equal(a.enabled("chatgpt", "rtlPunctuation"), false);
  await Promise.all([a.set("chatgpt.middleClick", true), b.set("claude.user", false)]);
  assert.equal(b.enabled("chatgpt", "middleClick"), true);
  assert.equal(a.enabled("claude", "user"), false);
  await a.set("chatgpt.rtlPunctuation", true);
  await a.set("chatgpt.user", false);
  await a.set("chatgpt.assistant", false);
  assert.equal(a.get("chatgpt.rtlPunctuation"), true);
  assert.equal(a.enabled("chatgpt", "rtlPunctuation"), false);
  await a.set("enabled", false);
  assert.equal(b.enabled("grok", "composer"), false);
  const reopened = settingsContext(store).ChatDirectionSettings;
  await reopened.ready;
  assert.equal(reopened.get("enabled"), false);
  await store.storage.local.remove("cdc:settings:enabled");
  assert.equal(reopened.get("enabled"), true);
});

test("a storage event received during initial load wins over a stale read", async () => {
  const store = storageHarness();
  let release;
  store.storage.local.get = () => new Promise(resolve => { release = resolve; });
  const settings = settingsContext(store).ChatDirectionSettings;
  store.emit({ "cdc:settings:enabled": { newValue: false } });
  release({ "cdc:settings:enabled": true });
  await settings.ready;
  assert.equal(settings.get("enabled"), false);
});

test("popup uses real settings, keeps dependencies and reports failed saves", async () => {
  const store = storageHarness();
  const { document, Event } = parseHTML(read("popup/popup.html"));
  const context = settingsContext(store, { document });
  run(context, "popup/popup.js");
  await flush();
  const input = id => document.getElementById(id);
  assert.equal(input("chatgpt-middleClick").checked, false);
  assert.equal(input("chatgpt-rtlPunctuation").checked, false);
  assert.equal(input("gemini-composer"), null);
  for (const id of ["chatgpt-user", "chatgpt-assistant"]) {
    input(id).checked = false;
    input(id).dispatchEvent(new Event("change"));
    await flush();
  }
  assert.equal(input("chatgpt-rtlPunctuation").disabled, true);
  assert.equal(store.data["cdc:settings:chatgpt.user"], false);
  assert.equal(document.getElementById("extension-version").textContent, "v1.1.0");
  store.setFailure(true);
  input("enabled").checked = false;
  input("enabled").dispatchEvent(new Event("change"));
  await flush();
  assert.equal(input("enabled").checked, true, "failed save rolls back");
  assert.equal(input("save-status").textContent, "Choices could not be saved");
});

function pageContext(siteId, store) {
  const { document, HTMLElement, Element, Event, NodeFilter } = parseHTML('<html><head></head><body><article id="u" data-role="user"><div class="text"><bdi>abc!</bdi></div><div class="actions"></div></article><article id="a" data-role="assistant"><div class="text">Reply</div><div class="actions"></div></article><div id="editor"><p>First</p><p>Second</p></div></body></html>');
  let scan;
  const site = {
    id: siteId,
    getMessages: () => [...document.querySelectorAll("article")],
    getRole: message => message.dataset.role,
    getTurn: message => message,
    findActionBar: turn => turn.querySelector(".actions"),
    getDirectionTarget: message => message.querySelector(".text"),
    getMessageStorageId: message => message.id,
    getComposerTextBlocks: editor => [...editor.children],
    findComposerEditor: () => document.getElementById("editor")
  };
  const context = settingsContext(store, {
    document, HTMLElement, Element, NodeFilter: NodeFilter || { SHOW_TEXT: 4 }, URL,
    location: new URL(`https://test.example/${siteId}`),
    ChatDirectionControl: { getCurrentSiteAdapter: () => site },
    MutationObserver: class { constructor(fn) { scan = fn; } observe() {} },
    setTimeout(fn) { scan = fn; return 1; }, clearTimeout() {},
    window: { addEventListener() {}, getSelection: () => ({ rangeCount: 1, isCollapsed: true, anchorNode: document.querySelector("p").firstChild, focusNode: document.querySelector("p").firstChild }) }
  });
  return { context, document, site, Event, rescan: () => scan(), settings: context.ChatDirectionSettings };
}

for (const siteId of ["chatgpt", "claude", "gemini", "grok"]) {
  test(`${siteId}: role toggles, master, remember-off rerenders and reload isolation`, async () => {
    const key = `cgpt-direction|https://test.example/${siteId}|site:u`;
    const store = storageHarness({ [key]: "rtl" });
    const h = pageContext(siteId, store);
    run(h.context, "response-direction.js");
    await flush();
    const message = h.document.getElementById("u");
    assert.equal(message.dataset.cgptDirection, "rtl");
    assert.equal(h.document.querySelectorAll(".cgpt-direction-toolbar").length, 2);
    await h.settings.set(`${siteId}.user`, false);
    assert.equal(message.querySelector(".cgpt-direction-toolbar"), null);
    assert.equal(message.querySelector(".cgpt-force-rtl"), null);
    assert(h.document.getElementById("a").querySelector(".cgpt-direction-toolbar"));
    assert.equal(store.data[key], "rtl");
    await h.settings.set(`${siteId}.user`, true);
    assert.equal(message.dataset.cgptDirection, "rtl");
    await h.settings.set("enabled", false);
    assert.equal(h.document.querySelectorAll(".cgpt-direction-toolbar").length, 0);
    await h.settings.set("enabled", true);
    await h.settings.set(`${siteId}.rememberAlignment`, false);
    message.querySelector('[data-mode="ltr"]').dispatchEvent(new h.Event("click"));
    await flush();
    assert.equal(store.data[key], "rtl", "remember-off does not write");
    message.querySelector(".cgpt-direction-toolbar").remove();
    h.rescan(); await flush();
    assert.equal(message.dataset.cgptDirection, "ltr", "current-page choice survives rerender");
    const reload = pageContext(siteId, store);
    run(reload.context, "response-direction.js"); await flush();
    assert.equal(reload.document.getElementById("u").dataset.cgptDirection, undefined, "remember-off does not recover");
    await reload.settings.set(`${siteId}.rememberAlignment`, true); await flush();
    assert.equal(reload.document.getElementById("u").dataset.cgptDirection, "rtl");
    reload.document.querySelector('#u [data-mode="ltr"]').dispatchEvent(new reload.Event("click"));
    await flush(); assert.equal(store.data[key], "ltr");
  });
}

test("late saved alignment cannot overwrite a click or re-enable a disabled role", async () => {
  for (const action of ["click", "disable"]) {
    const store = storageHarness();
    const h = pageContext("chatgpt", store);
    await h.settings.ready;
    let release;
    const get = store.storage.local.get;
    store.storage.local.get = keys => typeof keys === "string" && keys.endsWith("site:u") ? new Promise(resolve => { release = resolve; }) : get(keys);
    run(h.context, "response-direction.js"); await flush();
    if (action === "click") h.document.querySelector('#u [data-mode="ltr"]').dispatchEvent(new h.Event("click"));
    else await h.settings.set("chatgpt.user", false);
    release({ "cgpt-direction|https://test.example/chatgpt|site:u": "rtl" }); await flush();
    assert.equal(h.document.getElementById("u").dataset.cgptDirection, action === "click" ? "ltr" : undefined);
  }
});

for (const siteId of ["chatgpt", "claude", "grok", "gemini"]) {
  test(`${siteId}: composer respects feature and master settings during chords`, async () => {
    const h = pageContext(siteId, storageHarness());
    const editor = h.document.getElementById("editor");
    Object.defineProperty(editor, "isContentEditable", { value: true });
    run(h.context, "composer-direction.js"); await flush();
    const key = (type, code) => {
      const event = new h.Event(type, { cancelable: true });
      event.code = code; h.document.dispatchEvent(event); return event;
    };
    const chord = () => { key("keydown", "ControlRight"); key("keydown", "ShiftRight"); key("keyup", "ShiftRight"); key("keyup", "ControlRight"); };
    chord();
    const style = () => h.document.getElementById("cdc-composer-direction-styles");
    if (siteId === "gemini") { assert.equal(style(), null); return; }
    assert.match(style().textContent, /direction: rtl/);
    assert.doesNotMatch(style().textContent, /nth-child\(2\)/);
    await h.settings.set(`${siteId}.composer`, false);
    assert.equal(style(), null); chord(); assert.equal(style(), null);
    await h.settings.set(`${siteId}.composer`, true);
    key("keydown", "ControlLeft"); key("keydown", "ShiftLeft");
    await h.settings.set("enabled", false);
    key("keyup", "ShiftLeft"); key("keyup", "ControlLeft");
    assert.equal(style(), null);
    await h.settings.set("enabled", true);
    assert.match(style().textContent, /direction: rtl/, "disabled mid-chord cannot apply LTR");
  });
}

test("actual ChatGPT punctuation hook is opt-in and restores text on disable", async () => {
  const h = pageContext("chatgpt", storageHarness());
  let adapter;
  h.context.ChatDirectionControl = { dom: {}, registerAdapter: value => { adapter = value; } };
  run(h.context, "adapters/chatgpt.js");
  h.context.ChatDirectionControl = { getCurrentSiteAdapter: () => h.site };
  h.site.onDirectionModeApplied = adapter.onDirectionModeApplied;
  run(h.context, "response-direction.js"); await flush();
  h.document.querySelector('#u [data-mode="rtl"]').dispatchEvent(new h.Event("click")); await flush();
  const target = h.document.querySelector("#u .text");
  assert.equal(target.querySelector("[data-cdc-bidi-punct]"), null);
  await h.settings.set("chatgpt.rtlPunctuation", true);
  assert.equal(target.querySelector("[data-cdc-bidi-punct]").textContent, "!");
  assert.equal(target.querySelector("bdi").textContent, "abc");
  await h.settings.set("chatgpt.rtlPunctuation", false);
  assert.equal(target.querySelector("bdi").textContent, "abc!");
  assert.equal(target.querySelector("[data-cdc-bidi-punct]"), null);
  await h.settings.set("chatgpt.rtlPunctuation", true);
  await h.settings.set("chatgpt.user", false);
  assert.equal(target.querySelector("bdi").textContent, "abc!");
});
