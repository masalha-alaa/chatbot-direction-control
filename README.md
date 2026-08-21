ChatGPT Direction Control — v1.0.0

Direction controls for ChatGPT and Gemini.

Features:

- Use Left Ctrl + Shift to set the active message composer to LTR + left aligned.
- Use Right Ctrl + Shift to set the active message composer to RTL + right aligned.
- Change individual assistant responses between LTR/left and RTL/right using the alignment icons below each response.
- Change individual user messages the same way without moving the message bubble itself.
- Each message's direction setting is saved locally and restored when revisiting the conversation.
- Supports ChatGPT and Gemini.

Useful if you regularly switch between languages such as English, Arabic, and Hebrew.
The extension works entirely on your computer. It does not collect, send, upload, or
share your messages, settings, or any other data with external servers.

Architecture
------------

The extension is split into site-independent behavior and site-specific DOM adapters:

- `site-adapters.js`: selectors and DOM behavior for each supported chatbot.
- `composer-direction.js`: generic Left/Right Ctrl + Shift handling.
- `response-direction.js`: generic per-message controls, persistence, and DOM observation.
- `styles.css`: shared direction/button styling.

The generic files do not branch on ChatGPT vs Gemini. They ask the active adapter for
the composer, messages, roles, action bars, and exact text elements to align.

Adding another chatbot
----------------------

1. Add its URL pattern to `manifest.json`.
2. Add one adapter object to `site-adapters.js` implementing the documented adapter contract.
3. Add that adapter to the `siteAdapters` registry.

No host-specific condition should be added to `composer-direction.js` or
`response-direction.js`.

Local test:

1. Open chrome://extensions
2. Enable Developer mode
3. Click Load unpacked
4. Select this folder
5. Refresh ChatGPT or Gemini

Chrome Web Store:

- Upload the ZIP whose manifest.json is at the ZIP root.

Chrome Web Store link:

https://chromewebstore.google.com/detail/chatgpt-direction-control/jddejfelmjiohnmgcjpmlodhcfjpljej
