---
title: Models FAQ
description: Short answers about local models, custom endpoints, subscription sign-in, which models are available, what they cost and where your code is sent.
---

## Can I use a local model, such as Ollama or LM Studio?

No. Brainstrike does not run models on your machine and has no connection for a local model server. Every model call goes to a hosted provider.

What is supported: OpenAI, Anthropic, Google AI Studio, OpenRouter and Amazon Bedrock, each with your own credentials. See [Connect a provider](/guides/providers/).

## Can I point it at a custom OpenAI-compatible endpoint?

No. There is no setting for a custom endpoint or base URL, and the provider list is fixed at the five above.

What is supported instead: OpenRouter and Amazon Bedrock each serve models from several makers through one credential. The catalog's OpenRouter list includes models from OpenAI, Anthropic, Google, Qwen, DeepSeek, Mistral, xAI and Moonshot, among others.

## Can I sign in with a ChatGPT or Claude subscription instead of an API key?

No. No provider in Brainstrike authenticates through a subscription sign-in.

What is supported instead:

- An API key for OpenAI, Anthropic, Google AI Studio or OpenRouter.
- For Amazon Bedrock, a Bedrock API key or your local AWS credentials.

Read more: the [provider credentials decision](https://github.com/seandearnaley/brainstrike/blob/main/docs/adr/0014-provider-credentials-and-openai-storage.md).

## Which models are available?

The models in Brainstrike's catalog for the providers you have connected. Open **Settings**, then **Model Catalog**, to browse every catalogued model with its capabilities, context window, maximum output and price per million tokens.

A model appears in the message box's model list once it is turned on. See [Enable models](/guides/providers/#enable-models).

Two limits:

- **Google** models need a Gemini API key from Google AI Studio. Vertex AI keys are not supported yet.
- **OpenRouter** shows a curated subset of OpenRouter's models.

The catalog is one file in the repository: [`provider-catalog.json`](https://github.com/seandearnaley/brainstrike/blob/main/packages/assistant-contract/src/provider-catalog.json).

## What does it cost, and where do I see cost?

Brainstrike is open source under the MIT license. Model calls are made with your own credentials, so your provider bills you for them.

To see cost, open **Settings**, then **Cost Tracking**. It shows what your runs cost, split into input, cached and output tokens, by workspace, by model and by run.

How the numbers are worked out:

- **They are estimates.** Spend is calculated from each model's list price in the catalog, with cached tokens included. Your provider's bill is the authority.
- **OpenRouter is the exception.** OpenRouter reports what it billed for each request, and Brainstrike records that figure.
- **Every recorded model call is counted,** memory and subagents included.

Two more things affect spend:

- **Auto access mode adds requests.** Each action it reviews is one more request to a quick model.
- **Budget guardrails can cap spend.** The cap is measured over a rolling 24 hours. Reaching it pauses sending in the message box until you override it for the session.

The **Model Catalog** lists each model's price per million input and output tokens before you use it.

## Does the app send my code anywhere besides the provider?

Model requests go to the hosted providers you connected: the model you pick for the thread, and any model you assign elsewhere in Settings, such as a subagent's. What the agent reads from your folder to answer you is part of those requests.

Other things leave your machine when a feature you use sends them:

- **Web search** sends the search query to your provider's own search or to Tavily. See [Other credentials and web search](/guides/providers/#other-credentials-and-web-search).
- **MCP servers** you add receive whatever the agent passes to their tools. See [MCP](/guides/mcp/).
- **The agent browser** loads the sites it visits.
- **Auto access mode** sends your requests and the agent's tool calls to its reviewer, which by default is a quick model on the thread's provider. It does not send tool results or the agent's prose.
- **Update checks** contact the public releases repository on GitHub.

What stays on your machine:

- **Crash reports.** They are written to a local folder and uploading is off.
- **Traces.** Tracing is off unless you set an OpenTelemetry endpoint yourself. Even then, prompts, responses and tool payloads are left out unless you turn them on.
- **Conversations and run history.** They are recorded in a local store.

One caution: a command the agent runs can read most of your disk, and its output goes back to the model. Treat command output as something your provider sees.

[Privacy](/reference/privacy/) covers this in full.
