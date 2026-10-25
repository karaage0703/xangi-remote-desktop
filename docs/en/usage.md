# Usage

[README](../../README.en.md) / [Setup (Japanese)](../../XANGI_SETUP.md) / [Design](design.md)

## Setup

Requires Node.js 22+, a POSIX shell and a local VNC server. Run `npm ci`, `npm run build`, then copy `.env.example` to `.env` on first setup only. Configure the following; parent environment values take precedence. Stop/start the extension after changes.

| Setting | Default | Purpose |
| --- | --- | --- |
| `REMOTE_DESKTOP_VNC_PORT` | Empty | Loopback VNC port, 1–65535. Empty disables connections |
| `REMOTE_DESKTOP_VNC_PASSWORD_FILE` | Empty | Absolute path to a saved password; empty uses manual credentials |
| `REMOTE_DESKTOP_BROWSER_KEY_FILE` | Empty | Absolute path to the saved-auth registration code; generated if missing |
| `REMOTE_DESKTOP_COOKIE_SECURE` | `true` | HTTPS cookie; `false` only for protected HTTP such as access-controlled Tailscale |

The password file must contain 1–8 printable ASCII characters (optional final newline). On POSIX it must belong to the process user with owner-only permissions (0600). Keep secret files outside Git and served assets. xangi supplies `XANGI_EXTENSION_AUTH_TOKEN`; do not set it yourself.

For saved authentication, run `npm run setup` to validate settings and display the registration code. `npm run registration -- show` displays it again. Administrators should provide it privately to authorized users; do not put it in shared logs, chats or URLs. Setup does not test VNC connectivity or modify OS settings.

Set `XANGI_BIN` to your installed xangi's absolute path and register from the extension directory:

```sh
"$XANGI_BIN" extension link "$PWD/xangi-extension.json"
"$XANGI_BIN" extension start xangi-remote-desktop
"$XANGI_BIN" extension doctor xangi-remote-desktop
```

## Operation and registration

Open xangi-remote-desktop, register your browser if saved-auth is enabled, then select Connect. Manual mode prompts for VNC credentials. Input starts disabled: select Start control and click the desktop to operate it. Stop control pauses input; Disconnect ends the session; xangi Home returns to the host UI.

Fit changes display scaling, not PC resolution. Fullscreen depends on the browser. Only one viewer may connect at a time; reconnect manually. Direct VNC clients are outside this limit.

Registration defaults to 30 days; no-expiry registration is optional. Browser cookie deletion or retention limits still require registration again. To change the choice, forget the registration and register again with the same code. Forgetting only deletes the current browser cookie. To revoke all registrations, stop the extension, run `npm run registration -- rotate`, then start it. The old code remains active until stop/start.

## Platforms and limits

- Linux X11: display, mouse and key input verified with Chromium.
- Wayland: requires environment-specific validation. RDP-only servers are unsupported.
- macOS: POSIX launcher provided; Screen Sharing and Apple authentication are unverified.
- Windows: native launcher and hardware validation pending; WSL access to the host desktop is not assumed.
- Safari/Firefox, IME, special keys, multiple displays, login/lock screens and UAC: unverified.

Saved-auth supports classic VNC authentication under RFB 3.3/3.7/3.8 only. Manual certificate approval and credential fields beyond username/password are unsupported. Audio, file transfer, clipboard UI, resolution changes, automated OS setup, per-user control permissions and AI handoff are not included. The input toggle prevents accidents; it is not a server-enforced read-only permission. Restrict xangi access to authorized users.

## Troubleshooting and maintenance

If connection fails, check the VNC listener, port, credentials and other connected tabs. Doctor reports configuration readiness, not successful VNC authentication. If registration is not saved, check cookies and HTTPS settings. Some manual authentication methods require HTTPS/localhost for Web Crypto. For input, enable control and focus the desktop.

To update, stop the extension, update source, run `npm ci` and `npm run build`, then start it; preserve `.env` and secrets. To remove, stop it and use `extension unlink xangi-remote-desktop`. Stop the separate VNC service yourself when no longer needed. No xangi host restart is required.
