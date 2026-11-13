# Tagalong

Plan a trip with your group, vote on ideas, split every bill to the cent, and keep a private travel history.
No account, no server, works offline. Free.

Live: https://juw12.github.io/tagalong/ (add `?demo=1` to open it with sample trips)

![Tagalong on a phone: first run, a day plan, settle-up, passport](hone/judge/v1-phone.png)

## What it does

**Plan together**
- Trips with one or more stops, and a day-by-day itinerary. Each day is either loose (Morning / Afternoon / Evening) or on the clock, your choice per day.
- Clock days show the free gaps between events, and one tap fills a gap.
- Drag an event to another day or block, or use the edit sheet (works with keyboard and touch).
- Ideas shortlist with votes. The most wanted idea floats to the top; one tap schedules it.
- Every delete has Undo.
- On a phone the day strip fades at the edge and has an arrow button, so later days are never hidden.
- The first screen shows a sample trip as a luggage tag (stops, people, next event, who owes whom),
  so you see what a planned trip looks like before you make one.

**Split the money**
- Even split, split by shares, or itemised with tax and tip spread in proportion.
- Paste the text of a receipt and it becomes line items.
- Any currency per expense, with the rate you actually paid.
- Balances per person and the fewest transfers that settle everyone.
- All sums run in integer minor units, so the parts always add up to the bill exactly.

**Share without accounts**
- "Invite" makes a link that carries the whole trip. Whoever opens it gets the trip on their device.
- When two people have edited, opening the other person's link merges both: the newest edit of each item wins,
  votes add up. This is link sync, not live sync. Nobody's data sits on a server because there is no server.
- Export the whole plan to any calendar app (.ics).

**Passport**
- Finished trips turn into a travel history by themselves: countries, cities, return visits, flights,
  road trips, days away, who you travel with most, and a world map. On a phone the map opens zoomed
  to the countries you have been to, with a "Whole world" switch.
- Backup and restore as one JSON file.

## How it compares

Compared with the public App Store listing of "Otw: Group Trip Planner" (v1.2.0) and the trytraveler.com pitch,
read on 2026-11-13. Only listed features are compared; neither app was installed.

| | Tagalong | Otw | Traveler |
|---|---|---|---|
| Clock or Morning/Afternoon/Evening days, free gaps, drag and drop | yes | yes | not listed |
| Shortlist of ideas | yes, with votes | yes | not listed |
| Expenses: even, by item, tax + tip, currencies, settle up | yes | yes | not listed |
| Receipt | paste the text | camera scan | not listed |
| Invite by link | yes, no account | yes, sign-in needed | not listed |
| Live sync between phones | no (link merge) | yes | not listed |
| Travel history: countries, cities, return visits, flights, road trips | yes | not listed | yes |
| Photos in history | one cover photo per trip | not listed | yes |
| Platforms | any browser, installable | iPhone | iPhone |
| Works offline | yes, fully | viewing | not listed |

Where Tagalong is weaker: no live sync, no camera receipt scan, no saved-place collections, no admin/member
roles, no native App Store build yet (that needs a Mac, Xcode and an Apple Developer account).

## Run it

It is a static site with zero dependencies.

```
python -m http.server 8080
```

Open http://localhost:8080/ . On a phone, use the browser's "Add to Home Screen" to install it.

## Test it

```
node --test tests/core.test.js
python tests/e2e.py
```

The first runs the unit tests for the money maths, merge and share link. The second drives a real browser
(Playwright) through the whole flow and checks layout, contrast, tap targets and offline start.

## Files

- `index.html`, `styles.css`, `app.js`: the app
- `core.js`: pure logic (splits, balances, settle-up, merge, share link, history, calendar export)
- `world.js`: world map shapes, built by `tools/build_world.py` from Natural Earth (public domain)
- `sw.js`, `manifest.webmanifest`: offline shell and install metadata
- `design.md`: the visual identity and its rules
- `hone/refine_log.md`: the rubric, the scores and every round of the improvement loop

## Privacy

Everything stays in this browser's storage. The only way data leaves the device is a link or a backup file you
choose to send. An invite link contains the trip itself, so treat it like the trip.

## License

MIT. Map data from Natural Earth.
