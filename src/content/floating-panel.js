(() => {
  "use strict";
  const site = globalThis.ChatDirectionControl?.getCurrentSiteAdapter();
  const settings = globalThis.ChatDirectionSettings;
  if (!site || !settings) return;

  const HOST_ID = "cdc-floating-panel";
  const MATH_SELECTOR = "[data-math-source], [data-math-display], .katex-display, .katex, mjx-container, math";
  const MATH_WRAPPER = "[data-math-source], [data-math-display], .katex-display, .katex, .katex-html, mjx-container";
  const SKIP = new Set(["script", "style", "iframe", "object", "embed", "input", "textarea", "select", "button", "link", "meta", "audio", "video", "img", "picture", "canvas"]);
  const HTML_TAGS = new Set("a abbr b bdi bdo blockquote br code dd del div dl dt em figcaption figure h1 h2 h3 h4 h5 h6 hr i kbd li mark ol p pre s samp small span strong sub sup table tbody td th thead tr tfoot u ul wbr".split(" "));
  const VECTOR_TAGS = new Set("svg g path line rect circle ellipse polygon polyline text tspan".split(" "));
  const MATH_TAGS = new Set("math semantics annotation mrow mi mn mo mtext mspace msub msup msubsup mfrac msqrt mroot munder mover munderover mtable mtr mtd menclose mpadded mphantom".split(" "));
  const TEXT_STYLES = "color font-family font-size font-style font-weight font-variant line-height letter-spacing word-spacing white-space text-decoration text-align direction unicode-bidi vertical-align display".split(" ");
  const MATH_STYLES = "position top right bottom left width height min-width max-width min-height max-height margin-top margin-right margin-bottom margin-left padding-top padding-right padding-bottom padding-left border-top-width border-right-width border-bottom-width border-left-width border-top-style border-right-style border-bottom-style border-left-style border-color box-sizing transform transform-origin overflow fill stroke stroke-width".split(" ");
  const VECTOR_ATTRS = new Set("viewBox d x y x1 y1 x2 y2 cx cy r rx ry width height points transform fill stroke stroke-width preserveAspectRatio xmlns".split(" "));
  const MATH_ATTRS = new Set("display encoding mathvariant stretchy fence separator lspace rspace accent accentunder columnalign rowalign columnspacing rowspacing colspan rowspan".split(" "));
  const MAX_NODES = 6000;
  const GAP = 12;
  // Start below the page header and beside the narrow navigation rail.
  const INITIAL_POSITION = { x: 84, y: 56 };
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
  // A range ending at the start of an equation can intersect its outer span
  // without selecting any equation content. Do not expand that empty boundary.
  function selectedMathContent(source, range) {
    if (!range.intersectsNode(source)) return false;
    if (source.nodeType === Node.TEXT_NODE) {
      const start = range.startContainer === source ? range.startOffset : 0;
      const end = range.endContainer === source ? range.endOffset : source.textContent.length;
      return Boolean(source.textContent.slice(start, end).trim());
    }
    return [...source.childNodes].some(child => selectedMathContent(child, range));
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
      // intersectsNode is inclusive at element boundaries. Check the text's
      // actual endpoints before copying anything from a following block.
      if (range && (range.comparePoint(source, 0) > 0 ||
          range.comparePoint(source, source.textContent.length) < 0)) return null;
      const start = range?.startContainer === source ? range.startOffset : 0;
      const end = range?.endContainer === source ? range.endOffset : source.textContent.length;
      const text = source.textContent.slice(start, end);
      return text ? document.createTextNode(text) : null;
    }
    if (source.nodeType !== Node.ELEMENT_NODE) return null;
    const tag = source.localName;
    if (SKIP.has(tag) || editable(source)) return null;
    // KaTeX's hidden accessibility tree uses clipping CSS. Keeping a second
    // positioned tree can leak a sliver of text after clipping styles change.
    if (source.matches(".katex-mathml") && source.parentElement?.querySelector(".katex-html")) return null;
    const isMath = inMath || source.matches(MATH_SELECTOR);
    if (isMath && !inMath && range && !selectedMathContent(source, range)) return null;
    // Intersecting any part of an equation captures its complete rendered tree.
    if (isMath) range = null;
    let copy;
    const svg = source.namespaceURI === "http://www.w3.org/2000/svg";
    const math = source.namespaceURI === "http://www.w3.org/1998/Math/MathML";
    // SVG is retained only as part of a rendered equation (for roots, fences,
    // and other math symbols). Standalone graphics are outside pinning support.
    if (svg && (!isMath || !VECTOR_TAGS.has(tag))) return null;
    if (math && !MATH_TAGS.has(tag)) return null;
    copy = document.createElementNS(svg || math ? source.namespaceURI : "http://www.w3.org/1999/xhtml",
      svg || math || HTML_TAGS.has(tag) ? tag : "span");
    const computed = getComputedStyle(source);
    if (!isMath) {
      // A native paragraph selection may cross screen-reader headings or
      // unselectable page chrome. Those nodes are not part of the visible pin.
      const clipped = computed.position === "absolute" &&
        ["hidden", "clip"].includes(computed.overflow) &&
        parseFloat(computed.width) <= 1 && parseFloat(computed.height) <= 1;
      if (source.hidden || computed.display === "none" ||
          ["hidden", "collapse"].includes(computed.visibility) || clipped ||
          range && computed.userSelect === "none") return null;
    }
    const wrapper = source.matches(MATH_WRAPPER);
    // Only the inner math layout needs exact dimensions/offsets. Wrapper
    // dimensions and overflow belong to ChatGPT's response column and scroller.
    for (const property of [...TEXT_STYLES, ...(isMath && !wrapper ? MATH_STYLES : [])]) {
      const value = computed.getPropertyValue(property);
      if (value && !/url\s*\(/i.test(value)) copy.style.setProperty(property, value);
    }
    // Snapshot layout must never create viewport-positioned descendants.
    if (["fixed", "sticky"].includes(copy.style.position)) copy.style.position = "static";
    if (isMath) copy.style.direction = "ltr";
    // Computed block widths belong to the original response column. Keeping
    // them would center the formula outside the narrower panel's visible area.
    if (wrapper) {
      copy.style.width = "auto";
      copy.style.minWidth = "0";
      copy.style.height = "auto";
      copy.style.maxHeight = "none";
      copy.style.overflow = "visible";
      copy.style.margin = "0";
      if (source.matches(".katex, .katex-html")) copy.style.display = "inline-block";
    }
    if (isMath && !inMath) {
      const display = source.matches('.katex-display, [data-math-display="true"]') || Boolean(source.querySelector(".katex-display"));
      copy.setAttribute("data-cdc-equation", display ? "display" : "inline");
      const label = source.getAttribute("data-math-source") || source.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
      if (label) { copy.setAttribute("role", "math"); copy.setAttribute("aria-label", label); }
      copy.style.width = "max-content";
      copy.style.minWidth = display ? "100%" : "0";
      copy.style.display = display ? "block" : "inline-block";
      copy.style.unicodeBidi = "isolate";
    }
    if (source.hasAttribute("dir")) copy.setAttribute("dir", source.getAttribute("dir"));
    if (source.hasAttribute("aria-hidden")) copy.setAttribute("aria-hidden", source.getAttribute("aria-hidden"));
    for (const attr of source.attributes) {
      if ((svg && VECTOR_ATTRS.has(attr.name) || math && MATH_ATTRS.has(attr.name)) && !/url\s*\(/i.test(attr.value)) {
        copy.setAttribute(attr.name, attr.value);
      }
    }
    if (["td", "th"].includes(tag)) {
      for (const attr of ["colspan", "rowspan"]) if (source.hasAttribute(attr)) copy.setAttribute(attr, source.getAttribute(attr));
    }
    // Links intentionally become inert styled text inside the reference panel.
    for (const child of source.childNodes) {
      const cloned = snapshotNode(child, range, budget, isMath);
      if (cloned) copy.appendChild(cloned);
    }
    // Do not retain empty layout wrappers at a range's trailing boundary.
    if (range && !copy.childNodes.length && !["br", "hr"].includes(tag)) return null;
    return copy;
  }

  function backdrop(element) {
    for (let current = element; current; current = current.parentElement) {
      const color = getComputedStyle(current).backgroundColor;
      if (color && color !== "transparent" && color !== "rgba(0, 0, 0, 0)") return color;
    }
    return matchMedia("(prefers-color-scheme: dark)").matches ? "#212121" : "#ffffff";
  }

  function spaceEquations(root) {
    // Only consecutive display equations get a gap. Ignore whitespace and
    // layout wrappers, but keep ordinary text and inline math spacing intact.
    let previous = false;
    function visit(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.textContent.trim()) previous = false;
        return;
      }
      if (node.nodeType === Node.ELEMENT_NODE && node.hasAttribute("data-cdc-equation")) {
        const display = node.getAttribute("data-cdc-equation") === "display";
        if (display && previous) node.style.marginTop = "16px";
        previous = display;
        return;
      }
      for (const child of node.childNodes) visit(child);
    }
    visit(root);
  }

  function capture(target) {
    if (editable(target)) return null;
    const fragment = document.createDocumentFragment();
    const selection = window.getSelection();
    let source = mathRoot(target);
    let range = null;
    // A selection inside the right-click target wins over a directly clicked
    // equation, allowing text + several equations to be pinned together.
    if (selection?.rangeCount && !selection.isCollapsed &&
        selection.containsNode(target, true)) {
      range = selection.getRangeAt(0).cloneRange();
      if (editable(elementOf(range.startContainer)) || editable(elementOf(range.endContainer))) return null;
      source = mathRoot(elementOf(range.commonAncestorContainer)) || elementOf(range.commonAncestorContainer);
    }
    if (!source) return { error: "Select text, or right-click an equation to pin it." };
    try {
      const copy = snapshotNode(source, range, { count: 0 });
      if (!copy || !(copy.textContent.trim() || copy.querySelector?.("svg"))) return null;
      // Display equation wrappers should fit the panel; internal math widths
      // and positioning remain intact, and oversized formulas can scroll.
      if (mathRoot(source)) {
        copy.style.direction = "ltr";
        copy.style.unicodeBidi = "isolate";
      }
      fragment.appendChild(copy);
      spaceEquations(fragment);
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
    .title { flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-weight:600; }
    button { font:20px/1 system-ui; display:grid; place-items:center; width:28px; height:28px;
      flex:0 0 28px; padding:0; border:0; border-radius:6px; color:inherit; background:transparent; cursor:pointer; }
    button:hover { background:#ffffff20; }
    button:disabled { opacity:.35; cursor:default; }
    button:disabled:hover { background:transparent; }
    .font-controls { display:flex; gap:0; flex:none; }
    .font-controls button { width:24px; flex-basis:24px; font-size:18px; }
    button:focus-visible, header:focus-visible { outline:2px solid #aab8ff; outline-offset:-2px; }
    .content { flex:1; min-height:0; min-width:0; overflow:auto; padding:12px; user-select:text; color-scheme:dark; }
    .measure { position:absolute; visibility:hidden; pointer-events:none; height:auto;
      max-height:none; overflow:visible; width:max-content; top:0; left:0; }
    .reference { overflow-wrap:anywhere; }
    .reference > :first-child { margin-top:0; }
    .reference > :last-child { margin-bottom:0; }
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
  function adjustFont(change) {
    panel.fontPercent = clamp(panel.fontPercent + change, 70, 200);
    // Layout-aware zoom scales the saved pixel metrics together, including
    // KaTeX's fraction bars, subscripts and SVG roots. Text still wraps normally.
    panel.reference.style.zoom = String(panel.fontPercent / 100);
    panel.shell.querySelector(".font-smaller").disabled = panel.fontPercent === 70;
    panel.shell.querySelector(".font-larger").disabled = panel.fontPercent === 200;
    panel.shell.querySelector(".font-controls").setAttribute("aria-label", `Reference font size: ${panel.fontPercent}%`);
    fitContent();
  }
  function measureHeaderWidth() {
    const header = panel.shell.querySelector("header").cloneNode(true);
    // Measure the whole title and all controls at the panel's actual font.
    // A fixed minimum misses small font/platform differences and cuts the title.
    Object.assign(header.style, { position: "absolute", visibility: "hidden",
      width: "max-content", pointerEvents: "none", font: getComputedStyle(panel.shell).font });
    panel.shadow.appendChild(header);
    try { return Math.max(220, Math.ceil(header.getBoundingClientRect().width) + 10); }
    finally { header.remove(); }
  }
  function fitContent() {
    if (!panel || panel.manualSize) return;
    // Start at the header's minimum width; wrapped text determines the height.
    // An independent inert copy includes overflow from wide rendered equations.
    const measure = panel.content.cloneNode(true);
    measure.classList.add("measure");
    panel.shadow.appendChild(measure);
    try {
      panel.minimumWidth = measureHeaderWidth();
      panel.width = Math.min(panel.minimumWidth, innerWidth - GAP * 2);
      measure.style.width = `${panel.width - 2}px`;
      // Include native scrollbar thickness for genuinely oversized formulas.
      // Windows scrollbars consume height; measuring visible overflow alone
      // would leave the lower edge of a wide equation behind its scrollbar.
      measure.style.overflow = "auto";
      panel.height = clamp(Math.ceil(measure.getBoundingClientRect().height) + 42,
        Math.min(80, innerHeight - GAP * 2), Math.min(500, innerHeight - GAP * 2));
    } finally { measure.remove(); }
    place();
  }
  function place() {
    if (!panel) return;
    const { host, collapsed } = panel;
    const width = clamp(panel.width, Math.min(panel.minimumWidth, innerWidth - GAP * 2), innerWidth - GAP * 2);
    const height = collapsed ? 40 : clamp(panel.height, Math.min(80, innerHeight - GAP * 2), innerHeight - GAP * 2);
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
    shell.innerHTML = '<header tabindex="0" aria-label="Move pinned reference using arrow keys"><span class="title">Pinned reference</span><div class="font-controls" role="group" aria-label="Reference font size: 100%"><button type="button" class="font-smaller" aria-label="Decrease font size" title="Decrease font size">−</button><button type="button" class="font-larger" aria-label="Increase font size" title="Increase font size">+</button></div><button type="button" class="collapse" aria-label="Collapse panel" aria-expanded="true" title="Collapse">▾</button><button type="button" class="close" aria-label="Close panel" title="Close">×</button></header><div class="content"><div class="reference"></div></div><div class="resize" title="Resize panel"></div>';
    shadow.appendChild(shell);
    document.documentElement.appendChild(host);
    panel = { host, shadow, shell, content: shell.querySelector(".content"), reference: shell.querySelector(".reference"), fontPercent: 100, collapsed: false,
      manualSize: false, minimumWidth: 220, width: 380, height: 100, ...INITIAL_POSITION };
    const header = shell.querySelector("header");
    const collapse = shell.querySelector(".collapse");
    shell.querySelector(".font-smaller").addEventListener("click", () => adjustFont(-10));
    shell.querySelector(".font-larger").addEventListener("click", () => adjustFont(10));
    shell.querySelector(".close").addEventListener("click", closePanel);
    collapse.addEventListener("click", () => {
      panel.collapsed = !panel.collapsed;
      shell.classList.toggle("collapsed", panel.collapsed);
      collapse.textContent = panel.collapsed ? "▸" : "▾";
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
          panel.manualSize = true;
          panel.width = clamp(gesture.width + dx, Math.min(panel.minimumWidth, innerWidth - panel.x - GAP), innerWidth - panel.x - GAP);
          panel.height = clamp(gesture.height + dy, 80, innerHeight - panel.y - GAP);
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
    collapse.textContent = "▾"; collapse.title = "Collapse";
    collapse.setAttribute("aria-label", "Collapse panel"); collapse.setAttribute("aria-expanded", "true");
    panel.content.style.background = pending.background;
    panel.content.style.color = pending.color;
    panel.reference.replaceChildren(pending.fragment.cloneNode(true));
    panel.content.scrollTop = 0;
    panel.content.scrollLeft = 0;
    panel.manualSize = false;
    fitContent();
    respond({ ok: true });
  });
  settings.subscribe(() => {
    if (!enabled()) { pending = null; closePanel(); document.getElementById("cdc-floating-toast")?.remove(); }
  });
  window.addEventListener("resize", () => { if (panel?.manualSize) place(); else fitContent(); });
  window.addEventListener("pagehide", () => { pending = null; closePanel(); });
})();
