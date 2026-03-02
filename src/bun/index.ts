import {
    BrowserWindow,
    BrowserView,
    Tray,
    ApplicationMenu,
    Updater,
} from "electrobun/bun";
import Electrobun from "electrobun/bun";
import type { AppRPC, HistoryEntry } from "../shared/types";

import { mkdirSync, writeFileSync, readdirSync, statSync, existsSync } from "fs";

const MUSIC_SERVER = "http://127.0.0.1:4009";
const MUSIC_DIR = `${process.env.HOME || "/tmp"}/Music/RadioDesktop`;
const KORTEXA_API = "https://api.kortexa.ai";
const KORTEXA_KEY = process.env.KORTEXA_API_KEY || "";

// Tray state
let trayState: "idle" | "generating" | "playing" = "idle";
let traySongTitle = "";
let trayCoverPath = "";

// Ensure music dir exists
mkdirSync(MUSIC_DIR, { recursive: true });

// --- AI Helper Functions ---

async function generateLyricsAndTitle(params: {
    caption: string;
    genre: string;
    bpm: number;
    keyscale: string;
    duration: number;
    instrumental: boolean;
}): Promise<{ title: string; lyrics: string }> {
    try {
        const userPrompt = [
            `Genre: ${params.genre}`,
            `BPM: ${params.bpm}, Key: ${params.keyscale}`,
            `Duration: ${params.duration} seconds`,
            params.instrumental ? "Style: Instrumental (write atmospheric/mood lyrics that complement the music)" : "",
            `Description: ${params.caption}`,
        ].filter(Boolean).join("\n");

        const res = await fetch(`${KORTEXA_API}/v1/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${KORTEXA_KEY}`,
                "X-Kortexa-Provider": "deepinfra",
            },
            body: JSON.stringify({
                model: "moonshotai/Kimi-K2.5",
                chat_template_kwargs: { thinking: false },
                messages: [
                    {
                        role: "system",
                        content: "You are a songwriter. Generate a song title and lyrics based on the given parameters. Return ONLY valid JSON with this exact format: {\"title\": \"Song Title\", \"lyrics\": \"[Verse 1]\\nLyrics here...\\n\\n[Chorus]\\nChorus here...\"}. No markdown, no code fences, just JSON.",
                    },
                    { role: "user", content: userPrompt },
                ],
                temperature: 0.8,
                max_tokens: 1024,
            }),
        });

        if (!res.ok) {
            console.warn("[ai] Lyrics API error:", res.status);
            return { title: params.caption.slice(0, 60), lyrics: "[Instrumental]" };
        }

        const data = await res.json();
        const content = data.choices?.[0]?.message?.content || "";
        // Try to extract JSON from the response
        const jsonMatch = content.match(/\{[\s\S]*"title"[\s\S]*"lyrics"[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            return {
                title: parsed.title || params.caption.slice(0, 60),
                lyrics: parsed.lyrics || "[Instrumental]",
            };
        }
        console.warn("[ai] Could not parse lyrics JSON, using caption as title");
        return { title: params.caption.slice(0, 60), lyrics: "[Instrumental]" };
    } catch (err: any) {
        console.warn("[ai] Lyrics generation failed:", err.message);
        return { title: params.caption.slice(0, 60), lyrics: "[Instrumental]" };
    }
}

