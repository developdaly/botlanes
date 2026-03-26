# Design System — BotLanes

## Product Context
- **What this is:** A Kanban mission control board for managing AI agent tasks through a skill pipeline
- **Who it's for:** Developers and power users managing gstack agent workflows
- **Space/industry:** Developer tools, AI agent orchestration (peers: Linear, Vercel, Railway, Raycast)
- **Project type:** Web app / dashboard

## Aesthetic Direction
- **Direction:** Refined Utilitarian — Swiss-inspired minimalism. White/gray surfaces, precise borders, no decoration. The UI disappears; the content speaks.
- **Decoration level:** Minimal — no gradients, no colored backgrounds on containers. Depth comes from layered white surfaces with subtle box-shadows and 1px borders.
- **Mood:** Calm, precise, professional. Like a well-designed control room where every element earns its place. Flat until you look closely and notice the craftsmanship.
- **Reference sites:** vercel.com, clerk.com

## Typography
- **Display/Hero:** Geist Sans (700) — Vercel's typeface, designed for interfaces. Clean, technical, modern.
- **Body:** Geist Sans (400) — one font family across the entire product for simplicity.
- **UI/Labels:** Geist Sans (500, 600) — medium weight for interactive elements, semibold for section headers.
- **Data/Tables:** Geist Sans with tabular-nums feature enabled.
- **Code:** Geist Mono (400) — same design family, for code blocks, branch names, log output.
- **Loading:** CDN via `https://cdn.jsdelivr.net/npm/geist@1.3.1/dist/fonts/`
- **Scale:**
  - 11px — labels, meta text (weight 500, uppercase, letter-spacing 0.05em)
  - 12px — secondary text, timeline entries
  - 13px — body text, card titles, inputs
  - 14px — section headers (weight 600, uppercase, letter-spacing 0.03em)
  - 17px — modal titles (weight 700, letter-spacing -0.01em)
  - 24px — page titles (weight 700, letter-spacing -0.02em)

## Color
- **Approach:** Restrained — near-monochromatic with status-only color accents
- **Background 1:** #FFFFFF — primary surfaces (cards, modals, inputs)
- **Background 2:** #FAFAFA — page/board background, subtle differentiation
- **Background 3:** #F5F5F5 — hover states, tags, inset areas
- **Border:** #E5E7EB (primary), #F3F4F6 (subtle), #D1D5DB (strong)
- **Text:** #111827 (primary), #6B7280 (secondary), #9CA3AF (tertiary)
- **Accent:** #171717 (near-black) — primary buttons, active states, focus rings
- **Accent hover:** #262626
- **Semantic (status only — never as large fills):**
  - Running: #2563EB
  - Awaiting Human: #F59E0B
  - Complete: #16A34A
  - Failed: #DC2626
  - Idle: #9CA3AF
- **Alert backgrounds (light tints):**
  - Success: bg #F0FDF4, border #BBF7D0, text #166534
  - Warning: bg #FFFBEB, border #FDE68A, text #92400E
  - Error: bg #FEF2F2, border #FECACA, text #991B1B
  - Info: bg #F0F9FF, border #BAE6FD, text #0C4A6E
- **Dark mode (secondary priority):**
  - Background 1: #0A0A0A, Background 2: #111111, Background 3: #1A1A1A
  - Border: #262626, #1F1F1F, #333333
  - Text: #EDEDED, #A1A1A1, #666666
  - Accent: #EDEDED

## Spacing
- **Base unit:** 4px
- **Density:** Comfortable — generous padding inside containers (16-24px), tight gaps between elements (8-12px)
- **Scale:** 4 / 8 / 12 / 16 / 20 / 24 / 32 / 48 / 64

## Layout
- **Approach:** Grid-disciplined — strict columns, predictable alignment
- **Grid:** Kanban columns at 300px each, sidebar at 200px
- **Max content width:** 960px for modals, full-width for board
- **Border radius:**
  - sm: 6px (buttons, inputs, badges)
  - md: 8px (cards)
  - lg: 12px (modals, panels)
  - full: 999px (pills, status badges)

## Shadows
- **Level 1:** 0 1px 2px rgba(0,0,0,0.04) — cards, subtle lift
- **Level 2:** 0 2px 8px rgba(0,0,0,0.08) — dropdowns, popovers
- **Level 3:** 0 8px 30px rgba(0,0,0,0.12) — modals, overlays
- **Signature pattern:** 1px solid border + Level 1 shadow on all elevated surfaces. The border gives structure, the shadow gives depth.
- **Focus ring:** 0 0 0 3px rgba(17,17,17,0.06)

## Motion
- **Approach:** Minimal-functional — only transitions that aid comprehension
- **Easing:** enter(ease-out) exit(ease-in) move(ease-in-out)
- **Duration:** micro(100ms) short(150ms) medium(200ms)
- **Rules:** No bouncing, no spring physics. Hover states at 150ms ease. Modal transitions at 200ms. Status dot pulse at 1.5s ease-in-out infinite.

## Anti-patterns (never do)
- Purple/violet gradients as accent color
- Colored backgrounds on cards or containers (except alert tints)
- Bubbly, uniform border-radius on everything
- Gradient buttons
- Using status colors for anything other than small indicators (dots, badges, alert tints)
- Decorative elements that don't serve function

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-25 | Initial design system created | Vercel/Clerk-inspired aesthetic. Near-monochromatic, Geist Sans, light-mode-first. Created by /design-consultation. |
| 2026-03-25 | Near-black accent (#171717) over brand color | Monochrome is bolder for a power-user tool where content is the brand. |
| 2026-03-25 | Status-only color usage | More aggressive restraint than peers — makes status indicators pop against grayscale canvas. |
