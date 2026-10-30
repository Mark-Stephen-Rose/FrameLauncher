package com.example.framelauncher;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;

/**
 * Opens one app of your choice (a VPN app, say) when the device starts and each time it wakes, then brings Frame
 * Launcher back after a few seconds. It only returns if that app is still the one on screen, so it never pulls you
 * out of something you opened yourself in the meantime.
 */
final class AutoOpen {
    static final String KEY_APP = "autoApp";      // package name, empty = off
    static final String KEY_SECS = "autoSecs";    // seconds before returning to Frame Launcher
    private static final long REPEAT_GUARD_MS = 60000;   // start-up and wake can both fire; run once

    private static final Handler H = new Handler(Looper.getMainLooper());
    private static long lastRun = 0;

    private AutoOpen() { }

    static String app(Context c) { return HomeService.prefs(c).getString(KEY_APP, ""); }

    static int secs(Context c) {
        int s = HomeService.prefs(c).getInt(KEY_SECS, 10);
        return (s == 5 || s == 10 || s == 20) ? s : 10;
    }

    /** Waits a moment (the network and the stock home are still starting), then runs. */
    static void runSoon(final Context c) {
        final Context app = c.getApplicationContext();
        if (app(app).length() == 0) return;
        H.postDelayed(new Runnable() { public void run() { AutoOpen.run(app, false); } }, 3000);
    }

    /** Opens the chosen app now. force = true skips the once-a-minute guard (the "Test now" button). */
    static boolean run(Context c, boolean force) {
        final Context app = c.getApplicationContext();
        final String pkg = app(app);
        if (pkg.length() == 0) return false;
        long now = SystemClock.elapsedRealtime();
        if (!force && lastRun != 0 && now - lastRun < REPEAT_GUARD_MS) return false;
        PackageManager pm = app.getPackageManager();
        Intent i = pm.getLeanbackLaunchIntentForPackage(pkg);
        if (i == null) i = pm.getLaunchIntentForPackage(pkg);
        if (i == null) return false;
        try {
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            app.startActivity(i);
        } catch (Exception ex) { return false; }
        lastRun = now;
        H.postDelayed(new Runnable() { public void run() {
            String cur = HomeService.lastPkg;
            // Still on that app (or we cannot tell): bring Frame Launcher back. Anything else means you moved on.
            if (cur == null || cur.equals(pkg)) HomeService.openFrame(app);
        } }, secs(app) * 1000L);
        return true;
    }
}
