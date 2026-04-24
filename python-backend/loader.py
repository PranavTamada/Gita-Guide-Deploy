"""
loader.py — Load and merge verses.json + purports.json into unified verse objects.
"""
from __future__ import annotations

import json
import os

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")


def _truncate(text: str, max_chars: int = 300) -> str:
    """Truncate text to max_chars at a sentence boundary."""
    if not text or len(text) <= max_chars:
        return text or ""
    cut = text[:max_chars]
    last_period = cut.rfind(".")
    if last_period > max_chars // 2:
        return cut[: last_period + 1]
    return cut.rstrip() + "…"


def load_verses() -> list[dict]:
    """
    Load verses and purports, merge them into a single list.

    Each returned dict has:
        chapter, verse, translation, summary, core_idea,
        emotion_tags, life_situations, principles, keywords
    """
    verses_path = os.path.join(DATA_DIR, "verses.json")
    purports_path = os.path.join(DATA_DIR, "purports.json")

    with open(verses_path, "r", encoding="utf-8") as f:
        raw_verses = json.load(f)

    # Build purport lookup
    purport_map: dict[str, dict] = {}
    if os.path.exists(purports_path):
        with open(purports_path, "r", encoding="utf-8") as f:
            raw_purports = json.load(f)
        for p in raw_purports:
            key = f"{p['chapter']}-{p['verse']}"
            purport_map[key] = p

    merged = []
    for v in raw_verses:
        key = f"{v['chapter']}-{v['verse']}"
        purport_data = purport_map.get(key, {})

        # Extract a concise core_idea from the purport (first ~300 chars)
        purport_text = purport_data.get("purport", "")
        core_idea = _truncate(purport_text, 300) if purport_text else ""

        # Build a short summary from keywords + principles
        keywords = v.get("keywords", [])
        principles = v.get("principles", [])
        summary_parts = principles + keywords[:3]
        summary = "; ".join(summary_parts) if summary_parts else ""

        merged.append(
            {
                "chapter": v["chapter"],
                "verse": v["verse"],
                "translation": v.get("translation", ""),
                "summary": summary,
                "core_idea": core_idea,
                "emotion_tags": v.get("emotion_tags", []),
                "life_situations": v.get("life_situations", []),
                "principles": principles,
                "keywords": keywords,
            }
        )

    print(f"[loader] Loaded {len(merged)} verses ({len(purport_map)} purports merged)")
    return merged
