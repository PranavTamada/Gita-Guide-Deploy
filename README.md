# Bhagavad Gita AI

An AI-assisted Bhagavad Gita guide with verse retrieval, intent analysis, and daily practices.

## Local Setup

1. Copy `.env.example` to `.env`.
2. Add your Gemini API key and adjust the model if needed.
3. Install dependencies.
4. Start the app.

```bash
npm install
npm run serve
```

The app serves the frontend from `frontend/` and exposes API routes such as `/ask`, `/daily-practices`, `/chapters`, and `/health`.

## Netlify Deployment Guide

This project is now set up for full Netlify hosting:

- `frontend/` is the static site.
- `netlify/functions/` contains the serverless API routes.
- The frontend automatically uses `/.netlify/functions` in production.
- The Netlify ask route uses a serverless-compatible retrieval path so it can run without the local FAISS server stack.

### Deploy Steps

1. Push the repository to GitHub.
2. In Netlify, create a new site from Git.
3. Connect this repository.
4. Set the build settings to use `netlify.toml` from the repo root.
5. Set the publish directory to `frontend`.
6. Set the functions directory to `netlify/functions` if Netlify does not pick it up from `netlify.toml`.
7. Add the environment variable `GEMINI_API_KEY` in the Netlify site settings.
8. Optionally set `GEMINI_MODEL` and `GEMINI_TIMEOUT_MS`.
9. Deploy the site.

### Endpoints On Netlify

- `/.netlify/functions/ask`
- `/.netlify/functions/daily-practices`
- `/.netlify/functions/chapters`
- `/.netlify/functions/chapter-verses?n=2`
- `/.netlify/functions/health`
- `/.netlify/functions/stats`

### What To Verify

- The homepage loads from Netlify.
- Asking a question returns a JSON response from the `ask` function.
- Daily practices load from the `daily-practices` function.
- Your Gemini API key is present in Netlify environment variables.

### Local Development

1. Keep using `npm run serve` for the Express backend locally.
2. Open the frontend and it will continue to call `http://localhost:3000` when running on `localhost`.
3. For a closer Netlify-style test, you can serve the static frontend and invoke the functions path manually after deployment.

## Environment Variables

Use these in your `.env` or on your deployment host:

- `GEMINI_API_KEY` — required for Gemini requests.
- `GEMINI_MODEL` — optional, defaults to `gemini-2.0-flash`.
- `GEMINI_TIMEOUT_MS` — optional timeout for Gemini requests.
- `TOP_K_RETRIEVAL` — how many verses to retrieve before reranking.
- `TOP_K_FINAL` — how many verses to return in the final answer.
- `PORT` — backend port for local development.

## Notes

- Do not commit real API keys to version control.
- For local development, the frontend uses `http://localhost:3000`.
- In production, the frontend automatically uses Netlify Functions.