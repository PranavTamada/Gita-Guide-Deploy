import path from "path";
import { json, readVerses } from "./_shared.js";

const CHAPTER_NAMES = [
  "Arjuna's Dilemma", "Sankhya Yoga", "Karma Yoga", "Jnana Yoga",
  "Karma-Vairagya Yoga", "Abhyasa Yoga", "Paramahamsa Vijnana Yoga",
  "Aksara Parabrahma Yoga", "Raja-Vidya Raja-Guhya Yoga",
  "Vibhuti Yoga", "Visvarupa Darsana Yoga", "Bhakti Yoga",
  "Ksetra-Ksetrajna Vibhaga Yoga", "Gunatraya-Vibhaga Yoga",
  "Purushottama Yoga", "Daivasura-Sampad-Vibhaga Yoga",
  "Sraddhatraya-Vibhaga Yoga", "Moksha Sannyasa Yoga"
];

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return json(200, { ok: true });
  }

  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const verses = readVerses();
    const chapterMap = {};

    for (const verse of verses) {
      const chapter = verse.chapter;
      if (!chapterMap[chapter]) {
        chapterMap[chapter] = {
          chapter,
          name: CHAPTER_NAMES[chapter - 1] || `Chapter ${chapter}`,
          verse_count: 0,
          themes: new Set(),
          sample_verse: null
        };
      }

      chapterMap[chapter].verse_count += 1;
      (verse.principles || []).forEach(p => chapterMap[chapter].themes.add(p));
      if (verse.verse === 1) chapterMap[chapter].sample_verse = verse.translation;
    }

    const chapters = Object.values(chapterMap)
      .sort((a, b) => a.chapter - b.chapter)
      .map(chapter => ({ ...chapter, themes: [...chapter.themes].slice(0, 4) }));

    return json(200, { chapters });
  } catch (err) {
    return json(500, { error: "Failed to load chapter data." });
  }
}
