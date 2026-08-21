// api/search.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Client } from "@notionhq/client";
import { isValidWebhookSecret } from "../src/auth.js";
import { searchArchiveByMeaning } from "../src/search.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const key = req.query.key;
  const keyValue = Array.isArray(key) ? key[0] : key;
  if (!isValidWebhookSecret(keyValue, process.env.SEARCH_SECRET ?? "")) {
    res.status(401).json({ error: "Invalid search key" });
    return;
  }

  const q = req.query.q;
  const query = Array.isArray(q) ? q[0] : q;
  if (!query) {
    res.status(400).json({ error: "Missing 'q' query param" });
    return;
  }

  try {
    const notionClient = new Client({ auth: process.env.NOTION_TOKEN });
    const results = await searchArchiveByMeaning(notionClient, process.env.NOTION_DATABASE_ID ?? "", query, {
      openaiApiKey: process.env.OPENAI_API_KEY ?? "",
    });
    res.status(200).json({ results });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Semantic search failed:", message);
    res.status(500).json({ error: "Search failed" });
  }
}
