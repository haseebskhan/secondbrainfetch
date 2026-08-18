import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile as readFileFn } from "node:fs/promises";

const execFileAsync = promisify(execFile);

export async function extractFrames(
  videoPath: string,
  opts: {
    ffmpegPath?: string;
    exec?: typeof execFileAsync;
    outDir?: string;
    readFile?: typeof readFileFn;
    count?: number;
  } = {}
): Promise<Buffer[]> {
  const ffmpegPath = opts.ffmpegPath ?? "ffmpeg";
  const exec = opts.exec ?? execFileAsync;
  const outDir = opts.outDir ?? "/tmp";
  const readFile = opts.readFile ?? readFileFn;
  const count = opts.count ?? 3;

  await exec(ffmpegPath, [
    "-y",
    "-i",
    videoPath,
    "-vf",
    "fps=1/2",
    "-frames:v",
    String(count),
    `${outDir}/frame-%02d.jpg`,
  ]);

  const frames: Buffer[] = [];
  for (let i = 1; i <= count; i++) {
    const num = String(i).padStart(2, "0");
    try {
      frames.push(await readFile(`${outDir}/frame-${num}.jpg`));
    } catch {
      // Fewer frames were produced than requested (e.g. a short video) —
      // stop here and return whatever was successfully extracted.
      break;
    }
  }
  return frames;
}
