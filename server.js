require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const axios = require("axios");
const cors = require("cors");
const path = require("path");

// ─── Config ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.YOUTUBE_API_KEY || "";
const CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID || "";
const LIVE_VIDEO_ID = process.env.YOUTUBE_LIVE_VIDEO_ID || "";
const SUBSCRIBER_GOAL = parseInt(process.env.SUBSCRIBER_GOAL || "200", 10);
const SUBSCRIBER_START = parseInt(process.env.SUBSCRIBER_START || "81", 10);
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS || "30000", 10);
const CHAT_POLL_INTERVAL = parseInt(process.env.CHAT_POLL_INTERVAL_MS || "5000", 10);
const SHORTS_VIDEO_ID = process.env.YOUTUBE_SHORTS_VIDEO_ID || "";
const VIEWS_GOAL = parseInt(process.env.VIEWS_GOAL || "1000", 10);

// ─── App Setup ────────────────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ─── State ────────────────────────────────────────────────────────────────────
let state = {
  subscribers: SUBSCRIBER_START,
  goal: SUBSCRIBER_GOAL,
  liveChatId: null,
  nextPageToken: null,
  lastSubCount: SUBSCRIBER_START,
  milestones: [25, 50, 75, 100].map((pct) =>
    Math.floor((SUBSCRIBER_GOAL * pct) / 100)
  ),
  reachedMilestones: new Set(),
  isApiConfigured: !!(API_KEY && CHANNEL_ID),
  isLiveChatConfigured: !!(API_KEY && LIVE_VIDEO_ID),
  // Shorts views
  shortsViews: 0,
  viewsGoal: VIEWS_GOAL,
  lastShortsViews: 0,
  isShortsConfigured: !!(API_KEY && SHORTS_VIDEO_ID),
};

console.log("─".repeat(50));
console.log("🎥  YouTube Subscriber Dashboard");
console.log("─".repeat(50));
console.log(`📊  Goal: ${SUBSCRIBER_GOAL.toLocaleString()} subscribers`);
console.log(`🔑  API configured: ${state.isApiConfigured}`);
console.log(`💬  Live chat configured: ${state.isLiveChatConfigured}`);
console.log(`🎬  Shorts views configured: ${state.isShortsConfigured}`);
console.log("─".repeat(50));

// ─── YouTube API Helpers ──────────────────────────────────────────────────────

async function fetchSubscriberCount() {
  if (!API_KEY || !CHANNEL_ID) {
    // Demo mode: simulate slow growth
    state.subscribers = state.subscribers + Math.floor(Math.random() * 3);
    return state.subscribers;
  }

  try {
    const res = await axios.get(
      "https://www.googleapis.com/youtube/v3/channels",
      {
        params: {
          part: "statistics",
          id: CHANNEL_ID,
          key: API_KEY,
        },
      }
    );

    const items = res.data.items;
    if (!items || items.length === 0) {
      console.warn("⚠️  No channel data returned — check CHANNEL_ID");
      return state.subscribers;
    }

    const count = parseInt(items[0].statistics.subscriberCount, 10);
    console.log(
      `📈  Subscribers: ${count.toLocaleString()} / ${SUBSCRIBER_GOAL.toLocaleString()}`
    );
    return count;
  } catch (err) {
    console.error("❌  Failed to fetch subscriber count:", err.message);
    return state.subscribers;
  }
}

async function fetchLiveChatId() {
  if (!API_KEY || !LIVE_VIDEO_ID) return null;

  try {
    const res = await axios.get(
      "https://www.googleapis.com/youtube/v3/videos",
      {
        params: {
          part: "liveStreamingDetails",
          id: LIVE_VIDEO_ID,
          key: API_KEY,
        },
      }
    );

    const items = res.data.items;
    if (!items || items.length === 0) return null;

    const chatId =
      items[0]?.liveStreamingDetails?.activeLiveChatId || null;
    if (chatId) console.log(`💬  Live chat ID found: ${chatId}`);
    else console.warn("⚠️  No active live chat found for this video");
    return chatId;
  } catch (err) {
    console.error("❌  Failed to fetch live chat ID:", err.message);
    return null;
  }
}

async function fetchLiveChatMessages() {
  if (!state.liveChatId) return;

  try {
    const params = {
      part: "snippet,authorDetails",
      liveChatId: state.liveChatId,
      key: API_KEY,
      maxResults: 200,
    };
    if (state.nextPageToken) params.pageToken = state.nextPageToken;

    const res = await axios.get(
      "https://www.googleapis.com/youtube/v3/liveChat/messages",
      { params }
    );

    state.nextPageToken = res.data.nextPageToken;

    const messages = res.data.items || [];
    for (const msg of messages) {
      const text = msg.snippet?.displayMessage || "";
      const author = msg.authorDetails?.displayName || "Unknown";

      // Broadcast every message to dashboard clients
      io.emit("chatMessage", { author, text });

      // Detect DONE keyword (case-insensitive)
      if (/\bDONE\b/i.test(text)) {
        console.log(`🔔  DONE detected from: ${author}`);
        io.emit("subscriberDetected", { username: author });
      }
    }
  } catch (err) {
    if (err.response?.status === 403) {
      console.error("❌  Live chat API quota exceeded or forbidden");
      state.liveChatId = null; // Stop polling to avoid further quota use
    } else {
      console.error("❌  Live chat fetch error:", err.message);
    }
  }
}

