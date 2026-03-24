"""
Scryfall API integration for card data and image caching.
Handles bulk data download, local cache, fuzzy search, and image downloads.
"""

import asyncio
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import aiohttp

BASE_DIR = Path(__file__).parent.parent
CACHE_DIR = BASE_DIR / "cache"
IMAGES_DIR = CACHE_DIR / "images"
SCRYFALL_CACHE_PATH = CACHE_DIR / "scryfall_cache.json"

# Scryfall API endpoints
BULK_DATA_URL = "https://api.scryfall.com/bulk-data/oracle-cards"
SCRYFALL_SEARCH_URL = "https://api.scryfall.com/cards/search"

# Set codes for crossover / Universes Beyond sets whose art we want to avoid.
# Cards unique to these sets are kept; cards with in-universe alternatives are swapped.
CROSSOVER_SET_CODES = {"tmt", "tmc"}  # tmt = TMNT expansion, tmc = TMNT eternal; extend as needed

# Fields to extract from each Scryfall card
EXTRACT_FIELDS = [
    "name", "oracle_text", "mana_cost", "type_line",
    "power", "toughness", "loyalty",
    "colors", "color_identity", "cmc",
]


def get_cache_path() -> Path:
    """Return the path to the Scryfall cache file."""
    return SCRYFALL_CACHE_PATH


def get_cache_status() -> Dict[str, Any]:
    """
    Return cache status info:
    {cached: bool, card_count: int, last_updated: str, age_days: int}
    """
    if not SCRYFALL_CACHE_PATH.exists():
        return {
            "cached": False,
            "card_count": 0,
            "last_updated": "",
            "age_days": -1,
        }

    try:
        data = json.loads(SCRYFALL_CACHE_PATH.read_text(encoding="utf-8"))
        meta = data.get("metadata", {})
        last_updated = meta.get("last_updated", "")
        card_count = meta.get("card_count", len(data.get("cards", {})))

        age_days = -1
        if last_updated:
            try:
                updated_dt = datetime.fromisoformat(last_updated)
                now = datetime.now(timezone.utc)
                if updated_dt.tzinfo is None:
                    updated_dt = updated_dt.replace(tzinfo=timezone.utc)
                age_days = (now - updated_dt).days
            except (ValueError, TypeError):
                pass

        return {
            "cached": True,
            "card_count": card_count,
            "last_updated": last_updated,
            "age_days": age_days,
        }
    except (json.JSONDecodeError, Exception):
        return {
            "cached": False,
            "card_count": 0,
            "last_updated": "",
            "age_days": -1,
        }


