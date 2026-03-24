"""
Persistent deck storage.
Saves and loads parsed decklists so users can quickly re-use them.
Stored as JSON files in cache/saved_decks/.
"""

import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

BASE_DIR = Path(__file__).parent.parent
DECKS_DIR = BASE_DIR / "cache" / "saved_decks"


def _sanitize_filename(name: str) -> str:
    """Turn a deck name into a safe filename."""
    safe = re.sub(r'[<>:"/\\|?*]', '_', name.strip())
    return safe[:80] or "unnamed"


def list_decks() -> List[Dict[str, Any]]:
    """Return list of saved decks (name + commander + card_count)."""
    DECKS_DIR.mkdir(parents=True, exist_ok=True)
    decks = []
    for f in sorted(DECKS_DIR.glob("*.json")):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            decks.append({
                "filename": f.stem,
                "name": data.get("name", f.stem),
                "commander": data.get("commander_name", None),
                "card_count": data.get("card_count", 0),
            })
        except Exception:
            continue
    return decks


def save_deck(name: str, decklist_text: str, commander_name: Optional[str], card_count: int) -> Dict[str, Any]:
    """Save a deck to disk. Returns {ok, filename}."""
    DECKS_DIR.mkdir(parents=True, exist_ok=True)
    filename = _sanitize_filename(name)
    path = DECKS_DIR / f"{filename}.json"
    data = {
        "name": name,
        "decklist_text": decklist_text,
        "commander_name": commander_name,
        "card_count": card_count,
    }
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    return {"ok": True, "filename": filename}


def load_deck(filename: str) -> Optional[Dict[str, Any]]:
    """Load a saved deck by filename (without extension)."""
    path = DECKS_DIR / f"{filename}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def delete_deck(filename: str) -> bool:
    """Delete a saved deck. Returns True if deleted."""
    path = DECKS_DIR / f"{filename}.json"
    if path.exists():
        path.unlink()
        return True
    return False
