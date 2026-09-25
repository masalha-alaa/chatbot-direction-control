const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { parseHTML } = require("linkedom");

const { storageHarness } = require("./storage-harness.cjs");

const root = path.resolve(__dirname, "..");
const ID = "11111111-2222-3333-4444-555555555555";
const OTHER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const ORIGIN = "https://chatgpt.com";
const URL_VALUE = `${ORIGIN}/c/${ID}`;
const PROJECT_ID = "g-p-0123456789abcdef0123456789abcdef";
const PROJECT_URL = `${ORIGIN}/g/${PROJECT_ID}/project`;
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

// Sanitized structural fixture based on the live recent/project sidebar DOM
// inspected on 2026-09-19, with project folders verified on 2026-09-23.
// No private titles, IDs, or conversation text retained.
const projectRow = (id) => `
  <div class="sidebar-item" role="button" id="${id}"
       data-app-action-sidebar-project-row="" data-app-action-sidebar-project-id="${PROJECT_ID}">
    <span data-sidebar-project-container-id="project:${PROJECT_ID}"><svg id="${id}-icon"><path/></svg></span>
    <span id="${id}-title">Test project</span>
    <button id="${id}-menu" aria-label="Project actions"><svg><path/></svg></button>
    <button id="${id}-new" aria-label="New chat in project"><svg><path/></svg></button>
  </div>`;
const row = (id = "recent") => `
  <div class="sidebar-item" role="button" id="${id}">
    <div class="contents"><button id="${id}-menu" aria-label="Chat actions"><svg><path/></svg></button>
      <button id="${id}-pin" aria-label="Pin chat"><svg/></button></div>
    <div data-thread-title-trigger="true"><span data-thread-title="true"><span id="${id}-title">Test conversation</span></span></div>
  </div>`;
const fixture = `<!doctype html><html><body>
  <aside><div id="app-shell-sidebar">
    <div data-sidebar-project-container-id="projects">
      <div data-sidebar-project-container-id="project:${PROJECT_ID}">
        ${projectRow("project-heading")}
        <div role="list" aria-label="Chats in Project"><div role="listitem">${row("project-chat")}</div></div>
      </div>
    </div>
    <div data-sidebar-project-container-id="pinned">
      <div data-sidebar-project-container-id="project:${PROJECT_ID}">${projectRow("pinned-project")}</div>
    </div>
    <div data-sidebar-project-container-id="chats">
      <section><button id="recents-heading">Recents</button>
        <div role="list"><div role="listitem" id="recent-container" data-sidebar-chatgpt-conversation-key="chatgpt:conversation:${ID}">
          <div class="overflow-hidden">${row()}</div>
        </div></div>
        <a id="native-link" href="/c/${ID}">Native conversation link</a>
        <div id="empty-space"></div>
      </section>
    </div>
  </div></aside>
  <main id="main">${row("outside")}</main>
</body></html>`;

function pageHarness(hostname = "chatgpt.com", enabled = true) {
  const subscriptions = [];
  const settings = { enabled: () => enabled, subscribe: fn => subscriptions.push(fn) };
  const { document, Element, HTMLElement } = parseHTML(fixture);
  const listeners = new Map();
  const sent = [];
  const location = new URL(`https://${hostname}/c/${OTHER_ID}`);
  const context = vm.createContext({
    document, Element, HTMLElement, URL, location, console, ChatDirectionSettings: settings,
    window: { addEventListener(type, handler, capture) {
      assert.equal(capture, true);
      listeners.set(type, handler);
    } },
    chrome: { runtime: { sendMessage: async message => { sent.push(message); return { ok: true }; } } }
  });
  for (const script of ["site-adapter-registry.js", "adapters/chatgpt.js", "adapters/gemini.js", "adapters/claude.js", "adapters/grok.js", "sidebar-navigation.js"]) {
    vm.runInContext(read(script), context, { filename: script });
  }
  const site = context.ChatDirectionControl.getCurrentSiteAdapter(location);
  function event(type, target, overrides = {}) {
    const e = { target, button: 1, isTrusted: true, defaultPrevented: false,
      ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
      preventDefault() { this.defaultPrevented = true; },
      stopImmediatePropagation() { this.stopped = true; }, ...overrides };
    listeners.get(type)?.(e);
    return e;
  }
  return { setEnabled(value) { enabled = value; subscriptions.forEach(fn => fn()); }, document, site, sent, listeners, event, el: id => document.getElementById(id) };
}

