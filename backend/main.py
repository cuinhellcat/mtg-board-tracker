"""
FastAPI application: routes, WebSocket, and static file serving.
Entry point for the MTG Commander Board State Tracker backend.
"""

import asyncio
import json
import os
import time
import traceback
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Set

import aiohttp

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, BackgroundTasks, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.responses import Response
from starlette.templating import Jinja2Templates


class NoCacheStaticFiles(StaticFiles):
    """StaticFiles that tells the browser never to cache — prevents stale JS/CSS after updates."""
    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        if isinstance(response, Response):
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        return response

from backend.game_engine import GameEngine
from backend.scryfall import (
    download_deck_images,
    ensure_card_image,
    fetch_card_printings,
    fetch_token_printings,
    find_non_crossover_printing,
    get_cache_status,
    is_crossover_set,
    search_cards,
    search_tokens,
    update_cache,
)
from backend.decklist import parse_decklist
from backend.models import Conversation, ConversationMessage
from backend.snapshot import build_board_prompt, generate_bot_hand, generate_mulligan_prompt, generate_snapshot
from backend.printing_prefs import get_preference, set_preference
from backend.deck_storage import list_decks, save_deck, load_deck, delete_deck

BASE_DIR = Path(__file__).parent.parent


def _load_dotenv():
    """Load KEY=VALUE pairs from a local .env into os.environ (no dependency).

    Existing environment variables win; blank lines and '#' comments are skipped.
    Used for secrets like OPENROUTER_API_KEY that must stay out of git.
    """
    env_path = BASE_DIR / ".env"
    if not env_path.exists():
        return
    try:
        for raw in env_path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value
    except OSError:
        pass


_load_dotenv()

app = FastAPI(title="MTG Board State Tracker", version="1.0.0")

# Mount static files — /static uses no-cache (dev code), /cache keeps default caching (images)
app.mount("/static", NoCacheStaticFiles(directory=str(BASE_DIR / "frontend" / "static")), name="static")
app.mount("/cache", StaticFiles(directory=str(BASE_DIR / "cache")), name="cache")

# Templates
templates = Jinja2Templates(directory=str(BASE_DIR / "frontend" / "templates"))

# Global game engine instance
engine = GameEngine()

# Connected WebSocket clients
connected_clients: Set[WebSocket] = set()

# Cache update status tracking
cache_update_status = {"running": False, "message": "", "done": False}


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

async def broadcast_state():
    """Send current game state to all connected WebSocket clients."""
    state = engine.get_state_dict()
    message = {"type": "state_update", "state": state}
    for client in connected_clients.copy():
        try:
            await client.send_json(message)
        except Exception:
            connected_clients.discard(client)


# ------------------------------------------------------------------
# Page routes
# ------------------------------------------------------------------

@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    """Landing page: resume last game or start a new one."""
    return templates.TemplateResponse(request, "landing.html")


@app.get("/api/save-summary")
async def api_save_summary():
    """Return summary of the current autosave, or null if none."""
    return JSONResponse({"summary": engine.get_save_summary()})


@app.get("/api/archive")
async def api_archive():
    """Return list of archived games."""
    return JSONResponse({"games": engine.get_archive_list()})


@app.post("/api/archive/load")
async def api_archive_load(request: Request):
    """Load an archived game as the current game."""
    body = await request.json()
    filename = body.get("filename", "")
    if not filename or "/" in filename or "\\" in filename:
        return JSONResponse({"success": False, "error": "Invalid filename"})
    ok = engine.load_from_archive(filename)
    if ok:
        await broadcast_state()
    return JSONResponse({"success": ok})


@app.get("/board", response_class=HTMLResponse)
async def board_page(request: Request):
    """Render the board view."""
    return templates.TemplateResponse(request, "board.html")


@app.get("/command", response_class=HTMLResponse)
async def command_page(request: Request):
    """Render the command/control view."""
    return templates.TemplateResponse(request, "command.html")


