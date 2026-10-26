package com.example.framelauncher;

import android.accessibilityservice.AccessibilityService;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.SystemClock;
import android.view.accessibility.AccessibilityEvent;

/**
 * Fire OS does not let a third-party app become the real Home app, so this watches for Amazon's launcher coming to the
 * front (Home button, wake from sleep, leaving an app) and puts Frame Launcher back on top. It only listens to window
 * changes from Amazon's launcher packages (see res/xml/accessibility_service.xml) and reads no screen content.
 * Amazon's home flashes for a moment first, because Fire OS gives accessibility services no key presses.
 */
public class HomeService extends AccessibilityService {
    static final String PREFS = "frame";
    static final String KEY_TAKEOVER = "takeover";       // user switch in Settings (default on)
    static final String KEY_AMAZON_MODE = "amazonMode";  // "Open Fire TV home" was used: leave Amazon alone until Frame is opened again
    static final String[] AMAZON_LAUNCHERS = { "com.amazon.tv.launcher", "com.amazon.firelauncher" };

    static volatile boolean running = false;
    private long lastLaunch = 0;

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    static void setAmazonMode(Context c, boolean on) { prefs(c).edit().putBoolean(KEY_AMAZON_MODE, on).apply(); }

    /** Brings Frame Launcher to the front (a singleTask activity, so it reuses the running one and shows its home screen). */
    static void openFrame(Context c) {
        try {
            Intent i = new Intent(c, MainActivity.class);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
            c.startActivity(i);
        } catch (Exception ignored) { }
    }

    @Override protected void onServiceConnected() { running = true; }

    @Override public boolean onUnbind(Intent intent) { running = false; return super.onUnbind(intent); }

    @Override public void onDestroy() { running = false; super.onDestroy(); }

    @Override public void onInterrupt() { }

    @Override public void onAccessibilityEvent(AccessibilityEvent e) {
        if (e == null || e.getEventType() != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return;
        CharSequence pkg = e.getPackageName();
        if (pkg == null) return;
        boolean amazon = false;
        for (String a : AMAZON_LAUNCHERS) if (a.contentEquals(pkg)) amazon = true;
        if (!amazon) return;
        SharedPreferences sp = prefs(this);
        if (!sp.getBoolean(KEY_TAKEOVER, true) || sp.getBoolean(KEY_AMAZON_MODE, false)) return;
        long now = SystemClock.elapsedRealtime();
        if (now - lastLaunch < 1500) return;      // one Home press raises several window events
        lastLaunch = now;
        openFrame(this);
    }
}
