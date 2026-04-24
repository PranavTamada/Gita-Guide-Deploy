import fetch from "node-fetch"; // VERY IMPORTANT
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config as loadEnv } from "dotenv";
import { getTopMatches, getConnectedVerses } from "./retrieval.js";
import { generatePractice } from "./practiceGenerator.js";

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
const OLLAMA_MODEL = "mistral"; // the requested lightweight model

const EMOTIONAL_TERMS = new Set([
  "anxiety", "anxious", "fear", "afraid", "grief", "sad", "anger", "angry", "stress",
  "pain", "guilt", "lonely", "hopeless", "confused", "hurt", "peace", "calm"
]);

const SITUATIONAL_TERMS = new Set([
  "job", "career", "work", "business", "money", "debt", "family", "marriage",
  "relationship", "health", "exam", "study", "decision", "conflict", "failure",
  "success", "leadership", "responsibility", "loss", "uncertainty"
]);

const emotionMap = {
  anxious: "anxiety",
  angry: "anger",
  sad: "sadness",
  confused: "confusion",
  fear: "fear",
  seeking: "seeking",
  grief: "grief"
};

const adviceTemplates = {
  anxious: "Take one small action today without worrying about results",
  confused: "Choose one option and take the first step immediately",
  angry: "Pause and respond calmly instead of reacting instantly",
  sad: "Focus on one positive action you can take today"
};

const principleMap = {
  "detachment": "Focus on effort instead of worrying about results",
  "control mind": "Control your thoughts instead of reacting to them",
  "self-knowledge": "Understand your inner self before making decisions",
  "duty": "Fulfill your responsibilities without attachment to comfort",
  "devotion": "Dedicate your actions to a higher purpose",
  "surrender": "Release what you cannot control and trust the process",
  "discipline": "Master yourself through focused action",
  "knowledge": "Seek true understanding over temporary feelings",
  "equanimity": "Remain steady in both success and failure",
  "action": "Take right action without fear of the outcome",
  "faith": "Trust the process even amidst uncertainty"
};

function getFallbackInsight(verse, usedInsights) {
  const principles = verse.principles || [];
  let candidate = null;

  for (const p of principles) {
    if (p && principleMap[p.toLowerCase()]) {
      candidate = principleMap[p.toLowerCase()];
      break;
    }
    // partial matches
    for (const [key, value] of Object.entries(principleMap)) {
      if (p.toLowerCase().includes(key)) {
        candidate = value;
        break;
      }
    }
    if (candidate) break;
  }

  if (!candidate) {
    candidate = "Stay steady and act without fear";
  }

  // Prevent exact repetition if the user is getting identical insights
  if (usedInsights.has(candidate)) {
    const alternatives = [
      "Focus on your path and keep moving forward",
      "Release anxiety by anchoring yourself in the present",
      "Embrace clarity over confusion with steady action"
    ];
    candidate = alternatives[usedInsights.size % alternatives.length];
  }

  usedInsights.add(candidate);
  return candidate;
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
  // We only save the output metadata to keep memory light
  history.push({ query, timestamp: new Date().toISOString(), result });
  // Keep last 50 queries to prevent file bloat
  if (history.length > 50) history.shift();
  fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
}

function logStage(stage, details = {}) {
  console.log("[pipeline]", JSON.stringify({ stage, ...details }));
}

function safeTrim(value) {
  return (String(value || "")).trim();
}

function analyzeQuery(query) {
  const qStr = safeTrim(query).toLowerCase();
  const terms = qStr.split(/[^a-z0-9]+/);

  let emotion = "seeking";
  let situation = "general";
  let core_struggle = "";

  // Phrase matching rules
  if (qStr.includes("future")) {
    situation = "uncertainty about the future";
  } else if (qStr.includes("don't know") || qStr.includes("do not know")) {
    situation = "decision-making confusion";
  } else if (qStr.includes("job") || qStr.includes("career")) {
    situation = "career decision";
  } else {
    // Fallback to word matching for situation
    for (const term of terms) {
      if (term && SITUATIONAL_TERMS.has(term)) {
        situation = term;
        break;
      }
    }
  }

  // Emotion word matching
  for (const term of terms) {
    if (term && EMOTIONAL_TERMS.has(term)) {
      emotion = term;
      break;
    }
  }

  // Generate natural core struggle
  if (situation === "uncertainty about the future" || situation === "decision-making confusion" || situation === "career decision") {
    core_struggle = `fear of making the wrong decision about the ${situation === "career decision" ? "career" : "future"}`;
  } else {
    core_struggle = `${emotion} regarding ${situation}`;
  }

  return { emotion, situation, core_struggle };
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
      timeout: 30000 // 30s timeout
    });

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
    console.error("❌ Ollama Call Error:", err.message);
    throw err; // Propagate error to trigger fallback
  }
}

export async function runIntelligentPipeline(query) {
  query = safeTrim(query);
  if (!query) {
    throw new Error("Query is required");
  }

  logStage("start", { query });

  // 1) Analyze query (Rule-based)
  const understanding = analyzeQuery(query);
  logStage("analyze_query", understanding);

  // 2) Hybrid retrieval
  const hybridCandidates = await getTopMatches(query, 9);
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
    guidance: topVerses.map(v => ({
      chapter: v.chapter,
      verse: v.verse,
      insight: getFallbackInsight(v),
      connection: `This helps reduce ${emotionNoun} caused by overthinking ${understanding.situation}.`
    })),
    final_advice: adviceTemplates[understanding.emotion] || "Take one calm step forward"
  };

  let guidanceResult = fallbackGuidanceResult;
  let usedFallback = true;

  // 4) Call LLM as an Optional Enhancer
  try {
    const rawLLMOutput = await callOllama(prompt);
    const parsedLLM = tryParseJson(rawLLMOutput);

    if (parsedLLM && Array.isArray(parsedLLM.guidance)) {
      guidanceResult = parsedLLM;
      usedFallback = false;
    } else {
      throw new Error("Invalid JSON structure from LLM");
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
    principles: allPrinciples,
    core_idea: allCoreIdeas[0] // just pass the first main idea
  });

  // 5) Final Assembly
  const finalOutput = {
    understanding,
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