@app.get("/setup", response_class=HTMLResponse)
async def setup_page(request: Request):
    """Render the game setup view."""
    return templates.TemplateResponse(request, "setup.html")


# ------------------------------------------------------------------
# API routes
# ------------------------------------------------------------------

@app.get("/api/cards/search")
async def api_search_cards(q: str = "", limit: int = 10):
    """Search scryfall cache for cards by name."""
    results = search_cards(q, limit=limit)
    return JSONResponse({"results": results})


@app.get("/api/cards/search-tokens")
async def api_search_tokens(q: str = "", limit: int = 15):
    """Search local token cache for tokens by name (offline)."""
    results = search_tokens(q, limit=limit)
    return JSONResponse({"results": results})


@app.get("/api/cards/printings")
async def api_card_printings(name: str = "", is_token: str = ""):
    """Fetch all printings of a card (or token) from Scryfall API."""
    if not name.strip():
        return JSONResponse({"printings": []})
    try:
        if is_token == "1":
            printings = await fetch_token_printings(name.strip())
        else:
            printings = await fetch_card_printings(name.strip())
        return JSONResponse({"printings": printings})
    except Exception as e:
        return JSONResponse({"printings": [], "error": str(e)})


@app.post("/api/cards/set-printing")
async def api_set_printing(request: Request):
    """Save a printing preference and update the in-game card image."""
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"success": False, "error": "Invalid JSON"}, status_code=400)

    card_id = body.get("card_id", "")
    card_name = body.get("card_name", "")
    scryfall_id = body.get("scryfall_id", "")
    image_uri = body.get("image_uri", "")
    large_image_uri = body.get("large_image_uri", "")
    set_name = body.get("set_name", "")

    if not card_name or not scryfall_id or not image_uri:
        return JSONResponse(
            {"success": False, "error": "Missing card_name, scryfall_id, or image_uri"},
            status_code=400,
        )

    # Persist preference
    set_preference(card_name, scryfall_id, image_uri, set_name, large_image_uri)

    # Update all in-game cards with the same name
    if engine.state.game_started:
        result = engine.dispatch({
            "type": "set_card_printing",
            "card_name": card_name,
            "scryfall_id": scryfall_id,
            "image_uri": image_uri,
            "large_image_uri": large_image_uri,
        })
        if result.get("ok"):
            await broadcast_state()

    # Download the new image in background
    asyncio.create_task(_download_images_background([
        {"scryfall_id": scryfall_id, "image_uri": image_uri, "large_image_uri": large_image_uri}
    ]))

    return JSONResponse({"success": True})


