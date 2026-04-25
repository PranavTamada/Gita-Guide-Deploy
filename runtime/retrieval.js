import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { vectorStore } from "./vectorStore.js";

const __retrieval_dir = path.dirname(fileURLToPath(import.meta.url));
const versesDataPath = path.join(__retrieval_dir, '../data/verses.json');

const data = JSON.parse(fs.readFileSync(versesDataPath, "utf-8"));
const verseMap = new Map(
  data.map(verse => [`${verse.chapter}-${verse.verse}`, verse])
);

// ---------------------------------------------------------------------------
// Chapter-arc zones (2.3)
// Gita's 18 chapters fall into three broad thematic zones.
// Diversification prefers one result from each zone.
// ---------------------------------------------------------------------------
const CHAPTER_ZONES = {
  karma:    new Set([1, 2, 3, 4, 5, 6]),      // Karma Yoga / duty / action
  devotion: new Set([7, 8, 9, 10, 11, 12]),   // Bhakti / divine knowledge
  knowledge: new Set([13, 14, 15, 16, 17, 18]) // Jnana / renunciation
};

function chapterZone(chapter) {
  for (const [zone, chaps] of Object.entries(CHAPTER_ZONES)) {
    if (chaps.has(chapter)) return zone;
  }
  return "other";
}

// ---------------------------------------------------------------------------
// Simple query result cache (2.4)
// ---------------------------------------------------------------------------
const CACHE_MAX = 100;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const _queryCache = new Map(); // key: `${query}|${topK}` → { ts, results }

function cacheGet(key) {
  const entry = _queryCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) { _queryCache.delete(key); return null; }
  return entry.results;
}

function cacheSet(key, results) {
  if (_queryCache.size >= CACHE_MAX) {
    // Evict the oldest entry
    _queryCache.delete(_queryCache.keys().next().value);
  }
  _queryCache.set(key, { ts: Date.now(), results });
}

let knowledgeGraph = null;

// Base weights for hybrid scoring
const WEIGHT_BASE = {
  vector: 0.5,      // Vector similarity weight
  emotion: 0.3,     // Emotion tags match weight
  lifeSituation: 0.15, // Life situations match weight
  keywords: 0.05    // Keywords match weight
};

const EMOTIONAL_TERMS = new Set([
  "anxiety", "anxious", "fear", "afraid", "grief", "sad", "anger", "angry", "pain",
  "guilt", "lonely", "loneliness", "stress", "depressed", "hopeless", "confused", "hurt",
  "love", "compassion", "peace", "calm", "joy"
]);

const SITUATIONAL_TERMS = new Set([
  "job", "career", "work", "office", "boss", "business", "money", "debt", "family",
  "marriage", "relationship", "parent", "children", "health", "study", "exam", "decision",
  "conflict", "failure", "success", "loss", "responsibility", "leadership", "friend"
]);

const PHILOSOPHICAL_TERMS = new Set([
  "dharma", "karma", "atma", "soul", "self", "truth", "reality", "consciousness", "wisdom",
  "knowledge", "devotion", "detachment", "duty", "action", "mind", "moksha", "liberation",
  "being", "existence", "ego", "nature", "faith", "virtue"
]);

function clamp01(value) {
  const num = Number(value) || 0;
  if (num < 0) return 0;
  if (num > 1) return 1;
  return num;
}

function roundTo(value, places = 4) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function normalizeWeights(weights) {
  const safe = {
    vector: Math.max(0, weights.vector || 0),
    emotion: Math.max(0, weights.emotion || 0),
    lifeSituation: Math.max(0, weights.lifeSituation || 0),
    keywords: Math.max(0, weights.keywords || 0)
  };

  const total = safe.vector + safe.emotion + safe.lifeSituation + safe.keywords;
  if (total === 0) {
    return { ...WEIGHT_BASE };
  }

  return {
    vector: safe.vector / total,
    emotion: safe.emotion / total,
    lifeSituation: safe.lifeSituation / total,
    keywords: safe.keywords / total
  };
}

