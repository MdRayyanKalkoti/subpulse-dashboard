# 🎥 YouTube Subscriber Goal Dashboard

Real-time subscriber tracking dashboard with OBS overlay, live chat detection, and animated alerts.

---

## 🚀 Quick Start (Local)

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
```
Edit `.env` with your values:

| Variable | Description |
|---|---|
| `YOUTUBE_API_KEY` | Your YouTube Data API v3 key |
| `YOUTUBE_CHANNEL_ID` | Your channel ID (e.g. `UCxxxxxxxxxxxxxx`) |
| `YOUTUBE_LIVE_VIDEO_ID` | Live stream video ID (for chat) |
| `SUBSCRIBER_GOAL` | Target subscriber count |
| `SUBSCRIBER_START` | Starting count (baseline) |

### 3. Run the server
```bash
npm start
# or for development with auto-reload:
npm run dev
```

### 4. Open in browser
- **Dashboard**: http://localhost:3000
- **OBS Overlay**: http://localhost:3000/overlay

---

## 🎮 Demo Mode (No API Key)

Without a YouTube API key, the app runs in **demo mode**:
- Subscriber count slowly increments automatically
- Use the **TEST CONTROLS** panel to trigger alerts manually
- Type any username and click **TRIGGER DONE** to fire the popup

---

## 🎥 OBS Setup

1. Open OBS → Add Source → **Browser Source**
2. URL: `http://localhost:3000/overlay` (or your Render URL)
3. Width: `1920` / Height: `1080`
4. ✅ Check **"Shutdown source when not visible"**
5. No chroma key needed — background is transparent

---

## 💬 How Live Chat Detection Works

1. Viewers type `DONE` in YouTube live chat
2. Server polls chat every 5 seconds via YouTube Live Chat API
3. Detects `DONE` keyword (case-insensitive)
4. Emits `subscriberDetected` event via Socket.io
5. Both dashboard and OBS overlay receive the event simultaneously
6. Popup animation fires with the viewer's username

---

## 🌐 Deploy to Render

1. Push code to a GitHub repository
2. Go to [render.com](https://render.com) → New Web Service
3. Connect your repo
4. Set environment variables in Render dashboard:
   - `YOUTUBE_API_KEY`
   - `YOUTUBE_CHANNEL_ID`
   - `YOUTUBE_LIVE_VIDEO_ID`
   - `SUBSCRIBER_GOAL`
5. Click **Deploy**

Render will auto-detect the `render.yaml` config.

---

## 🧪 API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Dashboard |
| `GET` | `/overlay` | OBS overlay |
| `GET` | `/api/state` | Current state (JSON) |
| `POST` | `/api/trigger-subscriber` | Manually fire popup `{ username }` |
| `POST` | `/api/bump-subs` | Add subscribers `{ amount }` |

---

## 📦 Tech Stack

- **Node.js** + **Express** — HTTP server
- **Socket.io** — Real-time WebSocket events
- **YouTube Data API v3** — Subscriber counts
- **YouTube Live Chat API** — Chat monitoring
- **Vanilla HTML/CSS/JS** — Zero framework frontend
- **Bebas Neue + Barlow Condensed** — Typography
- **Canvas API** — Confetti animation

---

## 🔑 Getting a YouTube API Key

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project
3. Enable **YouTube Data API v3**
4. Create credentials → API Key
5. (Optional) Restrict to YouTube Data API v3

### Finding your Channel ID
- Go to YouTube → Your Channel
- URL will be `youtube.com/channel/UC...` — copy the `UC...` part
- Or: youtube.com/account_advanced

### Finding your Live Video ID
- Start your stream
- Copy the video ID from the URL: `youtube.com/watch?v=**THIS_PART**`
