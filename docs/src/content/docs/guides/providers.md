---
title: Connect a provider
description: The credential each of the five model providers takes, where to enter it in Settings, how keys are stored, and the environment variables Brainstrike also reads.
---

Brainstrike calls hosted models with your own credentials. Everything on this page is in **Settings**, then **Providers**.

## The five providers

| Provider | Credential | Keys look like | Where to get one |
| --- | --- | --- | --- |
| OpenAI | API key | `sk-...` | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| Anthropic | API key | `sk-ant-...` | [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) |
| Google AI Studio | Gemini API key from Google AI Studio | no fixed prefix | [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) |
| OpenRouter | API key | `sk-or-v1-...` | [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys) |
| Amazon Bedrock | Bedrock API key and an AWS region, or an AWS profile and a region | no fixed prefix | [AWS: Amazon Bedrock API keys](https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys.html) |

Limits to know:

- **Google:** only Google AI Studio keys work. Vertex AI keys are not supported yet.
- **Subscriptions:** no provider signs in with a ChatGPT or Claude subscription. See the [Models FAQ](/guides/models-faq/).

## Enter a key

Each provider has a card. A card with no credential is marked **Not connected**.

1. Open the provider's card.
2. In the credential row, choose **Set**.
3. Paste the key and choose **Save**. `Enter` saves and `Esc` cancels.

The row's **Status** changes to **Stored**, and the **Key** column shows the key's last four characters and the date you saved it. **Replace** and **Remove** appear in place of **Set**. Each card also has a **Get an API key** link to the provider's key page.

When a provider gets its first key, Brainstrike runs a connection test. You can run it yourself at any time with **Test connection**.

| Result | Meaning |
| --- | --- |
| **Verified** | The credential authenticated. |
| **Verified with limits** | The credential authenticated, but the test could not fully complete. This is usually a permission-scoped key or a rate limit. The key works. |
| **Invalid key** | The provider rejected the credential. Replace the key and test again. |
| **Unreachable** | The provider did not answer, so the key was never judged. Check your network and try again. |

## How keys are stored

- Keys are saved in one private file in your Brainstrike profile, `brainstrike-credentials.sealed.json`.
- Every value in it is encrypted with a key your operating system protects: the Keychain on macOS, DPAPI on Windows and the Secret Service on Linux.
- On Linux, Brainstrike refuses to save a key when no keyring is available. It does not fall back to plain text. See [Troubleshooting](/reference/troubleshooting/#a-key-cannot-be-saved-or-read).

[Security](/reference/security/) has the full picture. Read more: [desktop security notes](https://github.com/seandearnaley/brainstrike/blob/main/apps/desktop/SECURITY.md).

## Environment variables

Brainstrike also reads keys from environment variables. Each provider has two names. The `BRAINSTRIKE_` name is read first.

| Provider | Read first | Then |
| --- | --- | --- |
| OpenAI | `BRAINSTRIKE_OPENAI_API_KEY` | `OPENAI_API_KEY` |
| Anthropic | `BRAINSTRIKE_ANTHROPIC_API_KEY` | `ANTHROPIC_API_KEY` |
| Google AI Studio | `BRAINSTRIKE_GOOGLE_API_KEY` | `GOOGLE_GENERATIVE_AI_API_KEY` |
| OpenRouter | `BRAINSTRIKE_OPENROUTER_API_KEY` | `OPENROUTER_API_KEY` |
| Amazon Bedrock | `BRAINSTRIKE_BEDROCK_API_KEY` | `AWS_BEARER_TOKEN_BEDROCK` |
| Tavily web search | `BRAINSTRIKE_TAVILY_API_KEY` | `TAVILY_API_KEY` |

**An environment variable always wins over a stored key.** The row then shows **Env** with the variable's name. A lock replaces the buttons, and its tooltip reads:

> OPENAI_API_KEY is authoritative; remove it and restart to manage here.

Where the environment comes from:

- **Your shell.** Started from a terminal, Brainstrike inherits that terminal's environment. Started any other way on macOS or Linux, from the Dock or Finder for example, it runs your login shell once and applies the environment it prints.
- **A `.env` file** in Brainstrike's user data folder. Once the file is loaded, the **Environment** section at the bottom of the page shows it, with an **Open folder** button.

Rules for the `.env` file:

- It may set only the names in the table above, plus `AWS_REGION` and `AWS_PROFILE`.
- Any other name, or a line that does not parse, rejects the whole file. The **Environment** section then shows the line number and says "No environment file was applied — one invalid file discards them all. Fix the line above and restart."
- A variable already set in the environment wins over the file.
- Changes apply after a restart.

Some older variable names are no longer read. `GOOGLE_API_KEY` is one. When one is set, the page says so and names the replacement:

> GOOGLE_API_KEY is set but no longer read — rename it to GOOGLE_GENERATIVE_AI_API_KEY.

## Amazon Bedrock

Bedrock needs a region whichever way you sign in. The editor offers two methods:

- **API key.** Paste a Bedrock API key and enter the region, such as `us-east-1`.
- **AWS profile.** Enter a profile name and the region. Leave the profile blank to use your default. Requests are signed with your local AWS credentials the way the AWS CLI resolves them: profiles, SSO, `credential_process` and instance roles. If the profile uses SSO, run `aws sso login` first.

The region must be a plain region identifier. Anything else is refused with "Not a valid AWS region — use a region identifier like us-east-1."

Bedrock can also be set up from the environment:

- **A key:** `BRAINSTRIKE_BEDROCK_API_KEY` or `AWS_BEARER_TOKEN_BEDROCK`, with `AWS_REGION`.
- **Your AWS credentials:** `AWS_REGION` together with `AWS_PROFILE` or `AWS_ACCESS_KEY_ID`. Without one of those two, Brainstrike does not sign with whatever AWS credentials happen to be on the machine.

When more than one is present, the first of these wins:

1. A key from the environment.
2. A key saved in Settings.
3. AWS credentials from the environment.
4. An AWS profile saved in Settings.

The status badge adds **AWS profile chain** when requests are signed with AWS credentials. A key gets no suffix.

## Enable models

A connected provider's card lists its models under **Models**, each with a switch. Turn on the ones you want in the message box's model list.

**Settings**, then **Model Catalog**, shows every catalogued model across providers with its context window, maximum output and price per million tokens. You can search, filter by status, and use **Enable all** or **Disable all** for a provider.

You can also search for a model in the message box's model list. A match that is not enabled appears under **Not enabled**; choosing it turns it on and selects it.

If a connected provider has no models turned on, the message box says "Enable at least one model for _provider_ to continue." and offers **Enable models**.

## Other credentials and web search

The **Other credentials** card holds keys for services that are not model providers. Today that is one key: **Tavily Web Search**.

The agent's web search tool sends your query to an outside search service:

- **OpenAI and Anthropic models** can use the provider's own search. That search runs on the provider's side and cannot be paused for approval, so Brainstrike uses it only when web search is allowed to run without asking.
- **Everything else** goes through Tavily and needs the Tavily key. That covers Google, OpenRouter and Bedrock models, and OpenAI and Anthropic models when web search has to ask first.

Without a Tavily key in those cases, the tool reports:

> Web search is unavailable — add a Tavily API key in Settings → Providers → Other credentials to enable it.

Read more: the [provider contract](https://github.com/seandearnaley/brainstrike/blob/main/docs/agents/assistant-providers.md) and the [provider catalog](https://github.com/seandearnaley/brainstrike/blob/main/packages/assistant-contract/src/provider-catalog.json).