function classifyQuery(queryTerms) {
  let emotionalHits = 0;
  let situationalHits = 0;
  let philosophicalHits = 0;

  for (const term of queryTerms) {
    if (EMOTIONAL_TERMS.has(term)) emotionalHits += 1;
    if (SITUATIONAL_TERMS.has(term)) situationalHits += 1;
    if (PHILOSOPHICAL_TERMS.has(term)) philosophicalHits += 1;
  }

  const scores = {
    emotional: emotionalHits,
    situational: situationalHits,
    philosophical: philosophicalHits
  };

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  const type = top[1] > 0 ? top[0] : "philosophical";

  return {
    type,
    scores
  };
}

function getAdaptiveWeights(queryType, classificationScores) {
  const adaptive = { ...WEIGHT_BASE };

  if (queryType === "emotional") {
    adaptive.emotion += 0.18;
    adaptive.vector -= 0.1;
    adaptive.lifeSituation -= 0.05;
    adaptive.keywords -= 0.03;
  } else if (queryType === "situational") {
    adaptive.lifeSituation += 0.2;
    adaptive.vector -= 0.1;
    adaptive.emotion -= 0.06;
    adaptive.keywords -= 0.04;
  } else {
    adaptive.vector += 0.1;
    adaptive.keywords += 0.04;
    adaptive.emotion -= 0.08;
    adaptive.lifeSituation -= 0.06;
  }

  // Confidence bump for stronger signals
  if (classificationScores.emotional >= 2) {
    adaptive.emotion += 0.05;
  }
  if (classificationScores.situational >= 2) {
    adaptive.lifeSituation += 0.05;
  }
  if (classificationScores.philosophical >= 2) {
    adaptive.vector += 0.04;
  }

  return normalizeWeights(adaptive);
}

/**
 * Translate intent-analyzer searchBias to internal weight schema,
 * then normalize. This enables field-level FAISS switching driven
 * by the intent understanding component.
 *
 * @param {object} bias - { vectorWeight, emotionWeight, lifeSituationWeight, keywordsWeight }
 * @returns {object} Internal normalized weights
 */
function weightsFromBias(bias) {
  if (!bias || typeof bias !== "object") return null;
  return normalizeWeights({
    vector:        bias.vectorWeight        ?? WEIGHT_BASE.vector,
    emotion:       bias.emotionWeight       ?? WEIGHT_BASE.emotion,
    lifeSituation: bias.lifeSituationWeight ?? WEIGHT_BASE.lifeSituation,
    keywords:      bias.keywordsWeight      ?? WEIGHT_BASE.keywords
  });
}

function logScoringDecision(query, queryType, adaptiveWeights, classificationScores, mode) {
  console.log(
    "[retrieval] scoring_decision",
    JSON.stringify({
      mode,
      query,
      query_type: queryType,
      classification_scores: classificationScores,
      adaptive_weights: {
        vector: roundTo(adaptiveWeights.vector),
        emotion: roundTo(adaptiveWeights.emotion),
        life_situation: roundTo(adaptiveWeights.lifeSituation),
        keywords: roundTo(adaptiveWeights.keywords)
      }
    })
  );
}

function normalizeGraphValue(value) {
  return String(value || "")
    .toLowerCase()
    .trim();
}

function toNormalizedSet(values) {
  if (!Array.isArray(values)) {
    return new Set();
  }

  return new Set(
    values
      .map(normalizeGraphValue)
      .filter(Boolean)
  );
}

function getSharedValues(setA, setB) {
  const shared = [];

  for (const value of setA) {
    if (setB.has(value)) {
      shared.push(value);
    }
  }

  return shared;
}

