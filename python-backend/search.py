"""
search.py — High-level search and insight generation.
"""

from embeddings import search as faiss_search


def search_verses(query: str, top_k: int = 3) -> list[dict]:
    """
    Semantic search over all Bhagavad Gita verses.
    Returns top_k results with chapter, verse, score, summary, core_idea.
    """
    return faiss_search(query, top_k=top_k)


def generate_insight(verse: dict, query: str) -> str:
    """
    Generate a short, practical insight from the verse's core_idea
    in the context of the user's query. Kept under 15 words.

    This is a lightweight rule-based generator — no LLM required.
    """
    core = verse.get("core_idea", "")
    summary = verse.get("summary", "")

    # Use first sentence of core_idea if available
    if core:
        first_sentence = core.split(".")[0].strip()
        # Trim to ~15 words
        words = first_sentence.split()
        if len(words) > 15:
            first_sentence = " ".join(words[:15]) + "…"
        if first_sentence:
            return first_sentence

    # Fallback to summary
    if summary:
        words = summary.split(";")[0].strip().split()
        if len(words) > 15:
            return " ".join(words[:15]) + "…"
        return " ".join(words)

    return "Focus on right action without attachment to outcomes."
