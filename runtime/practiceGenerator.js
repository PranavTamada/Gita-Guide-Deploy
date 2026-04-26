/**
 * Practice Generator for Bhagavad Gita AI
 *
 * Builds actionable, time-bound practices from user context + verse principles.
 * Fully deterministic — no LLM call needed.
 *
 * INPUT:
 *   - query        (string)  user's original question
 *   - understanding (object) { emotion, situation, core_struggle }
 *   - verses       (array)   selected verses with .principle / .core_idea
 *
 * OUTPUT:
 *   { practice_title, duration, steps[], purpose }
 */

/* ── Emotion → practice strategy map ─────────────────────────── */

const EMOTION_STRATEGIES = {
  anxiety: {
    mode: "grounding",
    label: "Grounding & Action",
    defaultSteps: [
      "Sit still for 2 minutes. Feel your feet on the ground. Breathe in for 4 counts, hold for 4, out for 6.",
      "Write down the single thing causing the most anxiety right now — just one sentence.",
      "Identify one small action you can take about it in the next 10 minutes and do it immediately."
    ],
    purpose: "Anxiety lives in the future. This practice anchors you in the present and converts worry into one concrete action."
  },
  fear: {
    mode: "grounding",
    label: "Grounding & Action",
    defaultSteps: [
      "Close your eyes. Name 5 things you can hear right now. This pulls attention out of fearful thoughts.",
      "Write: \"The worst realistic outcome is ___. One thing I can do about it is ___.\"",
      "Do that one thing now — even partially. Action dissolves fear faster than thinking."
    ],
    purpose: "Fear magnifies in stillness. Naming it and acting on it shrinks it to its real size."
  },
  confusion: {
    mode: "clarity",
    label: "Clarity & Decision",
    defaultSteps: [
      "Write the decision or question you're confused about in one clear sentence.",
      "List only 2 options — not more. For each, write one consequence you can live with and one you can't.",
      "Pick the option whose worst consequence you can handle. Commit to it for 24 hours only — not forever."
    ],
    purpose: "Confusion often comes from too many options. Narrowing to two and committing short-term breaks the loop."
  },
  grief: {
    mode: "reflection",
    label: "Gentle Reflection",
    defaultSteps: [
      "Sit quietly for 3 minutes. Let the feeling be there — don't push it away or hold onto it.",
      "Write one thing you're grateful for about what you've lost. Let yourself feel both the loss and the gratitude.",
      "Do one kind thing for yourself in the next hour — a walk, a meal you enjoy, or a call to someone who cares."
    ],
    purpose: "Grief needs space, not solutions. This practice honours the feeling while gently reconnecting you to the present."
  },
  anger: {
    mode: "pause",
    label: "Pause & Control",
    defaultSteps: [
      "Before doing anything, take 10 slow breaths. Count each one. This is not optional — anger makes us skip this.",
      "Write what triggered the anger in one sentence. Then write: \"What I actually need here is ___.\"",
      "Choose one response that serves your need without harming the situation. Wait 1 hour before executing it."
    ],
    purpose: "Anger is energy. This practice prevents it from becoming destruction and redirects it toward what you actually need."
  },
  depression: {
    mode: "reflection",
    label: "Small Momentum",
    defaultSteps: [
      "Stand up and move to a different spot — a window, a doorway, anywhere. Change of position changes energy.",
      "Write the smallest thing you accomplished today, even if it's 'I got out of bed.' Acknowledge it fully.",
      "Pick one task that takes under 5 minutes and complete it. Momentum starts smaller than you think."
    ],
    purpose: "Depression tells you nothing matters. Completing one tiny task proves it wrong, and that proof compounds."
  },
  seeking: {
    mode: "clarity",
    label: "Focused Inquiry",
    defaultSteps: [
      "Write: \"What I'm really looking for is ___.\" Don't overthink — first instinct.",
      "Read one verse translation slowly. Ask: does this point toward action, patience, or surrender?",
      "Based on that answer, do one thing in the next 10 minutes that moves you in that direction."
    ],
    purpose: "Seeking becomes fruitful when you stop searching broadly and take one directed step."
  },
  neutral: {
    mode: "study",
    label: "Steady Action",
    defaultSteps: [
      "Read the translated verse without trying to extract immediate answers. Just observe the principle.",
      "Ask yourself: 'How does this ancient teaching apply to my current context?'",
      "Take one calm, small step forward in whatever task or duty you are currently engaged in."
    ],
    purpose: "When the mind is neutral and calm, it is primed for deep absorption rather than reactive fixing."
  }
};

