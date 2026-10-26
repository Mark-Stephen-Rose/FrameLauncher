package com.example.framelauncher;

import android.Manifest;
import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.Settings;
import android.util.Base64;
import android.view.KeyEvent;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private WebView web;

    /* Art mode (full-screen wallpaper). While it shows, the first key press only wakes it and is not passed on. */
    private volatile boolean artOn = false;
    private int swallowKey = -1;   // key that woke art mode: eat its repeats and its key-up too

    /* Single background thread: art is drawn in the order the page asked for it (dock first). */
    private final ExecutorService art = Executors.newSingleThreadExecutor();
    /* Settings backup: a JSON file in Downloads, so it survives uninstalling the app. */
    private static final String BACKUP_NAME = "FrameLauncher-settings.json";
    private static final int REQ_STORAGE = 77;
    private Runnable afterPerm = null;
    private String afterPermKind = "";

    /* The installed-apps list is rebuilt only when an app is installed, removed or updated, so coming back to the
       launcher does not re-query every app each time. */
    private final Object appsLock = new Object();
    private String appsCache = null;
    private BroadcastReceiver pkgReceiver;

    /* Separate thread for the VPN location lookup so a slow network never delays icon loading. */
    private final ExecutorService net = Executors.newSingleThreadExecutor();
    private static final String GEO_URL = "https://ipwho.is/?fields=success,country,country_code,region,city";
    private final Map<String, String[]> artCache = new HashMap<String, String[]>(); // art thread only

    private String encode(Drawable d, int w, int h) {
        Bitmap bm = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        d.setBounds(0, 0, w, h);
        d.draw(new Canvas(bm));
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        bm.compress(Bitmap.CompressFormat.PNG, 90, bo);
        bm.recycle();
        return Base64.encodeToString(bo.toByteArray(), Base64.NO_WRAP);
    }

    private String renderIcon(String pkg) {
        try { return encode(getPackageManager().getApplicationIcon(pkg), 128, 128); }
        catch (Exception ex) { return ""; }
    }

    /* Many apps declare their TV banner on the launcher activity, not on the <application>. Try that first. */
    private String renderBanner(String pkg) {
        try {
            PackageManager pm = getPackageManager();
            Drawable d = null;
            Intent i = pm.getLeanbackLaunchIntentForPackage(pkg);
            if (i == null) i = pm.getLaunchIntentForPackage(pkg);
            if (i != null) {
                try { d = pm.getActivityBanner(i); } catch (Exception ignored) { }
            }
            if (d == null) d = pm.getApplicationBanner(pkg);
            return d == null ? "" : encode(d, 320, 180);   // 320x180 is the Android TV banner size (16:9)
        } catch (Exception ex) { return ""; }
    }

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        web = new WebView(this);
        web.setBackgroundColor(0xFF14181B);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);   // localStorage holds pinned apps
        web.addJavascriptInterface(new Bridge(), "Launcher");
        web.setWebViewClient(new WebViewClient());
        setContentView(web);
        web.requestFocus();
        web.loadUrl("file:///android_asset/index.html");
        pkgReceiver = new BroadcastReceiver() {
            @Override public void onReceive(Context c, Intent i) { synchronized (appsLock) { appsCache = null; } }
        };
        IntentFilter f = new IntentFilter();
        f.addAction(Intent.ACTION_PACKAGE_ADDED);
        f.addAction(Intent.ACTION_PACKAGE_REMOVED);
        f.addAction(Intent.ACTION_PACKAGE_CHANGED);
        f.addAction(Intent.ACTION_PACKAGE_REPLACED);
        f.addDataScheme("package");
        registerReceiver(pkgReceiver, f);
    }

    @Override protected void onDestroy() {
        try { unregisterReceiver(pkgReceiver); } catch (Exception ignored) { }
        super.onDestroy();
    }

    private void js(String code) { if (web != null) web.evaluateJavascript(code, null); }

    /* Keep the TV from dimming or starting the system screensaver while art mode is showing. */
    private void keepAwake(final boolean on) {
        runOnUiThread(new Runnable() { public void run() {
            if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }});
    }

    private void backupResult(final String kind, final boolean ok, final String data) {
        final String call = "window.onBackup&&onBackup(" + JSONObject.quote(kind) + "," + ok + "," + JSONObject.quote(data) + ")";
        runOnUiThread(new Runnable() { public void run() { js(call); } });
    }

    /* Runs r once storage access is granted (asks the first time on Android 6+). Must be called on the UI thread. */
    private void withStorage(String kind, Runnable r) {
        if (Build.VERSION.SDK_INT < 23
                || checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED) {
            r.run();
            return;
        }
        afterPerm = r;
        afterPermKind = kind;
        requestPermissions(new String[] { Manifest.permission.WRITE_EXTERNAL_STORAGE,
                Manifest.permission.READ_EXTERNAL_STORAGE }, REQ_STORAGE);
    }

    @Override public void onRequestPermissionsResult(int req, String[] perms, int[] res) {
        super.onRequestPermissionsResult(req, perms, res);
        if (req != REQ_STORAGE) return;
        Runnable r = afterPerm;
        String kind = afterPermKind;
        afterPerm = null;
        if (r != null && res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED) r.run();
        else if (r != null) backupResult(kind, false, kind.equals("export")
                ? "storage permission was not allowed" : "Storage permission was not allowed");
    }

    @Override protected void onPause() {
        artOn = false; swallowKey = -1; keepAwake(false);
        js("window.onWake&&onWake()");
        super.onPause();
        if (web != null) { web.onPause(); web.pauseTimers(); }   // nothing runs while another app is in front
    }

    @Override protected void onResume() {
        super.onResume();
        if (web != null) { web.resumeTimers(); web.onResume(); }
        HomeService.setAmazonMode(this, false);   // Frame is in front again, so the Home button comes back here
        js("window.onResume&&onResume()");
        js("window.refreshApps&&refreshApps()");
    }
    @Override protected void onNewIntent(Intent i) {   // Home pressed
        super.onNewIntent(i);
        overridePendingTransition(0, 0);
        js("window.onHome&&onHome()");
    }
    @Override public void onBackPressed() { js("window.onBack&&onBack()"); }  // never exit the launcher

    @Override public boolean dispatchKeyEvent(KeyEvent e) {
        int code = e.getKeyCode();
        boolean volume = code == KeyEvent.KEYCODE_VOLUME_UP || code == KeyEvent.KEYCODE_VOLUME_DOWN
                || code == KeyEvent.KEYCODE_VOLUME_MUTE;
        if (artOn && !volume) {                       // any key wakes art mode and does nothing else
            if (e.getAction() == KeyEvent.ACTION_DOWN) {
                artOn = false; swallowKey = code; keepAwake(false);
                js("window.onWake&&onWake()");
            }
            return true;
        }
        if (swallowKey == code) {
            if (e.getAction() == KeyEvent.ACTION_UP) swallowKey = -1;
            return true;
        }
        if (e.getKeyCode() == KeyEvent.KEYCODE_MENU) {
            if (e.getAction() == KeyEvent.ACTION_DOWN) js("window.onMenu&&onMenu()");
            return true;
        }
        return super.dispatchKeyEvent(e);
    }

    private class Bridge {
        @JavascriptInterface public String apps() {
            synchronized (appsLock) { if (appsCache != null) return appsCache; }
            try {
                PackageManager pm = getPackageManager();
                Map<String, String> found = new LinkedHashMap<String, String>();
                String[] cats = { Intent.CATEGORY_LEANBACK_LAUNCHER, Intent.CATEGORY_LAUNCHER };
                for (String c : cats) {
                    Intent q = new Intent(Intent.ACTION_MAIN).addCategory(c);
                    List<ResolveInfo> l = pm.queryIntentActivities(q, 0);
                    for (ResolveInfo r : l) {
                        String p = r.activityInfo.packageName;
                        if (p.equals(getPackageName()) || found.containsKey(p)) continue;
                        found.put(p, String.valueOf(r.loadLabel(pm)));
                    }
                }
                JSONArray out = new JSONArray();
                for (Map.Entry<String, String> en : found.entrySet())
                    out.put(new JSONObject().put("p", en.getKey()).put("n", en.getValue()));
                String json = out.toString();
                synchronized (appsLock) { appsCache = json; }
                return json;
            } catch (Exception ex) { return "[]"; }
        }

        /* Asynchronous: renders on a background thread, then calls window.onArt(pkg, iconB64, bannerB64). */
        @JavascriptInterface public void load(final String pkg) {
            art.execute(new Runnable() { public void run() {
                String[] r = artCache.get(pkg);
                if (r == null) {
                    r = new String[] { renderIcon(pkg), renderBanner(pkg) };
                    artCache.put(pkg, r);
                }
                final String call = "window.onArt&&onArt(" + JSONObject.quote(pkg) + ","
                        + JSONObject.quote(r[0]) + "," + JSONObject.quote(r[1]) + ")";
                runOnUiThread(new Runnable() { public void run() { js(call); } });
            }});
        }

        @JavascriptInterface public void launch(final String pkg) {
            runOnUiThread(new Runnable() { public void run() {
                try {
                    PackageManager pm = getPackageManager();
                    Intent i = pm.getLeanbackLaunchIntentForPackage(pkg);
                    if (i == null) i = pm.getLaunchIntentForPackage(pkg);
                    if (i != null) startActivity(i);
                } catch (Exception ignored) { }
            }});
        }

        /* The page tells us when art mode starts or stops. */
        @JavascriptInterface public void art(final boolean on) {
            artOn = on;
            keepAwake(on);
        }

        /* Is a VPN tunnel up? Local check only, no network traffic. Returns {"on":bool,"id":"<tunnel id>"}. */
        @JavascriptInterface public String vpn() {
            try {
                ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
                for (Network n : cm.getAllNetworks()) {
                    NetworkCapabilities c = cm.getNetworkCapabilities(n);
                    if (c != null && c.hasTransport(NetworkCapabilities.TRANSPORT_VPN))
                        return new JSONObject().put("on", true).put("id", String.valueOf(n)).toString();
                }
                return "{\"on\":false,\"id\":\"\"}";
            } catch (Exception ex) { return "{\"on\":false,\"id\":\"\",\"err\":1}"; }
        }

        /* Asynchronous: asks ipwho.is where this connection exits, then calls window.onGeo(json). The IP is not kept. */
        @JavascriptInterface public void geo() {
            net.execute(new Runnable() { public void run() {
                String out = "{\"ok\":false}";
                HttpURLConnection h = null;
                try {
                    h = (HttpURLConnection) new URL(GEO_URL).openConnection();
                    h.setConnectTimeout(8000);
                    h.setReadTimeout(8000);
                    h.setRequestProperty("Accept", "application/json");
                    if (h.getResponseCode() == 200) {
                        BufferedReader r = new BufferedReader(new InputStreamReader(h.getInputStream(), "UTF-8"));
                        StringBuilder sb = new StringBuilder();
                        String line;
                        while ((line = r.readLine()) != null && sb.length() < 20000) sb.append(line);
                        r.close();
                        JSONObject j = new JSONObject(sb.toString());
                        if (j.optBoolean("success", false)) {
                            out = new JSONObject().put("ok", true)
                                    .put("country", j.optString("country"))
                                    .put("cc", j.optString("country_code"))
                                    .put("city", j.optString("city")).toString();
                        }
                    }
                } catch (Exception ignored) {
                } finally {
                    if (h != null) h.disconnect();
                }
                final String call = "window.onGeo&&onGeo(" + JSONObject.quote(out) + ")";
                runOnUiThread(new Runnable() { public void run() { js(call); } });
            }});
        }

        /* Home button takeover status: is the accessibility service running, and is the switch on? */
        @JavascriptInterface public String homeState() {
            return "{\"service\":" + HomeService.running + ",\"takeover\":"
                    + HomeService.prefs(MainActivity.this).getBoolean(HomeService.KEY_TAKEOVER, true) + "}";
        }

        @JavascriptInterface public void setTakeover(boolean on) {
            HomeService.prefs(MainActivity.this).edit()
                    .putBoolean(HomeService.KEY_TAKEOVER, on).putBoolean(HomeService.KEY_AMAZON_MODE, false).apply();
        }

        /* Escape hatch: open Amazon's own home screen and leave it alone until Frame Launcher is opened again. */
        @JavascriptInterface public boolean openAmazonHome() {
            for (String pkg : HomeService.AMAZON_LAUNCHERS) {
                final Intent h = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
                        .setPackage(pkg).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                if (getPackageManager().resolveActivity(h, 0) == null) continue;
                HomeService.setAmazonMode(MainActivity.this, true);
                runOnUiThread(new Runnable() { public void run() {
                    try { startActivity(h); } catch (Exception ignored) { HomeService.setAmazonMode(MainActivity.this, false); }
                }});
                return true;
            }
            return false;
        }

        @JavascriptInterface public void openAccessibility() {
            runOnUiThread(new Runnable() { public void run() {
                try { startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)); } catch (Exception ignored) { }
            }});
        }

        @JavascriptInterface public String version() {
            try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; }
            catch (Exception ex) { return ""; }
        }

        /* Writes the page's settings JSON to Downloads/FrameLauncher-settings.json, then calls window.onBackup. */
        @JavascriptInterface public void exportSettings(final String json) {
            runOnUiThread(new Runnable() { public void run() {
                withStorage("export", new Runnable() { public void run() {
                    net.execute(new Runnable() { public void run() {
                        try {
                            File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                            //noinspection ResultOfMethodCallIgnored
                            dir.mkdirs();
                            FileOutputStream o = new FileOutputStream(new File(dir, BACKUP_NAME));
                            try { o.write(json.getBytes("UTF-8")); } finally { o.close(); }
                            backupResult("export", true, "Downloads/" + BACKUP_NAME);
                        } catch (Exception ex) {
                            backupResult("export", false, "could not write to Downloads");
                        }
                    }});
                }});
            }});
        }

        /* Reads Downloads/FrameLauncher-settings.json and hands its text to window.onBackup. */
        @JavascriptInterface public void importSettings() {
            runOnUiThread(new Runnable() { public void run() {
                withStorage("import", new Runnable() { public void run() {
                    net.execute(new Runnable() { public void run() {
                        try {
                            File f = new File(Environment.getExternalStoragePublicDirectory(
                                    Environment.DIRECTORY_DOWNLOADS), BACKUP_NAME);
                            if (!f.isFile() || f.length() > 200000) {
                                backupResult("import", false, "No backup found: put " + BACKUP_NAME + " in Downloads");
                                return;
                            }
                            FileInputStream in = new FileInputStream(f);
                            ByteArrayOutputStream bo = new ByteArrayOutputStream();
                            try {
                                byte[] buf = new byte[4096];
                                int n;
                                while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
                            } finally { in.close(); }
                            backupResult("import", true, bo.toString("UTF-8"));
                        } catch (Exception ex) {
                            backupResult("import", false, "Could not read the backup file");
                        }
                    }});
                }});
            }});
        }

        @JavascriptInterface public void settings() {
            runOnUiThread(new Runnable() { public void run() {
                try { startActivity(new Intent(Settings.ACTION_SETTINGS)); } catch (Exception ignored) { }
            }});
        }
    }
}
