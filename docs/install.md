# Install Tagalong without paying any store fee

Tagalong is one app in four free wrappers. Every one of them runs the same code and keeps your trips on your phone.

| Device | Free way | What it costs you |
|---|---|---|
| iPhone, iPad | Safari, then Share, then **Add to Home Screen** | Nothing. Works offline, own icon, no App Store. |
| iPhone, iPad | **Sideload** the IPA from the latest release with AltStore or Sideloadly and a free Apple ID | Nothing, but Apple makes free-account apps expire after 7 days (re-sign to refresh) and allows 3 such apps at a time. |
| Android | Chrome, then menu, then **Install app** | Nothing. |
| Android | Download **Tagalong.apk** from the latest release and open it | Nothing. Allow "install unknown apps" for your browser once. |
| Android, auto-updates | Add `https://github.com/juw12/tagalong` to **Obtainium** | Nothing. Obtainium checks the GitHub releases and updates the app for you. |
| Windows, Mac, Linux | Chrome or Edge, then the install icon in the address bar | Nothing. |
| Windows, from the Microsoft Store | Not listed yet. The listing kit is ready in [microsoft-store.md](microsoft-store.md) | Nothing. Microsoft made individual developer accounts free. |

Open the web app: https://juw12.github.io/tagalong/ (sample trips: https://juw12.github.io/tagalong/?demo=1)
Downloads: https://github.com/juw12/tagalong/releases/latest

## Why not the App Store or Google Play?

Both charge a fee to publish: Apple's Developer Program is US$99 a year and a Google Play developer account is a
one-time US$25. There is no free way onto either store. Everything above avoids them.
If that changes, the same native projects (`native/`) can be submitted as they are.

## Sideloading on iPhone, step by step (Windows)

1. Install iTunes and iCloud from Apple's website (not the Microsoft Store versions), or follow the current
   instructions on https://sideloadly.io or https://altstore.io.
2. Download `Tagalong-unsigned.ipa` from the latest release.
3. Plug in the iPhone, open Sideloadly, drop the IPA in, sign in with your Apple ID, press Start.
4. On the iPhone: Settings, General, VPN & Device Management, trust your Apple ID.
   On iOS 16 and later also turn on Settings, Privacy & Security, Developer Mode.
5. Every 7 days, sideload again (AltStore can refresh by itself over Wi-Fi while AltServer runs).

The IPA is built on GitHub's free macOS machines from the code in this repository (`.github/workflows/native.yml`),
so anyone can check what is inside. It is not signed by Apple; the sideloading tool signs it with your own Apple ID.

## Checking a download

Each release has `SHA256SUMS.txt`. On Windows: `certutil -hashfile Tagalong.apk SHA256`.
The Android APK is signed with the Tagalong release key; its certificate SHA-256 is
`6B:A4:51:B0:0E:3B:99:31:AA:1A:57:C9:FC:6C:72:ED:A4:4C:66:3B:B0:F2:DB:02:AB:35:7E:D4:63:E1:EC:00`.
