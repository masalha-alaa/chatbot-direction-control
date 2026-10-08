const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { parseHTML } = require("linkedom");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(file, "utf8");

test("manifest resources and relative worker/popup imports resolve in the extension package", () => {
  function resource(base, reference) {
    const file = path.resolve(base, reference);
    assert(file.startsWith(root + path.sep), `Resource escapes the package: ${reference}`);
    assert(fs.statSync(file).isFile(), `Missing packaged file: ${reference}`);
    if (file.endsWith(".js")) new vm.Script(read(file), { filename: file });
    return file;
  }
  const manifest = JSON.parse(read(path.join(root, "manifest.json")));
  const worker = resource(root, manifest.background.service_worker);
  const imports = read(worker).match(/importScripts\(([\s\S]*?)\);/);
  assert(imports, "Worker dependencies must be checked");
  for (const match of imports[1].matchAll(/["']([^"']+)["']/g)) {
    resource(path.dirname(worker), match[1]);
  }
  for (const entry of manifest.content_scripts) {
    for (const file of [...entry.js, ...entry.css]) resource(root, file);
  }
  for (const icon of Object.values(manifest.icons)) resource(root, icon);
  const popup = resource(root, manifest.action.default_popup);
  const { document } = parseHTML(read(popup));
  for (const element of document.querySelectorAll("script[src], link[href], img[src]")) {
    resource(path.dirname(popup), element.getAttribute("src") || element.getAttribute("href"));
  }
});
