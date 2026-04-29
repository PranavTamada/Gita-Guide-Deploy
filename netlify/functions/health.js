import fs from "fs";
import path from "path";
import { projectRoot, json, readVerses } from "./_shared.js";

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return json(200, { ok: true });
  }

  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const verses = readVerses();
  const versesPath = path.join(projectRoot, "data", "verses.json");

  return json(200, {
    status: "ok",
    timestamp: new Date().toISOString(),
    verses_loaded: Array.isArray(verses) ? verses.length : 0,
    verses_file_exists: fs.existsSync(versesPath),
    node_version: process.version
  });
}
