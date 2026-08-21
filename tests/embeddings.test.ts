import { describe, it, expect, vi } from "vitest";
import { generateEmbedding, cosineSimilarity, encodeEmbedding, decodeEmbedding } from "../src/embeddings.js";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  } as unknown as Response;
}

describe("generateEmbedding", () => {
  it("posts to the OpenAI embeddings endpoint and returns the vector", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ data: [{ embedding: [0.1, 0.2, 0.3] }] }));

    const vector = await generateEmbedding("a title\na summary", {
      openaiApiKey: "sk-test",
      fetchFn: fetchFn as any,
    });

    expect(vector).toEqual([0.1, 0.2, 0.3]);
    expect(fetchFn).toHaveBeenCalledWith(
      "https://api.openai.com/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer sk-test" }),
      })
    );
  });

  it("throws with the response body on a non-2xx response", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ error: "bad request" }, false, 400));

    await expect(
      generateEmbedding("text", { openaiApiKey: "sk-test", fetchFn: fetchFn as any })
    ).rejects.toThrow(/Embeddings API error: 400/);
  });
});

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("returns -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });
});

describe("encodeEmbedding / decodeEmbedding", () => {
  it("round-trips a vector through the encoded string, rounded to 4 decimals", () => {
    const encoded = encodeEmbedding([0.123456, -0.987654]);
    expect(decodeEmbedding(encoded)).toEqual([0.1235, -0.9877]);
  });

  it("returns null for undefined or malformed input", () => {
    expect(decodeEmbedding(undefined)).toBeNull();
    expect(decodeEmbedding("not json")).toBeNull();
    expect(decodeEmbedding("{}")).toBeNull();
  });
});