@app.post("/api/game/new")
async def api_new_game(request: Request):
    """Create a new game from JSON body.

    Accepts two formats:
    1. Setup page format: {players: [{name, decklist (text)}], starting_life, first_player}
    2. Direct format: {players_data: [{name, decklist (parsed), commander_name}], ...}
    """
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"success": False, "error": "Invalid JSON"}, status_code=400)

    starting_life = body.get("starting_life", 20)
    first_player_index = body.get("first_player", body.get("first_player_index", 0))

    # Handle setup page format: parse decklists from text
    players_raw = body.get("players", body.get("players_data", []))
    if not (2 <= len(players_raw) <= 4):
        return JSONResponse(
            {"success": False, "error": "Between 2 and 4 players required"},
            status_code=400,
        )

    players_data = []
    all_cards_for_images = []
    for praw in players_raw:
        name = praw.get("name", "Player")
        decklist_field = praw.get("decklist", "")

        # If decklist is a string (raw text), parse it first
        if isinstance(decklist_field, str) and decklist_field.strip():
            parsed = parse_decklist(decklist_field)
            deck_cards = parsed.get("main", [])
            # Merge commanders into deck list if present
            commanders = parsed.get("commanders", [])
            for cmd in commanders:
                if cmd not in deck_cards:
                    deck_cards.append(cmd)
            commander_names = [c["name"] for c in commanders] if commanders else []
        elif isinstance(decklist_field, list):
            # Already parsed format
            deck_cards = decklist_field
            commander_names = praw.get("commander_names", [])
            # Backwards compat: single commander_name
            if not commander_names and praw.get("commander_name"):
                commander_names = [praw["commander_name"]]
        else:
            deck_cards = []
            commander_names = []

        # Allow frontend to override commander selection
        override_names = praw.get("commander_names", [])
        # Backwards compat: single commander_name override
        if not override_names and praw.get("commander_name"):
            override_names = [praw["commander_name"]]
        if override_names:
            commander_names = [n for n in override_names if n]

        # Apply printing preferences and auto-swap crossover art
        crossover_checked = set()  # Only hit Scryfall API once per unique name
        for card_entry in deck_cards:
            sd = card_entry.get("scryfall_data", {})
            card_name = card_entry.get("name", "")
            if not card_name:
                continue

            # Check for saved preference
            pref = get_preference(card_name)
            if pref:
                sd["scryfall_id"] = pref["scryfall_id"]
                sd["image_uri"] = pref["image_uri"]
                if pref.get("large_image_uri"):
                    sd["large_image_uri"] = pref["large_image_uri"]
                card_entry["scryfall_data"] = sd
                continue

            # Auto-detect crossover sets (only query API once per card name)
            card_set = sd.get("set", "")
            name_key = card_name.lower()
            if card_set and is_crossover_set(card_set) and name_key not in crossover_checked:
                crossover_checked.add(name_key)
                alt = await find_non_crossover_printing(card_name)
                if alt:
                    sd["scryfall_id"] = alt["scryfall_id"]
                    sd["image_uri"] = alt["image_uri"]
                    sd["large_image_uri"] = alt.get("large_image_uri", "")
                    card_entry["scryfall_data"] = sd
                    set_preference(card_name, alt["scryfall_id"],
                                   alt["image_uri"], alt.get("set_name", ""),
                                   alt.get("large_image_uri", ""))

        # Collect image data for background download
        for card_entry in deck_cards:
            sd = card_entry.get("scryfall_data", {})
            if sd.get("scryfall_id") and sd.get("image_uri"):
                all_cards_for_images.append(sd)

        players_data.append({
            "name": name,
            "decklist": deck_cards,
            "commander_names": commander_names,
        })

    result = engine.dispatch({
        "type": "start_game",
        "players_data": players_data,
        "starting_life": starting_life,
        "first_player_index": first_player_index,
        "format": body.get("format", "Commander"),
        "play_mode": body.get("play_mode", "competitive"),
    })

    if all_cards_for_images:
        asyncio.create_task(_download_images_background(all_cards_for_images))

    if result.get("ok"):
        await broadcast_state()

    # Return in format setup page expects
    return JSONResponse({"success": result.get("ok", False), "error": result.get("error", "")})


async def _download_images_background(cards):
    """Download card images in the background."""
    try:
        await download_deck_images(cards)
    except Exception:
        pass


@app.get("/api/game/state")
async def api_game_state():
    """Return current game state as JSON."""
    return JSONResponse(engine.get_state_dict())


@app.get("/api/game/snapshot")
async def api_game_snapshot(notes: str = "", recent_actions_count: int = 1):
    """Return board state snapshot as text."""
    action_log = [e.model_dump() for e in engine.state.action_log]
    snapshot = generate_snapshot(engine.state, action_log, notes=notes, recent_actions_count=recent_actions_count)
    return JSONResponse({"snapshot": snapshot})


