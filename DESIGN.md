# MadarWA — Design Contract

Status: locked through the Phase 6 interactive UX overhaul.
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

## Progressive disclosure

- The primary view of every tab is a short, scannable list of setting rows. Technical inputs never
  appear at rest.
- Sub-options live behind a compact `Configure` control (`mw-configure`) that opens an inline
  `Disclosure`, or stay hidden until the feature's master switch is ON.
- Privacy opens with two one-click presets: Full Stealth and Disable All.
- Broadcaster is a three-step flow (numbers → message → send/progress), never three long forms.
- The vault exposes filter chips (All/Text/Photos/Videos/Audio) and loads media on demand.

## Signature moves

1. **Interactive deleted-message pill** inside the real WhatsApp bubble. The native
   “This message was deleted” notice is never removed; a compact eye/chevron pill expands restored
   text, timestamps and copy, a photo with a full-screen zoom/download lightbox, an inline video or
   voice-note player, or a document download. Mode A is click-to-expand; Mode B auto-expands.
2. **Surgical hover-to-reveal.** `privacyTagger` marks exact leaf elements; only the hovered name,
   phone number, preview, avatar, message or media unblurs (`blur(0px)`, 160ms), never the rest of
   the screen.
3. **Native launcher** with live/unread state that belongs in WhatsApp's own header.

## Best-effort boundaries

- One-tick suppression patches every WhatsApp Web receipt path (delivery, read, read-self,
  inactive, played, sender and the high-level/played jobs) while keeping local unread state
  updates. It cannot control the linked phone, so the UI labels the option “best effort” and states
  that the phone must also be offline for a guaranteed single tick.

## Slop audit (self-check)

- No emoji in UI; all iconography is Lucide with a single stroke.
- No gradients/shadows at rest; no glass; no generic feature-card grid.
- Every number uses tabular figures; every destructive action is labeled, not just colored.
- Every dynamic surface has empty, loading, error and success states.
- Both AR/RTL and EN/LTR are composed, not mirrored by accident.
