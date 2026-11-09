---
title: Review changes
description: See what each turn changed, stage or revert it by hunk, file or turn, comment on diff lines, rewind a thread, and give a thread its own worktree.
---

Brainstrike draws every diff from git's own patch. The lines you review are the lines git counted, and every stage, unstage and revert goes through git.

## What a turn changed

When a turn that changed files finishes, a list appears under its reply: "2 files changed" with the added and removed line counts. Each file is folded to its header. Open one to read its diff in place.

The list is the difference between the folder when the turn started and when it ended. It includes side effects of shell commands as well as the agent's own edits.

**Review** opens the turn in the **Changes** tab. If the list fails to load, it says "Changes didn’t load." and offers **Retry**.

## The Changes tab

The picker at the top left chooses what you are looking at:

- **Agent turns**, then **Last Turn**: what the most recent finished turn of the active thread changed.
- **Git scopes**: for each repository and worktree, its uncommitted, staged or unstaged changes, its branch against the base branch, and a **Commits** menu with the latest commits.

Under the picker, one line states the scope in words, such as "Agent edits only — this turn" or "All working-tree changes — unstaged in" followed by the worktree's name.

All the files are in one scrolling view:

- Choosing a file in the tree scrolls the diff to it.
- **Inline** switches between inline and side-by-side.
- **Viewed** folds a file. It opens again when the file changes.
- Clicking a line number in a file's new version opens the file at that line in an editor tab.
- Right-clicking a file header opens a menu that copies its path or its patch.

## Stage, unstage and revert

Which actions a file offers depends on the view:

| View | Actions |
| --- | --- |
| Unstaged | **Stage** and **Revert**, for a hunk, a file or every file |
| Staged | **Unstage**, for a hunk, a file or every file |
| Last Turn | **Revert**, for a whole file or every file |
| Uncommitted, branch against base, a commit | None |

- File actions are on each file's header. Hunk actions sit under the hunk's last change. **Stage all**, **Unstage all** and **Revert all** in the toolbar apply to every file that offers the action.
- Reverting a file or every file asks you to confirm. A hunk reverts at once.
- If a file changed after the view was drawn, the action is refused and the view redraws. Nothing is written.
- Hunk actions exist only for modified text files. A binary file, a file whose type changed and a submodule take whole-file actions or none.
- A file with an unresolved merge conflict cannot be shown. The view that holds it is refused.

Reverting from **Last Turn** puts a file back to how it was when the turn started:

- It is offered only while the file is still exactly as the turn left it.
- It is not offered while the thread has a run in progress, or for a turn that is still running.
- **Revert all** reverts every file that still offers it. To revert one hunk of a turn's work, use the unstaged view.

In a Git scope view of the worktree in focus, **Commit** records what is already staged with the message you type, and **Push** pushes it. There is no branch or remote picker.

## Comment on a diff line

1. In the Changes tab, click the **+** beside a line, or drag down the gutter to select several lines.
2. Type the comment and choose **Comment**.
3. When you have the comments you want, choose the toolbar button that adds them, for example **Add 2 comments to message**.

The comments go into the active thread's message box, each with its file, line numbers and the quoted code. Edit the message and send it.

Comments are drafts that stay on the diff until you add them to a message. They are not saved with the thread.

## Restore to before this message

**Restore to before this message** is on each message you sent. It is not offered while a run is in progress. The Changes tab offers the same thing for a turn as **Restore to before this**.

The dialog previews the files the restore would change and offers two choices:

- **Restore conversation and code** restores the files those turns changed, and returns the conversation to before the message.
- **Restore conversation only** returns the conversation to before the message. Nothing on disk is touched.

The restore includes the message you chose: that message and every later one leave the conversation, and your prompt goes back in the message box for you to edit.

If files changed since those turns ran, the dialog lists them and asks you to confirm that they will be overwritten. Restoring is all or nothing. When a turn has no usable snapshot of its files, only the conversation can be restored, and the dialog gives the reason.

After a restore, the notification offers **Undo rewind**. Undo is available until you send your next message.

## Worktrees

A thread can work in its own git worktree, which is a second checkout of the same repository. Your own checkout is left untouched.

### Create or choose one

The chip in the message box shows where the thread works: **Local**, or the worktree's name.

- **New worktree…** opens **Work in a new worktree**. Choose what to **Start from** (_Current branch_ or _Default branch (fresh)_), a **Folder name**, and a **Branch** or **Detached — name the branch later**. **Create & use** creates it and moves the thread into it. This is offered only before the thread's first message.
- **Use existing worktree…** lists every worktree Brainstrike can see, including ones other tools created.

The agent can also create a worktree during a turn. The turn then continues in it.

### Where they live

Worktrees Brainstrike creates go under `~/.brainstrike/worktrees`. **Settings**, then **Workspace**, changes the **Managed worktree location**. It must be outside every open folder.

### Setup

Two things can happen after a worktree is created:

- Files matched by the repository's `.worktreeinclude` are copied in. This can include gitignored files, and it happens for every new worktree.
- One setup command runs. It is the **Setup command** from **Settings**, then **Workspace**, when you set one. Otherwise it is the repository's `.brainstrike/worktree-setup.sh`, and only after you choose **Allow script** in the dialog. **Skip script** creates the worktree without running it.

If setup fails, the worktree still exists and is usable. The chip shows a warning, and its menu gives the reason. [Project configuration](/guides/project-config/) covers the setup script.

### Bring work back

The chip's menu and the **Worktrees** tab hold the actions:

- **Create branch here** gives a detached worktree a branch.
- **Commit** and **Push** in the Changes tab record and publish it. The branch belongs to the same repository as your own checkout. Merging it is a git step you do yourself.
- **Hand off to Local** moves the thread back to your own checkout. The worktree stays where it is.
- **Archive worktree…** removes the worktree and keeps a snapshot of its work as a commit in the repository. It is refused while a run is active in the worktree. Ignored files are not in the snapshot and are deleted, so Brainstrike asks before archiving a worktree that has any.

Read more: [the changes contract](https://github.com/seandearnaley/brainstrike/blob/main/docs/agents/changeset-diff.md) and [the worktree decision](https://github.com/seandearnaley/brainstrike/blob/main/docs/adr/0034-worktrees-are-thread-checkouts.md).
