import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { runIntelligentPipeline } from "./runtime/pipeline.js";
import { vectorStore } from "./runtime/vectorStore.js";
import { generateAllDailyPractices } from "./runtime/practiceGenerator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const projectRoot = __dirname;

const app  = express();
const PORT = process.env.PORT || 3000;
const serverStartTime = Date.now();

// ---------------------------------------------------------------------------
// Rate limiting (5.2)
// ---------------------------------------------------------------------------
const RATE_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_MAX       = 15;        // requests per window per IP
const _rateCounts    = new Map();

function rateLimiter(req, res, next) {
  const ip  = req.ip || "unknown";
  const now = Date.now();
  const entry = _rateCounts.get(ip) || { count: 0, resetAt: now + RATE_WINDOW_MS };

  if (now > entry.resetAt) {
    entry.count   = 0;
    entry.resetAt = now + RATE_WINDOW_MS;
  }

  entry.count += 1;
  _rateCounts.set(ip, entry);

  if (entry.count > RATE_MAX) {
    return res.status(429).json({
      error: "Even the wisest mind needs stillness between questions. Please wait a moment.",
      retry_after_ms: entry.resetAt - now
    });
  }
  next();
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(cors());
app.use(express.json({ limit: "16kb" }));

// Serve frontend static files
app.use(express.static(path.join(__dirname, "frontend")));

// ---------------------------------------------------------------------------
// POST /ask — main API endpoint
// ---------------------------------------------------------------------------
app.post("/ask", rateLimiter, async (req, res) => {
  const { query } = req.body;

  if (!query || typeof query !== "string" || !query.trim()) {
    return res.status(400).json({ error: "A non-empty 'query' string is required." });
  }

  console.log(`\n[server] 🙏 New query: "${query.trim().slice(0, 80)}"`);
  const startTime = Date.now();

  try {
    const result  = await runIntelligentPipeline(query.trim());
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[server] ✅ Pipeline completed in ${elapsed}s`);
    return res.json(result);
  } catch (err) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.error(`[server] ❌ Pipeline error after ${elapsed}s:`, err.message);
    return res.status(500).json({
      error: "Something went wrong processing your query. Please try again."
    });
  }
});

// ---------------------------------------------------------------------------
// GET /daily-practices — daily practices for all emotions
// ---------------------------------------------------------------------------
app.get("/daily-practices", (_req, res) => {
  try {
    const practices = generateAllDailyPractices();
    res.json({
      success: true,
      count: practices.length,
      practices: practices
    });
  } catch (err) {
    console.error("[server] ❌ Error generating daily practices:", err.message);
    return res.status(500).json({
      error: "Failed to generate daily practices."
    });
  }
});

// ---------------------------------------------------------------------------
// GET /chapters — verse data for Chapter Browser (4.6)
// ---------------------------------------------------------------------------
const CHAPTER_NAMES = [
  "Arjuna's Dilemma", "Sankhya Yoga", "Karma Yoga", "Jnana Yoga",
  "Karma-Vairagya Yoga", "Abhyasa Yoga", "Paramahamsa Vijnana Yoga",
  "Aksara Parabrahma Yoga", "Raja-Vidya Raja-Guhya Yoga",
  "Vibhuti Yoga", "Visvarupa Darsana Yoga", "Bhakti Yoga",
  "Ksetra-Ksetrajna Vibhaga Yoga", "Gunatraya-Vibhaga Yoga",
  "Purushottama Yoga", "Daivasura-Sampad-Vibhaga Yoga",
  "Sraddhatraya-Vibhaga Yoga", "Moksha Sannyasa Yoga"
];

app.get("/chapters", (_req, res) => {
  try {
    const versesPath = path.join(projectRoot, "data", "verses.json");
    const verses     = JSON.parse(fs.readFileSync(versesPath, "utf-8"));

    const chapterMap = {};
    for (const v of verses) {
      const ch = v.chapter;
      if (!chapterMap[ch]) {
        chapterMap[ch] = {
          chapter:     ch,
          name:        CHAPTER_NAMES[ch - 1] || `Chapter ${ch}`,
          verse_count: 0,
          themes:      new Set(),
          sample_verse: null
        };
      }
      chapterMap[ch].verse_count += 1;
      (v.principles || []).forEach(p => chapterMap[ch].themes.add(p));
      if (v.verse === 1) chapterMap[ch].sample_verse = v.translation;
    }

    const chapters = Object.values(chapterMap)
      .sort((a, b) => a.chapter - b.chapter)
      .map(c => ({ ...c, themes: [...c.themes].slice(0, 4) }));

    res.json({ chapters });
  } catch (err) {
    res.status(500).json({ error: "Failed to load chapter data." });
  }
});

// ---------------------------------------------------------------------------
// GET /chapter/:n/verses — all verses in a chapter (4.6)
// ---------------------------------------------------------------------------
app.get("/chapter/:n/verses", (req, res) => {
  try {
    const n      = parseInt(req.params.n, 10);
    const verses = JSON.parse(fs.readFileSync(path.join(projectRoot, "data", "verses.json"), "utf-8"));
    const chap   = verses.filter(v => v.chapter === n);
    if (chap.length === 0) return res.status(404).json({ error: "Chapter not found." });
    res.json({ chapter: n, verses: chap });
  } catch (err) {
    res.status(500).json({ error: "Failed to load verses." });
  }
});

// ---------------------------------------------------------------------------
// GET /stats — aggregate stats for observability (7.1)
// ---------------------------------------------------------------------------
app.get("/stats", (_req, res) => {
  try {
    const logPath = path.join(projectRoot, "outputs", "requests.log");
    if (!fs.existsSync(logPath)) return res.json({ total: 0 });

    const lines = fs.readFileSync(logPath, "utf-8")
      .trim().split("\n").filter(Boolean).slice(-200);

    const entries = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

    const emotionCounts = {};
    let totalLatency = 0, llmUsed = 0, informational = 0;

    for (const e of entries) {
      if (e.emotion) emotionCounts[e.emotion] = (emotionCounts[e.emotion] || 0) + 1;
      if (e.latency_ms) totalLatency += e.latency_ms;
      if (e.used_llm)   llmUsed++;
      if (e.query_mode === "informational") informational++;
    }

    res.json({
      total:              entries.length,
      avg_latency_ms:     entries.length ? Math.round(totalLatency / entries.length) : 0,
      llm_success_rate:   entries.length ? `${Math.round((llmUsed / entries.length) * 100)}%` : "n/a",
      informational_pct:  entries.length ? `${Math.round((informational / entries.length) * 100)}%` : "n/a",
      top_emotions:       Object.entries(emotionCounts).sort((a,b) => b[1]-a[1]).slice(0, 5)
    });
  } catch (err) {
    res.status(500).json({ error: "Stats unavailable." });
  }
});

// ---------------------------------------------------------------------------
// GET /health — enhanced health check (7.2)
// ---------------------------------------------------------------------------
app.get("/health", (_req, res) => {
  const versesPath = path.join(projectRoot, "data", "verses.json");
  const versesOk   = fs.existsSync(versesPath);
  let versesLoaded = 0;
  if (versesOk) {
    try { versesLoaded = JSON.parse(fs.readFileSync(versesPath, "utf-8")).length; } catch {}
  }

  res.json({
    status:       "ok",
    timestamp:    new Date().toISOString(),
    uptime_s:     Math.round((Date.now() - serverStartTime) / 1000),
    vector_store: vectorStore.isBuilt ? "loaded" : "not_loaded",
    verses_loaded: versesLoaded,
    node_version: process.version
  });
});

// ---------------------------------------------------------------------------
// Start server + optional FAISS auto-build (2.1)
// ---------------------------------------------------------------------------
app.listen(PORT, async () => {
  console.log(`\n🪷  Bhagavad Gita API Server`);
  console.log(`   Backend:  http://localhost:${PORT}/ask`);
  console.log(`   Frontend: http://localhost:${PORT}/`);
  console.log(`   Health:   http://localhost:${PORT}/health`);
  console.log(`   Chapters: http://localhost:${PORT}/chapters`);
  console.log(`   Stats:    http://localhost:${PORT}/stats\n`);

  // Try to load existing FAISS index; build if missing
  if (!vectorStore.isBuilt) {
    try {
      vectorStore.loadIndex();
      console.log("✅ FAISS index loaded from disk.");
    } catch {
      console.log("⚙️  FAISS index not found. Building now (this may take 2-3 min on first run)...");
      try {
        await vectorStore.buildIndex();
        console.log("✅ FAISS index built and ready.");
      } catch (buildErr) {
        console.warn("⚠️  Could not build FAISS index (running in metadata-only mode):", buildErr.message);
      }
    }
  }
});