// ─── Shorts Views Fetching ────────────────────────────────────────────────────

async function fetchShortsViews() {
  if (!state.isShortsConfigured) return state.shortsViews;
  try {
    const res = await axios.get("https://www.googleapis.com/youtube/v3/videos", {
      params: {
        key: API_KEY,
        id: SHORTS_VIDEO_ID,
        part: "statistics",
      },
    });
    const items = res.data.items;
    if (items && items.length > 0) {
      return parseInt(items[0].statistics.viewCount || "0", 10);
    }
  } catch (err) {
    console.error("❌  Shorts views fetch error:", err.message);
  }
  return state.shortsViews;
}

async function pollShortsViews() {
  const newViews = await fetchShortsViews();
  const gained = newViews - state.lastShortsViews;
  state.shortsViews = newViews;
  state.lastShortsViews = newViews;
  io.emit("viewsUpdate", {
    views: newViews,
    viewsGoal: state.viewsGoal,
    gained: gained > 0 ? gained : 0,
  });
  if (gained > 0) {
    console.log(`👀  Shorts views: ${newViews.toLocaleString()} (+${gained})`);
  }
}

// ─── Subscriber Polling ───────────────────────────────────────────────────────

async function pollSubscribers() {
  const newCount = await fetchSubscriberCount();
  const gained = newCount - state.lastSubCount;

  if (gained > 0) {
    console.log(`🎉  +${gained} new subscriber(s)!`);
    io.emit("subscriberUpdate", {
      count: newCount,
      goal: state.goal,
      gained,
    });

    // Check milestones
    for (const milestone of state.milestones) {
      if (
        newCount >= milestone &&
        !state.reachedMilestones.has(milestone)
      ) {
        state.reachedMilestones.add(milestone);
        const pct = Math.round((milestone / state.goal) * 100);
        console.log(`🏆  Milestone reached: ${milestone} (${pct}%)`);
        io.emit("milestoneReached", { count: milestone, percent: pct });
      }
    }
  }

  state.subscribers = newCount;
  state.lastSubCount = newCount;

  io.emit("subscriberUpdate", {
    count: newCount,
    goal: state.goal,
    gained: gained > 0 ? gained : 0,
  });
}

// ─── HTTP Routes ──────────────────────────────────────────────────────────────

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/overlay", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "overlay.html"));
});

// REST endpoint to get current state
app.get("/api/state", (req, res) => {
  res.json({
    subscribers: state.subscribers,
    goal: state.goal,
    percent: Math.min(
      100,
      Math.round((state.subscribers / state.goal) * 100)
    ),
    milestones: state.milestones,
    isApiConfigured: state.isApiConfigured,
    isLiveChatConfigured: state.isLiveChatConfigured,
    shortsViews: state.shortsViews,
    viewsGoal: state.viewsGoal,
    isShortsConfigured: state.isShortsConfigured,
  });
});

// Manual trigger endpoint (for testing without real chat)
app.post("/api/trigger-subscriber", (req, res) => {
  const username = req.body.username || "TestUser";
  console.log(`🧪  Manual trigger: ${username}`);
  io.emit("subscriberDetected", { username });
  res.json({ ok: true, username });
});

// Manual sub count bump (for testing)
app.post("/api/bump-subs", (req, res) => {
  const amount = parseInt(req.body.amount || "1", 10);
  state.subscribers += amount;
  state.lastSubCount = state.subscribers - amount;
  pollSubscribers();
  res.json({ ok: true, newCount: state.subscribers });
});

// ─── Socket.io ────────────────────────────────────────────────────────────────

io.on("connection", (socket) => {
  console.log(`🔌  Client connected: ${socket.id}`);

  // Send current state on connect
  socket.emit("subscriberUpdate", {
    count: state.subscribers,
    goal: state.goal,
    gained: 0,
  });

  socket.on("disconnect", () => {
    console.log(`🔌  Client disconnected: ${socket.id}`);
  });

  // Allow overlay to manually trigger (useful for testing)
  socket.on("testSubscriber", (data) => {
    const username = data?.username || "TestViewer";
    io.emit("subscriberDetected", { username });
  });
});

// ─── Start Polling ────────────────────────────────────────────────────────────

async function startPolling() {
  // Initial subscriber fetch
  await pollSubscribers();
  setInterval(pollSubscribers, POLL_INTERVAL);

  // Shorts views polling
  if (state.isShortsConfigured) {
    await pollShortsViews();
    setInterval(pollShortsViews, POLL_INTERVAL);
    console.log("🎬  Shorts views polling started");
  }

  // Fetch live chat ID once, then poll messages
  if (state.isLiveChatConfigured) {
    state.liveChatId = await fetchLiveChatId();
    if (state.liveChatId) {
      setInterval(fetchLiveChatMessages, CHAT_POLL_INTERVAL);
    }
  } else {
    console.log(
      "💡  Live chat not configured — use /api/trigger-subscriber to test"
    );
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

server.listen(PORT, async () => {
  console.log(`🚀  Server running at http://localhost:${PORT}`);
  console.log(`📺  OBS Overlay: http://localhost:${PORT}/overlay`);
  console.log(`🧪  Test trigger: POST http://localhost:${PORT}/api/trigger-subscriber`);
  await startPolling();
});