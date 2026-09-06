package com.road5k.tracker;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Why a notification did not appear, answered by Android rather than guessed.
 *
 * The LocalNotifications plugin only reports the app-level POST_NOTIFICATIONS
 * grant. That is one of at least four independent things that silently stop a
 * notification, and on phones with aggressive power management (Nothing OS,
 * MIUI, One UI and friends) it is rarely the one that is actually wrong:
 *
 *  - the app-level notification switch is off;
 *  - the individual *channel* is blocked, or was created at a low importance —
 *    Android freezes a channel's importance at creation, so a later code
 *    change cannot raise it and only a reinstall (or the user) can;
 *  - the app is under battery optimisation, so alarms are deferred or dropped
 *    while the screen is off;
 *  - exact alarms are not allowed, so a timed reminder drifts.
 *
 * Written in Java to match MainActivity: the app module has no Kotlin plugin
 * applied, and none of this needs coroutines.
 *
 * Read-only apart from the open* methods, which just hand the user to the
 * relevant system screen.
 */
@CapacitorPlugin(name = "DeviceNotifications")
public class DeviceNotificationsPlugin extends Plugin {

    private static final String[] CHANNELS = { "stride-alerts", "stride-live" };

    @PluginMethod
    public void report(PluginCall call) {
        JSObject out = new JSObject();
        Context ctx = getContext();

        out.put("sdkInt", Build.VERSION.SDK_INT);
        out.put("device", Build.MANUFACTURER + " " + Build.MODEL);

        boolean appEnabled;
        try {
            appEnabled = NotificationManagerCompat.from(ctx).areNotificationsEnabled();
        } catch (Exception e) {
            appEnabled = false;
        }
        out.put("appNotificationsEnabled", appEnabled);

        // Per-channel state. A channel that does not exist yet is reported as
        // missing rather than blocked — that distinction matters, because a
        // missing channel means the app has not posted anything yet, while a
        // blocked one means it did and the user (or the system) silenced it.
        JSArray channels = new JSArray();
        try {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            for (String id : CHANNELS) {
                JSObject c = new JSObject();
                c.put("id", id);
                NotificationChannel ch = nm == null ? null : nm.getNotificationChannel(id);
                if (ch == null) {
                    c.put("exists", false);
                } else {
                    c.put("exists", true);
                    c.put("importance", ch.getImportance());
                    // IMPORTANCE_NONE (0) is what "blocked" looks like.
                    c.put("blocked", ch.getImportance() == NotificationManager.IMPORTANCE_NONE);
                }
                channels.put(c);
            }
        } catch (Exception e) { /* leave the list short rather than fail the report */ }
        out.put("channels", channels);

        boolean batteryUnrestricted = true;
        try {
            PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
            if (pm != null) batteryUnrestricted = pm.isIgnoringBatteryOptimizations(ctx.getPackageName());
        } catch (Exception e) { /* assume unrestricted rather than cry wolf */ }
        out.put("batteryUnrestricted", batteryUnrestricted);

        boolean exactAlarms = true;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
                if (am != null) exactAlarms = am.canScheduleExactAlarms();
            }
        } catch (Exception e) { /* as above */ }
        out.put("exactAlarms", exactAlarms);

        call.resolve(out);
    }

    /** Stride's notification screen: the app-level switch and every channel. */
    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        start(call, intent, appDetails());
    }

    /** One channel's own screen, where a blocked channel is un-blocked. */
    @PluginMethod
    public void openChannelSettings(PluginCall call) {
        String id = call.getString("id", CHANNELS[0]);
        Intent intent = new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName())
            .putExtra(Settings.EXTRA_CHANNEL_ID, id);
        start(call, intent, appDetails());
    }

    /**
     * The battery-optimisation list. Deliberately not
     * ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS: that needs a permission Play
     * treats as sensitive, and this screen gets the user to the same switch.
     */
    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        start(call, new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS), appDetails());
    }

    /** Stride's app info page — the fallback that exists on every device. */
    @PluginMethod
    public void openAppSettings(PluginCall call) {
        start(call, appDetails(), null);
    }

    private Intent appDetails() {
        return new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.fromParts("package", getContext().getPackageName(), null));
    }

    /**
     * Skinned Android builds drop or rename settings screens, so every open is
     * tried with a fallback. Landing on the app info page beats a dead button.
     */
    private void start(PluginCall call, Intent intent, Intent fallback) {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
            call.resolve();
            return;
        } catch (Exception ignored) { /* try the fallback below */ }
        if (fallback != null) {
            fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                getContext().startActivity(fallback);
                call.resolve();
                return;
            } catch (Exception ignored) { /* nothing left to try */ }
        }
        call.reject("Couldn't open that settings screen on this phone.");
    }
}
