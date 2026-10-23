# Frame Launcher v0.3 (Fire TV Stick, 720p)
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

Wallpaper note: the supplied CleanFrame GitHub wallpaper directory could not be downloaded from this execution environment. This build therefore includes locally generated gradient presets rather than the exact CleanFrame image assets; replace the presets with the repository's licensed/credited assets when network access is available.
