import { runNetlifyPipeline } from "./_pipelineLite.js";
import { json } from "./_shared.js";

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return json(200, { ok: true });
  }

  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const { runNetlifyPipeline } = await import("./_pipelineLite.js");
    const body = JSON.parse(event.body || "{}");
    const query = body.query;

    if (!query || typeof query !== "string" || !query.trim()) {
      return json(400, { error: "A non-empty 'query' string is required." });
    }

    const result = await runNetlifyPipeline(query.trim());
    return json(200, result);
  } catch (err) {
    return json(500, { error: "Something went wrong processing your query. Please try again." });
  }
}
