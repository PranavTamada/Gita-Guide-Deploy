import fetch from "node-fetch"; // VERY IMPORTANT
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config as loadEnv } from "dotenv";
import { getTopMatches, getConnectedVerses } from "./retrieval.js";
import { generatePractice } from "./practiceGenerator.js";
import { analyzeIntent } from "./intentAnalyzer.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const versesDataPath = path.join(projectRoot, "data", "verses.json");
const purportsDataPath = path.join(projectRoot, "data", "purports.json");

const versesData = JSON.parse(fs.readFileSync(versesDataPath, "utf-8"));
const verseDetailsMap = new Map(
  versesData.map(verse => [`${verse.chapter}-${verse.verse}`, verse])
);

let purportsData = [];
let purportDetailsMap = new Map();
if (fs.existsSync(purportsDataPath)) {
  purportsData = JSON.parse(fs.readFileSync(purportsDataPath, "utf-8"));
  purportDetailsMap = new Map(
    purportsData.map(p => [`${p.chapter}-${p.verse}`, p])
  );
}

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const OLLAMA_MODEL = "tinyllama"; // the requested lightweight model

// emotionMap is used to humanise the emotion label in fallback connection strings
const emotionMap = {
  anxiety: "anxiety",
  anger: "anger",
  depression: "hopelessness",
  grief: "grief",
  fear: "fear",
  seeking: "seeking",
  envy: "envy",
  understanding: "confusion",
  pride: "pride",
  greed: "greed",
  compassion: "compassion",
  peace: "peace",
  hope: "hope"
};
const adviceTemplates = {
  anxiety:     "Take one small action today without worrying about results",
  fear:        "Name what you fear, then take one small action toward it",
  anger:       "Pause and respond calmly instead of reacting instantly",
  grief:       "Allow yourself to feel the loss, then do one kind thing for yourself",
  depression:  "Pick the smallest possible task and complete it — momentum starts there",
  envy:        "Redirect your energy inward: list one strength that is uniquely yours",
  greed:       "Identify what you already have that is enough, and act from that place",
  pride:       "Seek one honest piece of feedback today and sit with it",
  compassion:  "Channel your care into one concrete act of service today",
  peace:       "Protect your stillness by removing one unnecessary distraction today",
  hope:        "Take one step today that your future self will thank you for",
  clarity:     "Write down your clearest insight and act on it within the hour",
  understanding: "Choose one option and take the first step immediately",
  realization: "Anchor this realization with one concrete change in your daily routine",
  seeking:     "Ask yourself what you are truly looking for, then take one directed step",
  neutral:     "Take one calm step forward"
};

const insightVariants = {
  "detachment": [
    "Focus on your actions instead of worrying about results",
    "Let go of outcome pressure and act with clarity",
    "Act with purpose, detached from the result"
  ],
  "control mind": [
    "Control your thoughts instead of reacting automatically",
    "Train your mind to stay steady under pressure",
    "Observe your mind without being controlled by it"
  ],
  "self-knowledge": [
    "Understand your inner self before making decisions",
    "Clarity comes from knowing yourself deeply",
    "Look inward to find the strength you need"
  ],
  "duty": [
    "Fulfill your responsibilities without attachment to comfort",
    "Perform your duty simply because it is the right thing to do",
    "Stay committed to your path, ignoring distractions"
  ],
  "devotion": [
    "Dedicate your actions to a higher purpose",
    "Focus your heart on the deepest truth as you act",
    "Surrender your personal motives to a higher calling"
  ],
  "surrender": [
    "Release what you cannot control and trust the process",
    "Let go of ego and embrace what unfolds",
    "Accept the present moment completely"
  ],
  "discipline": [
    "Master yourself through focused action",
    "True freedom comes from internal discipline",
    "Stay the course through consistent, mindful practice"
  ],
  "knowledge": [
    "Seek true understanding over temporary feelings",
    "Let wisdom guide you, not fleeting emotions",
    "See things as they are, beyond the surface"
  ],
  "equanimity": [
    "Remain steady in both success and failure",
    "Find peace by accepting both praise and blame",
    "Keep a balanced mind regardless of external events"
  ],
  "action": [
    "Take right action without fear of the outcome",
    "Step forward boldly and do what is needed",
    "Let go of hesitation and act with focus"
  ],
  "faith": [
    "Trust the process even amidst uncertainty",
    "Hold tight to your deeper convictions",
    "Have faith that your right actions will lead the way"
  ]
};

