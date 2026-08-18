import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createReadStream } from "node:fs";
import type OpenAI from "openai";

const execFileAsync = promisify(execFile);

export async function extractAndTranscribe(
  videoPath: string,
  opts: {
    openai: OpenAI;
    ffmpegPath?: string;
    exec?: typeof execFileAsync;
    outDir?: string;
  }
): Promise<string | null> {
  const ffmpegPath = opts.ffmpegPath ?? "ffmpeg";
  const exec = opts.exec ?? execFileAsync;
  const outDir = opts.outDir ?? "/tmp";
  const audioPath = `${outDir}/${videoPath.split("/").pop()?.split(".")[0]}.mp3`;

  try {
    await exec(ffmpegPath, ["-y", "-i", videoPath, "-vn", "-acodec", "libmp3lame", audioPath]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("matches no streams")) {
      return null;
    }
    throw err;
  }

  const transcription = await opts.openai.audio.transcriptions.create({
    file: createReadStream(audioPath) as any,
    model: "whisper-1",
  });
  return transcription.text;
}
