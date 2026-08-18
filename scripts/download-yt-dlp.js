import { mkdirSync, writeFileSync, chmodSync, existsSync } from "node:fs";

const BIN_DIR = "bin";
const BIN_PATH = `${BIN_DIR}/yt-dlp`;
const URL = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux";

async function main() {
  if (existsSync(BIN_PATH)) return;
  mkdirSync(BIN_DIR, { recursive: true });
  const res = await fetch(URL);
  if (!res.ok) {
    throw new Error(`Failed to download yt-dlp: ${res.status} ${res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(BIN_PATH, buf);
  chmodSync(BIN_PATH, 0o755);
}

main();
