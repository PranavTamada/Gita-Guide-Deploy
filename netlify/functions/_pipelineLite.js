import fs from "fs";
import path from "path";
import { callGemini } from "../../runtime/geminiClient.js";
import { analyzeIntent } from "../../runtime/llmIntentClassifier.js";
import { generatePractice } from "../../runtime/practiceGenerator.js";
import { projectRoot } from "./_shared.js";

const versesDataPath = path.join(projectRoot, "data", "verses.json");
const purportsDataPath = path.join(projectRoot, "data", "purports.json");

const versesData = JSON.parse(fs.readFileSync(versesDataPath, "utf-8"));
const verseDetailsMap = new Map(versesData.map(verse => [`${verse.chapter}-${verse.verse}`, verse]));

let purportsData = [];
let purportDetailsMap = new Map();
if (fs.existsSync(purportsDataPath)) {
  purportsData = JSON.parse(fs.readFileSync(purportsDataPath, "utf-8"));
  purportDetailsMap = new Map(purportsData.map(p => [`${p.chapter}-${p.verse}`, p]));
}

const CHAPTER_ZONES = {
  karma: new Set([1, 2, 3, 4, 5, 6]),
  devotion: new Set([7, 8, 9, 10, 11, 12]),
  knowledge: new Set([13, 14, 15, 16, 17, 18])
};

const EMOTION_MAP = {
  understanding: "confusion",
  realization: "seeking",
  hope: "seeking",
  peace: "seeking",
  clarity: "seeking",
  hopelessness: "depression"
};

const ADVICE_TEMPLATES = {
  anxiety: "Take one small action today without worrying about results",
  fear: "Name what you fear, then take one small action toward it",
  anger: "Pause and respond calmly instead of reacting instantly",
  grief: "Allow yourself to feel the loss, then do one kind thing for yourself",
  depression: "Pick the smallest possible task and complete it — momentum starts there",
  envy: "Redirect your energy inward: list one strength that is uniquely yours",
  greed: "Identify what you already have that is enough, and act from that place",
  pride: "Seek one honest piece of feedback today and sit with it",
  compassion: "Channel your care into one concrete act of service today",
  peace: "Protect your stillness by removing one unnecessary distraction today",
  hope: "Take one step today that your future self will thank you for",
  clarity: "Write down your clearest insight and act on it within the hour",
  understanding: "Choose one option and take the first step immediately",
  realization: "Anchor this realization with one concrete change in your daily routine",
  seeking: "Ask yourself what you are truly looking for, then take one directed step",
  neutral: "Take one calm step forward",
  lust: "Channel your desires into a constructive pursuit today",
  confusion: "Write down what you know to be true, and start from there",
  demotivated: "Do one small task without expecting any immediate reward",
  discriminated: "Stand firm in your inner worth and perform your duty with dignity",
  guilt: "Acknowledge the mistake, learn the lesson, and take a corrective step",
  forgetfulness: "Pause to center your mind and remember your core purpose",
  laziness: "Break your biggest task into a 5-minute action and start now",
  loneliness: "Reach out to someone or connect with your inner spiritual presence",
  hopelessness: "Focus entirely on today's duty, letting go of the distant future",
  forgiveness: "Release one small resentment today to free your own mind",
  temptation: "Observe the urge without acting on it for the next hour",
  "uncontrolled mind": "Focus on your breathing for two minutes to steady your thoughts"
};

const insightVariants = {
  detachment: [
    "Focus on your actions instead of worrying about results",
    "Let go of outcome pressure and act with clarity",
    "Act with purpose, detached from the result"
  ],
  duty: [
    "Fulfill your responsibilities without attachment to comfort",
    "Perform your duty simply because it is the right thing to do",
    "Stay committed to your path, ignoring distractions"
  ],
  devotion: [
    "Dedicate your actions to a higher purpose",
    "Focus your heart on the deepest truth as you act",
    "Surrender your personal motives to a higher calling"
  ],
  surrender: [
    "Release what you cannot control and trust the process",
    "Let go of ego and embrace what unfolds",
    "Accept the present moment completely"
  ],
  discipline: [
    "Master yourself through focused action",
    "True freedom comes from internal discipline",
    "Stay the course through consistent, mindful practice"
  ],
  knowledge: [
    "Seek true understanding over temporary feelings",
    "Let wisdom guide you, not fleeting emotions",
    "See things as they are, beyond the surface"
  ],
  equanimity: [
    "Remain steady in both success and failure",
    "Find peace by accepting both praise and blame",
    "Keep a balanced mind regardless of external events"
  ],
  action: [
    "Take right action without fear of the outcome",
    "Step forward boldly and do what is needed",
    "Let go of hesitation and act with focus"
  ],
  faith: [
    "Trust the process even amidst uncertainty",
    "Hold tight to your deeper convictions",
    "Have faith that your right actions will lead the way"
  ]
};

