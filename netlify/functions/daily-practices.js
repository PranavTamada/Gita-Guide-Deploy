import { generateAllDailyPractices } from "../../runtime/practiceGenerator.js";
import { json } from "./_shared.js";

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return json(200, { ok: true });
  }

  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const practices = generateAllDailyPractices();
    return json(200, { success: true, count: practices.length, practices });
  } catch (err) {
    return json(500, { error: "Failed to generate daily practices." });
  }
}
