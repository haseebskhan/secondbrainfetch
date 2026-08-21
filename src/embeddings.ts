/**
 * Requests a short (256-dim) OpenAI embedding for a page's title+summary,
 * used for semantic (idea-level) related-notes matching alongside the
 * existing tag/category overlap in relatedNotes.ts. Uses raw `fetch` rather
 * than the OpenAI SDK, matching transcribe.ts's approach to the same
 * Vercel sandbox transport issue.
 */
export async function generateEmbedding(
  text: string,
  opts: { openaiApiKey: string; fetchFn?: typeof fetch }
): Promise<number[]> {
  const fetchFn = opts.fetchFn ?? fetch;

  const response = await fetchFn("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: text,
      dimensions: 256,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Embeddings API error: ${response.status} ${body}`);
  }

  const data = (await response.json()) as { data: { embedding: number[] }[] };
  return data.data[0].embedding;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Notion's rich_text property caps at 2000 characters. Rounding to 4
 * decimal places keeps a 256-dim vector well under that limit while barely
 * affecting similarity math.
 */
export function encodeEmbedding(vector: number[]): string {
  return JSON.stringify(vector.map((v) => Math.round(v * 10000) / 10000));
}

export function decodeEmbedding(text: string | undefined): number[] | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
