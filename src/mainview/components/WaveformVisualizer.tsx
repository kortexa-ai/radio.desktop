import { useEffect, useRef, useState } from "react";
import electroview from "../rpc";

interface WaveformVisualizerProps {
    audioData?: string; // base64 audio
    isGenerating: boolean;
    audioFormat?: string;
    songTitle?: string;
}

export default function WaveformVisualizer({
    audioData,
    isGenerating,
    audioFormat,
    songTitle,
}: WaveformVisualizerProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationRef = useRef<number>(0);
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [progress, setProgress] = useState(0);
    const [duration, setDuration] = useState(0);
    const lastAutoPlayedRef = useRef<string | undefined>(undefined);

    // Listen for playback commands from menu/tray
    useEffect(() => {
        const handler = (e: CustomEvent) => {
            const cmd = e.detail?.command;
            if (cmd === "play-pause") {
                togglePlaybackRef.current?.();
            } else if (cmd === "stop") {
                if (audioRef.current) {
                    audioRef.current.pause();
                    audioRef.current.currentTime = 0;
                    setIsPlaying(false);
                    setProgress(0);
                }
            }
        };
        window.addEventListener("playbackCommand", handler as EventListener);
        return () => window.removeEventListener("playbackCommand", handler as EventListener);
    }, []);

    const togglePlaybackRef = useRef<(() => void) | null>(null);

    // Report playback state to bun for tray updates
    useEffect(() => {
        electroview.rpc!.request.reportPlaybackState({
            state: isPlaying ? "playing" : "stopped",
        }).catch(() => { /* best effort */ });
    }, [isPlaying]);

    // Draw idle/generating animation
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        // If we have real audio data being analyzed, don't draw idle animation
        if (isPlaying) return;

        let frame = 0;
        const draw = () => {
            const w = canvas.width;
            const h = canvas.height;
            ctx.clearRect(0, 0, w, h);

            const bars = 64;
            const barWidth = w / bars - 2;
            const centerY = h / 2;

            for (let i = 0; i < bars; i++) {
                const x = i * (barWidth + 2) + 1;
                let amplitude: number;

                if (isGenerating) {
                    // Animated wave during generation
                    amplitude =
                        Math.sin(frame * 0.03 + i * 0.15) *
                        Math.sin(frame * 0.02 + i * 0.08) *
                        (h * 0.35);
                } else if (audioData) {
                    // Static waveform display from audio data
                    const t = i / bars;
                    amplitude =
                        Math.sin(t * Math.PI * 8) *
                        Math.cos(t * Math.PI * 3) *
                        (h * 0.3) *
                        (1 - Math.abs(t - 0.5) * 1.5);
                } else {
                    // Idle subtle breathing
                    amplitude =
                        Math.sin(frame * 0.01 + i * 0.1) * (h * 0.05) +
                        Math.random() * 2;
                }

                const barHeight = Math.abs(amplitude);
                const gradient = ctx.createLinearGradient(x, centerY - barHeight, x, centerY + barHeight);
                gradient.addColorStop(0, isGenerating ? "#d946ef" : "#8b5cf6");
                gradient.addColorStop(0.5, "#8b5cf6");
                gradient.addColorStop(1, "#06b6d4");

                ctx.fillStyle = gradient;
                ctx.globalAlpha = isGenerating ? 0.9 : audioData ? 0.7 : 0.3;

                // Draw symmetric bars from center
                ctx.fillRect(x, centerY - barHeight, barWidth, barHeight);
                ctx.fillRect(x, centerY, barWidth, barHeight);
            }

            ctx.globalAlpha = 1;
            frame++;
            animationRef.current = requestAnimationFrame(draw);
        };

        draw();
        return () => cancelAnimationFrame(animationRef.current);
    }, [isGenerating, audioData, isPlaying]);

    // Draw real-time frequency analysis when playing
    useEffect(() => {
        if (!isPlaying || !analyserRef.current) return;

        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const analyser = analyserRef.current;
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const draw = () => {
            analyser.getByteFrequencyData(dataArray);
            const w = canvas.width;
            const h = canvas.height;
            ctx.clearRect(0, 0, w, h);

            const bars = 64;
            const barWidth = w / bars - 2;
            const centerY = h / 2;
            const step = Math.floor(bufferLength / bars);

            for (let i = 0; i < bars; i++) {
                const idx = i * step;
                const value = dataArray[idx] / 255;
                const barHeight = value * (h * 0.4);

                const x = i * (barWidth + 2) + 1;
                const gradient = ctx.createLinearGradient(x, centerY - barHeight, x, centerY + barHeight);
                gradient.addColorStop(0, "#d946ef");
                gradient.addColorStop(0.5, "#8b5cf6");
                gradient.addColorStop(1, "#06b6d4");

                ctx.fillStyle = gradient;
                ctx.globalAlpha = 0.9;
                ctx.fillRect(x, centerY - barHeight, barWidth, barHeight);
                ctx.fillRect(x, centerY, barWidth, barHeight);
            }

            ctx.globalAlpha = 1;
            animationRef.current = requestAnimationFrame(draw);
        };

        draw();
        return () => cancelAnimationFrame(animationRef.current);
    }, [isPlaying]);

    // Track progress
    useEffect(() => {
        if (!audioRef.current || !isPlaying) return;
        const audio = audioRef.current;
        const interval = setInterval(() => {
            if (audio.duration) {
                setProgress(audio.currentTime / audio.duration);
                setDuration(audio.duration);
            }
        }, 100);
        return () => clearInterval(interval);
    }, [isPlaying]);

    const startPlayback = (data: string) => {
        // Stop existing playback
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current = null;
        }

        const mimeType =
            audioFormat === "mp3" ? "audio/mpeg" :
            audioFormat === "wav" || audioFormat === "wav32" ? "audio/wav" :
            audioFormat === "opus" ? "audio/opus" :
            audioFormat === "aac" ? "audio/aac" :
            "audio/flac";

        const audio = new Audio(`data:${mimeType};base64,${data}`);
        audioRef.current = audio;

        // Set up Web Audio API for analysis
        if (!audioContextRef.current) {
            audioContextRef.current = new AudioContext();
        }
        const ctx = audioContextRef.current;

        if (sourceRef.current) {
            sourceRef.current.disconnect();
        }
        const source = ctx.createMediaElementSource(audio);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyser.connect(ctx.destination);
        sourceRef.current = source;
        analyserRef.current = analyser;

        audio.onended = () => {
            setIsPlaying(false);
            setProgress(0);
        };

        audio.play();
        setIsPlaying(true);
    };

    // Autoplay when new audio arrives
    useEffect(() => {
        if (!audioData || audioData === lastAutoPlayedRef.current) return;
        lastAutoPlayedRef.current = audioData;
        startPlayback(audioData);
    }, [audioData]);

    const togglePlayback = () => {
        if (!audioData) return;

        if (isPlaying && audioRef.current) {
            audioRef.current.pause();
            setIsPlaying(false);
            return;
        }

        startPlayback(audioData);
    };

    // Keep ref in sync for menu/tray commands
    togglePlaybackRef.current = togglePlayback;

    const formatTime = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, "0")}`;
    };

    return (
        <div className="relative rounded-xl bg-surface-800/60 border border-purple-900/30 p-4 backdrop-blur">
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
                Audio Visualizer
            </div>
            <canvas
                ref={canvasRef}
                width={800}
                height={140}
                className="w-full h-[140px] rounded-lg cursor-pointer"
                onClick={togglePlayback}
            />
            {/* Progress bar */}
            {audioData && (
                <div className="mt-2 flex items-center gap-3">
                    <button
                        onClick={togglePlayback}
                        className="w-8 h-8 rounded-full bg-accent-purple/20 border border-accent-purple/40 flex items-center justify-center hover:bg-accent-purple/30 transition-colors"
                    >
                        {isPlaying ? (
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="#8b5cf6">
                                <rect x="2" y="1" width="3" height="10" rx="0.5" />
                                <rect x="7" y="1" width="3" height="10" rx="0.5" />
                            </svg>
                        ) : (
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="#8b5cf6">
                                <polygon points="2,1 10,6 2,11" />
                            </svg>
                        )}
                    </button>
                    <div className="flex-1 h-1 bg-surface-600 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-gradient-to-r from-accent-purple to-accent-cyan rounded-full transition-all"
                            style={{ width: `${progress * 100}%` }}
                        />
                    </div>
                    <span className="text-xs text-slate-500 font-mono w-12 text-right">
                        {duration > 0
                            ? formatTime(progress * duration)
                            : "0:00"}
                    </span>
                </div>
            )}
        </div>
    );
}
