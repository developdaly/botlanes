# botlanes

**Turn Claude Code or Gemini into a repeatable engineering pipeline.**

<img width="2880" height="1183" alt="board" src="https://github.com/user-attachments/assets/4919361a-ad16-4629-9e86-96ea8747d68e" />

---

## The problem

You're shipping with Claude Code or Gemini. But your process looks like this: a bunch of terminals, a dozen open chats, mental notes about what's mid-review and what needs a follow-up. When the agent finishes, you forget to check. When you ask it a question, you're digging through scroll.

There's no system. It's just chaos.

## The fix

botlanes is a Kanban board where every column is a real development stage — and when you drag a card into a column, an agent runs.

Not a chatbot. Not a one-shot prompt. A named [gstack](https://github.com/garrytan/gstack) agent skill executing against your actual codebase, in the right directory, with the right context.

```
  Backlog → Office Hours → CEO Review → Eng Review → Design
                                                         ↓
              Ship ← QA ← Code Review ← Implementation ←┘
```

You see every task. Every task has a stage. Every stage runs the right agent. When the agent needs you, the card lights up. When it's done, you drag it forward.

**This is what agentic development looks like when it has a process.**

---

## Prerequisites

- [Bun](https://bun.sh) — runtime and package manager
- One of (or both) AI CLIs:
  - [Claude Code CLI](https://claude.ai/code) — the `claude` binary must be in your `$PATH`
  - [Gemini CLI]([https://claude.ai/code](https://geminicli.com/)) — the `gemini` binary must be in your `$PATH`
- [gstack](https://github.com/garrytan/gstack) — provides the agent skills that power each column

## Install

```bash
git clone https://github.com/developdaly/botlanes
cd botlanes
```

## Start

```bash
bun run src/cli.ts start
```

The server starts on a random port. The URL is printed on startup — open it in your browser.

---

## How it works

### 1. Create a project

Point botlanes at a directory — your repo. Every card in that project runs its agent with that directory as the working directory.

### 2. Write a card

A card is a task. Give it a title and description. Be specific — the agent reads this as its brief.

### 3. Drag to run

Drag a card from **Backlog** into any stage column. botlanes spawns a `claude` or `gemini` subprocess (depending on which one you selected for the project) running the matching gstack skill. The card turns blue: running.

### 4. Watch, respond, move

Open the card to watch live output. If the agent asks you something, the card turns amber and waits. Answer in the UI. When the stage finishes, drag the card forward.

<img width="2880" height="2420" alt="modal-review" src="https://github.com/user-attachments/assets/2d24fe60-d793-4ec0-a565-4d30be87cfd6" />

<img width="2880" height="2420" alt="modal-complete" src="https://github.com/user-attachments/assets/793354de-c65d-41f7-bd83-06c7bd341be8" />

---

## The pipeline

| Stage | What the agent does |
|-------|---------------------|
| **Backlog** | Parked — nothing runs |
| **Office Hours** | YC-style product brainstorm — clarify what you're actually building and why |
| **CEO Review** | Scope and strategy check — is this the right thing to build? |
| **Eng Review** | Architecture and implementation plan review |
| **Design** | Visual design and UI decisions |
| **Implementation** | The agent writes the code |
| **Code Review** | Pre-landing diff review |
| **QA** | Automated QA testing and bug fixes |
| **Ship** | PR creation and merge |

Run stages in any order. Skip what you don't need. Run the same stage twice. You're in control — botlanes just makes sure the right agent runs when you say so.

---

## Why this matters

Most AI-assisted development is stateless. You fire off a prompt, get output, context disappears. There's no thread connecting your idea to your shipped code.

botlanes gives you that thread. Each card carries its full history — every stage output, every question answered, every decision made. You can see at a glance where every task is and what the agent did to get it there.

It doesn't replace your judgment. It just removes the overhead of managing it.

---

## Architecture

| Layer | Tech |
|-------|------|
| Backend | Bun + TypeScript (`src/server.ts`) |
| Frontend | Preact + `htm` — no build step, ES modules via `esm.sh` |
| Styling | Tailwind CSS via CDN |
| State | File-based, stored in `.gstack/` |
| Agent runner | `Bun.spawn` → `claude` or `gemini` CLI subprocess |

State is local and file-based. No database, no cloud, no accounts. Your tasks stay on your machine.

---

## Commands

```bash
bun run src/cli.ts start   # start the server
bun test                   # run tests
bunx tsc --noEmit          # typecheck
```

---

## License

MIT
