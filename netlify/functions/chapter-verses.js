import { json, readVerses } from "./_shared.js";

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return json(200, { ok: true });
  }

  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const chapterNumber = parseInt(event.queryStringParameters?.n || "", 10);
    const verses = readVerses();
    const chapterVerses = verses.filter(verse => verse.chapter === chapterNumber);

    if (chapterVerses.length === 0) {
      return json(404, { error: "Chapter not found." });
    }

    return json(200, { chapter: chapterNumber, verses: chapterVerses });
  } catch (err) {
    return json(500, { error: "Failed to load verses." });
  }
}
