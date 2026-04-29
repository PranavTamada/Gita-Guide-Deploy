import fs from "fs";
import path from "path";
import { projectRoot, json } from "./_shared.js";

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return json(200, { ok: true });
  }

  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const logPath = path.join(projectRoot, "outputs", "requests.log");
    if (!fs.existsSync(logPath)) {
      return json(200, { total: 0 });
    }

    const lines = fs.readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean).slice(-200);
    const entries = lines.map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);

    const emotionCounts = {};
    let totalLatency = 0;
    let llmUsed = 0;
    let informational = 0;

    for (const entry of entries) {
      if (entry.emotion) emotionCounts[entry.emotion] = (emotionCounts[entry.emotion] || 0) + 1;
      if (entry.latency_ms) totalLatency += entry.latency_ms;
      if (entry.used_llm) llmUsed += 1;
      if (entry.query_mode === "informational") informational += 1;
    }

    return json(200, {
      total: entries.length,
      avg_latency_ms: entries.length ? Math.round(totalLatency / entries.length) : 0,
      llm_success_rate: entries.length ? `${Math.round((llmUsed / entries.length) * 100)}%` : "n/a",
      informational_pct: entries.length ? `${Math.round((informational / entries.length) * 100)}%` : "n/a",
      top_emotions: Object.entries(emotionCounts).sort((a, b) => b[1] - a[1]).slice(0, 5)
    });
  } catch (err) {
    return json(500, { error: "Stats unavailable." });
  }
}
