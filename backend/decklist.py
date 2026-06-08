"""
Parser for decklist text files.
Supports standard MTG decklist format with commander designation.
Supports Partner commanders (multiple Commander: lines).
"""

import re
from typing import Any, Dict, List, Optional, Tuple

from backend.scryfall import get_card_by_name


# Trailing set/collector annotation as exported by ManaBox / Arena / Moxfield:
#   "Card Name (C21) 275"      classic Arena
#   "Card Name (cmr) 12"       lowercase set code (ManaBox)
#   "Card Name (LTR) 275a"     collector number with letter suffix
#   "Card Name (MOM) 281 *F*"  trailing foil marker
# Set code: 2-6 alphanumerics in parens. Collector: digits/letters/★/dashes.
# An optional foil/finish marker like *F* or *E* may follow.
_SET_COLLECTOR_RE = re.compile(
    r"\s*\(([A-Za-z0-9]{2,6})\)\s*([0-9A-Za-z★\-]+)?\s*(?:\*[A-Za-z]\*\s*)?$"
)


def _split_card_line(line: str) -> Tuple[int, str, Optional[str], Optional[str]]:
    """
    Split a single decklist line into its parts.

    Returns (count, name, set_code, collector_number).

    Accepts:
      - "1 Sol Ring", "1x Sol Ring", "1X Sol Ring", "Sol Ring"
      - trailing "(SET) collector" annotations (see _SET_COLLECTOR_RE)

    set_code is upper-cased for consistency; set_code / collector_number are
    None when the line carries no annotation. The annotation is parsed and
    returned but is NOT (yet) used for card lookup — it's surfaced so a future
    version can pick a specific printing / artwork.
    """
    count = 1
    rest = line.strip()

    count_match = re.match(r"^(\d+)\s*[xX]?\s+(.+)$", rest)
    if count_match:
        count = int(count_match.group(1))
        rest = count_match.group(2).strip()

    set_code: Optional[str] = None
    collector: Optional[str] = None
    sc_match = _SET_COLLECTOR_RE.search(rest)
    if sc_match:
        set_code = sc_match.group(1).upper()
        collector = sc_match.group(2)
        rest = rest[: sc_match.start()].strip()

    return count, rest.strip(), set_code, collector


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

        # Parse card line: optional count + name + optional "(SET) collector"
        # annotation. The set/collector are extracted but ignored for lookup
        # for now — kept on the entry so a later version can select a printing.
        count, name, set_code, collector = _split_card_line(line)

        if not name:
            continue

        card_data = _lookup_card(name, scryfall_cache)
        entry = {
            "name": card_data["name"],
            "count": count,
            "found": card_data["found"],
            "scryfall_data": card_data["scryfall_data"],
            "set_code": set_code,
            "collector_number": collector,
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