async def update_cache(progress_callback=None) -> Dict[str, Any]:
    """
    Download Scryfall bulk data (Oracle Cards), extract relevant fields,
    and save to cache. Returns status dict.
    """
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    async with aiohttp.ClientSession() as session:
        # Step 1: Get the bulk data download URL
        if progress_callback:
            await progress_callback("Fetching bulk data URL from Scryfall...")

        async with session.get(BULK_DATA_URL) as resp:
            if resp.status != 200:
                return {"ok": False, "error": f"Failed to fetch bulk data info: HTTP {resp.status}"}
            bulk_info = await resp.json()

        download_url = bulk_info.get("download_uri")
        if not download_url:
            return {"ok": False, "error": "No download_uri in bulk data response"}

        # Step 2: Download the full card data
        if progress_callback:
            await progress_callback("Downloading card database (this may take a minute)...")

        # Respect rate limiting
        await asyncio.sleep(0.1)

        async with session.get(download_url) as resp:
            if resp.status != 200:
                return {"ok": False, "error": f"Failed to download bulk data: HTTP {resp.status}"}
            raw_data = await resp.json(content_type=None)

        if progress_callback:
            await progress_callback(f"Processing {len(raw_data)} cards...")

        # Step 3: Extract relevant fields
        cards = {}
        for card in raw_data:
            # Skip non-paper cards and tokens from bulk
            if card.get("layout") in ("token", "art_series"):
                continue

            name = card.get("name", "")
            if not name:
                continue

            # Get image URI (prefer "normal" size)
            image_uri = None
            image_uris = card.get("image_uris")
            if image_uris:
                image_uri = image_uris.get("normal") or image_uris.get("large") or image_uris.get("small")

            # For double-faced cards, try card_faces for image
            if not image_uri and card.get("card_faces"):
                face = card["card_faces"][0]
                face_images = face.get("image_uris")
                if face_images:
                    image_uri = face_images.get("normal") or face_images.get("large") or face_images.get("small")

            # Build oracle_text — for DFCs use only front face text
            oracle_text = card.get("oracle_text", "")
            if not oracle_text and card.get("card_faces"):
                oracle_text = card["card_faces"][0].get("oracle_text", "")

            # Build mana_cost for double-faced cards
            mana_cost = card.get("mana_cost", "")
            if not mana_cost and card.get("card_faces"):
                mana_cost = card["card_faces"][0].get("mana_cost", "")

            # Power/toughness for double-faced
            power = card.get("power")
            toughness = card.get("toughness")
            if power is None and card.get("card_faces"):
                power = card["card_faces"][0].get("power")
                toughness = card["card_faces"][0].get("toughness")

            # Type line for double-faced
            type_line = card.get("type_line", "")
            if not type_line and card.get("card_faces"):
                type_line = card["card_faces"][0].get("type_line", "")

            # Build back_face data for double-faced cards
            layout = card.get("layout", "normal")
            back_face = None
            card_faces = card.get("card_faces")
            if card_faces and len(card_faces) >= 2:
                bf = card_faces[1]
                bf_image = None
                bf_images = bf.get("image_uris")
                if bf_images:
                    bf_image = bf_images.get("normal") or bf_images.get("large") or bf_images.get("small")
                back_face = {
                    "name": bf.get("name", ""),
                    "oracle_text": bf.get("oracle_text", ""),
                    "mana_cost": bf.get("mana_cost", ""),
                    "type_line": bf.get("type_line", ""),
                    "power": bf.get("power"),
                    "toughness": bf.get("toughness"),
                    "loyalty": bf.get("loyalty"),
                    "image_uri": bf_image,
                }

            # Extract related tokens from all_parts
            related_tokens = []
            all_parts = card.get("all_parts") or []
            for part in all_parts:
                if part.get("component") == "token":
                    token_ref = {
                        "name": part.get("name", ""),
                        "type_line": part.get("type_line", ""),
                        "scryfall_id": part.get("id", ""),
                        "uri": part.get("uri", ""),
                    }
                    related_tokens.append(token_ref)

            entry = {
                "scryfall_id": card.get("id", ""),
                "name": name,
                "oracle_text": oracle_text,
                "mana_cost": mana_cost,
                "type_line": type_line,
                "power": power,
                "toughness": toughness,
                "loyalty": card.get("loyalty"),
                "colors": card.get("colors", []),
                "color_identity": card.get("color_identity", []),
                "cmc": card.get("cmc", 0),
                "image_uri": image_uri,
                "set": card.get("set", ""),
                "set_name": card.get("set_name", ""),
                "layout": layout,
            }
            if back_face:
                entry["back_face"] = back_face
            if related_tokens:
                entry["related_tokens"] = related_tokens

            # Use lowercase name as key for deduplication; keep the first printing
            key = name.lower()
            if key not in cards:
                cards[key] = entry

        # Step 4: Save to cache
        cache_data = {
            "metadata": {
                "last_updated": datetime.now(timezone.utc).isoformat(),
                "card_count": len(cards),
                "source": "scryfall_oracle_cards",
            },
            "cards": cards,
        }

        SCRYFALL_CACHE_PATH.write_text(
            json.dumps(cache_data, separators=(",", ":")),
            encoding="utf-8",
        )

        # Invalidate in-memory cache so next lookup uses fresh data
        _invalidate_cache()

        if progress_callback:
            await progress_callback(f"Cache updated: {len(cards)} unique cards saved.")

        return {"ok": True, "card_count": len(cards)}


_cache_data: Optional[Dict[str, Any]] = None


def _load_cache() -> Dict[str, Any]:
    """Load the cache file. Uses in-memory cache after first load."""
    global _cache_data
    if _cache_data is not None:
        return _cache_data
    if not SCRYFALL_CACHE_PATH.exists():
        return {}
    try:
        data = json.loads(SCRYFALL_CACHE_PATH.read_text(encoding="utf-8"))
        _cache_data = data.get("cards", {})
        return _cache_data
    except (json.JSONDecodeError, Exception):
        return {}