@app.post("/api/app/shutdown")
async def api_app_shutdown(request: Request):
    """Shut the whole app down gracefully (server + tray, if any).

    Restricted to localhost: the server binds 0.0.0.0, so without this guard
    anyone on the LAN could kill it. The actual shutdown is deferred briefly so
    this HTTP response can flush before the server stops.
    """
    client_host = request.client.host if request.client else ""
    if client_host not in ("127.0.0.1", "::1", "localhost"):
        return JSONResponse(
            {"success": False, "error": "Shutdown is only allowed from localhost."},
            status_code=403,
        )

    # start.py registers app.state.request_shutdown (stops uvicorn + tray icon).
    shutdown_cb = getattr(request.app.state, "request_shutdown", None)

    async def _deferred_shutdown():
        await asyncio.sleep(0.3)  # let the response flush first
        if shutdown_cb is not None:
            shutdown_cb()
        else:
            # Fallback (e.g. running under a different launcher): signal self.
            import os
            import signal
            os.kill(os.getpid(), signal.SIGINT)

    asyncio.create_task(_deferred_shutdown())
    return JSONResponse({"success": True})


OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


LLM_LOG_PATH = BASE_DIR / "llm.log"


def _log_llm(message: str):
    """Append a diagnostic line to llm.log (best-effort) and stdout.

    For sharing with support when an LLM call misbehaves. Contains no API key.
    """
    line = f"{_now_iso()} {message}"
    try:
        with open(LLM_LOG_PATH, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass
    print(f"[llm] {message}", flush=True)


async def _openrouter_chat(model: str, messages: list, reasoning_effort: str = ""):
    """Call OpenRouter chat/completions. Returns (ok: bool, content_or_error: str).

    reasoning_effort: "" / "auto" (provider default) or "minimal"/"low"/"medium"/"high".
    The API key stays server-side (OPENROUTER_API_KEY from .env). Every call is
    logged to llm.log (request, outcome, timing, errors) for diagnostics.
    """
    api_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        _log_llm(f"ABORT model={model} reason=no_api_key")
        return False, "OPENROUTER_API_KEY not set (create a .env file)"

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "X-Title": "MTG Board Tracker",
    }
    payload = {"model": model, "messages": messages}
    effort = (reasoning_effort or "").strip().lower()
    if effort in ("minimal", "low", "medium", "high"):
        payload["reasoning"] = {"effort": effort}
    prompt_chars = sum(len(m.get("content", "")) for m in messages)
    _log_llm(f"REQUEST model={model} reasoning={effort or 'auto'} messages={len(messages)} prompt_chars={prompt_chars}")

    start = time.monotonic()
    try:
        timeout = aiohttp.ClientTimeout(total=180)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(OPENROUTER_URL, headers=headers, json=payload) as resp:
                status = resp.status
                try:
                    data = await resp.json()
                except Exception:
                    text = await resp.text()
                    dur = time.monotonic() - start
                    _log_llm(f"FAIL model={model} status={status} dur={dur:.1f}s reason=non_json body={text[:400]!r}")
                    return False, f"OpenRouter HTTP {status}: {text[:300]}"
                dur = time.monotonic() - start
                if status != 200:
                    err = data.get("error", {})
                    msg = err.get("message") if isinstance(err, dict) else str(err)
                    _log_llm(f"FAIL model={model} status={status} dur={dur:.1f}s error={msg!r} body={json.dumps(data)[:600]}")
                    return False, (msg or f"OpenRouter HTTP {status}")
                content = (data.get("choices") or [{}])[0].get("message", {}).get("content", "")
                if not content:
                    _log_llm(f"FAIL model={model} status=200 dur={dur:.1f}s reason=empty_content body={json.dumps(data)[:600]}")
                    return False, "Empty response from model"
                _log_llm(f"OK model={model} status=200 dur={dur:.1f}s content_chars={len(content)}")
                return True, content
    except asyncio.TimeoutError:
        dur = time.monotonic() - start
        _log_llm(f"FAIL model={model} dur={dur:.1f}s reason=timeout (>180s)")
        return False, "OpenRouter request timed out"
    except Exception as e:
        dur = time.monotonic() - start
        _log_llm(f"FAIL model={model} dur={dur:.1f}s exc={type(e).__name__}: {e}")
        return False, f"{type(e).__name__}: {e}"


