// api/ingest.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { waitUntil } from "@vercel/functions";
import { Client } from "@notionhq/client";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { isValidWebhookSecret } from "../src/auth.js";
import { runPipeline } from "../src/pipeline.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const secret = req.headers["x-webhook-secret"];
  if (!isValidWebhookSecret(Array.isArray(secret) ? secret[0] : secret, process.env.WEBHOOK_SECRET ?? "")) {
    res.status(401).json({ error: "Invalid webhook secret" });
    return;
  }

  const url = (req.body as { url?: string } | undefined)?.url;
  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "Missing or invalid 'url' field" });
    return;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    res.status(400).json({ error: "Missing or invalid 'url' field" });
    return;
  }
  if (parsedUrl.hostname !== "instagram.com" && !parsedUrl.hostname.endsWith(".instagram.com")) {
    res.status(400).json({ error: "Missing or invalid 'url' field" });
    return;
  }

  const notionClient = new Client({ auth: process.env.NOTION_TOKEN });
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const notionDatabaseId = process.env.NOTION_DATABASE_ID ?? "";

  waitUntil(
    runPipeline(url, { notionClient, notionDatabaseId, openai, anthropic }).catch((err) => {
      console.error("Pipeline failed unexpectedly:", err);
    })
  );

  res.status(202).json({ status: "accepted" });
}
