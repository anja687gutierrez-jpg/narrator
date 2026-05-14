import express, { type Request, type Response } from "express";
import path from "path";
import fs from "fs";
import { execFileSync, execFile } from "child_process";
import multer from "multer";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { EdgeTTS } from "node-edge-tts";
import dotenv from "dotenv";

dotenv.config();

if (!process.env.GEMINI_API_KEY) {
  console.error("\n  Missing GEMINI_API_KEY. Copy .env.example to .env and paste your key from aistudio.google.com/apikey\n");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const UPLOAD_DIR = path.join(process.cwd(), "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const REGISTRY_PATH = path.join(UPLOAD_DIR, "registry.json");

interface Registry {
  videos: Record<string, string>;
  exports: Record<string, string>;
}

function loadRegistry(): Registry {
  try {
    if (fs.existsSync(REGISTRY_PATH)) {
      const data = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf-8"));
      const videos: Record<string, string> = {};
      for (const [id, p] of Object.entries(data.videos ?? {})) {
        if (typeof p === "string" && fs.existsSync(p)) videos[id] = p;
      }
      const exports: Record<string, string> = {};
      for (const [id, p] of Object.entries(data.exports ?? {})) {
        if (typeof p === "string" && fs.existsSync(p)) exports[id] = p;
      }
      return { videos, exports };
    }
  } catch {}
  return { videos: {}, exports: {} };
}

function saveRegistry(videos: Map<string, { path: string }>, exports: Map<string, string>): void {
  const data: Registry = {
    videos: Object.fromEntries([...videos].map(([k, v]) => [k, v.path])),
    exports: Object.fromEntries(exports),
  };
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(data, null, 2));
}

const ALLOWED_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".avi", ".mkv"]);

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXTENSIONS.has(ext)) cb(null, true);
    else cb(new Error("Unsupported video format. Use MP4, MOV, WebM, AVI, or MKV."));
  },
});

const MODEL = "gemini-2.5-flash";
const FRAME_INTERVAL = Number(process.env.FRAME_INTERVAL) || 5;
const BATCH_SIZE = Number(process.env.BATCH_SIZE) || 12;
const MAX_FRAMES = 360;

function getVideoDuration(filePath: string): number {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", filePath],
    { encoding: "utf-8" }
  );
  return parseFloat(out.trim());
}

function extractFrames(filePath: string, intervalSec: number): Promise<string[]> {
  const stamp = Date.now();
  const frameDir = path.join(UPLOAD_DIR, `frames-${stamp}`);
  fs.mkdirSync(frameDir, { recursive: true });
  const pattern = path.join(frameDir, `frame-%04d.jpg`);

  return new Promise((resolve, reject) => {
    execFile(
      "ffmpeg",
      ["-i", filePath, "-vf", `fps=1/${intervalSec}`, "-q:v", "3", "-f", "image2", pattern],
      { maxBuffer: 50 * 1024 * 1024, timeout: 300000 },
      (err) => {
        if (err) {
          fs.promises.rm(frameDir, { recursive: true, force: true }).catch(() => {});
          return reject(err);
        }
        const frames = fs.readdirSync(frameDir)
          .filter(f => f.startsWith("frame-") && f.endsWith(".jpg"))
          .sort()
          .map(f => path.join(frameDir, f));
        resolve(frames);
      }
    );
  });
}

function formatTimestamp(totalSeconds: number): string {
  const totalMin = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60).toString().padStart(2, "0");
  if (totalMin >= 60) {
    const h = Math.floor(totalMin / 60).toString().padStart(2, "0");
    const m = (totalMin % 60).toString().padStart(2, "0");
    return `${h}:${m}:${s}`;
  }
  return `${totalMin.toString().padStart(2, "0")}:${s}`;
}

