const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { parseHTML } = require("linkedom");
const { storageHarness } = require("./storage-harness.cjs");
const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const run = (context, file) => vm.runInContext(read(file), context, { filename: file });
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };

function workerHarness(preferences = {}) {
  const store = storageHarness(preferences);
  const menus = new Map(), routed = [], subscribers = [];
  let click;
  const manifest = JSON.parse(read("manifest.json"));
  const context = vm.createContext({ URL, console, chrome: {
    storage: store.storage,
    runtime: { getManifest: () => manifest },
    contextMenus: {
      update: async (id, props) => { if (!menus.has(id)) throw Error("Missing menu"); menus.set(id, props); },
      create: (props, callback) => { menus.set(props.id, props); callback(); },
      onClicked: { addListener(fn) { click = fn; } }
    },
    tabs: { sendMessage: async (...args) => { routed.push(args); } }
  } });
  for (const file of ["settings.js", "site-adapter-registry.js", "adapters/chatgpt.js", "adapters/gemini.js", "adapters/claude.js", "adapters/grok.js", "floating-panel-background.js"]) run(context, file);
  return { menus, routed, store, settings: context.ChatDirectionSettings, click: (...args) => click(...args) };
}

test("native pin menu follows per-site/master preferences and routes only a validated top-level page", async () => {
  const h = workerHarness(); await flush();
  const id = "cdc:pin-floating-panel";
  assert.equal(h.menus.size, 1);
  assert.equal(h.menus.get(id).documentUrlPatterns.length, 4);
  assert.deepEqual(Array.from(h.menus.get(id).contexts),["selection","page"]);
  const info = { menuItemId: id, pageUrl: "https://chatgpt.com/c/test", frameId: 0, editable: false };
  await h.click(info, { id: 7 });
  assert.equal(h.routed.length, 1);
  assert.equal(h.routed[0][0], 7);
  assert.equal(h.routed[0][1].type, id);
  assert.equal(h.routed[0][2].frameId, 0);
  for (const overrides of [{frameId:1}, {editable:true}, {mediaType:"image"}, {pageUrl:"https://example.com"}, {pageUrl:"http://chatgpt.com/"}, {menuItemId:"other"}]) await h.click({...info,...overrides}, {id:7});
  assert.equal(h.routed.length, 1);
  await h.settings.set("chatgpt.floatingPanel", false); await flush();
  assert(!h.menus.get(id).documentUrlPatterns.includes("https://chatgpt.com/*"));
  await h.click(info, {id:7}); assert.equal(h.routed.length, 1);
  await h.settings.set("enabled", false); await flush();
  assert.equal(h.menus.get(id).visible, false);
  await h.settings.set("enabled", true); await flush();
  assert.equal(h.menus.get(id).visible, true);
  assert.equal(h.menus.size, 1);
});

function pageHarness() {
  const { document, Element, HTMLElement, Node, Event } = parseHTML(`<html><body><article>
    <p id="text">A quiet river.</p>
    <span id="equation" data-math-display="true" data-math-source="a_1+g"><span class="katex"><span class="katex-mathml"><math><mtext>Hidden equation</mtext></math></span><span class="katex-html"><span id="part">a</span><sub>1</sub><span> + g</span></span></span></span>
    <div id="unsafe"><b onclick="bad()">Bold</b><script>bad()</script><iframe></iframe><a href="javascript:bad()">Link</a><button>Button</button><img alt="Excluded"><svg xmlns="http://www.w3.org/2000/svg"><text>Excluded graphic</text></svg></div>
    <textarea id="editor">Draft</textarea></article></body></html>`);
  const shadows = new Map(), subscriptions = [], listeners = new Map();
  let enabled = true, selection = null, receiver;
  const originalAttach = HTMLElement.prototype.attachShadow;
  HTMLElement.prototype.attachShadow = function(options) {
    const shadow = originalAttach.call(this, options); shadows.set(this, shadow); return shadow;
  };
  const computed = {
    color: "rgb(30, 30, 30)", backgroundColor: "rgb(255, 255, 255)", width: "64px",
    getPropertyValue: property => ({"font-family":"TestMath", "font-size":"16px", display:"inline", "line-height":"24px"}[property] || "")
  };
  const context = vm.createContext({ document, Element, HTMLElement, Node, URL, console,
    location: new URL("https://chatgpt.com/c/test"), getComputedStyle: () => computed,
    matchMedia: () => ({matches:false}), innerWidth: 1000, innerHeight: 800,
    setTimeout: () => 1, clearTimeout() {},
    window: { getSelection: () => selection, addEventListener: (type, fn) => listeners.set(type,fn) },
    ChatDirectionControl: { getCurrentSiteAdapter: () => ({id:"chatgpt"}) },
    ChatDirectionSettings: { enabled: () => enabled, subscribe: fn => subscriptions.push(fn) },
    chrome: { runtime: { id:"extension", onMessage: {addListener(fn) {receiver=fn;}} } }
  });
  run(context, "floating-panel.js");
  const el = id => document.getElementById(id);
  const shadow = () => shadows.get(el("cdc-floating-panel"));
  return {document, el, shadow,
    select(range) { selection={rangeCount:1,isCollapsed:false,containsNode:()=>true,getRangeAt:()=>({cloneRange:()=>range})}; },
    context(id) { el(id).dispatchEvent(new Event("contextmenu",{bubbles:true})); },
    pin(sender="extension") { let response;receiver({type:"cdc:pin-floating-panel"},{id:sender},value=>response=value);return response; },
    disable() {enabled=false; subscriptions.forEach(fn=>fn());},
    navigate() {context.location=new URL("https://chatgpt.com/c/another");}
  };
}

