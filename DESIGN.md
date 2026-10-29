# MadarWA — Design Contract

Surface type: **Operate**. A panel people work in every day on top of WhatsApp Web, not a
marketing page. Light only.

Direction: **Framed sheet**, dealt by the `design-taste-frontend` app run
(`draw.mjs --app --kind smb-admin`) and checked against its app-screen rules, together with the
`anti-slop-design`, `impeccable` and `frontend-design-deslop` skills. The chrome is one quiet
green-grey frame; the work sits on one white sheet. Ink carries actions. Colour is spent on state
and on the logo, nowhere else.

## Discovery

- **Who:** WhatsApp Web power users (Arabic first, English second) who switch between privacy,
  campaigns, auto-replies, exports and the deleted-message vault many times a day.
- **Where:** a 720px drawer over WhatsApp's own UI, often in a dark WhatsApp theme. The panel stays
  light so it reads as a separate tool; anything placed inside WhatsApp's chrome borrows WhatsApp's
  look instead.
- **Job of each screen:** one section per rail item, with its name as the page title and its main
  control first.

## Tokens (light only)

Source of truth: `src/content/styles/shadow.css` (`.mw-app`). Tailwind reads them as `wa-*`
colours (`tailwind.config.js`); TypeScript surfaces that cannot read CSS (toolbar badge, launcher)
use `BRAND_COLORS` in `src/shared/constants.ts`.

| Role | Value | Use |
|---|---|---|
| Frame | `#f5f7f6` | Header and rail, one tint, no rule between them |
| Sheet | `#ffffff` | The page; 1px `#e6e8ea` edge, 16px radius, inset 8px from the inline-end and bottom edges |
| Panel | `#f6f7f8` | Groups inside the sheet; no border, no shadow |
| Active | `#e9ecea` | Selected rail item |
| Ink | `#131416` | Text, primary buttons, switches on, selected chips, the active step |
| Muted | `#5b5f63` | Secondary text (6.4:1 on white) |
| Faint | `#6b6f73` | Placeholders (5.1:1 on white) |
| Line / rule / control | `#e6e8ea` / `#eef0f1` / `#cfd2d6` | Card edges, row rules, input borders |
| Switch off | `#858a90` outline, `#6b6f73` knob | Holds 3:1 against the panel |
| Accent | `#19694f` | The mark's tile, progress fill, focus ring. Nothing else |
| Satellite | `#f2b33d` / ink `#131416` | The mark's satellite and the unseen count (ink numerals 9.9:1), so a count on the green tile still stands out |
| Success / danger / warning | `#1e7b4f` / `#c4242a` / `#92400e` | State text and icons |
| Pills | `#dcfae5`/`#04250e`, `#ffedea`/`#831c1e`, `#fffbeb`/`#92400e` + `#fde68a`, `#eceeef`/`#353736` | Positive, negative, notice, neutral |

Radii step down from the sheet: **16** sheet · **8** panel and dialogs' inner blocks · **6**
controls · **4** tags. Floating things (dialogs, toasts) use 12.

## Mark

MadarWA is مدار, "orbit". The mark is a white planet whose ring, tilted 27°, passes behind it at
the top and in front of it at the bottom, with a gold satellite on the ring's raised end, on a flat
accent tile (24-unit grid, 5.5 corner). Two colours on the tile and nothing else: no gradient, glow,
outline or shadow, so it holds on light and dark toolbars and next to WhatsApp's own green. The
satellite stands for what MadarWA keeps for you, which is why the unseen count wears its gold.

`src/shared/brand.ts` is the only drawing. The icons, the launcher in WhatsApp's header and the React
mark (`BrandMark`) are all built from it, at three optical sizes. It never mirrors, so in Arabic and
English alike the unseen count covers the satellite (top right) and the state dot sits on the tile's
empty bottom-right corner, clear of the ring.

| Detail | Used for | Front of the ring |
|---|---|---|
| `tiny` | 16px toolbar icon | Runs into the planet; only the back of the ring and the satellite keep their cuts |
| `small` | 32px toolbar icon; the 24px marks in WhatsApp's header, the panel and the popup | One groove above it |
| `full` | 48px and 128px icons; the 48px lock screen and floating launcher | Cut on both sides; the planet's lower edge shows below it |

`npm run icons` renders `icons/icon-{16,32,48,128}.png` and `icons/icon.svg` from the same code.
16 and 32 are full-bleed, the largest tile Chrome's toolbar draws; 128 is 96px of artwork inside
16px of transparent padding, as the Chrome Web Store asks; 48 keeps 2px.

## Type

- **IBM Plex Sans Arabic** (OFL-1.1), bundled from `@fontsource/ibm-plex-sans-arabic` into
  `dist/fonts/` and declared on the page document as `"MadarWA Plex"` (`src/shared/fonts.ts`),
  because Chrome ignores `@font-face` inside a shadow root. No font CDN, nothing fetched.
