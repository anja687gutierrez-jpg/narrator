import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Activity, ShieldCheck, FileText, Monitor, Clock, Gauge, Type,
  Loader2, Upload, Sparkles, Copy, Check, RotateCcw, FileJson, FileDown,
  Volume2, FolderOpen, Save, Trash2, Pencil, X, Lock, Scissors, Film,
  Play, Pause, SkipForward, SkipBack, Subtitles, Palette, Download,
  GripVertical, ArrowDownToLine,
} from 'lucide-react';

const AUTH_KEY = 'narrator-auth';

function getAuth(): string {
  return localStorage.getItem(AUTH_KEY) || '';
}

function authHeaders(): Record<string, string> {
  const token = getAuth();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers = { ...authHeaders(), ...(init?.headers || {}) };
  return fetch(url, { ...init, headers });
}

function mediaUrl(path: string): string {
  const token = getAuth();
  return token ? `${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}` : path;
}

interface ScriptSegment {
  timestamp: string;
  action: string;
  narration: string;
}

interface ScriptResponse {
  metadata: {
    totalDurationSeconds: number;
    estimatedWordCount: number;
    tone: string;
    softwareName: string;
  };
  segments: ScriptSegment[];
}

interface SavedProject {
  id: string;
  name: string;
  script: ScriptResponse;
  videoName: string;
  videoId?: string;
  createdAt: string;
  updatedAt: string;
}

interface TTSVoice {
  id: string;
  name: string;
  gender: string;
}

type Stage = 'idle' | 'splitting' | 'uploading' | 'generating' | 'done' | 'error';

const STORAGE_KEY = 'narrator-projects';

