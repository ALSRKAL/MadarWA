# MadarWA — Design Contract

Status: locked for the Phase 2 native redesign.
Surface type: **Operate** (a high-frequency pro tool panel), not a marketing page.
Committed direction: **WhatsApp Web native + Linear density**. Flat, quiet, precise; the
interface should read as if WhatsApp shipped an expert panel, not as a dashboard template.

## Non-negotiables

- One accent: WhatsApp emerald. Color is used for live state, active navigation, primary action and
  destructive/warning semantics only. No decorative color.
- Surfaces are flat. Separation comes from tone steps and the hairline token, not shadows. Shadows
  only on things that truly float: the drawer, dialogs, toasts and the fallback launcher.
- No gradients, glows, glass, blurred blobs, emoji, icon tiles, nested cards, pill badges above
  headings, oversized rounded corners, or decorative animation.
- Type: Arabic = Tajawal/Cairo with system fallback; English = Inter with system fallback. Counters,
  delays, phone numbers and timestamps use `tabular-nums`.
- Density: 40px top header, 28–32px controls, `py-2.5 px-3` setting rows, 6–8px radii on surfaces,
  full inline feedback. A professional tool may be dense; it may not be noisy.
- Motion: 120–200ms, transform/opacity only. The live connection dot may pulse because the state is
  genuinely live; everything else is still at rest. `prefers-reduced-motion` removes motion.
- Accessibility: every control has a visible focus ring, a real label, a 24px+ target, and never
  relies on color alone.

## Tokens

### Dark (WhatsApp Web)

| Role | Value |
|---|---|
| App background | `#111b21` |
| Header / sidebar | `#202c33` |
| Surface / elevated | `#182229` |
| Input / hover | `#2a3942` |
| Primary text | `#e9edef` |
| Secondary text | `#8696a0` |
| Brand | `#00a884`, hover `#06cf9c` |
| On brand | `#0b141a` |
| Danger | `#f15c6d` |
| Warning | `#f59e0b` |
| Hairline | `rgba(134, 150, 160, 0.15)` |

### Light (WhatsApp Web)

| Role | Value |
|---|---|
| App background | `#f0f2f5` |
| Header | `#f0f2f5` |
| Surface | `#ffffff` |
| Input | `#f0f2f5` |
| Primary text | `#111b21` |
| Secondary text | `#667781` |
| Brand | `#008069`, hover `#00a884` |
| On brand | `#ffffff` |
| Danger | `#f15c6d` |
| Warning | `#b45309` |
| Hairline | `#e9edef` |

## Shell

- Drawer: `min(660px, 100vw)` at the inline-end edge; header 40px; vertical icon+label rail at the
  inline-start edge; active item gets a 2px solid emerald indicator and a muted emerald wash.
- Header: orbit mark, product name, live status dot + text, AR/EN segmented control, lock (when
  enabled), close. No tagline in the header.
- Native launcher: 40×40 circular icon button in `#side header`, transparent at rest, WhatsApp-style
  hover wash, emerald orbit, live dot, unread count badge. Floating launcher only as fallback and
  draggable; never both at once.
- Popup: 340px, same tokens, compact status + metrics + one primary action.

## Signature moves

1. **Inline restored message** inside the real WhatsApp bubble: emerald/restored indicator, original
   text or media preview, original timestamp, and a quiet "view in vault" action.
2. **Native launcher** with live/unread state that belongs in WhatsApp's own header.

## Slop audit (self-check)

- No emoji in UI; all iconography is Lucide with a single stroke.
- No gradients/shadows at rest; no glass; no generic feature-card grid.
- Every number uses tabular figures; every destructive action is labeled, not just colored.
- Every dynamic surface has empty, loading, error and success states.
- Both AR/RTL and EN/LTR are composed, not mirrored by accident.
