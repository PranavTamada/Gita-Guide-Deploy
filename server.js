import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { runIntelligentPipeline } from "./runtime/pipeline.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: "16kb" }));

// Serve frontend static files
app.use(express.static(path.join(__dirname, "frontend")));

// POST /ask — main API endpoint
app.post("/ask", async (req, res) => {
  const { query } = req.body;

  if (!query || typeof query !== "string" || !query.trim()) {
    console.log("[server] ❌ Bad request — missing or empty query");
    return res.status(400).json({
      error: "A non-empty 'query' string is required.",
    });
  }

  console.log(`\n[server] 🙏 New query: "${query.trim()}"`);
  const startTime = Date.now();

  try {
    const result = await runIntelligentPipeline(query.trim());
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[server] ✅ Pipeline completed in ${elapsed}s`);
    return res.json(result);
  } catch (err) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.error(`[server] ❌ Pipeline error after ${elapsed}s:`, err.message);
    return res.status(500).json({
      error: "Something went wrong processing your query. Please try again.",
    });
  }
});

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🪷  Bhagavad Gita API Server`);
  console.log(`   Backend:  http://localhost:${PORT}/ask`);
  console.log(`   Frontend: http://localhost:${PORT}/`);
  console.log(`   Health:   http://localhost:${PORT}/health\n`);
});
