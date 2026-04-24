"""
embeddings.py — Build and manage FAISS index from verse embeddings.
"""
from __future__ import annotations

import numpy as np
import faiss
from sentence_transformers import SentenceTransformer

MODEL_NAME = "all-MiniLM-L6-v2"

# Loaded once at module level
_model: SentenceTransformer | None = None
_index: faiss.IndexFlatIP | None = None
_verses: list[dict] = []


def _get_model() -> SentenceTransformer:
    global _model
    if _model is None:
        print(f"[embeddings] Loading model: {MODEL_NAME}")
        _model = SentenceTransformer(MODEL_NAME)
        print(f"[embeddings] Model loaded — dim={_model.get_sentence_embedding_dimension()}")
    return _model


def _build_text(verse: dict) -> str:
    """Combine translation + summary + core_idea into one embedding string."""
    parts = [
        verse.get("translation", ""),
        verse.get("summary", ""),
        verse.get("core_idea", ""),
    ]
    return " ".join(p for p in parts if p)


def build_index(verses: list[dict]) -> None:
    """
    Create FAISS index from all verses. Uses inner-product (cosine)
    similarity on L2-normalized embeddings.
    """
    global _index, _verses
    _verses = verses

    model = _get_model()
    texts = [_build_text(v) for v in verses]

    print(f"[embeddings] Encoding {len(texts)} verses…")
    embeddings = model.encode(texts, show_progress_bar=True, normalize_embeddings=True)
    embeddings = np.array(embeddings, dtype=np.float32)

    dim = embeddings.shape[1]
    _index = faiss.IndexFlatIP(dim)  # inner product on normalized = cosine
    _index.add(embeddings)

    print(f"[embeddings] FAISS index built — {_index.ntotal} vectors, dim={dim}")


def search(query: str, top_k: int = 3) -> list[dict]:
    """
    Encode query, search FAISS index, return top_k results with scores.
    """
    if _index is None or not _verses:
        raise RuntimeError("Index not built. Call build_index() first.")

    model = _get_model()
    query_vec = model.encode([query], normalize_embeddings=True)
    query_vec = np.array(query_vec, dtype=np.float32)

    scores, indices = _index.search(query_vec, top_k)

    results = []
    for score, idx in zip(scores[0], indices[0]):
        if idx < 0 or idx >= len(_verses):
            continue
        v = _verses[idx]
        results.append(
            {
                "chapter": v["chapter"],
                "verse": v["verse"],
                "score": round(float(score), 4),
                "translation": v["translation"],
                "summary": v["summary"],
                "core_idea": v["core_idea"],
            }
        )

    return results
