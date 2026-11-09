---
title: MCP servers
description: Add Model Context Protocol servers from the catalog or by hand, sign in, choose which tools the agent may use, and control MCP Apps.
---

Brainstrike is a Model Context Protocol (MCP) client. An MCP server gives the agent more tools, and can also offer prompts, resources and small interfaces called MCP Apps.

You set servers up in **Settings**, then **AI Tools**. That page has two tabs: **Tools** and **MCP Config**. This page describes version 0.1.0-beta.6.

## Add a server from the catalog

Open the **MCP Config** tab. The **MCP catalog** card lists five remote servers run by their vendors.

| Server | Sign-in | Access you can pick |
| --- | --- | --- |
| Linear | OAuth | Read & write, or Read-only |
| GitHub | Token (a fine-grained personal access token) | Read & write, or Read-only |
| Atlassian | OAuth | Read & write |
| GitLab | OAuth | Read & write |
| Suno | OAuth | Read & write |

Choose **Install**. For GitHub a dialog asks for the token first, and **Create a token** opens GitHub's token page. **Docs** opens the vendor's own page for its server.

The catalog is a list built into the app. Installing downloads nothing: it adds one entry to your MCP config file that points at the vendor's URL. If the config editor below has unsaved text, save or reload it before installing.

## Add a server by hand

The **MCP Config** tab also holds the config file itself.

- **MCP Config Path** shows which file is in use. By default it is `mcp/mcp.config.json` inside the app's profile folder. **Browse** or **Apply Path** selects another file by absolute path, and **Reset** returns to the default.
- **Config Editor (JSONC)** edits the file. Comments and trailing commas are allowed. **Save** validates the text first, and **Reload** reads the file again from disk. Brainstrike watches the file, so edits you make in another editor are picked up too.

The file is one object with a `servers` array:

```jsonc
{
  "servers": [
    // A local program, started by Brainstrike
    {
      "transport": "stdio",
      "name": "filesystem",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/absolute/path/to/workspace"]
    },
    // A remote server that signs in with OAuth
    {
      "transport": "streamable-http",
      "name": "linear",
      "protocol": "auto",
      "url": "https://mcp.linear.app/mcp",
      "auth": { "type": "oauth-user" }
    }
  ]
}
```

