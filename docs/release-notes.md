Tagalong 2.0.1: the app no longer sits under the clock and battery.

**Fixed**
- On phones where the app fills the whole screen (iPhones with a notch or Dynamic Island, and Android 15 and newer), the top bar was drawn underneath the status bar. The header, the sticky trip tabs, sheets and toasts now keep clear of the status bar, the notch and the home bar.
- Android 15 and newer: the status bar stays a separate bar above the app.

**How this was checked**
- A new layout test tells a desktop browser the screen has a 59 px notch and a 34 px home bar and checks 18 things in light and dark. The same test fails against the 2.0.0 stylesheet, so it does catch the bug.
- The Device check workflow now fails if the header starts inside the status bar zone. It runs the APK on Android emulators and a simulator build on an iPhone simulator. These are emulators and a simulator, not physical phones.

Everything from 2.0 is unchanged:

Tagalong 2: everything the first version was missing, and free ways onto every phone.

**New**
- Live sync: turn it on and every change reaches the group within seconds. No account. End-to-end encrypted with a key that only travels inside your invite links; the free public relays in between only see scrambled bytes.
- Roles: organizers and members. Organizers edit the trip and the people, and can lock the plan so only they change days and times. Everyone can still add ideas, vote and log expenses.
- Places: save places as you find them, sort them into collections, turn one into an idea with a tap.
- Scan a receipt: take a photo and it becomes line items with tax pulled out. The reading happens on your phone; the photo is never uploaded.
- The world map in Passport now drags, pinches and zooms.
- Invite from every tab, with your phone's own share sheet where it has one.
- The sample trip on the first screen opens when you tap it.

**Install for free**
- `Tagalong.apk`: Android. Open it to install, or track this repository with Obtainium for updates.
- `Tagalong-unsigned.ipa`: iPhone and iPad, for sideloading with AltStore or Sideloadly and a free Apple ID (Apple limits these to 7 days and 3 apps).
- Or skip both and add https://juw12.github.io/tagalong/ to your home screen.

Step-by-step: https://github.com/juw12/tagalong/blob/main/docs/install.md
