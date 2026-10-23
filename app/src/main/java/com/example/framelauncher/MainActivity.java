package com.example.framelauncher;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.os.Bundle;
import android.provider.Settings;
import android.util.Base64;
import android.view.KeyEvent;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class MainActivity extends Activity {
    private WebView web;

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

    @Override protected void onResume() { super.onResume(); js("window.refreshApps&&refreshApps()"); }
    @Override protected void onNewIntent(Intent i) { super.onNewIntent(i); js("window.onHome&&onHome()"); } // Home pressed
    @Override public void onBackPressed() { js("window.onBack&&onBack()"); }  // never exit the launcher

    @Override public boolean dispatchKeyEvent(KeyEvent e) {
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

        @JavascriptInterface public String icon(String pkg) {
            try {
                Drawable d = getPackageManager().getApplicationIcon(pkg);
                Bitmap bm = Bitmap.createBitmap(128, 128, Bitmap.Config.ARGB_8888);
                d.setBounds(0, 0, 128, 128);
                d.draw(new Canvas(bm));
                ByteArrayOutputStream bo = new ByteArrayOutputStream();
                bm.compress(Bitmap.CompressFormat.PNG, 100, bo);
                return Base64.encodeToString(bo.toByteArray(), Base64.NO_WRAP);
            } catch (Exception ex) { return ""; }
        }

        @JavascriptInterface public String banner(String pkg) {
            try {
                Drawable d = getPackageManager().getApplicationBanner(pkg);
                if (d == null) return "";
                Bitmap bm = Bitmap.createBitmap(440, 200, Bitmap.Config.ARGB_8888);
                Canvas c = new Canvas(bm);
                d.setBounds(0, 0, 440, 200);
                d.draw(c);
                ByteArrayOutputStream bo = new ByteArrayOutputStream();
                bm.compress(Bitmap.CompressFormat.PNG, 90, bo);
                return Base64.encodeToString(bo.toByteArray(), Base64.NO_WRAP);
            } catch (Exception ex) { return ""; }
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

        @JavascriptInterface public void settings() {
            runOnUiThread(new Runnable() { public void run() {
                try { startActivity(new Intent(Settings.ACTION_SETTINGS)); } catch (Exception ignored) { }
            }});
        }
    }
}
