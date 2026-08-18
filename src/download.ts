import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import type { DownloadResult, ReelMetadata } from "./types.js";

const execFileAsync = promisify(execFile);

const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm", "mkv"]);

function resolveYtDlpPath(ytDlpPath?: string): string {
  return ytDlpPath || process.env.YT_DLP_PATH || path.join(process.cwd(), "bin/yt-dlp");
}

export async function downloadMedia(
  url: string,
  opts: {
    ytDlpPath?: string;
    outDir?: string;
    exec?: typeof execFileAsync;
  } = {}
): Promise<DownloadResult> {
  const ytDlpPath = resolveYtDlpPath(opts.ytDlpPath);
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

/**
 * Fetches the post's title, caption/description, and uploader without
 * downloading the media itself, via yt-dlp's single-line JSON metadata dump.
 */
export async function fetchMetadata(
  url: string,
  opts: {
    ytDlpPath?: string;
    exec?: typeof execFileAsync;
  } = {}
): Promise<ReelMetadata> {
  const ytDlpPath = resolveYtDlpPath(opts.ytDlpPath);
  const exec = opts.exec ?? execFileAsync;

  let stdout: string;
  try {
    const result = await exec(ytDlpPath, ["--no-playlist", "--skip-download", "-j", "--", url]);
    stdout = result.stdout;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to fetch metadata for ${url}: ${message}`);
  }

  const firstLine = stdout.trim().split("\n")[0] ?? "{}";
  const data = JSON.parse(firstLine);
  return {
    title: typeof data.title === "string" ? data.title : "",
    description: typeof data.description === "string" ? data.description : "",
    uploader: typeof data.uploader === "string" ? data.uploader : "",
  };
}
