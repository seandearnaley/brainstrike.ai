---
title: Troubleshooting
description: What Brainstrike's error and empty-state messages mean and what to do about each, from a disabled message box to sandbox, update and storage problems.
---

Find the message you see, then follow the steps under it. Messages are quoted as the app shows them.

## The message box is disabled

Brainstrike shows the reason. On a new thread it sits under the heading, with a button that opens the right settings page when there is one.

| Message | What to do |
| --- | --- |
| "Connect an AI provider in Settings → Providers to enable the assistant." | No provider has a credential. Choose **Connect a provider** and add a key. See [Connect a provider](/guides/providers/). |
| "Select an AI provider to start chatting." | Pick a model in the message box's model list. |
| "The selected provider is no longer configured." | The thread's provider has lost its credential. Choose **Open provider settings** and add the key again, or pick a model from another provider. |
| "Enable at least one model for _provider_ to continue." | The provider is connected but none of its models is turned on. Choose **Enable models**. |
| "Select a model for the chosen provider to continue." | Pick a model in the message box's model list. |
| "Secret for "_provider_" is unreadable: …" | A saved key could not be read. See the next section. |

If you set a key as an environment variable and the provider still shows **Not connected**, open **Settings**, then **Providers**, and scroll to **Environment**:

- "_NAME_ is set but no longer read — rename it to _NAME_." The variable name is retired. Rename it as the message says and restart.
- "No environment file was applied — one invalid file discards them all. Fix the line above and restart." A line in your `.env` file was rejected. The line above this message gives the line number and the reason, such as "unsupported variable name".

## A key cannot be saved or read

**Saving fails** with a notice titled "Failed to save key".

**Reading fails** with a message in this form:

> Secret for "openai" is unreadable: stored secret could not be decrypted (the OS keychain entry may have changed). Re-enter the key to repair it.

The part after the colon names the cause, and the name in quotes is the provider.

What to do:

