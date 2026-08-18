import { describe, it, expect, vi } from "vitest";
import { downloadMedia } from "../src/download.js";

describe("downloadMedia", () => {
  it("returns the printed file path and marks video files as video", async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: "/tmp/out/reel.mp4\n", stderr: "" });

    const result = await downloadMedia("https://www.instagram.com/reel/abc123/", {
      ytDlpPath: "/bin/yt-dlp",
      outDir: "/tmp/out",
      exec: exec as any,
    });

    expect(result).toEqual({ filePath: "/tmp/out/reel.mp4", isVideo: true });
    expect(exec).toHaveBeenCalledWith("/bin/yt-dlp", [
      "--no-playlist",
      "--print",
      "after_move:filepath",
      "-o",
      "/tmp/out/%(id)s.%(ext)s",
      "https://www.instagram.com/reel/abc123/",
    ]);
  });

  it("marks image files as non-video", async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: "/tmp/out/post.jpg\n", stderr: "" });

    const result = await downloadMedia("https://www.instagram.com/p/xyz789/", {
      ytDlpPath: "/bin/yt-dlp",
      outDir: "/tmp/out",
      exec: exec as any,
    });

    expect(result).toEqual({ filePath: "/tmp/out/post.jpg", isVideo: false });
  });

  it("throws a descriptive error when yt-dlp fails", async () => {
    const exec = vi.fn().mockRejectedValue(new Error("exit code 1: unable to extract"));

    await expect(
      downloadMedia("https://www.instagram.com/reel/bad/", {
        ytDlpPath: "/bin/yt-dlp",
        outDir: "/tmp/out",
        exec: exec as any,
      })
    ).rejects.toThrow(/Failed to download media/);
  });
});
