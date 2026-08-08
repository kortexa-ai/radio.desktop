import { useCallback, useEffect, useRef, useState } from "react";
import electroview from "./rpc";
import RotaryKnob from "./components/RotaryKnob";
import WaveformVisualizer from "./components/WaveformVisualizer";
import HistorySidebar from "./components/HistorySidebar";
import type { HistoryEntry, GenerateMetadata } from "../shared/types";

const GENRES = [
    "Lo-fi",
    "Ambient",
    "Jazz",
    "Classical",
    "Electronic",
    "Hip Hop",
    "Rock",
    "Pop",
    "R&B",
    "Folk",
    "Metal",
    "Synthwave",
    "Drum & Bass",
    "House",
    "Techno",
    "Cinematic",
    "Blues",
    "Reggae",
    "Country",
    "Latin",
];

const KEYS = [
    "C Major", "C Minor",
    "C# Major", "C# Minor",
    "D Major", "D Minor",
    "D# Major", "D# Minor",
    "E Major", "E Minor",
    "F Major", "F Minor",
    "F# Major", "F# Minor",
    "G Major", "G Minor",
    "G# Major", "G# Minor",
    "A Major", "A Minor",
    "A# Major", "A# Minor",
    "B Major", "B Minor",
];

const TIME_SIGNATURES = ["4/4", "3/4", "2/4", "6/8"];

const AUDIO_FORMATS = ["flac", "mp3", "wav", "opus", "aac"];