function createConnectionResult(targetId, hops, path, edge) {
  const verse = verseMap.get(targetId);

  if (!verse) {
    return null;
  }

  return {
    id: targetId,
    chapter: verse.chapter,
    verse: verse.verse,
    translation: verse.translation,
    hops,
    path,
    connection: {
      shared_emotion_tags: edge.shared_emotion_tags,
      shared_principles: edge.shared_principles,
      shared_life_situations: edge.shared_life_situations,
      weight: edge.weight
    }
  };
}

/**
 * Build a verse-level knowledge graph using shared metadata.
 * Graph format is JSON-friendly adjacency list.
 */
export function buildGraph(forceRebuild = false) {
  if (knowledgeGraph && !forceRebuild) {
    return knowledgeGraph;
  }

  const adjacency = {};
  const prepared = data.map(verse => ({
    id: `${verse.chapter}-${verse.verse}`,
    chapter: verse.chapter,
    verse: verse.verse,
    emotionTags: toNormalizedSet(verse.emotion_tags),
    principles: toNormalizedSet(verse.principles),
    lifeSituations: toNormalizedSet(verse.life_situations)
  }));

  prepared.forEach(node => {
    adjacency[node.id] = [];
  });

  let undirectedEdgeCount = 0;

  for (let i = 0; i < prepared.length; i += 1) {
    for (let j = i + 1; j < prepared.length; j += 1) {
      const left = prepared[i];
      const right = prepared[j];

      const sharedEmotionTags = getSharedValues(left.emotionTags, right.emotionTags);
      const sharedPrinciples = getSharedValues(left.principles, right.principles);
      const sharedLifeSituations = getSharedValues(left.lifeSituations, right.lifeSituations);

      const weight =
        sharedEmotionTags.length +
        sharedPrinciples.length +
        sharedLifeSituations.length;

      if (weight === 0) {
        continue;
      }

      undirectedEdgeCount += 1;

      const edge = {
        shared_emotion_tags: sharedEmotionTags,
        shared_principles: sharedPrinciples,
        shared_life_situations: sharedLifeSituations,
        weight
      };

      adjacency[left.id].push({ target: right.id, ...edge });
      adjacency[right.id].push({ target: left.id, ...edge });
    }
  }

  knowledgeGraph = {
    nodes: prepared.map(node => ({
      id: node.id,
      chapter: node.chapter,
      verse: node.verse
    })),
    adjacency,
    node_count: prepared.length,
    edge_count: undirectedEdgeCount
  };

  return knowledgeGraph;
}

/**
 * Get connected verses by traversing graph up to N hops.
 */
export function getConnectedVerses(verseId, depth = 1) {
  if (!verseId || depth < 1) {
    return [];
  }

  const graph = buildGraph();
  if (!graph.adjacency[verseId]) {
    return [];
  }

  const queue = [{ id: verseId, hops: 0, path: [verseId] }];
  const seenHops = new Map([[verseId, 0]]);
  const discovered = new Map();

  while (queue.length > 0) {
    const current = queue.shift();

    if (!current || current.hops >= depth) {
      continue;
    }

    const neighbors = graph.adjacency[current.id] || [];
    for (const edge of neighbors) {
      const nextId = edge.target;
      if (nextId === verseId) {
        continue;
      }

      const nextHops = current.hops + 1;
      const bestSeen = seenHops.get(nextId);
      if (bestSeen !== undefined && bestSeen <= nextHops) {
        continue;
      }

      seenHops.set(nextId, nextHops);

      const nextPath = [...current.path, nextId];
      queue.push({ id: nextId, hops: nextHops, path: nextPath });

      const result = createConnectionResult(nextId, nextHops, nextPath, edge);
      if (!result) {
        continue;
      }

      const existing = discovered.get(nextId);
      if (!existing || result.hops < existing.hops) {
        discovered.set(nextId, result);
      }
    }
  }

  return [...discovered.values()].sort((a, b) => {
    if (a.hops !== b.hops) {
      return a.hops - b.hops;
    }

    return b.connection.weight - a.connection.weight;
  });
}

/**
 * Parse query into terms
 */
function parseQuery(query) {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(term => term.length > 2); // Filter out short words
}

