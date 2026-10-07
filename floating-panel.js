(() => {
  "use strict";
  const site = globalThis.ChatDirectionControl?.getCurrentSiteAdapter();
  const settings = globalThis.ChatDirectionSettings;
  if (!site || !settings) return;

  const HOST_ID = "cdc-floating-panel";
  const MATH_SELECTOR = "[data-math-source], [data-math-display], .katex-display, .katex, mjx-container, math";
  const SKIP = new Set(["script", "style", "iframe", "object", "embed", "input", "textarea", "select", "button", "link", "meta", "audio", "video"]);
  const HTML_TAGS = new Set("a abbr b bdi bdo blockquote br code dd del div dl dt em figcaption figure h1 h2 h3 h4 h5 h6 hr i img kbd li mark ol p pre s samp small span strong sub sup table tbody td th thead tr tfoot u ul wbr".split(" "));
  const VECTOR_TAGS = new Set("svg g path line rect circle ellipse polygon polyline text tspan".split(" "));
  const MATH_TAGS = new Set("math semantics annotation mrow mi mn mo mtext mspace msub msup msubsup mfrac msqrt mroot munder mover munderover mtable mtr mtd menclose mpadded mphantom".split(" "));
  const TEXT_STYLES = "color font-family font-size font-style font-weight font-variant line-height letter-spacing word-spacing white-space text-decoration text-align direction unicode-bidi vertical-align display".split(" ");
  const MATH_STYLES = "position top right bottom left width height min-width max-width min-height max-height margin-top margin-right margin-bottom margin-left padding-top padding-right padding-bottom padding-left border-top-width border-right-width border-bottom-width border-left-width border-top-style border-right-style border-bottom-style border-left-style border-color box-sizing transform transform-origin overflow fill stroke stroke-width".split(" ");
  const VECTOR_ATTRS = new Set("viewBox d x y x1 y1 x2 y2 cx cy r rx ry width height points transform fill stroke stroke-width preserveAspectRatio xmlns".split(" "));
  const MATH_ATTRS = new Set("display encoding mathvariant stretchy fence separator lspace rspace accent accentunder columnalign rowalign columnspacing rowspacing colspan rowspan".split(" "));
  const MAX_NODES = 6000;
  const GAP = 12;
  let pending = null;
  let panel = null;
  let toastTimer;
  const enabled = () => settings.enabled(site.id, "floatingPanel");

  function elementOf(node) { return node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement; }
  function editable(element) { return element?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'); }
  function mathRoot(element) {
    return element?.closest("[data-math-source], [data-math-display]") ||
      element?.closest(".katex-display") || element?.closest(".katex, mjx-container, math");
  }
  function safeImageUrl(value) {
    try {
      const url = new URL(value, location.href);
      return ["https:", "http:", "blob:"].includes(url.protocol) ||
        /^data:image\/(png|jpeg|gif|webp|avif|bmp);/i.test(value) ? url.href : null;
    } catch { return null; }
  }

  /**
   * Build an inert snapshot rather than inserting source HTML. Only presentation
   * tags/attributes are copied; scripts, event handlers, IDs, custom elements and
   * external SVG references are excluded. Computed styles preserve KaTeX's font
   * metrics and nested layout inside the panel's isolated shadow tree.
   */
  function snapshotNode(source, range, budget, inMath = false) {
    if (++budget.count > MAX_NODES) throw new Error("Selection is too large");
    if (range && !range.intersectsNode(source)) return null;
    if (source.nodeType === Node.TEXT_NODE) {
      const start = range?.startContainer === source ? range.startOffset : 0;
      const end = range?.endContainer === source ? range.endOffset : source.textContent.length;
      return document.createTextNode(source.textContent.slice(start, end));
    }
    if (source.nodeType !== Node.ELEMENT_NODE) return null;
    const tag = source.localName;
    if (SKIP.has(tag) || editable(source)) return null;
    const isMath = inMath || source.matches(MATH_SELECTOR);
    // Intersecting any part of an equation captures its complete rendered tree.
    if (isMath) range = null;
    let copy;
    const svg = source.namespaceURI === "http://www.w3.org/2000/svg";
    const math = source.namespaceURI === "http://www.w3.org/1998/Math/MathML";
    if (svg && !VECTOR_TAGS.has(tag)) return null;
    if (math && !MATH_TAGS.has(tag)) return null;
    copy = document.createElementNS(svg || math ? source.namespaceURI : "http://www.w3.org/1999/xhtml",
      svg || math || HTML_TAGS.has(tag) ? tag : "span");
    const computed = getComputedStyle(source);
    for (const property of [...TEXT_STYLES, ...(isMath ? MATH_STYLES : [])]) {
      const value = computed.getPropertyValue(property);
      if (value && !/url\s*\(/i.test(value)) copy.style.setProperty(property, value);
    }
    // Snapshot layout must never create viewport-positioned descendants.
    if (["fixed", "sticky"].includes(copy.style.position)) copy.style.position = "static";
    if (isMath) copy.style.direction = "ltr";
    // Computed block widths belong to the original response column. Keeping
    // them would center the formula outside the narrower panel's visible area.
    if (source.matches("[data-math-source], [data-math-display], .katex-display, .katex, .katex-html, mjx-container")) {
      copy.style.width = "auto";
      copy.style.minWidth = "0";
    }
    if (source.hasAttribute("dir")) copy.setAttribute("dir", source.getAttribute("dir"));
    if (source.hasAttribute("aria-hidden")) copy.setAttribute("aria-hidden", source.getAttribute("aria-hidden"));
    for (const attr of source.attributes) {
      if ((svg && VECTOR_ATTRS.has(attr.name) || math && MATH_ATTRS.has(attr.name)) && !/url\s*\(/i.test(attr.value)) {
        copy.setAttribute(attr.name, attr.value);
      }
    }
    if (tag === "img") {
      const src = safeImageUrl(source.currentSrc || source.src);
      if (!src) return null;
      copy.src = src;
      copy.alt = source.alt || "Pinned image";
      copy.referrerPolicy = "no-referrer";
      copy.style.width = computed.width;
      copy.style.height = "auto";
    }
    if (["td", "th"].includes(tag)) {
      for (const attr of ["colspan", "rowspan"]) if (source.hasAttribute(attr)) copy.setAttribute(attr, source.getAttribute(attr));
    }
    // Links intentionally become inert styled text inside the reference panel.
    for (const child of source.childNodes) {
      const cloned = snapshotNode(child, range, budget, isMath);
      if (cloned) copy.appendChild(cloned);
    }
    return copy;
  }

  function backdrop(element) {
    for (let current = element; current; current = current.parentElement) {
      const color = getComputedStyle(current).backgroundColor;
      if (color && color !== "transparent" && color !== "rgba(0, 0, 0, 0)") return color;
    }
    return matchMedia("(prefers-color-scheme: dark)").matches ? "#212121" : "#ffffff";
  }

  function capture(target) {
    if (editable(target)) return null;
    const fragment = document.createDocumentFragment();
    const selection = window.getSelection();
    let source = target.closest("img") || mathRoot(target);
    let range = null;
    // A selection inside the right-click target wins over a directly clicked
    // equation, allowing text + several equations to be pinned together.
    if (!target.closest("img") && selection?.rangeCount && !selection.isCollapsed &&
        selection.containsNode(target, true)) {
      range = selection.getRangeAt(0).cloneRange();
      if (editable(elementOf(range.startContainer)) || editable(elementOf(range.endContainer))) return null;
      source = mathRoot(elementOf(range.commonAncestorContainer)) || elementOf(range.commonAncestorContainer);
    }
    if (!source) return { error: "Select text, or right-click an equation or image to pin it." };
    try {
      const copy = snapshotNode(source, range, { count: 0 });
      if (!copy || !(copy.textContent.trim() || copy.matches?.("img, svg") || copy.querySelector?.("img, svg"))) return null;
      // Display equation wrappers should fit the panel; internal math widths
      // and positioning remain intact, and oversized formulas can scroll.
      if (mathRoot(source)) {
        copy.style.width = "auto";
        copy.style.minWidth = "0";
        copy.style.direction = "ltr";
        copy.style.unicodeBidi = "isolate";
      }
      fragment.appendChild(copy);
      return { fragment, background: backdrop(source), color: getComputedStyle(source).color };
    } catch {
      return { error: "This selection is too large. Select a smaller section." };
    }
  }

  const PANEL_CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .panel { display:flex; flex-direction:column; width:100%; height:100%; overflow:hidden;
      border:1px solid #626269; border-radius:12px; background:#252529; color:#f3f3f5;
      box-shadow:0 8px 32px #0006; font:14px/1.4 system-ui,sans-serif; }
    header { display:flex; flex:none; align-items:center; gap:8px; padding:6px 8px 6px 12px;
      height:40px; cursor:grab; user-select:none; touch-action:none; direction:ltr; }
    header:active { cursor:grabbing; }
    .title { flex:1; font-weight:600; }
    button { font:20px/1 system-ui; display:grid; place-items:center; width:28px; height:28px;
      padding:0; border:0; border-radius:6px; color:inherit; background:transparent; cursor:pointer; }
    button:hover { background:#ffffff20; }
    button:focus-visible, header:focus-visible { outline:2px solid #aab8ff; outline-offset:-2px; }
    .content { flex:1; min-height:0; overflow:auto; padding:14px; user-select:text; }
    .content img { max-width:100%; max-height:360px; height:auto; object-fit:contain; }
    .content pre, .content code { direction:ltr !important; unicode-bidi:isolate; }
    .resize { position:absolute; right:2px; bottom:2px; width:18px; height:18px;
      cursor:nwse-resize; touch-action:none; color:#97979e; }
    .resize::after { content:'◢'; position:absolute; right:2px; bottom:0; font-size:14px; }
    .collapsed .content, .collapsed .resize { display:none; }
    .toast { padding:10px 14px; border-radius:8px; background:#252529; color:#fff;
      box-shadow:0 4px 16px #0005; font:14px/1.4 system-ui; max-width:360px; }
  `;

  function closePanel() {
    panel?.host.remove();
    panel = null;
  }
  function clamp(value, min, max) { return Math.max(min, Math.min(value, max)); }
  function place() {
    if (!panel) return;
    const { host, collapsed } = panel;
    const width = clamp(panel.width, Math.min(220, innerWidth - GAP * 2), innerWidth - GAP * 2);
    const height = collapsed ? 40 : clamp(panel.height, Math.min(100, innerHeight - GAP * 2), innerHeight - GAP * 2);
    panel.x = clamp(panel.x, GAP, innerWidth - width - GAP);
    panel.y = clamp(panel.y, GAP, innerHeight - height - GAP);
    for (const [key, value] of Object.entries({ left: panel.x, top: panel.y, width, height })) {
      host.style.setProperty(key, `${value}px`, "important");
    }
  }
  function fixedHost() {
    const host = document.createElement("div");
    for (const [key, value] of Object.entries({ all: "initial", position: "fixed", "z-index": "2147483647", display: "block", margin: "0", padding: "0", "box-sizing": "border-box" })) {
      host.style.setProperty(key, value, "important");
    }
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = PANEL_CSS;
    shadow.appendChild(style);
    // Stop application shortcuts/click delegation while using the reference.
    for (const type of ["click", "dblclick", "keydown", "keyup", "pointerdown", "pointerup", "contextmenu"]) {
      host.addEventListener(type, event => event.stopPropagation());
    }
    return { host, shadow };
  }
  function notify(message) {
    document.getElementById("cdc-floating-toast")?.remove();
    clearTimeout(toastTimer);
    const { host, shadow } = fixedHost();
    host.id = "cdc-floating-toast";
    host.style.setProperty("right", "16px", "important");
    host.style.setProperty("bottom", "16px", "important");
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.setAttribute("role", "status");
    toast.textContent = message;
    shadow.appendChild(toast);
    document.documentElement.appendChild(host);
    toastTimer = setTimeout(() => host.remove(), 4000);
  }

  function createPanel() {
    const { host, shadow } = fixedHost();
    host.id = HOST_ID;
    // This is extension-owned static markup; source content is never innerHTML.
    const shell = document.createElement("section");
    shell.className = "panel";
    shell.setAttribute("role", "dialog");
    shell.setAttribute("aria-label", "Pinned reference");
    shell.innerHTML = '<header tabindex="0" aria-label="Move pinned reference using arrow keys"><span class="title">Pinned reference</span><button type="button" class="collapse" aria-label="Collapse panel" aria-expanded="true" title="Collapse">−</button><button type="button" class="close" aria-label="Close panel" title="Close">×</button></header><div class="content"></div><div class="resize" title="Resize panel"></div>';
    shadow.appendChild(shell);
    document.documentElement.appendChild(host);
    panel = { host, shell, content: shell.querySelector(".content"), collapsed: false,
      width: 380, height: 260, x: innerWidth - 400, y: 80 };
    const header = shell.querySelector("header");
    const collapse = shell.querySelector(".collapse");
    shell.querySelector(".close").addEventListener("click", closePanel);
    collapse.addEventListener("click", () => {
      panel.collapsed = !panel.collapsed;
      shell.classList.toggle("collapsed", panel.collapsed);
      collapse.textContent = panel.collapsed ? "+" : "−";
      collapse.title = panel.collapsed ? "Expand" : "Collapse";
      collapse.setAttribute("aria-label", `${collapse.title} panel`);
      collapse.setAttribute("aria-expanded", String(!panel.collapsed));
      place();
    });
    header.addEventListener("keydown", event => {
      if (event.target !== header) return;
      const moves = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] };
      if (!moves[event.key]) return;
      event.preventDefault();
      panel.x += moves[event.key][0]; panel.y += moves[event.key][1]; place();
    });
    shell.addEventListener("keydown", event => { if (event.key === "Escape") closePanel(); });
    for (const [handle, resize] of [[header, false], [shell.querySelector(".resize"), true]]) {
      let gesture = null;
      handle.addEventListener("pointerdown", event => {
        if (event.button !== 0 || event.target.closest("button")) return;
        event.preventDefault();
        gesture = { id: event.pointerId, x: event.clientX, y: event.clientY,
          left: panel.x, top: panel.y, width: host.offsetWidth, height: host.offsetHeight };
        handle.setPointerCapture(event.pointerId);
      });
      handle.addEventListener("pointermove", event => {
        if (!gesture || event.pointerId !== gesture.id || !panel) return;
        const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
        if (resize) {
          panel.width = clamp(gesture.width + dx, 220, innerWidth - panel.x - GAP);
          panel.height = clamp(gesture.height + dy, 100, innerHeight - panel.y - GAP);
        } else { panel.x = gesture.left + dx; panel.y = gesture.top + dy; }
        place();
      });
      for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) handle.addEventListener(event, () => { gesture = null; });
    }
    place();
  }

  document.addEventListener("contextmenu", event => {
    pending = null;
    if (!enabled() || !(event.target instanceof Element) || event.composedPath().some(node => node?.id === HOST_ID)) return;
    const captured = capture(event.target);
    if (captured) pending = { ...captured, url: location.href };
  }, true);
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type !== "cdc:pin-floating-panel" || sender.id !== chrome.runtime.id) return;
    if (!enabled() || !pending || pending.url !== location.href) { respond({ ok: false }); return; }
    if (pending.error) { notify(pending.error); respond({ ok: false }); return; }
    if (!panel) createPanel();
    const collapse = panel.shell.querySelector(".collapse");
    panel.collapsed = false;
    panel.shell.classList.remove("collapsed");
    collapse.textContent = "−"; collapse.title = "Collapse";
    collapse.setAttribute("aria-label", "Collapse panel"); collapse.setAttribute("aria-expanded", "true");
    panel.content.style.background = pending.background;
    panel.content.style.color = pending.color;
    panel.content.replaceChildren(pending.fragment.cloneNode(true));
    place();
    respond({ ok: true });
  });
  settings.subscribe(() => {
    if (!enabled()) { pending = null; closePanel(); document.getElementById("cdc-floating-toast")?.remove(); }
  });
  window.addEventListener("resize", place);
  window.addEventListener("pagehide", () => { pending = null; closePanel(); });
})();
