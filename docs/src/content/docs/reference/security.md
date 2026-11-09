---
title: Security model
description: The process boundaries, sandboxes, credential handling and release integrity of the Brainstrike desktop app, with its known limits.
---

This page describes version 0.1.0-beta.6. Its main source is [`apps/desktop/SECURITY.md`](https://github.com/seandearnaley/brainstrike/blob/main/apps/desktop/SECURITY.md) in the app repository, read together with the code it points to. That file names the code as the reference where the two differ.

## Process boundaries

[Architecture](/develop/architecture/) has the picture. The boundaries that matter for security are these.

- **Main** is the Electron main process. It owns windows, menus, dialogs, the browser pane and the credential cipher, and it starts the other processes ([ADR-0029](https://github.com/seandearnaley/brainstrike/blob/main/docs/adr/0029-main-is-a-launcher.md)).
- **The renderer** is the window's web content. It has no Node access. It reaches Main only through `contextBridge` preload APIs, and talks to the agent host over a message port.
- **The agent host** is a separate Node process with no Electron imports, started with `utilityProcess.fork`. It owns runs, the state database, the agent's tools and the workspace services: git, terminals, language servers, file watching, hooks and MCP.
- **The egress proxy** is its own utility process.

IPC from the renderer to Main is authorized before it is parsed. A sensitive call must come from a known window role and from the one configured renderer frame, and Main decodes its arguments against a schema that rejects extra arguments and undeclared fields ([platform contract](https://github.com/seandearnaley/brainstrike/blob/main/docs/agents/platform-contracts.md)).

Clients of the agent host attach over JSON-RPC and present a 32-byte token, compared in constant time. The host's record, which holds that token, is written as `host.json` with mode `0600` in a `0700` directory. On Windows the host sets a private owner and access list on its data folder natively. One host runs per data folder, and a second is refused ([ADR-0017](https://github.com/seandearnaley/brainstrike/blob/main/docs/adr/0017-cli-first-agent-host.md), [host lease contract](https://github.com/seandearnaley/brainstrike/blob/main/docs/agents/host-lease.md)).

## The renderer

### Content Security Policy

The policy is built in [`content-security-policy.ts`](https://github.com/seandearnaley/brainstrike/blob/main/packages/platform-utils/src/content-security-policy.ts) and added to every response by [`setup-security.ts`](https://github.com/seandearnaley/brainstrike/blob/main/apps/desktop/src/setup-security.ts). In a packaged build it is:

| Directive | Value |
| --- | --- |
| `default-src` | `'self'` |
| `script-src` | `'self' blob: 'wasm-unsafe-eval'` |
| `connect-src` | `'self' http://127.0.0.1:* http://localhost:*` |
| `frame-src` | `brainstrike-canvas: brainstrike-mcp-app:` |
| `style-src` | `'self' 'unsafe-inline'` |
| `img-src` | `'self' data: blob: brainstrike-asset:` |
| `font-src` | `'self' data:` |
| `worker-src` | `'self' blob:` |
| `object-src`, `frame-ancestors` | `'none'` |
| `base-uri`, `form-action` | `'self'` |

No script loads from a CDN, and there is no `unsafe-eval` or inline script. The renderer cannot connect to a model provider. Inline styles are allowed.

Responses also carry `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-XSS-Protection: 0` and a `Permissions-Policy` of `camera=(), microphone=(), geolocation=(), payment=()`.

### Window settings

The window is created with `nodeIntegration: false`, `contextIsolation: true`, `webSecurity: true`, `allowRunningInsecureContent: false`, `experimentalFeatures: false`, `safeDialogs: true` and `navigateOnDragDrop: false`. `sandbox` is `true` in packaged builds. Test runs turn it off, and the development scripts pass `--no-sandbox`.

The renderer is served from `brainstrike-app://bundle`, never from `file://`. Pop-ups are denied and the main frame cannot navigate away from the app. Packaged builds have no DevTools menu item or shortcut.

## Credentials

Provider keys, MCP bearer tokens and MCP OAuth records live in one file in the profile folder, `brainstrike-credentials.sealed.json`.

- Each value is sealed with Electron `safeStorage`. Account names are left readable, so listing credentials decrypts nothing.
- Only Main can call `safeStorage`. The agent host is the file's only writer and borrows the cipher from Main over its platform port. Main reads the file.
- The key that seals the values is held by the operating system: one Keychain item named `<app name> Safe Storage` on macOS, DPAPI on Windows, and the Secret Service on Linux.
- On Linux the app refuses to save a credential when no keyring is available. It rejects the `basic_text` backend, and it rejects a value sealed with Chromium's fixed fallback key.
- A build run from source uses a different Keychain item name, so it never reads an installed build's key.

Credentials are passed to the code that uses them as direct parameters. The source's rule is that model context, run snapshots and status or log events never carry secrets ([provider contract](https://github.com/seandearnaley/brainstrike/blob/main/docs/agents/assistant-providers.md)).

For MCP, a bearer token is read for each request, attached only for the exact configured origin, and never cached. OAuth discovery, PKCE and token refresh are done by the official MCP SDK. Brainstrike adds the storage, the hand-off to your browser and a callback listener on `127.0.0.1` at a temporary port, which accepts only the exact loopback `Host` and passes no callback parameters to the renderer.

## Command sandbox

On macOS and Linux the agent's shell commands and its Python tool run inside an operating-system sandbox. A sandboxed shell command can write only in its open folder and its own temporary folder, can read everything except a fixed list of credential stores, and has no network access. The Python tool reaches only the domains approved for that call. If the sandbox cannot start, the command is refused; it does not run unsandboxed instead. Windows has no sandbox, and long-running command sessions run unsandboxed on every platform. [Sandbox](/guides/sandbox/) covers the details and how a command is allowed out.

## Agent browser

Tabs the agent opens are separate from yours ([ADR-0025](https://github.com/seandearnaley/brainstrike/blob/main/docs/adr/0025-agent-browsing-egress-proxy.md)).

- Agent tabs use an in-memory session partition, `browser-pane-agent`. They share no cookies or sign-ins with your tabs, and nothing persists across launches. The agent never navigates a tab you opened.
- The partition's only route out is the egress proxy, which listens on loopback with a per-launch credential. Chromium's direct route to localhost is removed, and WebRTC is confined to proxied UDP.
- For each connection the proxy resolves the name once, refuses if any answer is a special-use address (loopback, private networks, link-local, cloud metadata), and dials the address it checked. A page that redirects to your local network is refused as `blocked_destination`.
- A local dev server is reachable only at an origin you approved: `localhost`, `127.0.0.1` or `[::1]` at one exact port, and only from the tab that opened it.
- The first navigation to each origin asks you, in every access mode. That consent covers the address requested. A page can still redirect or load from elsewhere, through the proxy.
- Both browser sessions deny every permission request and cancel every download. Tabs run sandboxed with no preload and no Node.

Your own tabs use a persistent partition and connect directly, without the proxy.

## MCP Apps

An MCP App is HTML from an MCP server, so it is treated as untrusted.

- The app's document is an `about:srcdoc` iframe with `sandbox="allow-scripts"`. It has an opaque origin and no `allow-same-origin`, `allow-popups`, `allow-downloads`, `allow-forms` or `allow-top-navigation`.
- Its CSP starts from `default-src 'none'`, with no `unsafe-eval`, and adds only the connect, frame and resource domains the app's resource declares.
- That frame sits inside a shell document served from `brainstrike-mcp-app://<128-bit token>/`, so each shell has its own origin, separate from the renderer's. `blob:` is never a frame source.
- The shell cannot navigate, and the app frame can load only its own `about:srcdoc`.
- Permission requests from either frame are denied, and downloads from a shell origin are cancelled.
- A tool call from an app is bound to the thread that owns the app's tool result and goes through the same allow or ask decision as the agent's own calls.

The boundary is an in-page nested iframe in the main window's session. The source states plainly that it is no separate WebContents or session partition. [MCP servers](/guides/mcp/) explains how to turn Apps off.

## Workspace trust

Opening a folder does not let it configure the agent ([ADR-0032](https://github.com/seandearnaley/brainstrike/blob/main/docs/adr/0032-workspace-trust.md)). Each folder is `trusted`, `restricted` or undecided, keyed by its canonical path, and only a trusted folder's instructions (`AGENTS.md`, `CLAUDE.md`), skills, slash commands and subagent personas are loaded. A subfolder and a managed worktree each have their own answer. The agent host records the answer in its own settings, outside the folder. Configuration in your home folder (`~/.brainstrike`, `~/.claude`) is yours and always loads.

Trust is about configuration. The agent can still read, search and edit an untrusted folder under your access mode and permissions. Project hooks and the worktree setup script have a stricter rule: each is approved by the hash of its exact content, so an edit asks again.

## Updates and downloads

| Platform | What is published | Integrity |
| --- | --- | --- |
| macOS | DMG and update zip, built from the same app | Signed with a Developer ID Application identity, notarized, ticket stapled, hardened runtime. The DMG container itself is unsigned. |
| Windows | NSIS installer | Not code-signed. |
| Linux | AppImage | A SHA-256 digest only. |

- Every release publishes `SHA256SUMS`. See [Check your download](/start/install/#check-your-download).
- The release workflow fails a macOS build unless `codesign`, `stapler` and `spctl` all confirm the signature and notarization.
- A release is built only from a commit on which the full nightly test run passed. Published assets are never replaced or deleted.
- In-app updates come from the public GitHub release feed. The update metadata declares a size and SHA-512 for each file, and the release pipeline checks the staged files against it before publishing.
- The release manifest, `release-manifest.json`, is validated for structure. It is **not cryptographically authenticated**. The [release contract](https://github.com/seandearnaley/brainstrike/blob/main/apps/desktop/RELEASES.md) says a consumer cannot treat a digest declared there as a verified download.

The macOS app is not App-Sandboxed. Its entitlements are `allow-jit`, `allow-unsigned-executable-memory` and `disable-library-validation`; the last is there because the bundle loads code not signed by the developer's team, such as the Electron framework and the bundled Python.

## Electron fuses

Fuses are set in every packaged build (`electronFuses` in [`package.json`](https://github.com/seandearnaley/brainstrike/blob/main/apps/desktop/package.json)).

| Fuse | State | Reason given in the source |
| --- | --- | --- |
| `onlyLoadAppFromAsar`, `enableEmbeddedAsarIntegrityValidation` | on | The app loads only from `app.asar` and, on macOS and Windows, refuses one whose contents do not match the embedded hash. |
| `enableCookieEncryption` | on | The cookie store is encrypted with the OS key. |
| `grantFileProtocolExtraPrivileges` | off | No page loads from `file://`. |
| `runAsNode` | on | The agent host runs the TypeScript language server, Node skill scripts, hooks and the Windows command wrapper through `ELECTRON_RUN_AS_NODE`. |
| `enableNodeOptionsEnvironmentVariable` | on | `NODE_OPTIONS` carries `NODE_EXTRA_CA_CERTS`, which users behind a TLS-inspecting proxy need. |
| `enableNodeCliInspectArguments` | on | The packaged end-to-end tests attach through `--inspect`. |
| `resetAdHocDarwinSignature` | on | Setting a fuse rewrites the binary. The signed macOS build is signed again afterwards. |

The source records the three Node fuses (`runAsNode`, `enableNodeOptionsEnvironmentVariable`, `enableNodeCliInspectArguments`) as an owner decision of 2026-10-31, to be revisited once Windows builds are signed.

## Known limits

- **The Windows installer is unsigned.** SmartScreen warns before it runs. Because the build is unsigned, its asar integrity check detects corruption only and does not resist a rewritten app. Linux has no asar integrity check.
- **No command sandbox on Windows.** Commands run unsandboxed there, and the approval card says so. Command sessions are unsandboxed on every platform, and the sandbox does not wrap `stdio` MCP servers.
- **Three Node fuses remain enabled.** The packaged binary still honours `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and `--inspect`.
- **The release manifest is unauthenticated.** Verify a download against `SHA256SUMS` or, on macOS, the notarized signature.
- **Auto mode is not a security boundary.** [ADR-0031](https://github.com/seandearnaley/brainstrike/blob/main/docs/adr/0031-access-modes-and-auto-review.md) calls it a convenience over _Ask for approval_ and says the reviewer can be wrong in both directions. See [Approvals](/guides/approvals/).
- **The sandbox does not limit reads.** It limits writes and network access. A sandboxed command can read your files outside the open folder, apart from the denied credential stores.
- **MCP tools are allowed by default.** The MCP permission category starts on Allow, on the reasoning that you added each server yourself.
- **Crash reports can contain process memory.** They stay on disk until a factory reset deletes them.

## Report a vulnerability

Report security problems privately through GitHub's private vulnerability reporting: [open a report](https://github.com/seandearnaley/brainstrike/security/advisories/new).

If you attach a crash report from **Help**, then **Show Crash Reports**, remember that a minidump can hold memory from the crashed process, including data from your session.
