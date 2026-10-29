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
- Type scale (tokens `--mw-text-*`, Tailwind `text-mw-*`), used by the panel and the popup alike:

  | Token | Size | Use |
  |---|---|---|
  | `2xs` | 11px | Counters, badges, timestamps. The floor: nothing renders smaller. |
  | `xs` | 12px | Hints, field labels, group labels, secondary meta. |
  | `sm` | 13px | Body, setting rows, controls, navigation. |
  | `base` | 14px | Section and dialog titles, header title. |
  | `lg` | 16px | Metric values, lock-screen title. |
  | `xl` | 20px | PIN keypad digits. |

  Arbitrary sizes (`text-[10px]`) are not allowed; the old 8.5–10.5px text was unreadable in Arabic.
- Locale-formatted values (dates, times) use `unicode-bidi: plaintext` so Arabic dates are never
  forced left-to-right.
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

- Drawer: `min(660px, 100vw)` at the inline-end edge; header 40px; 152px vertical icon+label rail at
  the inline-start edge; active item gets a 2px solid emerald indicator and a muted emerald wash.
  No footer and no version in the shell (the version lives in Tools and the popup).
- Header: orbit mark, product name, status dot (+ "Connected" text only when live), عربي/EN
  segmented control, lock (when enabled), close. No tagline in the header.
- Dialogs (drawer, modals, lock screen): focus moves in on open, Tab stays inside, focus returns to
  the opener on close. Escape closes the top-most layer only. Entrance animations use fill-mode
  `backwards` so no transform outlives them (a kept transform would trap `position: fixed` dialogs).
- Toasts: top-center while the panel is closed; at the bottom of the panel column while it is open,
  so they never cover the header or the connection banner. Actions such as Undo pause the timer on
  hover/focus.

## Connection states

One model (`src/shared/connection.ts`) drives the header dot, the native launcher, the floating
launcher and the popup, so a state always has the same words everywhere.

| Phase | Tone | Shown as | Action |
|---|---|---|---|
| `live` | live | "Connected" | none |
| `connecting` / `loading` | waiting | banner with the reason | none, it resolves itself |
| `login` | waiting | "Waiting for login", scan the QR code | none |
| `reconnecting` | waiting | dropped for a moment, recovers on its own | none |
| `slow` | waiting | WhatsApp loading longer than usual | Reload WhatsApp |
| `updated` | offline | extension updated while the page stayed open | Reload WhatsApp (secondary while a campaign is sending) |
| `unreachable` (popup) | offline | MadarWA not running in the open tab | Reload WhatsApp |
| `absent` (popup) | offline | no WhatsApp Web tab | Open WhatsApp Web |

The banner appears under the header only when the phase is not `live`, says what is happening in one
line, and offers a single action only where a reload actually helps. Error toasts use plain,
translated messages mapped from error codes (`src/shared/errors.ts`), never raw engine text.
- Native launcher: 40×40 circular icon button in `#side header`, transparent at rest, WhatsApp-style
  hover wash, emerald orbit, live dot, unread count badge. Floating launcher only as fallback and
  draggable; never both at once.
- Popup: 340px, imports the panel stylesheet (same tokens, scale and controls), live status that
  refreshes while open, metrics, and one state-driven primary action: Open panel, Reload WhatsApp
  (tab open but MadarWA not running), or Open WhatsApp Web. It never opens a second WhatsApp tab.

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

- No emoji or text glyphs as icons (no "✓", "!", "?"); all iconography is Lucide with a single
  stroke, and status icons carry a visually hidden text label.
- No gradients/shadows at rest; no glass; no generic feature-card grid.
- No decorative emerald: group labels and section icons are muted; category badges are neutral.
- Every async action shows its own loading state and cannot be submitted twice.
- Every number uses tabular figures; every destructive action is labeled, not just colored.
- Every dynamic surface has empty, loading, error and success states.
- Both AR/RTL and EN/LTR are composed, not mirrored by accident.
