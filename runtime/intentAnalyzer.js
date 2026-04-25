/**
 * intentAnalyzer.js — Deep user intent understanding for Bhagavad Gita search.
 *
 * 5-Layer detection pipeline (no LLM, fully deterministic):
 *   Layer 1 — Syntactic Signals     : first-person framing, query shape detection
 *   Layer 2 — Emotion Taxonomy      : 16-emotion weighted synonym map
 *   Layer 3 — Situation Taxonomy    : phrase-level situational cluster matching
 *   Layer 4 — Intent Frame          : emotional_support | philosophical_seeking | action_guidance
 *   Layer 5 — FAISS Field Bias      : emits field-level weights for vector store query construction
 *
 * Output shape:
 * {
 *   emotion            : string   — canonical emotion tag matching verses.json vocabulary
 *   emotion_confidence : number   — 0–1 float, always present
 *   emotion_runner_up  : string   — second-best emotion (if any)
 *   situation          : string   — canonical life-situation label from verses.json vocabulary
 *   core_struggle      : string   — natural-language synthesis of the above
 *   intent_type        : "emotional_support" | "philosophical_seeking" | "action_guidance"
 *   search_bias        : { vectorWeight, emotionWeight, lifeSituationWeight, keywordsWeight }
 *   query_keywords     : string[] — cleaned tokens for BM25-like boosting
 * }
 */

// ---------------------------------------------------------------------------
// LAYER 2 — Emotion Taxonomy
// Each emotion maps to [ [phrase, weight], ... ] where weight in (0, 1].
// Canonical names MUST match emotion_tags values in verses.json:
//   neutral, anxiety, grief, fear, seeking, clarity, realization, depression,
//   understanding, hope, pride, peace, envy, anger, compassion, greed
// ---------------------------------------------------------------------------

