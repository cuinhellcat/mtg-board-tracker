"""
Persistent deck storage.
Saves and loads parsed decklists so users can quickly re-use them.
Stored as JSON files in cache/saved_decks/.
"""

import json
import re
import shutil
from pathlib import Path
from typing import Any, Dict, List, Optional

BASE_DIR = Path(__file__).parent.parent
DECKS_DIR = BASE_DIR / "cache" / "saved_decks"


def _get_format_dir(game_format: str) -> Path:
    """Return the subdirectory for a specific format."""
    folder = "tiny_leaders" if game_format == "Tiny Leaders" else "duel_commander"
    return DECKS_DIR / folder


def _sanitize_filename(name: str) -> str:
    """Turn a deck name into a safe filename."""
    safe = re.sub(r'[<>:"/\\|?*]', '_', name.strip())
    return safe[:80] or "unnamed"


def list_decks(game_format: str = "Commander") -> List[Dict[str, Any]]:
    """Return list of saved decks (name + commander(s) + card_count)."""
    target_dir = _get_format_dir(game_format)
    target_dir.mkdir(parents=True, exist_ok=True)
    decks = []
    for f in sorted(target_dir.glob("*.json")):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            # Backwards compat: old decks have commander_name (string), new ones have commander_names (list)
            commander_names = data.get("commander_names", [])
            if not commander_names and data.get("commander_name"):
                commander_names = [data["commander_name"]]
            decks.append({
                "filename": f.stem,
                "name": data.get("name", f.stem),
                "commander": commander_names[0] if commander_names else None,
                "commander_names": commander_names,
                "card_count": data.get("card_count", 0),
            })
        except Exception:
            continue
    return decks


def save_deck(name: str, decklist_text: str, commander_names: List[str],
              card_count: int, commander_name: Optional[str] = None, game_format: str = "Commander") -> Dict[str, Any]:
    """Save a deck to disk. Returns {ok, filename}."""
    target_dir = _get_format_dir(game_format)
    target_dir.mkdir(parents=True, exist_ok=True)
    # Backwards compat: accept old single commander_name param
    if not commander_names and commander_name:
        commander_names = [commander_name]
    filename = _sanitize_filename(name)
    path = target_dir / f"{filename}.json"
    data = {
        "name": name,
        "decklist_text": decklist_text,
        "commander_names": commander_names,
        "commander_name": commander_names[0] if commander_names else None,  # backwards compat
        "card_count": card_count,
        "format": game_format,
    }
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    return {"ok": True, "filename": filename}


def load_deck(filename: str, game_format: str = "Commander") -> Optional[Dict[str, Any]]:
    """Load a saved deck by filename (without extension)."""
    target_dir = _get_format_dir(game_format)
    path = target_dir / f"{filename}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def delete_deck(filename: str, game_format: str = "Commander") -> bool:
    """Delete a saved deck. Returns True if deleted."""
    target_dir = _get_format_dir(game_format)
    path = target_dir / f"{filename}.json"
    if path.exists():
        path.unlink()
        return True
    return False

