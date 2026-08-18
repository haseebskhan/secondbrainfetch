import { describe, it, expect, vi } from "vitest";
import { extractAndTranscribe } from "../src/transcribe.js";

function fakeReadAudioFile() {
  return vi.fn().mockResolvedValue(Buffer.from("fake-audio-bytes"));
}

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
      readAudioFile: fakeReadAudioFile(),
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
      readAudioFile: fakeReadAudioFile(),
    });

    expect(transcript).toBeNull();
  });

  it("retries on a transient Whisper API error before succeeding", async () => {
    vi.useFakeTimers();
    const exec = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    const create = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce({ text: "recovered transcript" });
    const fakeOpenai = { audio: { transcriptions: { create } } } as any;

    const promise = extractAndTranscribe("/tmp/out/reel.mp4", {
      openai: fakeOpenai,
      ffmpegPath: "/bin/ffmpeg",
      exec: exec as any,
      outDir: "/tmp/out",
      readAudioFile: fakeReadAudioFile(),
    });
    await vi.runAllTimersAsync();
    const transcript = await promise;

    expect(transcript).toBe("recovered transcript");
    expect(create).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("throws after exhausting retries on persistent Whisper API errors", async () => {
    vi.useFakeTimers();
    const exec = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    const create = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const fakeOpenai = { audio: { transcriptions: { create } } } as any;

    const assertion = expect(
      extractAndTranscribe("/tmp/out/reel.mp4", {
        openai: fakeOpenai,
        ffmpegPath: "/bin/ffmpeg",
        exec: exec as any,
        outDir: "/tmp/out",
        readAudioFile: fakeReadAudioFile(),
      })
    ).rejects.toThrow(/ECONNRESET/);
    await Promise.all([assertion, vi.runAllTimersAsync()]);

    expect(create).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
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
        readAudioFile: fakeReadAudioFile(),
      })
    ).rejects.toThrow(/disk full/);
  });
});
