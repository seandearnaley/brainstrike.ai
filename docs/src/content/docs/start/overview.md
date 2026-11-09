---
title: What Brainstrike is
description: A desktop app that runs AI agents inside your folders and puts every file read, search, command and edit on screen for you to review, revert or redirect.
---

Brainstrike is a desktop app for macOS, Windows and Linux. You open a folder, connect a model provider with your own key, and ask an agent to do something. Everything the agent does appears in the thread as it happens, and every change it makes can be reviewed and undone.

Brainstrike is open source under the MIT license and is in beta.

## Watch the work

- **Every step is in the thread.** Searches, file reads, edits, commands, plans and approvals appear as they happen, grouped by turn with how long each took.
- **You choose how much it asks.** _Ask for approval_ stops before every edit or command. _Auto_ lets a quick model approve routine actions and asks you only about risky ones. _Full access_ runs unattended. See [Access modes and approvals](/guides/approvals/).
- **Plans and questions are built in.** The agent can propose a plan for you to accept, keep a task list, and ask you a question when it needs a decision.
- **Subagents you can follow.** The agent can hand work to Explorer, Analyst and Worker helpers. Each runs in the background as a live card, on the model you pick for it.

## Review every change

- **Each turn lists what it changed**, including side effects from commands. The list opens in the Changes tab, drawn from git's own patch.
- **Stage, unstage or revert** by hunk, by file or by whole turn. See [Review changes](/guides/changes/).
- **Restore to before this message** rewinds a thread, reverts the runs it started and puts your prompt back so you can edit it.
- **Comment on a diff line** and the comment goes into your next message with the file, line and code quoted.

## Work in your repository

- **Worktrees.** A thread can work in its own git worktree, so it does not disturb your checkout.
- **Sandboxed commands.** On macOS and Linux, shell commands and the bundled Python run inside an operating-system sandbox. Windows does not have this yet; see [Install](/start/install/#windows).
- **See what the model sees.** The explorer marks the files each thread touched and their token counts. Search runs ripgrep over the live files. The Context map shows what each model call received.

## Bring your models and tools

- **Hosted models with your own key:** OpenAI, Anthropic, Google AI Studio (Gemini), OpenRouter and Amazon Bedrock. Saved keys are encrypted with the operating system's credential store.
- **No local models.** Every model call goes to the provider you connected. Brainstrike does not run models on your machine. See the [Models FAQ](/guides/models-faq/).
- **MCP servers** over stdio, Streamable HTTP or SSE, with OAuth sign-in and MCP Apps. See [MCP servers](/guides/mcp/).
- **Agent Skills** from `.brainstrike/skills` or `.claude/skills`, plus `AGENTS.md` and `CLAUDE.md` instructions, slash commands and your own subagents. These load only from folders you have trusted. Hooks need their own approval. See [Project configuration](/guides/project-config/).
- **The web.** An agent browser that navigates, clicks and types, and web search through the provider's own search or Tavily.

## Pick up where you left off

- **Thread search** covers titles, messages and folders.
- **Branching.** Edit any earlier message to try another path, then step between the branches.
- **Memory** keeps long threads in context, per thread or shared across threads.
- **The agent keeps working with the window closed.** The app stays in the Dock on macOS and in the tray on Windows and Linux, where the desktop has one.

## How it is built

Electron hosts the interface. A separate agent host process owns runs, conversations and access to your folders, and records them in a local SQLite store. The [AI SDK](https://ai-sdk.dev) drives the model loop.

The design decisions are written down as [architecture decision records](https://github.com/seandearnaley/brainstrike/tree/main/docs/adr) in the source repository.
