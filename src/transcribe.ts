import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";

const execFileAsync = promisify(execFile);

export async function extractAndTranscribe(
  videoPath: string,
  opts: {
    openaiApiKey: string;
    ffmpegPath?: string;
    exec?: typeof execFileAsync;
    outDir?: string;
    readAudioFile?: typeof readFile;
    fetchFn?: typeof fetch;
  }
): Promise<string | null> {
  const ffmpegPath = opts.ffmpegPath ?? "ffmpeg";
  const exec = opts.exec ?? execFileAsync;
  const outDir = opts.outDir ?? "/tmp";
  const readAudioFile = opts.readAudioFile ?? readFile;
  const fetchFn = opts.fetchFn ?? fetch;
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

  const audioBuffer = await readAudioFile(audioPath);

  // The OpenAI SDK's bundled HTTP transport (node-fetch) has repeatedly
  // failed with ECONNRESET in Vercel's serverless runtime — before the
  // request ever reaches OpenAI's servers (their dashboard shows zero
  // requests during these failures). Calling the REST endpoint directly
  // with Node's native fetch/FormData avoids that transport entirely.
  const maxAttempts = 3;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const formData = new FormData();
      formData.append("file", new Blob([audioBuffer], { type: "audio/mpeg" }), "audio.mp3");
      formData.append("model", "whisper-1");

      const response = await fetchFn("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${opts.openaiApiKey}` },
        body: formData,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Whisper API error: ${response.status} ${body}`);
      }

      const data = (await response.json()) as { text: string };
      return data.text;
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
  throw lastErr;
}
