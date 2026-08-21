/**
 * One-time backfill: computes and writes an Embedding property on every
 * existing Second Brain page that doesn't have one yet, so semantic
 * related-notes matching (src/relatedNotes.ts) has something to compare
 * against for pages saved before that feature existed.
 *
 * Not part of the pipeline or the test suite — run manually, once, via:
 *   NOTION_TOKEN=... NOTION_DATABASE_ID=... OPENAI_API_KEY=... npx tsx scripts/backfill-embeddings.ts
 */
import { Client } from "@notionhq/client";
import { generateEmbedding, encodeEmbedding } from "../src/embeddings.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

/**
 * The embedding needs the same kind of text the pipeline embeds at save
 * time (title + summary), but the summary only exists as a callout block
 * in the page body, not a property. Falls back to just the title for pages
 * with no summary callout (e.g. very old or degraded-write pages).
 */
async function extractEmbeddingText(client: Client, pageId: string, title: string): Promise<string> {
  const blocks = await client.blocks.children.list({ block_id: pageId, page_size: 5 });
  const calloutBlock = blocks.results.find((b: any) => b.type === "callout") as any;
  const summary = calloutBlock?.callout?.rich_text?.map((rt: any) => rt.plain_text).join("") ?? "";
  return summary ? `${title}\n${summary}` : title;
}

async function main() {
  const notionToken = requireEnv("NOTION_TOKEN");
  const databaseId = requireEnv("NOTION_DATABASE_ID");
  const openaiApiKey = requireEnv("OPENAI_API_KEY");

  const client = new Client({ auth: notionToken });

  let cursor: string | undefined;
  let updated = 0;
  let skipped = 0;

  do {
    const response = await client.databases.query({
      database_id: databaseId,
      filter: { property: "Embedding", rich_text: { is_empty: true } },
      start_cursor: cursor,
      page_size: 20,
    });

    for (const page of response.results as any[]) {
      const title = page.properties?.Title?.title?.[0]?.plain_text;
      if (!title) {
        skipped++;
        continue;
      }

      try {
        const text = await extractEmbeddingText(client, page.id, title);
        const vector = await generateEmbedding(text, { openaiApiKey });
        await client.pages.update({
          page_id: page.id,
          properties: { Embedding: { rich_text: [{ text: { content: encodeEmbedding(vector) } }] } },
        });
        updated++;
        console.log(`Embedded: ${title}`);
      } catch (err) {
        skipped++;
        console.error(`Failed to embed "${title}":`, err);
      }
    }

    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);

  console.log(`Done. Updated ${updated} page(s), skipped ${skipped}.`);
}

main();
