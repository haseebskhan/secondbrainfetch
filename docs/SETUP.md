# Setup Guide

## 1. Notion integration token

1. Go to https://www.notion.so/my-integrations and create a new internal integration.
2. Copy its "Internal Integration Token" — this is `NOTION_TOKEN`.
3. Share the "Second Brain — Saved Reels" database (created in Task 11) with this integration: open the database in Notion, click "..." → "Connections" → add the integration.

## 2. Deploy to Vercel

1. Push this repo to GitHub.
2. In the Vercel dashboard, import the repo as a new project.
3. Under Project Settings → Environment Variables, add:
   - `WEBHOOK_SECRET` — generate one with `openssl rand -hex 32`
   - `OPENAI_API_KEY`
   - `ANTHROPIC_API_KEY`
   - `NOTION_TOKEN`
   - `NOTION_DATABASE_ID`
4. Under Project Settings → Functions, enable **Fluid Compute** (required for `waitUntil` to keep running after the response is sent).
5. Deploy. Note the deployed URL, e.g. `https://your-project.vercel.app`.
6. Your webhook endpoint is `https://your-project.vercel.app/api/ingest`.

## 3. Create the iOS Shortcut

1. Open the Shortcuts app → "+" to create a new shortcut.
2. Add action **"Get Contents of URL"**:
   - URL: `https://your-project.vercel.app/api/ingest`
   - Method: `POST`
   - Headers: `x-webhook-secret` = (the `WEBHOOK_SECRET` value from step 2.3)
   - Request Body: JSON, with key `url` set to **Shortcut Input**
3. Add action **"Show Notification"** with text "Saved!" after the URL action (the shortcut does not need to wait for the webhook body — a 202 response returns almost immediately).
4. In the shortcut's settings (the "i" icon), enable **"Show in Share Sheet"** and restrict input types to **URLs**.
5. Name it (e.g. "Save to Second Brain").

## 4. Test it

From Instagram, open any reel or post → Share → find your shortcut in the share sheet → tap it. You should see a "Saved!" notification within a couple of seconds, and a new page should appear in the Notion database within about a minute.
