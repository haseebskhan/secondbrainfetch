import { describe, it, expect, vi } from "vitest";
import { findExistingPageBySourceUrl } from "../src/duplicates.js";

describe("findExistingPageBySourceUrl", () => {
  it("returns true when a page with this Source URL already exists", async () => {
    const query = vi.fn().mockResolvedValue({ results: [{ id: "page-1" }] });
    const fakeClient = { databases: { query } } as any;

    const found = await findExistingPageBySourceUrl(
      fakeClient,
      "db-1",
      "https://www.instagram.com/reel/abc/"
    );

    expect(found).toBe(true);
    expect(query).toHaveBeenCalledWith({
      database_id: "db-1",
      filter: { property: "Source URL", url: { equals: "https://www.instagram.com/reel/abc/" } },
      page_size: 1,
    });
  });

  it("returns false when no matching page exists", async () => {
    const query = vi.fn().mockResolvedValue({ results: [] });
    const fakeClient = { databases: { query } } as any;

    const found = await findExistingPageBySourceUrl(
      fakeClient,
      "db-1",
      "https://www.instagram.com/reel/new/"
    );

    expect(found).toBe(false);
  });
});
