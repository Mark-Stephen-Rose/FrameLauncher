package com.example.framelauncher;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Opens Frame Launcher when the device finishes starting up (if the Home button takeover is on). */
public class BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c, Intent i) {
        if (i == null || !Intent.ACTION_BOOT_COMPLETED.equals(i.getAction())) return;
        HomeService.setStockMode(c, false);   // a restart always starts back in Frame Launcher
        if (HomeService.prefs(c).getBoolean(HomeService.KEY_TAKEOVER, true)) HomeService.openFrame(c);
        AutoOpen.runSoon(c);   // the chosen app (a VPN app, say), if one is set
    }
}
