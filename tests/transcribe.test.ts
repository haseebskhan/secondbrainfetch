import { describe, it, expect, vi } from "vitest";
import { extractAndTranscribe } from "../src/transcribe.js";

vi.mock("node:fs", () => ({
  createReadStream: vi.fn(() => ({} as any)),
}));

describe("extractAndTranscribe", () => {
  it("extracts audio with ffmpeg and returns the Whisper transcript", async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    const create = vi.fn().mockResolvedValue({ text: "hello from the reel" });
    const fakeOpenai = { audio: { transcriptions: { create } } } as any;

    const transcript = await extractAndTranscribe("/tmp/out/reel.mp4", {
      openai: fakeOpenai,
      ffmpegPath: "/bin/ffmpeg",
      exec: exec as any,
      outDir: "/tmp/out",
    });

    expect(transcript).toBe("hello from the reel");
    expect(exec).toHaveBeenCalledWith("/bin/ffmpeg", [
      "-y",
      "-i",
      "/tmp/out/reel.mp4",
      "-vn",
      "-acodec",
      "libmp3lame",
      "/tmp/out/reel.mp3",
    ]);
    expect(create).toHaveBeenCalled();
  });

  it("returns null when ffmpeg reports no audio stream", async () => {
    const exec = vi.fn().mockRejectedValue(new Error("Stream map '0:a' matches no streams"));
    const fakeOpenai = { audio: { transcriptions: { create: vi.fn() } } } as any;

    const transcript = await extractAndTranscribe("/tmp/out/silent.mp4", {
      openai: fakeOpenai,
      ffmpegPath: "/bin/ffmpeg",
      exec: exec as any,
      outDir: "/tmp/out",
    });

    expect(transcript).toBeNull();
  });

  it("propagates other ffmpeg errors", async () => {
    const exec = vi.fn().mockRejectedValue(new Error("disk full"));
    const fakeOpenai = { audio: { transcriptions: { create: vi.fn() } } } as any;

    await expect(
      extractAndTranscribe("/tmp/out/reel.mp4", {
        openai: fakeOpenai,
        ffmpegPath: "/bin/ffmpeg",
        exec: exec as any,
        outDir: "/tmp/out",
      })
    ).rejects.toThrow(/disk full/);
  });
});
