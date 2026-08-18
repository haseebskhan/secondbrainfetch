import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import type { DownloadResult } from "./types.js";

const execFileAsync = promisify(execFile);

const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm", "mkv"]);

export async function downloadMedia(
  url: string,
  opts: {
    ytDlpPath?: string;
    outDir?: string;
    exec?: typeof execFileAsync;
  } = {}
): Promise<DownloadResult> {
  const ytDlpPath =
    opts.ytDlpPath ||
    process.env.YT_DLP_PATH ||
    path.join(process.cwd(), "bin/yt-dlp");
  const outDir = opts.outDir ?? "/tmp";
  const exec = opts.exec ?? execFileAsync;

  let stdout: string;
  try {
    const result = await exec(ytDlpPath, [
      "--no-playlist",
      "--print",
      "after_move:filepath",
      "-o",
      `${outDir}/%(id)s.%(ext)s`,
      "--",
      url,
    ]);
    stdout = result.stdout;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to download media from ${url}: ${message}`);
  }

  const filePath = stdout.trim().split("\n").pop() ?? "";
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return { filePath, isVideo: VIDEO_EXTENSIONS.has(ext) };
}