1. **On Linux, check your keyring.** Brainstrike encrypts keys through the Secret Service and refuses to save them any other way. Make sure your desktop session provides a Secret Service keyring, then restart Brainstrike. See [Install](/start/install/#linux).
2. **Save the key again.** Open **Settings**, then **Providers**, open the provider's card and choose **Replace**.
3. **Or use an environment variable.** A key set in the environment is read without the credential store. The names are in [Connect a provider](/guides/providers/#environment-variables).

If the card shows **Invalid key**, the provider rejected the key; replace it. If it shows **Unreachable**, the provider did not answer; check your network and choose **Test connection** again.

## "Sandbox dependencies are missing"

On Linux, commands run inside a sandbox that needs three system packages. Without them the command is refused:

> Sandbox dependencies are missing: _list_. No user code ran. Ask your administrator to install the required sandbox tools (on Linux: bubblewrap, socat and ripgrep), then retry.

Install `bubblewrap`, `socat` and `ripgrep` with your package manager, then ask the agent to try again. The commands are in [Install](/start/install/#linux).

## "This Linux host blocked creation of the sandbox namespace"

> This Linux host blocked creation of the sandbox namespace. No user code ran. Ask your administrator to provide a supported bubblewrap/user-namespace configuration, or use a supported host. Brainstrike will not change host security settings or run without the sandbox.

The sandbox depends on unprivileged user namespaces, and your system is restricting them. Ubuntu can do this through AppArmor. See [Ubuntu's AppArmor guidance](https://documentation.ubuntu.com/security/security-features/privilege-restriction/apparmor/). Brainstrike does not change that setting for you.

## Commands are refused or fail

**The sandbox could not start.** Besides the two messages above, you may see one of these. In each case nothing ran.

- "The sandbox readiness check did not finish within 5 seconds." Try once more. If it repeats, restart Brainstrike.
- "The sandbox readiness check failed before user code could run." Restart Brainstrike and try again. If it repeats, look in the logs.
- "This runtime cannot confirm the complete OS sandbox." Part of the sandbox is missing on this system. The message lists what the sandbox runtime reported.

Brainstrike never runs a command unsandboxed on its own when the sandbox fails. The agent can ask to run that one command outside the sandbox, and in _Ask for approval_ and _Auto_ that request always comes to you. The approval says "Runs outside the sandbox, with full access to your files and network."

**The command ran and failed.** On macOS and Linux a sandboxed command can write only inside its open folder and its own temporary folder, and it has no network. A command that needs the network or writes elsewhere fails for that reason. On Linux a blocked write shows up as "Read-only file system". If you want the command to run anyway, approve the agent's request to run it outside the sandbox.

**The command cannot find a tool that works in your terminal.** Open **Settings**, then **Providers**, and look under **Environment** for "Your login shell environment was not applied". Brainstrike is then running without the `PATH` your shell sets up. Fix your shell startup files and restart.

**On Windows** there is no sandbox. Approvals say "Commands run without a sandbox on this computer, with full access to your files and network." The agent's Python tool is not offered on Windows.

[Sandbox](/guides/sandbox/) and [Approvals](/guides/approvals/) cover the rules. Read more: the [code execution contract](https://github.com/seandearnaley/brainstrike/blob/main/docs/agents/code-execution.md).

## Updates do not install

To check now, use **Check for Updates…** (the app menu on macOS, **Help** on Windows and Linux) or **Check now** in **Settings**, then **Updates**.

| Message | What to do |
| --- | --- |
| "Move Brainstrike to the Applications folder?" | macOS only. A copy run from the DMG or from Downloads cannot replace itself. Choose **Move to Applications**. |
| "Brainstrike couldn't move to Applications" | Drag Brainstrike into **Applications** in Finder so it can update itself. |
| "Updates come only to an installed copy of Brainstrike" | This copy was not installed from a release, so it does not update itself. Install a release build from [Install](/start/install/). |
| "Updates are paused after the reset" | A factory reset stops update checks until the next start. Restart Brainstrike. |
| "Couldn't check for updates" | Check that you are online, then choose **Try again**. |
| "Couldn't download the update" | The download did not finish. Choose **Try again** in a moment. |

On macOS, the move prompt appears once. If you chose **Not Now**, it does not ask again, and updates stay uninstalled until you drag the app into **Applications** yourself.

A downloaded update installs when you quit, or straight away with **Restart to update**. See [Updates](/start/install/#updates).

## Windows SmartScreen warns about the installer

The Windows installer is not code-signed yet, so Microsoft Defender SmartScreen warns before it runs. [Install](/start/install/#windows) has the steps, and [Check your download](/start/install/#check-your-download) shows how to confirm the file is the one that was published.

## The conversation store opened read-only

> Brainstrike’s conversation store is damaged, so it opened read-only.
>
> Your conversations can be read, but new messages and changes can’t be saved. Nothing was deleted or replaced.

Brainstrike found damage in its local store and stopped writing to it. It does not repair, replace or delete the file. The notice has three buttons:

- **Show data folder** opens the folder that holds the store.
- **Check again** reads the store's health again.
- **Restart agent host and check** restarts the background process that owns the store, so it reopens the store and checks it again. Replies that are running stop.

If the notice stays, open **Details**, copy the text and [report a bug](#report-a-bug).

Read more: the [state store contract](https://github.com/seandearnaley/brainstrike/blob/main/docs/agents/state-store.md).

## Find logs and crash reports

- **Help**, then **Show Logs** opens the logs folder.
- **Help**, then **Show Crash Reports** opens the folder of crash reports. Crash reports stay on your machine; Brainstrike does not upload them.
- **Settings**, then **Logging & Diagnostics** sets the log level and manages log files.

A crash report can contain the app's memory at the time of the crash, so look at what you are sharing before you attach one.

## Report a bug

Open an issue at [github.com/seandearnaley/brainstrike/issues](https://github.com/seandearnaley/brainstrike/issues). Include:

- The exact message you saw.
- Your operating system and the Brainstrike version. **Help**, then **Release Notes**, opens the release page for the version you are running.
- The relevant log file from **Help**, then **Show Logs**.

A thread also has a **Debug pack** control with **Download debug pack**. The file holds that conversation, its tool inputs and results, and the app log for the run. It can contain private conversation and file content, so review it before you share it.
