import { describe, it, expect, vi } from "vitest";
import { extractFrames } from "../src/vision.js";

describe("extractFrames", () => {
  it("runs ffmpeg to extract N frames and reads them back as buffers", async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    const readFile = vi.fn().mockResolvedValue(Buffer.from("fake-jpg-bytes"));

    const frames = await extractFrames("/tmp/out/reel.mp4", {
      ffmpegPath: "/bin/ffmpeg",
      exec: exec as any,
      outDir: "/tmp/out",
      readFile: readFile as any,
      count: 3,
    });

    expect(exec).toHaveBeenCalledWith("/bin/ffmpeg", [
      "-y",
      "-i",
      "/tmp/out/reel.mp4",
      "-vf",
      "fps=1/2",
      "-frames:v",
      "3",
      "/tmp/out/frame-%02d.jpg",
    ]);
    expect(readFile).toHaveBeenCalledTimes(3);
    expect(readFile).toHaveBeenCalledWith("/tmp/out/frame-01.jpg");
    expect(readFile).toHaveBeenCalledWith("/tmp/out/frame-02.jpg");
    expect(readFile).toHaveBeenCalledWith("/tmp/out/frame-03.jpg");
    expect(frames).toHaveLength(3);
    expect(frames[0]).toBeInstanceOf(Buffer);
  });

  it("defaults to 3 frames when count is not given", async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    const readFile = vi.fn().mockResolvedValue(Buffer.from("x"));

    const frames = await extractFrames("/tmp/out/reel.mp4", {
      ffmpegPath: "/bin/ffmpeg",
      exec: exec as any,
      outDir: "/tmp/out",
      readFile: readFile as any,
    });

    expect(frames).toHaveLength(3);
  });
});