- One family covers Arabic and Latin. Weights **400 / 500 / 600** only; nothing is faux-bolded.
- Scale (tokens `--mw-text-*`, Tailwind `text-mw-*`): **11** counters and badges (the floor) ·
  **12** hints, labels, meta · **14** body, rows, controls, nav · **16** card titles, header ·
  **20** page titles · **24** keypad digits. No arbitrary sizes.
- Every number uses tabular figures. Locale-formatted dates and times use
  `unicode-bidi: plaintext`, so Arabic dates are never forced left-to-right.
- Arabic counts are written as "label: value" (`أرقام صالحة: 12`), which is grammatical for every
  number; "10 رسالة" style strings are not allowed.

## Shell

- **Drawer:** `min(720px, 100vw)` at the inline-end edge, over a 25% ink backdrop.
- **Header (48px):** the 24px mark, product name, connection status ("Connected" with a static
  dot), عربي/EN segmented control, lock (only when a PIN is set), close.
- **Rail (192px):** labelled items, 14px/500 muted; the active item is a neutral grey pill with the
  label in ink at 600. Labels never wrap. A count appears only for **unseen deleted messages**.
- **Sheet:** connection banner (only when not live), then the section: a 20px title, one grey line
  about what the section does, then panels. Nothing sits right of a title unless it is real state,
  such as a campaign that is running.
- **Phone width (≤560px):** the frame disappears, the rail becomes a horizontal strip, and only the
  current step keeps its label.

## Components

- **Buttons:** ranked by importance, never coloured by meaning. One ink primary per screen,
  secondary is white with a 1px border, tertiary is text. 36px in forms (same as inputs), 30px in
  rows and toolbars. Disabled stays legible (muted ink on `#eceeef`, 5.5:1); a busy button keeps
  its look and shows a spinner.
