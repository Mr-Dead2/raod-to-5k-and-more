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
// A scan only ever sees devices that are ADVERTISING. A watch that is paired
// and connected to the phone (through its companion app) generally stops
// advertising altogether, so no scan — filtered by the heart-rate service or
// not — can see it. That is why "it doesn't detect my watch" was still the
// outcome with the service filter dropped. On Android the paired devices are
// listed from the bond table instead (`getBondedDevices`), so the watch can be
// pointed at directly; connecting then gives a definitive answer about whether
// it has a pulse to give.
//
// @capacitor-community/bluetooth-le gives the same API on both platforms:
// Web Bluetooth in the browser (Chrome/Android, HTTPS) and native BLE in the
// Android app. The browser owns its own device chooser and exposes neither the
// bond table nor a free scan, so the list picker is native-only.
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
  if (/no device found/i.test(msg)) {
    return "Nothing nearby is broadcasting heart rate. A watch has to be running an HR-broadcast app to appear here — being paired to the phone is not enough. Tap \u201cShow every nearby device\u201d to see what Bluetooth can actually see.";
  }
  if (/characteristic not found|service not found/i.test(msg)) {
    return "That device connected, but it doesn't offer the Bluetooth heart-rate service, so it can't send a pulse. Samsung watches don't unless an HR-broadcast app is running on the watch itself.";
  }
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
  const [devices, setDevices] = useState([]);       // what the picker is showing
  const [scanning, setScanning] = useState(false);

  const deviceId = useRef(null);
  const bleRef = useRef(null);
  const keepAlive = useRef(false);   // false once the user disconnects on purpose
  const retryTimer = useRef(null);
  const retries = useRef(0);
  const retryRef = useRef(null);     // filled in below; the drop handler calls it
  const scanTimer = useRef(null);
  const seen = useRef(new Map());

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
  // time. `anyDevice: true` drops the heart-rate filter from the scan, so the
  // picker lists every BLE device in range.
  //
  // That second one exists because a filtered scan cannot tell "your watch is
  // not broadcasting heart rate" apart from "the scan is broken" — both are an
  // empty list. Letting the user point the app straight at the watch turns a
  // guess into an answer: either it works, or the connection succeeds and the
  // heart-rate characteristic is missing, which says plainly that the device
  // has no pulse to give.
  // Loads the plugin, asks for permissions, and makes sure the radio is on.
  // Shared by the picker and by connecting, because "nothing was detected" is
  // usually one of these three failing rather than an absent device.
  const ensureBle = useCallback(async () => {
    let BleClient;
    try {
      ({ BleClient } = await import("@capacitor-community/bluetooth-le"));
      bleRef.current = BleClient;
      // Requests BLUETOOTH_SCAN + BLUETOOTH_CONNECT on Android 12+ (and rejects
      // if either is refused), so this is where a permission problem surfaces.
      await BleClient.initialize({ androidNeverForLocation: true });
    } catch (e) {
      setError(readableError(e));
      return null;
    }

    // A powered-down radio is the commonest cause of "it just doesn't work",
    // and on Android the system can ask the user to switch it on for us.
    //
    // BleClient.isEnabled() resolves to a plain boolean. It is the *plugin*
    // underneath (BluetoothLe.isEnabled) that answers {value}; the BleClient
    // wrapper already unwraps it. Destructuring {value} here read undefined,
    // which is falsy — so this branch fired no matter what the radio was doing,
    // told the user Bluetooth was off while it was plainly on, and put a system
    // "turn on Bluetooth" dialog in front of them. The connect path was
    // unreachable on the phone as a result.
    try {
      let on = await BleClient.isEnabled();
      if (!on) {
        if (isNative()) { try { await BleClient.requestEnable(); } catch { /* declined */ } }
        on = await BleClient.isEnabled();
      }
      if (!on) {
        setError("Bluetooth is switched off — turn it on and try again.");
        return null;
      }
    } catch { /* isEnabled is not available everywhere — carry on and let connect fail */ }

    return BleClient;
  }, []);

  const stopScan = useCallback(async () => {
    clearTimeout(scanTimer.current);
    scanTimer.current = null;
    setScanning(false);
    try { await bleRef.current?.stopLEScan(); } catch { /* not scanning */ }
  }, []);

  // Builds the picker list: paired devices from the bond table, anything
  // already connected that offers heart rate, and whatever a live scan turns
  // up. Paired comes first because that is where a watch actually is — it is
  // bonded to the phone and therefore not advertising for a scan to find.
  const startScan = useCallback(async ({ anyDevice = false, seconds = 15 } = {}) => {
    setError(null);
    await stopScan();
    seen.current = new Map();
    setDevices([]);

    const BleClient = await ensureBle();
    if (!BleClient) return false;

    const add = (d) => {
      if (!d?.id) return;
      const prev = seen.current.get(d.id);
      // A device found by the scan is worth more than the same one from the
      // bond table: the scan proves it is switched on and in range right now.
      seen.current.set(d.id, {
        ...prev, ...d,
        name: d.name || prev?.name || null,
        source: prev?.source === "scan" ? "scan" : d.source,
      });
      setDevices([...seen.current.values()].sort((a, b) =>
        (a.source === "scan" ? 0 : 1) - (b.source === "scan" ? 0 : 1) ||
        String(a.name || "\uffff").localeCompare(String(b.name || "\uffff"))));
    };

    // getBondedDevices resolves to {} on the web, so guard the array.
    try {
      for (const d of (await BleClient.getBondedDevices()) || []) {
        add({ id: d.deviceId, name: d.name, source: "paired" });
      }
    } catch { /* Android-only; fine to skip */ }
    try {
      for (const d of (await BleClient.getConnectedDevices([HR_SERVICE])) || []) {
        add({ id: d.deviceId, name: d.name, source: "connected" });
      }
    } catch { /* not supported everywhere */ }

    setScanning(true);
    try {
      await BleClient.requestLEScan(
        anyDevice ? { allowDuplicates: false } : { services: [HR_SERVICE] },
        (r) => add({
          id: r.device?.deviceId,
          name: r.device?.name || r.localName || null,
          source: "scan",
          rssi: r.rssi,
        }),
      );
    } catch (e) {
      setScanning(false);
      setError(readableError(e));
      return false;
    }
    // Scanning forever drains the battery and never becomes more informative.
    scanTimer.current = setTimeout(() => { stopScan(); }, seconds * 1000);
    return true;
  }, [ensureBle, stopScan]);

  const connect = useCallback(async ({ silent = false, anyDevice = false, deviceId: pickedId, deviceName: pickedName } = {}) => {
    setError(null);
    setStatus("connecting");
    keepAlive.current = true;
    retries.current = 0;
    clearRetry();
    await stopScan();

    const BleClient = await ensureBle();
    if (!BleClient) { keepAlive.current = false; setStatus("idle"); return false; }

    try {
      const saved = loadSettings();
      let id, name;
      if (pickedId) {
        // Chosen from our own list (native): a paired watch, or a scan hit.
        id = pickedId;
        name = pickedName || "That device";
        saveSettings({ ...loadSettings(), hrDeviceId: id, hrDeviceName: name });
        setHasSavedDevice(true);
      } else if (silent && saved.hrDeviceId) {
        id = saved.hrDeviceId;
        name = saved.hrDeviceName || "Heart rate monitor";
      } else {
        // optionalServices matters on the web, where a service not named up
        // front cannot be read afterwards; on Android it is ignored.
        const device = await BleClient.requestDevice(
          anyDevice ? { optionalServices: [HR_SERVICE] } : { services: [HR_SERVICE] }
        );
        id = device.deviceId;
        name = device.name || (anyDevice ? "That device" : "Heart rate monitor");
        saveSettings({ ...loadSettings(), hrDeviceId: id, hrDeviceName: name });
        setHasSavedDevice(true);
      }
      try {
        await open(BleClient, id, name);
      } catch (e) {
        // Connected, but it has no heart-rate characteristic. Drop the GATT
        // link rather than leaving it open on a device we cannot use.
        if (/characteristic not found|service not found/i.test(String(e?.message || e))) {
          try { await BleClient.disconnect(id); } catch { /* already gone */ }
          keepAlive.current = false;
          setStatus("idle");
          setError(`${name} connected, but doesn't offer the Bluetooth heart-rate service, so it can't send a pulse. A watch needs an HR-broadcast app running on the watch itself.`);
          return false;
        }
        throw e;
      }
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

  useEffect(() => () => { keepAlive.current = false; clearRetry(); clearTimeout(scanTimer.current); disconnect(); }, [disconnect]);

  return {
    status, bpm, deviceName, error, hasSavedDevice,
    devices, scanning, startScan, stopScan,
    connect, disconnect, forgetDevice,
    // The browser insists on showing its own device chooser and exposes neither
    // the bond table nor a free scan, so the in-app list is native-only.
    canPickFromList: isNative(),
    dismissError: () => setError(null),
  };
}
