---
title: First run
description: Go from launching Brainstrike to your first answered message by connecting a provider, opening a folder, answering the trust prompt and choosing an access mode.
---

This page follows the first few minutes in the app. It assumes Brainstrike is installed; if it is not, start with [Install](/start/install/).

## What you see on launch

A new thread opens with the heading **What’s on your mind?** and the line "The thread is saved when you send your first message."

Until a provider is connected, the message box is disabled and the screen says:

> Connect an AI provider in Settings → Providers to enable the assistant.

The **Connect a provider** button under that message opens the right settings page.

## Connect a provider

Brainstrike calls hosted models with your own key. You need a key from OpenAI, Anthropic, Google AI Studio, OpenRouter or Amazon Bedrock.

1. Choose **Connect a provider**, or open **Settings…** yourself. On macOS it is in the app menu (`Cmd+,`). On Windows and Linux it is in the **File** menu (`Ctrl+,`). Then open **Providers**.
2. Open the card for your provider. A provider with no key is marked **Not connected** and its card says **Connect**.
3. Choose **Set**, paste the key and choose **Save**.
4. Brainstrike tests the new key against the provider and shows the result on the card. **Verified** means the key works.
5. Under **Models**, turn on the models you want to use. One model per provider carries a **Recommended** badge.

[Connect a provider](/guides/providers/) covers each provider, environment variables and Bedrock's options.

## Open a folder

The agent works inside folders you open. There are three ways to open one:

- **File**, then **Open Folder…** (`Cmd+O` on macOS, `Ctrl+O` on Windows and Linux).
- The folder chip in the message box. With no folder open it reads **Choose a folder**.
- **Add Folder to Workspace** in the file explorer. An empty explorer says "No folders in your workspace".

A thread can hold more than one folder. The folder chip's menu has **Add folder…** and a list of recent folders.

## Answer the trust prompt

Some folders carry files that steer an agent: an `AGENTS.md` or `CLAUDE.md` instructions file, skills, slash commands or subagents. When you open one for the first time, a prompt appears above the message box:

> Trust the files in _folder name_?
>
> This folder has _what was found_, which can steer the assistant. Brainstrike loads them only from folders you trust.

The prompt names what it found, for example "AGENTS.md, 2 skills, and 1 slash command".

| You choose | What happens |
| --- | --- |
| **Trust folder** | Runs in this folder load its instructions, skills, slash commands and subagents. |
| **Keep restricted** | Runs leave all of those out. |

Either answer is saved for that folder, so the prompt does not come back. A few things to know:

- **A restricted folder still works.** The agent can read, search and edit it under your access mode. Only the folder's own agent configuration is held back.
- **Nothing waits for your answer.** If you send a message first, that run leaves the folder's configuration out.
- **A folder with none of these files does not ask.**
- **Your own configuration is separate.** Instructions and skills in `~/.brainstrike` and `~/.claude` in your home directory load as before.
- **Hooks have their own approval.** Trusting a folder does not approve its hooks.
- **A thread's worktree is a different folder,** so it asks again.

To change an answer later, open **Settings**, then **Workspace Trust**. Each open folder is listed as **Trusted**, **Restricted** or **Not trusted yet**.

Read more: the [workspace trust decision](https://github.com/seandearnaley/brainstrike/blob/main/docs/adr/0032-workspace-trust.md).

## Choose an access mode

The access control sits in the message box. Its menu asks "How should Brainstrike’s actions be approved?" and offers three modes:

| Mode | The app's description |
| --- | --- |
| **Ask for approval** | Always ask before editing files or running commands |
| **Auto** | A quick model approves routine actions; only asks for risky ones |
| **Full access** | Unrestricted: edits files and runs commands without asking |

**Ask for approval** is the default, and it is the mode to start with. Keep these limits in mind before you move off it:

- **Auto is a convenience over asking.** Its reviewer can be wrong in both directions, so do not treat it as a security boundary.
- **Windows has no sandbox.** Commands there run with full access to your files and network. See [Install](/start/install/#windows).

[Approvals](/guides/approvals/) explains what each mode asks about. [Sandbox](/guides/sandbox/) explains where commands run.

## Send a message

1. Pick a model with the model control in the message box. It opens a searchable list of the models you turned on.
2. Type what you want and press `Enter`.
3. To stop a reply, choose **Stop** or press `Esc`.

## What you see in the thread

The agent's steps appear as they happen: searches, file reads, edits, commands, plans and requests for approval. They are grouped by turn, with how long the turn took.

In **Ask for approval**, the agent stops before each edit or command and waits for your answer.

When a turn ends, it lists the files it changed, including side effects from commands. The list opens in the **Changes** tab, where you can stage or revert by hunk, by file or by whole turn. See [Changes](/guides/changes/).

## What to try first

- **Ask a question about the folder.** For example, ask where a feature is implemented. You will see the searches and file reads the agent uses to answer.
- **Ask for one small edit.** Stay in **Ask for approval**, read the request before you allow it, then review the result in the **Changes** tab.
- **Undo it.** **Restore to before this message** rewinds the thread, reverts the runs it started and puts your prompt back so you can edit it.

If the message box stays disabled or a command is refused, see [Troubleshooting](/reference/troubleshooting/).
