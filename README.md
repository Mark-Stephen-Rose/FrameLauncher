# Frame Launcher

A photo-first home screen for Android TV streaming sticks, designed for a 720p TV and a remote control. Your apps sit
in a dock or list over a full-screen photograph, with frosted glass panels, an optional art mode and a clock that stays
readable on every wallpaper.

## Features

- **Layouts:** Dock, List or TV banner, in light or dark theme, with adjustable font size, focus size and label visibility.
- **Wallpapers:** 14 bundled photographs with frosted-glass panels and per-photo readability tuning. Shuffle them daily,
  on wake, or on demand.
- **Clock and dock:** 12 or 24-hour clock, clock and date on or off, dock at the bottom, center or top.
- **Art mode:** after an idle time you choose, show the full-screen photo with a small clock that moves around, as a
  still or a slideshow.
- **Apps:** a Recent row, pin and reorder, hide apps, App info and Uninstall from the Menu popup, and a one-step
  "Hide stock apps" for the device maker's own apps.
- **Home button:** an optional accessibility service brings Frame Launcher back when the stock home screen appears
  (Home button, wake from sleep, leaving an app). Settings has an "Open stock home" escape hatch.
- **VPN status pill (optional):** shows whether a VPN is connected and where it exits.
- **Backup and restore:** export settings, pins and hidden apps to Downloads and restore them after a reinstall.
- **Updates (optional):** a once-a-day check of GitHub Releases that only tells you a newer version exists.
- **About & storage:** version, device, Home service state, free storage and the wallpaper photo credits.

Frame Launcher has no ads, no analytics and no account. The only network use is the VPN pill and the update check,
both off by default, and nothing about your apps or settings is ever sent.

## Install

Build with GitHub Actions (no Android Studio needed): push this folder to a GitHub repo, open the **Actions** tab, run
**Build APK**, and download the artifact. Or open the folder in Android Studio, sync Gradle and choose
Build > Build APK(s).

Then install it on the stick:

```
adb connect <stick-ip>:5555
adb install -r app-debug.apk
```

You can also sideload it with an app such as Downloader. Frame Launcher appears in the device's Apps list.

To use the Home button takeover, switch on **Frame Launcher Home button** in Settings > Accessibility, or over adb:

```
adb shell settings put secure enabled_accessibility_services com.example.framelauncher/com.example.framelauncher.HomeService
adb shell settings put secure accessibility_enabled 1
```

To undo it, switch the service off in Accessibility or set Takeover to Off in Frame Launcher's settings.

## Browser preview

Open `app/src/main/assets/index.html` in a desktop browser. Arrow keys and Enter move and select, `M` is Menu and `Esc`
is Back. The preview uses sample apps and a stand-in for the device.

## Tests

`tests/` holds headless-browser tests (Playwright) that drive the launcher page with the keyboard like a remote: every
layout, dock position and font size, every Settings option, backup and restore, shuffle, the update check, art mode and
long random button sequences. The Build APK workflow runs them first and only builds the APK if they pass.

```
cd tests && npm install && npx playwright install chromium && npm test
```

They test the page, not a real device.

## Releases

Pushing a tag such as `v0.9.0` runs the **Release APK** workflow, which builds an APK signed with your own key and
attaches it to a GitHub Release. Every release is signed with the same key, so a new version installs over the old one
and keeps your data. The workflow needs four repository secrets: `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS` and
`KEY_PASSWORD`. The version comes from the tag (`v0.9.0` is versionName 0.9.0, versionCode 900). Never commit the
keystore; `.gitignore` blocks `*.jks`.

## Wallpapers and credits

The photographs are from Unsplash and are credited in Settings > About and in
[`app/src/main/assets/wallpaper/README.md`](app/src/main/assets/wallpaper/README.md). After adding or replacing a
wallpaper, update `SOURCES.json` and re-run `python3 tools/gen_catalog.py` (needs `pillow` and `numpy`); it regenerates
`catalog.js`, which holds the readability settings and credits the launcher reads.

## License