function normalizeText(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function tokenize(value) {
  return normalizeText(value).split(" ").filter(term => term.length > 2);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function chapterZone(chapter) {
  for (const [zone, chapters] of Object.entries(CHAPTER_ZONES)) {
    if (chapters.has(chapter)) return zone;
  }
  return "other";
}

function normalizeEmotion(emotion) {
  const raw = normalizeText(emotion);
  return EMOTION_MAP[raw] || raw || "seeking";
}

function getFallbackInsight(verse, index) {
  const chapter = Number(verse.chapter) || 0;
  if (chapter === 2) return insightVariants.action[index % insightVariants.action.length];
  if (chapter === 12) return insightVariants.devotion[index % insightVariants.devotion.length];
  if (chapter === 13) return insightVariants.knowledge[index % insightVariants.knowledge.length];

  const principles = Array.isArray(verse.principles) ? verse.principles.map(p => normalizeText(p)) : [];
  for (const principle of principles) {
    for (const [key, values] of Object.entries(insightVariants)) {
      if (principle.includes(key)) return values[index % values.length];
    }
  }

  return [
    "Stay steady and act without fear",
    "Focus on your path and keep moving forward",
    "Release anxiety by anchoring yourself in the present",
    "Embrace clarity over confusion with steady action"
  ][index % 4];
}

function enrichVerse(verse) {
  const details = verseDetailsMap.get(`${verse.chapter}-${verse.verse}`) || {};
  const purport = purportDetailsMap.get(`${verse.chapter}-${verse.verse}`) || {};

  return {
    ...verse,
    principles: Array.isArray(details.principles) ? details.principles : [],
    summary: purport.summary || details.summary || "",
    core_idea: purport.core_idea || details.core_idea || null
  };
}

function scoreVerse(verse, queryTerms, understanding) {
  const normalizedEmotion = normalizeEmotion(understanding.emotion);
  const normalizedSituation = normalizeText(understanding.situation);
  const querySet = new Set(queryTerms);

  const verseText = normalizeText([
    verse.translation,
    ...(verse.keywords || []),
    ...(verse.life_situations || []),
    ...(verse.principles || []),
    verse.summary,
    verse.core_idea
  ].join(" "));
  const verseTerms = new Set(tokenize(verseText));

  let vectorScore = 0;
  for (const term of querySet) {
    if (verseTerms.has(term)) vectorScore += 1;
  }
  vectorScore = querySet.size ? vectorScore / querySet.size : 0;

  const emotionScore = Array.isArray(verse.emotion_tags) && verse.emotion_tags.some(tag => normalizeEmotion(tag) === normalizedEmotion)
    ? 1
    : 0;

  const lifeSituationScore = Array.isArray(verse.life_situations) && verse.life_situations.some(item => normalizedSituation && normalizeText(item).includes(normalizedSituation))
    ? 1
    : 0;

  const keywordsScore = (() => {
    const pools = [verse.keywords || [], verse.principles || [], verse.life_situations || []];
    const matches = pools.flat().filter(item => querySet.has(normalizeText(item)) || queryTerms.some(term => normalizeText(item).includes(term)));
    return matches.length > 0 ? Math.min(1, matches.length / 3) : 0;
  })();

  const weights = understanding.search_bias || {
    vectorWeight: 0.5,
    emotionWeight: 0.3,
    lifeSituationWeight: 0.15,
    keywordsWeight: 0.05
  };

  const score =
    vectorScore * weights.vectorWeight +
    emotionScore * weights.emotionWeight +
    lifeSituationScore * weights.lifeSituationWeight +
    keywordsScore * weights.keywordsWeight;

  return {
    verse: enrichVerse(verse),
    score
  };
}

function selectTopVerses(query, topK, understanding) {
  const queryTerms = unique([
    ...tokenize(query),
    ...tokenize(understanding.emotion),
    ...tokenize(understanding.situation),
    ...(Array.isArray(understanding.query_keywords) ? understanding.query_keywords.map(tokenize).flat() : [])
  ]);

  const scored = versesData
    .map(verse => scoreVerse(verse, queryTerms, understanding))
    .sort((a, b) => b.score - a.score)
    .map(item => ({
      ...item.verse,
      final_score: item.score
    }));

  const picked = [];
  const zonesUsed = new Set();
  for (const verse of scored) {
    if (picked.length >= topK) break;
    const zone = chapterZone(verse.chapter);
    if (!zonesUsed.has(zone) || picked.length < 1) {
      picked.push(verse);
      zonesUsed.add(zone);
    }
  }

  for (const verse of scored) {
    if (picked.length >= topK) break;
    if (!picked.some(item => item.chapter === verse.chapter && item.verse === verse.verse)) {
      picked.push(verse);
    }
  }

  return picked.slice(0, topK);
}

function relatedVerses(topVerse, limit = 4) {
  const topEmotionTags = new Set((topVerse.emotion_tags || []).map(normalizeEmotion));
  const topPrinciples = new Set((topVerse.principles || []).map(normalizeText));
  const topSituations = new Set((topVerse.life_situations || []).map(normalizeText));

  return versesData
    .filter(verse => !(verse.chapter === topVerse.chapter && verse.verse === topVerse.verse))
    .map(verse => {
      const emotionHits = (verse.emotion_tags || []).filter(tag => topEmotionTags.has(normalizeEmotion(tag))).length;
      const principleHits = (verse.principles || []).filter(tag => topPrinciples.has(normalizeText(tag))).length;
      const situationHits = (verse.life_situations || []).filter(tag => topSituations.has(normalizeText(tag))).length;
      const score = emotionHits + principleHits + situationHits;

      return {
        id: `${verse.chapter}-${verse.verse}`,
        chapter: verse.chapter,
        verse: verse.verse,
        translation: verse.translation,
        connection_type: score > 0 ? "related" : "context"
      };
    })
    .sort((a, b) => a.chapter - b.chapter || a.verse - b.verse)
    .slice(0, limit);
}

function buildPrompt(query, understanding, topVerses, sessionContext = "") {
  return `You are a Bhagavad Gita assistant that gives clear, practical guidance.

User Query: ${query}
Emotion: ${understanding.emotion}
Situation: ${understanding.situation}${sessionContext}

Verses:
${topVerses.map(v => `${v.chapter}:${v.verse} - ${v.translation}`).join("\n")}

Task:
- For EACH verse: Give 1 short insight (max 15 words) and 1 connection to user situation
- Give 1 final practical advice (max 20 words)

Example Output:
{
  "guidance": [
    {
      "chapter": 2,
      "verse": 47,
      "insight": "Focus on effort, not results",
      "connection": "Your anxiety comes from worrying about future outcomes"
    }
  ],
  "final_advice": "Focus on small actions today, not uncertain future results"
}`;
}

function tryParseJson(text) {
  if (!text) return null;
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const rawJson = jsonMatch ? jsonMatch[1] : text;

  try {
    return JSON.parse(rawJson);
  } catch {
    try {
      const start = rawJson.indexOf("{");
      const end = rawJson.lastIndexOf("}");
      if (start !== -1 && end !== -1) {
        return JSON.parse(rawJson.slice(start, end + 1));
      }
    } catch {
      return null;
    }
  }

  return null;
}

function sanitizeGuidance(raw, topVerses) {
  const validVerseIds = new Set(topVerses.map(v => `${v.chapter}-${v.verse}`));
  const guidance = Array.isArray(raw?.guidance)
    ? raw.guidance.filter(item =>
        typeof item.chapter === "number" &&
        typeof item.verse === "number" &&
        typeof item.insight === "string" && item.insight.trim() &&
        typeof item.connection === "string" && item.connection.trim() &&
        validVerseIds.has(`${item.chapter}-${item.verse}`)
      )
    : [];

  if (guidance.length === 0 || typeof raw?.final_advice !== "string") {
    return null;
  }

  return {
    guidance: guidance.map(item => ({
      ...item,
      translation: (verseDetailsMap.get(`${item.chapter}-${item.verse}`) || {}).translation || ""
    })),
    final_advice: raw.final_advice
  };
}

function buildFallbackGuidance(topVerses, understanding) {
  const emotion = normalizeEmotion(understanding.emotion);
  const positiveEmotions = new Set(["peace", "clarity", "hope", "compassion", "realization", "neutral", "seeking"]);

  return {
    guidance: topVerses.map((verse, index) => {
      const connections = positiveEmotions.has(emotion)
        ? [
            "This guides your seeking by offering a steady perspective.",
            "This provides a firm foundation for your next step.",
            "This brings clarity by focusing on what truly matters."
          ]
        : [
            `This reduces ${emotion} by shifting focus away from future worries.`,
            "This helps you stay grounded instead of overthinking outcomes.",
            "This calms the mind by focusing on what you can control."
          ];

      return {
        chapter: verse.chapter,
        verse: verse.verse,
        translation: verse.translation || "",
        insight: verse.core_idea || getFallbackInsight(verse, index),
        connection: connections[index % connections.length]
      };
    }),
    final_advice: ADVICE_TEMPLATES[emotion] || "Take one calm step forward"
  };
}

export async function runNetlifyPipeline(query) {
  const startTime = Date.now();
  const safeQuery = String(query || "").trim();
  if (!safeQuery) {
    throw new Error("Query is required");
  }

  const understanding = await analyzeIntent(safeQuery);
  const topVerses = selectTopVerses(safeQuery, 3, understanding);
  const topVerseDetails = topVerses.map(verse => ({
    chapter: verse.chapter,
    verse: verse.verse,
    translation: verse.translation || "",
    purport_excerpt: (purportDetailsMap.get(`${verse.chapter}-${verse.verse}`) || {}).summary || verse.summary || "",
    core_idea: verse.core_idea || "",
    principles: verse.principles || []
  }));

  if (understanding.query_mode === "informational") {
    return {
      understanding: {
        query_mode: "informational",
        emotion: understanding.emotion,
        emotion_confidence: understanding.emotion_confidence,
        situation: understanding.situation,
        intent_type: understanding.intent_type
      },
      mode: "informational",
      verses: topVerseDetails,
      guidance: topVerseDetails.map((verse, index) => ({
        chapter: verse.chapter,
        verse: verse.verse,
        translation: verse.translation,
        insight: verse.core_idea || getFallbackInsight(verse, index),
        connection: verse.purport_excerpt || `Chapter ${verse.chapter} explores this teaching in depth.`
      })),
      final_advice: "Take time to study these verses. Wisdom deepens with reflection.",
      related_verses: topVerses[0] ? relatedVerses(topVerses[0], 4) : []
    };
  }

  const recentContext = "";
  const prompt = buildPrompt(safeQuery, understanding, topVerses, recentContext);

  let guidanceResult = buildFallbackGuidance(topVerses, understanding);
  try {
    const rawLLMOutput = await callGemini(prompt, {
      apiKey: process.env.GEMINI_API_KEY || "",
      model: process.env.GEMINI_MODEL || "gemini-2.0-flash",
      timeoutMs: parseInt(process.env.GEMINI_TIMEOUT_MS || "120000", 10),
      systemInstruction: "Return only valid JSON that matches the requested schema."
    });

    const parsedLLM = tryParseJson(rawLLMOutput);
    const sanitized = parsedLLM ? sanitizeGuidance(parsedLLM, topVerses) : null;
    if (sanitized) {
      guidanceResult = sanitized;
    }
  } catch {
    // keep deterministic fallback
  }

  const allPrinciples = topVerses.reduce((acc, verse) => acc.concat(verse.principles || []), []);
  const allCoreIdeas = topVerses.map(verse => verse.core_idea).filter(Boolean);
  const practice = generatePractice({
    emotion: understanding.emotion,
    situation: understanding.situation,
    core_struggle: understanding.core_struggle,
    principles: allPrinciples,
    core_idea: allCoreIdeas[0]
  });

  return {
    understanding: {
      query_mode: understanding.query_mode,
      emotion: understanding.emotion,
      emotion_confidence: understanding.emotion_confidence,
      emotion_runner_up: understanding.emotion_runner_up,
      situation: understanding.situation,
      core_struggle: understanding.core_struggle,
      intent_type: understanding.intent_type
    },
    mode: "emotional",
    guidance: guidanceResult.guidance,
    final_advice: guidanceResult.final_advice,
    related_verses: topVerses[0] ? relatedVerses(topVerses[0], 4) : [],
    practice,
    latency_ms: Date.now() - startTime
  };
}