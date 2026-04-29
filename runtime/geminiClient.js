export async function callGemini(prompt, {
  apiKey,
  model = "gemini-2.0-flash",
  timeoutMs = 120000,
  systemInstruction = ""
} = {}) {
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is required");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const body = {
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        temperature: 0.2,
        topP: 0.95,
        maxOutputTokens: 1024,
        responseMimeType: "application/json"
      }
    };

    if (systemInstruction) {
      body.systemInstruction = {
        parts: [{ text: systemInstruction }]
      };
    }

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        signal: controller.signal
      }
    );

    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`Gemini HTTP ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map(part => part?.text || "").join("").trim();

    if (!text) {
      throw new Error("Empty Gemini response");
    }

    return text;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}