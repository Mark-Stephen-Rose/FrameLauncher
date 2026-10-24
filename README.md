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
- `wallpaper/catalog.js` is now generated from the real wallpaper pixels by `tools/gen_catalog.py` and is read by the launcher. Re-run the script (needs `pillow` and `numpy`) after adding or replacing a wallpaper. The old unused fields were replaced.
