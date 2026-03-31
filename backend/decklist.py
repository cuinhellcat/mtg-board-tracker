"""
Parser for decklist text files.
Supports standard MTG decklist format with commander designation.
Supports Partner commanders (multiple Commander: lines).
"""

import re
from typing import Any, Dict, List, Optional

from backend.scryfall import get_card_by_name


def parse_decklist(text: str, scryfall_cache=None) -> Dict[str, Any]:
    """
    Parse a decklist text into structured card data.

    Format:
    - One card per line
    - "1 Sol Ring" or just "Sol Ring" (quantity optional, default 1)
    - "COMMANDER:" or "Commander:" prefix marks the commander
    - Lines starting with "//" or "#" are comments, empty lines ignored
    - "Sideboard" on its own line starts the sideboard section

    Returns:
    {
        "main": [{"name": "Sol Ring", "count": 1, "found": True, "scryfall_data": {...}}, ...],
        "commanders": [{"name": "...", "found": True, "scryfall_data": {...}}, ...],
        "commander": {"name": "...", ...} or None,  (first commander, for backwards compat)
        "sideboard": [...],
        "warnings": ["Card 'Xyz' not found in Scryfall cache"]
    }
    """
    main: List[Dict[str, Any]] = []
    sideboard: List[Dict[str, Any]] = []
    commanders: List[Dict[str, Any]] = []
    warnings: List[str] = []

    current_section = "main"  # "main" or "sideboard"

    lines = text.strip().split("\n")

    for raw_line in lines:
        line = raw_line.strip()

        # Skip empty lines and comments
        if not line or line.startswith("//") or line.startswith("#"):
            continue

        # Check for sideboard section marker
        if re.match(r"^sideboard\s*$", line, re.IGNORECASE):
            current_section = "sideboard"
            continue

        # Strip "Commander:" prefix — commander is selected via dropdown on setup page
        line = re.sub(r"^(?:COMMANDER|Commander|commander)\s*:\s*", "", line)

        # Parse card line: optional count + card name
        # Supports "1 Sol Ring", "1x Sol Ring", "1X Sol Ring"
        card_match = re.match(r"^(\d+)[xX]?\s+(.+)$", line)
        if card_match:
            count = int(card_match.group(1))
            name = card_match.group(2).strip()
        else:
            count = 1
            name = line.strip()

        # Remove set codes in parentheses, e.g., "Sol Ring (C21) 123"
        # Common MTGO/Arena export format: "1 Sol Ring (C21) 256"
        name = re.sub(r"\s*\([A-Z0-9]+\)\s*\d*\s*$", "", name).strip()

        if not name:
            continue

        card_data = _lookup_card(name, scryfall_cache)
        entry = {
            "name": card_data["name"],
            "count": count,
            "found": card_data["found"],
            "scryfall_data": card_data["scryfall_data"],
        }

        if not card_data["found"]:
            warnings.append(f"Card '{name}' not found in Scryfall cache")

        if current_section == "sideboard":
            sideboard.append(entry)
        else:
            main.append(entry)

    return {
        "main": main,
        "commanders": commanders,
        "commander": commanders[0] if commanders else None,  # backwards compat
        "sideboard": sideboard,
        "warnings": warnings,
    }


def _lookup_card(name: str, scryfall_cache=None) -> Dict[str, Any]:
    """
    Look up a card by name in the Scryfall cache.
    Returns {"name": str, "found": bool, "scryfall_data": dict or {}}.
    """
    card = get_card_by_name(name)

    if card:
        return {
            "name": card.get("name", name),
            "found": True,
            "scryfall_data": card,
        }

    return {
        "name": name,
        "found": False,
        "scryfall_data": {},
    }
