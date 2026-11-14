# Tagalong on the Microsoft Store

Tagalong already installs on Windows without the Store: open https://juw12.github.io/tagalong/ in Edge or Chrome and
press the install icon in the address bar. The Store listing is the same app, wrapped so people can find it by search.

Everything that does not need your Microsoft sign-in is prepared in this folder. The sign-in part is about 20 minutes.

## What only you can do

Microsoft ties a Store listing to a person. These steps need your Microsoft account, your acceptance of the App
Developer Agreement and Microsoft's identity check, so nobody else may do them for you.

1. Open https://storedeveloper.microsoft.com and register as an **individual** developer. Registration for
   individuals is free. Microsoft checks a government ID and a selfie.
2. In Partner Center (https://partner.microsoft.com/dashboard) choose **Apps and games**, **New product**,
   **MSIX or PWA app**, and reserve the name **Tagalong**. If it is taken, use **Tagalong: group trip planner**.
3. Open **Product management**, **Product identity** and copy three values:
   - Package ID (`Package/Identity/Name`)
   - Publisher ID (`Package/Identity/Publisher`, it starts with `CN=`)
   - Publisher display name
4. Open https://www.pwabuilder.com, enter `https://juw12.github.io/tagalong/`, press **Package for stores**,
   **Windows**, paste the three values, set the version to `2.0.1.0`, and download the zip.
5. Back in Partner Center start a submission. Under **Packages** upload the `.msixbundle` and the
   `.classic.appxbundle` from the zip. Microsoft signs Store packages itself, so no certificate is needed.
6. Fill in the pages below from the text in this file, upload the screenshots, and press **Submit**.
   Review usually takes a few days.

## Pricing and availability

- Price: Free. Markets: all. Visibility: public.

## Properties

- Category: Travel. Secondary: Productivity.
- Privacy policy URL: `https://juw12.github.io/tagalong/privacy.html`
- Website: `https://juw12.github.io/tagalong/`
- Support contact: `https://github.com/juw12/tagalong/issues`
- Does the app collect personal information: No.

## Age ratings

Answer the questionnaire with "no" throughout: no violence, no gambling, no purchases, no user-to-user chat, no
location sharing. People do share trips with each other, but only by sending a link themselves outside the app.

## Store listing (English)

**Short description** (under 200 characters)

Plan a trip with your group, vote on ideas, split every bill to the cent, and keep a private travel history.
No account, works offline.

**Description**

Tagalong is a trip planner for a group of friends, without the group chat mess.

Put the days in order, drop ideas into a shared list and let everyone vote, save the places you hear about, and log
what each person paid. Tagalong works out who owes whom in the fewest payments, in the currency you paid in.

There is no account and nothing to sign up for. Your trips stay on your device. Invite the others with one link.
Turn on live sync and every change reaches the group within seconds, encrypted with a key only your group has.

When the trip is over it moves to your passport: a private map and list of everywhere you have been.

**What's new in this version**

Version 2: live sync for the group, organizer and member roles with a plan lock, saved places with collections,
receipt scanning, and a pinch-and-drag passport map.

**Features** (one per line, up to 20)

- Day-by-day plan, loose or by the clock
- Idea list with group voting
- Saved places sorted into collections
- Expense split by person or by item, with tax
- Receipt scan with the camera, read on your device
- Fewest-payments settle up, in any currency
- Live sync, end-to-end encrypted, no account
- Organizer roles and a plan lock
- Add the trip to your calendar
- Passport map of every place you have been
- Works offline
- Light and dark theme

**Search terms** (up to 7)

trip planner, group travel, split bills, itinerary, travel expenses, vacation planner, travel journal

**Copyright**: (c) 2026 Juwen Lie. **License**: MIT, https://github.com/juw12/tagalong/blob/main/LICENSE

## Screenshots

Six desktop screenshots, 2732 x 1536 PNG, made from the sample trips. The Store accepts 1366 x 768 up to 3840 x 2160
and up to ten per language.

| File | Shows | Caption |
|---|---|---|
| `docs/store/01-trips.png` | Trips | Every trip in one place, coming up and done |
| `docs/store/02-plan.png` | Plan | Plan each day, loose or by the clock |
| `docs/store/03-ideas.png` | Ideas | Everyone votes, the best ideas rise |
| `docs/store/04-places.png` | Places | Save places as you hear about them |
| `docs/store/05-money.png` | Money | Split every bill and settle up in three payments |
| `docs/store/06-group.png` | Group | Invite with a link, sync live, no account |

Remake them after a design change with `python tools/store_shots.py`.

Store logo: upload `icon-512.png` from the top of this repository where Partner Center asks for a 1:1 logo.
PWABuilder makes the tile images inside the package from the same icon.

## Honest limits

- The Store package is a thin wrapper around the web app at `https://juw12.github.io/tagalong/`. It updates when the
  web app does. The first start needs the internet. After that it works offline.
- Live sync runs over free public relays with no uptime promise.
- Nothing here has been submitted or reviewed by Microsoft yet.
