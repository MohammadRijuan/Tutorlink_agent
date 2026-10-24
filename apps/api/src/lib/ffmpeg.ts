import { accessSync, chmodSync, constants, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { env } from "../config/env.js";

const require = createRequire(import.meta.url);
let resolved: string | null = null;

function exe(name: string) { return process.platform === "win32" ? `${name}.exe` : name; }

function makeExecutable(path: string): string {
  try { accessSync(path, constants.X_OK); return path; } catch { /* Read-only or non-executable bundle: copy to /tmp. */ }
  const target = join(tmpdir(), "tutorlink-bin", exe("ffmpeg"));
  if (!existsSync(target)) {
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(path, target);
    chmodSync(target, 0o755);
  }
  return target;
}

/** Resolution order: FFMPEG_PATH, binary copied into assets/bin at build time (always deployed), @ffmpeg-installer, system ffmpeg. */
export function ffmpegBinary(): string {
  if (resolved) return resolved;
  if (env.FFMPEG_PATH.trim()) return (resolved = env.FFMPEG_PATH.trim());
  const here = dirname(fileURLToPath(import.meta.url));
  for (const dir of [resolve(here, "../../assets/bin"), resolve(here, "../../../assets/bin"), resolve(process.cwd(), "assets/bin")]) {
    const candidate = join(dir, exe("ffmpeg"));
    if (existsSync(candidate)) return (resolved = makeExecutable(candidate));
  }
  // Local development only. The module name is assembled at runtime on purpose: it keeps Vercel's file tracer from
  // bundling a SECOND 66 MB copy of FFmpeg (the deployed binary comes from assets/bin, copied by scripts/prepare-assets.mjs).
  if (!process.env.VERCEL) {
    try {
      const installer = require(["@ffmpeg-installer", "ffmpeg"].join("/")) as { path?: string };
      if (installer.path && existsSync(installer.path)) return (resolved = makeExecutable(installer.path));
    } catch { /* fall through to a system binary */ }
  }
  return (resolved = "ffmpeg");
}
