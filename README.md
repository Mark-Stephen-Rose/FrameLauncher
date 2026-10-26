# Frame Launcher v0.4 (Fire TV Stick, 720p)
Build (no Android Studio): push this folder to a GitHub repo -> Actions tab -> "Build APK" -> download artifact.
Build (Android Studio): open folder -> Gradle sync -> Build > Build APK(s).
Install: adb connect <stick-ip>:5555 ; adb install -r app-debug.apk   (or sideload with Downloader)
Browser preview: open app/src/main/assets/index.html (arrows/Enter, M = Menu, Esc = Back).
It shows in the Fire TV Apps list. Home-button takeover is a separate step (see chat notes).


## v0.3 changes
- Added a Settings panel with wallpaper selection, light/dark theme, layout, label visibility, glass toggle and font sizing.
- Added Dock, List and TV banner layout options. Banner layout uses an installed app's Android banner when provided, falling back to its app icon.
- Added pin management and reordering controls.
- Added 15 bundled gradient wallpaper presets and local preference persistence.
- Version code/name bumped to 3 / 0.3.

## v0.4 changes
- Fixed wallpapers: all 15 bundled photos now load (the list pointed at files that did not exist, so only Alpine worked). Settings shows thumbnails.
- Rebuilt Settings navigation: up/down changes row, left/right changes the option in that row. Scrolling is smooth and only moves when needed. No more native focus scrolling shoving the page around, and the clock is hidden while a panel is open.
- All apps now scrolls to follow your selection, so every installed app is reachable. Same for List and Dock layouts.
- Added hiding: press Menu on an app in All apps to Pin/Unpin or Hide it. Settings > Hidden apps restores them. Settings > Hide all Amazon apps hides every com.amazon.* app except Settings, Appstore, Prime Video and YouTube. This also runs once on first launch.
- Home apps screen is now one list: OK grabs/drops a pinned app (up/down moves it), OK on an available app pins it, Menu unpins.
- Added Settings > Fire TV system settings.
- Focus +/- now actually changes the focus size.
- Light theme panels are readable.

## Unreleased (v0.5 in progress)
- Load 1: icons and banners now load lazily as tiles scroll into view (off the UI thread), so the first launch no longer waits on every installed app. Banners are read from the app's launcher activity first, then the app, at the proper 320x180 TV size; apps without a banner show their icon centered instead of a cropped blur.
- Load 2: real frosted glass. With Glass on, the dock and panels (All apps, Settings, etc.) show the wallpaper's blurred `-panel.jpg`, lined up with the photo behind it, under a veil whose strength was measured per photo so text stays readable in both themes. The clock and, with Glass off, the app labels now pick light or dark text from the photo itself (so Sydney Harbour and Alpine glow get a dark clock), with a soft scrim where a photo is busy.
- Load 3: clock and dock options in Settings. New CLOCK row: 12-hour or 24-hour, and Clock / Date on or off (each independent). New DOCK POSITION row: Bottom, Center or Top for the Dock and TV banner layouts (List keeps its own spot). With the dock at the top, the clock moves to the bottom-left corner and picks its colour from the photo there. Existing settings are kept; the new ones default to the old look.
- Load 4: art mode. Settings > ART MODE sets the idle time (Off, 2, 5 or 10 minutes; Off by default) and has a Start now button. After that long with no button press, the launcher shows the full-screen wallpaper with a small clock that hops to another corner every couple of minutes. ART STYLE picks a still photo or a slideshow (30 s or 2 min per photo, with a fade) and turns the art clock on or off. Any button wakes it and does nothing else. Idle time only counts while the launcher is in front, and the screen is kept awake while art mode shows so the Fire TV screensaver does not cut in.
- Load 5: VPN status pill. Settings > VPN STATUS (Off by default) shows a small pill on the home screen: a green dot and the exit country (or city + country) while a VPN is connected, an amber dot and "VPN off" when it is not. It works with any VPN app, including Proton VPN. Whether a VPN is up is read locally from Android; only while one is up does the launcher ask ipwho.is over HTTPS where the connection exits, once per new tunnel and then every 10 minutes. The IP address is never shown or stored. This adds the INTERNET and ACCESS_NETWORK_STATE permissions. Check now re-runs the lookup. If your VPN app excludes the launcher from the tunnel (split tunneling), the location can be wrong.
- Load 6: signed releases and settings backup.
  - **Backup:** Settings > BACKUP has Export settings and Import settings. Export writes `FrameLauncher-settings.json` (settings, pinned apps, hidden apps) to the Downloads folder, so it survives uninstalling the app. Import asks you to press OK twice, then restores it; anything missing or invalid in the file is ignored or reset to a safe value, and pinned apps that are not installed are skipped. The first use asks for storage permission. The row also shows the installed version.
  - **Releases:** pushing a tag like `v0.6.0` runs the Release APK workflow, which builds an APK signed with your own key and attaches it to a GitHub Release. Because every release is signed with the same key, a new version installs over the old one and keeps your data. Needs four repository secrets: `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`. The version comes from the tag (v0.6.0 is versionName 0.6.0, versionCode 600). Never commit the keystore; `.gitignore` blocks `*.jks`.
- Load 7: Home button and start-up. Fire OS will not let a third-party app be the real Home app, so Frame Launcher includes an accessibility service ("Frame Launcher Home button") that notices Amazon's launcher coming to the front and brings Frame Launcher back: on the Home button, on waking the stick, and when you leave an app. It reads no screen content; it only notices which app's window just opened. A start-up receiver also opens Frame Launcher after a reboot. Settings > HOME BUTTON has a Takeover On/Off switch, **Open Fire TV home** (opens Amazon's home and its settings and lets you move around them freely; that ends when you open Frame Launcher, reboot, or open any other app from Amazon's home, after which Home goes back to Frame Launcher) and a shortcut to Accessibility settings. The service must be switched on once, in Settings > Accessibility, or over adb:
  ```
  adb shell settings put secure enabled_accessibility_services com.example.framelauncher/com.example.framelauncher.HomeService
  adb shell settings put secure accessibility_enabled 1
  ```
  Amazon's home screen flashes for a moment before Frame Launcher appears, because Fire OS gives accessibility services no key presses. To undo everything, switch the service off in Accessibility, or turn Takeover Off.
- `wallpaper/catalog.js` is now generated from the real wallpaper pixels by `tools/gen_catalog.py` and is read by the launcher. Re-run the script (needs `pillow` and `numpy`) after adding or replacing a wallpaper. The old unused fields were replaced.
