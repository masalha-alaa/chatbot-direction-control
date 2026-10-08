const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { parseHTML } = require("linkedom");
const { storageHarness } = require("./storage-harness.cjs");
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };

function harness(html, store = storageHarness()) {
  const { document, HTMLElement, Element, Node, Event } = parseHTML(`<html><body>${html}</body></html>`);
  const context = vm.createContext({ document, HTMLElement, Element, Node, console, URL,
    location: new URL("https://gemini.google.com/test"), chrome: { storage: store.storage },
    MutationObserver: class { observe() {} }, setTimeout() {}, clearTimeout() {}
  });
  const run = file => vm.runInContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), context, { filename: file });
  run("src/shared/site-adapter-registry.js"); run("src/adapters/gemini.js");
  const site = context.ChatDirectionControl.getCurrentSiteAdapter();
  const messages = Object.fromEntries(site.getMessages().map(message => [site.getRole(message), message]));
  const target = role => site.getDirectionTarget(messages[role], role);
  const bar = role => site.findActionBar(site.getTurn(messages[role]), role);
  return { document, site, messages, target, bar, store,
    get settings() { return context.ChatDirectionSettings; },
    async start() { run("src/shared/settings.js"); run("src/content/response-direction.js"); await flush(); },
    async click(role, mode) { bar(role).querySelector(`[data-mode="${mode}"]`).dispatchEvent(new Event("click")); await flush(); }
  };
}

async function checkIndependent(h) {
  await h.start();
  assert.notEqual(h.bar("user"), h.bar("assistant"));
  assert.equal(h.document.querySelectorAll(".cgpt-direction-toolbar").length, 2);
  await h.click("assistant", "rtl");
  assert(h.target("assistant").classList.contains("cgpt-force-rtl"));
  assert(!h.target("user").classList.contains("cgpt-direction-target"));
  await h.click("user", "ltr");
  assert(h.target("user").classList.contains("cgpt-force-ltr"));
  assert(h.target("assistant").classList.contains("cgpt-force-rtl"));
  await h.click("assistant", "rtl");
  assert(!h.target("assistant").classList.contains("cgpt-direction-target"));
  assert(h.target("user").classList.contains("cgpt-force-ltr"));
}

test("gemini: expected layout keeps user and assistant clicks independent", async () => {
  await checkIndependent(harness(normal));
});

test("gemini: saved modes and role toggles remain independent", async () => {
  const h = harness(normal);
  await h.start();
  await h.click("user", "ltr");
  await h.click("assistant", "rtl");
  const reload = harness(normal, h.store);
  await reload.start();
  assert(reload.target("user").classList.contains("cgpt-force-ltr"));
  assert(reload.target("assistant").classList.contains("cgpt-force-rtl"));
  await reload.settings.set("gemini.assistant", false);
  assert(!reload.target("assistant").classList.contains("cgpt-direction-target"));
  assert(reload.target("user").classList.contains("cgpt-force-ltr"));
});

test("gemini: shared message wrapper cannot claim another message's controls", async () => {
  const h = harness(shared);
  await h.start();
  assert.equal(h.document.querySelectorAll(".cgpt-direction-toolbar").length, 0);
  assert.equal(h.bar("user"), null);
  assert.equal(h.bar("assistant"), null);
});

// Minimal layouts reproducing fallback ownership failures; no live user data.
const normal = "<div id=\"pair\"><user-query><div class=\"query-text\">User</div><div class=\"buttons-container\"><button aria-label=\"Edit\"></button><button aria-label=\"Copy\"></button></div></user-query><model-response><message-content class=\"markdown\">Assistant</message-content><message-actions><div class=\"buttons-container-v2\"><button aria-label=\"Copy\"></button></div></message-actions></model-response></div>";
const fallback = "<div id=\"pair\"><user-query><div class=\"query-text\">User</div><div><button aria-label=\"Copy\"></button></div></user-query><model-response><message-content>Assistant</message-content><div><button aria-label=\"Copy\"></button></div></model-response></div>";
const shared = "<div class=\"response-container\"><div class=\"user-query\"><div class=\"query-text\">User</div></div><div data-message-author=\"assistant\"><message-content>Assistant</message-content></div><div class=\"buttons-container\"><button aria-label=\"Copy\"></button></div></div>";

test("gemini: one-button fallback stays inside each message", async () => {
  await checkIndependent(harness(fallback));
});
test("gemini: a named action container outside the turn cannot become its toolbar", async () => {
  const wrapper = "<div class=\"buttons-container\">";
  await checkIndependent(harness(wrapper + fallback + '</div>'));
});
