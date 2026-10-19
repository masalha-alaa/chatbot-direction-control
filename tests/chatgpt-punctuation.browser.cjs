const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const path = require("node:path");
const root = path.resolve(__dirname, "..");

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CDC_CHROMIUM_PATH,
    args: ["--no-sandbox", "--disable-gpu"], headless: true
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
    await page.setContent(`<body style="background:#111;color:#ddd;font:20px/1.7 Arial;margin:24px">
      <div id="target" data-markdown-text-style="assistant-message" class="cgpt-direction-target cgpt-force-ltr" dir="auto">
        <p dir="auto"><span>Create one reader/rawi registry. It must distinguish, for example, الدوري عن أبي عمرو from الدوري عن الكسائي, and خلف عن حمزة from </span><bdi id="reader">خلف العاشر.</bdi></p>
        <ul><li><span>Record the edition, page, reader/rawi and </span><bdi id="transmission">طريق.</bdi></li></ul>
        <p dir="auto"><span>Your linked </span><em><span>مصحف يعقوب الحضرمي من الدرة</span></em><span> is a useful reference for this process. References must match the intended transmission scope; we must avoid mixing readings from different </span><bdi id="citation-word">طرق. </bdi><span style="display:inline-flex"><a data-testid="chatgpt-citation" href="https://example.com" style="background:#333;color:#ccc;border-radius:12px;padding:0 8px">quranpedia.net</a></span></p>
        <p>Hebrew <bdi id="hebrew">דרכים.</bdi></p>
        <p>عنوان <bdi id="english">English!</bdi></p><p>Nested <bdi id="nested"><strong>طرق.</strong></bdi></p>
        <p><code><bdi id="code">طرق.</bdi></code> <kbd><bdi id="kbd">طرق.</bdi></kbd> <samp><bdi id="samp">طرق.</bdi></samp></p>
        <pre><bdi id="pre">طرق.</bdi></pre><p><bdi id="empty">. </bdi></p>
      </div>
    </body>`);
    await page.addStyleTag({ path: path.join(root, "src/content/styles.css") });
    await page.evaluate(() => {
      window.ChatDirectionControl = { dom: {}, registerAdapter: adapter => { window.adapter = adapter; } };
      window.apply = (mode, punctuationEnabled = true) => {
        const target = document.getElementById("target");
        target.classList.toggle("cgpt-force-ltr", mode === "ltr");
        target.classList.toggle("cgpt-force-rtl", mode === "rtl");
        adapter.onDirectionModeApplied({ target, mode, punctuationEnabled });
      };
      window.original = document.getElementById("target").innerHTML;
    });
    await page.addScriptTag({ path: process.env.CDC_CHATGPT_ADAPTER_PATH || path.join(root, "src/adapters/chatgpt.js") });
    const ids = ["reader", "transmission", "citation-word", "hebrew", "nested"];
    const metrics = () => page.evaluate(ids => ids.map(id => {
      const bdi = document.getElementById(id), helper = bdi.nextElementSibling;
      const punct = helper?.hasAttribute("data-cdc-bidi-punct") ? helper : bdi;
      const walker = document.createTreeWalker(punct, NodeFilter.SHOW_TEXT);
      let node, dot;
      while ((node = walker.nextNode())) if (node.data.includes(".")) { dot = node; break; }
      const range = document.createRange(), index = dot.data.indexOf(".");
      range.setStart(dot, index); range.setEnd(dot, index + 1);
      const point = range.getBoundingClientRect(), word = bdi.getBoundingClientRect();
      return { id, periodLeft: point.left, periodRight: point.right, wordLeft: word.left, wordRight: word.right };
    }), ids);
    const before = await metrics();
    for (const m of before) assert(m.periodLeft < m.wordRight - 1, `${m.id}: baseline puts punctuation inside the RTL fragment`);
    await page.evaluate(() => apply("ltr"));
    const after = await metrics();
    for (const m of after) assert(m.periodLeft >= m.wordRight - 1, `${m.id}: period must follow the RTL fragment on its right`);
    assert.equal(await page.locator("[data-cdc-bidi-punct]").count(), 5);
    assert.equal(await page.locator("#citation-word + [data-cdc-bidi-punct]").textContent(), ". ");
    assert.equal(await page.locator("#english").textContent(), "English!");
    for (const id of ["code", "kbd", "samp", "pre"]) assert.equal(await page.locator(`#${id}`).textContent(), "طرق.");
    assert.equal(await page.locator("#empty").textContent(), ". ");
    const citation = await page.locator('[data-testid="chatgpt-citation"]').boundingBox();
    assert(citation.x > after.find(m => m.id === "citation-word").periodRight, "Citation must follow the period");
    assert(await page.evaluate(() => {
      const observer = new MutationObserver(() => {});
      observer.observe(document.getElementById("target"), { childList: true, characterData: true, subtree: true });
      apply("ltr"); const count = observer.takeRecords().length; observer.disconnect(); return count === 0;
    }), "Same-mode rescans must not mutate content or trigger observer loops");
    await page.evaluate(() => apply("rtl"));
    assert.equal(await page.locator("#english").textContent(), "English");
    const rtl = await page.locator("#english").evaluate(bdi => ({
      wordLeft: bdi.getBoundingClientRect().left, punctuationRight: bdi.nextElementSibling.getBoundingClientRect().right
    }));
    assert(rtl.punctuationRight <= rtl.wordLeft + 1, "Existing RTL English punctuation must remain on the left");
    await page.evaluate(() => apply("ltr"));
    assert.equal(await page.locator("#english").textContent(), "English!");
    for (const m of await metrics()) assert(m.periodLeft >= m.wordRight - 1);
    for (const [mode, enabled] of [["ltr", false], [null, true]]) {
      await page.evaluate(([mode, enabled]) => apply(mode, enabled), [mode, enabled]);
      assert(await page.evaluate(() => document.getElementById("target").innerHTML === original), "Opt-out/reset restores exact text and markup");
      await page.evaluate(() => apply("ltr"));
    }
    console.log("Chromium punctuation checks passed: three reported cases, Hebrew, nested formatting, citations, RTL, exclusions, rescans, mode switches and restoration.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
