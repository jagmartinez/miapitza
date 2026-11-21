package com.miapitza.ops;

import android.app.Activity;
import android.view.View;
import android.view.WindowManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "Kiosk")
public class KioskPlugin extends Plugin {

    private boolean active = false;

    @PluginMethod
    public void start(final PluginCall call) {
        final Activity activity = getActivity();
        activity.runOnUiThread(() -> {
            try {
                activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                activity.getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                );
                // Device owner: true lock task. Otherwise Android shows the screen-pinning prompt.
                activity.startLockTask();
                active = true;
                call.resolve();
            } catch (Exception e) {
                call.reject("Kiosk start failed", e);
            }
        });
    }

    @PluginMethod
    public void stop(final PluginCall call) {
        final Activity activity = getActivity();
        activity.runOnUiThread(() -> {
            try {
                activity.stopLockTask();
            } catch (Exception ignored) {
                // Not pinned: nothing to stop.
            }
            activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            activity.getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
            active = false;
            call.resolve();
        });
    }

    @PluginMethod
    public void isActive(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("active", active);
        call.resolve(ret);
    }
}
