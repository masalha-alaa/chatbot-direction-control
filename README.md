Chatbot Direction Control — v1.0.7

Direction controls for ChatGPT, Gemini, Claude, and Grok.

Features:

- Use `Left Ctrl + Left Shift` to set the current composer paragraph to LTR/left-aligned.
- Use `Right Ctrl + Right Shift` to set the current composer paragraph to RTL/right-aligned.
- If a selection spans multiple paragraphs, the shortcut applies to every selected paragraph.
- Soft-wrapped text remains part of the same paragraph; only Enter-created paragraphs are controlled independently.
- Change individual chatbot messages between LTR and RTL using the alignment icons below each message.
- Each message's direction setting is saved locally and restored when revisiting the conversation.
- Supports ChatGPT, Gemini, Claude, and Grok.
- Middle-click a recent ChatGPT sidebar conversation or a project folder to open it
  in a background tab. Project folders open their project page; conversations inside
  projects are not included. Left-click, right-click, modified clicks, wheel scrolling,
  and the row's pin/menu/new-chat controls keep their native behavior.

Useful if you regularly switch between languages such as English, Arabic, and Hebrew.
The extension works entirely on your computer. It does not collect, send, upload, or
share your messages, settings, or any other data with external servers.

Settings popup preview
----------------------

Click the extension's toolbar icon to open the dark settings popup. This branch
contains the UI only: switches, chatbot sections, counts, and dependent controls
work inside the popup, but do not change any chatbot behavior. The master switch
also affects only the popup in this preview.

Preview choices persist separately in extension-page localStorage under
`cdc:popup-ui-preview:v1`. They do not modify saved message alignments or write
to `chrome.storage`. The displayed version comes from the installed manifest.

Each chatbot starts with Remember alignment. Gemini has no Message box control.
ChatGPT additionally shows Fix RTL punctuation above Mouse middle click; the
punctuation switch is disabled when both alignment-button switches are off,
while preserving its selected value. The underlying punctuation and middle-click
features are not included or activated by this UI branch.

To review: reload the unpacked extension, click its toolbar icon, try the
switches and chatbot sections, then close and reopen the popup to check saved
choices. Turn off both ChatGPT alignment-button switches to check the punctuation
dependency. Existing chatbot controls should continue working regardless of the
popup switch positions.

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