@app.post("/api/llm/conversation")
async def api_llm_conversation(request: Request):
    """Send a message into a per-bot conversation and return the model's reply.

    Body: {conversation_id|null, partner_index, user_text, model, oracle_mode,
    recent_actions_count, number_hand, notes, clutter, hand_note}.

    The board snapshot (from the partner's perspective) is embedded only in the
    FIRST user message; the full conversation is resent to OpenRouter each call.
    Conversations live in the game state (persistent, broadcast to all clients).
    """
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"success": False, "error": "Invalid JSON"}, status_code=400)

    model = (body.get("model") or "").strip()
    if not model:
        return JSONResponse({"success": False, "error": "No model selected"}, status_code=400)

    state = engine.state
    conversation_id = body.get("conversation_id")
    user_text = (body.get("user_text") or "").strip()

    # Locate existing conversation, or create a new one.
    conv = None
    if conversation_id:
        conv = next((c for c in state.conversations if c.id == conversation_id), None)
    newly_created = False
    if conv is None:
        partner_index = body.get("partner_index")
        if not isinstance(partner_index, int) or not (0 <= partner_index < len(state.players)):
            return JSONResponse({"success": False, "error": "Invalid partner_index"}, status_code=400)
        conv = Conversation(
            id=str(uuid.uuid4()), partner_index=partner_index,
            created_turn=state.turn, created_at=_now_iso(), model=model,
        )
        state.conversations.append(conv)
        newly_created = True
        if len(state.conversations) > 50:  # keep the save file sane
            state.conversations = state.conversations[-50:]

    # Build the user message: first turn carries the board (partner's POV).
    if not conv.messages:
        action_log = [e.model_dump() for e in state.action_log]
        board = build_board_prompt(
            state, action_log, conv.partner_index,
            oracle_mode=body.get("oracle_mode", "off"),
            recent_actions_count=body.get("recent_actions_count", 1),
            number_hand=body.get("number_hand", True),
            notes=body.get("notes", ""),
            clutter=body.get("clutter", ""),
            hand_note=body.get("hand_note", ""),
        )
        content = board + (("\n\n" + user_text) if user_text else "")
    else:
        if not user_text:
            return JSONResponse({"success": False, "error": "Empty follow-up"}, status_code=400)
        content = user_text

    conv.messages.append(ConversationMessage(role="user", content=content, timestamp=_now_iso()))
    conv.model = model
    or_messages = [{"role": m.role, "content": m.content} for m in conv.messages]

    ok, result = await _openrouter_chat(model, or_messages, reasoning_effort=body.get("reasoning", ""))
    if not ok:
        # Roll back the user turn; drop the conversation if it was just created.
        conv.messages.pop()
        if newly_created and not conv.messages and conv in state.conversations:
            state.conversations.remove(conv)
        return JSONResponse({"success": False, "error": f"[{model}] {result}"}, status_code=502)

    conv.messages.append(ConversationMessage(role="assistant", content=result, timestamp=_now_iso()))
    engine._auto_save()
    await broadcast_state()
    return JSONResponse({"success": True, "content": result, "conversation_id": conv.id})


@app.post("/api/llm/conversation/delete_message")
async def api_llm_delete_message(request: Request):
    """Delete a single message (bubble) from a saved conversation by index.

    If the conversation becomes empty, it is removed entirely. Persisted + broadcast.
    """
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"success": False, "error": "Invalid JSON"}, status_code=400)

    conv_id = body.get("conversation_id")
    idx = body.get("message_index")
    conv = next((c for c in engine.state.conversations if c.id == conv_id), None)
    if conv is None:
        return JSONResponse({"success": False, "error": "Conversation not found"}, status_code=404)
    if not isinstance(idx, int) or not (0 <= idx < len(conv.messages)):
        return JSONResponse({"success": False, "error": "Invalid message_index"}, status_code=400)

    conv.messages.pop(idx)
    conversation_removed = False
    if not conv.messages:  # empty → drop the conversation
        engine.state.conversations = [c for c in engine.state.conversations if c.id != conv_id]
        conversation_removed = True

    engine._auto_save()
    await broadcast_state()
    return JSONResponse({"success": True, "conversation_removed": conversation_removed})