const EMOTION_TAXONOMY = {
  anxiety: {
    phrases: [
      ["anxious", 1.0], ["anxiety", 1.0], ["panic", 0.95], ["panicking", 0.95],
      ["worried", 0.9], ["worry", 0.9], ["nervous", 0.85], ["stress", 0.85],
      ["stressed", 0.85], ["overwhelmed", 0.8], ["restless", 0.8],
      ["uneasy", 0.75], ["apprehensive", 0.75], ["tense", 0.7],
      ["on edge", 0.8], ["dread", 0.85], ["dreading", 0.85],
      ["uncertain about", 0.7], ["scared about", 0.7], ["freaking out", 0.9]
    ]
  },
  fear: {
    phrases: [
      ["fear", 1.0], ["afraid", 1.0], ["terrified", 1.0], ["terror", 0.95],
      ["scared", 0.95], ["frightened", 0.9], ["horrified", 0.9],
      ["petrified", 0.9], ["dread", 0.8], ["phobia", 0.85],
      ["can't face", 0.75], ["cannot face", 0.75], ["don't want to", 0.6]
    ]
  },
  grief: {
    phrases: [
      ["grief", 1.0], ["grieving", 1.0], ["loss", 0.9], ["lost someone", 1.0],
      ["died", 0.95], ["death", 0.9], ["passed away", 1.0], ["bereavement", 1.0],
      ["mourning", 1.0], ["miss them", 0.85], ["missing them", 0.85],
      ["miss my", 0.8], ["can't move on", 0.75], ["cannot move on", 0.75],
      ["heartbroken", 0.85], ["broken heart", 0.85], ["devastated", 0.8],
      ["shattered", 0.75], ["crushed", 0.7]
    ]
  },
  depression: {
    phrases: [
      ["depressed", 1.0], ["depression", 1.0], ["hopeless", 0.95],
      ["hopelessness", 0.95], ["giving up", 0.9], ["want to give up", 0.9],
      ["no point", 0.85], ["meaningless", 0.85], ["numb", 0.8],
      ["empty inside", 0.85], ["feel empty", 0.8], ["can't go on", 0.9],
      ["cannot go on", 0.9], ["pointless", 0.8], ["worthless", 0.85],
      ["dark", 0.65], ["in a dark place", 0.9], ["low", 0.6],
      ["burned out", 0.75], ["burnout", 0.75], ["exhausted", 0.65],
      ["procrastinating", 0.75], ["procrastination", 0.75],
      ["can't bring myself", 0.8], ["unmotivated", 0.8], ["no motivation", 0.8]
    ]
  },
  anger: {
    phrases: [
      ["anger", 1.0], ["angry", 1.0], ["rage", 1.0], ["furious", 1.0],
      ["resentment", 0.95], ["resentful", 0.95], ["frustrated", 0.85],
      ["frustration", 0.85], ["irritated", 0.8], ["irritation", 0.8],
      ["enraged", 0.95], ["bitter", 0.8], ["bitterness", 0.8],
      ["can't let it go", 0.85], ["cannot forgive", 0.85], ["hate", 0.85],
      ["disgusted", 0.75], ["outraged", 0.9], ["livid", 0.9]
    ]
  },
  envy: {
    phrases: [
      ["envy", 1.0], ["envious", 1.0], ["jealous", 1.0], ["jealousy", 1.0],
      ["comparison", 0.8], ["comparing myself", 0.85], ["everyone else has", 0.8],
      ["why not me", 0.8], ["covet", 0.9], ["coveting", 0.9],
      ["bitter about others", 0.75]
    ]
  },
  greed: {
    phrases: [
      ["greed", 1.0], ["greedy", 1.0], ["craving", 0.9], ["crave", 0.85],
      ["desire", 0.7], ["obsessed with", 0.75], ["can't stop wanting", 0.8],
      ["never enough", 0.8], ["wanting more", 0.7], ["accumulation", 0.65]
    ]
  },
  pride: {
    phrases: [
      ["pride", 0.9], ["arrogant", 1.0], ["arrogance", 1.0], ["ego", 0.85],
      ["hubris", 1.0], ["superiority", 0.85], ["look down on", 0.8],
      ["better than others", 0.85], ["self-centered", 0.8], ["narcissism", 0.85]
    ]
  },
  compassion: {
    phrases: [
      ["compassion", 1.0], ["empathy", 0.9], ["care for others", 0.85],
      ["want to help", 0.8], ["feel for others", 0.8], ["suffering of others", 0.85],
      ["selfless", 0.8], ["serve others", 0.85], ["kindness", 0.75]
    ]
  },
  peace: {
    phrases: [
      ["peace", 1.0], ["peaceful", 0.9], ["serenity", 0.95], ["calm", 0.85],
      ["tranquil", 0.9], ["stillness", 0.85], ["inner peace", 1.0],
      ["content", 0.75], ["at ease", 0.8], ["harmony", 0.75], ["quiet mind", 0.85]
    ]
  },
  hope: {
    phrases: [
      ["hope", 1.0], ["hopeful", 1.0], ["optimistic", 0.9], ["optimism", 0.9],
      ["looking forward", 0.75], ["faith", 0.7], ["believe things will", 0.75],
      ["things will get better", 0.85], ["trust in", 0.7]
    ]
  },
  clarity: {
    phrases: [
      ["clarity", 1.0], ["clear", 0.8], ["understand now", 0.85],
      ["makes sense", 0.75], ["beginning to see", 0.75], ["insight", 0.7],
      ["realization", 0.75], ["awakening", 0.8], ["seeing clearly", 0.85]
    ]
  },
  understanding: {
    phrases: [
      ["understand", 0.85], ["understand why", 0.9], ["trying to grasp", 0.8],
      ["trying to comprehend", 0.8], ["makes no sense", 0.75],
      ["confused", 0.8], ["confusion", 0.8], ["confusing", 0.75],
      ["perplexed", 0.85], ["unsure", 0.7], ["lost", 0.65]
    ]
  },
  realization: {
    phrases: [
      ["realized", 1.0], ["just realized", 1.0], ["suddenly realized", 1.0],
      ["woke up", 0.8], ["eye-opening", 0.85], ["changed perspective", 0.8],
      ["turned my life around", 0.75], ["epiphany", 0.95]
    ]
  },
  seeking: {
    phrases: [
      ["searching for", 0.9], ["seeking", 0.9], ["looking for meaning", 0.9],
      ["what is the purpose", 0.9], ["purpose of life", 0.9],
      ["why are we here", 0.85], ["guide me", 0.75], ["need advice", 0.7],
      ["don't know what to do", 0.8], ["do not know what to do", 0.8],
      ["what should i", 0.75], ["help me", 0.65]
    ]
  },
  neutral: {
    phrases: [
      // Weakest — catch-all. Real phrases that don't fit elsewhere.
      ["tell me about", 0.6], ["explain", 0.5], ["what does the gita say", 0.7],
      ["bhagavad gita says", 0.65]
    ]
  }
};

