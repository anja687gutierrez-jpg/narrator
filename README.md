# Video Narrator

A local web app that watches your screen recording with Gemini 2.5 Pro and produces a timed narration script — ready to paste into ElevenLabs (or any TTS), then layer over the video in CapCut / Descript / Premiere.

Drop in any MP4, MOV, or WebM (up to 2 GB), give Gemini a sentence of context about what the software is, and you get back a storyboard table with timestamps, on-screen action, and voiceover-ready narration. Export as Markdown or JSON.

## Setup (one time)

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Add your Gemini API key**
   Grab one (free tier is plenty) at https://aistudio.google.com/apikey
   ```bash
   cp .env.example .env
   ```
   Open `.env` and replace `MY_GEMINI_API_KEY` with your actual key.

3. **Run it**
   ```bash
   npm run dev
   ```
   Open http://localhost:3000

## How to use

1. Drop in your screen recording
2. (Recommended) Paste a sentence of context — e.g. *"STAP Operations Portal — internal tool for transit advertising ops. Audience: ops managers reviewing the receivables workflow."* This dramatically improves the script quality versus letting Gemini guess.
3. Choose segment density (8s = dense, 12s = balanced, 20s = sparse) and pacing (WPM)
4. Click **Generate Narration**. Upload takes ~30s, generation takes 30s–2min depending on video length.
5. **Copy Narration** → paste into ElevenLabs. Or **Markdown** for the full storyboard.

## Workflow (full pipeline)

1. Record screen → 2. Generate script here → 3. Paste narration into ElevenLabs → 4. Download MP3 → 5. Drop into CapCut / Descript, sync to video, export.

## Configuration knobs

- **Model:** `MODEL` constant in `server.ts`. Default is `gemini-2.5-pro`. Swap to `gemini-2.5-flash` for ~5× speed and lower cost, at the expense of some script quality.
- **Max video size:** `multer` limit in `server.ts` (default 2 GB)
- **Polling timeout:** 5 minutes in `server.ts` — long enough for ~1 hr videos

## Files

- `server.ts` — Express server: upload to Gemini Files API, poll, generate
- `src/App.tsx` — React UI
- `uploads/` — temp dir for local video copies, auto-cleaned after upload to Gemini

## Costs

Gemini 2.5 Pro charges per video-second processed plus output tokens. A 5-minute screen recording with a ~600-word script runs roughly $0.05–0.15 on the paid tier. The free tier covers light use.
