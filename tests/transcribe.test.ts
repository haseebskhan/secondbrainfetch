import { describe, it, expect, vi } from "vitest";
import { extractAndTranscribe } from "../src/transcribe.js";

function fakeReadAudioFile() {
  return vi.fn().mockResolvedValue(Buffer.from("fake-audio-bytes"));
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  } as unknown as Response;
}

describe("extractAndTranscribe", () => {
  it("extracts audio with ffmpeg and returns the Whisper transcript via the REST endpoint", async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ text: "hello from the reel" }));

    const transcript = await extractAndTranscribe("/tmp/out/reel.mp4", {
      openaiApiKey: "sk-test",
      ffmpegPath: "/bin/ffmpeg",
      exec: exec as any,
      outDir: "/tmp/out",
      readAudioFile: fakeReadAudioFile(),
      fetchFn: fetchFn as any,
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
    expect(fetchFn).toHaveBeenCalledWith(
      "https://api.openai.com/v1/audio/transcriptions",
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer sk-test" },
      })
    );
  });

  it("returns null when ffmpeg reports no audio stream", async () => {
    const exec = vi.fn().mockRejectedValue(new Error("Stream map '0:a' matches no streams"));
    const fetchFn = vi.fn();

    const transcript = await extractAndTranscribe("/tmp/out/silent.mp4", {
      openaiApiKey: "sk-test",
      ffmpegPath: "/bin/ffmpeg",
      exec: exec as any,
      outDir: "/tmp/out",
      readAudioFile: fakeReadAudioFile(),
      fetchFn: fetchFn as any,
    });

    expect(transcript).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("retries on a transient network error before succeeding", async () => {
    vi.useFakeTimers();
    const exec = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(jsonResponse({ text: "recovered transcript" }));

    const promise = extractAndTranscribe("/tmp/out/reel.mp4", {
      openaiApiKey: "sk-test",
      ffmpegPath: "/bin/ffmpeg",
      exec: exec as any,
      outDir: "/tmp/out",
      readAudioFile: fakeReadAudioFile(),
      fetchFn: fetchFn as any,
    });
    await vi.runAllTimersAsync();
    const transcript = await promise;

    expect(transcript).toBe("recovered transcript");
    expect(fetchFn).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("retries on a non-2xx API response before giving up", async () => {
    vi.useFakeTimers();
    const exec = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ error: "server error" }, false, 500));

    const assertion = expect(
      extractAndTranscribe("/tmp/out/reel.mp4", {
        openaiApiKey: "sk-test",
        ffmpegPath: "/bin/ffmpeg",
        exec: exec as any,
        outDir: "/tmp/out",
        readAudioFile: fakeReadAudioFile(),
        fetchFn: fetchFn as any,
      })
    ).rejects.toThrow(/Whisper API error: 500/);
    await Promise.all([assertion, vi.runAllTimersAsync()]);

    expect(fetchFn).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("throws after exhausting retries on persistent network errors", async () => {
    vi.useFakeTimers();
    const exec = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    const fetchFn = vi.fn().mockRejectedValue(new Error("ECONNRESET"));

    const assertion = expect(
      extractAndTranscribe("/tmp/out/reel.mp4", {
        openaiApiKey: "sk-test",
        ffmpegPath: "/bin/ffmpeg",
        exec: exec as any,
        outDir: "/tmp/out",
        readAudioFile: fakeReadAudioFile(),
        fetchFn: fetchFn as any,
      })
    ).rejects.toThrow(/ECONNRESET/);
    await Promise.all([assertion, vi.runAllTimersAsync()]);

    expect(fetchFn).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("propagates other ffmpeg errors", async () => {
    const exec = vi.fn().mockRejectedValue(new Error("disk full"));
    const fetchFn = vi.fn();

    await expect(
      extractAndTranscribe("/tmp/out/reel.mp4", {
        openaiApiKey: "sk-test",
        ffmpegPath: "/bin/ffmpeg",
        exec: exec as any,
        outDir: "/tmp/out",
        readAudioFile: fakeReadAudioFile(),
        fetchFn: fetchFn as any,
      })
    ).rejects.toThrow(/disk full/);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