/* ── Principle → specific practice actions ────────────────────── */

const PRINCIPLE_ACTIONS = {
  detachment: {
    step: "Pick one task you've been doing while worrying about the outcome. Do it again now — but focus only on doing it well, not on what happens after.",
    tag: "act without attachment to results"
  },
  duty: {
    step: "Identify your most important responsibility today. Do it first, before anything optional. Don't wait for motivation — duty comes before feeling.",
    tag: "fulfil your duty regardless of comfort"
  },
  "self-knowledge": {
    step: "Pause for 3 minutes. Ask yourself: 'Am I reacting from habit or from understanding?' Write your honest answer.",
    tag: "know yourself before acting"
  },
  devotion: {
    step: "Choose one action today and dedicate it to something larger than yourself — a person you love, a principle you believe in. Do it with full attention.",
    tag: "act with devotion and purpose"
  },
  surrender: {
    step: "Write down one thing you've been trying to control that isn't in your hands. Say out loud: 'I release this.' Then redirect energy to what IS in your control.",
    tag: "release what you cannot control"
  },
  discipline: {
    step: "Set a timer for 10 minutes. Do one task with zero distractions — no phone, no switching. Pure focus. Notice how it feels when you finish.",
    tag: "master yourself through focused action"
  },
  knowledge: {
    step: "Read one verse translation slowly, twice. Write one insight in your own words. Understanding grows only when you put it in your own language.",
    tag: "turn knowledge into personal understanding"
  },
  faith: {
    step: "Recall one time when something worked out despite your doubts. Write it down. Let that memory be evidence that uncertainty isn't the same as failure.",
    tag: "trust the process even in uncertainty"
  },
  equanimity: {
    step: "Think of today's biggest frustration and today's best moment. Hold both in mind. Practice seeing them as equal — both temporary, both teachers.",
    tag: "remain steady in success and failure"
  }
};

/* ── Fallback for unknown emotions / principles ──────────────── */

const FALLBACK_STRATEGY = {
  mode: "reflection",
  label: "Mindful Action",
  defaultSteps: [
    "Sit quietly for 2 minutes. Observe your thoughts without following any of them.",
    "Write down the one thing that matters most to you right now — not what's urgent, but what's important.",
    "Take one clear, small action toward that important thing before the day ends."
  ],
  purpose: "When the path isn't clear, one honest action is worth more than endless deliberation."
};

const FALLBACK_PRINCIPLE_ACTION = {
  step: "Pick one verse principle and apply it to one specific situation today. Don't try to change everything — just one moment, one action.",
  tag: "apply one principle to one moment"
};

/* ══════════════════════════════════════════════════════════════
 *  MAIN GENERATOR
 * ══════════════════════════════════════════════════════════════ */

/**
 * Generate a structured, actionable practice.
 *
 * @param {object} input
 * @param {string} input.emotion         – user's core emotion
 * @param {string} input.situation       – user's life situation
 * @param {Array}  input.principles      – list of guiding principles from verses
 * @param {string} input.core_idea       – main core idea from verses
 * @param {string} [input.core_struggle] – synthesized core struggle from intentAnalyzer
 * @returns {object} { title, duration, steps, purpose }
 */
