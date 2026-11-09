---
title: Install
description: Download Brainstrike for macOS, Windows or Linux, see what each build needs, check the download and connect a model provider.
---

Download the build for your computer from [brainstrike.ai](https://brainstrike.ai). The page picks your platform and lists the other builds beside it.

| Platform | Build | Needs |
| --- | --- | --- |
| macOS | DMG for Apple silicon or Intel | macOS 12 or later |
| Windows | Installer for x64 | Windows 10 or 11 |
| Linux | AppImage for x64 or arm64 | A desktop with a Secret Service keyring |

## macOS

Open the DMG and drag Brainstrike to **Applications**. The app is signed and notarized by its developer, so it opens without a Gatekeeper warning.

Run it from Applications. A copy started from the DMG or from Downloads cannot replace itself, so it cannot install updates. Brainstrike offers once to move itself there.

## Windows

Run the installer. It is not code-signed yet, so Microsoft Defender SmartScreen warns before it starts. Choose **More info**, then **Run anyway**.

The Windows build has limits the other builds do not:

- Commands the agent runs are **not sandboxed**. The approval card says so each time. Use _Ask for approval_ if that matters to you.
- The agent's Python tool is not offered. It runs only inside the sandbox, and no Python is bundled.
- Factory reset is not available in this version.

## Linux

Make the AppImage executable, then run it:

```sh
chmod +x Brainstrike-*.AppImage
./Brainstrike-*.AppImage
```

The agent's commands run inside a sandbox that needs three system packages. Without them Brainstrike refuses to run the command. It never switches to running it unsandboxed by itself.

```sh
# Debian and Ubuntu
sudo apt install bubblewrap socat ripgrep

# Fedora
sudo dnf install bubblewrap socat ripgrep
```

Two more things to know:

- **Keys need a keyring.** Brainstrike stores provider keys through the Secret Service, which GNOME Keyring and KWallet provide. It refuses to store them as plain text.
- **Ubuntu restricts user namespaces.** Recent Ubuntu releases use AppArmor to limit unprivileged user namespaces, which the sandbox depends on. If commands are refused with a message about the sandbox namespace, see [Ubuntu's AppArmor guidance](https://documentation.ubuntu.com/security/security-features/privilege-restriction/apparmor/). Brainstrike does not change host security settings for you.

[Sandbox and platform support](/guides/sandbox/) has the full list of what differs between platforms.

## Check your download

Every release publishes a `SHA256SUMS` file. The download page links it in the footer. Compute the checksum of the file you downloaded and compare it with the line for that file:

```sh
# macOS
shasum -a 256 Brainstrike-*.dmg

# Linux
sha256sum Brainstrike-*.AppImage
```

```powershell
# Windows
Get-FileHash .\Brainstrike-*.exe -Algorithm SHA256
```

## Connect a provider

Brainstrike uses hosted models with your own key. On first launch the message box is disabled until a provider is connected.

1. Open **Settings**, then **Providers**.
2. Open the card for OpenAI, Anthropic, Google AI Studio, OpenRouter or Amazon Bedrock.
3. Choose **Set**, paste the key and choose **Save**. It is encrypted with your operating system's credential store.
4. Turn on the models you want to use.

Then open a folder and send your first message. [First run](/start/first-run/) walks through it, and [Connect a provider](/guides/providers/) covers each provider in detail.

## Updates

Brainstrike checks for updates when it starts and every four hours, downloads them in the background and offers to restart. **Settings**, then **Updates**, has a switch for beta releases. A beta install follows betas until you turn it off.
