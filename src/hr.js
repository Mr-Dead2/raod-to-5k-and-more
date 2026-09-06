// Bluetooth heart-rate monitor support via the standard BLE Heart Rate
// service (0x180D). Works with any device that advertises it: chest straps,
// arm bands, and watches running an HR-broadcast app.
//
// Samsung watches (Galaxy Watch 3 included) do NOT broadcast heart rate over
// Bluetooth on their own — Samsung never shipped the HR profile — so a watch
// only appears here if it is running a third-party broadcast app. On the Tizen
// watches (Watch 3 and earlier) such an app can no longer be installed:
// Samsung closed Galaxy Store downloads for Tizen watch content during 2025.
// The UI must not promise a store trip that cannot be made — see the copy in
// RunTracker.
//
// @capacitor-community/bluetooth-le gives the same API on both platforms:
// Web Bluetooth in the browser (Chrome/Android, HTTPS) and native BLE in the
// Android app.
import { useState, useRef, useCallback, useEffect } from "react";
import { loadSettings, saveSettings } from "./storage.js";
import { isNative } from "./native.js";

const HR_SERVICE = "0000180d-0000-1000-8000-00805f9b34fb";
const HR_MEASUREMENT = "00002a37-0000-1000-8000-00805f9b34fb";

// A broadcast app on a watch drops out constantly — the screen sleeps, the app
// is backgrounded, the wrist goes out of range. Losing heart rate for the rest
// of a run because of a three-second gap is not acceptable, so reconnect on our
// own instead of falling back to idle and waiting to be noticed.
const RETRY_MS = 4000, MAX_RETRIES = 15;

// Heart Rate Measurement payload: flags byte, then uint8 or uint16 bpm.
export function parseHeartRate(dv) {
  const flags = dv.getUint8(0);
  return flags & 0x01 ? dv.getUint16(1, true) : dv.getUint8(1);
}

export function hrSupported() {
  return typeof navigator !== "undefined" && ("bluetooth" in navigator || isNative());
}

// Turns a plugin rejection into something a runner standing in the cold can act
// on. Swallowing these (the old behaviour) left the connect button looking
// simply broken: it flickered and nothing happened, whatever the real cause.
export function readableError(e) {
  const msg = String(e?.message || e || "");
  if (/permission/i.test(msg)) return "Bluetooth permission was denied. Allow nearby-device access for Stride in Android settings, then try again.";
  if (/BLE is not supported|not supported/i.test(msg)) return "This device has no Bluetooth LE support.";
  if (/disabled|not enabled/i.test(msg)) return "Bluetooth is switched off — turn it on and try again.";
  if (/timeout|timed out/i.test(msg)) return "No heart-rate device answered. Check it is switched on, broadcasting, and close by.";
  if (/not connected|disconnected/i.test(msg)) return "The connection dropped before it settled. Try again.";
  return msg ? `Couldn't connect: ${msg}` : "Couldn't connect to a heart-rate device.";
}

// The user closing the device picker is a decision, not a fault — no error UI.
const isCancel = (e) => /cancel|dismiss|user denied|no device selected/i.test(String(e?.message || e || ""));

const LOST = "Lost the heart-rate device and couldn't get it back. Reconnect when you're ready.";

