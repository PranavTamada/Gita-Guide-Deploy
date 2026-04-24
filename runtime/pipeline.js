import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config as loadEnv } from "dotenv";
import { getTopMatches, getConnectedVerses } from "./retrieval.js";

loadEnv();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const versesDataPath = path.join(projectRoot, "data", "verses.json");
const versesData = JSON.parse(fs.readFileSync(versesDataPath, "utf-8"));
const verseDetailsMap = new Map(
  versesData.map(verse => [`${verse.chapter}-${verse.verse}`, verse])
);

const API_KEY = process.env.ANTHROPIC_API_KEY;

const EMOTIONAL_TERMS = new Set([
  "anxiety", "anxious", "fear", "afraid", "grief", "sad", "anger", "angry", "stress",
  "pain", "guilt", "lonely", "hopeless", "confused", "hurt", "peace", "calm"
]);

const SITUATIONAL_TERMS = new Set([
  "job", "career", "work", "business", "money", "debt", "family", "marriage",
  "relationship", "health", "exam", "study", "decision", "conflict", "failure",
  "success", "leadership", "responsibility"
]);

const PHILOSOPHICAL_TERMS = new Set([
  "dharma", "karma", "soul", "self", "truth", "wisdom", "detachment", "duty",
  "moksha", "liberation", "ego", "consciousness", "devotion", "nature"
]);

const FALLBACK_AGENT5_PROMPT = `You are Agent 5, a practical spiritual coach.
Given the user's query and selected verses, generate a concrete 5-10 minute exercise.

The exercise must include all three types with step-by-step instructions:
1) reflection
2) journaling
3) action step

Use each verse's translation, principle, and core_idea.
Keep it simple, practical, and not abstract.

Return only valid JSON in this shape:
{
  "practice": {
    "duration_minutes": 7,
    "reflection": ["step 1", "step 2"],
    "journaling": ["step 1", "step 2"],
    "action_step": ["step 1", "step 2"]
  }
}`;

function logStage(stage, details = {}) {
  console.log("[pipeline]", JSON.stringify({ stage, ...details }));
}

function safeReadPrompt(relativePath, fallback = "") {
  const fullPath = path.join(projectRoot, relativePath);
  if (!fs.existsSync(fullPath)) {
    return fallback;
  }

  return fs.readFileSync(fullPath, "utf-8");
}

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toSentence(text) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return "";
  }

  const sentence = cleaned.split(/[.!?]/)[0].trim();
  return sentence || cleaned;
}

function extractCoreIdea(verseRecord) {
  if (!verseRecord || typeof verseRecord !== "object") {
    return "Take one clear step with steadiness and awareness.";
  }

  if (typeof verseRecord.core_idea === "string" && verseRecord.core_idea.trim()) {
    return verseRecord.core_idea.trim();
  }

  if (Array.isArray(verseRecord.purports) && verseRecord.purports.length > 0) {
    const firstPurport = verseRecord.purports.find(item => typeof item === "string" && item.trim());
    if (firstPurport) {
      return toSentence(firstPurport);
    }
  }

  if (typeof verseRecord.purport === "string" && verseRecord.purport.trim()) {
    return toSentence(verseRecord.purport);
  }

  if (Array.isArray(verseRecord.principles) && verseRecord.principles.length > 0) {
    const firstPrinciple = verseRecord.principles.find(item => typeof item === "string" && item.trim());
    if (firstPrinciple) {
      return firstPrinciple.trim();
    }
  }

  return toSentence(verseRecord.translation) || "Act with clarity in one practical task today.";
}

function enrichVerseForPractice(verse) {
  const details = verseDetailsMap.get(verse.id) || {};
  const principles = Array.isArray(details.principles) ? details.principles : [];

  return {
    ...verse,
    principle: principles[0] || "Steady action with awareness.",
    principles,
    core_idea: extractCoreIdea(details)
  };
}

