import type { RPCSchema } from "electrobun/bun";

export type AppRPC = {
    bun: RPCSchema<{
        requests: {
            // Renderer asks main to generate music
            generateMusic: {
                params: {
                    caption: string;
                    lyrics: string;
                    instrumental: boolean;
                    vocal_language: string;
                    duration: number;
                    bpm: number;
                    keyscale: string;
                    timesignature: string;
                    inference_steps: number;
                    guidance_scale: number;
                    seed: number;
                    batch_size: number;
                    audio_format: string;
                    thinking: boolean;
                    genre: string;
                };
                response: {
                    success: boolean;
                    error?: string;
                };
            };
            // Check server health
            checkHealth: {
                params: {};
                response: {
                    online: boolean;
                    device?: string;
                    dit_config?: string;
                };
            };
            // Get generation history
            getHistory: {
                params: {};
                response: { entries: HistoryEntry[] };
            };
            // Report playback state to bun for tray updates
            reportPlaybackState: {
                params: { state: "playing" | "stopped" };
                response: {};
            };
        };
        messages: {};
    }>;
    webview: RPCSchema<{
        requests: {};
        messages: {
            // Main tells renderer generation status
            generationStatus: {
                status: string;
                elapsed?: number;
                progress?: number;
                stage?: string;
                // Audio sent in chunks to avoid large RPC responses
                audioChunk?: string;
                chunkIndex?: number;
                totalChunks?: number;
                // Sent with status="done"
                metadata?: GenerateMetadata;
                error?: string;
                // AI-generated content
                aiTitle?: string;
                aiLyrics?: string;
                coverArt?: string;
            };
            // Playback commands from menu/tray
            playbackCommand: {
                command: "play-pause" | "stop" | "generate";
            };
        };
    }>;
};

export interface GenerateMetadata {
    request_type: string;
    dit_config: string;
    device: string;
    dtype: string;
    caption: string;
    duration: number;
    steps: number;
    guidance_scale: number;
    seed: number;
    elapsed: number;
    num_audios: number;
    audio_format: string;
    lm_enabled: boolean;
}

export interface HistoryEntry {
    id: string;
    caption: string;
    timestamp: number;
    duration: number;
    audioFormat: string;
    seed: number;
    filePath?: string;
    coverPath?: string;
}
