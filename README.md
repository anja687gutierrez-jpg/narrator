# Narrator

AI-powered video narration tool. Drop in a screen recording, get back a professional voiceover — script, audio, and final video export included.

![Narrator App](Video%20Narrator%201.png)

## What it does

1. **AI Script Generation** — Gemini 2.5 Flash watches your video frame-by-frame and writes timestamped narration
2. **Built-in TTS** — 6 Microsoft Edge voices, no API key required
3. **Clip Splitting** — Export individual clips per segment with embedded audio
4. **Transitions** — Fade, dissolve, wipe, and slide between clips
5. **Subtitle Burning** — Bake SRT subtitles directly into the final video
6. **One-Click Export** — Full pipeline: cut → voice → merge → transitions → subtitles → MP4

![Timeline Editor](Video%20Narrator%202.png)

## Prerequisites

- **Node.js** 18+
- **ffmpeg** (with ffprobe)
  ```bash
  # macOS
  brew install ffmpeg

  # Ubuntu/Debian
  sudo apt install ffmpeg

  # Windows (via chocolatey)
  choco install ffmpeg
  ```

## Setup

```bash
git clone https://github.com/anja687gutierrez-jpg/narrator.git
cd narrator
npm install
cp .env.example .env
```

Open `.env` and add your Gemini API key (free tier works):
```
GEMINI_API_KEY=your_key_here
```

Get one at https://aistudio.google.com/apikey

```bash
npm run dev
```

Open http://localhost:3000

## Usage

1. Drop in your video (MP4, MOV, WebM, AVI, MKV — up to 2 GB)
2. Add context about what's on screen (improves script quality significantly)
3. Choose segment density and pacing
4. Click **Generate Narration**
5. Edit the script inline if needed
6. **Generate Audio** for standalone MP3, **Split into Clips** for per-segment videos, or **Export Final** for a complete narrated video

![Export Pipeline](Video%20Narrator%203.png)

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `GEMINI_API_KEY` | — | Required. Get from aistudio.google.com |
| `APP_PASSWORD` | — | Optional. Adds password protection |
| `PORT` | 3000 | Server port |
| `FRAME_INTERVAL` | 5 | Seconds between extracted frames |
| `BATCH_SIZE` | 12 | Frames per Gemini API call |

## How it works

```
Video → ffmpeg frame extraction → Gemini 2.5 Flash (batched analysis)
     → timestamped narration script → Edge TTS → audio segments
     → ffmpeg merge (video + audio + transitions + subtitles) → final MP4
```

The server uses Server-Sent Events (SSE) for real-time progress during generation. All processing happens locally — your video never leaves your machine (only extracted frames are sent to Gemini).

## Cost

Gemini 2.5 Flash is fast and cheap. A 5-minute video costs roughly $0.01–0.05 on the paid tier. The free tier (20 requests/day) handles light use.

## Tech Stack

- **Backend:** Express + TypeScript + Gemini API + node-edge-tts
- **Frontend:** React 19 + Tailwind CSS + Motion (Framer)
- **Video:** ffmpeg for all extraction, merging, and encoding
- **Build:** Vite + esbuild

## Scripts

```bash
npm run dev      # Development server with hot reload
npm run build    # Production build
npm run start    # Run production server
npm run clean    # Remove dist/ and uploads/
npm run lint     # TypeScript type checking
```

## License

MIT
