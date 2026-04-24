import fs from "fs";

const data = JSON.parse(fs.readFileSync("data/verses.json", "utf-8"));

export function getTopMatches(query) {
  const q = query.toLowerCase();

  function score(verse) {
    let s = 0;

    // keyword match
    verse.keywords.forEach(k => {
      if (q.includes(k.toLowerCase())) s += 3;
    });

    // life situation match
    verse.life_situations.forEach(ls => {
      if (q.includes(ls.toLowerCase())) s += 4;
    });

    // emotion match
    verse.emotion_tags.forEach(e => {
      if (q.includes(e.toLowerCase())) s += 5;
    });

    // translation semantic hint (basic)
    if (q.split(" ").some(word => verse.translation.toLowerCase().includes(word))) {
      s += 1;
    }

    return s;
  }

  return data
    .map(v => ({ ...v, score: score(v) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}