// Copies the FFmpeg binary into assets/bin so Vercel always deploys it with the function
// (the installer package locates its binary dynamically, which file tracing cannot see).
import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const name = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
try {
  const source = require("@ffmpeg-installer/ffmpeg").path;
  if (!source || !existsSync(source)) throw new Error("binary not found for this platform");
  mkdirSync(join(root, "assets/bin"), { recursive: true });
  const target = join(root, "assets/bin", name);
  copyFileSync(source, target);
  chmodSync(target, 0o755);
  console.log(`prepare-assets: bundled FFmpeg -> assets/bin/${name}`);
} catch (error) {
  console.warn(`prepare-assets: WARNING FFmpeg was not bundled (${error instanceof Error ? error.message : error}). Reels will fall back to photo posts until this is fixed.`);
}
const fonts = ["NotoSansBengali-Regular.ttf", "NotoSansBengali-Bold.ttf", "NotoSansBengali-ExtraBold.ttf"];
const missing = fonts.filter(file => !existsSync(join(root, "assets/fonts", file)));
if (missing.length) { console.error(`prepare-assets: ERROR bundled fonts missing: ${missing.join(", ")}`); process.exit(1); }
console.log("prepare-assets: Bangla fonts present");