def _invalidate_cache():
    """Clear the in-memory cache (call after update_cache)."""
    global _cache_data
    _cache_data = None


def search_cards(query: str, limit: int = 10) -> List[Dict[str, Any]]:
    """
    Fuzzy search by name in local cache. Uses substring matching + relevance sorting.
    Returns up to `limit` matches.
    """
    if not query or not query.strip():
        return []

    cards = _load_cache()
    if not cards:
        return []

    query_lower = query.lower().strip()
    query_parts = query_lower.split()

    results = []
    for key, card in cards.items():
        name_lower = key

        # Check if all query parts appear in the name
        if all(part in name_lower for part in query_parts):
            # Score: exact match = 0, starts with = 1, contains = 2
            if name_lower == query_lower:
                score = 0
            elif name_lower.startswith(query_lower):
                score = 1
            else:
                score = 2

            # Secondary sort by name length (shorter = more relevant)
            results.append((score, len(name_lower), card))

    results.sort(key=lambda x: (x[0], x[1]))
    return [r[2] for r in results[:limit]]


def get_card_by_name(name: str) -> Optional[Dict[str, Any]]:
    """Exact or best match lookup by name."""
    cards = _load_cache()
    if not cards:
        return None

    key = name.lower().strip()

    # Exact match
    if key in cards:
        return cards[key]

    # Try substring match: only check if the search term appears in a card name,
    # NOT the reverse (avoids short card names like "X" matching everything)
    matches = []
    for card_key, card in cards.items():
        if key in card_key:
            matches.append((len(card_key), card))

    if matches:
        # Prefer shortest matching card name (closest match)
        matches.sort(key=lambda x: x[0])
        return matches[0][1]

    return None


async def ensure_card_image(scryfall_id: str, image_url: str) -> Optional[str]:
    """
    Download card image if not cached locally.
    Returns the local path relative to project root, or None on failure.
    """
    if not scryfall_id or not image_url:
        return None

    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    local_path = IMAGES_DIR / f"{scryfall_id}.jpg"

    if local_path.exists():
        return f"cache/images/{scryfall_id}.jpg"

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(image_url) as resp:
                if resp.status == 200:
                    content = await resp.read()
                    local_path.write_bytes(content)
                    return f"cache/images/{scryfall_id}.jpg"
                else:
                    return None
    except Exception:
        return None


TOKEN_CACHE_PATH = CACHE_DIR / "token_cache.json"

_token_cache: Optional[Dict[str, Any]] = None


def _load_token_cache() -> Dict[str, Any]:
    global _token_cache
    if _token_cache is not None:
        return _token_cache
    if not TOKEN_CACHE_PATH.exists():
        _token_cache = {}
        return _token_cache
    try:
        _token_cache = json.loads(TOKEN_CACHE_PATH.read_text(encoding="utf-8"))
        return _token_cache
    except (json.JSONDecodeError, Exception):
        _token_cache = {}
        return _token_cache


def _save_token_cache():
    if _token_cache is not None:
        TOKEN_CACHE_PATH.write_text(
            json.dumps(_token_cache, separators=(",", ":")),
            encoding="utf-8",
        )


async def fetch_token_details(scryfall_id: str) -> Optional[Dict[str, Any]]:
    """
    Fetch full token details from Scryfall by ID.
    Caches results locally so each token is only fetched once.
    Returns dict with name, type_line, oracle_text, power, toughness, colors, image_uri.
    """
    cache = _load_token_cache()
    if scryfall_id in cache:
        return cache[scryfall_id]

    try:
        url = f"https://api.scryfall.com/cards/{scryfall_id}"
        async with aiohttp.ClientSession() as session:
            await asyncio.sleep(0.1)  # Rate limiting
            async with session.get(url) as resp:
                if resp.status != 200:
                    return None
                data = await resp.json()

        image_uri = None
        image_uris = data.get("image_uris")
        if image_uris:
            image_uri = image_uris.get("normal") or image_uris.get("large") or image_uris.get("small")

        token_data = {
            "scryfall_id": data.get("id", scryfall_id),
            "name": data.get("name", ""),
            "oracle_text": data.get("oracle_text", ""),
            "type_line": data.get("type_line", ""),
            "power": data.get("power"),
            "toughness": data.get("toughness"),
            "colors": data.get("colors", []),
            "image_uri": image_uri,
        }

        # Cache it
        cache[scryfall_id] = token_data
        _save_token_cache()

        # Download image
        if image_uri:
            await ensure_card_image(scryfall_id, image_uri)

        return token_data
    except Exception:
        return None