test("recent title and row resolve the exposed ID, never the title", () => {
  const h = pageHarness();
  for (const id of ["recent", "recent-title"]) {
    const result = h.site.getSidebarConversationLink(h.el(id));
    assert.equal(result.element, h.el("recent"));
    assert.equal(result.url, URL_VALUE);
  }
});

test("project conversations, section headings, gaps, native links and non-sidebar messages are excluded", () => {
  const h = pageHarness();
  for (const id of ["project-chat", "project-chat-title", "recents-heading", "empty-space", "native-link", "outside-title", "recent-container", "main"]) {
    assert.equal(h.site.getSidebarConversationLink(h.el(id)), null, id);
    assert.equal(h.event("mousedown", h.el(id)).defaultPrevented, false, id);
    h.event("auxclick", h.el(id));
  }
  assert.equal(h.sent.length, 0);
});

test("project and pinned folder rows, titles and icons open once on release", () => {
  for (const prefix of ["project-heading", "pinned-project"]) {
    for (const suffix of ["", "-title", "-icon"]) {
      const h = pageHarness();
      const target = h.el(prefix + suffix);
      const link = h.site.getSidebarConversationLink(target);
      assert.equal(link.element, h.el(prefix));
      assert.equal(link.url, PROJECT_URL);
      assert.equal(h.event("mousedown", target).defaultPrevented, true);
      assert.equal(h.sent.length, 0);
      assert.equal(h.event("auxclick", target).defaultPrevented, true);
      h.event("auxclick", target);
      assert.equal(h.sent.length, 1);
      assert.equal(h.sent[0].url, PROJECT_URL);
    }
  }
});

test("project nested controls and their SVG children remain native", () => {
  const h = pageHarness();
  for (const target of h.el("project-heading").querySelectorAll("button, button *")) {
    assert.equal(h.site.getSidebarConversationLink(target), null);
    assert.equal(h.event("mousedown", target).defaultPrevented, false);
    h.event("auxclick", target);
  }
  assert.equal(h.sent.length, 0);
});

test("project IDs must be valid and belong to an enabled sidebar folder row", () => {
  const h = pageHarness();
  const folder = h.el("project-heading");
  for (const id of ["", "g-p-example", ID, `${PROJECT_ID}?x`, `${PROJECT_ID}/project`, "../settings"]) {
    folder.setAttribute("data-app-action-sidebar-project-id", id);
    assert.equal(h.site.getSidebarConversationLink(h.el("project-heading-title")), null, id);
  }
  folder.removeAttribute("data-app-action-sidebar-project-id");
  assert.equal(h.site.getSidebarConversationLink(folder), null);
  folder.setAttribute("data-app-action-sidebar-project-id", PROJECT_ID);
  folder.setAttribute("aria-disabled", "true");
  assert.equal(h.site.getSidebarConversationLink(folder), null);
  folder.removeAttribute("aria-disabled");
  folder.removeAttribute("data-app-action-sidebar-project-row");
  assert.equal(h.site.getSidebarConversationLink(folder), null);
  folder.setAttribute("data-app-action-sidebar-project-row", "");
  h.el("main").appendChild(folder);
  assert.equal(h.site.getSidebarConversationLink(folder), null);
});

test("project ID changes or release over a child conversation cancel opening", () => {
  for (const cancel of ["id-change", "child-conversation"]) {
    const h = pageHarness();
    h.event("mousedown", h.el("project-heading-title"));
    if (cancel === "id-change") h.el("project-heading").setAttribute("data-app-action-sidebar-project-id", "g-p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    h.event("auxclick", h.el(cancel === "id-change" ? "project-heading-title" : "project-chat-title"));
    assert.equal(h.sent.length, 0);
  }
});

test("menu/pin controls, child SVGs, links and rename fields are excluded", () => {
  const h = pageHarness();
  const rowNode = h.el("recent");
  for (const tag of ["input", "textarea", "select", "a"]) rowNode.appendChild(h.document.createElement(tag));
  const editable = h.document.createElement("span");
  editable.setAttribute("contenteditable", "true"); rowNode.appendChild(editable);
  for (const target of [...rowNode.querySelectorAll("button, button *, input, textarea, select, a"), editable]) {
    assert.equal(h.site.getSidebarConversationLink(target), null);
  }
});

test("missing/malformed identifiers and disabled rows fail closed", () => {
  const h = pageHarness();
  for (const key of ["", `other:${ID}`, "chatgpt:conversation:../settings", `chatgpt:conversation:${ID}?x`, `chatgpt:conversation:${ID}/more`]) {
    h.el("recent-container").setAttribute("data-sidebar-chatgpt-conversation-key", key);
    assert.equal(h.site.getSidebarConversationLink(h.el("recent-title")), null);
  }
  h.el("recent-container").setAttribute("data-sidebar-chatgpt-conversation-key", `chatgpt:conversation:${ID}`);
  h.el("recent").setAttribute("aria-disabled", "true");
  assert.equal(h.site.getSidebarConversationLink(h.el("recent-title")), null);
});

test("mousedown blocks autoscroll; auxclick requests exactly one background tab", () => {
  const h = pageHarness();
  const target = h.el("recent-title");
  const down = h.event("mousedown", target);
  assert.equal(down.defaultPrevented, true);
  assert.equal(down.stopped, true);
  assert.equal(h.sent.length, 0);
  const up = h.event("auxclick", target);
  assert.equal(up.defaultPrevented, true);
  assert.equal(up.stopped, true);
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].url, URL_VALUE);
  assert.equal(h.sent[0].type, "cdc:open-sidebar-tab");
  h.event("auxclick", target);
  assert.equal(h.sent.length, 1);
});