test("a partially selected equation stays whole, copies typography and survives source replacement", () => {
  const h = pageHarness(), text = h.el("part").firstChild;
  h.select({startContainer:text,endContainer:text,startOffset:0,endOffset:1,commonAncestorContainer:text,intersectsNode:()=>true});
  h.context("part"); h.el("equation").remove();
  assert.equal(h.pin().ok,true);
  const content = h.shadow().querySelector(".content");
  assert.equal(content.textContent,"a1 + g");
  assert.equal(content.querySelector("[data-cdc-equation]").style.fontFamily,"TestMath");
  assert.equal(content.querySelectorAll("[id]").length,0);
  assert.equal(content.querySelectorAll("math").length,0,"hidden MathML must not leak out of its original clipping CSS");
  assert.equal(content.querySelector("[data-cdc-equation]").getAttribute("aria-label"),"a_1+g");
});

test("a selection ending on an empty equation boundary does not expand unselected math", () => {
  const h=pageHarness(), source=h.el("text").parentElement, equation=h.el("equation");
  h.select({commonAncestorContainer:source,intersectsNode:node =>
    node===source || node===h.el("text") || node===h.el("text").firstChild || node===equation});
  h.context("text");h.pin();
  const content=h.shadow().querySelector(".content");
  assert.equal(content.textContent,"A quiet river.");
  assert.equal(content.querySelectorAll("[data-cdc-equation]").length,0);
});

test("pinning replaces one panel, expands a collapsed panel and disabling closes it", () => {
  const h = pageHarness();h.context("part");h.pin();
  const host = h.el("cdc-floating-panel");
  h.shadow().querySelector(".collapse").click();
  assert.equal(host.style.height,"40px");
  const text=h.el("text").firstChild;
  h.select({commonAncestorContainer:text,startContainer:text,endContainer:text,startOffset:0,endOffset:text.textContent.length,intersectsNode:()=>true});
  h.context("text");h.pin();
  assert.equal(h.el("cdc-floating-panel"),host);
  assert.equal(h.shadow().querySelector(".content").textContent,"A quiet river.");
  assert.equal(h.shadow().querySelector(".collapse").getAttribute("aria-expanded"),"true");
  h.disable();assert.equal(h.el("cdc-floating-panel"),null);
});

test("mixed selected content excludes scripts, frames, handlers, controls and active links", () => {
  const h=pageHarness(), source=h.el("unsafe");
  h.select({commonAncestorContainer:source,intersectsNode:()=>true});
  h.context("unsafe");h.pin();
  const content=h.shadow().querySelector(".content");
  assert.equal(content.textContent,"BoldLink");
  assert.equal(content.querySelectorAll("script, iframe, button, img, svg, [onclick], [href], [id]").length,0);
});

test("pin action rejects other senders, edits and a menu opened before navigation", () => {
  const h=pageHarness();h.context("part");h.pin("another-extension");
  assert.equal(h.el("cdc-floating-panel"),null);
  h.navigate();assert.equal(h.pin().ok,false);
  h.context("editor");assert.equal(h.pin().ok,false);
  assert.equal(h.el("cdc-floating-panel"),null);
});