function loadProjects(): SavedProject[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveProjects(projects: SavedProject[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

function stageLabel(stage: Stage, chunk: number, totalChunks: number): string {
  if (stage === 'splitting') return 'Extracting keyframes from video';
  if (stage === 'uploading') return 'Preparing frames for analysis';
  if (stage === 'generating') {
    return totalChunks > 1
      ? `Analyzing batch ${chunk} of ${totalChunks}`
      : 'Composing narration — analyzing screenshots';
  }
  if (stage === 'done') return 'Script ready';
  if (stage === 'error') return 'Verification failed';
  return 'Awaiting upload';
}

function formatDuration(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '—';
  const totalMin = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  if (totalMin >= 60) {
    const h = Math.floor(totalMin / 60);
    const m = (totalMin % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s} Min`;
  }
  return `${totalMin.toString().padStart(2, '0')}:${s} Min`;
}

function countWords(segments: ScriptSegment[]): number {
  return segments.reduce((n, s) => n + s.narration.split(/\s+/).filter(Boolean).length, 0);
}

function toMarkdown(script: ScriptResponse, videoName: string): string {
  const m = script.metadata;
  const lines = [
    `# Narration Script — ${m.softwareName || videoName || 'Untitled'}`,
    ``,
    `- **Source video:** ${videoName || '—'}`,
    `- **Duration:** ${formatDuration(m.totalDurationSeconds)}`,
    `- **Estimated word count:** ${m.estimatedWordCount}`,
    `- **Tone:** ${m.tone}`,
    ``,
    `| Timestamp | On-Screen Action | Narration |`,
    `| --- | --- | --- |`,
    ...script.segments.map(s =>
      `| ${s.timestamp} | ${s.action.replace(/\|/g, '\\|')} | ${s.narration.replace(/\|/g, '\\|')} |`
    ),
    ``,
    `## Narration only`,
    ``,
    script.segments.map(s => s.narration).join('\n\n'),
  ];
  return lines.join('\n');
}

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [pw, setPw] = useState('');
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setChecking(true);
    setError(false);
    try {
      const res = await fetch('/api/tts/voices', {
        headers: { Authorization: `Bearer ${pw}` },
      });
      if (res.ok) {
        localStorage.setItem(AUTH_KEY, pw);
        onLogin();
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F1F5F9] flex items-center justify-center p-4 md:border-[12px] border-slate-900">
      <motion.div
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        className="border-2 border-slate-900 bg-white p-8 w-full max-w-sm shadow-[8px_8px_0px_rgba(15,23,42,0.1)]"
      >
        <div className="flex items-center gap-3 mb-6">
          <Lock size={20} />
          <h1 className="text-xl font-black tracking-tighter uppercase">Narrator</h1>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="Password"
            autoFocus
            className="border-2 border-slate-900 px-3 py-2 text-sm font-mono focus:outline-none"
          />
          {error && (
            <p className="text-red-600 text-xs font-bold uppercase tracking-widest">Wrong password</p>
          )}
          <button
            type="submit"
            disabled={!pw || checking}
            className="bg-slate-900 text-white py-2.5 font-bold uppercase tracking-widest text-sm hover:bg-slate-700 disabled:bg-slate-300"
          >
            {checking ? 'Checking…' : 'Enter'}
          </button>
        </form>
      </motion.div>
    </div>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(() => !!getAuth());

  if (!authed) {
    return <LoginScreen onLogin={() => setAuthed(true)} />;
  }

  return <NarratorApp />;
}

function parseTimestampToSec(ts: string): number {
  const parts = ts.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

function NarratorApp() {
  const [stage, setStage] = useState<Stage>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [context, setContext] = useState('');
  const [segmentSeconds, setSegmentSeconds] = useState(12);
  const [wpm, setWpm] = useState(150);
  const [script, setScript] = useState<ScriptResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [chunk, setChunk] = useState(0);
  const [totalChunks, setTotalChunks] = useState(0);
  const [ttsVoices, setTtsVoices] = useState<TTSVoice[]>([]);
  const [ttsVoice, setTtsVoice] = useState('');
  const [ttsLoading, setTtsLoading] = useState(false);
  const [ttsSegment, setTtsSegment] = useState(0);
  const [ttsTotal, setTtsTotal] = useState(0);
  const [ttsStage, setTtsStage] = useState<'idle' | 'generating' | 'combining' | 'ready'>('idle');
  const [ttsFileId, setTtsFileId] = useState<string | null>(null);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [segFileId, setSegFileId] = useState<string | null>(null);
  const [segmentCount, setSegmentCount] = useState(0);
  const [currentSegmentIdx, setCurrentSegmentIdx] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const lastAudioSegRef = useRef(-1);
  const [showSubtitles, setShowSubtitles] = useState(false);
  const [subtitleStyle, setSubtitleStyle] = useState({
    enabled: false,
    fontSize: 36,
    fontColor: '#FFFFFF',
    bgOpacity: 0.7,
    position: 'bottom' as 'top' | 'center' | 'bottom',
  });
  const [showSubtitleControls, setShowSubtitleControls] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportStage, setExportStage] = useState('');
  const [exportCurrent, setExportCurrent] = useState(0);
  const [exportTotal, setExportTotal] = useState(0);
  const [exportId, setExportId] = useState<string | null>(null);
  const [clipsLoading, setClipsLoading] = useState(false);
  const [clipsClip, setClipsClip] = useState(0);
  const [clipsTotal, setClipsTotal] = useState(0);
  const [clipsStage, setClipsStage] = useState<'idle' | 'cutting' | 'voicing' | 'merging' | 'done_clip' | 'ready'>('idle');
  const [clipIds, setClipIds] = useState<string[]>([]);
  const [projects, setProjects] = useState<SavedProject[]>(loadProjects);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [showProjects, setShowProjects] = useState(false);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [videoName, setVideoName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    authFetch('/api/tts/voices').then(r => r.json()).then((voices: TTSVoice[]) => {
      setTtsVoices(voices);
      if (voices.length) setTtsVoice(voices[0].id);
    }).catch(() => {});
  }, []);

  const softwareName = script?.metadata.softwareName || videoFile?.name?.replace(/\.[^.]+$/, '') || 'Video Narrator';

  const metadataItems = useMemo(() => [
    { label: 'Target Pacing', value: `${wpm} WPM`, icon: Gauge },
    { label: 'Estimated Length', value: script ? formatDuration(script.metadata.totalDurationSeconds) : '—', icon: Clock },
    { label: 'Word Count', value: script ? `${script.metadata.estimatedWordCount}` : '—', icon: FileText },
    { label: 'Tone', value: script?.metadata.tone || 'Command / Clear', icon: Type },
  ], [wpm, script]);

  const persistProjects = useCallback((updated: SavedProject[]) => {
    setProjects(updated);
    saveProjects(updated);
  }, []);

  function saveCurrentScript(scriptToSave?: ScriptResponse, name?: string, vid?: string) {
    if (!scriptToSave && !script) return;
    const s = scriptToSave || script!;
    const now = new Date().toISOString();
    const effectiveVideoId = vid || videoId;

    if (activeProjectId) {
      const updated = projects.map(p =>
        p.id === activeProjectId
          ? { ...p, script: s, name: name || p.name, videoId: effectiveVideoId || p.videoId, updatedAt: now }
          : p
      );
      persistProjects(updated);
    } else {
      const proj: SavedProject = {
        id: crypto.randomUUID(),
        name: name || s.metadata.softwareName || videoFile?.name?.replace(/\.[^.]+$/, '') || 'Untitled',
        script: s,
        videoName: videoFile?.name || videoName || '',
        videoId: effectiveVideoId || undefined,
        createdAt: now,
        updatedAt: now,
      };
      setActiveProjectId(proj.id);
      persistProjects([proj, ...projects]);
    }
  }

  async function loadProject(proj: SavedProject) {
    setScript(proj.script);
    setStage('done');
    setActiveProjectId(proj.id);
    setVideoFile(null);
    setVideoName(proj.videoName);
    setErrorMsg(null);
    setShowProjects(false);
    setVideoId(null);

    if (proj.videoId) {
      try {
        const res = await authFetch(`/api/video/${proj.videoId}`, { method: 'HEAD' });
        if (res.ok) {
          setVideoId(proj.videoId);
        }
      } catch {}
    }
  }

  function deleteProject(id: string) {
    const updated = projects.filter(p => p.id !== id);
    persistProjects(updated);
    if (activeProjectId === id) {
      setActiveProjectId(null);
      setScript(null);
      setStage('idle');
    }
  }

  function handleImportJSON(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string) as ScriptResponse;
        if (!data.metadata || !Array.isArray(data.segments)) {
          setErrorMsg('Invalid script JSON — missing metadata or segments.');
          setStage('error');
          return;
        }
        data.metadata.estimatedWordCount = countWords(data.segments);
        setScript(data);
        setStage('done');
        if (!videoId) setVideoFile(null);
        setVideoName(file.name.replace(/\.json$/i, ''));
        setErrorMsg(null);

        const now = new Date().toISOString();
        const proj: SavedProject = {
          id: crypto.randomUUID(),
          name: data.metadata.softwareName || file.name.replace(/\.json$/i, ''),
          script: data,
          videoName: videoName || '',
          createdAt: now,
          updatedAt: now,
        };
        setActiveProjectId(proj.id);
        persistProjects([proj, ...projects]);
      } catch {
        setErrorMsg('Could not parse JSON file.');
        setStage('error');
      }
    };
    reader.readAsText(file);
  }

  function handleFileSelect(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      setErrorMsg('Please choose a video file (MP4, MOV, WebM).');
      setStage('error');
      return;
    }
    setVideoFile(file);
    setVideoName(file.name);
    setErrorMsg(null);
    setStage('idle');
    setScript(null);
    setActiveProjectId(null);
  }

  async function handleUploadOnly() {
    if (!videoFile) return;
    setErrorMsg(null);
    setStage('uploading');
    try {
      const form = new FormData();
      form.append('video', videoFile);
      const res = await authFetch('/api/upload-video', { method: 'POST', body: form });
      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json();
      setVideoId(data.videoId);
      const emptyScript: ScriptResponse = {
        metadata: {
          totalDurationSeconds: data.duration,
          estimatedWordCount: 0,
          tone: 'confident, clear',
          softwareName: videoFile.name.replace(/\.[^.]+$/, ''),
        },
        segments: [{
          timestamp: '00:00',
          action: 'Opening scene',
          narration: 'Type your narration here...',
        }],
      };
      setScript(emptyScript);
      setStage('done');
      saveCurrentScript(emptyScript, undefined, data.videoId);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Upload failed');
      setStage('error');
    }
  }

  async function handleAttachVideo(file: File | undefined) {
    if (!file || !file.type.startsWith('video/')) return;
    setErrorMsg(null);
    try {
      const form = new FormData();
      form.append('video', file);
      const res = await authFetch('/api/upload-video', { method: 'POST', body: form });
      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json();
      setVideoId(data.videoId);
      setVideoName(file.name);
      if (script) {
        const updated = { ...script, metadata: { ...script.metadata, totalDurationSeconds: data.duration } };
        setScript(updated);
        saveCurrentScript(updated, undefined, data.videoId);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Upload failed');
    }
  }

  function addSegment() {
    if (!script) return;
    const lastSeg = script.segments[script.segments.length - 1];
    const lastSec = parseTimestampToSec(lastSeg.timestamp) + 10;
    const min = Math.floor(lastSec / 60).toString().padStart(2, '0');
    const sec = Math.floor(lastSec % 60).toString().padStart(2, '0');
    const updated: ScriptResponse = {
      ...script,
      segments: [...script.segments, {
        timestamp: `${min}:${sec}`,
        action: '',
        narration: '',
      }],
    };
    updated.metadata = { ...updated.metadata, estimatedWordCount: countWords(updated.segments) };
    setScript(updated);
    saveCurrentScript(updated);
  }

  function deleteSegment(idx: number) {
    if (!script || script.segments.length <= 1) return;
    const updated: ScriptResponse = {
      ...script,
      segments: script.segments.filter((_, i) => i !== idx),
    };
    updated.metadata = { ...updated.metadata, estimatedWordCount: countWords(updated.segments) };
    setScript(updated);
    saveCurrentScript(updated);
  }

  async function handleGenerate() {
    if (!videoFile) return;
    setErrorMsg(null);
    setScript(null);
    setChunk(0);
    setTotalChunks(0);
    setStage('uploading');

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const form = new FormData();
      form.append('video', videoFile);
      form.append('context', context);
      form.append('segmentSeconds', String(segmentSeconds));
      form.append('wpm', String(wpm));

      const res = await authFetch('/api/narrate', { method: 'POST', body: form, signal: controller.signal });
      if (!res.ok) throw new Error('Server error');
      if (!res.body) throw new Error('No response stream');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let event;
          try { event = JSON.parse(line.slice(6)); } catch { continue; }

          if (event.type === 'status') {
            setStage(event.stage);
            if (event.totalChunks) setTotalChunks(event.totalChunks);
            if (event.chunk) setChunk(event.chunk);
          } else if (event.type === 'chunk_done') {
            setChunk(event.chunk);
            if (event.totalChunks) setTotalChunks(event.totalChunks);
          } else if (event.type === 'done') {
            setScript(event.result);
            setStage('done');
            if (event.videoId) setVideoId(event.videoId);
            saveCurrentScript(event.result, undefined, event.videoId);
          } else if (event.type === 'error') {
            throw new Error(event.error);
          }
        }
      }
    } catch (err) {
      if (abortRef.current !== controller) return;
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong');
      setStage('error');
    }
  }

  function handleReset() {
    const ctrl = abortRef.current;
    abortRef.current = null;
    ctrl?.abort();
    setVideoFile(null);
    setVideoName('');
    setScript(null);
    setStage('idle');
    setErrorMsg(null);
    setCopied(false);
    setActiveProjectId(null);
    setEditingIdx(null);
    setVideoId(null);
    setSegFileId(null);
    setSegmentCount(0);
    setCurrentSegmentIdx(-1);
    setIsPlaying(false);
    lastAudioSegRef.current = -1;
    setShowSubtitles(false);
    setShowSubtitleControls(false);
    setExportId(null);
    setExportStage('');
    setClipIds([]);
    setClipsStage('idle');
    setClipsLoading(false);
    setDragIdx(null);
    setDragOverIdx(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleCopy() {
    if (!script) return;
    const text = script.segments.map(s => s.narration).join('\n\n');
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  async function handleTTS() {
    if (!script) return;
    setTtsLoading(true);
    setTtsSegment(0);
    setTtsTotal(script.segments.length);
    setTtsStage('generating');
    try {
      const segments = script.segments.map(s => s.narration);
      const res = await authFetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ segments, voice: ttsVoice }),
      });
      if (!res.ok) throw new Error('TTS failed');
      if (!res.body) throw new Error('No response stream');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let event;
          try { event = JSON.parse(line.slice(6)); } catch { continue; }

          if (event.type === 'tts_status') {
            setTtsSegment(event.segment);
            setTtsTotal(event.total);
            setTtsStage(event.stage);
          } else if (event.type === 'tts_done') {
            setTtsFileId(event.fileId);
            if (event.segFileId) setSegFileId(event.segFileId);
            if (event.segmentCount) setSegmentCount(event.segmentCount);
            setTtsStage('ready');
          } else if (event.type === 'tts_error') {
            throw new Error(event.error);
          }
        }
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'TTS generation failed');
    } finally {
      setTtsLoading(false);
    }
  }

  async function handleTTSDownload() {
    if (!ttsFileId) return;
    const res = await authFetch(`/api/tts/download/${ttsFileId}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${softwareName.replace(/\W+/g, '-').toLowerCase()}-narration.mp3`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function handleGenerateClips() {
    if (!script || !videoId) return;
    setClipsLoading(true);
    setClipsClip(0);
    setClipsTotal(script.segments.length);
    setClipsStage('cutting');
    setClipIds([]);
    try {
      const res = await authFetch('/api/clips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId,
          segments: script.segments,
          voice: ttsVoice,
        }),
      });
      if (!res.ok) throw new Error('Clips failed');
      if (!res.body) throw new Error('No response stream');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let event;
          try { event = JSON.parse(line.slice(6)); } catch { continue; }

          if (event.type === 'clips_status') {
            setClipsClip(event.clip);
            setClipsTotal(event.total);
            setClipsStage(event.stage);
          } else if (event.type === 'clips_done') {
            setClipIds(event.clipIds);
            setClipsStage('ready');
          } else if (event.type === 'clips_error') {
            throw new Error(event.error);
          }
        }
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Clip generation failed');
    } finally {
      setClipsLoading(false);
    }
  }

  async function downloadClip(clipId: string, idx: number) {
    const res = await authFetch(`/api/clips/download/${clipId}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${softwareName.replace(/\W+/g, '-').toLowerCase()}-clip-${idx + 1}.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function downloadAllClips() {
    const res = await authFetch('/api/clips/download-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clipIds, name: softwareName }),
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${softwareName.replace(/\W+/g, '-').toLowerCase()}-clips.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function startEdit(idx: number) {
    if (!script) return;
    setEditingIdx(idx);
    setEditText(script.segments[idx].narration);
    setTimeout(() => editRef.current?.focus(), 50);
  }

  function commitEdit() {
    if (editingIdx === null || !script) return;
    const updated: ScriptResponse = {
      ...script,
      segments: script.segments.map((seg, i) =>
        i === editingIdx ? { ...seg, narration: editText } : seg
      ),
    };
    updated.metadata = { ...updated.metadata, estimatedWordCount: countWords(updated.segments) };
    setScript(updated);
    setEditingIdx(null);
    saveCurrentScript(updated);
  }

  function cancelEdit() {
    setEditingIdx(null);
    setEditText('');
  }

  const segmentTimesRef = useRef<{ startSec: number; endSec: number }[]>([]);

  const segmentTimes = useMemo(() => {
    if (!script) return [];
    const segs = script.segments;
    const duration = script.metadata.totalDurationSeconds || 0;
    return segs.map((seg, i) => ({
      startSec: parseTimestampToSec(seg.timestamp),
      endSec: i + 1 < segs.length ? parseTimestampToSec(segs[i + 1].timestamp) : duration,
    }));
  }, [script]);

  useEffect(() => {
    segmentTimesRef.current = segmentTimes;
  }, [segmentTimes]);

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const t = video.currentTime;
    const times = segmentTimesRef.current;
    let idx = -1;
    for (let i = 0; i < times.length; i++) {
      if (t >= times[i].startSec && t < times[i].endSec) { idx = i; break; }
    }
    if (idx === -1 && times.length > 0 && t >= times[times.length - 1].startSec) {
      idx = times.length - 1;
    }
    setCurrentSegmentIdx(idx);

    if (segFileId && audioRef.current && idx >= 0 && idx !== lastAudioSegRef.current) {
      lastAudioSegRef.current = idx;
      const audio = audioRef.current;
      audio.src = mediaUrl(`/api/tts/segment/${segFileId}/${idx}`);
      audio.currentTime = 0;
      if (!video.paused) audio.play().catch(() => {});
    }
  }, [segFileId]);

  const handleVideoPlay = useCallback(() => {
    setIsPlaying(true);
    if (audioRef.current && segFileId && currentSegmentIdx >= 0) {
      audioRef.current.play().catch(() => {});
    }
  }, [segFileId, currentSegmentIdx]);

  const handleVideoPause = useCallback(() => {
    setIsPlaying(false);
    audioRef.current?.pause();
  }, []);

  function seekToSegment(idx: number) {
    if (!videoRef.current || !segmentTimes[idx]) return;
    videoRef.current.currentTime = segmentTimes[idx].startSec;
    setCurrentSegmentIdx(idx);
    lastAudioSegRef.current = -1;
  }

  function reorderSegment(fromIdx: number, toIdx: number) {
    if (!script || fromIdx === toIdx) return;
    const segs = [...script.segments];
    const [moved] = segs.splice(fromIdx, 1);
    segs.splice(toIdx, 0, moved);
    const updated: ScriptResponse = { ...script, segments: segs };
    setScript(updated);
    saveCurrentScript(updated);
    setDragIdx(null);
    setDragOverIdx(null);
  }

  async function handleExportFinal() {
    if (!script || !videoId) return;
    setExportLoading(true);
    setExportStage('cutting');
    setExportCurrent(0);
    setExportTotal(script.segments.length);
    setExportId(null);
    try {
      const res = await authFetch('/api/export/final', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId,
          segments: script.segments,
          voice: ttsVoice,
          subtitleStyle: showSubtitles ? { ...subtitleStyle, enabled: true } : { enabled: false },
        }),
      });
      if (!res.ok) throw new Error('Export failed');
      if (!res.body) throw new Error('No response stream');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let event;
          try { event = JSON.parse(line.slice(6)); } catch { continue; }

          if (event.type === 'export_status') {
            setExportStage(event.stage);
            setExportCurrent(event.current);
            setExportTotal(event.total);
          } else if (event.type === 'export_done') {
            setExportId(event.exportId);
            setExportStage('ready');
          } else if (event.type === 'export_error') {
            throw new Error(event.error);
          }
        }
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExportLoading(false);
    }
  }

  async function handleExportDownload() {
    if (!exportId) return;
    const res = await authFetch(`/api/export/download/${exportId}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${softwareName.replace(/\W+/g, '-').toLowerCase()}-final.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const [isDragging, setIsDragging] = useState(false);
  const isWorking = stage === 'splitting' || stage === 'uploading' || stage === 'generating';

  function handleDrop(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileSelect(file);
  }

  const activeProject = projects.find(p => p.id === activeProjectId);

  return (
    <div className="min-h-screen bg-[#F1F5F9] text-slate-900 flex flex-col p-4 md:p-10 font-sans md:border-[12px] border-slate-900 selection:bg-slate-900 selection:text-white">
      {/* Header */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-end border-b-4 border-slate-900 pb-6 mb-8 gap-4">
        <div>
          <motion.h1
            initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
            className="text-4xl md:text-5xl font-black tracking-tighter uppercase leading-none"
          >
            {softwareName.toUpperCase()}
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 }}
            className="text-base md:text-lg font-bold text-slate-500 mt-2 uppercase tracking-widest italic"
          >
            Narration Script & Storyboard
          </motion.p>
        </div>
        <div className="flex items-end gap-4">
          <button
            onClick={() => setShowProjects(!showProjects)}
            className="flex items-center gap-2 px-3 py-1.5 border-2 border-slate-900 text-xs font-bold uppercase tracking-widest hover:bg-slate-900 hover:text-white transition-all relative"
          >
            <FolderOpen size={14} />
            Projects
            {projects.length > 0 && (
              <span className="bg-slate-900 text-white text-[10px] px-1.5 py-0.5 font-mono ml-1">
                {projects.length}
              </span>
            )}
          </button>
          <div className="text-left md:text-right">
            <div className="bg-slate-900 text-white px-4 py-1 text-sm font-bold uppercase tracking-tighter inline-block">
              {stage === 'done' ? 'Final Draft' : stage === 'error' ? 'Error' : 'Draft Pending'}
            </div>
            <div className="mt-2 font-mono text-xs text-slate-500">
              ENGINE: GEMINI-2.5-FLASH | {stageLabel(stage, chunk, totalChunks).toUpperCase()}
            </div>
          </div>
        </div>
      </header>

      {/* Projects Panel */}
      <AnimatePresence>
        {showProjects && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="mb-8 border-2 border-slate-900 bg-white overflow-hidden"
          >
            <div className="bg-slate-900 text-white px-4 py-3 flex justify-between items-center">
              <span className="font-bold uppercase tracking-widest text-xs">Saved Projects</span>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => jsonInputRef.current?.click()}
                  className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest hover:opacity-70"
                >
                  <FileJson size={12} /> Import JSON
                </button>
                <button onClick={() => setShowProjects(false)} className="hover:opacity-70">
                  <X size={16} />
                </button>
              </div>
            </div>
            {projects.length === 0 ? (
              <div className="p-6 text-center text-slate-400 font-mono text-sm">
                No saved projects yet. Scripts auto-save when generated.
              </div>
            ) : (
              <div className="divide-y divide-slate-200 max-h-[280px] overflow-y-auto">
                {projects.map(proj => (
                  <div
                    key={proj.id}
                    className={`flex items-center justify-between p-4 hover:bg-slate-50 transition-colors ${
                      proj.id === activeProjectId ? 'bg-slate-50 border-l-4 border-l-slate-900' : ''
                    }`}
                  >
                    <button
                      onClick={() => loadProject(proj)}
                      className="flex-1 text-left"
                    >
                      <div className="font-bold text-sm">{proj.name}</div>
                      <div className="font-mono text-xs text-slate-400 mt-0.5">
                        {proj.script.segments.length} segments · {proj.script.metadata.estimatedWordCount} words
                        · {formatDuration(proj.script.metadata.totalDurationSeconds)}
                      </div>
                      <div className="font-mono text-[10px] text-slate-300 mt-0.5 flex items-center gap-2">
                        <span>
                          {new Date(proj.updatedAt).toLocaleDateString()} {new Date(proj.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          {proj.videoName && ` · ${proj.videoName}`}
                        </span>
                        {proj.videoId ? (
                          <span className="text-[9px] px-1.5 py-0.5 bg-green-100 text-green-700 font-bold uppercase">Video</span>
                        ) : (
                          <span className="text-[9px] px-1.5 py-0.5 bg-slate-100 text-slate-400 font-bold uppercase">Script Only</span>
                        )}
                      </div>
                    </button>
                    <button
                      onClick={() => deleteProject(proj.id)}
                      className="p-2 text-slate-300 hover:text-red-500 transition-colors ml-2"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hidden JSON import input */}
      <input
        ref={jsonInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={(e) => { handleImportJSON(e.target.files?.[0]); e.target.value = ''; }}
      />

      {/* Metadata Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {metadataItems.map((item, idx) => (
          <motion.div
            key={item.label}
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.08 + 0.2 }}
            className="border-l-4 border-slate-900 pl-4 py-2 bg-white shadow-sm"
          >
            <span className="flex items-center gap-2 text-[10px] uppercase font-bold text-slate-400">
              <item.icon size={10} />
              {item.label}
            </span>
            <span className="text-lg md:text-xl font-bold block">{item.value}</span>
          </motion.div>
        ))}
      </div>

      {/* Control Panel — visible when no script yet OR while configuring */}
      {!script && (
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-4 mb-8"
        >
          {/* Upload Dropzone */}
          <label
            htmlFor="video-input"
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={`relative border-2 border-dashed cursor-pointer transition-all p-8 flex flex-col items-center justify-center gap-3 min-h-[180px] ${
              videoFile ? 'border-slate-900 bg-slate-900 text-white'
              : isDragging ? 'border-slate-900 bg-slate-100 scale-[1.01]'
              : 'bg-white border-slate-400 hover:border-slate-900 hover:bg-slate-50'
            }`}
          >
            <input
              id="video-input"
              ref={fileInputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => handleFileSelect(e.target.files?.[0])}
              disabled={isWorking}
            />
            {videoFile ? (
              <>
                <ShieldCheck size={28} />
                <div className="text-center">
                  <div className="font-bold uppercase tracking-widest text-xs">Video Loaded</div>
                  <div className="font-mono text-sm mt-1 break-all">{videoFile.name}</div>
                  <div className="font-mono text-[10px] mt-1 opacity-70">
                    {(videoFile.size / 1024 / 1024).toFixed(1)} MB
                  </div>
                </div>
              </>
            ) : (
              <>
                <Upload size={28} className="text-slate-400" />
                <div className="text-center">
                  <div className="font-bold uppercase tracking-widest text-xs">Drop Video Here</div>
                  <div className="font-mono text-xs mt-1 text-slate-500">
                    MP4 · MOV · WebM · up to 2 GB
                  </div>
                </div>
              </>
            )}
          </label>

          {/* Settings */}
          <div className="border-2 border-slate-900 bg-white p-4 flex flex-col gap-3">
            <label className="block">
              <span className="text-[10px] uppercase font-bold tracking-widest text-slate-500">
                Context (optional but recommended)
              </span>
              <textarea
                value={context}
                onChange={(e) => setContext(e.target.value)}
                placeholder="e.g. STAP Operations Portal — internal tool for transit advertising ops. Audience: ops managers reviewing the receivables workflow."
                rows={3}
                disabled={isWorking}
                className="mt-1 w-full border border-slate-300 px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-slate-900 disabled:bg-slate-50 resize-none"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-[10px] uppercase font-bold tracking-widest text-slate-500">Segment ~ every</span>
                <select
                  value={segmentSeconds}
                  onChange={(e) => setSegmentSeconds(Number(e.target.value))}
                  disabled={isWorking}
                  className="mt-1 w-full border border-slate-300 px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-slate-900 disabled:bg-slate-50"
                >
                  <option value={8}>8 sec (dense)</option>
                  <option value={12}>12 sec (balanced)</option>
                  <option value={20}>20 sec (sparse)</option>
                </select>
              </label>
              <label className="block">
                <span className="text-[10px] uppercase font-bold tracking-widest text-slate-500">Pacing</span>
                <select
                  value={wpm}
                  onChange={(e) => setWpm(Number(e.target.value))}
                  disabled={isWorking}
                  className="mt-1 w-full border border-slate-300 px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-slate-900 disabled:bg-slate-50"
                >
                  <option value={130}>130 WPM (slow)</option>
                  <option value={150}>150 WPM (default)</option>
                  <option value={170}>170 WPM (brisk)</option>
                </select>
              </label>
            </div>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <button
                onClick={handleGenerate}
                disabled={!videoFile || isWorking}
                className="flex items-center justify-center gap-2 bg-slate-900 text-white py-3 font-bold uppercase tracking-widest text-sm hover:bg-slate-700 transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed"
              >
                {isWorking ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
                {isWorking ? 'Working…' : 'AI Narrate'}
              </button>
              <button
                onClick={handleUploadOnly}
                disabled={!videoFile || isWorking}
                className="flex items-center justify-center gap-2 border-2 border-slate-900 text-slate-900 py-3 font-bold uppercase tracking-widest text-sm hover:bg-slate-900 hover:text-white transition-colors disabled:border-slate-300 disabled:text-slate-300 disabled:cursor-not-allowed"
              >
                <Film size={16} />
                Load Video Only
              </button>
            </div>
          </div>
        </motion.div>
      )}

      {/* Hidden attach video input */}
      <input
        ref={attachInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => { handleAttachVideo(e.target.files?.[0]); e.target.value = ''; }}
      />

      {/* Attach Video prompt — shown when script exists but no video */}
      {!videoId && script && (
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="mb-4 border-2 border-dashed border-slate-400 bg-white p-6 flex flex-col items-center gap-3"
        >
          <Film size={24} className="text-slate-400" />
          <p className="text-xs font-bold uppercase tracking-widest text-slate-500">
            No video attached — upload one to preview, sync audio, and export
          </p>
          <button
            onClick={() => attachInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white text-xs font-bold uppercase tracking-widest hover:bg-slate-700 transition-all"
          >
            <Upload size={14} /> Attach Video
          </button>
        </motion.div>
      )}

      {/* Video Preview */}
      {videoId && script && (
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="mb-4 border-2 border-slate-900 bg-slate-900 overflow-hidden"
        >
          <div className="relative">
            <video
              ref={videoRef}
              src={mediaUrl(`/api/video/${videoId}`)}
              onTimeUpdate={handleTimeUpdate}
              onPlay={handleVideoPlay}
              onPause={handleVideoPause}
              className="w-full max-h-[500px] bg-black"
              controls
            />
            <audio ref={audioRef} preload="none" />
            {/* Subtitle overlay */}
            {showSubtitles && currentSegmentIdx >= 0 && script.segments[currentSegmentIdx]?.narration && (
              <div
                className="absolute left-0 right-0 flex justify-center pointer-events-none px-8"
                style={{
                  ...(subtitleStyle.position === 'top' ? { top: '5%' } :
                    subtitleStyle.position === 'center' ? { top: '50%', transform: 'translateY(-50%)' } :
                    { bottom: '12%' }),
                }}
              >
                <span
                  className="text-center max-w-[80%] leading-snug"
                  style={{
                    fontSize: `${subtitleStyle.fontSize}px`,
                    color: subtitleStyle.fontColor,
                    backgroundColor: `rgba(0,0,0,${subtitleStyle.bgOpacity})`,
                    padding: '6px 16px',
                    borderRadius: '4px',
                  }}
                >
                  {script.segments[currentSegmentIdx].narration}
                </span>
              </div>
            )}
          </div>

          {/* Toolbar: subtitle toggle + controls */}
          <div className="flex items-center gap-3 px-3 py-2 bg-slate-800 border-b border-slate-700">
            <button
              onClick={() => { setShowSubtitles(!showSubtitles); if (!showSubtitles) setSubtitleStyle(s => ({ ...s, enabled: true })); }}
              className={`flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase tracking-widest transition-all border ${
                showSubtitles ? 'bg-white text-slate-900 border-white' : 'text-slate-400 border-slate-600 hover:text-white'
              }`}
            >
              <Subtitles size={12} /> Subtitles
            </button>
            {showSubtitles && (
              <button
                onClick={() => setShowSubtitleControls(!showSubtitleControls)}
                className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-400 border border-slate-600 hover:text-white transition-all"
              >
                <Palette size={12} /> Style
              </button>
            )}
            {segFileId && (
              <span className="ml-auto text-[10px] text-slate-500 font-mono">Audio synced</span>
            )}
          </div>

          {/* Subtitle style controls */}
          <AnimatePresence>
            {showSubtitleControls && showSubtitles && (
              <motion.div
                initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden bg-slate-800 border-b border-slate-700"
              >
                <div className="flex flex-wrap items-center gap-4 px-4 py-3">
                  <label className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Size</span>
                    <input type="range" min={20} max={64} value={subtitleStyle.fontSize}
                      onChange={e => setSubtitleStyle(s => ({ ...s, fontSize: Number(e.target.value) }))}
                      className="w-20 accent-white" />
                    <span className="text-[10px] text-slate-300 font-mono w-6">{subtitleStyle.fontSize}</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Color</span>
                    <div className="flex gap-1">
                      {['#FFFFFF', '#FFD700', '#00FF88', '#00BFFF', '#FF6B6B', '#FF69B4'].map(c => (
                        <button key={c} onClick={() => setSubtitleStyle(s => ({ ...s, fontColor: c }))}
                          className={`w-5 h-5 border-2 transition-all ${subtitleStyle.fontColor === c ? 'border-white scale-110' : 'border-slate-600'}`}
                          style={{ backgroundColor: c }} />
                      ))}
                    </div>
                  </label>
                  <label className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">BG</span>
                    <input type="range" min={0} max={100} value={Math.round(subtitleStyle.bgOpacity * 100)}
                      onChange={e => setSubtitleStyle(s => ({ ...s, bgOpacity: Number(e.target.value) / 100 }))}
                      className="w-16 accent-white" />
                  </label>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mr-1">Pos</span>
                    {(['top', 'center', 'bottom'] as const).map(pos => (
                      <button key={pos} onClick={() => setSubtitleStyle(s => ({ ...s, position: pos }))}
                        className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest border transition-all ${
                          subtitleStyle.position === pos ? 'bg-white text-slate-900 border-white' : 'text-slate-400 border-slate-600 hover:text-white'
                        }`}>{pos}</button>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Timeline bar */}
          <div className="flex items-center gap-0.5 p-3 bg-slate-900 overflow-x-auto">
            {script.segments.map((seg, i) => {
              const times = segmentTimes[i];
              const totalDur = script.metadata.totalDurationSeconds || 1;
              const segDur = times ? (times.endSec - times.startSec) : 10;
              const widthPct = Math.max((segDur / totalDur) * 100, 3);

              return (
                <div
                  key={i}
                  draggable
                  onDragStart={() => setDragIdx(i)}
                  onDragOver={(e) => { e.preventDefault(); setDragOverIdx(i); }}
                  onDragEnd={() => { if (dragIdx !== null && dragOverIdx !== null) reorderSegment(dragIdx, dragOverIdx); }}
                  onClick={() => seekToSegment(i)}
                  className={`relative shrink-0 h-10 flex items-center justify-center cursor-pointer transition-all border ${
                    i === currentSegmentIdx
                      ? 'bg-white text-slate-900 border-white'
                      : dragOverIdx === i
                        ? 'bg-slate-600 text-white border-slate-400'
                        : 'bg-slate-700 text-slate-300 border-slate-600 hover:bg-slate-600'
                  }`}
                  style={{ width: `${widthPct}%`, minWidth: '40px' }}
                >
                  <GripVertical size={10} className="absolute left-0.5 opacity-30" />
                  <span className="text-[9px] font-mono font-bold truncate px-2">{seg.timestamp}</span>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* Main Content: Script Table */}
      <div className="flex-grow border-2 border-slate-900 bg-white relative shadow-[8px_8px_0px_rgba(15,23,42,0.1)] overflow-hidden flex flex-col min-h-[300px]">
        <div className="grid grid-cols-[100px_1fr_1.5fr] bg-slate-900 text-white font-bold uppercase text-[10px] md:text-xs tracking-widest sticky top-0 z-10">
          <div className="p-4 border-r border-slate-700">Timestamp</div>
          <div className="p-4 border-r border-slate-700">On-Screen Action</div>
          <div className="p-4 flex items-center justify-between">
            <span>Narration Script</span>
            {script && (
              <span className="font-mono text-[10px] opacity-50 normal-case font-normal">
                click to edit
              </span>
            )}
          </div>
        </div>

        <div className="flex-grow overflow-y-auto">
          <AnimatePresence mode="wait">
            {isWorking ? (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center h-full min-h-[300px] gap-6 p-8"
              >
                {/* Stage steps */}
                <div className="flex items-center gap-3">
                  {['splitting', 'generating', 'done'].map((s, i) => {
                    const stages = ['splitting', 'generating', 'done'];
                    const currentIdx = stages.indexOf(stage);
                    const isDone = i < currentIdx;
                    const isCurrent = i === currentIdx;
                    return (
                      <React.Fragment key={s}>
                        {i > 0 && (
                          <div className={`w-12 h-0.5 ${isDone ? 'bg-slate-900' : 'bg-slate-200'}`} />
                        )}
                        <div className={`w-8 h-8 flex items-center justify-center text-xs font-bold border-2 transition-all duration-300 ${
                          isDone ? 'bg-slate-900 text-white border-slate-900'
                          : isCurrent ? 'border-slate-900 text-slate-900'
                          : 'border-slate-200 text-slate-300'
                        }`}>
                          {isDone ? <Check size={14} /> : i + 1}
                        </div>
                      </React.Fragment>
                    );
                  })}
                </div>

                {/* Stage label */}
                <div className="text-center">
                  <p className="font-bold uppercase tracking-widest text-slate-900 text-sm">
                    {stageLabel(stage, chunk, totalChunks)}
                  </p>
                  <p className="font-mono text-xs text-slate-400 mt-1">
                    {stage === 'splitting'
                      ? 'Extracting keyframes — a few seconds'
                      : totalChunks > 1
                        ? `Batch ${chunk} of ${totalChunks} · ~${(totalChunks - chunk) * 20}s remaining`
                        : 'Analyzing screenshots and writing narration'}
                  </p>
                </div>

                {/* Progress bar */}
                <div className="w-full max-w-md">
                  <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">
                    <span>{stage === 'splitting' ? 'Extracting' : `Batch ${chunk}/${totalChunks}`}</span>
                    <span>
                      {stage === 'splitting' ? '—'
                        : totalChunks > 0 ? `${Math.round((chunk / totalChunks) * 100)}%`
                        : '0%'}
                    </span>
                  </div>
                  <div className="w-full h-3 bg-slate-100 border border-slate-200 overflow-hidden">
                    {stage === 'splitting' ? (
                      <motion.div
                        className="h-full bg-slate-900"
                        initial={{ x: '-100%' }}
                        animate={{ x: '200%' }}
                        transition={{ repeat: Infinity, duration: 1.2, ease: 'easeInOut' }}
                        style={{ width: '40%' }}
                      />
                    ) : (
                      <motion.div
                        className="h-full bg-slate-900"
                        initial={{ width: 0 }}
                        animate={{ width: totalChunks > 0 ? `${Math.round((chunk / totalChunks) * 100)}%` : '0%' }}
                        transition={{ duration: 0.6, ease: 'easeOut' }}
                      />
                    )}
                  </div>
                </div>
              </motion.div>
            ) : stage === 'error' ? (
              <motion.div
                key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="flex flex-col items-center justify-center h-full min-h-[300px] gap-3 p-8 text-center"
              >
                <div className="font-bold uppercase tracking-widest text-red-600">Verification Failed</div>
                <p className="font-mono text-xs text-slate-600 max-w-lg">{errorMsg}</p>
                <button
                  onClick={handleReset}
                  className="mt-2 flex items-center gap-2 px-4 py-2 border border-slate-900 text-xs font-bold uppercase tracking-widest hover:bg-slate-900 hover:text-white"
                >
                  <RotateCcw size={12} /> Try Again
                </button>
              </motion.div>
            ) : script ? (
              <motion.div
                key="content" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="divide-y divide-slate-200"
              >
                {script.segments.map((row, idx) => (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.03 }}
                    onClick={() => videoId && seekToSegment(idx)}
                    className={`grid grid-cols-[100px_1fr_1.5fr] transition-colors group ${
                      idx === currentSegmentIdx
                        ? 'bg-slate-100 border-l-4 border-l-slate-900'
                        : 'hover:bg-slate-50'
                    }`}
                    style={videoId ? { cursor: 'pointer' } : undefined}
                  >
                    <div className="p-4 bg-slate-50 md:bg-transparent border-r border-slate-200 font-mono font-bold text-slate-400 text-sm flex items-center justify-between">
                      <span>{row.timestamp}</span>
                      {script.segments.length > 1 && (
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteSegment(idx); }}
                          className="opacity-0 group-hover:opacity-40 hover:!opacity-100 text-red-500 transition-opacity"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                    <div className="p-4 border-r border-slate-200 text-xs md:text-sm leading-tight italic text-slate-600">
                      {row.action}
                    </div>
                    <div className="p-4 text-xs md:text-sm leading-relaxed font-medium relative">
                      {editingIdx === idx ? (
                        <div className="flex flex-col gap-2">
                          <textarea
                            ref={editRef}
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEdit(); }
                              if (e.key === 'Escape') cancelEdit();
                            }}
                            rows={3}
                            className="w-full border-2 border-slate-900 px-2 py-1.5 text-sm font-mono focus:outline-none resize-none"
                          />
                          <div className="flex gap-2 justify-end">
                            <button onClick={cancelEdit} className="text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-slate-900 px-2 py-1">
                              Cancel
                            </button>
                            <button onClick={commitEdit} className="text-[10px] font-bold uppercase tracking-widest bg-slate-900 text-white px-3 py-1 hover:bg-slate-700">
                              Save
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div
                          onClick={() => startEdit(idx)}
                          className="cursor-pointer group/cell"
                        >
                          <span>"{row.narration}"</span>
                          <Pencil size={10} className="inline-block ml-2 opacity-0 group-hover/cell:opacity-40 transition-opacity" />
                        </div>
                      )}
                    </div>
                  </motion.div>
                ))}
                <div className="p-3 flex justify-center border-t border-slate-200">
                  <button
                    onClick={addSegment}
                    className="flex items-center gap-2 px-4 py-2 border border-dashed border-slate-300 text-xs font-bold uppercase tracking-widest text-slate-400 hover:border-slate-900 hover:text-slate-900 transition-all"
                  >
                    + Add Segment
                  </button>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="flex flex-col items-center justify-center h-full min-h-[300px] gap-2 p-8 text-center"
              >
                <Activity className="text-slate-300" size={48} />
                <p className="font-bold uppercase tracking-widest text-slate-400 text-sm">
                  {projects.length > 0
                    ? 'Upload a video, load a project, or import JSON'
                    : 'Upload a video to begin — AI narrate or load video only'}
                </p>
                <button
                  onClick={() => jsonInputRef.current?.click()}
                  className="mt-2 flex items-center gap-2 px-4 py-2 border border-slate-300 text-xs font-bold uppercase tracking-widest text-slate-400 hover:border-slate-900 hover:text-slate-900 transition-all"
                >
                  <FileJson size={12} /> Import JSON Script
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* TTS Progress / Download */}
      <AnimatePresence>
        {(ttsLoading || ttsStage === 'ready') && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="mt-4 border-2 border-slate-900 bg-white p-5 overflow-hidden"
          >
            {ttsStage === 'ready' ? (
              <div className="flex flex-col items-center gap-4 py-2">
                <div className="flex items-center gap-3">
                  <Check size={20} className="text-green-600" />
                  <span className="font-bold uppercase tracking-widest text-sm text-slate-900">
                    Audio Ready
                  </span>
                </div>
                <button
                  onClick={handleTTSDownload}
                  className="flex items-center gap-3 px-8 py-4 bg-slate-900 text-white font-bold uppercase tracking-widest text-sm hover:bg-slate-700 transition-all"
                >
                  <FileDown size={20} />
                  Download MP3
                </button>
                <button
                  onClick={() => { setTtsStage('idle'); setTtsFileId(null); }}
                  className="text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-slate-900"
                >
                  Dismiss
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <Volume2 size={18} className="text-slate-900" />
                    <span className="font-bold uppercase tracking-widest text-sm text-slate-900">
                      {ttsStage === 'combining' ? 'Combining Audio' : 'Generating Voice'}
                    </span>
                  </div>
                  <span className="font-mono text-xs text-slate-500">
                    {ttsStage === 'combining' ? 'Finalizing…'
                      : ttsTotal > 0 ? `Segment ${ttsSegment} of ${ttsTotal} · ${Math.round((ttsSegment / ttsTotal) * 100)}%`
                      : 'Starting…'}
                  </span>
                </div>
                <div className="w-full h-3 bg-slate-100 border border-slate-200 overflow-hidden">
                  {ttsStage === 'combining' ? (
                    <motion.div
                      className="h-full bg-slate-900"
                      initial={{ x: '-100%' }}
                      animate={{ x: '200%' }}
                      transition={{ repeat: Infinity, duration: 1.2, ease: 'easeInOut' }}
                      style={{ width: '40%' }}
                    />
                  ) : (
                    <motion.div
                      className="h-full bg-slate-900"
                      animate={{ width: ttsTotal > 0 ? `${Math.round((ttsSegment / ttsTotal) * 100)}%` : '0%' }}
                      transition={{ duration: 0.4, ease: 'easeOut' }}
                    />
                  )}
                </div>
                {ttsTotal > 0 && ttsStage === 'generating' && (
                  <div className="flex gap-1 mt-3">
                    {Array.from({ length: ttsTotal }, (_, i) => (
                      <div
                        key={i}
                        className={`h-1.5 flex-1 transition-all duration-300 ${
                          i < ttsSegment ? 'bg-slate-900' : 'bg-slate-200'
                        }`}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Clips Progress / Download */}
      <AnimatePresence>
        {(clipsLoading || clipsStage === 'ready') && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="mt-4 border-2 border-slate-900 bg-white p-5 overflow-hidden"
          >
            {clipsStage === 'ready' ? (
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <Check size={20} className="text-green-600" />
                  <span className="font-bold uppercase tracking-widest text-sm text-slate-900">
                    {clipIds.length} Clips Ready
                  </span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {clipIds.map((id, i) => (
                    <button
                      key={id}
                      onClick={() => downloadClip(id, i)}
                      className="flex items-center gap-2 px-3 py-3 border border-slate-900 text-xs font-bold uppercase tracking-widest hover:bg-slate-900 hover:text-white transition-all"
                    >
                      <Film size={12} />
                      Clip {i + 1}
                      {script && (
                        <span className="font-mono text-[10px] opacity-50 normal-case ml-auto">
                          {script.segments[i]?.timestamp}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                {clipIds.length > 1 && (
                  <button
                    onClick={downloadAllClips}
                    className="flex items-center justify-center gap-2 px-4 py-3 bg-slate-900 text-white text-xs font-bold uppercase tracking-widest hover:bg-slate-700 transition-all"
                  >
                    <ArrowDownToLine size={14} />
                    Download All as ZIP
                  </button>
                )}
                <button
                  onClick={() => { setClipsStage('idle'); setClipIds([]); }}
                  className="text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-slate-900 self-center"
                >
                  Dismiss
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <Scissors size={18} className="text-slate-900" />
                    <span className="font-bold uppercase tracking-widest text-sm text-slate-900">
                      {clipsStage === 'cutting' ? 'Cutting Video' : clipsStage === 'voicing' ? 'Generating Voice' : clipsStage === 'merging' ? 'Merging Audio' : 'Processing'}
                    </span>
                  </div>
                  <span className="font-mono text-xs text-slate-500">
                    Clip {clipsClip} of {clipsTotal} · {clipsTotal > 0 ? Math.round((clipsClip / clipsTotal) * 100) : 0}%
                  </span>
                </div>
                <div className="w-full h-3 bg-slate-100 border border-slate-200 overflow-hidden">
                  <motion.div
                    className="h-full bg-slate-900"
                    animate={{ width: clipsTotal > 0 ? `${Math.round((clipsClip / clipsTotal) * 100)}%` : '0%' }}
                    transition={{ duration: 0.4, ease: 'easeOut' }}
                  />
                </div>
                {clipsTotal > 0 && (
                  <div className="flex gap-1 mt-3">
                    {Array.from({ length: clipsTotal }, (_, i) => (
                      <div
                        key={i}
                        className={`h-1.5 flex-1 transition-all duration-300 ${
                          i < clipsClip ? 'bg-slate-900' : 'bg-slate-200'
                        }`}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Export Progress / Download */}
      <AnimatePresence>
        {(exportLoading || exportStage === 'ready') && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="mt-4 border-2 border-slate-900 bg-white p-5 overflow-hidden"
          >
            {exportStage === 'ready' ? (
              <div className="flex flex-col items-center gap-4 py-2">
                <div className="flex items-center gap-3">
                  <Check size={20} className="text-green-600" />
                  <span className="font-bold uppercase tracking-widest text-sm text-slate-900">
                    Final Video Ready
                  </span>
                </div>
                <button
                  onClick={handleExportDownload}
                  className="flex items-center gap-3 px-8 py-4 bg-slate-900 text-white font-bold uppercase tracking-widest text-sm hover:bg-slate-700 transition-all"
                >
                  <Download size={20} />
                  Download MP4
                </button>
                <button
                  onClick={() => { setExportStage(''); setExportId(null); }}
                  className="text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-slate-900"
                >
                  Dismiss
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <Film size={18} className="text-slate-900" />
                    <span className="font-bold uppercase tracking-widest text-sm text-slate-900">
                      {exportStage === 'cutting' ? 'Cutting Segments' :
                       exportStage === 'voicing' ? 'Generating Voice' :
                       exportStage === 'merging' ? 'Merging Audio' :
                       exportStage === 'assembling' ? 'Assembling Video' :
                       exportStage === 'subtitles' ? 'Burning Subtitles' : 'Processing'}
                    </span>
                  </div>
                  <span className="font-mono text-xs text-slate-500">
                    {exportTotal > 0 ? `${exportCurrent} of ${exportTotal} · ${Math.round((exportCurrent / exportTotal) * 100)}%` : 'Starting…'}
                  </span>
                </div>
                <div className="w-full h-3 bg-slate-100 border border-slate-200 overflow-hidden">
                  {exportStage === 'assembling' || exportStage === 'subtitles' ? (
                    <motion.div
                      className="h-full bg-slate-900"
                      initial={{ x: '-100%' }}
                      animate={{ x: '200%' }}
                      transition={{ repeat: Infinity, duration: 1.2, ease: 'easeInOut' }}
                      style={{ width: '40%' }}
                    />
                  ) : (
                    <motion.div
                      className="h-full bg-slate-900"
                      animate={{ width: exportTotal > 0 ? `${Math.round((exportCurrent / exportTotal) * 100)}%` : '0%' }}
                      transition={{ duration: 0.4, ease: 'easeOut' }}
                    />
                  )}
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer className="mt-6 flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-6">
          <div className="flex gap-2 items-center">
            <div className={`w-3 h-3 ${stage === 'error' ? 'bg-red-500' : 'bg-green-500 animate-pulse'}`}></div>
            <span className="text-[10px] uppercase font-bold tracking-widest flex items-center gap-1">
              <ShieldCheck size={12} />
              {stage === 'error' ? 'System Halted' : 'System Nominal'}
            </span>
          </div>
          <div className="flex gap-2 items-center">
            <div className={`w-3 h-3 ${stage === 'done' ? 'bg-slate-900' : 'bg-slate-400'}`}></div>
            <span className="text-[10px] uppercase font-bold tracking-widest flex items-center gap-1">
              <Monitor size={12} />
              {stage === 'done' ? 'Uplink Complete' : 'Uplink Standby'}
            </span>
          </div>
          {activeProject && (
            <div className="flex gap-2 items-center">
              <Save size={12} className="text-slate-400" />
              <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400">
                Saved · {new Date(activeProject.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {script && (
            <>
              {ttsVoices.length > 0 && (
                <select
                  value={ttsVoice}
                  onChange={(e) => setTtsVoice(e.target.value)}
                  disabled={ttsLoading}
                  className="border border-slate-900 px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest bg-white focus:outline-none disabled:bg-slate-100"
                >
                  {ttsVoices.map(v => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              )}
              {videoId && (
                <>
                  <button
                    onClick={handleExportFinal}
                    disabled={exportLoading || clipsLoading || ttsLoading}
                    className="flex items-center gap-2 px-3 py-1.5 bg-green-700 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-green-600 transition-all disabled:bg-slate-400"
                  >
                    {exportLoading ? <Loader2 className="animate-spin" size={12} /> : <ArrowDownToLine size={12} />}
                    {exportLoading ? 'Exporting…' : 'Export Final'}
                  </button>
                  <button
                    onClick={handleGenerateClips}
                    disabled={clipsLoading || ttsLoading || exportLoading}
                    className="flex items-center gap-2 px-3 py-1.5 bg-slate-900 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-slate-700 transition-all disabled:bg-slate-400"
                  >
                    {clipsLoading ? <Loader2 className="animate-spin" size={12} /> : <Scissors size={12} />}
                    {clipsLoading ? 'Splitting…' : 'Split into Clips'}
                  </button>
                </>
              )}
              <button
                onClick={handleTTS}
                disabled={ttsLoading || clipsLoading}
                className="flex items-center gap-2 px-3 py-1.5 bg-slate-900 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-slate-700 transition-all disabled:bg-slate-400"
              >
                {ttsLoading ? <Loader2 className="animate-spin" size={12} /> : <Volume2 size={12} />}
                {ttsLoading ? 'Generating…' : 'Generate Audio'}
              </button>
              <button
                onClick={handleCopy}
                className="flex items-center gap-2 px-3 py-1.5 border border-slate-900 text-[10px] font-bold uppercase tracking-widest hover:bg-slate-900 hover:text-white transition-all"
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? 'Copied' : 'Copy Narration'}
              </button>
              <button
                onClick={() => download(
                  `${softwareName.replace(/\W+/g, '-').toLowerCase()}-script.md`,
                  toMarkdown(script, videoName),
                  'text/markdown'
                )}
                className="flex items-center gap-2 px-3 py-1.5 border border-slate-900 text-[10px] font-bold uppercase tracking-widest hover:bg-slate-900 hover:text-white transition-all"
              >
                <FileDown size={12} /> Markdown
              </button>
              <button
                onClick={() => download(
                  `${softwareName.replace(/\W+/g, '-').toLowerCase()}-script.json`,
                  JSON.stringify(script, null, 2),
                  'application/json'
                )}
                className="flex items-center gap-2 px-3 py-1.5 border border-slate-900 text-[10px] font-bold uppercase tracking-widest hover:bg-slate-900 hover:text-white transition-all"
              >
                <FileJson size={12} /> JSON
              </button>
              <button
                onClick={handleReset}
                className="flex items-center gap-2 px-3 py-1.5 border border-slate-900 text-[10px] font-bold uppercase tracking-widest hover:bg-slate-900 hover:text-white transition-all"
              >
                <RotateCcw size={12} /> New Video
              </button>
            </>
          )}
        </div>
      </footer>
    </div>
  );
}