test("left/right buttons, modifiers, synthetic and already-handled events remain native", () => {
  for (const target of ["recent-title", "project-heading-title"]) {
    for (const override of [{button:0}, {button:2}, {ctrlKey:true}, {metaKey:true}, {altKey:true}, {shiftKey:true}, {isTrusted:false}, {defaultPrevented:true}]) {
      const h = pageHarness();
      const down = h.event("mousedown", h.el(target), override);
      h.event("auxclick", h.el(target), override);
      assert.equal(!!down.stopped, false);
      assert.equal(h.sent.length, 0);
    }
  }
});

test("wheel scrolling has no listener and cannot open a tab", () => {
  const h = pageHarness();
  assert.equal(h.listeners.has("wheel"), false);
  h.event("wheel", h.el("recent-title"));
  assert.equal(h.sent.length, 0);
});

test("release elsewhere, row ID changes, cancellation and DOM replacement do not open", () => {
  for (const cancel of ["elsewhere", "key-change", "replacement", "blur", "pagehide", "dragstart", "pointercancel"]) {
    const h = pageHarness();
    h.event("mousedown", h.el("recent-title"));
    if (cancel === "key-change") h.el("recent-container").setAttribute("data-sidebar-chatgpt-conversation-key", `chatgpt:conversation:${OTHER_ID}`);
    else if (cancel === "replacement") h.el("recent").replaceWith(h.el("recent").cloneNode(true));
    else if (cancel !== "elsewhere") h.event(cancel, h.el("recent-title"));
    h.event("auxclick", h.el(cancel === "elsewhere" ? "empty-space" : "recent-title"));
    assert.equal(h.sent.length, 0, cancel);
  }
});

test("dynamically inserted recent rows work without rescanning", () => {
  const h = pageHarness();
  const clone = h.el("recent-container").cloneNode(true);
  clone.setAttribute("data-sidebar-chatgpt-conversation-key", `chatgpt:conversation:${OTHER_ID}`);
  h.el("recent-container").parentElement.appendChild(clone);
  const title = clone.querySelector("[data-thread-title]");
  h.event("mousedown", title); h.event("auxclick", title);
  assert.equal(h.sent[0].url, `${ORIGIN}/c/${OTHER_ID}`);
});

test("other chatbot adapters do not opt in", () => {
  for (const host of ["gemini.google.com", "claude.ai", "grok.com"]) {
    assert.equal(pageHarness(host).listeners.size, 0);
  }
});

function workerHarness(failCreation = false, preferences = { "cdc:settings:chatgpt.middleClick": true }) {
  const { storage } = storageHarness(preferences);
  let onMessage;
  const created = [];
  const context = vm.createContext({ URL, console, chrome: {
    storage,
    runtime: { id:"extension-id", onMessage:{addListener(fn) {onMessage=fn;}} },
    tabs: { create: async options => {
      if (failCreation) throw new Error("Tab closed");
      created.push(options); return {id:99};
    } }
  } });
  context.importScripts = (...files) => files.forEach(file => vm.runInContext(read(file), context, {filename:file}));
  vm.runInContext(read("background.js"), context);
  const sender = {id:"extension-id",frameId:0,url:`${ORIGIN}/`,tab:{id:7,windowId:3}};
  const request = (url = URL_VALUE, overrides = {}) => new Promise(resolve => {
    onMessage({type:"cdc:open-sidebar-tab",url}, {...sender,...overrides}, resolve);
  });
  return { created, request, onMessage, sender };
}