export function useHeartRate() {
  const [status, setStatus] = useState("idle"); // idle | connecting | connected | reconnecting
  const [bpm, setBpm] = useState(null);
  const [deviceName, setDeviceName] = useState(null);
  const [error, setError] = useState(null);
  // Whether a previous session left a device worth reconnecting to without
  // opening the picker. Read once, not on every render — RunTracker re-renders
  // four times a second while a run is being tracked.
  const [hasSavedDevice, setHasSavedDevice] = useState(() => !!loadSettings().hrDeviceId);

  const deviceId = useRef(null);
  const bleRef = useRef(null);
  const keepAlive = useRef(false);   // false once the user disconnects on purpose
  const retryTimer = useRef(null);
  const retries = useRef(0);
  const retryRef = useRef(null);     // filled in below; the drop handler calls it

  const clearRetry = () => { clearTimeout(retryTimer.current); retryTimer.current = null; };

  const scheduleRetry = useCallback((id, name) => {
    if (!keepAlive.current) return;
    clearRetry();
    if (retries.current >= MAX_RETRIES) { setStatus("idle"); setError(LOST); return; }
    retries.current += 1;
    setStatus("reconnecting");
    retryTimer.current = setTimeout(() => retryRef.current?.(id, name), RETRY_MS);
  }, []);

  // Connect to a known device id and start notifications. Shared by the first
  // connect and by every automatic retry.
  const open = useCallback(async (BleClient, id, name) => {
    await BleClient.connect(id, () => {
      // Dropped: the watch slept, the broadcast app closed, or we walked away.
      setBpm(null);
      if (!keepAlive.current) { deviceId.current = null; setStatus("idle"); return; }
      scheduleRetry(id, name);
    });
    await BleClient.startNotifications(id, HR_SERVICE, HR_MEASUREMENT, (v) => setBpm(parseHeartRate(v)));
    deviceId.current = id;
    retries.current = 0;
    setDeviceName(name);
    setStatus("connected");
    setError(null);
  }, [scheduleRetry]);

  // One reconnect attempt against the remembered device. A failure re-arms the
  // timer rather than giving up, so a watch that comes back mid-run is picked
  // up again without the runner touching the phone.
  retryRef.current = async (id, name) => {
    if (!keepAlive.current || !bleRef.current) return;
    try { await open(bleRef.current, id, name); } catch { scheduleRetry(id, name); }
  };

  const disconnect = useCallback(async () => {
    keepAlive.current = false;
    clearRetry();
    const BleClient = bleRef.current;
    if (BleClient && deviceId.current) {
      try { await BleClient.stopNotifications(deviceId.current, HR_SERVICE, HR_MEASUREMENT); } catch { /* already gone */ }
      try { await BleClient.disconnect(deviceId.current); } catch { /* already gone */ }
    }
    deviceId.current = null;
    setStatus("idle"); setBpm(null); setDeviceName(null); setError(null);
  }, []);

  // `silent: true` skips the picker and goes straight for the device used last
  // time — the one-tap path once a strap or watch is known.
  const connect = useCallback(async ({ silent = false } = {}) => {
    setError(null);
    setStatus("connecting");
    keepAlive.current = true;
    retries.current = 0;
    clearRetry();

    let BleClient;
    try {
      ({ BleClient } = await import("@capacitor-community/bluetooth-le"));
      bleRef.current = BleClient;
      // Requests BLUETOOTH_SCAN + BLUETOOTH_CONNECT on Android 12+ (and rejects
      // if either is refused), so this is where a permission problem surfaces.
      await BleClient.initialize({ androidNeverForLocation: true });
    } catch (e) {
      keepAlive.current = false;
      setStatus("idle");
      setError(readableError(e));
      return false;
    }

    // A powered-down radio is the commonest cause of "it just doesn't work",
    // and on Android the system can ask the user to switch it on for us.
    try {
      const { value: on } = await BleClient.isEnabled();
      if (!on) {
        if (isNative()) { try { await BleClient.requestEnable(); } catch { /* declined */ } }
        const { value: onNow } = await BleClient.isEnabled();
        if (!onNow) {
          keepAlive.current = false;
          setStatus("idle");
          setError("Bluetooth is switched off — turn it on and try again.");
          return false;
        }
      }
    } catch { /* isEnabled is not available everywhere — carry on and let connect fail */ }

    try {
      const saved = loadSettings();
      let id, name;
      if (silent && saved.hrDeviceId) {
        id = saved.hrDeviceId;
        name = saved.hrDeviceName || "Heart rate monitor";
      } else {
        const device = await BleClient.requestDevice({ services: [HR_SERVICE] });
        id = device.deviceId;
        name = device.name || "Heart rate monitor";
        saveSettings({ ...loadSettings(), hrDeviceId: id, hrDeviceName: name });
        setHasSavedDevice(true);
      }
      await open(BleClient, id, name);
      return true;
    } catch (e) {
      keepAlive.current = false;
      setStatus("idle");
      // Cancelling the picker is a decision, and a silent reconnect that misses
      // is not worth an alarm either — the picker is still one tap away.
      setError(isCancel(e) || silent ? null : readableError(e));
      return false;
    }
  }, [open]);

  // Forget the remembered device, so the next connect opens the picker again.
  const forgetDevice = useCallback(() => {
    const s = loadSettings();
    delete s.hrDeviceId; delete s.hrDeviceName;
    saveSettings(s);
    setHasSavedDevice(false);
  }, []);

  useEffect(() => () => { keepAlive.current = false; clearRetry(); disconnect(); }, [disconnect]);

  return {
    status, bpm, deviceName, error, hasSavedDevice,
    connect, disconnect, forgetDevice,
    dismissError: () => setError(null),
  };
}