@app.get("/api/llm/limit")
async def api_llm_limit():
    """Return the OpenRouter key's usage/limit (for the in-app limit tracker).

    Proxies GET /api/v1/key server-side so the key never reaches the browser.
    """
    api_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        return JSONResponse({"success": False, "error": "OPENROUTER_API_KEY not set"}, status_code=500)

    headers = {"Authorization": f"Bearer {api_key}"}
    try:
        timeout = aiohttp.ClientTimeout(total=20)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get("https://openrouter.ai/api/v1/key", headers=headers) as resp:
                data = await resp.json()
                if resp.status != 200:
                    return JSONResponse(
                        {"success": False, "error": f"OpenRouter HTTP {resp.status}"},
                        status_code=502,
                    )
                d = data.get("data", {})
                return JSONResponse({
                    "success": True,
                    "limit": d.get("limit"),
                    "limit_remaining": d.get("limit_remaining"),
                    "usage_daily": d.get("usage_daily"),
                    "limit_reset": d.get("limit_reset"),
                })
    except Exception as e:
        return JSONResponse({"success": False, "error": f"Request failed: {e}"}, status_code=502)


@app.post("/api/deck/parse")
async def api_parse_deck(request: Request):
    """Parse decklist text and return resolved cards."""
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"success": False, "error": "Invalid JSON"}, status_code=400)

    text = body.get("decklist", body.get("text", ""))
    if not text.strip():
        return JSONResponse({"success": False, "error": "Empty decklist"}, status_code=400)

    result = parse_decklist(text)
    card_count = sum(c.get("count", 1) for c in result.get("main", []))
    commanders = result.get("commanders", [])

    # Collect card names for commander dropdown (include commanders)
    card_names = [c["name"] for c in result.get("main", []) if c.get("found")]
    commander_names = [c["name"] for c in commanders]
    for cn in commander_names:
        if cn not in card_names:
            card_names.append(cn)

    return JSONResponse({
        "success": True,
        "card_count": card_count + len(commanders),
        "commander": commander_names[0] if commander_names else None,  # backwards compat
        "commander_names": commander_names,
        "card_names": card_names,
        "warnings": result.get("warnings", []),
        "data": result,
    })


# ------------------------------------------------------------------
# Deck Storage
# ------------------------------------------------------------------

@app.get("/api/decks/list")
async def api_list_decks(game_format: str = "Commander"):
    """Return list of saved decks filtered by format."""
    return JSONResponse({"decks": list_decks(game_format)})


@app.post("/api/decks/save")
async def api_save_deck(request: Request):
    """Save a deck for future use."""
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"success": False, "error": "Invalid JSON"}, status_code=400)

    name = body.get("name", "").strip()
    decklist_text = body.get("decklist_text", "").strip()
    commander_names = body.get("commander_names", [])
    # Backwards compat: single commander_name
    if not commander_names and body.get("commander_name"):
        commander_names = [body["commander_name"]]
    card_count = body.get("card_count", 0)
    game_format = body.get("format", "Commander")

    if not name or not decklist_text:
        return JSONResponse({"success": False, "error": "Name and decklist required"}, status_code=400)

    result = save_deck(name, decklist_text, commander_names, card_count, game_format=game_format)
    return JSONResponse({"success": True, "filename": result["filename"]})