function buildBatchPrompt(
  context: string, segmentSeconds: number, wpm: number, tone: string,
  frameTimestamps: string[], batchInfo: string
) {
  return `You are looking at sequential screenshots from a screen recording of a software application, taken every ${FRAME_INTERVAL} seconds. Write a tight, professional voiceover script based on what you see.

${context ? `CONTEXT FROM THE CREATOR:\n${context}\n` : "No context was provided — infer what the software does from the screen content."}
${batchInfo}

The screenshots correspond to these timestamps in the full video: ${frameTimestamps.join(", ")}

PRODUCE: One segment for each meaningful moment you observe across these frames, roughly every ${segmentSeconds} seconds. Group frames that show the same state into one segment. Do not invent actions you cannot see — describe what changed between frames.

For each segment:
- "timestamp": the timestamp from the list above when this segment starts
- "action": one short factual sentence describing what's on screen (what changed, what loaded, what was clicked)
- "narration": 1–2 sentences of voiceover. Describe what the user is doing AND why it matters to the viewer. Pace it for ~${wpm} words per minute when read aloud. Tone: ${tone}. Speak directly to the viewer ("you'll see…", "this lets you…"). No filler, no "in this video", no "let's take a look".

Also estimate the overall word count of your narration for this batch.

Return STRICT JSON, no markdown, no commentary, exactly this shape:
{
  "metadata": {
    "estimatedWordCount": <number>,
    "tone": "<string>",
    "softwareName": "<short name inferred or given>"
  },
  "segments": [
    { "timestamp": "MM:SS", "action": "<string>", "narration": "<string>" }
  ]
}`;
}

