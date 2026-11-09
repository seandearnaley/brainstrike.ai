---
title: Privacy and your data
description: What Brainstrike sends off your machine and when, what it does not send, where it keeps data on disk, and what each reset removes.
---

Brainstrike keeps your threads, settings and keys on your computer. This page lists the network requests its own code makes, and where your data sits on disk. Everything here was read from the source of version 0.1.0-beta.6.

## What leaves your machine

| What | Where it goes | When |
| --- | --- | --- |
| Model requests | The provider you connected | Every turn, and for the extra requests listed below |
| Key checks and model details | The same provider | When you choose **Test connection**, and when you use an OpenRouter model |
| Update checks | GitHub | At launch and every four hours, in an installed build |
| Web search and page extraction | Your model provider, or Tavily | When the agent uses those tools |
| Browsing | The sites that are opened | When you or the agent open a page in the browser pane |
| MCP traffic | The MCP servers you added | When a server connects and when its tools are called |
| Commands | Whatever the command contacts | When a command runs outside the sandbox |
| Trace export | A collector you name | Only if you set it up |

### Model requests

Model requests go from the agent host process to your provider: OpenAI, Anthropic, Google AI Studio, OpenRouter or Amazon Bedrock. The window itself cannot reach a provider, because its content policy allows connections only to the app and to `127.0.0.1` and `localhost`.

A request holds what the model needs for that step:

- the agent's instructions, including `AGENTS.md`, `CLAUDE.md` and skills from folders you have trusted (see [Security model](/reference/security/));
- your messages and the conversation so far;
- the agent's tool calls and their results. That includes the contents of files it read, search results and command output;
- memory notes, when memory is on.

The Context map in the app shows what each model call received.

Some requests are made for you without a message from you. They go to a provider you have connected:

- a title for a new thread;
- a summary, when a long conversation is compacted to fit the model's limit;
- memory observations, which use your chat provider unless you pick another observer model in **Settings**, then **Assistant Memory**;
- in _Auto_ mode, a review of each action that would otherwise ask you. The reviewer is sent your requests and the agent's tool calls, and never tool results.

With an OpenAI key, the app uses OpenAI's stored responses (`store: true`): OpenAI keeps each response on its side so later steps can refer to it. See [Providers](/guides/providers/) for keys and endpoints.

### Key checks and model details

**Test connection** in **Settings**, then **Providers**, sends one authenticated request to that provider, such as a request for its model list.

The model catalog and its prices are a file inside the app. One lookup is live: when you use an OpenRouter model, the app asks OpenRouter for that model's details, with your OpenRouter key.

### Update checks