The code is released under the [MIT License](LICENSE). The wallpaper photographs are not covered by it; they remain
under the [Unsplash License](https://unsplash.com/license).

---

## Version history

### Since 0.4 (current builds default to 0.8.0)

**Load 1: faster icons.** Icons and banners load lazily as tiles scroll into view, off the UI thread. Banners are read
from the app's launcher activity first, at the TV size of 320x180; apps without one show their icon centered.

**Load 2: frosted glass.** With Glass on, the dock and panels show the wallpaper's blurred `-panel.jpg` under a veil
measured per photo so text stays readable in both themes. The clock and, with Glass off, the app labels pick light or
dark text from the photo itself.

**Load 3: clock and dock options.** A CLOCK row (12 or 24-hour, clock and date independently on or off) and a DOCK
POSITION row (Bottom, Center or Top). With the dock at the top the clock moves to the bottom-left corner.

**Load 4: art mode.** Idle time of Off, 2, 5 or 10 minutes (Off by default) plus Start now. Choose a still photo or a
slideshow (30 s or 2 min per photo) and turn the art clock on or off. Any button wakes it and does nothing else. The
screen stays awake while art mode shows.

**Load 5: VPN status pill.** Off by default. Shows a green dot and the exit country (or city and country) while a VPN is
connected and an amber "VPN off" when it is not, using any VPN app. Whether a VPN is up is read locally; only while one
is up does the launcher ask `ipwho.is` over HTTPS where the connection exits. The IP address is never shown or stored.
Adds the INTERNET and ACCESS_NETWORK_STATE permissions.

**Load 6: signed releases and backup.** Settings > BACKUP exports `FrameLauncher-settings.json` to Downloads and imports
it again, ignoring or resetting anything invalid. The Release APK workflow builds a signed APK from a version tag.

**Load 7: Home button and start-up.** An accessibility service brings Frame Launcher back when the stock home screen
appears, and a start-up receiver opens it after a reboot. It reads no screen content. Frame Launcher opens without a
transition, keeps its app list cached until an app changes, and shows a dark splash while it starts. Settings > HOME
BUTTON has a Takeover switch and an "Open stock home" mode that lets you roam the stock screens until you open Frame
Launcher, reboot, or open another app from there. The stock home screen flashes briefly before Frame Launcher returns,
because the system gives accessibility services no key presses.

**Load 8: recents, About, restore prompt, shuffle, updates and tests.**
- All apps starts with a RECENT row (newest first), which can be turned off or cleared. The Menu popup adds App info and
  Uninstall. A toast appears if an app can't be opened.
- Settings > About & storage shows the version, device, Android and WebView versions, Home service state and free
  storage, with a warning when storage runs low.
- On the first launch with nothing saved, Frame Launcher offers to restore `FrameLauncher-settings.json` from Downloads if
  one is there. Settings > Import still works afterwards.
- Settings > SHUFFLE BACKGROUND: Off, Daily, On wake and Shuffle now. It never repeats the current photo or changes it
  while Settings is open.
- Settings > UPDATES: Off (default), Check daily and Check now. It only tells you a newer release exists; nothing is
  downloaded or installed.
- Headless-browser tests run in CI before the APK is built.

**Review fixes.** The Center dock steps below the clock at large font sizes. Dock padding grows with the Focus setting so
a scaled tile is never clipped. An app can no longer be both pinned and hidden. Icons and banners refresh after an app
updates. Exporting a backup no longer waits behind a VPN lookup. The release workflow accepts tags with leading zeros and
rejects minor or patch numbers above 99.

**Wallpaper clean-up.** Removed the abstract gradient so every bundled wallpaper is a photograph, added photographer
credits to Settings > About and the wallpaper README, and added the MIT license.

### 0.4

- Fixed the bundled wallpapers so all of them load, and Settings shows thumbnails.
- Rebuilt Settings navigation: up/down changes row, left/right changes the option, scrolling is smooth, and the clock is
  hidden while a panel is open.
- All apps, List and Dock scroll to follow your selection, so every installed app is reachable.
- Hiding: press Menu on an app in All apps to Pin/Unpin or Hide it; Settings > Hidden apps restores them. Settings > Hide
  stock apps hides the device maker's own apps except Settings, the app store, Prime Video and YouTube (this also runs
  once on first launch).
- The home apps screen is one list: OK grabs and drops a pinned app, OK on an available app pins it, Menu unpins.
- Added a shortcut to the system settings. Focus +/- now changes the focus size. Light theme panels are readable.

### 0.3

- Added a Settings panel with wallpaper selection, light/dark theme, layout, label visibility, glass toggle and font size.
- Added Dock, List and TV banner layouts. The banner layout uses an app's banner when it has one and its icon otherwise.
- Added pin management and reordering, bundled wallpaper presets and saved preferences.
