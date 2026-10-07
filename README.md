Chatbot Direction Control — v1.1.3

Direction controls for ChatGPT, Gemini, Claude, and Grok.

Features:

- Use `Left Ctrl + Left Shift` to set the current composer paragraph to LTR/left-aligned.
- Use `Right Ctrl + Right Shift` to set the current composer paragraph to RTL/right-aligned.
- If a selection spans multiple paragraphs, the shortcut applies to every selected paragraph.
- Soft-wrapped text remains part of the same paragraph; only Enter-created paragraphs are controlled independently.
- Change individual chatbot messages between LTR and RTL using the alignment icons below each message.
- Each message's direction setting is saved locally and restored when revisiting the conversation.
- Supports ChatGPT, Gemini, Claude, and Grok.
- Pin selected text, whole equations, or images in one draggable, resizable floating reference panel per tab.
- Middle-click a recent ChatGPT sidebar conversation or a project folder to open it
  in a background tab. Project folders open their project page; conversations inside
  projects are not included. Left-click, right-click, modified clicks, wheel scrolling,
  and the row's pin/menu/new-chat controls keep their native behavior.

Useful if you regularly switch between languages such as English, Arabic, and Hebrew.
The extension works entirely on your computer. It does not collect, send, upload, or
share your messages, settings, or any other data with external servers.

Settings popup
--------------

Click the extension's toolbar icon to open the dark settings popup. Settings are
saved locally with `chrome.storage.local` and apply to open chatbot pages without
reloading. After installing or reloading the extension itself, refresh existing
chatbot tabs once so they load the updated content scripts.

- **Enable extension** pauses all extension features while keeping your choices
  and saved alignments. Re-enabling restores the current page's alignment choices.
- **Remember alignment**, first in each chatbot group, saves per-message alignment
  and restores it after reload. When off, choices last only for the current page
  (including host rerenders); existing saved alignments are kept but ignored until
  this setting is enabled again.
- **Message box control** enables paragraph-level keyboard direction shortcuts for
  ChatGPT, Claude, and Grok. Gemini keeps its native behavior and has no such toggle.
- **User alignment buttons** and **Assistant alignment buttons** independently
  control the added buttons and alignment overrides for each message role.
- **Fix RTL punctuation** corrects trailing punctuation in ChatGPT RTL messages.
  It is disabled when both alignment-button settings are off; its choice is kept.
  Disabling it restores punctuation in currently processed messages.
- **Floating reference panel** enables the right-click **Pin to floating panel** action.
  It defaults to on for each chatbot; disabling it or the master switch closes the panel.
- **Mouse middle click** opens supported ChatGPT sidebar chats and project folders
  in new background tabs. Both the content script and background worker enforce
  this preference and the master switch.

Middle-click tabs default to **off**. Every other setting, including RTL punctuation,
starts **on**. Settings are stored as independent `cdc:settings:` keys, separate
from existing `cgpt-direction|` alignment records. UI prototype preferences are
not imported. The displayed extension version comes from the manifest.

Run `npm ci` then `npm test` for storage, popup, controller, and tab-worker tests.
For a browser check, load the extension unpacked, refresh chatbot tabs, and try
both message-role switches, paragraph shortcuts, persistence across reloads,
the punctuation dependency, and middle-click on supported sidebar rows. Check
that the master switch pauses these features and retains individual choices.

Floating reference panel
------------------------

Select text and right-click **Pin to floating panel**, or right-click an equation
or image directly. The reference stays at the same screen position as you scroll.
Drag its header to move it, drag the bottom-right corner to resize it, and use the
header buttons to collapse/expand or close it. Focus the header and use arrow keys
to move it with the keyboard; Escape closes it when focus is in the panel.

Pinning another item replaces the same tab's reference and keeps the panel position.
The panel automatically fits each new reference, up to the available screen space;
manual resizing applies until another item is pinned. Scrollbars appear only when
the content genuinely exceeds the panel. Selecting part of a rendered equation captures the whole equation;
selections can include text and multiple equations. Original content is untouched.
A reference stays visible during in-tab conversation navigation, until replaced or
closed; refreshing the page clears it. Panels are independent across tabs.

The new `contextMenus` permission supplies the native right-click entry, limited to
supported chatbot pages. The entry also appears over unselected page content so an
equation can be pinned without selecting it; using it on plain unselected content
shows a short hint. Editors and embedded frames are excluded. Content never leaves
the tab or goes into extension storage. Image copies use the original image URL and
may request it again from its original host, subject to that site's access rules.

Snapshots preserve computed typography and rendered KaTeX math in an isolated shadow
tree. Only inert presentation markup is copied; scripts, handlers, embedded frames,
custom elements, and external SVG references are excluded. Oversized selections are
rejected with a hint. Animated images remain animated; video/canvas capture and
persistent saved references are outside this feature.

