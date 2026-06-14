// Newer Android Gradle Plugin / Gradle (8.x+) rejects
// getDefaultProguardFile('proguard-android.txt') as a hard error because it
// pulls in `-dontoptimize`. Capacitor 6's library + plugin modules still ship
// that call in their build.gradle, which lives under node_modules and is
// regenerated on every install — so we can't fix it by hand once.
//
// This script rewrites those copies to use 'proguard-android-optimize.txt'
// (the file AGP now wants; it exists in every AGP version, so this is safe on
// the older pinned toolchain too). It's idempotent and never throws, so it's
// safe to run from `postinstall` and before each Android build — and a no-op
// for web-only deploys where the Android files may be absent.
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const FROM = "getDefaultProguardFile('proguard-android.txt')";
const TO = "getDefaultProguardFile('proguard-android-optimize.txt')";

function patchFile(path) {
  try {
    const src = readFileSync(path, "utf8");
    if (!src.includes(FROM)) return false;
    writeFileSync(path, src.split(FROM).join(TO));
    return true;
  } catch {
    return false;
  }
}

// Find every build.gradle under a directory (shallow-ish recursive walk).
function findGradle(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    const p = join(dir, name);
    let s;
    try { s = statSync(p); } catch { continue; }
    if (s.isDirectory()) {
      if (name === "node_modules" || name === "build" || name === ".git") continue;
      findGradle(p, out);
    } else if (name === "build.gradle") {
      out.push(p);
    }
  }
  return out;
}

try {
  const targets = [];
  const capDir = join(process.cwd(), "node_modules", "@capacitor");
  if (existsSync(capDir)) for (const f of findGradle(capDir)) targets.push(f);
  // also any community plugins that follow the same pattern
  const commDir = join(process.cwd(), "node_modules", "@capacitor-community");
  if (existsSync(commDir)) for (const f of findGradle(commDir)) targets.push(f);

  let patched = 0;
  for (const f of targets) if (patchFile(f)) patched++;
  if (patched) console.log(`[fix-android-proguard] updated ${patched} Capacitor build.gradle file(s) to proguard-android-optimize.txt`);
} catch (e) {
  // never fail an install/build because of this best-effort patch
  console.warn("[fix-android-proguard] skipped:", e?.message || e);
}