async function generateForBatch(
  framePaths: string[], context: string, segmentSeconds: number,
  wpm: number, tone: string,
  frameTimestamps: string[], batchInfo: string
) {
  const MAX_RETRIES = 3;

  const parts: Array<{ inlineData: { mimeType: string; data: string } } | { text: string }> = [];
  for (const fp of framePaths) {
    const data = fs.readFileSync(fp).toString("base64");
    parts.push({ inlineData: { mimeType: "image/jpeg", data } });
  }
  parts.push({ text: buildBatchPrompt(context, segmentSeconds, wpm, tone, frameTimestamps, batchInfo) });

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = globalThis.setTimeout(() => controller.abort(), 120000);
      const response = await ai.models.generateContent({
        model: MODEL,
        contents: [{ role: "user", parts: parts as any }],
        config: { responseMimeType: "application/json", temperature: 0.4, abortSignal: controller.signal },
      });
      clearTimeout(timeout);

      const raw = response.text ?? "";
      try {
        return JSON.parse(raw);
      } catch {
        return JSON.parse(raw.replace(/```json|```/g, "").trim());
      }
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      const isRateLimit = msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("quota");
      const delay = isRateLimit ? 15000 : 5000 * attempt;
      console.error(`Generate attempt ${attempt}/${MAX_RETRIES} failed (${isRateLimit ? "rate limit" : "error"}), retrying in ${delay / 1000}s:`, msg.slice(0, 200));
      if (attempt === MAX_RETRIES) throw err;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("Generation failed after all retries.");
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  const APP_PASSWORD = process.env.APP_PASSWORD;
  if (!APP_PASSWORD) {
    console.error("\n  Missing APP_PASSWORD in .env. All API routes will be locked.\n");
  }
  app.use("/api", (req: Request, res: Response, next) => {
    if (!APP_PASSWORD) { res.status(503).json({ error: "Server misconfigured." }); return; }
    const auth = req.headers.authorization;
    const queryToken = req.query.token as string | undefined;
    if (auth === `Bearer ${APP_PASSWORD}` || queryToken === APP_PASSWORD) {
      next();
      return;
    }
    res.status(401).json({ error: "Unauthorized" });
  });

  app.use(express.json({ limit: "1mb" }));

  const _reg = loadRegistry();
  const retainedVideos = new Map<string, { path: string }>(
    Object.entries(_reg.videos).map(([k, v]) => [k, { path: v }])
  );
  const retainedExports = new Map<string, string>(Object.entries(_reg.exports));
  console.log(`Registry loaded: ${retainedVideos.size} videos, ${retainedExports.size} exports`);

  function persistRegistry(): void {
    saveRegistry(retainedVideos, retainedExports);
  }

  function retainVideo(filePath: string): string {
    const videoId = `video-${Date.now()}`;
    retainedVideos.set(videoId, { path: filePath });
    persistRegistry();
    return videoId;
  }

  app.post("/api/upload-video", upload.single("video"), (req: Request, res: Response) => {
    if (!req.file) { res.status(400).json({ error: "No video file provided." }); return; }
    const ext = path.extname(req.file.originalname).toLowerCase() || ".mp4";
    if (!/^\.[a-z0-9]+$/i.test(ext)) { res.status(400).json({ error: "Invalid file extension." }); return; }
    const localPath = req.file.path + ext;
    fs.renameSync(req.file.path, localPath);
    try {
      const duration = getVideoDuration(localPath);
      const videoId = retainVideo(localPath);
      res.json({ videoId, duration: Math.round(duration) });
    } catch (err) {
      fs.promises.unlink(localPath).catch(() => {});
      res.status(500).json({ error: "Could not read video file." });
    }
  });

  app.post("/api/narrate", upload.single("video"), async (req: Request, res: Response) => {
    if (!req.file) { res.status(400).json({ error: "No video file provided." }); return; }

    const ext = path.extname(req.file.originalname).toLowerCase() || ".mp4";
    if (!/^\.[a-z0-9]+$/i.test(ext)) { res.status(400).json({ error: "Invalid file extension." }); return; }
    const localPath = req.file.path + ext;
    fs.renameSync(req.file.path, localPath);
    const context = req.body.context || "";
    const segmentSeconds = Number(req.body.segmentSeconds) || 12;
    const wpm = Number(req.body.wpm) || 150;
    const tone = req.body.tone || "confident, clear, no filler";
    let frameDir = "";

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    function sendEvent(data: object) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }

    try {
      const duration = getVideoDuration(localPath);
      const videoId = retainVideo(localPath);

      sendEvent({ type: "status", stage: "splitting", totalChunks: 0, duration });

      const framePaths = await extractFrames(localPath, FRAME_INTERVAL);
      if (framePaths.length) frameDir = path.dirname(framePaths[0]);
      if (!framePaths.length) throw new Error("No frames extracted — video may be too short.");
      if (framePaths.length > MAX_FRAMES) throw new Error(`Video too long: ${framePaths.length} frames exceeds the ${MAX_FRAMES}-frame limit (${MAX_FRAMES * FRAME_INTERVAL / 60} min max).`);

      const totalBatches = Math.ceil(framePaths.length / BATCH_SIZE);
      sendEvent({ type: "status", stage: "splitting", totalChunks: totalBatches, duration, frameCount: framePaths.length });

      const allSegments: Array<{ timestamp: string; action: string; narration: string }> = [];
      let softwareName = "";
      let detectedTone = "";
      let totalWords = 0;

      for (let b = 0; b < totalBatches; b++) {
        const batchFrames = framePaths.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);
        const batchStartFrame = b * BATCH_SIZE;

        const frameTimestamps = batchFrames.map((_, i) =>
          formatTimestamp((batchStartFrame + i) * FRAME_INTERVAL)
        );

        sendEvent({ type: "status", stage: "generating", chunk: b + 1, totalChunks: totalBatches });

        const batchInfo = totalBatches > 1
          ? `This is batch ${b + 1} of ${totalBatches} from a ${formatTimestamp(duration)} video. These frames cover ${frameTimestamps[0]} to ${frameTimestamps[frameTimestamps.length - 1]}.`
          : `This covers the full ${formatTimestamp(duration)} video.`;

        const result = await generateForBatch(
          batchFrames, context, segmentSeconds, wpm, tone,
          frameTimestamps, batchInfo
        );

        if (!softwareName && result.metadata?.softwareName) softwareName = result.metadata.softwareName;
        if (!detectedTone && result.metadata?.tone) detectedTone = result.metadata.tone;

        allSegments.push(...(result.segments || []));
        totalWords += result.metadata?.estimatedWordCount || 0;

        sendEvent({ type: "chunk_done", chunk: b + 1, totalChunks: totalBatches, segmentCount: (result.segments || []).length });
      }

      const merged = {
        metadata: {
          totalDurationSeconds: Math.round(duration),
          estimatedWordCount: totalWords,
          tone: detectedTone || tone,
          softwareName: softwareName || req.file!.originalname.replace(/\.[^.]+$/, ""),
        },
        segments: allSegments,
      };

      sendEvent({ type: "done", result: merged, videoId });
      res.end();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("Narrate error:", errMsg);
      const isRate = errMsg.includes("429") || errMsg.includes("RESOURCE_EXHAUSTED") || errMsg.includes("quota");
      const isAbort = errMsg.includes("abort");
      const userMsg = isRate ? "Gemini rate limit — try again in a minute, or use Load Video Only."
        : isAbort ? "Gemini request timed out — video may be too large for AI. Use Load Video Only instead."
        : `Processing failed: ${errMsg.slice(0, 120)}`;
      sendEvent({ type: "error", error: userMsg });
      res.end();
    } finally {
      if (frameDir) fs.promises.rm(frameDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  const TTS_VOICES = [
    { id: "en-US-AndrewMultilingualNeural", name: "Andrew (warm, natural)", gender: "male" },
    { id: "en-US-AriaNeural", name: "Aria (clear, professional)", gender: "female" },
    { id: "en-US-GuyNeural", name: "Guy (confident, narrator)", gender: "male" },
    { id: "en-US-JennyNeural", name: "Jenny (friendly, approachable)", gender: "female" },
    { id: "en-US-BrianMultilingualNeural", name: "Brian (polished, broadcast)", gender: "male" },
    { id: "en-US-EmmaMultilingualNeural", name: "Emma (engaging, warm)", gender: "female" },
  ];

  app.get("/api/tts/voices", (_req: Request, res: Response) => {
    res.json(TTS_VOICES);
  });

  app.post("/api/tts", async (req: Request, res: Response) => {
    const { segments, voice, rate } = req.body;
    if (!Array.isArray(segments) || !segments.length) {
      res.status(400).json({ error: "Missing segments." });
      return;
    }
    const totalChars = segments.reduce((n: number, s: string) => n + s.length, 0);
    if (totalChars > 100_000) {
      res.status(400).json({ error: "Text too long (100K char limit)." });
      return;
    }

    const voiceId = typeof voice === "string" && TTS_VOICES.some(v => v.id === voice)
      ? voice
      : TTS_VOICES[0].id;

    const rateStr = typeof rate === "string" && /^[+-]?\d{1,3}%$/.test(rate)
      ? rate
      : "default";

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    function sendEvent(data: object) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }

    const stamp = Date.now();
    const ttsDir = path.join(UPLOAD_DIR, `tts-${stamp}`);
    fs.mkdirSync(ttsDir, { recursive: true });
    const partFiles: string[] = [];

    try {
      sendEvent({ type: "tts_status", stage: "generating", segment: 0, total: segments.length });

      for (let i = 0; i < segments.length; i++) {
        const partFile = path.join(ttsDir, `part-${String(i).padStart(4, "0")}.mp3`);
        const tts = new EdgeTTS({
          voice: voiceId,
          lang: "en-US",
          outputFormat: "audio-24khz-96kbitrate-mono-mp3",
          rate: rateStr,
        });
        await tts.ttsPromise(segments[i], partFile);
        partFiles.push(partFile);
        sendEvent({ type: "tts_status", stage: "generating", segment: i + 1, total: segments.length });
      }

      sendEvent({ type: "tts_status", stage: "combining", segment: segments.length, total: segments.length });

      const finalFile = path.join(UPLOAD_DIR, `narration-${stamp}.mp3`);
      if (partFiles.length === 1) {
        fs.copyFileSync(partFiles[0], finalFile);
      } else {
        const listFile = path.join(ttsDir, "concat.txt");
        fs.writeFileSync(listFile, partFiles.map(f => `file '${f}'`).join("\n"));
        await new Promise<void>((resolve, reject) => {
          execFile("ffmpeg", ["-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", finalFile],
            { maxBuffer: 10 * 1024 * 1024, timeout: 300000 },
            (err) => err ? reject(err) : resolve()
          );
        });
      }

      const segDir = path.join(UPLOAD_DIR, `tts-segments-${stamp}`);
      fs.mkdirSync(segDir, { recursive: true });
      for (let i = 0; i < partFiles.length; i++) {
        fs.renameSync(partFiles[i], path.join(segDir, `${i}.mp3`));
      }

      const fileId = `narration-${stamp}`;
      const segFileId = `tts-segments-${stamp}`;
      sendEvent({ type: "tts_done", fileId, segFileId, segmentCount: partFiles.length });
      res.end();
    } catch (err) {
      console.error("TTS error:", err);
      sendEvent({ type: "tts_error", error: "TTS generation failed." });
      res.end();
    } finally {
      const listFile = path.join(ttsDir, "concat.txt");
      if (fs.existsSync(listFile)) fs.promises.unlink(listFile).catch(() => {});
      fs.promises.rm(ttsDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  app.get("/api/video/:videoId", (req: Request, res: Response) => {
    const videoId = req.params.videoId;
    if (!/^video-\d+$/.test(videoId)) {
      res.status(400).json({ error: "Invalid video ID." });
      return;
    }
    const retained = retainedVideos.get(videoId);
    if (!retained || !fs.existsSync(retained.path)) {
      res.status(404).json({ error: "Video not found or expired." });
      return;
    }
    const filePath = retained.path;
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;
      const stream = fs.createReadStream(filePath, { start, end });
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize,
        "Content-Type": "video/mp4",
      });
      stream.pipe(res);
    } else {
      res.writeHead(200, {
        "Content-Length": fileSize,
        "Content-Type": "video/mp4",
        "Accept-Ranges": "bytes",
      });
      fs.createReadStream(filePath).pipe(res);
    }
  });

  app.get("/api/tts/download/:fileId", (req: Request, res: Response) => {
    const fileId = req.params.fileId;
    if (!/^narration-\d+$/.test(fileId)) {
      res.status(400).json({ error: "Invalid file ID." });
      return;
    }
    const filePath = path.join(UPLOAD_DIR, `${fileId}.mp3`);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: "File not found or expired." });
      return;
    }
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Disposition", `attachment; filename="${fileId}.mp3"`);
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });

  app.get("/api/tts/segment/:segFileId/:index", (req: Request, res: Response) => {
    const { segFileId, index } = req.params;
    if (!/^tts-segments-\d+$/.test(segFileId) || !/^\d+$/.test(index)) {
      res.status(400).json({ error: "Invalid segment ID." });
      return;
    }
    const filePath = path.join(UPLOAD_DIR, segFileId, `${index}.mp3`);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: "Segment audio not found or expired." });
      return;
    }
    res.setHeader("Content-Type", "audio/mpeg");
    fs.createReadStream(filePath).pipe(res);
  });

  function parseTimestamp(ts: string): number {
    const parts = ts.split(":").map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return 0;
  }

  app.post("/api/clips", async (req: Request, res: Response) => {
    const { videoId, segments, voice, rate } = req.body;
    if (!videoId || !Array.isArray(segments) || !segments.length) {
      res.status(400).json({ error: "Missing videoId or segments." });
      return;
    }

    const retained = retainedVideos.get(videoId);
    if (!retained || !fs.existsSync(retained.path)) {
      res.status(404).json({ error: "Video expired. Please re-upload." });
      return;
    }
    const videoPath = retained.path;
    const duration = getVideoDuration(videoPath);

    const voiceId = typeof voice === "string" && TTS_VOICES.some(v => v.id === voice)
      ? voice : TTS_VOICES[0].id;
    const rateStr = typeof rate === "string" && /^[+-]?\d{1,3}%$/.test(rate) ? rate : "default";

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    function sendEvent(data: object) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }

    const totalNarrationLen = segments.reduce((n: number, s: any) => n + (s.narration?.length || 0), 0);
    if (totalNarrationLen > 100000) {
      sendEvent({ type: "clips_error", error: "Narration text too long (100K char limit)." });
      res.end();
      return;
    }

    const stamp = Date.now();
    const clipsDir = path.join(UPLOAD_DIR, `clips-${stamp}`);
    fs.mkdirSync(clipsDir, { recursive: true });
    const clipFiles: string[] = [];

    try {
      const total = segments.length;
      sendEvent({ type: "clips_status", stage: "cutting", clip: 0, total });

      for (let i = 0; i < total; i++) {
        const seg = segments[i];
        const startSec = parseTimestamp(seg.timestamp);
        const endSec = i + 1 < total ? parseTimestamp(segments[i + 1].timestamp) : duration;
        const clipVideo = path.join(clipsDir, `clip-${String(i).padStart(3, "0")}-video.mp4`);
        const clipAudio = path.join(clipsDir, `clip-${String(i).padStart(3, "0")}-audio.mp3`);
        const clipFinal = path.join(clipsDir, `clip-${String(i).padStart(3, "0")}.mp4`);

        sendEvent({ type: "clips_status", stage: "cutting", clip: i + 1, total });

        await new Promise<void>((resolve, reject) => {
          execFile("ffmpeg", [
            "-ss", String(startSec), "-to", String(endSec),
            "-i", videoPath, "-c", "copy", "-an", clipVideo,
          ], { maxBuffer: 50 * 1024 * 1024, timeout: 300000 }, (err) => err ? reject(err) : resolve());
        });

        sendEvent({ type: "clips_status", stage: "voicing", clip: i + 1, total });

        const tts = new EdgeTTS({
          voice: voiceId,
          lang: "en-US",
          outputFormat: "audio-24khz-96kbitrate-mono-mp3",
          rate: rateStr,
        });
        await tts.ttsPromise(seg.narration, clipAudio);

        sendEvent({ type: "clips_status", stage: "merging", clip: i + 1, total });

        await new Promise<void>((resolve, reject) => {
          execFile("ffmpeg", [
            "-i", clipVideo, "-i", clipAudio,
            "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
            "-map", "0:v:0", "-map", "1:a:0", "-shortest", clipFinal,
          ], { maxBuffer: 50 * 1024 * 1024, timeout: 300000 }, (err) => err ? reject(err) : resolve());
        });

        clipFiles.push(clipFinal);
        fs.promises.unlink(clipVideo).catch(() => {});
        fs.promises.unlink(clipAudio).catch(() => {});

        sendEvent({ type: "clips_status", stage: "done_clip", clip: i + 1, total });
      }

      const clipIds = clipFiles.map((f, i) => {
        const id = `clip-${stamp}-${i}`;
        const dest = path.join(UPLOAD_DIR, `${id}.mp4`);
        fs.renameSync(f, dest);
        retainedExports.set(id, dest);
        return id;
      });
      persistRegistry();

      sendEvent({ type: "clips_done", clipIds });
      res.end();
    } catch (err) {
      console.error("Clips error:", err);
      sendEvent({ type: "clips_error", error: "Clip generation failed." });
      res.end();
    } finally {
      fs.promises.rm(clipsDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  function formatSrtTime(totalSec: number): string {
    const h = Math.floor(totalSec / 3600).toString().padStart(2, "0");
    const m = Math.floor((totalSec % 3600) / 60).toString().padStart(2, "0");
    const s = Math.floor(totalSec % 60).toString().padStart(2, "0");
    const ms = Math.round((totalSec % 1) * 1000).toString().padStart(3, "0");
    return `${h}:${m}:${s},${ms}`;
  }

  function buildSrt(
    segments: Array<{ timestamp: string; narration: string }>,
    duration: number
  ): string {
    return segments.map((seg, i) => {
      const startSec = parseTimestamp(seg.timestamp);
      const endSec = i + 1 < segments.length ? parseTimestamp(segments[i + 1].timestamp) : duration;
      return `${i + 1}\n${formatSrtTime(startSec)} --> ${formatSrtTime(endSec)}\n${seg.narration}\n`;
    }).join("\n");
  }

  app.post("/api/export/final", async (req: Request, res: Response) => {
    const { videoId, segments, voice, rate, subtitleStyle, transitions } = req.body;
    if (!videoId || !Array.isArray(segments) || !segments.length) {
      res.status(400).json({ error: "Missing videoId or segments." });
      return;
    }

    const totalNarrationLen = segments.reduce((n: number, s: any) => n + (s.narration?.length || 0), 0);
    if (totalNarrationLen > 100000) {
      res.status(400).json({ error: "Narration text too long (100K char limit)." });
      return;
    }

    const retained = retainedVideos.get(videoId);
    if (!retained || !fs.existsSync(retained.path)) {
      res.status(404).json({ error: "Video expired. Please re-upload." });
      return;
    }
    const videoPath = retained.path;
    const duration = getVideoDuration(videoPath);
    const voiceId = typeof voice === "string" && TTS_VOICES.some(v => v.id === voice) ? voice : TTS_VOICES[0].id;
    const rateStr = typeof rate === "string" && /^[+-]?\d{1,3}%$/.test(rate) ? rate : "default";

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    function sendEvent(data: object) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }

    const stamp = Date.now();
    const exportDir = path.join(UPLOAD_DIR, `export-${stamp}`);
    fs.mkdirSync(exportDir, { recursive: true });

    try {
      const total = segments.length;
      const mergedClips: string[] = [];

      for (let i = 0; i < total; i++) {
        const seg = segments[i];
        const startSec = parseTimestamp(seg.timestamp);
        const endSec = seg.endTimestamp ? parseTimestamp(seg.endTimestamp) :
          (i + 1 < total ? parseTimestamp(segments[i + 1].timestamp) : duration);
        const clipVideo = path.join(exportDir, `clip-${i}-video.mp4`);
        const clipAudio = path.join(exportDir, `clip-${i}-audio.mp3`);
        const clipMerged = path.join(exportDir, `clip-${i}-merged.mp4`);

        sendEvent({ type: "export_status", stage: "cutting", current: i + 1, total });

        await new Promise<void>((resolve, reject) => {
          execFile("ffmpeg", [
            "-ss", String(startSec), "-to", String(endSec),
            "-i", videoPath, "-c", "copy", "-an", clipVideo,
          ], { maxBuffer: 50 * 1024 * 1024, timeout: 300000 }, (err) => err ? reject(err) : resolve());
        });

        sendEvent({ type: "export_status", stage: "voicing", current: i + 1, total });

        if (seg.narration && seg.narration.trim()) {
          const tts = new EdgeTTS({ voice: voiceId, lang: "en-US", outputFormat: "audio-24khz-96kbitrate-mono-mp3", rate: rateStr });
          await tts.ttsPromise(seg.narration, clipAudio);

          sendEvent({ type: "export_status", stage: "merging", current: i + 1, total });

          await new Promise<void>((resolve, reject) => {
            execFile("ffmpeg", [
              "-i", clipVideo, "-i", clipAudio,
              "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
              "-map", "0:v:0", "-map", "1:a:0", "-shortest", clipMerged,
            ], { maxBuffer: 50 * 1024 * 1024, timeout: 300000 }, (err) => err ? reject(err) : resolve());
          });
          fs.promises.unlink(clipAudio).catch(() => {});
          fs.promises.unlink(clipVideo).catch(() => {});
        } else {
          fs.renameSync(clipVideo, clipMerged);
        }
        mergedClips.push(clipMerged);
      }

      sendEvent({ type: "export_status", stage: "assembling", current: total, total });

      const hasTransitions = Array.isArray(transitions) && transitions.some((t: any) => t.type && t.type !== "none");

      let assembledFile: string;
      if (mergedClips.length === 1) {
        assembledFile = mergedClips[0];
      } else if (!hasTransitions) {
        assembledFile = path.join(exportDir, "assembled.mp4");
        const listFile = path.join(exportDir, "concat.txt");
        fs.writeFileSync(listFile, mergedClips.map(f => `file '${f}'`).join("\n"));
        await new Promise<void>((resolve, reject) => {
          execFile("ffmpeg", [
            "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", assembledFile,
          ], { maxBuffer: 50 * 1024 * 1024, timeout: 300000 }, (err) => err ? reject(err) : resolve());
        });
      } else {
        assembledFile = path.join(exportDir, "assembled.mp4");
        const clipDurations: number[] = [];
        for (const clip of mergedClips) {
          const dur = getVideoDuration(clip);
          clipDurations.push(dur);
        }

        const inputs = mergedClips.flatMap(f => ["-i", f]);
        const vFilters: string[] = [];
        const aFilters: string[] = [];
        let lastV = "[0:v]";
        let lastA = "[0:a]";
        let cumulativeOffset = clipDurations[0];

        for (let i = 1; i < mergedClips.length; i++) {
          const tr = transitions[i - 1] || { type: "none", duration: 0.5 };
          const tType = tr.type === "none" ? "fade" : tr.type;
          const tDur = Math.min(tr.duration || 0.5, clipDurations[i - 1] / 2, clipDurations[i] / 2);
          const offset = Math.max(0, cumulativeOffset - tDur);
          const outV = i < mergedClips.length - 1 ? `[v${i}]` : "[vout]";
          const outA = i < mergedClips.length - 1 ? `[a${i}]` : "[aout]";

          vFilters.push(`${lastV}[${i}:v]xfade=transition=${tType}:duration=${tDur.toFixed(2)}:offset=${offset.toFixed(2)}${outV}`);
          aFilters.push(`${lastA}[${i}:a]acrossfade=d=${tDur.toFixed(2)}:c1=tri:c2=tri${outA}`);

          lastV = outV;
          lastA = outA;
          cumulativeOffset = offset + clipDurations[i];
        }

        const filterComplex = [...vFilters, ...aFilters].join(";");

        await new Promise<void>((resolve, reject) => {
          execFile("ffmpeg", [
            ...inputs,
            "-filter_complex", filterComplex,
            "-map", "[vout]", "-map", "[aout]",
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-c:a", "aac", "-b:a", "192k",
            assembledFile,
          ], { maxBuffer: 100 * 1024 * 1024, timeout: 600000 }, (err) => err ? reject(err) : resolve());
        });
      }

      let finalFile = assembledFile;

      if (subtitleStyle && subtitleStyle.enabled) {
        sendEvent({ type: "export_status", stage: "subtitles", current: total, total });
        const srtFile = path.join(exportDir, "subtitles.srt");
        fs.writeFileSync(srtFile, buildSrt(segments, duration));
        const subtitledFile = path.join(exportDir, "subtitled.mp4");
        await new Promise<void>((resolve, reject) => {
          execFile("ffmpeg", [
            "-i", assembledFile, "-i", srtFile,
            "-c:v", "copy", "-c:a", "copy", "-c:s", "mov_text",
            "-metadata:s:s:0", "language=eng",
            subtitledFile,
          ], { maxBuffer: 100 * 1024 * 1024, timeout: 600000 }, (err) => err ? reject(err) : resolve());
        });
        finalFile = subtitledFile;
      }

      const exportId = `export-${stamp}`;
      const destFile = path.join(UPLOAD_DIR, `${exportId}.mp4`);
      fs.renameSync(finalFile, destFile);
      retainedExports.set(exportId, destFile);
      persistRegistry();

      sendEvent({ type: "export_done", exportId });
      res.end();
    } catch (err) {
      console.error("Export error:", err);
      sendEvent({ type: "export_error", error: "Export failed. Check server logs for details." });
      res.end();
    } finally {
      fs.promises.rm(exportDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  app.get("/api/export/download/:exportId", (req: Request, res: Response) => {
    const exportId = req.params.exportId;
    if (!/^export-\d+$/.test(exportId)) {
      res.status(400).json({ error: "Invalid export ID." });
      return;
    }
    const filePath = path.join(UPLOAD_DIR, `${exportId}.mp4`);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: "Export not found or expired." });
      return;
    }
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", `attachment; filename="${exportId}.mp4"`);
    fs.createReadStream(filePath).pipe(res);
  });

  app.get("/api/clips/download/:clipId", (req: Request, res: Response) => {
    const clipId = req.params.clipId;
    if (!/^clip-\d+-\d+$/.test(clipId)) {
      res.status(400).json({ error: "Invalid clip ID." });
      return;
    }
    const filePath = path.join(UPLOAD_DIR, `${clipId}.mp4`);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: "Clip not found or expired." });
      return;
    }
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", `attachment; filename="${clipId}.mp4"`);
    fs.createReadStream(filePath).pipe(res);
  });

  app.post("/api/clips/download-all", async (req: Request, res: Response) => {
    const { clipIds, name } = req.body;
    if (!Array.isArray(clipIds) || !clipIds.length) {
      res.status(400).json({ error: "No clip IDs provided." });
      return;
    }
    const safeName = typeof name === "string" ? name.replace(/\W+/g, "-").toLowerCase() : "clips";
    const zipFile = path.join(UPLOAD_DIR, `${safeName}-clips-${Date.now()}.zip`);
    const filePaths: string[] = [];
    for (const id of clipIds) {
      if (!/^clip-\d+-\d+$/.test(id)) continue;
      const fp = path.join(UPLOAD_DIR, `${id}.mp4`);
      if (fs.existsSync(fp)) filePaths.push(fp);
    }
    if (!filePaths.length) {
      res.status(404).json({ error: "No clip files found." });
      return;
    }
    try {
      await new Promise<void>((resolve, reject) => {
        execFile("zip", ["-j", zipFile, ...filePaths], { timeout: 300000 }, (err) =>
          err ? reject(err) : resolve()
        );
      });
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}-clips.zip"`);
      const stream = fs.createReadStream(zipFile);
      stream.pipe(res);
      stream.on("end", () => fs.promises.unlink(zipFile).catch(() => {}));
    } catch {
      res.status(500).json({ error: "Failed to create zip." });
      fs.promises.unlink(zipFile).catch(() => {});
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  app.listen(PORT, "127.0.0.1", () => {
    console.log(`\n  Narrator running → http://localhost:${PORT}\n`);
  });
}

startServer();
