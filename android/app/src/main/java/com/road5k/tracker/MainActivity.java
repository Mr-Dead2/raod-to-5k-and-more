package com.road5k.tracker;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.road5k.tracker.healthconnect.HealthConnectPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugins that ship in node_modules are registered for us by
        // `cap sync`; this one lives in the repo, so it has to be declared
        // before super.onCreate() starts the bridge.
        registerPlugin(HealthConnectPlugin.class);
        registerPlugin(DeviceNotificationsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