@app.get("/api/decks/load")
async def api_load_deck(filename: str = "", game_format: str = "Commander"):
    """Load a saved deck by filename."""
    if not filename:
        return JSONResponse({"success": False, "error": "No filename"}, status_code=400)
    data = load_deck(filename, game_format=game_format)
    if not data:
        return JSONResponse({"success": False, "error": "Deck not found"}, status_code=404)
    return JSONResponse({"success": True, "deck": data})


@app.delete("/api/decks/{filename}")
async def api_delete_deck(filename: str, game_format: str = "Commander"):
    """Delete a saved deck."""
    if delete_deck(filename, game_format=game_format):
        return JSONResponse({"success": True})
    return JSONResponse({"success": False, "error": "Deck not found"}, status_code=404)


@app.get("/api/scryfall/status")
async def api_scryfall_status():
    """Return Scryfall cache status."""
    status = get_cache_status()
    # Setup page expects 'count' field
    status["count"] = status.get("card_count", 0)
    status["update_running"] = cache_update_status["running"]
    status["update_message"] = cache_update_status["message"]
    return JSONResponse(status)


@app.post("/api/scryfall/download")
async def api_scryfall_download():
    """Synchronous download endpoint used by setup page - waits for completion."""
    if cache_update_status["running"]:
        return JSONResponse({"success": False, "error": "Update already in progress"})

    cache_update_status["running"] = True
    try:
        result = await update_cache()
        if result.get("ok"):
            return JSONResponse({"success": True, "card_count": result.get("card_count", 0)})
        else:
            return JSONResponse({"success": False, "error": result.get("error", "Unknown error")})
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)})
    finally:
        cache_update_status["running"] = False


@app.post("/api/scryfall/update")
async def api_scryfall_update():
    """Trigger Scryfall cache update as a background task."""
    if cache_update_status["running"]:
        return JSONResponse({"success": False, "error": "Update already in progress"})

    cache_update_status["running"] = True
    cache_update_status["done"] = False
    cache_update_status["message"] = "Starting update..."

    asyncio.create_task(_run_cache_update())

    return JSONResponse({"success": True, "message": "Cache update started"})


async def _run_cache_update():
    """Background task to update Scryfall cache."""
    async def progress(msg):
        cache_update_status["message"] = msg
        # Broadcast progress to all WS clients
        for client in connected_clients.copy():
            try:
                await client.send_json({
                    "type": "cache_update_progress",
                    "message": msg,
                })
            except Exception:
                connected_clients.discard(client)

    try:
        result = await update_cache(progress_callback=progress)
        cache_update_status["message"] = result.get("error", f"Done! {result.get('card_count', 0)} cards cached.")
        cache_update_status["done"] = True

        # Notify clients of completion
        for client in connected_clients.copy():
            try:
                await client.send_json({
                    "type": "cache_update_complete",
                    "result": result,
                })
            except Exception:
                connected_clients.discard(client)
    except Exception as e:
        cache_update_status["message"] = f"Error: {str(e)}"
    finally:
        cache_update_status["running"] = False


