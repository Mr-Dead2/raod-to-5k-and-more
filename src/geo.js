// Unified location watching for the run tracker. On the web it wraps
// navigator.geolocation.watchPosition. In the native Android app it uses
// @capacitor-community/background-geolocation, which runs an Android
// foreground service with a persistent notification — so GPS keeps recording
// while the screen is off or another app is in front (the browser can't do
// that; there the screen Wake Lock in tracker.js is the mitigation).
//
// Both paths deliver the same normalised fix shape:
//   { lat, lng, accuracy, speed, t }   (speed may be null; t is epoch ms)
import { Capacitor, registerPlugin } from "@capacitor/core";

export const ERR_PERMISSION = "Location permission denied — allow it to track your run.";
export const ERR_SIGNAL = "Couldn't get a GPS signal. Head outside with a clear view of the sky.";
export const ERR_UNSUPPORTED = "This device has no GPS / location support.";

// Starts a watch and returns { stop() }, or null if location is unsupported.
// onFix(fix) is called for every location update, onError(message) on failure.
export function startLocationWatch(onFix, onError) {
  if (Capacitor.isNativePlatform()) return startNativeWatch(onFix, onError);
  return startWebWatch(onFix, onError);
}

function startNativeWatch(onFix, onError) {
  const BackgroundGeolocation = registerPlugin("BackgroundGeolocation");
  let id = null;
  let stopped = false;
  BackgroundGeolocation.addWatcher(
    {
      // Providing backgroundMessage is what enables the foreground service,
      // i.e. tracking with the screen off / app in the background.
      backgroundTitle: "Road to 5K — run in progress",
      backgroundMessage: "Recording your distance and route. Tap to return.",
      requestPermissions: true,
      stale: false,
      distanceFilter: 0,
    },
    (location, error) => {
      if (error) {
        onError(error.code === "NOT_AUTHORIZED" ? ERR_PERMISSION : ERR_SIGNAL);
        return;
      }
      if (!location) return;
      onFix({
        lat: location.latitude,
        lng: location.longitude,
        accuracy: location.accuracy,
        speed: location.speed,
        t: location.time || Date.now(),
      });
    },
  ).then(
    (watcherId) => {
      if (stopped) BackgroundGeolocation.removeWatcher({ id: watcherId });
      else id = watcherId;
    },
    () => onError(ERR_SIGNAL),
  );
  return {
    stop() {
      stopped = true;
      if (id != null) BackgroundGeolocation.removeWatcher({ id });
      id = null;
    },
  };
}

function startWebWatch(onFix, onError) {
  if (!("geolocation" in navigator)) { onError(ERR_UNSUPPORTED); return null; }
  const id = navigator.geolocation.watchPosition(
    (pos) => onFix({
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
      speed: pos.coords.speed,
      t: pos.timestamp || Date.now(),
    }),
    (e) => onError(e.code === 1 ? ERR_PERMISSION : ERR_SIGNAL),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
  );
  return { stop() { navigator.geolocation.clearWatch(id); } };
}