/**
 * Calculate emotion tags match score (0-1)
 */
function calculateEmotionScore(verse, queryTerms) {
  if (!verse.emotion_tags || verse.emotion_tags.length === 0) {
    return 0;
  }

  const emotionMatches = verse.emotion_tags.filter(emotion =>
    queryTerms.some(term => emotion.toLowerCase().includes(term))
  );

  return emotionMatches.length / verse.emotion_tags.length;
}

/**
 * Calculate life situations match score (0-1)
 */
function calculateLifeSituationScore(verse, queryTerms) {
  if (!verse.life_situations || verse.life_situations.length === 0) {
    return 0;
  }

  const situationMatches = verse.life_situations.filter(situation =>
    queryTerms.some(term => situation.toLowerCase().includes(term))
  );

  return situationMatches.length / verse.life_situations.length;
}

/**
 * Calculate keywords match score (0-1)
 */
function calculateKeywordScore(verse, queryTerms) {
  if (!verse.keywords || verse.keywords.length === 0) {
    return 0;
  }

  const keywordMatches = verse.keywords.filter(keyword =>
    queryTerms.some(term => keyword.toLowerCase().includes(term))
  );

  return keywordMatches.length / verse.keywords.length;
}

/**
 * Create score breakdown object
 */
function createScoreBreakdown(vectorScore, emotionScore, lifeSituationScore, keywordScore, adaptiveWeights, queryType) {
  const normalizedVector = clamp01(vectorScore);
  const normalizedEmotion = clamp01(emotionScore);
  const normalizedLifeSituation = clamp01(lifeSituationScore);
  const normalizedKeywords = clamp01(keywordScore);

  const breakdown = {
    vector: roundTo(normalizedVector),
    emotion: roundTo(normalizedEmotion),
    life_situation: roundTo(normalizedLifeSituation),
    keywords: roundTo(normalizedKeywords)
  };

  const finalScore = clamp01(
    (breakdown.vector * adaptiveWeights.vector) +
    (breakdown.emotion * adaptiveWeights.emotion) +
    (breakdown.life_situation * adaptiveWeights.lifeSituation) +
    (breakdown.keywords * adaptiveWeights.keywords)
  );

  return {
    ...breakdown,
    query_type: queryType,
    adaptive_weights: {
      vector: roundTo(adaptiveWeights.vector),
      emotion: roundTo(adaptiveWeights.emotion),
      life_situation: roundTo(adaptiveWeights.lifeSituation),
      keywords: roundTo(adaptiveWeights.keywords)
    },
    final: roundTo(finalScore)
  };
}

/**
 * Remove near-duplicate results
 */
function deduplicateResults(results, similarityThreshold = 0.95) {
  const deduplicated = [];
  const seen = new Set();

  for (const result of results) {
    const id = `${result.chapter}-${result.verse}`;

    if (!seen.has(id)) {
      deduplicated.push(result);
      seen.add(id);
    }
  }

  return deduplicated;
}

/**
 * Ensure diverse results across different chapters/topics
 */
function diversifyResults(results, topK = 3) {
  if (results.length <= topK) return results.slice(0, topK);

  // For large pools (KG re-ranking): just return top by score
  if (topK >= 6) return results.slice(0, topK);

  const diverse = [];
  const zonesUsed = new Set();
  const seenIds   = new Set();

  // First pass: prefer one result per chapter-arc zone (2.3)
  for (const result of results) {
    if (diverse.length >= topK) break;
    const zone = chapterZone(result.chapter);
    if (!zonesUsed.has(zone) || diverse.length < 1) {
      diverse.push(result);
      seenIds.add(result.id);
      zonesUsed.add(zone);
    }
  }

  // Second pass: fill remaining with highest-scoring unseen verses
  for (const result of results) {
    if (diverse.length >= topK) break;
    if (!seenIds.has(result.id)) {
      diverse.push(result);
      seenIds.add(result.id);
    }
  }

  return diverse.slice(0, topK);
}