test("worker opens inactive tab in the source window without changing the source", async () => {
  for (const url of [URL_VALUE, PROJECT_URL]) {
    const h = workerHarness();
    assert.equal((await h.request(url)).ok, true);
    assert.deepEqual(JSON.parse(JSON.stringify(h.created)), [{url,active:false,windowId:3,openerTabId:7}]);
  }
});

test("worker rejects malformed project routes and unsafe project URLs", async () => {
  const h = workerHarness();
  for (const url of [
    `${PROJECT_URL}?x=1`, `${PROJECT_URL}#x`, `${PROJECT_URL}/`,
    `${ORIGIN}/g/g-p-invalid/project`, `${ORIGIN}/g/${PROJECT_ID}/settings`,
    `${ORIGIN}/g/${PROJECT_ID}/c/${ID}`, `${ORIGIN}/g/${PROJECT_ID}`,
    `https://example.com/g/${PROJECT_ID}/project`,
    `https://u:p@chatgpt.com/g/${PROJECT_ID}/project`,
    `https://chatgpt.com:8443/g/${PROJECT_ID}/project`,
    `http://chatgpt.com/g/${PROJECT_ID}/project`
  ]) assert.equal((await h.request(url)).ok, false, url);
  assert.equal(h.created.length, 0);
});

test("worker rejects unsafe URLs and invalid senders", async () => {
  const h = workerHarness();
  for (const url of ["javascript:alert(1)", "file:///etc/passwd", `https://example.com/c/${ID}`, `${ORIGIN}/settings`, `${URL_VALUE}?x=1`, `${URL_VALUE}#x`, `https://u:p@chatgpt.com/c/${ID}`, `http://chatgpt.com/c/${ID}`, `https://chatgpt.com:8443/c/${ID}`, "/c/"+ID, null]) {
    assert.equal((await h.request(url)).ok, false, String(url));
  }
  for (const sender of [{id:"other-extension"}, {frameId:1}, {tab:undefined}, {tab:{id:-1,windowId:3}}, {url:"https://example.com/"}, {url:"https://gemini.google.com/"}]) {
    assert.equal((await h.request(URL_VALUE,sender)).ok, false);
  }
  assert.equal(h.created.length, 0);
});

test("legacy ChatGPT domain cannot activate the controller or open tabs", async () => {
  const legacyOrigin = "https://chat.openai.com";
  const legacyUrl = `${legacyOrigin}/c/${ID}`;
  assert.equal(pageHarness("chat.openai.com").listeners.size, 0);
  assert.equal(pageHarness().site.isSidebarConversationUrl(new URL(legacyUrl)), false);
  const h = workerHarness();
  assert.equal((await h.request(legacyUrl, { url: `${legacyOrigin}/` })).ok, false);
  assert.equal(h.created.length, 0);
});

test("worker reports tab-creation failures and ignores unrelated messages", async () => {
  const h = workerHarness(true);
  assert.equal((await h.request()).ok, false);
  assert.equal(h.onMessage({type:"other"},h.sender,()=>assert.fail("Unexpected response")), undefined);
});

test("manifest includes the worker/controller, with unchanged version and permissions", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.equal(manifest.version, "1.0.7");
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.equal(manifest.background.service_worker, "background.js");
  assert(manifest.content_scripts[0].js.includes("sidebar-navigation.js"));
  for (const script of manifest.content_scripts[0].js) assert(fs.existsSync(path.join(root,script)));
});


test("disabled middle-click leaves native events alone and cancels a pending press", () => {
  const h = pageHarness("chatgpt.com", false);
  const target = h.el("recent-title");
  assert.equal(h.event("mousedown", target).defaultPrevented, false);
  h.event("auxclick", target);
  assert.equal(h.sent.length, 0);
  h.setEnabled(true);
  assert.equal(h.event("mousedown", target).defaultPrevented, true);
  h.setEnabled(false);
  h.setEnabled(true);
  h.event("auxclick", target);
  assert.equal(h.sent.length, 0);
});

test("worker refuses default-off middle-click and master-off requests", async () => {
  for (const preferences of [{}, { "cdc:settings:chatgpt.middleClick": true, "cdc:settings:enabled": false }]) {
    const h = workerHarness(false, preferences);
    assert.equal((await h.request()).ok, false);
    assert.equal(h.created.length, 0);
  }
});
