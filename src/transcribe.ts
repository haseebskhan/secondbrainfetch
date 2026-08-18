import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { toFile } from "openai/uploads";
import type OpenAI from "openai";

const execFileAsync = promisify(execFile);

export async function extractAndTranscribe(
  videoPath: string,
  opts: {
    openai: OpenAI;
    ffmpegPath?: string;
    exec?: typeof execFileAsync;
    outDir?: string;
    readAudioFile?: typeof readFile;
  }
): Promise<string | null> {
  const ffmpegPath = opts.ffmpegPath ?? "ffmpeg";
  const exec = opts.exec ?? execFileAsync;
  const outDir = opts.outDir ?? "/tmp";
  const readAudioFile = opts.readAudioFile ?? readFile;
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

  // Read the whole file into a buffer rather than streaming it — a
  // node:fs read stream piped into the OpenAI SDK's multipart upload has
  // repeatedly hit ECONNRESET in Vercel's serverless runtime, even on
  // retry; uploading a fully-buffered file avoids that failure mode.
  const audioBuffer = await readAudioFile(audioPath);
  const file = await toFile(audioBuffer, "audio.mp3");

  const maxAttempts = 3;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const transcription = await opts.openai.audio.transcriptions.create({
        file,
        model: "whisper-1",
      });
      return transcription.text;
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
  throw lastErr;
}