| Key | Applies to | Meaning |
| --- | --- | --- |
| `transport` | all | `stdio`, `streamable-http` or `sse`. Required. |
| `name` | all | The server's name. Two servers cannot share one. |
| `command`, `args`, `env` | `stdio` | The program to start, its arguments and its environment variables. |
| `url` | HTTP transports | An `http` or `https` address with no user name or password in it. |
| `auth` | HTTP transports | `{ "type": "none" }`, `{ "type": "oauth-user" }` or a stored bearer token. See [Sign in](#sign-in). |
| `headers` | HTTP transports | Extra request headers. They are saved as plain text in this file. |
| `protocol` | all | `legacy`, `auto` or `2026-07-28`. Left out, it means `legacy`. |
| `toolTimeoutMs` | all | How long a tool may stay silent, in milliseconds. See [Timeouts](#timeouts). |
| `extensions` | all | Turns MCP Apps or MCP Tasks off for this server. See [MCP Apps](#mcp-apps). |

A key the app does not recognize is reported as an error, and **Save** refuses text that does not validate.

## Transports

- **`stdio`** starts a program on your machine and talks to it over standard input and output. Brainstrike starts it with the command, arguments and environment in the config. The [command sandbox](/guides/sandbox/) does not wrap it.
- **`streamable-http`** is for remote servers. The in-app help recommends it for new remote endpoints.
- **`sse`** is for older HTTP+SSE servers only. It requires `"protocol": "legacy"`, cannot sign in with OAuth, and gets no MCP Apps or MCP Tasks.

The transport is always the one you configured. A failed connection never makes Brainstrike try a different one.

## Sign in

### OAuth

A `streamable-http` server with `"auth": { "type": "oauth-user" }` waits for you to sign in. Until you have, its row on the **Tools** tab shows `authentication-required` and a **Connect** button.

1. Choose **Connect**. Your default browser opens the server's sign-in page.
2. Approve the request there within five minutes. The browser returns to a temporary address on `127.0.0.1` that Brainstrike listens on for this one sign-in.
3. The row changes to `connected`. Later launches reconnect with the stored sign-in.

If a `streamable-http` server with no `auth` answers **Connect** with a request to sign in, Brainstrike starts the same OAuth flow and writes `"auth": { "type": "oauth-user" }` into that server's config entry.

**Reauthorize** clears the stored OAuth credentials and starts a new sign-in. **Disconnect** removes them. Both ask you to confirm. **Connection details** on the row lists the requested and granted scopes, the authorization server and the last successful connection. To ask for specific scopes, add them to the entry: `"auth": { "type": "oauth-user", "scopes": ["read"] }`.

### Bearer token

When you install GitHub from the catalog, Brainstrike stores the token you paste and writes only a reference to it into the config:

```jsonc
"auth": {
  "type": "bearer",
  "credential": { "store": "mcp-credentials", "id": "00000000-0000-4000-8000-000000000000" }
}
```

The token is read again for each request and is sent only to the exact origin of the server's `url`. In this version the catalog install is the only Settings control that stores a bearer token. You cannot combine an `auth` mode with an `Authorization` entry in `headers`.

### Where tokens are stored

Bearer tokens and OAuth records are kept in the same file as your provider keys, `brainstrike-credentials.sealed.json` in the profile folder. Each value is encrypted with a key held by your operating system's credential store. Settings shows only whether a credential is stored, missing, malformed or unreadable, never the token. See [Security model](/reference/security/) for who can read the file and [Privacy and your data](/reference/privacy/) for what a reset removes.

## Choose which tools the agent can use

The **Tools** tab lists every tool in groups. Each MCP server is one group, described as `MCP server:` and its name.

Each tool has a switch, and a tool that is switched off is not offered to the agent. The group menu has **Enable All**, **Disable All**, **Refresh Connection** and **Open Config File**.

Whether an enabled tool needs your approval is set in **Settings**, then **Permissions**:

- **Tool category policies** has an **MCP** row, "Call external MCP server tools", that you can set to **Allow**, **Ask** or **Deny**. It starts on **Allow**, so MCP tools run without asking until you change it.
- **Per-tool overrides** set one tool apart from its category. Choosing **Always allow** on an approval prompt adds one, and you can change or remove it here.

[Approvals](/guides/approvals/) explains the access modes and approval prompts.

## Use server prompts as slash commands

Prompts offered by a connected server appear in the message box's `/` menu. Each is labelled with its title and the server's name, and its command is `mcp:<server>:<prompt>`.

Choosing a prompt sends nothing. If the prompt takes arguments, a dialog asks for them. The result is placed in the message box for you to read, edit and send.

## MCP Apps

An MCP App is a small HTML interface that a server attaches to a tool's result. Brainstrike shows it in the thread as that tool call's result.

The app's page comes from the server, so it is treated as untrusted:

- It runs in a sandboxed frame that may run scripts and nothing else: no pop-ups, downloads, form submissions or navigation away.
- Its content policy starts from "load nothing" and adds only the domains the app's own resource declares.
- Requests for permissions such as notifications are denied.
- A tool call made from inside the app goes through the same allow, ask or deny policy as any other tool call.

MCP Apps are on by default. To turn them off:

- **For every server:** on the **Tools** tab, under **Registered MCP extensions**, switch off **MCP Apps**.
- **For one server:** add `"extensions": { "apps": false }` to its config entry.

Either one is enough. With Apps off for a server, Brainstrike stops telling that server it supports them, and any of its apps already on screen are closed. **MCP Tasks** has the same switch and the same per-server key, `"tasks"`.

## Timeouts

| What | Limit | What you see |
| --- | --- | --- |
| Connecting without you present, such as at startup | 10 seconds | The attempt ends. A row in the `error` state has a **Retry** button. |
| OAuth sign-in | 5 minutes in the browser | "MCP OAuth authorization callback timed out." |
| A tool call that reports no progress | 60 seconds | The call is stopped and a cancellation is sent to the server. |
| A tool call in total | 10 minutes | The call is stopped even if it is still reporting progress. |

Each progress notification from the server restarts the 60-second window. For a server whose tools work in silence for longer, set `toolTimeoutMs` on its entry, from `1000` to `600000`, for example `"toolTimeoutMs": 180000`. The 10-minute total still applies.

## What Brainstrike supports

The **Tools** tab shows this list under **MCP protocol support**.

| Feature | Status |
| --- | --- |
| MCP 2026 core transport and tools (protocol revision `2026-07-28`) | Supported |
| MCP core server features: resources, templates, prompts, completions and pagination | Supported |
| MCP elicitation, by form and by URL | Supported |
| MCP Apps (`io.modelcontextprotocol/ui`) | Supported |
| MCP Tasks (`io.modelcontextprotocol/tasks`), on `stdio` and `streamable-http` | Supported |
| OAuth Client Credentials | Unsupported |
| Enterprise-Managed Authorization | Unsupported |

The project tests its client against its own protocol fixtures. Its [conformance notes](https://github.com/seandearnaley/brainstrike/blob/main/docs/agents/mcp-conformance.md) state that it runs no official MCP conformance suite. The table lists what the app implements.
