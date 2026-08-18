const URL_PATTERN = /https?:\/\/[^\s)]+/gi;
const MAX_TEXT_LENGTH = 6000;

/**
 * Finds the first non-Instagram URL in a caption — typically a recipe blog
 * or personal site linked from the post text.
 */
export function extractExternalUrl(caption: string): string | null {
  const matches = caption.match(URL_PATTERN);
  if (!matches) return null;

  for (const raw of matches) {
    const cleaned = raw.replace(/[.,;:!?)]+$/, "");
    try {
      const url = new URL(cleaned);
      if (!url.hostname.includes("instagram.com")) {
        return cleaned;
      }
    } catch {
      // not a valid URL, skip
    }
  }
  return null;
}

/**
 * Fetches a webpage and returns a crude plain-text extraction of its body
 * content, truncated to a token-friendly length. Not a real HTML parser —
 * good enough to hand a recipe page's content to Claude as context.
 */
export async function fetchWebpageText(
  url: string,
  opts: { fetchFn?: typeof fetch } = {}
): Promise<string> {
  const fetchFn = opts.fetchFn ?? fetch;

  const response = await fetchFn(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; SecondBrainBot/1.0)" },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  const html = await response.text();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return text.slice(0, MAX_TEXT_LENGTH);
}