function getFallbackInsight(verse, index) {
  // Verse context differentiation
  const chapter = Number(verse.chapter) || parseInt(String(verse.id || "0").split("-")[0], 10);
  
  if (chapter === 2) {
    const options = insightVariants["action"];
    return options[index % options.length];
  } else if (chapter === 12) {
    const options = insightVariants["devotion"];
    return options[index % options.length];
  } else if (chapter === 13) {
    const options = insightVariants["self-knowledge"];
    return options[index % options.length];
  }

  // Principle-based insight
  const principles = verse.principles || [];
  let candidateOptions = null;

  for (const p of principles) {
    if (p && insightVariants[p.toLowerCase()]) {
      candidateOptions = insightVariants[p.toLowerCase()];
      break;
    }
    // partial matches
    for (const [key, value] of Object.entries(insightVariants)) {
      if (p.toLowerCase().includes(key)) {
        candidateOptions = value;
        break;
      }
    }
    if (candidateOptions) break;
  }

  if (!candidateOptions) {
    candidateOptions = [
      "Stay steady and act without fear",
      "Focus on your path and keep moving forward",
      "Release anxiety by anchoring yourself in the present",
      "Embrace clarity over confusion with steady action"
    ];
  }

  return candidateOptions[index % candidateOptions.length];
}

// Memory function
const historyPath = path.join(projectRoot, "outputs", "history.json");

function loadHistory() {
  if (fs.existsSync(historyPath)) {
    try {
      return JSON.parse(fs.readFileSync(historyPath, "utf-8"));
    } catch {
      return [];
    }
  }
  return [];
}

function saveQuery(query, result) {
  const history = loadHistory();
  // Save only lightweight metadata — NOT the full result — to keep the file small
  history.push({
    query,
    timestamp: new Date().toISOString(),
    emotion: result.understanding?.emotion,
    situation: result.understanding?.situation,
    intent_type: result.understanding?.intent_type,
    verse_ids: (result.guidance || []).map(g => `${g.chapter}:${g.verse}`)
  });
  // Keep last 50 queries to prevent file bloat
  if (history.length > 50) history.shift();
  try {
    fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
  } catch (writeErr) {
    console.warn("[pipeline] Could not save history:", writeErr.message);
  }
}

function logStage(stage, details = {}) {
  console.log("[pipeline]", JSON.stringify({ stage, ...details }));
}

function safeTrim(value) {
  return (String(value || "")).trim();
}


function clamp01(value) {
  const num = Number(value) || 0;
  if (num < 0) return 0;
  if (num > 1) return 1;
  return num;
}

function normalizeKgWeight(weight) {
  return clamp01((Number(weight) || 0) / 5);
}

function computeKnowledgeGraphSignal(verseId, emotion, situation) {
  const neighbors = getConnectedVerses(verseId, 1).slice(0, 5);
  if (neighbors.length === 0) {
    return { kg_score: 0, neighbors_sample: [] };
  }

  const scored = neighbors.map(item => {
    const connection = item.connection || {};
    const emotionalSignal = (connection.shared_emotion_tags || []).length;
    const situationalSignal = (connection.shared_life_situations || []).length;
    const philosophicalSignal = (connection.shared_principles || []).length;

    // A simple heuristic based on the presence of emotion/situation vs philosophical
    let typeSignal = philosophicalSignal;
    if (emotion !== "seeking") typeSignal += emotionalSignal;
    if (situation !== "general") typeSignal += situationalSignal;

    const edgeStrength = normalizeKgWeight(connection.weight || 0);
    const typeBoost = clamp01(typeSignal / 3);
    const localScore = clamp01((edgeStrength * 0.7) + (typeBoost * 0.3));

    return {
      id: item.id,
      score: localScore,
      weight: connection.weight || 0
    };
  });

  const kgScore = scored.reduce((sum, n) => sum + n.score, 0) / scored.length;
  return {
    kg_score: clamp01(kgScore),
    neighbors_sample: scored.slice(0, 3)
  };
}