/**
 * Hybrid retrieval combining vector search with metadata scoring.
 *
 * @param {string} query  - User query text
 * @param {number} topK   - Number of results to return
 * @param {object} [intentBias] - Optional field-level weight bias from intentAnalyzer.
 *   Shape: { vectorWeight, emotionWeight, lifeSituationWeight, keywordsWeight }
 * @param {object} [intentLabels] - Optional { emotion, situation } from intentAnalyzer
 *   to inject canonical labels as extra metadata scoring terms.
 */
export async function getTopMatches(query, topK = 3, intentBias = null, intentLabels = null) {
  // Cache check (2.4)
  const cacheKey = `${query}|${topK}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    console.log("[retrieval] cache_hit", { query: query.slice(0, 40) });
    return cached;
  }

  try {
    // Initialize vector store if needed
    if (!vectorStore.isBuilt) {
      try {
        vectorStore.loadIndex();
      } catch {
        // Index not available, fall back to metadata-only search
        return getMetadataOnlySearch(query, topK, intentBias, intentLabels);
      }
    }

    // Build query terms: raw user words PLUS canonical intent labels.
    // This ensures "anxious" triggers "anxiety" in verse emotion_tags, and
    // "I feel lost" triggers "search for meaning" in verse life_situations.
    const rawTerms = parseQuery(query);
    const labelTerms = intentLabels
      ? [
          ...(intentLabels.emotion ? parseQuery(intentLabels.emotion) : []),
          ...(intentLabels.situation ? parseQuery(intentLabels.situation) : [])
        ]
      : [];
    const queryTerms = [...new Set([...rawTerms, ...labelTerms])];

    // Determine adaptive weights: intent bias takes precedence over heuristics
    let adaptiveWeights;
    let queryType;
    let classificationScores = { emotional: 0, situational: 0, philosophical: 0 };

    const biasWeights = weightsFromBias(intentBias);
    if (biasWeights) {
      adaptiveWeights = biasWeights;
      // Derive a human-readable query type label for logging
      queryType = intentBias.emotionWeight >= 0.35
        ? "intent:emotional"
        : intentBias.keywordsWeight >= 0.20
          ? "intent:philosophical"
          : "intent:action";
    } else {
      const classification = classifyQuery(queryTerms);
      adaptiveWeights = getAdaptiveWeights(classification.type, classification.scores);
      queryType = classification.type;
      classificationScores = classification.scores;
    }

    logScoringDecision(query, queryType, adaptiveWeights, classificationScores,
      biasWeights ? "hybrid:intent_bias" : "hybrid:heuristic");

    // 1. Get vector similarity results (get more than topK for hybrid scoring)
    let vectorResults = [];
    try {
      vectorResults = await vectorStore.search(query, topK * 3);
    } catch (error) {
      console.error("Vector search error:", error);
      return getMetadataOnlySearch(query, topK, intentBias, intentLabels);
    }

    // 2. Create a map of verse IDs to vector scores
    const vectorScoreMap = new Map();
    vectorResults.forEach((result) => {
      const id = result.id;
      vectorScoreMap.set(id, result.similarity);
    });

    // 3. Combine vector scores with metadata scores
    const hybridResults = data.map(verse => {
      const verseId = `${verse.chapter}-${verse.verse}`;

      // Get vector similarity score
      const vectorScore = vectorScoreMap.get(verseId) || 0;

      // Calculate metadata scores
      const emotionScore = calculateEmotionScore(verse, queryTerms);
      const lifeSituationScore = calculateLifeSituationScore(verse, queryTerms);
      const keywordScore = calculateKeywordScore(verse, queryTerms);

      // Create score breakdown
      const scoreBreakdown = createScoreBreakdown(
        vectorScore,
        emotionScore,
        lifeSituationScore,
        keywordScore,
        adaptiveWeights,
        queryType
      );

      return {
        id: verseId,
        chapter: verse.chapter,
        verse: verse.verse,
        translation: verse.translation,
        keywords: verse.keywords || [],
        life_situations: verse.life_situations || [],
        emotion_tags: verse.emotion_tags || [],
        score_breakdown: scoreBreakdown,
        final_score: scoreBreakdown.final
      };
    });

    // 4. Sort — do NOT filter to > 0: when the vector store IS available, vector
    // scores alone can be nonzero even if metadata scores are 0.
    const sortedResults = hybridResults.sort((a, b) => b.final_score - a.final_score);
    const positiveResults = sortedResults.filter(r => r.final_score > 0);
    // Guarantee at least topK candidates for the KG re-ranking stage
    const resultPool = positiveResults.length >= topK ? positiveResults : sortedResults;

    // 5. Remove duplicates
    const deduplicated = deduplicateResults(resultPool);

    // 6. Diversify results (passthrough for topK >= 6)
    const diverse = diversifyResults(deduplicated, topK);
    cacheSet(cacheKey, diverse);
    return diverse;
  } catch (error) {
    console.error("Hybrid retrieval error:", error);
    return getMetadataOnlySearch(query, topK, intentBias, intentLabels);
  }
}

/**
 * Fallback: Metadata-only search (when vector store not available)
 */
function getMetadataOnlySearch(query, topK = 3, intentBias = null, intentLabels = null) {
  const rawQueryTerms = parseQuery(query);

  // Inject canonical intent labels as extra scoring terms so that emotion/situation
  // names from intentAnalyzer (e.g. "anxiety", "grief from loss") directly match
  // verse metadata even when the user wrote different words.
  const labelTerms = intentLabels
    ? [
        ...(intentLabels.emotion ? parseQuery(intentLabels.emotion) : []),
        ...(intentLabels.situation ? parseQuery(intentLabels.situation) : [])
      ]
    : [];
  const queryTerms = [...new Set([...rawQueryTerms, ...labelTerms])];

  let adaptiveWeights;
  let queryType;
  let classificationScores = { emotional: 0, situational: 0, philosophical: 0 };

  const biasWeights = weightsFromBias(intentBias);
  if (biasWeights) {
    adaptiveWeights = biasWeights;
    queryType = "intent_bias:metadata_fallback";
  } else {
    const classification = classifyQuery(queryTerms);
    adaptiveWeights = getAdaptiveWeights(classification.type, classification.scores);
    queryType = classification.type;
    classificationScores = classification.scores;
  }

  logScoringDecision(query, queryType, adaptiveWeights, classificationScores, "metadata_only");

  const results = data.map(verse => {
    const emotionScore = calculateEmotionScore(verse, queryTerms);
    const lifeSituationScore = calculateLifeSituationScore(verse, queryTerms);
    const keywordScore = calculateKeywordScore(verse, queryTerms);

    const scoreBreakdown = createScoreBreakdown(
      0,
      emotionScore,
      lifeSituationScore,
      keywordScore,
      adaptiveWeights,
      queryType
    );

    return {
      id: `${verse.chapter}-${verse.verse}`,
      chapter: verse.chapter,
      verse: verse.verse,
      translation: verse.translation,
      keywords: verse.keywords || [],
      life_situations: verse.life_situations || [],
      emotion_tags: verse.emotion_tags || [],
      score_breakdown: scoreBreakdown,
      final_score: scoreBreakdown.final
    };
  });

  const sorted = results.sort((a, b) => b.final_score - a.final_score);

  // Filter to scored results; if none scored, fall back to the top-scored regardless
  const filtered = sorted.filter(result => result.final_score > 0);
  const pool = filtered.length >= topK ? filtered : sorted; // guaranteed non-empty

  const deduplicated = deduplicateResults(pool);
  return diversifyResults(deduplicated, topK);
}

/**
 * Legacy function for backward compatibility
 */
export function getTopMatchesSync(query) {
  return getMetadataOnlySearch(query, 3);
}