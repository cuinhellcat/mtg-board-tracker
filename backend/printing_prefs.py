"""
Persistent printing preferences for card art selection.
Stores user choices in cache/printing_preferences.json so preferred
printings survive game restarts.
"""

import json
from pathlib import Path
from typing import Any, Dict, Optional

BASE_DIR = Path(__file__).parent.parent
CACHE_DIR = BASE_DIR / "cache"
PREFS_PATH = CACHE_DIR / "printing_preferences.json"


def load_preferences() -> Dict[str, Dict[str, Any]]:
    """Load all printing preferences. Returns {card_name_lower: {scryfall_id, image_uri, set_name}}."""
    if not PREFS_PATH.exists():
        return {}
    try:
        return json.loads(PREFS_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, Exception):
        return {}


def save_preferences(prefs: Dict[str, Dict[str, Any]]) -> None:
    """Write all printing preferences to disk."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    PREFS_PATH.write_text(
        json.dumps(prefs, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def get_preference(card_name: str) -> Optional[Dict[str, Any]]:
    """Get saved preference for a card, or None."""
    prefs = load_preferences()
    return prefs.get(card_name.lower().strip())


def set_preference(card_name: str, scryfall_id: str, image_uri: str, set_name: str) -> None:
    """Save a printing preference for a card."""
    prefs = load_preferences()
    prefs[card_name.lower().strip()] = {
        "scryfall_id": scryfall_id,
        "image_uri": image_uri,
        "set_name": set_name,
    }
    save_preferences(prefs)


def clear_preference(card_name: str) -> None:
    """Remove a saved printing preference."""
    prefs = load_preferences()
    key = card_name.lower().strip()
    if key in prefs:
        del prefs[key]
        save_preferences(prefs)
