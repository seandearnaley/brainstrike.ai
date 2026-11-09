---
title: Access modes and approvals
description: How Brainstrike decides whether a tool call runs, waits for you or is refused, and what each answer on an approval card does.
---

Every tool the agent uses passes a permission check before it runs. The check reads three things: the policy for the tool's risk category, the access mode you picked in the message box, and any grants you gave earlier.

## Risk categories

Each tool belongs to one of four categories. **Settings**, then **Permissions**, sets each category to **Allow**, **Ask** or **Deny**.

| Category | What it covers | Default |
| --- | --- | --- |
| Read | Search and inspect the workspace (no changes). | Allow |
| Edit | Modify files or persistent state. | Ask |
| Execute | Run commands or scripts. | Ask |
| MCP | Call external MCP server tools. | Allow |

A **Deny** beats everything else on this page, including _Full access_ and any grant. A denied tool is not offered to the model and never runs. You can deny a whole category or one tool.

The same card has an **Enforce tool permissions** switch. It is on by default. Turning it off lets the agent use all tools without prompting.

## Access modes

The access control sits in the message box. The same choice appears in **Settings**, then **Permissions**, as **Access mode**.

| Mode | What it does |
| --- | --- |
| **Ask for approval** | Every call the policy asks about waits for you. With the default policies that is every edit and every command. |
| **Auto** | A quick model reviews each of those calls first. It runs the ones it judges routine and covered by your request. It asks you about the rest, and whenever the review fails. |
| **Full access** | Every tool runs without asking, ignoring the category policies. Explicit denies still apply. |

How _Auto_ reviews a call:

- The reviewer sees your requests and the agent's tool calls. It never sees tool results or the agent's prose, so text the agent read cannot argue for its own approval.
- The reviewer can approve a call or hand it to you. It cannot deny one. When it hands a call to you, the card shows its reason.
- A missing model, a provider error, an unreadable answer or a review longer than 60 seconds all send the call to you.
- By default the reviewer is a quick model from the provider your chat already uses, so the review reaches no other provider. **Auto-review model** in the same Settings card picks a different one. Each reviewed call costs one request to that model.

**Auto is a convenience and not a security boundary.** The reviewer can be wrong in both directions. Use _Ask for approval_ when a wrong approval would matter. _Full access_ is the explicit unsafe choice.

If the saved permission settings cannot load, the control reads **Unavailable** and opens **Settings**, then **Permissions**, which explains the failure.

## Answer an approval

A waiting call shows what it will do before you decide: the command and its working directory, the change to a file, or the Python code and what it can touch.

| Button | What it does |
| --- | --- |
| **Approve** | Runs this call once. |
| **Always allow** | Runs it and saves an _Allow_ override for this tool. The override stays until you remove it. |
| **Allow edits this session** | Runs it and allows the whole category for the session. The label names the category: edits, commands, reads or MCP tools. |
| **Decline** | Skips this call. |

When approvals are waiting, a strip above the message box counts them, for example "3 approvals waiting".

- **Review** opens the list with the same buttons for each call.
- A button such as **Allow commands this session** grants that category and answers the waiting calls it covers.
- Approvals from subagents appear in the same strip, marked with the subagent's name.

A Python call that the card cannot read in full offers only **Approve** and **Decline**.

## Session grants

A session grant always names one category. Allowing all tools for a session is four grants, one per category. No session-wide switch turns the check off.

- A grant belongs to the thread where you gave it and to that thread's subagents.
- It is recorded before the waiting call resumes. Other waiting calls that it now covers are answered for you.
- It is not saved. After Brainstrike quits and starts again, the category asks again.
- A **Deny** still wins over a grant.

## Saved permissions

**Settings**, then **Permissions**, is where saved answers live:

- **Tool category policies** holds the Allow, Ask or Deny choice for each category.
- **Per-tool overrides** lists every tool you answered with **Always allow**. Change one to Ask or Deny, or remove it. A per-tool decision beats its category policy.
- **Sites the agent may open** lists the sites you answered for the agent's browser. Remove one to be asked again.

## What always asks

These come to you in every access mode, including _Full access_:

- **The first visit to a site in the agent's browser.** The card names the site and offers **Don't allow**, **Allow once** and **Always allow**. _Don't allow_ and _Always allow_ are remembered for that site. The answer covers the address the agent asked for. A page it opens can still load, or redirect to, other sites.
- **Internet access for a Python script.** You are asked every time. See [Sandbox and platform support](/guides/sandbox/).
- **A question from the agent, and a plan it proposes.**

One more comes to you in _Ask for approval_ and _Auto_:

- **A command that asks to run outside the sandbox.** The _Auto_ reviewer never approves it. _Full access_ runs it without asking. See [Sandbox and platform support](/guides/sandbox/).

## Plan mode and questions

The **Plan mode** toggle is in the message box. With it on, the agent investigates and proposes a plan for your approval before any changes. Every Edit and Execute tool is removed, so it cannot edit files or run commands, and it cannot start subagents. Read and MCP tools stay available.

The plan arrives as a card with its steps, a feedback box, **Approve plan** and **Reject plan**. Approving a plan turns plan mode off.

The agent can also ask you a question. The card shows the question, any options to tick and a field for your own answer. **Send answer** returns it to the agent.

Approvals, questions and plans in a thread you started survive a restart. Once you answer, the action runs at most once. If the app stops while the action runs, it is marked interrupted and is never run again.

## Subagents

- Starting a subagent never asks. Each action inside it passes the same check as the agent's own.
- A subagent follows the access mode, policies and grants of the thread that started it, as they are now. A grant you give later lifts its waiting approvals. A restriction you add later applies to it too.
- Denies in force when the subagent started stay in force. Its tool list is fixed when it starts, and later settings cannot widen it.
- Explorer and Analyst are read-only. They get only their declared read tools and cannot start subagents of their own.
- A subagent cannot ask you a question or propose a plan. It reports the decision it needs to its parent.
- In _Auto_, a subagent's call is reviewed against the request you wrote. The task its parent wrote for it does not count as your words.
- A subagent's waiting approval does not survive a restart. It shows as interrupted.

[Project configuration](/guides/project-config/) covers defining your own subagents.

Read more: [the access modes decision](https://github.com/seandearnaley/brainstrike/blob/main/docs/adr/0031-access-modes-and-auto-review.md), [the grants and delegation decision](https://github.com/seandearnaley/brainstrike/blob/main/docs/adr/0010-approvals-and-delegation.md) and [Life of a turn](/develop/life-of-a-turn/) for the gate at code level.