function enrichVerse(verse) {
  const details = verseDetailsMap.get(verse.id) || {};
  const purportDetails = purportDetailsMap.get(verse.id) || {};

  const principles = Array.isArray(details.principles) ? details.principles : [];

  // Use purports data if available, else fallback
  const summary = purportDetails.summary || details.summary || "";
  const core_idea = purportDetails.core_idea || details.core_idea || safeTrim(details.translation) || "Steady action with awareness.";

  return {
    ...verse,
    principles,
    summary,
    core_idea
  };
}

function selectTopVersesWithKg(hybridVerses, emotion, situation, topK = 3) {
  const rescored = hybridVerses.map(verse => {
    const baseScore = clamp01(verse.final_score || 0);
    const kgSignal = computeKnowledgeGraphSignal(verse.id, emotion, situation);
    const finalHybridScore = clamp01((baseScore * 0.85) + (kgSignal.kg_score * 0.15));
    const enrichedVerse = enrichVerse(verse);

    return {
      ...enrichedVerse,
      kg_score: kgSignal.kg_score,
      kg_neighbors: kgSignal.neighbors_sample,
      final_hybrid_score: finalHybridScore
    };
  });

  return rescored
    .sort((a, b) => b.final_hybrid_score - a.final_hybrid_score)
    .slice(0, topK);
}

function tryParseJson(text) {
  if (!text) return null;

  // Attempt to extract JSON from markdown blocks if present
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const rawJson = jsonMatch ? jsonMatch[1] : text;

  try {
    return JSON.parse(rawJson);
  } catch {
    // Attempt aggressive cleanup if it fails
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

async function callOllama(prompt) {
  logStage("llama_call_request", { model: OLLAMA_MODEL });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt: prompt,
        stream: false,
        format: "json" // try to enforce JSON if supported
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`Ollama API failed (${res.status}): ${await res.text()}`);
    }

    const data = await res.json();
    const text = safeTrim(data?.response);

    if (!text) {
      throw new Error("Empty response from Ollama");
    }

    logStage("llama_call_response", { characters: text.length });
    return text;
  } catch (err) {
    clearTimeout(timeoutId);
    const reason = err.name === "AbortError" ? "30s timeout exceeded" : err.message;
    console.error("❌ Ollama Call Error:", reason);
    throw err; // Propagate error to trigger fallback
  }
}