export function generatePractice({ emotion, situation, core_struggle, principles, core_idea }) {
  const normEmotion = normalizeEmotion(emotion);
  const strategy = EMOTION_STRATEGIES[normEmotion] || FALLBACK_STRATEGY;
  const safePrinciples = Array.isArray(principles) ? principles : [];
  const safeCoreIdeas = typeof core_idea === "string" && core_idea.trim() ? [core_idea.trim()] : [];

  const understanding = { situation, core_struggle };

  // ── Step 1: Build title ─────────────────────────────────────
  const title = buildTitle(strategy, safePrinciples, understanding);

  // ── Step 2: Assemble steps ──────────────────────────────────
  const steps = buildSteps(strategy, safePrinciples, safeCoreIdeas, understanding);

  // ── Step 3: Build purpose ───────────────────────────────────
  const purpose = buildPurpose(strategy, safePrinciples, understanding);

  return {
    title,          // named 'title' to match frontend p.title
    duration: "5-10 minutes",
    steps,
    purpose
  };
}

/* ── Internal helpers ────────────────────────────────────────── */

function normalizeEmotion(raw) {
  if (!raw || typeof raw !== "string") return "seeking";
  const e = raw.toLowerCase().trim();

  // Map common aliases AND intentAnalyzer canonical names that differ from
  // EMOTION_STRATEGIES keys (e.g. "understanding" → "confusion" strategy)
  const aliases = {
    // user-facing variants
    anxious: "anxiety", stressed: "anxiety", worried: "anxiety", nervous: "anxiety",
    afraid: "fear", scared: "fear", terrified: "fear",
    confused: "confusion", lost: "confusion", uncertain: "confusion", indecisive: "confusion",
    sad: "grief", grieving: "grief", mourning: "grief", heartbroken: "grief",
    angry: "anger", frustrated: "anger", furious: "anger", irritated: "anger",
    depressed: "depression", hopeless: "depression", numb: "depression", empty: "depression",
    curious: "seeking", searching: "seeking", questioning: "seeking",
    understanding: "confusion",   // "understanding" → confusion strategy
    clarity:       "seeking",      // clarity-seeker → focused inquiry
    realization:   "seeking",      // sudden realization → focused inquiry
    hope:          "seeking",      // hopeful → focused inquiry (closest fit)
    peace:         "seeking",      // seeking peace → focused inquiry
    envy:          "anger",        // envy is anger-adjacent
    greed:         "depression",   // greed/craving → small-momentum reset
    pride:         "anger",        // pride/arrogance → pause & control
    compassion:    "seeking"       // compassion → focused outward inquiry
  };

  return aliases[e] || (EMOTION_STRATEGIES[e] ? e : "seeking");
}

function buildTitle(strategy, principles, understanding) {
  const principleTag = principles.length > 0
    ? ` — ${capitalize(principles[0])}`
    : "";

  const situationHint = understanding?.situation
    ? ` for ${understanding.situation}`
    : "";

  return `${strategy.label}${principleTag}${situationHint}`;
}