An installed build asks the public release feed of `seandearnaley/brainstrike-releases` on GitHub whether a newer version exists, at launch and every four hours. A newer release is downloaded in the background. A build you run from source never checks. See [Install](/start/install/#updates).

### Web search and page extraction

When your provider is OpenAI or Anthropic, web search can run as that provider's own search tool, on the provider's side. Otherwise it uses Tavily, and only if you saved a Tavily key: the query goes to `api.tavily.com`. Page extraction sends the page's address to Tavily, and Tavily fetches the page. Without a Tavily key the Tavily tools report that they are unavailable.

### The browser pane

- **Agent tabs** load the pages the agent opens. They use a separate in-memory session with no cookies or sign-ins from your own tabs, and nothing from it is kept after you quit. The first visit to each site asks you.
- **Your own tabs** connect directly, like a normal browser, and keep their cookies between launches. Text you type in the address bar that is not an address is sent to DuckDuckGo as a search.

[Security model](/reference/security/) describes the proxy that agent tabs go through.

### MCP servers

A remote MCP server receives the tool calls the agent makes to it, with their arguments, along with the credential you set up for it. A `stdio` server is a program on your machine; what it sends onward is up to that program. See [MCP servers](/guides/mcp/).

### Commands

On macOS and Linux, shell commands the agent runs inside the [sandbox](/guides/sandbox/) have no network access, and the Python tool can reach only the domains approved for that call. Commands that run unsandboxed can reach the network: every command on Windows, long-running command sessions, and any command the agent runs outside the sandbox. That last kind needs your approval in _Ask for approval_ and _Auto_, and runs unasked in _Full access_.

### Trace export

The agent host can export OpenTelemetry traces of its model calls. This is off unless you start the app with `OTEL_EXPORTER_OTLP_ENDPOINT` or `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` set, and the traces go to that address only. Prompts, responses and tool data are left out unless you also set `BRAINSTRIKE_OTEL_RECORD_CONTENT=1`. Error messages are recorded either way.

## What is not sent

As of 0.1.0-beta.6:

- **No telemetry or analytics.** The app has no analytics library and no address that receives usage data. The timing and count measurements the source calls telemetry are shown in the app's own diagnostics and are not sent anywhere.
- **No crash uploads.** The crash reporter is started with uploading turned off. Crash reports are written to a `Crashpad` folder on your disk and stay there.
- **No log uploads.** Logs are files on your disk.

How this was checked: all 54 `package.json` files in the repository were searched for analytics, crash-reporting and monitoring packages. The only matches were the OpenTelemetry packages behind the opt-in trace export above. Every web address in the shipped source was then listed. Each one the app contacts by itself appears on this page. The rest are links that open in your default browser when you choose them, such as **Docs** on a catalog card or **Privacy Policy** in the **Help** menu, and references in code comments. The check covers Brainstrike's own source and does not audit the internals of its dependencies.

## Where your data lives

Brainstrike uses two folders, plus a logs folder.

**The state folder** holds your threads and everything the agent did.

| Platform | State folder |
| --- | --- |
| macOS | `data/profiles/default` inside the profile folder |
| Windows | `%LOCALAPPDATA%\Brainstrike\data\profiles\default` |
| Linux | `$XDG_DATA_HOME/Brainstrike/data/profiles/default`, or `~/.local/share/Brainstrike/data/profiles/default` |

| In the state folder | What it is |
| --- | --- |
| `state.db` | The SQLite database: threads and every run event, which includes the file contents and command output the agent saw, plus approvals, usage, open folders and the settings the agent host keeps, such as permissions and workspace trust |
| `blobs/` | Large payloads and the saved earlier versions of edited files, as files named by their content |
| `state-index.sqlite` | The search index over your threads. It is rebuilt from `state.db` when needed |

**The profile folder** is the app's standard per-user data folder. The source places it under `~/Library/Application Support` on macOS and under `%APPDATA%` on Windows.

| In the profile folder | What it is |
| --- | --- |
| `brainstrike-credentials.sealed.json` | Provider keys, MCP tokens and MCP OAuth records, each value encrypted. See [Security model](/reference/security/) |
| `brainstrike-settings` | Desktop settings such as the update channel and tray behaviour |
| `mcp/mcp.config.json` | Your MCP servers, unless you chose another path |
| `session-data/` | The browser engine's storage: interface state for the window, and your browser pane tabs' cookies |
| `Crashpad/` | Crash reports. A report can contain memory from the crashed process |

**Logs** are `brainstrike.log` and `brainstrike-errors.ndjson` in the app's logs folder. On macOS that folder is outside the profile folder. File logging is on by default.

The **Help** menu opens two of these for you: **Show Logs** and **Show Crash Reports**. The crash reports folder is inside the profile folder, so it also shows you where that is.

Two more places hold your data outside the app's folders:

- `~/.brainstrike` holds files you create yourself, such as `skills/` and `hooks.json`, and by default the agent's worktrees in `~/.brainstrike/worktrees`.
- Your project folders hold the agent's edits. Brainstrike does not copy your code into an index; workspace search reads the live files.

## Clearing your data

Both controls are in **Settings**, then **Factory Reset**. Neither can be undone.

| | Clear content | Factory reset |
| --- | --- | --- |
| Threads, prompts, memory, run history and the app's list of worktrees | Deleted | Deleted |
| Open folders list and the thread search index | Deleted | Deleted |
| Error log (`brainstrike-errors.ndjson`) | Deleted | Deleted |
| Settings and tool settings | Kept | Deleted |
| Provider keys, MCP tokens and OAuth records | Kept | Deleted |
| Workspace trust and saved site answers | Kept | Deleted |
| Window state, and cookies in the browser pane | Kept | Deleted |
| Crash reports and downloaded updates | Kept | Deleted |
| `brainstrike.log` | Kept | Kept. The reset dialog says diagnostic logs may be preserved |

Neither control deletes your project folders. A factory reset works on the state folder and the profile folder, so `~/.brainstrike`, worktree folders and an MCP config file you keep at a path of your own are outside what it deletes.

A factory reset also stops update checks until the next launch.

**Factory reset is not available on Windows in this version.** The button is disabled there and the app says so.
