Chatbot Direction Control — v1.0.3

Direction controls for ChatGPT, Gemini, Claude, and Grok.

Features:

- Use `Left Ctrl + Shift` to set the current composer paragraph to LTR/left-aligned.
- Use `Right Ctrl + Shift` to set the current composer paragraph to RTL/right-aligned.
- If a selection spans multiple paragraphs, the shortcut applies to every selected paragraph.
- Change individual chatbot messages between LTR and RTL using the alignment icons below each message.
- Each message's direction setting is saved locally and restored when revisiting the conversation.
- Supports ChatGPT, Gemini, Claude, and Grok.

Useful if you regularly switch between languages such as English, Arabic, and Hebrew.
The extension works entirely on your computer. It does not collect, send, upload, or
share your messages, settings, or any other data with external servers.

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

`getDirectionTarget()` must return the text/content element to align, not a user-message
bubble container. This keeps bubble placement under the host application's control.

Adding another chatbot
----------------------

1. Add its URL pattern to `manifest.json`.
2. Add a new file under `adapters/` for the chatbot.
3. Register one adapter from that file with `ChatDirectionControl.registerAdapter(...)`.
4. Add the adapter file to the manifest before the two generic controller scripts.
5. Only implement `getComposerTextBlocks(editor)` if the site's native composer shortcut
   behavior needs to be replaced.

No host-specific condition should be added to `composer-direction.js` or
`response-direction.js`.

Local test:

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click Load unpacked
4. Select this folder
5. Refresh ChatGPT, Gemini, Claude, or Grok

### Chrome Web Store link

https://chromewebstore.google.com/detail/jddejfelmjiohnmgcjpmlodhcfjpljej
