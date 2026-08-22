Chatbot Direction Control — v1.0.1

Direction controls for ChatGPT, Gemini, Claude, and Grok.

Features:

- Use `Left Ctrl + Shift` to left-align the active message box.
- Use `Right Ctrl + Shift` to right-align the active message box.

- Change individual messages between LTR and RTL using the alignment icons below each message.

- Each message's direction setting is saved locally and restored when revisiting the conversation.
- Supports ChatGPT, Gemini, Claude, and Grok.

Useful if you regularly switch between languages such as English, Arabic, and Hebrew.
The extension works entirely on your computer. It does not collect, send, upload, or
share your messages, settings, or any other data with external servers.

Architecture
------------

The extension separates generic behavior from chatbot-specific DOM knowledge:

- `site-adapter-registry.js`: adapter registration, validation, and shared DOM helpers.
- `adapters/chatgpt.js`: ChatGPT selectors and DOM behavior.
- `adapters/gemini.js`: Gemini selectors and DOM behavior.
- `adapters/claude.js`: Claude selectors and DOM behavior.
- `adapters/grok.js`: Grok selectors and DOM behavior.
- `composer-direction.js`: generic `Left/Right Ctrl + Shift` handling.
- `response-direction.js`: generic per-message controls, persistence, and DOM observation.
- `styles.css`: shared direction/button styling.

`composer-direction.js` and `response-direction.js` contain no chatbot host checks.
They only call the active adapter through the registry.

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

An adapter may also implement `getMessageStorageId(message, turn)` when the host has a
stable message/turn identity that the generic persistence fallback cannot infer. Claude,
for example, uses its virtualized conversation row index.

`getDirectionTarget()` must return the text/content element to align, not a user-message
bubble container. This keeps bubble placement under the host application's control.

Adding another chatbot
----------------------

1. Add its URL pattern to `manifest.json`.
2. Add a new file under `adapters/` for the chatbot.
3. Register one adapter from that file with `ChatDirectionControl.registerAdapter(...)`.
4. Add the adapter file to the manifest before the two generic controller scripts.

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
