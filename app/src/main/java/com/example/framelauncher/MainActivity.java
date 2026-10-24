package com.example.framelauncher;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Bundle;
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
    }

    private void js(String code) { if (web != null) web.evaluateJavascript(code, null); }

    /* Keep the TV from dimming or starting the system screensaver while art mode is showing. */
    private void keepAwake(final boolean on) {
        runOnUiThread(new Runnable() { public void run() {
            if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }});
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
        js("window.onResume&&onResume()");
        js("window.refreshApps&&refreshApps()");
    }
    @Override protected void onNewIntent(Intent i) { super.onNewIntent(i); js("window.onHome&&onHome()"); } // Home pressed
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
                return out.toString();
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

        @JavascriptInterface public void settings() {
            runOnUiThread(new Runnable() { public void run() {
                try { startActivity(new Intent(Settings.ACTION_SETTINGS)); } catch (Exception ignored) { }
            }});
        }
    }
}
