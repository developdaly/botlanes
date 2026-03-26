# AGENTS.md

Kanban mission control for gstack agent tasks. Preact frontend, TypeScript backend.

## Design System
Always read DESIGN.md before making any visual or UI decisions.
All font choices, colors, spacing, and aesthetic direction are defined there.
Do not deviate without explicit user approval.
In QA mode, flag any code that doesn't match DESIGN.md.

## Project Architecture & Maintenance

### Frontend (Preact + No-Build)
- The frontend is located in `src/public/app.js` and `src/public/style.css`.
- **No Build Step:** The UI uses Preact via native ES modules imported from `esm.sh`. 
- **Templating:** Do not write JSX. Use the `htm` library (`html\`...\``) for templating inside `app.js`.
- **Styling:** The app uses Tailwind CSS loaded via CDN. Utility classes should be added directly to the template strings in `app.js`.

### Backend & Agent Execution
- The backend is a Bun server written in TypeScript (`src/server.ts`).
- **Agent Runner:** The application executes agent tasks by directly spawning the local `claude` CLI as a subprocess (via `Bun.spawn`), not an API or a gateway.
- **Projects & Workspaces:** Cards can be associated with a `Project`. When an agent runs a card, the backend uses the project's `directory` as the `cwd` for the Claude CLI process.

### State Management
- State is entirely file-based and stored locally in the `.gstack/` directory.
- `state.ts` manages the CRUD operations for `Projects` and `Cards`.
- **Cascade Deletions:** When a project is deleted, all associated cards must be cascade-deleted.

### Commands
- Start the server: `bun run src/cli.ts start`
- Run tests: `bun test`
- Typecheck: `bunx tsc --noEmit`

## gstack
Use the `/browse` skill from `gstack` for all web browsing.

### Available Skills:
- `/office-hours`
- `/plan-ceo-review`
- `/plan-eng-review`
- `/plan-design-review`
- `/design-consultation`
- `/review`
- `/ship`
- `/land-and-deploy`
- `/canary`
- `/benchmark`
- `/browse`
- `/qa`
- `/qa-only`
- `/design-review`
- `/setup-browser-cookies`
- `/setup-deploy`
- `/retro`
- `/investigate`
- `/document-release`
- `/codex`
- `/cso`
- `/careful`
- `/freeze`
- `/guard`
- `/unfreeze`
- `/gstack-upgrade`

If `gstack` skills are not working, run `cd ~/.gemini/skills/gstack && ./setup` to build the binary and register the skills.