function classifyQuery(query) {
  const terms = normalize(query)
    .split(" ")
    .filter(Boolean);

  let emotional = 0;
  let situational = 0;
  let philosophical = 0;

  for (const term of terms) {
    if (EMOTIONAL_TERMS.has(term)) emotional += 1;
    if (SITUATIONAL_TERMS.has(term)) situational += 1;
    if (PHILOSOPHICAL_TERMS.has(term)) philosophical += 1;
  }

  const scores = { emotional, situational, philosophical };
  const type = Object.entries(scores).sort((a, b) => b[1] - a[1])[0][1] > 0
    ? Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0]
    : "philosophical";

  return { type, scores, terms };
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

function computeKnowledgeGraphSignal(verseId, queryType) {
  const neighbors = getConnectedVerses(verseId, 1).slice(0, 5);
  if (neighbors.length === 0) {
    return { kg_score: 0, neighbors_sample: [] };
  }

  const scored = neighbors.map(item => {
    const connection = item.connection || {};
    const emotionalSignal = (connection.shared_emotion_tags || []).length;
    const situationalSignal = (connection.shared_life_situations || []).length;
    const philosophicalSignal = (connection.shared_principles || []).length;

    let typeSignal = philosophicalSignal;
    if (queryType === "emotional") typeSignal = emotionalSignal;
    if (queryType === "situational") typeSignal = situationalSignal;

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

function selectTopVersesWithKg(hybridVerses, queryType, topK = 3) {
  const rescored = hybridVerses.map(verse => {
    const baseScore = clamp01(verse.final_score || 0);
    const kgSignal = computeKnowledgeGraphSignal(verse.id, queryType);
    const finalHybridScore = clamp01((baseScore * 0.85) + (kgSignal.kg_score * 0.15));
    const enrichedVerse = enrichVerseForPractice(verse);

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

function extractTextFromClaudeResponse(data) {
  if (!data || !Array.isArray(data.content)) {
    return "";
  }

  const parts = data.content
    .filter(item => item && item.type === "text")
    .map(item => item.text || "")
    .join("\n")
    .trim();

  return parts;
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function callClaude(systemPrompt, userContent, stageName) {
  if (!API_KEY) {
    throw new Error("Missing ANTHROPIC_API_KEY in environment");
  }

  logStage(`${stageName}_request`, { model: "claude-3-haiku-20240307" });

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-3-haiku-20240307",
      max_tokens: 1000,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: userContent
        }
      ]
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Claude API failed (${response.status}): ${body}`);
  }

  const data = await response.json();
  const text = extractTextFromClaudeResponse(data);

  logStage(`${stageName}_response`, { characters: text.length });

  return text;
}

function buildAgent4UserMessage(query, queryClassification, verses) {
  return [
    `User Query:\n${query}`,
    `\nQuery Classification:\n${JSON.stringify(queryClassification, null, 2)}`,
    `\nSelected Verses (top 3):\n${JSON.stringify(verses, null, 2)}`,
    "\nReturn only valid JSON with keys: understanding, guidance"
  ].join("\n");
}

function buildAgent5UserMessage(query, understanding, guidance, verses) {
  return [
    `User Query:\n${query}`,
    `\nUnderstanding:\n${understanding}`,
    `\nGuidance:\n${guidance}`,
    `\nVerses (with principle and core_idea):\n${JSON.stringify(verses, null, 2)}`,
    "\nGenerate a 5-10 minute exercise.",
    "It must contain reflection, journaling, and action step.",
    "Provide step-by-step instructions only.",
    "Keep it simple and practical.",
    "\nReturn only valid JSON in this shape:",
    "{\"practice\":{\"duration_minutes\":7,\"reflection\":[\"step 1\"],\"journaling\":[\"step 1\"],\"action_step\":[\"step 1\"]}}"
  ].join("\n");
}

function normalizeAgent4Output(rawText) {
  const parsed = tryParseJson(rawText);
  if (parsed && (parsed.understanding || parsed.guidance)) {
    return {
      understanding: String(parsed.understanding || "").trim(),
      guidance: String(parsed.guidance || "").trim()
    };
  }

  return {
    understanding: "I hear your concern and the deeper need for clarity and steadiness.",
    guidance: rawText.trim() || "Use the selected verses as anchors for reflective action."
  };
}

function normalizeAgent5Output(rawText) {
  const parsed = tryParseJson(rawText);
  if (parsed && parsed.practice) {
    if (typeof parsed.practice === "object") {
      const durationRaw = Number(parsed.practice.duration_minutes);
      const duration = Number.isFinite(durationRaw)
        ? Math.max(5, Math.min(10, durationRaw))
        : 7;

      const reflection = Array.isArray(parsed.practice.reflection)
        ? parsed.practice.reflection.filter(Boolean)
        : [];
      const journaling = Array.isArray(parsed.practice.journaling)
        ? parsed.practice.journaling.filter(Boolean)
        : [];
      const actionStep = Array.isArray(parsed.practice.action_step)
        ? parsed.practice.action_step.filter(Boolean)
        : [];

      const stepsBlock = (label, steps) => {
        if (steps.length === 0) {
          return `${label}:\n1. Do one small, clear step related to this section.`;
        }

        return `${label}:\n${steps.map((step, i) => `${i + 1}. ${String(step).trim()}`).join("\n")}`;
      };

      return {
        practice: [
          `${duration}-minute exercise`,
          stepsBlock("Reflection", reflection),
          stepsBlock("Journaling", journaling),
          stepsBlock("Action Step", actionStep)
        ].join("\n\n")
      };
    }

    return {
      practice: String(parsed.practice).trim()
    };
  }

  return {
    practice: rawText.trim() || [
      "7-minute exercise",
      "Reflection:\n1. Read one selected verse once.\n2. Ask: what one message do I need right now?",
      "Journaling:\n1. Write your current challenge in one sentence.\n2. Write one principle from the verse that applies today.",
      "Action Step:\n1. Choose one action that takes under 10 minutes.\n2. Complete it before the day ends."
    ].join("\n\n")
  };
}

export async function runIntelligentPipeline(query) {
  if (!query || !String(query).trim()) {
    throw new Error("Query is required");
  }

  logStage("start", { query_length: String(query).trim().length });

  // 1) Classify query
  const queryClassification = classifyQuery(query);
  logStage("classify_query", queryClassification);

  // 2) Hybrid retrieval (vector + metadata + KG)
  const hybridCandidates = await getTopMatches(query, 9);
  logStage("hybrid_retrieval", { candidate_count: hybridCandidates.length });

  const topVerses = selectTopVersesWithKg(hybridCandidates, queryClassification.type, 3);
  logStage("select_top_verses", {
    selected: topVerses.map(v => ({
      id: v.id,
      final_hybrid_score: v.final_hybrid_score,
      base_score: v.final_score,
      kg_score: v.kg_score
    }))
  });

  // 3) Agent 4: reasoning
  const agent4Prompt = safeReadPrompt("prompts/agent4.txt");
  const agent4UserContent = buildAgent4UserMessage(query, queryClassification, topVerses);
  const reasoningRaw = await callClaude(agent4Prompt, agent4UserContent, "agent4_reasoning");
  const reasoning = normalizeAgent4Output(reasoningRaw);

  // 4) Agent 5: practice
  const agent5Prompt = safeReadPrompt("prompts/agent5.txt", FALLBACK_AGENT5_PROMPT);
  const agent5UserContent = buildAgent5UserMessage(
    query,
    reasoning.understanding,
    reasoning.guidance,
    topVerses
  );
  const practiceRaw = await callClaude(agent5Prompt, agent5UserContent, "agent5_practice");
  const practiceResult = normalizeAgent5Output(practiceRaw);

  // 5) Final response
  const finalResponse = {
    understanding: reasoning.understanding,
    guidance: reasoning.guidance,
    practice: practiceResult.practice
  };

  const outputPayload = {
    query,
    query_classification: queryClassification,
    selected_verses: topVerses,
    result: finalResponse
  };

  const outputPath = path.join(projectRoot, "outputs", "answers.json");
  fs.writeFileSync(outputPath, JSON.stringify(outputPayload, null, 2));

  logStage("complete", { output: "outputs/answers.json" });
  return finalResponse;
}

async function runFromCli() {
  const cliQuery = process.argv.slice(2).join(" ").trim();
  const query = cliQuery || "I feel anxious about my future and don't know what to do";

  try {
    const result = await runIntelligentPipeline(query);
    console.log("[pipeline] final_result", JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("[pipeline] error", error.message);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  runFromCli();
}