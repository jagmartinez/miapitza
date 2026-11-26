package com.miapitza.ops;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(KioskPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // The pin prompt or a dialog can bring the system bars back: re-hide them while the kiosk is on.
        if (hasFocus && KioskPlugin.isImmersiveWanted()) {
            KioskPlugin.applyImmersive(this);
        }
    }
}