export async function runIntelligentPipeline(query) {
  query = safeTrim(query);
  if (!query) {
    throw new Error("Query is required");
  }

  logStage("start", { query });

  // 1) Analyze query — deep intent understanding (intentAnalyzer.js)
  const understanding = analyzeIntent(query);
  logStage("analyze_intent", {
    emotion: understanding.emotion,
    emotion_confidence: understanding.emotion_confidence,
    situation: understanding.situation,
    intent_type: understanding.intent_type
  });

  // 2) Hybrid retrieval — pass field-level FAISS bias AND intent labels so
  // canonical emotion/situation names score directly against verse metadata.
  const intentLabels = { emotion: understanding.emotion, situation: understanding.situation };
  const hybridCandidates = await getTopMatches(query, 9, understanding.search_bias, intentLabels);
  const topVerses = selectTopVersesWithKg(hybridCandidates, understanding.emotion, understanding.situation, 3);
  logStage("retrieval", {
    selected: topVerses.map(v => ({ id: v.id, score: v.final_hybrid_score }))
  });

  // 3) Call Ollama for guidance
  const prompt = `
You are a Bhagavad Gita assistant that gives clear, practical guidance.

User Query: ${query}
Emotion: ${understanding.emotion}
Situation: ${understanding.situation}

Verses:
${topVerses.map(v => `${v.chapter}:${v.verse} - ${v.translation}`).join("\n")}

Task:
- For EACH verse:
  - Give 1 short insight (max 15 words)
  - Explain how it relates to the user's situation (1 sentence)

- Then give 1 final practical advice (max 20 words)

STRICT RULES:
- Output ONLY valid JSON
- No explanations outside JSON
- No repetition
- Keep language simple and human
- Do NOT copy full verse text

JSON FORMAT:
{
  "guidance": [
    {
      "chapter": number,
      "verse": number,
      "insight": "short insight",
      "connection": "specific to user situation"
    }
  ],
  "final_advice": "short actionable advice"
}`;

  // 3) Generate Intelligent Fallback First
  const emotionNoun = emotionMap[understanding.emotion] || understanding.emotion;

  const fallbackGuidanceResult = {
    guidance: topVerses.map((v, index) => {
      const connections = [
        `This reduces ${emotionNoun} by shifting focus away from future worries.`,
        `This helps you stay grounded instead of overthinking outcomes.`,
        `This calms the mind by focusing on what you can control.`
      ];
      return {
        chapter: v.chapter,
        verse: v.verse,
        insight: getFallbackInsight(v, index),
        connection: connections[index % connections.length]
      };
    }),
    final_advice: adviceTemplates[understanding.emotion] || "Take one calm step forward"
  };

  let guidanceResult = fallbackGuidanceResult;
  let usedFallback = true;

  // 4) Call LLM as an Optional Enhancer
  try {
    const rawLLMOutput = await callOllama(prompt);
    const parsedLLM = tryParseJson(rawLLMOutput);

    // Build a Set of valid verse IDs that were actually sent to the LLM
    const validVerseIds = new Set(topVerses.map(v => `${v.chapter}-${v.verse}`));

    const isValidGuidance =
      parsedLLM &&
      Array.isArray(parsedLLM.guidance) &&
      parsedLLM.guidance.length > 0 &&
      typeof parsedLLM.final_advice === "string" &&
      parsedLLM.guidance.every(
        g =>
          typeof g.chapter === "number" &&
          typeof g.verse === "number" &&
          typeof g.insight === "string" && g.insight.trim() &&
          typeof g.connection === "string" && g.connection.trim() &&
          validVerseIds.has(`${g.chapter}-${g.verse}`)
      );

    if (isValidGuidance) {
      guidanceResult = parsedLLM;
      usedFallback = false;
    } else {
      throw new Error("Invalid or incomplete JSON structure from LLM");
    }
  } catch (err) {
    logStage("llama_fallback_triggered", { reason: err.message });
  }

  // 5) Practice generation (Agent 5 - deterministic)
  logStage("practice_generation", { mode: "local" });

  // Gather all principles and core ideas
  const allPrinciples = topVerses.reduce((acc, v) => acc.concat(v.principles || []), []);
  const allCoreIdeas = topVerses.map(v => v.core_idea).filter(Boolean);

  const practice = generatePractice({
    emotion: understanding.emotion,
    situation: understanding.situation,
    core_struggle: understanding.core_struggle,
    principles: allPrinciples,
    core_idea: allCoreIdeas[0] // just pass the first main idea
  });

  // 5) Final Assembly
  const finalOutput = {
    understanding: {
      emotion: understanding.emotion,
      emotion_confidence: understanding.emotion_confidence,
      emotion_runner_up: understanding.emotion_runner_up,
      situation: understanding.situation,
      core_struggle: understanding.core_struggle,
      intent_type: understanding.intent_type
    },
    guidance: guidanceResult.guidance,
    final_advice: guidanceResult.final_advice,
    practice
  };

  const outputPath = path.join(projectRoot, "outputs", "answers.json");
  // ensure outputs dir exists
  if (!fs.existsSync(path.join(projectRoot, "outputs"))) {
    fs.mkdirSync(path.join(projectRoot, "outputs"), { recursive: true });
  }
  fs.writeFileSync(outputPath, JSON.stringify(finalOutput, null, 2));

  // Save to memory history
  saveQuery(query, finalOutput);

  logStage("final_output", { output: "outputs/answers.json", used_fallback: usedFallback });
  return finalOutput;
}

async function runFromCli() {
  const cliQuery = process.argv.slice(2).join(" ");
  const query = safeTrim(cliQuery) || "I feel anxious about my future and don't know what to do";

  try {
    const result = await runIntelligentPipeline(query);
    console.log("\n[Pipeline Complete] Output:");
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("[pipeline] fatal error", error.message);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  runFromCli();
}