- **Switch rows:** 14/500 title, optional warning mark for account-level changes (with screen-reader
  text), one status pill after the title **only for an exception** (for example "Not supported on
  this build"), a 12px grey description, the switch at the inline end. A disabled row can say why.
- **Pills:** 20px, 11px/500, pale pairs only. One status mark per row; a pill never repeats what a
  switch or a label already says. Neutral is the default.
- **Lists:** rows on the panel split by 1px rules. No box per row, no icon tiles, no fourth surface
  level: frame, sheet and panel are enough. Separators stay attached to the next item so a wrapped
  line never ends on a dangling "·".
- **Empty states:** a 1px dashed box with one sentence (and the next step when there is one). No
  illustration.
- **Notices:** an info note is plain grey text. Warning and danger notices use the pale pairs, at
  most one per panel.

## Unseen count

`STORAGE_KEYS.vaultSeenAt` stores when the vault was last on screen. Deleted messages captured
after it are **unseen**; `countUnseen()` (`src/shared/storage.ts`) is the one rule used by the
toolbar badge (service worker), the WhatsApp header launcher, the floating launcher and the rail.
Everywhere it is a gold pill with ink numerals; a green one would vanish into the green tile it
sits on in the toolbar and the launchers.
Opening the vault marks everything seen in every open tab. The popup still shows the total as a
plain statistic.

## Inside WhatsApp's chrome

- **Header launcher:** one more 40px button in WhatsApp's chat-list toolbar, before the menu, with
  WhatsApp's own size and hover. It carries the 24px mark, so MadarWA is found at a glance in
  WhatsApp's light and dark themes. Rings in the header's colour (read from WhatsApp's header) cut
  the dot and the count out of the tile. No dot while connected; an amber or red dot only when
  something is wrong.
- **Floating launcher:** only on screens without that toolbar (QR, loading): the 48px tile itself,
  lifted by a soft shadow, with white rings around its dot and count; draggable; never shown
  together with the header launcher.
- **In-chat blocks** follow WhatsApp's theme (`body[data-madarwa-theme]`), set from WhatsApp's own
  theme, not from a setting. They use WhatsApp's palette, the bundled typeface and an 11px floor.

## Deleted messages in the chat

Every deleted bubble in the open chat gets exactly one of two blocks, inside the bubble (the part
of WhatsApp's message container that holds the time), under WhatsApp's own "This message was
deleted", which is never removed:

| Block | When | Looks like |
|---|---|---|
| **Pill** (`data-madarwa-inline-restore`) | A saved copy has something to show: text, a caption, a preview or a media type | Rounded WhatsApp-green pill "Show deleted message"; opens a panel with the text, times, copy and media |
| **Note** (`data-madarwa-inline-missing`) | No saved copy, or a saved record whose text never arrived | One quiet line under a hairline: info icon, "No saved copy", and the reason |

Reasons, from what is actually known (`InlineRestorer.missingPlan`):

- **Deleted before MadarWA received it**: a record exists but only the deletion notice arrived, or
  the message is newer than when saving started. The tooltip explains when MadarWA receives messages.
- **Older than when saving started (date)**: the message predates `STORAGE_KEYS.captureSince`,
  written on first run and again whenever saving is switched back on.
- **Its copy was removed when the vault was cleared (date)**: older than
  `STORAGE_KEYS.vaultClearedAt`.

Deleted rows are recognised from WhatsApp's own store (the engine's revoked-row index), not from the
deleted-message text, so the note works in any WhatsApp language.

Staying on screen: the restorer watches the open chat (mutations in `#main` only, 120ms debounce,
a 4s safety pass) and re-applies blocks whenever WhatsApp renders the chat again: reopening it,
scrolling, or replacing a bubble. A pill the user opened reopens expanded. A block remembers the row
id it was built for, so a recycled row is rebuilt instead of showing another message's pill. New
rows trigger one revoke-index refresh, so deletions loaded by scrolling up get their block too.

No repeats: WhatsApp reports old deletions again after every reload. A deletion already in the
vault only fills in what it lacked (its revoke id, the real message time, content found later) and
does not toast, notify or post a webhook again. A deletion with nothing to show that predates saving
or the last clear is not added to the vault at all; its note explains it.

## Connection states

One model (`src/shared/connection.ts`) drives the header, the launchers and the popup, so a state
always has the same words everywhere.

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

Error toasts use plain, translated messages mapped from error codes (`src/shared/errors.ts`), never
raw engine text.

## Progressive disclosure

- Every section opens with short setting rows; technical inputs never appear at rest.
- Sub-options live behind a compact `Configure` control or stay hidden until the feature's master
  switch is on (auto-reply rules say how many are kept while it is off).
- Privacy opens with Full stealth / Disable all, with Undo.
- Broadcast is three steps (numbers → message → send); step labels are cut only when the row has no
  room.
- The vault has filter chips with counts and loads media on demand.

## Motion

120–200ms, transform and opacity only, entrance animations with fill-mode `backwards` (a kept
transform would trap `position: fixed` dialogs). Nothing pulses. `prefers-reduced-motion` removes
motion.

## Accessibility

Visible focus ring in the accent on every control, real labels, targets of 30px or more (WCAG 2.2
asks for 24px), state never carried by colour alone, the off switch outline meets 3:1 against the
panel, all text tiers meet 4.5:1 (placeholders included), dialogs trap focus and Escape closes
only the top layer.

## Signature moves

1. **Interactive deleted-message pill** inside the real WhatsApp bubble: restored text, times and
   copy, a photo lightbox, inline video and voice players, or a document download; and where no
   copy exists, a note that says why instead of silence.
2. **Surgical hover-to-reveal:** only the hovered name, number, preview, avatar, message or media
   unblurs (160ms), never the whole screen.
3. **A launcher in WhatsApp's own toolbar:** the same size and hover as WhatsApp's buttons,
   carrying the MadarWA tile, with a gold count that only appears when there is something new to
   look at.

## Best-effort boundaries

One-tick suppression patches every WhatsApp Web receipt path while keeping local unread state. It
cannot control the linked phone, so the option says "best effort" in its description while it is on.

## Slop audit

- No dark theme, no theme switch, no emerald washes; the old teal palette is gone from Tailwind.
- The mark is flat: one tile colour, white and one gold. The old emerald gradient, glow and rim are
  gone from the icons.
- No gradients, glows, glass, pulsing dots, side stripes, icon tiles or tinted icon circles.
- No pills next to page titles, no "Active"/"Supported" pills that repeat a switch, no red count
  that never goes away, no zero shown in a state colour.
- No nested white boxes inside grey panels; no row cards; no illustration empty states.
- No faded disabled text; no placeholder under 4.5:1.
- Lucide outline icons only, one stroke, muted, never in a container.
- Both AR/RTL and EN/LTR checked live on WhatsApp Web, in WhatsApp's dark theme.

## Changelog

- **Mark and icons:** a new mark (a planet with its ring in front, and a gold satellite) drawn once
  in `src/shared/brand.ts` at three optical sizes; icons regenerated from it, with the store's 16px
  padding at 128; the WhatsApp header launcher, panel, popup, lock screen and floating launcher show
  the tile; unseen counts (toolbar badge, launcher, rail) are gold so they stand out on the tile.
- **Deleted messages in the chat:** pills come back after WhatsApp re-renders a chat (the watcher
  never started before), sit inside the bubble, and stay open; a note with the reason replaces the
  empty "Text" pill and appears under deletions with no copy at all; old deletions no longer re-toast
  or re-post webhooks after a reload; group message ids parse correctly; in-chat text is 11px or
  larger in the bundled typeface.
- **Framed sheet, light only:** frame/sheet shell, IBM Plex Sans Arabic bundled, ink actions,
  accent limited to logo/progress/focus/unseen count, theme setting removed (a stored value from
  older versions is dropped), launcher moved into WhatsApp's toolbar, unseen-only counts,
  exception-only pills, compact empty states, flattened lists, legible disabled states, outlined off
  switch, Arabic-safe counts.
- **Previous pass:** type scale tokens, shared connection model, error mapping, dialog focus and
  Escape handling, Undo for privacy presets.