// ---------------------------------------------------------------------------
// LAYER 3 — Situation Taxonomy
// Canonical names MUST match life_situations values in verses.json:
//   "conflict with loved ones", "decision making under pressure",
//   "inner conflict", "moral dilemma", "grief from loss",
//   "emotional breakdown", "duty vs personal desire",
//   "fear of consequences", "loss of motivation", "search for meaning",
//   "existential crisis", "professional duty", "career crossroads",
//   "lack of clarity", "work-life balance", "seeking inner peace",
//   "overcoming fear", "spiritual seeking", "social responsibility",
//   "overcoming ego", "anger issues", "struggling with temptation",
//   "anxiety about future"
// ---------------------------------------------------------------------------

const SITUATION_TAXONOMY = [
  {
    canonical: "grief from loss",
    phrases: [
      "lost someone", "someone died", "passed away", "death of", "funeral",
      "bereavement", "mourning", "can't move on from", "lost my", "lost a",
      "miss them so much", "someone i love", "loved one"
    ]
  },
  {
    canonical: "conflict with loved ones",
    phrases: [
      "fight with", "argument with", "conflict with", "ex", "breakup", "broke up",
      "divorce", "separated", "relationship", "my partner", "my spouse", "marriage",
      "family conflict", "family fight", "brother", "sister", "parent", "father",
      "mother", "children", "friend betrayed", "trust broken", "loved one"
    ]
  },
  {
    canonical: "career crossroads",
    phrases: [
      "career", "job", "work", "fired", "laid off", "quit", "profession",
      "office", "promotion", "workplace", "boss", "business", "startup",
      "job offer", "career change", "resign", "resignation"
    ]
  },
  {
    canonical: "decision making under pressure",
    phrases: [
      "can't decide", "cannot decide", "don't know what to do", "confused about",
      "stuck between", "choice", "options", "weighing", "decision", "decide",
      "unsure which", "crossroads", "fork in the road"
    ]
  },
  {
    canonical: "anxiety about future",
    phrases: [
      "future", "what will happen", "worried about", "scared about tomorrow",
      "upcoming", "don't know what lies ahead", "uncertainty", "uncertain about",
      "what if", "afraid of what", "dreading"
    ]
  },
  {
    canonical: "existential crisis",
    phrases: [
      "meaning of life", "purpose of life", "why am i here", "why are we here",
      "no meaning", "existence", "what's the point", "pointless", "meaningless",
      "sense of purpose", "reason to live", "lost my purpose"
    ]
  },
  {
    canonical: "inner conflict",
    phrases: [
      "inner conflict", "part of me wants", "torn between", "conflicted",
      "at war with myself", "can't make peace with", "self-doubt",
      "imposter", "don't know who i am", "identity", "sense of self"
    ]
  },
  {
    canonical: "moral dilemma",
    phrases: [
      "right thing to do", "moral", "ethical", "is it wrong", "should i",
      "right or wrong", "dilemma", "dharma", "duty", "against my values",
      "violating principles", "compromise my integrity"
    ]
  },
  {
    canonical: "emotional breakdown",
    phrases: [
      "breaking down", "can't cope", "cannot cope", "falling apart",
      "losing it", "lost control", "can't handle", "overwhelmed",
      "at my breaking point", "breaking point", "mentally exhausted"
    ]
  },
  {
    canonical: "duty vs personal desire",
    phrases: [
      "have to vs want to", "obligations", "responsibility vs freedom",
      "what i want vs what i should", "duty", "obligated", "expected of me",
      "sacrificing for others", "giving up my dreams"
    ]
  },
  {
    canonical: "fear of consequences",
    phrases: [
      "afraid of consequences", "scared of what happens if", "what if i fail",
      "fear of failure", "fear of rejection", "scared to try", "afraid to act",
      "don't want to face", "avoiding"
    ]
  },
  {
    canonical: "loss of motivation",
    phrases: [
      "no motivation", "lost motivation", "don't feel like", "can't bring myself",
      "procrastinating", "procrastination", "lazy", "no energy", "unmotivated",
      "don't care anymore", "indifferent", "not interested"
    ]
  },
  {
    canonical: "search for meaning",
    phrases: [
      "searching for meaning", "looking for purpose", "what is truth",
      "seeking wisdom", "what matters", "bigger picture", "spiritual path",
      "life's meaning", "direction in life"
    ]
  },
  {
    canonical: "professional duty",
    phrases: [
      "professional responsibility", "work ethics", "workplace duty",
      "job responsibility", "managing a team", "leadership pressure", "management"
    ]
  },
  {
    canonical: "work-life balance",
    phrases: [
      "work life balance", "overworked", "no time for family", "burnout",
      "long hours", "no personal time", "all i do is work", "neglecting"
    ]
  },
  {
    canonical: "seeking inner peace",
    phrases: [
      "need peace", "want peace", "find peace", "inner peace", "calm my mind",
      "quiet the mind", "mental peace", "peace of mind", "tranquility"
    ]
  },
  {
    canonical: "overcoming fear",
    phrases: [
      "overcome fear", "face my fear", "scared to face", "conquer fear",
      "afraid to move forward", "fear is stopping me", "held back by fear"
    ]
  },
  {
    canonical: "spiritual seeking",
    phrases: [
      "spiritual", "god", "divine", "krishna", "enlightenment", "meditation",
      "higher self", "connect with the divine", "moksha", "liberation", "soul",
      "atma", "consciousness", "awakening"
    ]
  },
  {
    canonical: "social responsibility",
    phrases: [
      "society", "community", "social duty", "helping others", "serve society",
      "responsibility to others", "social obligation", "contribution"
    ]
  },
  {
    canonical: "overcoming ego",
    phrases: [
      "ego", "arrogance", "pride", "humble", "humility", "self-centered",
      "letting go of ego", "too proud", "superiority complex"
    ]
  },
  {
    canonical: "anger issues",
    phrases: [
      "anger problem", "lose my temper", "can't control anger", "anger issues",
      "explosive", "lash out", "outbursts", "snap at people"
    ]
  },
  {
    canonical: "struggling with temptation",
    phrases: [
      "temptation", "tempted", "desire", "craving", "addiction", "bad habit",
      "can't resist", "compulsion", "give in", "weakness"
    ]
  },
  {
    canonical: "lack of clarity",
    phrases: [
      "no clarity", "lack of clarity", "confused", "fog", "haze", "clouded",
      "can't think straight", "unclear", "indecisive", "lost direction"
    ]
  }
];