export default function App() {
    // Generation parameters
    const [caption, setCaption] = useState("A gentle lo-fi hip hop beat with warm piano chords and vinyl crackle");
    const [lyrics, setLyrics] = useState("[Instrumental]");
    const [instrumental, setInstrumental] = useState(true);
    const [genre, setGenre] = useState("Lo-fi");
    const [keyscale, setKeyscale] = useState("C Major");
    const [timesignature, setTimesignature] = useState("4/4");
    const [bpm, setBpm] = useState(120);
    const [guidanceScale, setGuidanceScale] = useState(7.0);
    const [duration, setDuration] = useState(30);
    const [inferenceSteps, setInferenceSteps] = useState(8);
    const [seed, setSeed] = useState(-1);
    const [audioFormat, setAudioFormat] = useState("mp3");

    // App state
    const [isGenerating, setIsGenerating] = useState(false);
    const [generatingStatus, setGeneratingStatus] = useState("");
    const [elapsedTime, setElapsedTime] = useState(0);
    const [progress, setProgress] = useState(0);
    const [progressStage, setProgressStage] = useState("");
    // Accumulates audio chunks sent via RPC messages
    const audioChunksRef = useRef<Record<number, string>>({});
    const [audioData, setAudioData] = useState<string | undefined>();
    const [metadata, setMetadata] = useState<GenerateMetadata | undefined>();
    const [history, setHistory] = useState<HistoryEntry[]>([]);
    const [selectedHistoryId, setSelectedHistoryId] = useState<string>();
    const [serverOnline, setServerOnline] = useState<boolean | null>(null);
    const [error, setError] = useState<string>();
    const [aiTitle, setAiTitle] = useState<string>();
    const [coverArt, setCoverArt] = useState<string>();

    // Check server health on mount
    useEffect(() => {
        const checkHealth = async () => {
            const result = await electroview.rpc!.request.checkHealth({});
            setServerOnline(result.online);
        };
        checkHealth();
        const interval = setInterval(checkHealth, 30000);
        return () => clearInterval(interval);
    }, []);

    // Load history from disk on mount
    useEffect(() => {
        electroview.rpc!.request.getHistory({}).then((r) => {
            setHistory(r.entries);
        });
    }, []);

    // Listen for status updates from main process — ALL generation state flows through here
    useEffect(() => {
        const handler = (e: CustomEvent) => {
            const d = e.detail;

            // Audio chunks: accumulate and assemble when complete
            if (d.status === "audio_chunk" && d.audioChunk !== undefined) {
                audioChunksRef.current[d.chunkIndex] = d.audioChunk;
                if (Object.keys(audioChunksRef.current).length === d.totalChunks) {
                    const full = Array.from({ length: d.totalChunks }, (_, i) => audioChunksRef.current[i]).join("");
                    setAudioData(full);
                    audioChunksRef.current = {};
                }
                return;
            }

            // AI-generated content arrived
            if (d.status === "ai_content") {
                if (d.aiTitle) setAiTitle(d.aiTitle);
                if (d.aiLyrics) setLyrics(d.aiLyrics);
                return;
            }

            // Generation complete — set metadata and stop generating state
            if (d.status === "done") {
                setMetadata(d.metadata);
                setIsGenerating(false);
                setGeneratingStatus("");
                if (d.aiTitle) setAiTitle(d.aiTitle);
                if (d.coverArt) setCoverArt(d.coverArt);
                // Refresh history (auto-saved to disk)
                electroview.rpc!.request.getHistory({}).then((r) => {
                    setHistory(r.entries);
                    if (r.entries.length > 0) setSelectedHistoryId(r.entries[0].id);
                });
                return;
            }

            // Error from bun process
            if (d.status === "error") {
                setError(d.error || "Generation failed");
                setIsGenerating(false);
                setGeneratingStatus("");
                return;
            }

            // Progress updates
            setGeneratingStatus(d.status);
            if (d.elapsed) setElapsedTime(d.elapsed);
            if (d.progress !== undefined) setProgress(d.progress);
            if (d.stage) setProgressStage(d.stage);
        };
        window.addEventListener("generationStatus", handler as EventListener);
        return () => window.removeEventListener("generationStatus", handler as EventListener);
    }, []);

    // Timer during generation
    useEffect(() => {
        if (!isGenerating) return;
        setElapsedTime(0);
        const start = Date.now();
        const interval = setInterval(() => {
            setElapsedTime(Math.floor((Date.now() - start) / 1000));
        }, 1000);
        return () => clearInterval(interval);
    }, [isGenerating]);

    // Listen for playback commands from menu/tray
    useEffect(() => {
        const handler = (e: CustomEvent) => {
            if (e.detail?.command === "generate") {
                // Trigger generate via ref to avoid stale closure
                generateRef.current?.();
            }
        };
        window.addEventListener("playbackCommand", handler as EventListener);
        return () => window.removeEventListener("playbackCommand", handler as EventListener);
    }, []);

    const generateRef = useRef<(() => void) | null>(null);

    const handleGenerate = useCallback(async () => {
        setIsGenerating(true);
        setError(undefined);
        setProgress(0);
        setProgressStage("");
        setGeneratingStatus("Sending request...");
        audioChunksRef.current = {};

        // Build caption with genre prefix
        const fullCaption = caption.toLowerCase().includes(genre.toLowerCase())
            ? caption
            : `${genre} - ${caption}`;

        // Fire and forget — all state updates come via generationStatus messages.
        // The RPC response is just an ack; we don't depend on it arriving.
        electroview.rpc!.request.generateMusic({
            caption: fullCaption,
            lyrics: instrumental ? "[Instrumental]" : lyrics,
            instrumental,
            vocal_language: "en",
            duration,
            bpm,
            keyscale,
            timesignature,
            inference_steps: inferenceSteps,
            guidance_scale: guidanceScale,
            seed,
            batch_size: 1,
            audio_format: audioFormat,
            thinking: true,
            genre,
        }).catch(() => {
            // RPC response lost — no problem, messages already handled everything
        });
    }, [caption, lyrics, instrumental, genre, keyscale, timesignature, bpm, guidanceScale, duration, inferenceSteps, seed, audioFormat]);

    // Keep ref in sync so menu/tray can trigger generate without stale closure
    generateRef.current = handleGenerate;

    const handleHistorySelect = (entry: HistoryEntry) => {
        setSelectedHistoryId(entry.id);
        // Populate form with history entry's settings
        setCaption(entry.caption);
    };

    const selectClass =
        "w-full bg-surface-700/80 border border-purple-900/30 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-accent-purple/50 transition-colors";

    return (
        <div className="flex h-screen">
            {/* Sidebar */}
            <HistorySidebar
                entries={history}
                onSelect={handleHistorySelect}
                selectedId={selectedHistoryId}
            />

            {/* Main content */}
            <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
                {/* Top bar with status */}
                <div className="flex items-center justify-between px-6 py-3 border-b border-purple-900/20">
                    <div className="flex items-center gap-2">
                        <div
                            className={`w-2 h-2 rounded-full ${
                                serverOnline === null
                                    ? "bg-yellow-500"
                                    : serverOnline
                                    ? "bg-emerald-400"
                                    : "bg-red-500"
                            }`}
                        />
                        <span className="text-xs text-slate-500">
                            {serverOnline === null
                                ? "Checking server..."
                                : serverOnline
                                ? "ACE-Step Online"
                                : "Server Offline"}
                        </span>
                    </div>
                    {metadata && (
                        <span className="text-xs text-slate-600">
                            Last: {metadata.elapsed.toFixed(1)}s on {metadata.device} | seed {metadata.seed}
                        </span>
                    )}
                </div>

                <div className="flex-1 p-6 space-y-5">
                    {/* AI Title + Cover Art */}
                    {aiTitle && (
                        <div className="flex items-center gap-4">
                            {coverArt && (
                                <img
                                    src={`data:image/png;base64,${coverArt}`}
                                    alt="Cover"
                                    className="w-16 h-16 rounded-lg shadow-lg object-cover"
                                />
                            )}
                            <div>
                                <div className="text-lg font-semibold text-slate-200">{aiTitle}</div>
                                <div className="text-xs text-slate-500">AI Generated</div>
                            </div>
                        </div>
                    )}

                    {/* Waveform Visualizer */}
                    <WaveformVisualizer
                        audioData={audioData}
                        isGenerating={isGenerating}
                        audioFormat={audioFormat}
                        songTitle={aiTitle}
                    />

                    {/* Knobs Row */}
                    <div className="flex items-center justify-center gap-12">
                        <RotaryKnob
                            label="BPM"
                            value={bpm}
                            min={30}
                            max={300}
                            step={1}
                            color="#8b5cf6"
                            onChange={setBpm}
                        />
                        <RotaryKnob
                            label="Guidance"
                            value={guidanceScale}
                            min={0}
                            max={20}
                            step={0.5}
                            color="#06b6d4"
                            onChange={setGuidanceScale}
                            formatValue={(v) => v.toFixed(1)}
                        />
                        <RotaryKnob
                            label="Seed"
                            value={seed}
                            min={-1}
                            max={9999}
                            step={1}
                            color="#d946ef"
                            onChange={setSeed}
                            formatValue={(v) => (v === -1 ? "Random" : v.toString())}
                        />
                    </div>

                    {/* Controls Grid */}
                    <div className="grid grid-cols-2 gap-4">
                        {/* Left column: dropdowns + caption */}
                        <div className="space-y-3">
                            {/* Caption / prompt */}
                            <div>
                                <label className="block text-xs text-slate-500 uppercase tracking-wider mb-1.5">
                                    Description
                                </label>
                                <textarea
                                    value={caption}
                                    onChange={(e) => setCaption(e.target.value)}
                                    rows={2}
                                    maxLength={512}
                                    placeholder="Describe the music you want to generate..."
                                    className="w-full bg-surface-700/80 border border-purple-900/30 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-accent-purple/50 resize-none transition-colors"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs text-slate-500 uppercase tracking-wider mb-1.5">
                                        Genre
                                    </label>
                                    <select
                                        value={genre}
                                        onChange={(e) => setGenre(e.target.value)}
                                        className={selectClass}
                                    >
                                        {GENRES.map((g) => (
                                            <option key={g} value={g}>{g}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs text-slate-500 uppercase tracking-wider mb-1.5">
                                        Key
                                    </label>
                                    <select
                                        value={keyscale}
                                        onChange={(e) => setKeyscale(e.target.value)}
                                        className={selectClass}
                                    >
                                        {KEYS.map((k) => (
                                            <option key={k} value={k}>{k}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs text-slate-500 uppercase tracking-wider mb-1.5">
                                        Time Sig
                                    </label>
                                    <select
                                        value={timesignature}
                                        onChange={(e) => setTimesignature(e.target.value)}
                                        className={selectClass}
                                    >
                                        {TIME_SIGNATURES.map((t) => (
                                            <option key={t} value={t}>{t}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs text-slate-500 uppercase tracking-wider mb-1.5">
                                        Format
                                    </label>
                                    <select
                                        value={audioFormat}
                                        onChange={(e) => setAudioFormat(e.target.value)}
                                        className={selectClass}
                                    >
                                        {AUDIO_FORMATS.map((f) => (
                                            <option key={f} value={f}>{f.toUpperCase()}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        </div>

                        {/* Right column: lyrics + sliders */}
                        <div className="space-y-3">
                            <div>
                                <div className="flex items-center justify-between mb-1.5">
                                    <label className="text-xs text-slate-500 uppercase tracking-wider">
                                        Lyrics
                                    </label>
                                    <label className="flex items-center gap-1.5 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={instrumental}
                                            onChange={(e) => setInstrumental(e.target.checked)}
                                            className="w-3.5 h-3.5 rounded border-purple-900/30 bg-surface-700 text-accent-purple focus:ring-accent-purple/50"
                                        />
                                        <span className="text-xs text-slate-500">
                                            Instrumental
                                        </span>
                                    </label>
                                </div>
                                <textarea
                                    value={lyrics}
                                    onChange={(e) => setLyrics(e.target.value)}
                                    rows={2}
                                    maxLength={4096}
                                    disabled={instrumental}
                                    placeholder="Write lyrics or leave as [Instrumental]..."
                                    className={`w-full bg-surface-700/80 border border-purple-900/30 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-accent-purple/50 resize-none transition-colors ${
                                        instrumental ? "opacity-40 cursor-not-allowed" : ""
                                    }`}
                                />
                            </div>

                            {/* Duration slider */}
                            <div>
                                <div className="flex items-center justify-between mb-1.5">
                                    <label className="text-xs text-slate-500 uppercase tracking-wider">
                                        Duration
                                    </label>
                                    <span className="text-xs font-mono text-accent-purple">
                                        {Math.floor(duration / 60)}:{(duration % 60).toString().padStart(2, "0")}
                                    </span>
                                </div>
                                <input
                                    type="range"
                                    min={10}
                                    max={300}
                                    step={5}
                                    value={duration}
                                    onChange={(e) => setDuration(Number(e.target.value))}
                                />
                            </div>

                            {/* Inference steps slider */}
                            <div>
                                <div className="flex items-center justify-between mb-1.5">
                                    <label className="text-xs text-slate-500 uppercase tracking-wider">
                                        Inference Steps
                                    </label>
                                    <span className="text-xs font-mono text-accent-cyan">
                                        {inferenceSteps}
                                    </span>
                                </div>
                                <input
                                    type="range"
                                    min={1}
                                    max={50}
                                    step={1}
                                    value={inferenceSteps}
                                    onChange={(e) => setInferenceSteps(Number(e.target.value))}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Error display */}
                    {error && (
                        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2.5 text-sm text-red-400">
                            {error}
                        </div>
                    )}

                    {/* Status / elapsed */}
                    {(isGenerating || generatingStatus) && (
                        <div className="text-center text-xs text-slate-500 space-y-2">
                            {isGenerating && (
                                <>
                                    <div className="w-full max-w-md mx-auto">
                                        <div className="h-1.5 bg-surface-700 rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-gradient-to-r from-accent-purple to-accent-magenta rounded-full transition-all duration-300 ease-out"
                                                style={{ width: `${Math.max(progress * 100, 2)}%` }}
                                            />
                                        </div>
                                    </div>
                                    <span className="inline-flex items-center gap-2">
                                        {progressStage || "Generating..."} — {elapsedTime}s
                                        {progress > 0 && ` (${Math.round(progress * 100)}%)`}
                                    </span>
                                </>
                            )}
                            {!isGenerating && generatingStatus && (
                                <span>{generatingStatus}</span>
                            )}
                        </div>
                    )}

                    {/* Generate + Save buttons */}
                    <div className="flex items-center justify-center gap-3 pb-2">
                        <button
                            onClick={handleGenerate}
                            disabled={isGenerating || !serverOnline || !caption.trim()}
                            className="generate-btn px-10 py-3 rounded-full bg-gradient-to-r from-accent-purple to-accent-magenta text-white font-semibold text-sm uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:scale-105"
                        >
                            {isGenerating ? "Generating..." : "Generate Song"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