async def download_deck_images(cards: List[Dict[str, Any]], max_concurrent: int = 10):
    """
    Batch download images for a list of cards.
    Each card dict should have 'scryfall_id' and 'image_uri' keys.
    Downloads up to max_concurrent images at a time.
    """
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)

    # Filter to cards that need downloading
    to_download = []
    for card in cards:
        sid = card.get("scryfall_id")
        url = card.get("image_uri")
        if sid and url:
            local_path = IMAGES_DIR / f"{sid}.jpg"
            if not local_path.exists():
                to_download.append((sid, url))

    if not to_download:
        return

    semaphore = asyncio.Semaphore(max_concurrent)

    async def _download_one(sid: str, url: str):
        async with semaphore:
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.get(url) as resp:
                        if resp.status == 200:
                            content = await resp.read()
                            path = IMAGES_DIR / f"{sid}.jpg"
                            path.write_bytes(content)
            except Exception:
                pass

    tasks = [_download_one(sid, url) for sid, url in to_download]
    await asyncio.gather(*tasks)


# ------------------------------------------------------------------
# Crossover set detection
# ------------------------------------------------------------------

def is_crossover_set(set_code: str) -> bool:
    """Check whether a set code is in the crossover denylist."""
    return set_code.lower() in CROSSOVER_SET_CODES


# ------------------------------------------------------------------
# Scryfall printings API (on-demand, not bulk)
# ------------------------------------------------------------------

async def fetch_card_printings(card_name: str) -> List[Dict[str, Any]]:
    """
    Fetch all printings of a card from the Scryfall API.
    Returns a list of dicts with scryfall_id, name, set, set_name,
    image_uri, and released_at.
    """
    results: List[Dict[str, Any]] = []
    params = {
        "q": f'!"{card_name}" unique:prints',
        "order": "released",
    }

    async with aiohttp.ClientSession() as session:
        url = SCRYFALL_SEARCH_URL
        while url:
            await asyncio.sleep(0.1)  # Scryfall rate limit
            async with session.get(url, params=params) as resp:
                if resp.status != 200:
                    break
                data = await resp.json()

            for card in data.get("data", []):
                # Skip tokens and digital-only
                if card.get("layout") in ("token", "art_series"):
                    continue
                if card.get("digital", False):
                    continue

                image_uri = None
                image_uris = card.get("image_uris")
                if image_uris:
                    image_uri = (
                        image_uris.get("normal")
                        or image_uris.get("large")
                        or image_uris.get("small")
                    )
                if not image_uri and card.get("card_faces"):
                    face_imgs = card["card_faces"][0].get("image_uris")
                    if face_imgs:
                        image_uri = (
                            face_imgs.get("normal")
                            or face_imgs.get("large")
                            or face_imgs.get("small")
                        )

                if not image_uri:
                    continue

                results.append({
                    "scryfall_id": card.get("id", ""),
                    "name": card.get("name", ""),
                    "set": card.get("set", ""),
                    "set_name": card.get("set_name", ""),
                    "image_uri": image_uri,
                    "released_at": card.get("released_at", ""),
                })

            # Handle pagination
            if data.get("has_more") and data.get("next_page"):
                url = data["next_page"]
                params = {}  # next_page URL already has params
            else:
                url = None

    return results


async def find_non_crossover_printing(card_name: str) -> Optional[Dict[str, Any]]:
    """
    Find the first non-crossover printing for a card.
    Returns a dict with scryfall_id/image_uri/set_name, or None if
    all printings are from crossover sets (card is unique to that set).
    """
    printings = await fetch_card_printings(card_name)
    for p in printings:
        if not is_crossover_set(p.get("set", "")):
            return p
    return None
