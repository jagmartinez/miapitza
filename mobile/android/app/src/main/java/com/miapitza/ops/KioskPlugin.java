package com.miapitza.ops;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.Context;
import android.os.Build;
import android.view.View;
import android.view.WindowManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "Kiosk")
public class KioskPlugin extends Plugin {

    /** True between start() and stop(); MainActivity re-applies immersive on focus regain while set. */
    private static volatile boolean immersiveWanted = false;

    static boolean isImmersiveWanted() {
        return immersiveWanted;
    }

    /** Must run on the UI thread. */
    static void applyImmersive(Activity activity) {
        activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        activity.getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        );
    }

    @PluginMethod
    public void start(final PluginCall call) {
        final Activity activity = getActivity();
        activity.runOnUiThread(() -> {
            try {
                immersiveWanted = true;
                applyImmersive(activity);
                // Device owner: true lock task. Otherwise Android shows the screen-pinning prompt.
                activity.startLockTask();
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
                immersiveWanted = false;
                activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                activity.getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
                activity.stopLockTask();
                call.resolve();
            } catch (Exception e) {
                // Not pinned (stopLockTask throws) or window gone: nothing left to undo.
                call.resolve();
            }
        });
    }

    @PluginMethod
    public void isActive(PluginCall call) {
        boolean locked = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            ActivityManager am = (ActivityManager) getActivity().getSystemService(Context.ACTIVITY_SERVICE);
            locked = am != null && am.getLockTaskModeState() != ActivityManager.LOCK_TASK_MODE_NONE;
        }
        JSObject ret = new JSObject();
        ret.put("active", locked);
        call.resolve(ret);
    }
}
