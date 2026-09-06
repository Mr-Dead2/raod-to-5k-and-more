package com.road5k.tracker.healthconnect

import android.content.Intent
import androidx.activity.result.ActivityResult
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.aggregate.AggregationResult
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.time.Instant

/**
 * A deliberately small bridge to Health Connect: check availability, ask for
 * read permission, and list workouts in a time range. Everything else — what
 * counts as a run, how a workout maps onto a plan day, what has already been
 * imported — is decided in JavaScript (src/health.js), where it can be read and
 * tested without an Android device.
 *
 * Read-only by design. Stride never writes to Health Connect, so a bad import
 * can never damage the user's health data.
 */
@CapacitorPlugin(name = "HealthConnect")
class HealthConnectPlugin : Plugin() {

    private val permissions = setOf(
        HealthPermission.getReadPermission(ExerciseSessionRecord::class),
        HealthPermission.getReadPermission(DistanceRecord::class),
        HealthPermission.getReadPermission(HeartRateRecord::class),
        HealthPermission.getReadPermission(ActiveCaloriesBurnedRecord::class),
        HealthPermission.getReadPermission(StepsRecord::class),
    )

    private fun clientOrNull(): HealthConnectClient? =
        if (HealthConnectClient.getSdkStatus(context) == HealthConnectClient.SDK_AVAILABLE) {
            try { HealthConnectClient.getOrCreate(context) } catch (e: Exception) { null }
        } else null

    /**
     * "Available" | "NotInstalled" | "NotSupported". The middle one is
     * actionable (the user can install/update the Health Connect provider);
     * the last one is not, and the UI says so rather than offering a button
     * that leads nowhere.
     */
    @PluginMethod
    fun checkAvailability(call: PluginCall) {
        val status = try { HealthConnectClient.getSdkStatus(context) } catch (e: Exception) {
            call.resolve(JSObject().put("availability", "NotSupported"))
            return
        }
        val value = when (status) {
            HealthConnectClient.SDK_AVAILABLE -> "Available"
            HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> "NotInstalled"
            else -> "NotSupported"
        }
        call.resolve(JSObject().put("availability", value))
    }

    // Named checkHealthPermissions, not checkPermissions: Capacitor's Plugin base
    // class already declares checkPermissions/requestPermissions as @PluginMethods
    // for the normal Android runtime-permission system. Health Connect grants are
    // a different mechanism entirely (its own system screen, not a runtime
    // dialog), so these get their own names rather than overriding machinery
    // they have nothing to do with.
    @PluginMethod
    fun checkHealthPermissions(call: PluginCall) {
        val client = clientOrNull()
        if (client == null) { call.resolve(JSObject().put("granted", false)); return }
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val granted = client.permissionController.getGrantedPermissions()
                // Exercise sessions are the only hard requirement; the rest
                // enrich a run but are not worth blocking an import over.
                val core = HealthPermission.getReadPermission(ExerciseSessionRecord::class)
                call.resolve(
                    JSObject()
                        .put("granted", granted.contains(core))
                        .put("all", granted.containsAll(permissions))
                )
            } catch (e: Exception) {
                call.resolve(JSObject().put("granted", false))
            }
        }
    }

    /**
     * Health Connect permissions are granted through its own system screen, not
     * the normal runtime dialog, so this launches that screen and re-reads the
     * grant when it closes rather than trusting the activity result payload.
     */
    @PluginMethod
    fun requestHealthPermissions(call: PluginCall) {
        if (clientOrNull() == null) {
            call.reject("Health Connect is not available on this device.")
            return
        }
        val intent: Intent = try {
            PermissionController.createRequestPermissionResultContract()
                .createIntent(context, permissions)
        } catch (e: Exception) {
            call.reject("Couldn't open the Health Connect permission screen.")
            return
        }
        startActivityForResult(call, intent, "permissionsResult")
    }

    @ActivityCallback
    private fun permissionsResult(call: PluginCall?, result: ActivityResult?) {
        if (call == null) return
        checkHealthPermissions(call)
    }

    /** Opens Health Connect itself, so the user can review or revoke access. */
    @PluginMethod
    fun openSettings(call: PluginCall) {
        try {
            val intent = Intent(HealthConnectClient.ACTION_HEALTH_CONNECT_SETTINGS)
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            call.resolve()
        } catch (e: Exception) {
            call.reject("Couldn't open Health Connect.")
        }
    }

    /**
     * Every exercise session between `startTime` and `endTime` (epoch ms), each
     * with the totals aggregated over its own window. Distance, calories, heart
     * rate and steps are all optional: a session recorded without them simply
     * comes back with those fields absent.
     */
    @PluginMethod
    fun readWorkouts(call: PluginCall) {
        val client = clientOrNull()
        if (client == null) { call.reject("Health Connect is not available on this device."); return }
        // Sent as strings on purpose. PluginCall.getLong() returns a value only
        // when org.json happened to parse the number as a Long, and getDouble()
        // rejects Longs — so the Java type of an epoch millisecond would be
        // decided by the JSON parser, and the wrong guess yields a silent null.
        val startMs = call.getString("startTime")?.toLongOrNull()
        val endMs = call.getString("endTime")?.toLongOrNull()
        if (startMs == null || endMs == null) { call.reject("startTime and endTime are required."); return }

        CoroutineScope(Dispatchers.IO).launch {
            try {
                val range = TimeRangeFilter.between(
                    Instant.ofEpochMilli(startMs),
                    Instant.ofEpochMilli(endMs)
                )
                val sessions = client.readRecords(
                    ReadRecordsRequest(ExerciseSessionRecord::class, timeRangeFilter = range)
                ).records

                val out = JSArray()
                for (s in sessions) {
                    val item = JSObject()
                        .put("id", s.metadata.id)
                        .put("source", s.metadata.dataOrigin.packageName)
                        .put("exerciseType", s.exerciseType)
                        .put("title", s.title)
                        .put("startTime", s.startTime.toEpochMilli())
                        .put("endTime", s.endTime.toEpochMilli())

                    // Aggregate over this session's own window. A failure here
                    // (usually a permission the user did not grant) must not
                    // lose the session itself — the run is still worth having.
                    val totals: AggregationResult? = try {
                        client.aggregate(
                            AggregateRequest(
                                metrics = setOf(
                                    DistanceRecord.DISTANCE_TOTAL,
                                    ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL,
                                    HeartRateRecord.BPM_AVG,
                                    HeartRateRecord.BPM_MAX,
                                    StepsRecord.COUNT_TOTAL,
                                ),
                                timeRangeFilter = TimeRangeFilter.between(s.startTime, s.endTime),
                            )
                        )
                    } catch (e: Exception) { null }

                    if (totals != null) {
                        totals[DistanceRecord.DISTANCE_TOTAL]?.let { item.put("distanceM", it.inMeters) }
                        totals[ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL]?.let { item.put("kcal", it.inKilocalories) }
                        totals[HeartRateRecord.BPM_AVG]?.let { item.put("hrAvg", it) }
                        totals[HeartRateRecord.BPM_MAX]?.let { item.put("hrMax", it) }
                        totals[StepsRecord.COUNT_TOTAL]?.let { item.put("steps", it) }
                    }
                    out.put(item)
                }
                call.resolve(JSObject().put("workouts", out))
            } catch (e: Exception) {
                call.reject(e.message ?: "Couldn't read workouts from Health Connect.")
            }
        }
    }
}
