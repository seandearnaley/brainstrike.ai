---
title: Project configuration
description: The files a folder can use to configure the agent, where each one lives, its format, and the trust or approval it needs before it loads.
---

A folder can carry files that steer the agent: instructions, skills, slash commands, subagents, hooks and a worktree setup script. Your home directory can hold your own versions of most of them.

| What | In the folder | In your home directory | Loads when |
| --- | --- | --- | --- |
| Instructions | `AGENTS.md`, `AGENT.md` or `CLAUDE.md` at the top level | None | The folder is trusted |
| Skills | `.brainstrike/skills/`, `.claude/skills/` | `~/.brainstrike/skills/`, `~/.claude/skills/` | The folder is trusted |
| Slash commands | `.brainstrike/commands/`, `.claude/commands/` | `~/.brainstrike/commands/`, `~/.claude/commands/` | The folder is trusted |
| Subagents | `.brainstrike/agents/` | `~/.brainstrike/agents/` | The folder is trusted |
| Hooks | `.brainstrike/hooks.json` | `~/.brainstrike/hooks.json` | You approve the file's exact contents |
| Worktree setup script | `.brainstrike/worktree-setup.sh` | None | You allow the script's exact contents |

Files in your home directory are your own, so they load without any of these checks.

## Trust a folder

A cloned repository steers nothing until you trust it. When an open folder holds instructions, skills, slash commands or subagents and you have not answered for it, a prompt above the message box asks "Trust the files in" followed by the folder's name, and lists what it holds.

- **Trust folder** loads them from your next message.
- **Keep restricted** leaves them out. The prompt does not come back.

Nothing waits on the prompt. A message sent before you answer runs without the folder's configuration.

A folder you have not trusted still works. The agent can read, search and edit it under your [access mode and permissions](/guides/approvals/).

**Settings**, then **Workspace Trust**, lists every open folder with what it holds, and changes the answer with **Trust** or **Restrict**. Trust is recorded for the folder's path. A subfolder has its own answer, and so does a worktree, because it is a different folder.

Hooks and the worktree setup script run commands, so they are not covered by folder trust. Each has its own approval, pinned to the file's contents. Editing the file asks again.

## Instructions

Put `AGENTS.md` at the top level of the folder. Brainstrike reads the first of `AGENTS.md`, `AGENT.md` and `CLAUDE.md` that it finds, and only that one. The file is plain Markdown with no required structure.

- The file is added to the agent's context on every turn, so an edit applies to your next message.
- A file up to 12,000 characters is added whole. A larger one is left out unless you opt that folder in, and then it is added truncated.
- Across all open folders the total is capped at 48,000 characters. Folders past the cap are reported to the agent as omitted.

**Settings**, then **Workspace Instructions**, has the **Inject workspace instructions** switch, which is on by default, and lists each folder's file with its size and status. That list shows every open folder's file, including folders you have not trusted, whose files do not load.

## Skills

A skill is a folder that contains a `SKILL.md` file, placed directly under a skills folder: `.brainstrike/skills/<name>/SKILL.md`.

```markdown
---
name: release-notes
description: Drafts release notes from the commits since the last tag.
---

Write the steps the agent should follow here.
```

- `name` and `description` are required. The file must start with the `---` block.
- `name` uses lowercase letters, numbers and hyphens, up to 64 characters, and must match the folder's name.
- `description` is up to 1,024 characters.
- `SKILL.md` can be up to 64,000 characters.

The agent sees each skill's name and description, and loads the full instructions when it needs them. To invoke one yourself, type `/skill:<name>` in the message box.

When two skills share a name, the first of these wins: the folder's `.brainstrike/skills`, `~/.brainstrike/skills`, the folder's `.claude/skills`, `~/.claude/skills`.

**Settings**, then **Skills**, lists what was found, with a switch for each skill and **Enable Agent Skills** for all of them. A skill that failed to load is listed with its error, and a skill hidden by another of the same name says which one won. Skills are read again for each run.

## Slash commands

A command is a Markdown file in a commands folder. The file name is the command: `.brainstrike/commands/review.md` becomes `/review`, and `git/commit.md` in a subfolder becomes `/git:commit`.

```markdown
---
description: Review the staged changes
---

Review the staged changes and list any problems. Focus on $ARGUMENTS.
```

- The `---` block is optional. Without it the whole file is the template. Inside it, `name` and `description` are read and other keys are ignored.
- Choosing a command puts its text in the message box. It is never sent for you.
- `$ARGUMENTS` and `$1`, `$2` and so on are placeholders for arguments. A placeholder with no value stays in the message box for you to replace.
- `@path` in the template becomes a file mention when Brainstrike can tell which open folder the path belongs to. Otherwise it stays as text.
- Shell syntax in a template is never run. It stays as text.

