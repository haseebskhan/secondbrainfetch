import type Anthropic from "@anthropic-ai/sdk";

export async function buildZettelkastenNotes(
  input: { transcript: string; sourceUrl: string; reelTitle: string; uploader: string },
  opts: { anthropic: Anthropic }
): Promise<string> {
  const prompt = [
    `Reel source URL: ${input.sourceUrl}`,
    `Creator/uploader: ${input.uploader || "unknown"}`,
    `Reel title/caption (from Instagram): ${input.reelTitle || "not available"}`,
    ``,
    `Transcript of the reel's audio:`,
    input.transcript,
    ``,
    `You are helping me build a Zettelkasten style second brain from an Instagram reel I've transcribed. Follow the classic Zettelkasten rules from Niklas Luhmann and Sönke Ahrens: one idea per note, written entirely in my own words, and each note has to stand on its own without needing the original reel for context.`,
    ``,
    `Do this in order:`,
    ``,
    `1. LITERATURE NOTE`,
    `Write a short note about the reel itself, not the ideas yet.`,
    `- Source and creator`,
    `- One sentence on what the reel claims or teaches`,
    `- Two or three sentences on the actual content, in my own words`,
    `- One line: does this feel genuinely new, or is it a repeat of something already common knowledge to me`,
    ``,
    `2. FILTER THE IDEAS`,
    `Go through the transcript and pull out every distinct, self-contained idea or claim. If two sentences make the same point, that's one idea, not two. Before turning anything into a permanent note, ask: is this actually new to me, or just the same thing phrased differently? List the ideas that get filtered out here and say why.`,
    ``,
    `3. PERMANENT NOTES`,
    `For every idea that passes the filter, write one note with:`,
    `- Title: a full sentence stating the idea as a claim, not a topic label. Example: "Willpower depletes with each decision, not with effort" instead of "Willpower"`,
    `- Body: the idea in my own words, three to five sentences, no jargon carried over from the reel`,
    `- Why this matters to me: one or two sentences tying it to something specific I'm working on or dealing with right now, not a generic statement`,
    `- Possible links: name two or three ideas or notes likely already in my second brain that this connects to, and say exactly what the connection is`,
    `- Open question: one thing this idea raises that I don't have an answer to yet`,
    ``,
    `4. ONE APPLICATION`,
    `Give me one specific, concrete thing I could do this week based on one of these ideas. Not a list. Say exactly what I'd do, where, and when, not "apply this to your life."`,
    ``,
    `Format your response as plain markdown text (not JSON). Use exactly these section headers, each alone on its own line: "### 1. Literature Note", "### 2. Filter The Ideas", "### 3. Permanent Notes", "### 4. One Application". Inside Permanent Notes, write each note starting with a line "Title: <the claim>", then on their own lines "Body: ...", "Why this matters: ...", "Possible links: ...", "Open question: ...", with a blank line between separate notes.`,
  ].join("\n");

  const response = await opts.anthropic.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude response did not contain a text block");
  }
  return textBlock.text.trim();
}