# ------------------------------------------------------------------
# WebSocket
# ------------------------------------------------------------------

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint for real-time game state updates.
    Accepts JSON actions, dispatches them, and broadcasts state changes.
    """
    await websocket.accept()
    connected_clients.add(websocket)

    try:
        # Send initial state
        state = engine.get_state_dict()
        await websocket.send_json({"type": "state_update", "state": state})

        while True:
            raw = await websocket.receive_text()

            try:
                action = json.loads(raw)
            except json.JSONDecodeError:
                await websocket.send_json({
                    "type": "error",
                    "message": "Invalid JSON",
                })
                continue

            # Frontend sends "action" key, engine expects "type" key
            if "action" in action and "type" not in action:
                action["type"] = action.pop("action")

            action_type = action.get("type", "")

            # Handle get_state / get_snapshot specially (not dispatched to engine)
            if action_type == "get_state":
                state = engine.get_state_dict()
                await websocket.send_json({"type": "state_update", "state": state})
                continue

            if action_type == "create_related_token":
                from backend.scryfall import fetch_token_details
                scryfall_id = action.get("scryfall_id", "")
                token_data = await fetch_token_details(scryfall_id) if scryfall_id else None
                if token_data:
                    action["token_data"] = token_data
                    result = engine.dispatch(action)
                    if result.get("ok"):
                        await broadcast_state()
                    else:
                        await websocket.send_json({"type": "error", "message": result.get("error", "Unknown error")})
                else:
                    await websocket.send_json({"type": "error", "message": "Could not fetch token data from Scryfall"})
                continue

            if action_type == "get_snapshot":
                notes = action.get("notes", "")
                rac = action.get("recent_actions_count", 1)
                oracle_mode = action.get("oracle_mode", "off")
                number_hand = action.get("number_hand", False)
                action_log = [e.model_dump() for e in engine.state.action_log]
                snapshot_text = generate_snapshot(engine.state, action_log, notes=notes, recent_actions_count=rac, oracle_mode=oracle_mode, number_hand=number_hand)
                await websocket.send_json({"type": "snapshot", "text": snapshot_text})
                continue

            if action_type == "get_bot_hand":
                oracle_mode = action.get("oracle_mode", "off")
                number_hand = action.get("number_hand", False)
                player_index = action.get("player_index")
                hand_text = generate_bot_hand(engine.state, oracle_mode=oracle_mode, number_hand=number_hand, player_index=player_index)
                await websocket.send_json({"type": "bot_hand", "text": hand_text})
                continue

            if action_type == "get_mulligan_prompt":
                oracle_mode = action.get("oracle_mode", "off")
                player_index = action.get("player_index")
                text = generate_mulligan_prompt(engine.state, oracle_mode=oracle_mode, player_index=player_index)
                await websocket.send_json({"type": "mulligan_prompt", "text": text})
                continue

            # Dispatch the action
            result = engine.dispatch(action)

            # Handle special response types
            if result.get("type") == "scry_reveal":
                # Send scry results only to the requesting client
                await websocket.send_json({
                    "type": "scry_reveal",
                    "cards": result.get("cards", []),
                })
                # Still broadcast state update
                await broadcast_state()

            elif result.get("type") == "search_reveal":
                # Send search results only to requesting client
                await websocket.send_json({
                    "type": "search_reveal",
                    "cards": result.get("cards", []),
                    "player_index": action.get("player_index", 0),
                })
                await broadcast_state()

            elif not result.get("ok"):
                # Send error only to requesting client
                await websocket.send_json({
                    "type": "error",
                    "message": result.get("error", "Unknown error"),
                })

            else:
                # Broadcast state update to all clients
                await broadcast_state()

    except WebSocketDisconnect:
        pass
    except Exception:
        print("=" * 60, flush=True)
        print("!!! WebSocket loop crashed — closing socket !!!", flush=True)
        traceback.print_exc()
        print("=" * 60, flush=True)
        try:
            await websocket.close(code=1011)
        except Exception:
            pass
    finally:
        connected_clients.discard(websocket)


# ------------------------------------------------------------------
# Startup
# ------------------------------------------------------------------

@app.on_event("startup")
async def on_startup():
    """Ensure required directories exist on startup."""
    (BASE_DIR / "cache" / "images").mkdir(parents=True, exist_ok=True)
    (BASE_DIR / "cache" / "saved_decks").mkdir(parents=True, exist_ok=True)
    (BASE_DIR / "saves").mkdir(parents=True, exist_ok=True)


@app.on_event("shutdown")
async def on_shutdown():
    """Notify all clients that server is shutting down."""
    shutdown_msg = json.dumps({"type": "server_shutdown"})
    for client in connected_clients.copy():
        try:
            await client.send_text(shutdown_msg)
        except Exception:
            pass
    connected_clients.clear()