async function generateCoverArt(params: {
    title: string;
    genre: string;
    caption: string;
}): Promise<string | null> {
    try {
        const prompt = `Album cover art for a ${params.genre} song titled '${params.title}'. ${params.caption}. Music album artwork, artistic, high quality`;
        const res = await fetch(`${KORTEXA_API}/v1/images/generations`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${KORTEXA_KEY}`,
            },
            body: JSON.stringify({
                model: "gemini-3-pro-image-preview",
                prompt,
                size: "1024x1024",
                response_format: "b64_json",
            }),
        });

        if (!res.ok) {
            console.warn("[ai] Cover art API error:", res.status);
            return null;
        }

        const data = await res.json();
        return data.data?.[0]?.b64_json || null;
    } catch (err: any) {
        console.warn("[ai] Cover art generation failed:", err.message);
        return null;
    }
}

// Check if Vite HMR server is running
async function getMainViewUrl(): Promise<string> {
    const channel = await Updater.localInfo.channel();
    if (channel === "dev") {
        try {
            await fetch("http://localhost:5173", { method: "HEAD" });
            console.log("HMR enabled: Using Vite dev server");
            return "http://localhost:5173";
        } catch {
            console.log("Vite not running. Use 'bun run dev:hmr' for HMR.");
        }
    }
    return "views://mainview/index.html";
}

// Define RPC handlers for webview requests
// Music generation can take 60s+ so we need a generous timeout
const rpc = BrowserView.defineRPC<AppRPC>({
    maxRequestTime: 600000,
    handlers: {
        requests: {
            generateMusic: async (params) => {
                // All real state flows via rpc.send messages (progress, audio chunks, done).
                // The RPC response is just an ack — we don't depend on it reaching the webview.
                try {
                    trayState = "generating";
                    updateTray();

                    // Step 1: AI lyrics & title
                    console.log("[generate] Generating AI lyrics & title...");
                    rpc.send.generationStatus({ status: "Writing lyrics...", progress: 0 });
                    const ai = await generateLyricsAndTitle({
                        caption: params.caption,
                        genre: params.genre,
                        bpm: params.bpm,
                        keyscale: params.keyscale,
                        duration: params.duration,
                        instrumental: params.instrumental,
                    });
                    console.log("[generate] AI title:", ai.title);

                    // Send AI content to webview
                    rpc.send.generationStatus({
                        status: "ai_content",
                        aiTitle: ai.title,
                        aiLyrics: ai.lyrics,
                    });

                    // Override lyrics with AI-generated ones for the music server
                    const musicParams = {
                        ...params,
                        lyrics: params.instrumental ? ai.lyrics : params.lyrics,
                        caption: params.caption,
                    };

                    // Step 2: Generate music via SSE
                    console.log("[generate] Starting SSE request:", musicParams.caption);
                    const res = await fetch(`${MUSIC_SERVER}/generate/stream`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(musicParams),
                    });

                    console.log("[generate] Server responded:", res.status);

                    if (!res.ok) {
                        const text = await res.text();
                        rpc.send.generationStatus({ status: "error", error: `Server error ${res.status}: ${text}` });
                        trayState = "idle"; updateTray();
                        return { success: false, error: `Server error ${res.status}: ${text}` };
                    }

                    if (!res.body) {
                        rpc.send.generationStatus({ status: "error", error: "No response body" });
                        trayState = "idle"; updateTray();
                        return { success: false, error: "No response body (streaming not supported)" };
                    }

                    // Parse SSE events from the stream
                    const audioChunks: Map<number, string[]> = new Map();
                    let metadata: any = undefined;
                    let streamError: string | undefined;

                    const reader = res.body.getReader();
                    const decoder = new TextDecoder();
                    let sseBuffer = "";
                    // Persist across read() calls — a single SSE event can span multiple chunks
                    let currentEvent = "";
                    let currentData = "";

                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;

                        sseBuffer += decoder.decode(value, { stream: true });
                        const lines = sseBuffer.split("\n");
                        sseBuffer = lines.pop() || "";

                        for (const line of lines) {
                            if (line.startsWith("event: ")) {
                                currentEvent = line.slice(7).trim();
                            } else if (line.startsWith("data: ")) {
                                currentData = line.slice(6);
                            } else if (line === "" && currentEvent && currentData) {
                                try {
                                    const payload = JSON.parse(currentData);
                                    switch (currentEvent) {
                                        case "progress":
                                            try {
                                                rpc.send.generationStatus({
                                                    status: payload.stage || "Generating...",
                                                    progress: payload.value,
                                                    stage: payload.stage,
                                                });
                                            } catch (e: any) {
                                                console.warn("[generate] Failed to send progress:", e.message);
                                            }
                                            break;
                                        case "audio_chunk": {
                                            const idx = payload.audio_index ?? 0;
                                            if (!audioChunks.has(idx)) audioChunks.set(idx, []);
                                            audioChunks.get(idx)![payload.chunk_index] = payload.data;
                                            break;
                                        }
                                        case "metadata":
                                            metadata = payload;
                                            break;
                                        case "error":
                                            streamError = payload.detail;
                                            break;
                                        case "done":
                                            console.log("[generate] SSE done:", payload.elapsed, "s");
                                            break;
                                    }
                                } catch {
                                    console.warn("[generate] Failed to parse SSE data:", currentData.slice(0, 100));
                                }
                                currentEvent = "";
                                currentData = "";
                            }
                        }
                    }

                    if (streamError) {
                        rpc.send.generationStatus({ status: "error", error: streamError });
                        trayState = "idle"; updateTray();
                        return { success: false, error: streamError };
                    }

                    // Reassemble audio from server SSE chunks
                    const audioBase64 = audioChunks.has(0) ? audioChunks.get(0)!.join("") : "";
                    console.log("[generate] Got audio, base64 length:", audioBase64.length);

                    // Step 3: Generate cover art
                    rpc.send.generationStatus({ status: "Creating cover art...", progress: 0.95 });
                    const coverBase64 = await generateCoverArt({
                        title: ai.title,
                        genre: params.genre,
                        caption: params.caption,
                    });

                    // Step 4: Save files — use AI title for filename
                    const safeName = ai.title
                        .replace(/[^a-zA-Z0-9\s-]/g, "")
                        .replace(/\s+/g, "-")
                        .slice(0, 50);
                    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
                    const baseName = `${safeName}-${timestamp}`;

                    // Audio file
                    const audioPath = `${MUSIC_DIR}/${baseName}.${params.audio_format}`;
                    writeFileSync(audioPath, Buffer.from(audioBase64, "base64"));
                    console.log("[generate] Saved audio:", audioPath);

                    // Cover art
                    let coverPath: string | undefined;
                    if (coverBase64) {
                        coverPath = `${MUSIC_DIR}/${baseName}.png`;
                        writeFileSync(coverPath, Buffer.from(coverBase64, "base64"));
                        console.log("[generate] Saved cover:", coverPath);
                    }

                    // Lyrics file
                    const lyricsPath = `${MUSIC_DIR}/${baseName}.txt`;
                    writeFileSync(lyricsPath, `${ai.title}\n\n${ai.lyrics}`);
                    console.log("[generate] Saved lyrics:", lyricsPath);

                    // Step 5: Produce MP4 video (if cover exists and ffmpeg available)
                    if (coverPath) {
                        try {
                            rpc.send.generationStatus({ status: "Producing video...", progress: 0.97 });
                            const mp4Path = `${MUSIC_DIR}/${baseName}.mp4`;
                            const proc = Bun.spawn([
                                "ffmpeg", "-y", "-loop", "1", "-i", coverPath, "-i", audioPath,
                                "-c:v", "libx264", "-tune", "stillimage", "-c:a", "aac", "-b:a", "192k",
                                "-vf", "scale=1080:1080", "-pix_fmt", "yuv420p", "-shortest", mp4Path,
                            ], { stdout: "ignore", stderr: "ignore" });
                            await proc.exited;
                            if (proc.exitCode === 0) {
                                console.log("[generate] Saved video:", mp4Path);
                            } else {
                                console.warn("[generate] ffmpeg exited with code", proc.exitCode);
                            }
                        } catch {
                            // ffmpeg not found — skip silently
                            console.warn("[generate] ffmpeg not available, skipping MP4");
                        }
                    }

                    // Step 6: Send audio to webview in small chunks via messages
                    const RPC_CHUNK_SIZE = 100 * 1024;
                    const totalRpcChunks = Math.ceil(audioBase64.length / RPC_CHUNK_SIZE);
                    console.log("[generate] Sending audio to webview in", totalRpcChunks, "chunks");
                    for (let i = 0; i < totalRpcChunks; i++) {
                        try {
                            rpc.send.generationStatus({
                                status: "audio_chunk",
                                audioChunk: audioBase64.slice(i * RPC_CHUNK_SIZE, (i + 1) * RPC_CHUNK_SIZE),
                                chunkIndex: i,
                                totalChunks: totalRpcChunks,
                            });
                        } catch (e: any) {
                            console.error("[generate] Failed to send audio chunk", i, ":", e.message);
                        }
                    }

                    // Send done message with metadata + cover
                    rpc.send.generationStatus({
                        status: "done",
                        metadata,
                        coverArt: coverBase64 || undefined,
                        aiTitle: ai.title,
                    });

                    // Update tray
                    trayState = "idle";
                    traySongTitle = ai.title;
                    trayCoverPath = coverPath || "";
                    updateTray();

                    return { success: true };
                } catch (err: any) {
                    trayState = "idle"; updateTray();
                    try {
                        rpc.send.generationStatus({ status: "error", error: err.message });
                    } catch { /* best effort */ }
                    return {
                        success: false,
                        error: err.message || "Failed to connect to music server",
                    };
                }
            },

            checkHealth: async () => {
                try {
                    const res = await fetch(`${MUSIC_SERVER}/health`);
                    if (!res.ok) return { online: false };
                    const data = await res.json();
                    return {
                        online: data.status === "ok",
                        device: data.device,
                        dit_config: data.dit_config,
                    };
                } catch {
                    return { online: false };
                }
            },

            getHistory: async () => {
                try {
                    const files = readdirSync(MUSIC_DIR)
                        .filter((f: string) => /\.(flac|mp3|wav|opus|aac)$/i.test(f))
                        .map((f: string) => {
                            const fpath = `${MUSIC_DIR}/${f}`;
                            const stat = statSync(fpath);
                            const ext = f.split(".").pop() || "flac";
                            // Parse caption from filename: strip timestamp suffix and extension
                            const nameWithoutExt = f.replace(/\.\w+$/, "");
                            const caption = nameWithoutExt
                                .replace(/-\d{4}-\d{2}-\d{2}T[\d-]+Z?$/, "")
                                .replace(/-/g, " ")
                                .trim() || f;
                            // Check for companion cover art
                            const coverFile = `${MUSIC_DIR}/${nameWithoutExt}.png`;
                            const coverPath = existsSync(coverFile) ? coverFile : undefined;
                            return {
                                id: f,
                                caption,
                                timestamp: stat.mtimeMs,
                                duration: 0,
                                audioFormat: ext,
                                seed: 0,
                                filePath: fpath,
                                coverPath,
                            } as HistoryEntry;
                        })
                        .sort((a: HistoryEntry, b: HistoryEntry) => b.timestamp - a.timestamp)
                        .slice(0, 50);
                    return { entries: files };
                } catch {
                    return { entries: [] };
                }
            },

            reportPlaybackState: async (params) => {
                if (params.state === "playing") {
                    trayState = "playing";
                } else {
                    trayState = "idle";
                }
                updateTray();
                return {};
            },
        },
        messages: {},
    },
});

// Create the main window
const url = await getMainViewUrl();

const mainWindow = new BrowserWindow({
    title: "Radio Desktop",
    url,
    frame: {
        width: 1100,
        height: 900,
        x: 150,
        y: 100,
    },
    rpc,
});

// System tray
const tray = new Tray({
    title: "Radio",
});

function updateTray() {
    switch (trayState) {
        case "generating":
            tray.setTitle("Generating...");
            tray.setMenu([
                { type: "normal", label: "Generating...", action: "noop" },
                { type: "divider" },
                { type: "normal", label: "Show", action: "show" },
                { type: "normal", label: "Hide", action: "hide" },
                { type: "divider" },
                { type: "normal", label: "Quit", action: "quit" },
            ]);
            break;
        case "playing":
            tray.setTitle(`▶ ${traySongTitle || "Playing"}`);
            if (trayCoverPath) {
                try { tray.setImage(trayCoverPath); } catch { /* ignore */ }
            }
            tray.setMenu([
                { type: "normal", label: traySongTitle || "Now Playing", action: "noop" },
                { type: "divider" },
                { type: "normal", label: "Pause", action: "pause" },
                { type: "normal", label: "Stop", action: "stop" },
                { type: "divider" },
                { type: "normal", label: "Show", action: "show" },
                { type: "normal", label: "Hide", action: "hide" },
                { type: "divider" },
                { type: "normal", label: "Quit", action: "quit" },
            ]);
            break;
        default: // idle
            tray.setTitle("Radio");
            tray.setMenu([
                ...(traySongTitle ? [
                    { type: "normal" as const, label: traySongTitle, action: "noop" },
                    { type: "divider" as const },
                ] : []),
                { type: "normal", label: "Show", action: "show" },
                { type: "normal", label: "Hide", action: "hide" },
                { type: "divider" },
                { type: "normal", label: "Quit", action: "quit" },
            ]);
            break;
    }
}

updateTray();

tray.on("tray-clicked", (event: any) => {
    const action = event.data?.action;
    switch (action) {
        case "show":
            mainWindow.focus();
            break;
        case "hide":
            mainWindow.minimize();
            break;
        case "pause":
            rpc.send.playbackCommand({ command: "play-pause" });
            break;
        case "stop":
            rpc.send.playbackCommand({ command: "stop" });
            break;
        case "quit":
            tray.remove();
            process.exit(0);
            break;
    }
});

// Application menu
ApplicationMenu.setApplicationMenu([
    {
        submenu: [
            { label: "About Radio Desktop", role: "about" },
            { type: "separator" },
            { label: "Hide", role: "hide", accelerator: "h" },
            { label: "Hide Others", role: "hideOthers", accelerator: "Alt+h" },
            { label: "Show All", role: "showAll" },
            { type: "separator" },
            { label: "Quit Radio Desktop", role: "quit", accelerator: "q" },
        ],
    },
    {
        label: "Edit",
        submenu: [
            { role: "undo" },
            { role: "redo" },
            { type: "separator" },
            { role: "cut" },
            { role: "copy" },
            { role: "paste" },
            { role: "selectAll" },
        ],
    },
    {
        label: "Playback",
        submenu: [
            { label: "Generate", action: "generate", accelerator: "CommandOrControl+G" },
            { label: "Play/Pause", action: "play-pause", accelerator: "CommandOrControl+P" },
        ],
    },
    {
        label: "Window",
        submenu: [
            { role: "minimize" },
            { role: "close" },
        ],
    },
]);

// Handle custom menu actions
Electrobun.events.on("application-menu-clicked", (event: any) => {
    const action = event.data?.action;
    if (action === "generate" || action === "play-pause") {
        rpc.send.playbackCommand({ command: action });
    }
});

console.log("Radio Desktop started!");
