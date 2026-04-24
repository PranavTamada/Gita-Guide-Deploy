import fs from "fs";
import { getTopMatches } from "./retrieval.js";
import fetch from "node-fetch";

const API_KEY = process.env.ANTHROPIC_API_KEY;

const PROMPT = fs.readFileSync("prompts/agent4.txt", "utf-8");

async function callClaude(input) {
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
      messages: [
        {
          role: "user",
          content: `${PROMPT}

User Query:
${input.user_query}

Relevant Verses:
${JSON.stringify(input.verses, null, 2)}`
        }
      ]
    })
  });

  const data = await response.json();
  return data.content[0].text;
}

async function run(query) {
  const topVerses = getTopMatches(query);

  const input = {
    user_query: query,
    verses: topVerses
  };

  const result = await callClaude(input);

  fs.writeFileSync(
    "outputs/answers.json",
    JSON.stringify({ input, result }, null, 2)
  );

  console.log("✅ Done. Check outputs/answers.json");
}

// test
run("I feel anxious about my future and don’t know what to do");