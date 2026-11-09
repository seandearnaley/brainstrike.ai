---
title: Sandbox and platform support
description: What the operating-system sandbox allows and denies for shell commands and Python, when a command runs without it, and how macOS, Windows and Linux differ.
---

On macOS and Linux, the shell commands and Python code the agent runs are wrapped in an operating-system sandbox: Seatbelt on macOS, bubblewrap on Linux. Windows has no sandbox yet.

The sandbox limits writes and the network. It does not make reads private, and it does not replace approvals. A command still passes the permission check first. See [Access modes and approvals](/guides/approvals/).

## Shell commands

Inside the sandbox a command can:

- **Write** only in the open folder it runs in and in its own temporary folder, which is removed with the command.
- **Read** everything except credential stores.
- **Reach no network.**

The credential stores are always denied, whatever else is allowed: `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.config/gcloud`, `~/.config/gh`, `~/.kube`, `~/.docker`, `~/.netrc`, `~/.npmrc` and `~/.pypirc`.

A command can still read most of your disk, so treat its output as sensitive.

When a sandboxed command fails, the agent is told what the sandbox refuses, because the cause may be the sandbox itself. A command that needs the network fails this way.

## The Python tool

The agent's Python tool runs only inside the sandbox. Where the sandbox cannot run, the tool is not offered at all. The desktop app runs it on its own bundled Python.

The approval card shows the code first, then what it can touch:

| Row | What you see |
| --- | --- |
| Internet | "No internet access", or how many domains it wants to reach |
| Can write to | A fresh private folder created for this run, and nowhere else. The folder is deleted afterwards. |
| Can read | Most files on this computer. Credential folders (SSH keys, cloud sign-ins) are always blocked. |
| Time limit | 30 seconds unless the agent asks for more, up to 10 minutes |

If the card cannot read the call or confirm what the script may touch, it says so and offers only **Approve** and **Decline**.

### Internet access for Python

A script has no network unless the agent names the domains it needs. Naming them grants nothing. You are asked on a card titled "This script wants to reach the internet":

- The card lists each domain. Tick every one to enable the allow button.
- **Don't allow** is the first button. The other reads **Allow** followed by the domain, or by the number of domains.
- The approved domains apply to that one run.
- You are asked every time, in every access mode. An **Always allow** or session answer on this card remembers approving the code, never its internet access.

## When a command runs without the sandbox

"Unsandboxed" means the command runs as an ordinary process under your account. It can write anywhere you can, read anything you can and use the network.

Commands run unsandboxed:

- on Windows, and under WSL 1;
- in long-running command sessions, on every platform;
- when the agent host runs standalone, outside the desktop app.

For a shell command, Brainstrike says so in two places. The approval card warns before you approve: "Commands run without a sandbox on this computer, with full access to your files and network." The command's result also records `sandboxed: false`.

If that matters to you on Windows, keep the access mode on _Ask for approval_ and read each command.

## Run one command outside the sandbox

The agent can ask to run a single command outside the sandbox, for example after the sandbox made a command fail. The card says: "Runs outside the sandbox, with full access to your files and network."

Who decides:

- In _Ask for approval_ and _Auto_, you do. The _Auto_ reviewer never approves this request.
- In _Full access_, it runs without asking.
- An earlier **Always allow** on commands, or a commands session grant given for an ordinary command, does not cover it.
- If you answer this request itself with **Always allow** or **Allow commands this session**, later requests of the same kind in that thread and its subagents run without asking until Brainstrike quits.

## When the sandbox is not ready

If the sandbox cannot be set up, nothing runs and the reason is reported. Brainstrike does not switch to running the command unsandboxed by itself. The agent may then ask to run that command outside the sandbox, which follows the rules in the section above.

A shell command's error reads "The OS sandbox could not run this command, so nothing ran:" followed by the reason. A Python result starts with "Nothing ran".

| The reason contains | Meaning |
| --- | --- |
| "Sandbox dependencies are missing" | A required system tool is not installed. See [Linux prerequisites](#linux-prerequisites). |
| "This Linux host blocked creation of the sandbox namespace." | The system does not let the sandbox create its namespace. See [Linux prerequisites](#linux-prerequisites). |
| "This runtime cannot confirm the complete OS sandbox." | A part of the sandbox is unavailable. Brainstrike refuses a weaker sandbox. |
| "The sandbox readiness check did not finish within 5 seconds." | Retry once. If it persists, restart Brainstrike. |

## Linux prerequisites

The Linux sandbox needs three system packages: bubblewrap, socat and ripgrep.

```sh
# Debian and Ubuntu
sudo apt install bubblewrap socat ripgrep

# Fedora
sudo dnf install bubblewrap socat ripgrep
```

It also needs unprivileged user namespaces. Recent Ubuntu releases restrict them with AppArmor. When that restriction blocks the sandbox, commands are refused with the namespace message above.

- Brainstrike does not change host security settings for you, and it does not run without the sandbox as a workaround.
- Allowing user namespaces for bubblewrap is a system administration step. See [Ubuntu's AppArmor guidance](https://documentation.ubuntu.com/security/security-features/privilege-restriction/apparmor/).
- Installing the three packages does not prove the sandbox works. The app checks readiness by running a real sandboxed command, and that check is what decides.

[Install](/start/install/#linux) has the short version.

## Platform differences

| | macOS | Windows | Linux |
| --- | --- | --- | --- |
| Sandbox for shell commands | Yes, Seatbelt | No. Commands run unsandboxed. | Yes, bubblewrap, with the prerequisites above |
| Python tool | Offered, on bundled Python | Not offered | Offered, on bundled Python |
| Installer signing | DMG, signed and notarized | Installer, not code-signed yet. SmartScreen warns. | AppImage, with a published SHA-256 checksum |
| Factory reset | Available | "Factory reset is unavailable on Windows in this version." | Available |
| Closing the last window | The app stays in the Dock | The app stays in the tray | The app stays in the tray where the desktop shows tray icons. Otherwise it quits. |
| Open at login | Available | Available | "Open at login isn't available on Linux yet." |
| Where saved keys are sealed | A keychain item | DPAPI | The Secret Service. Plain-text storage is refused. |

Notes on the table:

- **Tray.** On Windows and Linux the tray menu has **Open Brainstrike** and **Quit Brainstrike**. Runs keep going while the window is closed. **Settings**, then **Startup**, has **Keep running in the tray when closed**, which is on by default.
- **Linux tray.** A tray icon needs a StatusNotifierItem host, which KDE, XFCE and GNOME's AppIndicator extension provide. Without one, closing the last window quits Brainstrike and ends its runs. Settings says so: "Your desktop shows no tray icons, so closing the last window quits Brainstrike."
- **Checksums.** Every release lists SHA-256 checksums for all platforms. See [Install](/start/install/#check-your-download).

Read more: [the code execution contract](https://github.com/seandearnaley/brainstrike/blob/main/docs/agents/code-execution.md), [the desktop security notes](https://github.com/seandearnaley/brainstrike/blob/main/apps/desktop/SECURITY.md) and [Life of a turn](/develop/life-of-a-turn/).
