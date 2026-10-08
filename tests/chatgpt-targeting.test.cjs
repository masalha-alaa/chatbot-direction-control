const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { parseHTML } = require("linkedom");
const { storageHarness } = require("./storage-harness.cjs");

// Reduced from the reported DOM: both roles share a turn and a .group;
// assistant controls are a sibling of the container holding BOTH messages.
// Keep only structural markup, with no conversation text or private IDs.
function turn(id, { reply = true, marked = true } = {}) {
  return `<div data-turn-key="${id}"><div class="group">
    <div class="messages">
      <div class="group/user-message"><div data-user-message-bubble="true">
        <div id="${id}-user-text" class="whitespace-pre-wrap">
          <div class="MarkdownRoot-test rich-text-user-turn" data-markdown-text-tone="user-message">
            <p>Question</p><div class="code"><button aria-label="Copy">Copy code</button></div>
          </div>
        </div>
      </div><div id="${id}-user" class="turn-action-controls"><button aria-label="Copy message"></button></div></div>
      ${reply ? `<div data-content-search-unit-key="${id}:2:assistant">
        <div id="${id}-assistant-text" class="MarkdownRoot-test" ${marked ? 'data-markdown-text-style="assistant-message"' : ''}><p>Reply</p></div>
      </div>` : ''}
    </div>
    <div id="${id}-assistant" class="turn-action-controls"><div><button aria-label="Copy"></button></div></div>
  </div></div>`;
}

const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
function harness(html, store = storageHarness()) {
  const { document, HTMLElement, Element, Event } = parseHTML(`<html><body>${html}</body></html>`);
  const context = vm.createContext({
    document, HTMLElement, Element, console, URL,
    location: new URL("https://chatgpt.com/c/test"),
    chrome: { storage: store.storage },
    MutationObserver: class { observe() {} },
    setTimeout() {}, clearTimeout() {}
  });
  const run = file => vm.runInContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), context, { filename: file });
  run("src/shared/site-adapter-registry.js");
  run("src/adapters/chatgpt.js");
  const site = context.ChatDirectionControl.getCurrentSiteAdapter();
  const get = id => document.getElementById(id);
  return { document, site, get, store,
    async start() { run("src/shared/settings.js"); run("src/content/response-direction.js"); await flush(); },
    async click(id, mode) { get(id).querySelector(`[data-mode="${mode}"]`).dispatchEvent(new Event("click")); await flush(); },
    get settings() { return context.ChatDirectionSettings; }
  };
}

for (const marked of [true, false]) {
  test(`shared turn resolves the correct text for each role (explicit assistant marker: ${marked})`, () => {
    const h = harness(turn("one", { marked }));
    assert.equal(h.site.getMessages().length, 2, "code copy button is not a message");
    for (const role of ["user", "assistant"]) {
      assert.equal(h.site.getRole(h.get(`one-${role}`)), role);
      assert.equal(h.site.getDirectionTarget(h.get(`one-${role}`), role), h.get(`one-${role}-text`));
    }
  });
}

test("missing assistant content cannot target the user or an adjacent turn", () => {
  const h = harness(turn("previous") + turn("missing", { reply: false }) + turn("next"));
  assert.equal(h.site.getDirectionTarget(h.get("missing-assistant"), "assistant"), null);
  // If the host omits turn keys, don't climb into the conversation and borrow
  // another assistant's text when the current reply is temporarily unmounted.
  h.document.querySelectorAll("[data-turn-key]").forEach(node => node.removeAttribute("data-turn-key"));
  assert.equal(h.site.getDirectionTarget(h.get("missing-assistant"), "assistant"), null);
});

test("assistant and user clicks, resets, saved alignment and role settings stay independent", async () => {
  const h = harness(turn("one") + turn("two"));
  await h.start();
  assert.equal(h.document.querySelectorAll(".cgpt-direction-toolbar").length, 4);
  await h.click("one-user", "ltr");
  await h.click("one-assistant", "rtl");
  assert(h.get("one-user-text").classList.contains("cgpt-force-ltr"));
  assert(h.get("one-assistant-text").classList.contains("cgpt-force-rtl"));
  assert.equal(h.get("two-assistant-text").classList.contains("cgpt-direction-target"), false);
  assert.equal(h.get("two-user-text").classList.contains("cgpt-direction-target"), false);
  assert.equal(h.get("one-user").querySelector('[data-mode="ltr"]').getAttribute("aria-pressed"), "true");
  assert.equal(h.get("one-assistant").querySelector('[data-mode="rtl"]').getAttribute("aria-pressed"), "true");
  const reload = harness(turn("one") + turn("two"), h.store);
  await reload.start();
  assert(reload.get("one-user-text").classList.contains("cgpt-force-ltr"));
  assert(reload.get("one-assistant-text").classList.contains("cgpt-force-rtl"));
  await reload.settings.set("chatgpt.assistant", false);
  assert.equal(reload.get("one-assistant-text").classList.contains("cgpt-direction-target"), false);
  assert(reload.get("one-user-text").classList.contains("cgpt-force-ltr"));
  await reload.settings.set("chatgpt.assistant", true);
  await reload.click("one-assistant", "rtl");
  assert.equal(reload.get("one-assistant-text").classList.contains("cgpt-direction-target"), false);
  assert(reload.get("one-user-text").classList.contains("cgpt-force-ltr"));
  await reload.click("one-assistant", "ltr");
  await reload.click("one-user", "rtl");
  assert(reload.get("one-assistant-text").classList.contains("cgpt-force-ltr"));
  assert(reload.get("one-user-text").classList.contains("cgpt-force-rtl"));
});
