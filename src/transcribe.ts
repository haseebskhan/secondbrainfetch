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

  // The OpenAI API occasionally drops the connection (ECONNRESET) on
  // otherwise-valid requests; retry once before giving up so a single
  // transient network blip doesn't cost us the whole transcript.
  const maxAttempts = 2;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const transcription = await opts.openai.audio.transcriptions.create({
        file: createReadStream(audioPath) as any,
        model: "whisper-1",
      });
      return transcription.text;
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }
  throw lastErr;
}