function buildSteps(strategy, principles, coreIdeas, understanding) {
  const steps = [];
  const situation = understanding?.situation || "";

  // Step 1: pick among the strategy's defaultSteps based on situation so it
  // varies across different life contexts, not always the same opening.
  const stepIndex = situation
    ? Math.abs([...situation].reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0)) %
      strategy.defaultSteps.length
    : 0;
  steps.push(strategy.defaultSteps[stepIndex]);

  // Step 2: principle-driven step (if we have a matching principle)
  const principleStep = findBestPrincipleStep(principles);
  if (principleStep) {
    steps.push(principleStep.step);
  } else {
    // Fall back to a different defaultStep than step 1
    const fallbackIdx = (stepIndex + 1) % strategy.defaultSteps.length;
    steps.push(strategy.defaultSteps[fallbackIdx] || FALLBACK_PRINCIPLE_ACTION.step);
  }

  // Step 3: core_idea integration — make it concrete
  if (coreIdeas.length > 0) {
    // Trim core_idea to ~100 chars so the step stays readable
    const idea = coreIdeas[0].length > 100
      ? coreIdeas[0].slice(0, 97) + "…"
      : coreIdeas[0];
    steps.push(
      `Reflect on this Gita teaching: "${idea}" — write one way to apply it to your situation today.`
    );
  } else {
    const altIdx = (stepIndex + 2) % strategy.defaultSteps.length;
    steps.push(strategy.defaultSteps[altIdx] || "Take one clear, small action right now.");
  }

  // Step 4: (optional) if multiple principles, add a second principle step
  if (principles.length >= 2) {
    const secondary = findPrincipleAction(principles[1]);
    if (secondary && secondary.step !== principleStep?.step) {
      steps.push(secondary.step);
    }
  }

  // Step 5: Situational real-world action (not always the same generic sentence)
  const situationActions = {
    "grief from loss":              "Do one kind thing for yourself today — a walk, a call to someone you trust, or simply resting without guilt.",
    "conflict with loved ones":     "Write a message you don't have to send yet — just to clarify what you truly need from the relationship.",
    "career crossroads":            "List your top 3 non-negotiables for your next step. Pick the option that honours the most of them.",
    "decision making under pressure": "Write down both options and their single worst outcome. Pick the one whose worst case you can live with.",
    "anxiety about future":         "Identify one thing within your control right now and do it before the end of the day.",
    "existential crisis":           "Write one sentence about what you value most. Let that sentence guide your next decision.",
    "inner conflict":               "Sit quietly and ask: 'Which part of me is speaking from fear, and which from truth?' Write the answer.",
    "moral dilemma":                "Ask: 'Which choice will I be proud of in 5 years?' Write it down and act on it.",
    "emotional breakdown":          "Rest for 10 minutes without guilt — then identify one very small task and complete only that.",
    "duty vs personal desire":      "Name your deepest obligation and your deepest desire. Find one action that honours both, even partially.",
    "loss of motivation":           "Set a 5-minute timer and start the task you've been avoiding. Momentum follows action, not feeling.",
    "search for meaning":           "Write one thing that felt meaningful today, however small. Build from that.",
    "seeking inner peace":          "Schedule 10 minutes of uninterrupted stillness today. Guard it as a non-negotiable appointment.",
    "overcoming fear":              "Name the fear in one sentence. Then take one action toward the feared thing — even a tiny one.",
    "spiritual seeking":            "Read one verse slowly. Sit with one word from it. Let that word guide one action today.",
    "anger issues":                 "Before your next difficult interaction, pause for 3 full breaths. Notice the gap between trigger and response."
  };
  steps.push(
    situationActions[situation] ||
    "Take one small real-world action today based on this reflection (e.g., write it down, make a decision, or reach out to someone)."
  );

  return steps;
}

function findBestPrincipleStep(principles) {
  for (const p of principles) {
    const action = findPrincipleAction(p);
    if (action) return action;
  }
  return null;
}

function findPrincipleAction(principle) {
  if (!principle) return null;
  const key = principle.toLowerCase().trim();

  // Exact match
  if (PRINCIPLE_ACTIONS[key]) return PRINCIPLE_ACTIONS[key];

  // Partial match (e.g. "self-knowledge" matches "self-knowledge")
  for (const [k, v] of Object.entries(PRINCIPLE_ACTIONS)) {
    if (key.includes(k) || k.includes(key)) return v;
  }

  return null;
}

function buildPurpose(strategy, principles, understanding) {
  const parts = [strategy.purpose];

  if (principles.length > 0) {
    const tags = principles
      .slice(0, 2)
      .map(p => {
        const action = findPrincipleAction(p);
        return action ? action.tag : p;
      });
    const uniqueTags = [...new Set(tags)];
    parts.push(`The Gita's guidance here: ${uniqueTags.join("; ")}.`);
  }

  if (understanding?.core_struggle) {
    parts.push(`This directly addresses your core struggle: ${understanding.core_struggle}.`);
  }

  return parts.join(" ");
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/* ── Default export ──────────────────────────────────────────── */

export default { generatePractice };
