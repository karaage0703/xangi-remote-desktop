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
- Mac Chrome as a client of Linux X11: limited keyboard validation described below. This does not validate macOS as the remote host.
- Safari/Firefox, IME and special keys beyond the cases below, multiple displays, login/lock screens and UAC: unverified.

Saved-auth supports classic VNC authentication under RFB 3.3/3.7/3.8 only. Manual certificate approval and credential fields beyond username/password are unsupported. Audio, file transfer, clipboard UI, resolution changes, automated OS setup, per-user control permissions and AI handoff are not included. The input toggle prevents accidents; it is not a server-enforced read-only permission. Restrict xangi access to authorized users.

## Troubleshooting and maintenance

If connection fails, check the VNC listener, port, credentials and other connected tabs. Doctor reports configuration readiness, not successful VNC authentication. If registration is not saved, check cookies and HTTPS settings. Some manual authentication methods require HTTPS/localhost for Web Crypto. For input, enable control and focus the desktop.

To update, stop the extension, update source, run `npm ci` and `npm run build`, then start it; preserve `.env` and secrets. To remove, stop it and use `extension unlink xangi-remote-desktop`. Stop the separate VNC service yourself when no longer needed. No xangi host restart is required.

## Mac keyboard input to Linux X11

These findings apply to Mac Chrome → noVNC → x11vnc on an Ubuntu 24.04-based X11 host. They are environment-specific workarounds, not requirements for every OS or VNC server. They change the remote host's VNC configuration and OS packages, not extension code.

### Shift failures or inverted letter case after Eisu

Check the browser's Shift/Caps Lock state separately from the remote host's lock state. In the tested Japanese layout, `Eisu_toggle` shared a key position with Caps Lock. Sending the Mac Eisu (alphanumeric) key turned on remote Caps Lock. Pausing/resuming control or reloading the page did not prevent recurrence.

The tested x11vnc configuration used:

- Environment variable: `MODTWEAK_LOWEST=1`
- Startup arguments: `-noxkb -remap Eisu_toggle-Muhenkan`

`MODTWEAK_LOWEST=1` adjusts selection among duplicate key mappings, but did not prevent the Eisu-triggered recurrence by itself. The remap sends Eisu as Muhenkan (non-conversion), avoiding the unintended Caps Lock toggle. It changes Eisu's meaning; verify it with your IME and layout. `-noxkb` was retained from an earlier workaround for a crash during XKB processing. That crash's root cause remains unknown; this is not a universal recommendation.

For a systemd-managed VNC server, put `Environment=MODTWEAK_LOWEST=1` in its `[Service]` section and add the required arguments to its existing `ExecStart`. The extension's `.env` does not configure a separate x11vnc service. Preserve DISPLAY, Xauthority, loopback binding and authentication, and back up the service definition first.

Apply changes by restarting the VNC service, which disconnects viewers. Reload systemd definitions first if you edited the unit. No xangi host restart is required. Check and clear any existing remote Caps Lock state, reconnect, and repeatedly test Eisu → lowercase → Shift-uppercase → lowercase → Enter. This sequence and user testing from Mac showed improvement; long-term stability has not been established.

### Japanese input in GTK4 applications

A running Mozc engine does not ensure GTK4 integration is installed. In the tested environment, GTK3 converted Japanese while GTK4 retained Latin letters because `ibus-gtk4` was missing.

```sh
dpkg-query -W ibus-gtk4
# If missing, run on the Ubuntu remote host:
sudo apt-get install ibus-gtk4
```

After installation, a newly started GNOME Text Editor converted `ka` to `か` through noVNC. Save unsaved documents before restarting existing applications if needed. Keep the Mac input source on ABC and select Mozc hiragana input on the remote host. This does not validate sending text already composed by the Mac IME.

**Remaining limitation:** Enter sometimes fails to confirm Japanese composition or insert a newline, or appears delayed. This remains unresolved; the user uses mouse selection as a workaround. Installing `ibus-gtk4` and fixing Eisu do not establish complete Japanese input support.
