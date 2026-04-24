"""
main.py — FastAPI server for Bhagavad Gita semantic search.

Run with:
    uvicorn main:app --reload --port 8000
"""

import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from loader import load_verses
from embeddings import build_index
from search import search_verses, generate_insight


# ---------------------------------------------------------------------------
# Lifespan — load model + build index once at startup
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    print("\n🪷  Bhagavad Gita Python AI Backend")
    print("   Loading data and building index…\n")

    t0 = time.time()
    verses = load_verses()
    build_index(verses)
    elapsed = time.time() - t0

    print(f"\n✅  Ready in {elapsed:.1f}s — {len(verses)} verses indexed")
    print(f"   Endpoint: POST http://localhost:8000/search\n")

    yield  # app runs here

    print("\n🛑  Shutting down…")


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(
    title="Bhagavad Gita AI Search",
    description="Semantic verse retrieval powered by SentenceTransformers + FAISS",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class SearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=500, description="User query text")
    top_k: int = Field(3, ge=1, le=10, description="Number of results to return")


class VerseResult(BaseModel):
    chapter: int
    verse: int
    score: float
    translation: str
    summary: str
    core_idea: str
    insight: str


class SearchResponse(BaseModel):
    results: list[VerseResult]
    query: str
    elapsed_ms: float


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@app.post("/search", response_model=SearchResponse)
async def post_search(req: SearchRequest):
    """Semantic search over Bhagavad Gita verses."""
    t0 = time.time()

    try:
        raw_results = search_verses(req.query, top_k=req.top_k)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    results = []
    for r in raw_results:
        insight = generate_insight(r, req.query)
        results.append(VerseResult(**r, insight=insight))

    elapsed_ms = round((time.time() - t0) * 1000, 2)
    print(f"[search] query=\"{req.query}\" → {len(results)} results in {elapsed_ms}ms")

    return SearchResponse(results=results, query=req.query, elapsed_ms=elapsed_ms)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "gita-ai-python"}