// ---------------------------------------------------------------------------
// LAYER 1 helpers — Syntactic signal detection
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  "i", "me", "my", "myself", "we", "our", "you", "your", "he", "she",
  "it", "they", "them", "their", "is", "am", "are", "was", "were", "be",
  "been", "being", "have", "has", "had", "do", "does", "did", "will",
  "would", "could", "should", "may", "might", "must", "can", "the", "a",
  "an", "and", "but", "or", "so", "if", "in", "on", "at", "to", "for",
  "of", "with", "from", "by", "about", "as", "into", "through", "during",
  "that", "this", "these", "those", "how", "what", "why", "when", "where",
  "who", "which", "very", "just", "too", "also", "both", "all", "any",
  "not", "no", "nor", "yet", "still", "than", "then", "more", "most",
  "much", "many", "some", "such", "even", "ever", "never", "only", "own"
]);

// Emotional-frame trigger phrases (first-person problem framing)
const EMOTIONAL_FRAME_PATTERNS = [
  /\bi\s+(feel|am\s+feeling|felt)\b/i,
  /\bi\s+(am|'m)\s+(so|very|really|quite)?\s*(sad|angry|scared|hurt|lost|broken|confused|lonely)/i,
  /\bi\s+can'?t\s+(stop|sleep|think|breathe|cope|handle|get\s+over)/i,
  /\bi\s+keep\s+(thinking|crying|worrying|feeling|procrastinat)/i,
  /\bi\s+(am|was)\s+consumed\s+by/i,
  /\bi\s+(don'?t|cannot)\s+know\s+how\s+to\s+(cope|deal|handle|move\s+on|stop)/i,
  /\bi\s+lost\s+(my|a|someone|everything)/i,
  /\bsomeone\s+i\s+love/i
];

// Philosophical-frame trigger phrases
const PHILOSOPHICAL_FRAME_PATTERNS = [
  /\bwhat\s+is\s+(the\s+)?(meaning|purpose|truth|reality|dharma|karma)\b/i,
  /\bwhy\s+(do\s+we|does|am\s+i|are\s+we)\b/i,
  /\bwhat\s+does\s+the\s+(gita|bhagavad|scripture)\b/i,
  /\bhow\s+does\s+(karma|dharma|yoga|the\s+gita)\b/i,
  /\bexplain\s+(to\s+me)?\s*(karma|dharma|moksha|atma|soul|consciousness|yoga)\b/i,
  /\bwhat\s+is\s+the\s+(path|way|truth)\s+(to|of)\b/i
];

// Action-frame trigger phrases
const ACTION_FRAME_PATTERNS = [
  /\bhow\s+(do\s+i|can\s+i|should\s+i)\b/i,
  /\bwhat\s+should\s+i\s+do\b/i,
  /\bhelp\s+(me\s+)?(decide|choose|figure\s+out|understand\s+what\s+to\s+do)/i,
  /\bi\s+need\s+(advice|guidance|help)\b/i,
  /\bwhat\s+steps\s+(can|should)\s+i\b/i,
  /\bshould\s+i\s+(quit|leave|stay|try|go)\b/i,
  /\bhow\s+to\s+(overcome|deal\s+with|handle|manage|face)\b/i
];

// ---------------------------------------------------------------------------
// FAISS field-level bias presets (Layer 5)
// These map 1:1 to the weight keys in retrieval.js normalizeWeights()
// ---------------------------------------------------------------------------

const SEARCH_BIAS_PRESETS = {
  emotional_support: {
    // Lead with emotion tags + life situations; vector is secondary
    vectorWeight: 0.25,
    emotionWeight: 0.45,
    lifeSituationWeight: 0.25,
    keywordsWeight: 0.05
  },
  philosophical_seeking: {
    // Vector similarity + keywords dominate; emotion metadata is weak signal
    vectorWeight: 0.55,
    emotionWeight: 0.10,
    lifeSituationWeight: 0.10,
    keywordsWeight: 0.25
  },
  action_guidance: {
    // Balanced: vector + life situations + keywords; emotion secondary
    vectorWeight: 0.35,
    emotionWeight: 0.20,
    lifeSituationWeight: 0.30,
    keywordsWeight: 0.15
  }
};

// ---------------------------------------------------------------------------
// LAYER 0 — Query Mode Detection
// Determines whether this is an emotional query, an informational/philosophical
// query, or an action-guidance query. Runs before emotion scoring.
// ---------------------------------------------------------------------------

const INFORMATIONAL_PATTERNS = [
  /\bwhat (is|are|does|did|was)\b/i,
  /\bwho (is|was|are)\b/i,
  /\bexplain\b/i,
  /\bdefine\b/i,
  /\btell me (about|what|how|why)\b/i,
  /\bhow does\b/i,
  /\bwhat does the (gita|bhagavad|scripture|vedas?)\b/i,
  /\bhow (many|much)\b/i,
  /\bwhat is (karma|dharma|moksha|atma|yoga|vedanta|ahimsa|samsara|brahman)\b/i,
  /\bwho is (krishna|arjuna|vyasa|duryodhana|bhisma)\b/i,
  /\bwhat chapter\b/i,
  /\bwhich verse\b/i,
  /\bsummary of\b/i,
  /\bdifference between\b/i
];

/**
 * Layer 0: Detect the broad query mode.
 * "emotional"      → user is suffering / seeking support
 * "informational"  → user is curious / studying
 * "action"         → user needs a decision / next step
 */
function detectQueryMode(query, emotionScores, frameSignal) {
  // Strong emotional frame → definitely emotional
  if (frameSignal === "emotional_support") return "emotional";
  // High-confidence emotion score → emotional
  if (emotionScores.length > 0 && emotionScores[0].score >= 0.7) return "emotional";
  // Explicit action framing → action
  if (frameSignal === "action_guidance") return "action";
  // Informational patterns → informational
  if (INFORMATIONAL_PATTERNS.some(re => re.test(query))) return "informational";
  // Philosophical seeking without emotional signal → informational
  if (frameSignal === "philosophical_seeking") return "informational";
  // Very weak emotion → informational
  if (emotionScores.length === 0 || (emotionScores[0] && emotionScores[0].score < 0.45)) {
    return "informational";
  }
  return "emotional";
}

// Negation tokens — if found in a 35-char window before a phrase match,
// the match weight is reduced by 90%.
const NEGATION_TOKENS = [
  "not ", "never ", "no longer", "don't feel", "do not feel",
  "doesn't feel", "didn't feel", "stopped being", "stopped feeling",
  "no more", "without feeling", "free from", "overcome", "past the",
  "used to feel", "used to be"
];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Tokenize and clean a query into meaningful terms.
 * Returns lowercase tokens with stopwords removed (length > 2).
 */
function tokenize(query) {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .map(t => t.replace(/^'+|'+$/g, ""))           // strip surrounding apostrophes
    .filter(t => t.length > 2 && !STOPWORDS.has(t));
}

/**
 * Match query text against a flat phrases list.
 * Returns the highest-weighted match weight, or 0 if none.
 * Respects negation: if a negation token precedes the phrase, weight is near-zero.
 */
function matchPhrases(queryLower, phraseList) {
  let best = 0;
  for (const [phrase, weight] of phraseList) {
    const idx = queryLower.indexOf(phrase);
    if (idx !== -1) {
      // Check for negation in the 35-char window immediately before the match
      const windowStart = Math.max(0, idx - 35);
      const preWindow = queryLower.slice(windowStart, idx);
      const isNegated = NEGATION_TOKENS.some(neg => preWindow.includes(neg));
      const effectiveWeight = isNegated ? weight * 0.08 : weight;
      if (effectiveWeight > best) best = effectiveWeight;
    }
  }
  return best;
}

/**
 * Layer 2: Score every emotion against the query.
 * Returns array of { emotion, score } sorted descending.
 */
function scoreEmotions(queryLower) {
  const scores = [];
  for (const [emotion, { phrases }] of Object.entries(EMOTION_TAXONOMY)) {
    const score = matchPhrases(queryLower, phrases);
    if (score > 0) {
      scores.push({ emotion, score });
    }
  }
  return scores.sort((a, b) => b.score - a.score);
}

/**
 * Layer 3: Score every situation cluster against the query.
 * Returns the best matching canonical situation label, or null.
 */
function scoreSituations(queryLower) {
  let bestCanonical = null;
  let bestCount = 0;

  for (const { canonical, phrases } of SITUATION_TAXONOMY) {
    let count = 0;
    for (const phrase of phrases) {
      if (queryLower.includes(phrase)) {
        count += 1;
      }
    }
    if (count > bestCount) {
      bestCount = count;
      bestCanonical = canonical;
    }
  }

  return bestCanonical; // null means no match → handled by caller
}

/**
 * Layer 1: Detect frame via pattern matching.
 * Returns "emotional_support" | "philosophical_seeking" | "action_guidance" | null
 */
function detectFrame(query) {
  if (EMOTIONAL_FRAME_PATTERNS.some(re => re.test(query))) return "emotional_support";
  if (PHILOSOPHICAL_FRAME_PATTERNS.some(re => re.test(query))) return "philosophical_seeking";
  if (ACTION_FRAME_PATTERNS.some(re => re.test(query))) return "action_guidance";
  return null;
}

/**
 * Layer 4: Synthesize a natural-language core_struggle.
 */
function synthesizeCoreStruggle(emotion, situation, intentType) {
  // Emotion-specific descriptors
  const emotionDescriptors = {
    anxiety: "overwhelming anxiety",
    fear: "deep-seated fear",
    grief: "profound grief",
    depression: "persistent feelings of hopelessness",
    anger: "uncontrollable anger",
    envy: "feelings of envy and comparison",
    greed: "unyielding craving and desire",
    pride: "excessive pride and arrogance",
    compassion: "empathy for others' pain",
    peace: "a longing for inner peace",
    hope: "cautious hope for better outcomes",
    clarity: "a search for clarity and understanding",
    understanding: "confusion and a need for understanding",
    realization: "a moment of profound realization",
    seeking: "restless seeking of meaning and direction",
    neutral: "an inquiry into the teachings"
  };

  // Situation-specific context phrases
  const situationContext = {
    "grief from loss": "following the loss of a loved one",
    "conflict with loved ones": "in a significant personal relationship",
    "career crossroads": "regarding career and professional direction",
    "decision making under pressure": "when forced to make a difficult choice under pressure",
    "anxiety about future": "about what the future holds",
    "existential crisis": "about the meaning and purpose of existence",
    "inner conflict": "arising from internal contradictions",
    "moral dilemma": "when navigating competing moral obligations",
    "emotional breakdown": "that is pushing past emotional limits",
    "duty vs personal desire": "between personal desires and external obligations",
    "fear of consequences": "about the consequences of actions",
    "loss of motivation": "and a complete loss of direction or drive",
    "search for meaning": "while searching for purpose and meaning",
    "professional duty": "within professional responsibilities",
    "work-life balance": "due to imbalance between work and personal life",
    "seeking inner peace": "while seeking lasting inner peace",
    "overcoming fear": "that is preventing forward movement",
    "spiritual seeking": "on the spiritual path",
    "social responsibility": "toward society and others",
    "overcoming ego": "rooted in ego and pride",
    "anger issues": "manifesting as difficulty controlling anger",
    "struggling with temptation": "in resisting destructive desires",
    "lack of clarity": "due to confusion and lack of direction"
  };

  const emotionStr = emotionDescriptors[emotion] || `feelings of ${emotion}`;
  const situationStr = situationContext[situation] || `in the context of "${situation}"`;

  if (intentType === "philosophical_seeking") {
    return `a philosophical inquiry into ${situation || "life's deeper meaning"}`;
  }

  if (intentType === "action_guidance") {
    return `seeking concrete guidance to address ${emotionStr} ${situationStr}`;
  }

  // emotional_support default
  return `${emotionStr} ${situationStr}`;
}

// ---------------------------------------------------------------------------
// PUBLIC API
// ---------------------------------------------------------------------------

/**
 * Analyze a user query and return a rich intent understanding object.
 *
 * This is the main export to be called from pipeline.js.
 *
 * @param {string} query - Raw user query string
 * @returns {IntentResult} - Full intent understanding object
 */
export function analyzeIntent(query) {
  const raw = String(query || "").trim();
  const queryLower = raw.toLowerCase();
  const queryKeywords = tokenize(raw);
  const wordCount = raw.split(/\s+/).filter(Boolean).length;

  // --- Layer 1: Frame detection (fast, regex-based) ---
  const frameSignal = detectFrame(raw);

  // --- Layer 2: Emotion scoring ---
  const emotionScores = scoreEmotions(queryLower);
  const topEmotion = emotionScores[0];
  const runnerUp = emotionScores[1];

  let emotion = "seeking"; // safe default
  let emotionConfidence = 0.3; // minimum confidence we always emit

  if (topEmotion) {
    emotion = topEmotion.emotion;
    emotionConfidence = Math.min(topEmotion.score, 1.0);
  }

  // If score is below threshold but frame is emotional, boost confidence slightly
  if (frameSignal === "emotional_support" && emotionConfidence < 0.6) {
    emotionConfidence = Math.min(emotionConfidence + 0.15, 1.0);
  }

  // Layer 1.5 — Query length confidence scaling
  // Very short queries are likely informational; long emotional writing boosts confidence
  if (wordCount < 6) {
    emotionConfidence = Math.max(emotionConfidence * 0.65, 0.2);
  } else if (wordCount > 40) {
    emotionConfidence = Math.min(emotionConfidence * 1.2, 1.0);
  }

  // --- Layer 0: Query mode (must run after emotion scores are known) ---
  const queryMode = detectQueryMode(raw, emotionScores, frameSignal);

  // --- Layer 3: Situation scoring ---
  const situationMatch = scoreSituations(queryLower);
  let situation = situationMatch || "search for meaning"; // meaningful default

  // --- Layer 4: Intent frame (combine Layer 1 signal with emotion evidence) ---
  let intentType;

  if (frameSignal) {
    // Explicit pattern match wins
    intentType = frameSignal;
  } else if (topEmotion && topEmotion.score >= 0.7) {
    // Strong emotion evidence → emotional support
    intentType = "emotional_support";
  } else if (emotionScores.length === 0 || (topEmotion && topEmotion.emotion === "seeking")) {
    // No emotional signal → philosophical
    intentType = "philosophical_seeking";
  } else {
    // Weak-emotion fallback
    intentType = "philosophical_seeking";
  }

  // --- Layer 4: Core struggle synthesis ---
  const coreStruggle = synthesizeCoreStruggle(emotion, situation, intentType);

  // --- Layer 5: FAISS field-level bias ---
  const searchBias = { ...SEARCH_BIAS_PRESETS[intentType] };

  // Dynamic refinement: if emotion confidence is high, push emotion weight further
  if (emotionConfidence > 0.85 && intentType === "emotional_support") {
    const boost = 0.05;
    searchBias.emotionWeight = Math.min(searchBias.emotionWeight + boost, 0.6);
    searchBias.vectorWeight = Math.max(searchBias.vectorWeight - boost, 0.15);
  }

  // Always normalize unconditionally after all boosts
  const _sum = searchBias.vectorWeight + searchBias.emotionWeight +
               searchBias.lifeSituationWeight + searchBias.keywordsWeight;
  const _factor = 1.0 / _sum;
  searchBias.vectorWeight        = Math.round(searchBias.vectorWeight        * _factor * 1000) / 1000;
  searchBias.emotionWeight       = Math.round(searchBias.emotionWeight       * _factor * 1000) / 1000;
  searchBias.lifeSituationWeight = Math.round(searchBias.lifeSituationWeight * _factor * 1000) / 1000;
  searchBias.keywordsWeight = Math.round(
    (1.0 - searchBias.vectorWeight - searchBias.emotionWeight - searchBias.lifeSituationWeight) * 1000
  ) / 1000;

  console.log("[intentAnalyzer]", JSON.stringify({
    query_mode: queryMode,
    emotion,
    emotion_confidence: Math.round(emotionConfidence * 100) / 100,
    emotion_runner_up: runnerUp?.emotion || null,
    situation,
    intent_type: intentType,
    word_count: wordCount
  }));

  return {
    query_mode: queryMode,
    emotion,
    emotion_confidence: Math.round(emotionConfidence * 100) / 100,
    emotion_runner_up: runnerUp ? runnerUp.emotion : null,
    situation,
    core_struggle: coreStruggle,
    intent_type: intentType,
    search_bias: searchBias,
    query_keywords: queryKeywords
  };
}