Reload the unpacked extension and refresh chatbot tabs to try the new menu.

Browser regression check (development only): install `playwright` and `katex`
locally with `npm install --no-save --package-lock=false playwright katex`, run
`npx playwright install chromium`, then `node tests/floating-panel.browser.cjs`.
The fixture recreates constrained math scrollers and checks complete equations,
empty selection boundaries, compact sizing, real PNG loading, and panel controls.
`CDC_CHROMIUM_PATH` may point to an existing Chromium executable.

Composer shortcut behavior
--------------------------

ChatGPT, Claude, and Grok use the extension's paragraph-level composer handling. Each
Enter-created paragraph can be switched independently without changing the rest of the
composer.

Gemini already provides the expected paragraph-direction behavior natively, so the
extension deliberately leaves its `Ctrl + Shift` handling untouched.

Architecture
------------

The extension separates generic behavior from chatbot-specific DOM knowledge:

- `site-adapter-registry.js`: adapter registration, validation, and shared DOM helpers.
- `adapters/chatgpt.js`: ChatGPT selectors and DOM behavior.
- `adapters/gemini.js`: Gemini selectors and DOM behavior.
- `adapters/claude.js`: Claude selectors and DOM behavior.
- `adapters/grok.js`: Grok selectors and DOM behavior.
- `composer-direction.js`: generic composer shortcut handling for adapters that opt in.
- `response-direction.js`: generic per-message controls, persistence, and DOM observation.
- `sidebar-navigation.js`: opt-in, generic middle-click handling for sidebar conversations and project folders.
- `background.js`: validates tab-opening requests and opens an inactive tab in the source window.
- `floating-panel-background.js`: registers the native context menu and routes pin actions to the source tab.
- `floating-panel.js`: captures inert formatted references and manages the isolated floating panel.
- `styles.css`: shared direction/button styling.

`composer-direction.js` and `response-direction.js` contain no chatbot host checks.
They only call the active adapter through the registry.

For composer direction, an adapter opts into custom paragraph handling by implementing
`getComposerTextBlocks(editor)`. If the adapter does not provide that hook, the extension
does not intercept the shortcut and the page/browser keeps its native behavior.

Adapter contract
----------------

Every chatbot adapter has a stable `id` and implements:

- `matches(location)`
- `findComposerEditor(activeElement)`
- `getMessages()`
- `getRole(message)`
- `getTurn(message)`
- `findActionBar(turn, role)`
- `getDirectionTarget(message, role)`

Optional adapter hooks:

- `getComposerTextBlocks(editor)`: returns the logical composer paragraphs when the host
  needs custom paragraph-level direction handling.
- `getMessageStorageId(message, turn)`: returns a stable host-specific message/turn ID
  when the generic persistence fallback cannot infer one. Claude, for example, uses its
  virtualized conversation row index.
- `getSidebarConversationLink(target)`: returns `{ element, url }` only for eligible
  sidebar conversation or project-folder rows; returns `null` for nested controls and unsupported areas.
- `isSidebarConversationUrl(url)`: a pure URL-policy check, required with the previous
  hook. It is also called in the service worker and must not access the DOM.
  Only ChatGPT currently opts in, for recent chats and project folders whose HTML
  exposes the corresponding conversation or project ID.

Sidebar navigation uses delegated mouse listeners, not hover scans or polling. It
does not read conversation contents or store conversation IDs. The service worker
uses `chrome.tabs.create({ active: false })`; no additional permissions are requested.
Reload the extension and refresh existing ChatGPT tabs after installing this change.

`getDirectionTarget()` must return the text/content element to align, not a user-message
bubble container. This keeps bubble placement under the host application's control.

Adding another chatbot
----------------------

1. Add its URL pattern to `manifest.json`.
2. Add a new file under `adapters/` for the chatbot.
3. Register one adapter from that file with `ChatDirectionControl.registerAdapter(...)`.
4. Add the adapter file to the manifest before the generic controller scripts, and to
   `background.js` if it opts into sidebar navigation.
5. Only implement `getComposerTextBlocks(editor)` if the site's native composer shortcut
   behavior needs to be replaced.

No host-specific condition should be added to `composer-direction.js` or
`response-direction.js`, `sidebar-navigation.js`, or `background.js`.

Local test:

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click Load unpacked
4. Select this folder
5. Refresh ChatGPT, Gemini, Claude, or Grok

Automated tests (Node.js): `npm ci` then `npm test`. Tests use a sanitized sidebar
DOM fixture and mocked Chrome APIs; they do not replace a live unpacked-extension
test. The npm dependencies are development-only and are not needed by the extension.

### Chrome Web Store link

https://chromewebstore.google.com/detail/jddejfelmjiohnmgcjpmlodhcfjpljej
