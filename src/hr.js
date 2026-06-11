// Bluetooth heart-rate monitor support via the standard BLE Heart Rate
// service (0x180D). Works with chest straps, fitness bands and watches that
// broadcast heart rate — including Samsung Galaxy watches running a free
// HR-broadcast app from the Galaxy Store (the watch then appears as a normal
// BLE heart-rate monitor).
//
// @capacitor-community/bluetooth-le gives the same API on both platforms:
// Web Bluetooth in the browser (Chrome/Android, HTTPS) and native BLE in the
// Android app.
import { useState, useRef, useCallback, useEffect } from "react";

const HR_SERVICE = "0000180d-0000-1000-8000-00805f9b34fb";
const HR_MEASUREMENT = "00002a37-0000-1000-8000-00805f9b34fb";

// Heart Rate Measurement payload: flags byte, then uint8 or uint16 bpm.
export function parseHeartRate(dv) {
  const flags = dv.getUint8(0);
  return flags & 0x01 ? dv.getUint16(1, true) : dv.getUint8(1);
}

export function hrSupported() {
  // native always has BLE; on the web it needs Web Bluetooth (Chrome/Edge)
  return typeof navigator !== "undefined" && ("bluetooth" in navigator || window.Capacitor?.isNativePlatform?.());
}

export function useHeartRate() {
  const [status, setStatus] = useState("idle"); // idle | connecting | connected | error
  const [bpm, setBpm] = useState(null);
  const [deviceName, setDeviceName] = useState(null);
  const deviceId = useRef(null);
  const bleRef = useRef(null);

  const disconnect = useCallback(async () => {
    const BleClient = bleRef.current;
    if (BleClient && deviceId.current) {
      try { await BleClient.stopNotifications(deviceId.current, HR_SERVICE, HR_MEASUREMENT); } catch { /* already gone */ }
      try { await BleClient.disconnect(deviceId.current); } catch { /* already gone */ }
    }
    deviceId.current = null;
    setStatus("idle"); setBpm(null); setDeviceName(null);
  }, []);

  const connect = useCallback(async () => {
    setStatus("connecting");
    try {
      const { BleClient } = await import("@capacitor-community/bluetooth-le");
      bleRef.current = BleClient;
      await BleClient.initialize({ androidNeverForLocation: true });
      const device = await BleClient.requestDevice({ services: [HR_SERVICE] });
      await BleClient.connect(device.deviceId, () => {
        // dropped connection (watch out of range / broadcast app closed)
        deviceId.current = null;
        setStatus("idle"); setBpm(null); setDeviceName(null);
      });
      deviceId.current = device.deviceId;
      await BleClient.startNotifications(device.deviceId, HR_SERVICE, HR_MEASUREMENT,
        (value) => setBpm(parseHeartRate(value)));
      setDeviceName(device.name || "Heart rate monitor");
      setStatus("connected");
      return true;
    } catch {
      // user closed the picker, or no device found — both fine
      deviceId.current = null;
      setStatus("idle");
      return false;
    }
  }, []);

  useEffect(() => () => { disconnect(); }, [disconnect]);

  return { status, bpm, deviceName, connect, disconnect };
}
