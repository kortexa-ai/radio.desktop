# Radio Desktop

A macOS desktop app for AI music generation. Generate songs with lyrics, cover art, and full MP4 video — all from a text description.

Built with [Electrobun](https://electrobun.dev), React, and Tailwind CSS.

## Features

- **AI Music Generation** — Powered by [ACE-Step 1.5](https://github.com/ace-step/ACE-Step) via a local generation server
- **AI Lyrics & Titles** — Auto-generated song titles and lyrics using Kimi K2.5
- **AI Cover Art** — Album artwork generated with Nanobanana (Gemini 3 Pro image model)
- **Real-time Visualizer** — Frequency analysis waveform during playback
- **Auto-save** — Every generation saves `.mp3`, `.png` cover, `.txt` lyrics, and `.mp4` video to `~/Music/RadioDesktop/`
- **System Tray** — Shows generation status, song title, and playback controls
- **Keyboard Shortcuts** — Cmd+G to generate, Cmd+P to play/pause
- **Generation Controls** — Genre, BPM, key, time signature, duration, guidance scale, inference steps, seed

## Dependencies

### Music Generation Server (required)

This app requires [music-gen.server](https://github.com/kortexa-ai/music-gen.server) running locally on port 4009. It provides the ACE-Step 1.5 inference backend.

```bash
# Clone and run the music server
git clone https://github.com/kortexa-ai/music-gen.server.git
cd music-gen.server
# Follow setup instructions in its README
```

### AI Services (optional)

Lyrics, titles, and cover art are generated via the Kortexa API, which proxies requests to:

- **Kimi K2.5** (via DeepInfra) — song title and lyrics generation
- **Nanobanana / Gemini 3 Pro** (via fal.ai) — cover art generation

These features require a `KORTEXA_API_KEY` in your `.env` file. If the API key is missing or calls fail, the app falls back gracefully — music generation still works, you just won't get AI titles, lyrics, or cover art.

> Direct integration with DeepInfra and fal.ai (without the Kortexa proxy) is in the works.

### ffmpeg (optional)

If [ffmpeg](https://ffmpeg.org/) is installed, the app automatically produces an MP4 video (still image + audio) alongside each generation. If ffmpeg is not found, video production is silently skipped.

```bash
brew install ffmpeg
```

## Setup

```bash
# Install dependencies
bun install

# Copy .env and add your API key
cp .env.example .env

# Run in development mode
bun run dev

# Or with Vite HMR
bun run dev:hmr
```

## Building

```bash
# Canary build
bun run build:canary

# Stable build
bun run build:stable
```

## Project Structure

```
src/
  bun/          # Main process (Electrobun/Bun)
    index.ts    # Window, tray, menus, AI helpers, generation flow
  mainview/     # Renderer (React)
    App.tsx     # Main UI
    rpc.ts      # RPC bridge
    components/ # WaveformVisualizer, HistorySidebar, RotaryKnob
  shared/
    types.ts    # RPC type definitions
```

## How It Works

1. You describe a song (text prompt, genre, BPM, key, etc.)
2. The app generates a title and lyrics using Kimi K2.5
3. ACE-Step 1.5 generates the audio via SSE streaming
4. Cover art is generated with Nanobanana
5. Files are saved: audio (.mp3), cover (.png), lyrics (.txt), video (.mp4)
6. Audio plays automatically with real-time frequency visualization

## License

[MIT](LICENSE)
