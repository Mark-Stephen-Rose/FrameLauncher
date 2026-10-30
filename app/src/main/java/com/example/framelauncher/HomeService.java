package com.example.framelauncher;

import android.accessibilityservice.AccessibilityService;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.os.SystemClock;
import android.view.accessibility.AccessibilityEvent;

/**
 * The device's system does not let a third-party app become the real Home app, so this watches for the stock launcher
 * coming to the front (Home button, wake from sleep, leaving an app) and puts Frame Launcher back on top. It reads no
 * screen content; it only looks at which app's window just appeared. The stock home flashes for a moment first, because
 * the system gives accessibility services no key presses.
 *
 * "Open stock home" starts a free-roaming mode: the stock home and settings are left alone so you can move around
 * them. The mode ends when you open Frame Launcher, reboot, or open any other app from the stock home; from then on
 * Home goes back to Frame Launcher again.
 */
public class HomeService extends AccessibilityService {
    static final String PREFS = "frame";
    static final String KEY_TAKEOVER = "takeover";       // user switch in Settings (default on)
    static final String KEY_STOCK_MODE = "stockMode";  // "Open stock home" was used: leave the stock launcher alone until Frame is opened again
    static final String[] STOCK_LAUNCHERS = { "com.amazon.tv.launcher", "com.amazon.firelauncher" };

    static volatile boolean running = false;
    static volatile String lastPkg = null;   // the app whose window appeared last (AutoOpen uses it to know you are still there)
    private long lastLaunch = 0;
    private long ignoreStockUntil = 0;
    private BroadcastReceiver wakeReceiver;

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    static void setStockMode(Context c, boolean on) { prefs(c).edit().putBoolean(KEY_STOCK_MODE, on).apply(); }

    /** Brings Frame Launcher to the front (a singleTask activity, so it reuses the running one and shows its home screen). */
    static void openFrame(Context c) {
        try {
            Intent i = new Intent(c, MainActivity.class);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED
                    | Intent.FLAG_ACTIVITY_NO_ANIMATION);   // no slide/fade, so it appears as fast as it can
            c.startActivity(i);
        } catch (Exception ignored) { }
    }

    @Override protected void onServiceConnected() {
        running = true;
        // The screen coming on is the "wake" for the auto-open app. A manifest receiver cannot hear it, but a running service can.
        if (wakeReceiver == null) {
            wakeReceiver = new BroadcastReceiver() {
                @Override public void onReceive(Context c, Intent i) { AutoOpen.runSoon(c); }
            };
            try { registerReceiver(wakeReceiver, new IntentFilter(Intent.ACTION_SCREEN_ON)); } catch (Exception ignored) { }
        }
    }

    private void stopWakeReceiver() {
        if (wakeReceiver != null) { try { unregisterReceiver(wakeReceiver); } catch (Exception ignored) { } wakeReceiver = null; }
    }

    @Override public boolean onUnbind(Intent intent) { running = false; stopWakeReceiver(); return super.onUnbind(intent); }

    @Override public void onDestroy() { running = false; stopWakeReceiver(); super.onDestroy(); }

    @Override public void onInterrupt() { }

    /** Windows that belong to the device's own system (home, settings, system bars) and so do not end free-roaming mode. */
    private static boolean isSystemWindow(String p) {
        return p.equals("android") || p.equals("com.android.systemui") || p.equals("com.example.framelauncher")
                || p.startsWith("com.amazon.tv.") || p.startsWith("com.amazon.firelauncher");
    }

    @Override public void onAccessibilityEvent(AccessibilityEvent e) {
        if (e == null || e.getEventType() != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return;
        CharSequence cs = e.getPackageName();
        if (cs == null) return;
        String pkg = cs.toString();
        if (!pkg.equals("com.android.systemui") && !pkg.equals("android")) lastPkg = pkg;
        SharedPreferences sp = prefs(this);
        long now = SystemClock.elapsedRealtime();
        boolean stock = false;
        for (String a : STOCK_LAUNCHERS) if (a.equals(pkg)) stock = true;
        boolean roaming = sp.getBoolean(KEY_STOCK_MODE, false);

        if (!stock) {
            // Free-roaming ends as soon as any other app opens, so Home from that app comes back to Frame Launcher.
            if (roaming && !isSystemWindow(pkg)) {
                setStockMode(this, false);
                ignoreStockUntil = now + 2500;   // the stock home can still send a late window event as the app opens
            }
            return;
        }
        if (!sp.getBoolean(KEY_TAKEOVER, true) || roaming) return;
        if (now < ignoreStockUntil) return;
        if (now - lastLaunch < 1500) return;      // one Home press raises several window events
        lastLaunch = now;
        openFrame(this);
    }
}
