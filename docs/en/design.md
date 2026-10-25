# Design

[Usage](usage.md) / [README](../../README.en.md)

## Architecture and lifecycle

Browser/noVNC → xangi HTTP/WebSocket proxy → Node.js extension → a fixed VNC port on 127.0.0.1. The browser cannot choose destinations. The OS VNC service is managed separately.

`src/extension.mjs` emits readiness and closes on stdin EOF, SIGINT or SIGTERM. `scripts/xangi-extension` is the POSIX launcher. `/ui` uses an HTML redirect compatible with the host CSP/base handling. `/health` and `/api/status` expose configuration, connection and registration state, never secrets. `/api/register` and `/api/forget` accept same-origin POST; `/ws` relays binary RFB.

One viewer is allowed, with 1 MiB messages and 8 MiB queues. TCP reads pause until sending completes. Connection timeout is 5 seconds, or 10 seconds through saved authentication; the browser waits up to 90 seconds. Ping/pong detects lost viewers.

## Authentication

Every request requires the extension bearer. WebSockets also require the internal Origin rewritten by xangi. The bearer authenticates the proxy, not an individual, and never reaches the browser.

- Manual mode relays authentication between noVNC and VNC; credentials remain in browser connection memory.
- Saved mode reads an owner-only password file and handles classic VNC authentication on the server. Neither password nor challenge response reaches the browser. Subsequent RFB bytes are relayed unchanged.

Saved mode requires an HMAC-signed browser cookie: 30 days by default, optionally without server expiry. No-expiry cookies refresh to a 400-day lifetime on access; browser deletion/retention limits still apply. Cookies are HttpOnly/SameSite=Strict, Secure by default, and namespaced by xangi. Registration is limited to five failed attempts per minute globally. Key rotation and extension restart invalidate all registrations. See [usage](usage.md) for management.

The input toggle prevents accidental input; it is not a server-enforced read-only permission. Other processes under the same OS user and direct VNC clients are outside this boundary.

## UI

The dark palette, green accent, 44px controls and home icon follow xangi. Connections start in view-only mode and require an explicit action to enable input. No CDN assets are used.

## Dependencies and distribution

- noVNC 1.7.0: primarily MPL-2.0; complete original npm package source, AUTHORS and license texts are copied into `dist/vendor/novnc/` without modification. Bundled pako and other notices are preserved.
- ws 8.22.0: MIT; its license is included by the build.
- Original extension code: MIT, in separate files.
- VNC servers: not bundled or copied. Their installation and distribution conditions require independent review.

The viewer links to the readable source and licenses. Distribution must include the complete `dist/` tree. Future noVNC modifications must be made available under MPL terms. See the [Mozilla FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/).

## References

[OpenClaw Host Desktop](https://github.com/openclaw/openclaw/blob/60546ded418ce14507c607570f0e463d28b737cb/docs/gateway/config-browser-ui-desktop.md#desktop) informed loopback and OS-specific attachment; it is a Labs feature. [Hermes Bot Screen](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/bot-screen.md) informed the separation of viewer and control concepts. [noVNC API](https://github.com/novnc/noVNC/blob/v1.7.0/docs/API.md) defines client integration. No implementation code from OpenClaw, Hermes or GPL VNC servers was copied.
