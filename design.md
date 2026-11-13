# Tagalong design

## Idea

A luggage tag and a field notebook. Paper, ink, and one rubber-stamp red. It should feel like something you
keep in a jacket pocket, not a dashboard.

## Signature elements

- The luggage tag: the logo, the trip cards (punched hole, dashed stitch line), the app icon, and the
  first-run preview of a sample trip (stops, people, next event, one settle-up line).
- Passport stamps: finished countries are stamped, slightly rotated, in the accent colour.
- Dotted notebook paper as the page background.

## Colour

One accent. Green is used only for "settled / good" states.

| token | light | dark | use |
|---|---|---|---|
| `--paper` | `#f5f0e6` | `#16140f` | page |
| `--card` | `#fffdf8` | `#211e17` | cards, sheets |
| `--ink` | `#1e1b16` | `#efe8d8` | text |
| `--muted` | `#5f574b` | `#b3a995` | secondary text |
| `--line` | `#d9cfbd` | `#3a3528` | hairlines |
| `--edge` | `#8a7f6c` | `#8c836f` | control borders |
| `--accent` | `#b93a1e` | `#f08060` | actions, stamps, current tab |
| `--accent-ink` | `#ffffff` | `#1a120c` | text on accent |
| `--tint` | `#f6e3da` | `#3a2219` | hover, selected |
| `--good` | `#1f6b4a` | `#7fd0a4` | settled |

Text pairs are checked for WCAG AA in both themes by `tests/e2e.py` (4.5:1 body, 3:1 large).

## Type

- Display: a book serif from the system (`Iowan Old Style`, `Palatino Linotype`, Georgia). Headings only.
- Body: the system sans.
- Labels and figures: the system mono, uppercase, letter-spaced, for eyebrows, section titles and totals.
- No web fonts: the app must open offline and instantly.
- Scale: 13 / 15 / 16 / 20 / 28 / 44 px. Nothing under 13 px.

## Space, shape, motion

- 4 px base; gaps of 8, 12, 16, 24, 28, 56.
- Radius 10 px for cards, full pill for buttons and chips.
- Borders do the work, not shadows. One soft shadow, on the sheet only.
- Motion: 150 to 200 ms ease-out on sheet and toast, nothing else. `prefers-reduced-motion` turns it off.
- Tap targets 44 px or more.

## Voice

Short, plain, second person. Say what happens: "Everyone is square.", "Start a trip", "Mark paid".
No exclamation marks, no emoji, no marketing words.

## Banned defaults

Purple or indigo gradients, glassmorphism, Inter-only type, emoji as icons, centered hero with three feature
cards, drop shadows on everything, rainbow category colours.