The same order as skills decides which command wins when two share a name.

## Subagents

A subagent is a Markdown file in `.brainstrike/agents/`. The file name is its id, so `security-auditor.md` defines `security-auditor`. Use letters, digits, hyphens and underscores. The ids `explore`, `analyze` and `worker` belong to the built-in subagents.

```markdown
---
description: Reviews a change for security problems.
---

You review code for security problems. Report what you find with file paths.
```

The `---` block and `description` are required, and the text after the block is the subagent's instructions. Optional keys:

| Key | Value |
| --- | --- |
| `name` | A display name |
| `mode` | `read-only` or `worker`. Without it the subagent is read-only. |
| `tools` | A comma-separated list of tools, or one `- item` per line. Without this key a read-only subagent gets file search and file reading tools, and a worker gets every tool the thread may use. |
| `model` | A model to pin, written `provider::modelId` |
| `effort` | `none`, `minimal`, `low`, `medium`, `high`, `xhigh` or `max`, for the pinned model. It needs `model`. |
| `maxSteps` | A whole number that lowers the step limit from Settings |

A file in the folder wins over a file of the same name in `~/.brainstrike/agents/`. Subagent files are read when a run starts, so a change applies from your next message.

**Settings**, then **Subagents**, lists every subagent and shows the error for a file that did not load. Like the instructions list, it shows files from every open folder, including folders you have not trusted.

## Hooks

A hook is a shell command that Brainstrike runs at a point in a run. `hooks.json` is a JSON object with one array per event:

```json
{
  "PreToolUse": [
    {
      "type": "command",
      "command": "./scripts/check-tool-call.sh",
      "description": "Check each tool call"
    }
  ]
}
```

| Event | Runs | Can it stop things |
| --- | --- | --- |
| `UserPromptSubmit` | When you send a message | Yes |
| `PreToolUse` | Before a tool call | Yes |
| `PostToolUse` | After a tool call | No |
| `Stop` | When a run ends | No |

- Each hook needs `"type": "command"` and a `command`. `description` is optional. `timeout` is in milliseconds, and the default is 10 seconds.
- On the two tool events, `"matcher": { "tool_name": "<pattern>" }` limits the hook to tools whose name matches the regular expression. Without it the hook runs for every tool.
- The command receives a JSON description of the event on standard input. Values under keys that look like secrets are redacted.
- Exit code `2` blocks the message or the tool call. Any other non-zero exit, or a timeout, is reported as a warning and the run continues.
- A hook can print a JSON object. `reason` explains a block, and `additionalContext` is passed to the agent.
- A hook can block a call that would otherwise run or ask. It cannot allow a call that a deny refuses.

A folder's hooks run in that folder. They run only after you choose **Approve** for it in **Settings**, then **Hooks**. **Revoke** withdraws the approval. A file that is not approved, changed after approval or invalid contributes no hooks. Hooks are loaded again for each run.

## Worktree setup script

`.brainstrike/worktree-setup.sh` runs once in each new worktree created for the repository, after you choose **Allow script** in the create dialog. See [Review changes](/guides/changes/).

- It runs with `/bin/sh` and has five minutes to finish.
- It receives `BRAINSTRIKE_WORKSPACE_NAME`, `BRAINSTRIKE_WORKSPACE_PATH`, `BRAINSTRIKE_ROOT_PATH` and `BRAINSTRIKE_PORT`. The port is derived from the worktree's path. It is not checked to be free.
- A **Setup command** in **Settings**, then **Workspace**, replaces the script. The same card can disable setup entirely.
- On Windows the script is not run, because it needs a POSIX shell. Set a setup command in Settings there.
- **Settings**, then **Workspace**, lists your decisions under **Repository setup script consent**. **Revoke** makes Brainstrike ask again next time.

A `.worktreeinclude` file at the top of the repository lists files to copy into each new worktree, one relative pattern per line. Lines that start with `#` are comments. The copy can include gitignored files, and it happens whether or not you allow the script.

## Keep files away from the agent

A `.llmignore` or `.brainstrikeignore` file excludes paths from the agent's file tools. An excluded path cannot be read or changed by them.

Credential files are excluded whatever those files say: `.env` and `.env.*`, `*.pem`, `*.key` and `id_rsa*`. The exceptions are `.env.example`, `.env.sample` and `.env.template`.

Shell commands are governed by the Execute permission. Neither rule stops a command from touching an excluded path.

Read more: [the workspace trust decision](https://github.com/seandearnaley/brainstrike/blob/main/docs/adr/0032-workspace-trust.md) and [the workspace context contract](https://github.com/seandearnaley/brainstrike/blob/main/docs/agents/workspace-context.md).
