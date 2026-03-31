"""
Central game engine with action dispatch, undo, and auto-save.
All state mutations go through dispatch() - never mutate state directly.
"""

import atexit
import json
import random
import tempfile
import uuid
import copy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from backend.models import ActionEntry, Arrow, CardState, ChatMessage, GameState, PlayerState
from backend.scryfall import get_card_by_name as scryfall_lookup
from backend.printing_prefs import get_preference

BASE_DIR = Path(__file__).parent.parent

PHASE_ORDER = [
    "untap", "upkeep", "draw",
    "main1",
    "combat_begin", "combat_attackers", "combat_blockers", "combat_damage", "combat_end",
    "main2",
    "end_step", "cleanup",
]

PHASE_DISPLAY_NAMES = {
    "untap": "Untap",
    "upkeep": "Upkeep",
    "draw": "Draw",
    "main1": "Main 1",
    "combat_begin": "Begin Combat",
    "combat_attackers": "Declare Attackers",
    "combat_blockers": "Declare Blockers",
    "combat_damage": "Combat Damage",
    "combat_end": "End Combat",
    "main2": "Main 2",
    "end_step": "End Step",
    "cleanup": "Cleanup",
}

SAVE_PATH = BASE_DIR / "saves" / "current_game.json"


class GameEngine:
    """
    Holds the GameState, handles action dispatch, undo history, and auto-save.
    """

    def __init__(self):
        self.state = GameState()
        self.undo_stack: List[dict] = []  # serialized state snapshots
        self.chat_log: List[ChatMessage] = []
        self._load_saved_state()
        # Save on clean shutdown (Ctrl+C, server stop, etc.)
        atexit.register(self._auto_save)

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def get_save_summary(self) -> dict | None:
        """Return a brief summary of the current game for the landing page."""
        if not self.state.game_started:
            return None
        return {
            "players": [{"name": p.name, "life": p.life} for p in self.state.players],
            "turn": self.state.turn,
            "phase": PHASE_DISPLAY_NAMES.get(self.state.phase, self.state.phase),
        }

    def _archive_current_game(self):
        """Archive the current game before starting a new one."""
        if not self.state.game_started:
            return
        archive_dir = BASE_DIR / "saves" / "archive"
        archive_dir.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        raw_names = "_vs_".join(p.name for p in self.state.players[:2]) if self.state.players else "unknown"
        safe_names = "".join(c if c.isalnum() or c in "-_" else "_" for c in raw_names)
        archive_path = archive_dir / f"{timestamp}_{safe_names}.json"
        payload = {
            "state": self.state.model_dump(),
            "chat_log": [m.model_dump() for m in self.chat_log],
            "archived_at": timestamp,
        }
        archive_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    def load_from_archive(self, filename: str) -> bool:
        """Load an archived game as the current game."""
        archive_path = BASE_DIR / "saves" / "archive" / filename
        if not archive_path.exists():
            return False
        try:
            data = json.loads(archive_path.read_text(encoding="utf-8"))
            state_data = data.get("state", {})
            self.state = GameState.model_validate(state_data)
            self.chat_log = [ChatMessage.model_validate(m) for m in data.get("chat_log", [])]
            # Re-apply printing preferences so saved art choices survive restarts
            for card in self.state.cards.values():
                self._apply_printing_pref(card)
            self.undo_stack = []
            self._auto_save()
            return True
        except Exception:
            return False

    def get_archive_list(self) -> list:
        """Return metadata for all archived games, newest first."""
        archive_dir = BASE_DIR / "saves" / "archive"
        if not archive_dir.exists():
            return []
        games = []
        for f in sorted(archive_dir.glob("*.json"), reverse=True):
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                state = data.get("state", {})
                players = state.get("players", [])
                games.append({
                    "filename": f.name,
                    "archived_at": data.get("archived_at", f.stem[:15]),
                    "players": [{"name": p.get("name", "?"), "life": p.get("life", 0)} for p in players[:2]],
                    "turn": state.get("turn", 0),
                    "phase": PHASE_DISPLAY_NAMES.get(state.get("phase", ""), state.get("phase", "")),
                })
            except Exception:
                pass
        return games

    def _load_saved_state(self):
        """Load game state from disk if a save file exists."""
        if SAVE_PATH.exists():
            try:
                data = json.loads(SAVE_PATH.read_text(encoding="utf-8"))
                state_data = data.get("state", data.get("game_state", {}))
                self.state = GameState.model_validate(state_data)
                self.chat_log = [
                    ChatMessage.model_validate(m)
                    for m in data.get("chat_log", [])
                ]
                # Re-apply printing preferences so saved art choices survive restarts
                for card in self.state.cards.values():
                    self._apply_printing_pref(card)
            except Exception:
                # Corrupted save - start fresh
                self.state = GameState()
                self.chat_log = []

    def _auto_save(self):
        """Persist current state to disk (atomic write to prevent corruption)."""
        SAVE_PATH.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "state": self.state.model_dump(),
            "chat_log": [m.model_dump() for m in self.chat_log],
        }
        data = json.dumps(payload, indent=2)
        # Write to temp file first, then rename — prevents half-written saves
        try:
            fd, tmp_path = tempfile.mkstemp(
                dir=SAVE_PATH.parent, suffix=".tmp", prefix="save_"
            )
            with open(fd, "w", encoding="utf-8") as f:
                f.write(data)
            Path(tmp_path).replace(SAVE_PATH)
        except OSError:
            # Fallback: direct write (better than no save at all)
            SAVE_PATH.write_text(data, encoding="utf-8")

    @staticmethod
    def _apply_printing_pref(card: CardState) -> None:
        """Apply saved printing preference to a card (in-place)."""
        pref = get_preference(card.name)
        if pref:
            card.scryfall_id = pref["scryfall_id"]
            card.image_uri = pref["image_uri"]
            if pref.get("large_image_uri"):
                card.large_image_uri = pref["large_image_uri"]

    # ------------------------------------------------------------------
    # State access
    # ------------------------------------------------------------------

    def get_state_dict(self) -> dict:
        """Return a flat serializable dict of the game state (with chat_log merged in)."""
        d = self.state.model_dump()
        d["chat_log"] = [m.model_dump() for m in self.chat_log]
        return d

    # ------------------------------------------------------------------
    # Undo
    # ------------------------------------------------------------------

    def _push_undo(self):
        """Snapshot the current state for undo."""
        snapshot = {
            "state": self.state.model_dump(),
            "chat_log": [m.model_dump() for m in self.chat_log],
        }
        self.undo_stack.append(snapshot)
        # Keep undo stack reasonable
        if len(self.undo_stack) > 100:
            self.undo_stack = self.undo_stack[-100:]

    def undo(self) -> bool:
        """Restore the previous state. Returns True if undo succeeded."""
        if not self.undo_stack:
            return False
        snapshot = self.undo_stack.pop()
        self.state = GameState.model_validate(snapshot["state"])
        self.chat_log = [
            ChatMessage.model_validate(m) for m in snapshot.get("chat_log", [])
        ]
        self._auto_save()
        return True

    # ------------------------------------------------------------------
    # Action log helper
    # ------------------------------------------------------------------

    def _log_action(self, action_type: str, description: str):
        """Create an ActionEntry and append it to the game log."""
        phase_display = PHASE_DISPLAY_NAMES.get(self.state.phase, self.state.phase)
        active_name = "?"
        if 0 <= self.state.active_player_index < len(self.state.players):
            active_name = self.state.players[self.state.active_player_index].name

        entry = ActionEntry(
            id=str(uuid.uuid4()),
            type=action_type,
            description=f"[T{self.state.turn} {phase_display}] {active_name}: {description}",
            turn=self.state.turn,
            phase=self.state.phase,
            timestamp=datetime.now(timezone.utc).isoformat(),
        )
        self.state.action_log.append(entry)

    # ------------------------------------------------------------------
    # Dispatch
    # ------------------------------------------------------------------

    def dispatch(self, action: Dict[str, Any]) -> Dict[str, Any]:
        """
        Route an action dict to the appropriate handler.
        Every action pushes an undo snapshot and auto-saves afterward.
        Returns a result dict (always has 'ok' key).
        """
        action_type = action.get("type", "")
        handler_map = {
            "move_card": self._handle_move_card,
            "tap_toggle": self._handle_tap_toggle,
            "change_life": self._handle_change_life,
            "set_phase": self._handle_set_phase,
            "next_phase": self._handle_next_phase,
            "pass_turn": self._handle_pass_turn,
            "draw_card": self._handle_draw_card,
            "shuffle_library": self._handle_shuffle_library,
            "create_token": self._handle_create_token,
            "clone_card": self._handle_clone_card,
            "become_copy": self._handle_become_copy,
            "revert_copy": self._handle_revert_copy,
            "delete_card": self._handle_delete_card,
            "add_counter": self._handle_add_counter,
            "remove_counter": self._handle_remove_counter,
            "link_exile": self._handle_link_exile,
            "unlink_exile": self._handle_unlink_exile,
            "attach_card": self._handle_attach_card,
            "detach_card": self._handle_detach_card,
            "toggle_oracle_text": self._handle_toggle_oracle_text,
            "set_note": self._handle_set_note,
            "toggle_summoning_sick": self._handle_toggle_summoning_sick,
            "create_related_token": self._handle_create_related_token,
            "scry": self._handle_scry,
            "scry_resolve": self._handle_scry_resolve,
            "search_library": self._handle_search_library,
            "mulligan": self._handle_mulligan,
            "bottom_card": self._handle_bottom_card,
            "start_game": self._handle_start_game,
            "send_chat": self._handle_send_chat,
            "undo": self._handle_undo,
            "set_mana_pool": self._handle_set_mana_pool,
            "set_commander_damage": self._handle_set_commander_damage,
            "set_attacking": self._handle_set_attacking,
            "set_blocking": self._handle_set_blocking,
            "set_face_down": self._handle_set_face_down,
            "set_card_printing": self._handle_set_card_printing,
            "untap_all": self._handle_untap_all,
            "set_player_counter": self._handle_set_player_counter,
            "set_commander_tax": self._handle_set_commander_tax,
            "add_card": self._handle_add_card,
            "set_custom_pt": self._handle_set_custom_pt,
            "set_loyalty": self._handle_set_loyalty,
            "transform_card": self._handle_transform_card,
            "mill": self._handle_mill,
            "set_quantity": self._handle_set_quantity,
            "create_arrow": self._handle_create_arrow,
            "remove_arrow": self._handle_remove_arrow,
            "update_arrow_buff": self._handle_update_arrow_buff,
        }

        handler = handler_map.get(action_type)
        if handler is None:
            return {"ok": False, "error": f"Unknown action type: {action_type}"}

        # Undo and chat don't need undo snapshots themselves
        if action_type not in ("undo", "send_chat"):
            self._push_undo()

        try:
            result = handler(action)
        except Exception as e:
            # Roll back on error
            if action_type not in ("undo", "send_chat") and self.undo_stack:
                self.undo_stack.pop()
            return {"ok": False, "error": str(e)}

        self._auto_save()
        return result

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _move_to_zone(self, card: CardState, zone: str):
        """Set a card's zone and update the zone_moved_at counter for ordering."""
        old_zone = card.zone
        self.state.zone_move_counter += 1
        card.zone = zone
        card.zone_moved_at = self.state.zone_move_counter
        # Summoning sickness: creatures entering the battlefield get it (unless haste)
        if zone == "battlefield":
            is_creature = "Creature" in (card.type_line or "")
            has_haste = "Haste" in (card.keywords or [])
            card.summoning_sick = is_creature and not has_haste
        else:
            card.summoning_sick = False
        # Arrow cleanup: remove arrows when card leaves battlefield
        if old_zone == "battlefield" and zone != "battlefield":
            self._remove_arrows_for_card(card.id)

    def _get_card(self, card_id: str) -> CardState:
        card = self.state.cards.get(card_id)
        if card is None:
            raise ValueError(f"Card not found: {card_id}")
        return card

    def _get_player(self, index: int) -> PlayerState:
        if index < 0 or index >= len(self.state.players):
            raise ValueError(f"Invalid player index: {index}")
        return self.state.players[index]

    def _library_cards(self, player_index: int) -> List[CardState]:
        """Get library cards for a player, preserving order by their position in the dict."""
        return [
            c for c in self.state.cards.values()
            if c.zone == "library" and c.owner_index == player_index
        ]

    def _hand_cards(self, player_index: int) -> List[CardState]:
        return [
            c for c in self.state.cards.values()
            if c.zone == "hand" and c.owner_index == player_index
        ]

    # ------------------------------------------------------------------
    # Action handlers
    # ------------------------------------------------------------------

    def _handle_move_card(self, action: dict) -> dict:
        card_id = action["card_id"]
        to_zone = action["to_zone"]
        to_player_index = action.get("to_player_index")

        card = self._get_card(card_id)
        from_zone = card.zone
        old_name = card.name

        # If moving a commander to graveyard or exile, redirect to command zone
        # (The player can choose; we handle it as a move to command_zone instead)

        # Clear combat state when leaving battlefield
        if from_zone == "battlefield" and to_zone != "battlefield":
            card.attacking = False
            card.blocking = None
            card.tapped = False

        # Clean state when moving to stack
        if to_zone == "stack":
            card.tapped = False
            card.attacking = False
            card.blocking = None
            card.battlefield_group = None

        # If card had linked exile cards and is leaving battlefield, unlink them
        if from_zone == "battlefield" and to_zone != "battlefield":
            for linked_id in list(card.linked_exile_cards):
                linked_card = self.state.cards.get(linked_id)
                if linked_card:
                    self._move_to_zone(linked_card, "exile")
                    linked_card.linked_to = None
            card.linked_exile_cards = []

        # If card had attached cards (Auras/Equipment) and is leaving battlefield, detach them
        if from_zone == "battlefield" and to_zone != "battlefield":
            for att_id in list(card.attached_cards):
                att_card = self.state.cards.get(att_id)
                if att_card:
                    att_card.attached_to = None
            card.attached_cards = []

        # If an attached card is moved, remove it from parent
        if card.attached_to:
            parent = self.state.cards.get(card.attached_to)
            if parent and card_id in parent.attached_cards:
                parent.attached_cards.remove(card_id)
            card.attached_to = None

        # If an exile_linked card is moved, remove it from parent
        if card.linked_to:
            parent = self.state.cards.get(card.linked_to)
            if parent and card_id in parent.linked_exile_cards:
                parent.linked_exile_cards.remove(card_id)
            card.linked_to = None

        self._move_to_zone(card, to_zone)
        if to_player_index is not None:
            card.controller_index = to_player_index

        # Allow user to choose battlefield subzone (creature/land/other)
        battlefield_group = action.get("battlefield_group")
        if to_zone == "battlefield" and battlefield_group:
            card.battlefield_group = battlefield_group
        elif to_zone != "battlefield":
            card.battlefield_group = None

        # Casting from command zone increments that commander's tax
        if from_zone == "command_zone" and card.is_commander:
            player = self._get_player(card.owner_index)
            player.commander_taxes[card.name] = player.commander_taxes.get(card.name, 0) + 2

        self._log_action("move_card", f"Moved {old_name} from {from_zone} to {to_zone}")
        return {"ok": True}

    def _handle_tap_toggle(self, action: dict) -> dict:
        card = self._get_card(action["card_id"])
        card.tapped = not card.tapped
        state_str = "tapped" if card.tapped else "untapped"
        self._log_action("tap_toggle", f"{state_str} {card.name}")
        return {"ok": True}

    def _handle_untap_all(self, action: dict) -> dict:
        player_index = action["player_index"]
        count = 0
        for card in self.state.cards.values():
            if card.controller_index == player_index and card.zone == "battlefield" and card.tapped:
                card.tapped = False
                count += 1
        player_name = self.state.players[player_index].name
        self._log_action("untap_all", f"Untapped all permanents for {player_name} ({count} cards)")
        return {"ok": True}

    def _handle_set_player_counter(self, action: dict) -> dict:
        """Set or remove a named player counter (e.g. Poison, Experience, Energy)."""
        player_index = action["player_index"]
        counter_name = action["counter_name"].strip()
        delta = action.get("delta", 0)
        player = self._get_player(player_index)
        old_val = player.extra_counters.get(counter_name, 0)
        new_val = old_val + delta
        if new_val <= 0:
            player.extra_counters.pop(counter_name, None)
            new_val = 0
        else:
            player.extra_counters[counter_name] = new_val
        self._log_action("set_player_counter", f"{player.name}: {counter_name} {old_val} → {new_val}")
        return {"ok": True}

    def _handle_set_commander_tax(self, action: dict) -> dict:
        """Manually adjust commander tax for a specific commander."""
        player_index = action["player_index"]
        commander_name = action.get("commander_name", "")
        delta = action.get("delta", 0)
        player = self._get_player(player_index)

        # If no commander_name given, fall back to first commander tax entry
        if not commander_name and player.commander_taxes:
            commander_name = next(iter(player.commander_taxes))

        old_val = player.commander_taxes.get(commander_name, 0)
        new_val = max(0, old_val + delta)
        if new_val > 0:
            player.commander_taxes[commander_name] = new_val
        else:
            player.commander_taxes.pop(commander_name, None)
        self._log_action("set_commander_tax", f"{player.name}: {commander_name} Tax {old_val} → {new_val}")
        return {"ok": True}

    def _handle_change_life(self, action: dict) -> dict:
        player_index = action["player_index"]
        delta = action["delta"]
        player = self._get_player(player_index)
        old_life = player.life
        player.life += delta
        direction = "gained" if delta > 0 else "lost"
        self._log_action(
            "change_life",
            f"{player.name} {direction} {abs(delta)} life ({old_life} -> {player.life})",
        )
        return {"ok": True}

    def _handle_set_phase(self, action: dict) -> dict:
        phase = action["phase"]
        if phase not in PHASE_ORDER:
            raise ValueError(f"Invalid phase: {phase}")
        self.state.phase = phase
        self._log_action("set_phase", f"Phase set to {PHASE_DISPLAY_NAMES[phase]}")
        return {"ok": True}

    def _handle_next_phase(self, action: dict) -> dict:
        current_idx = PHASE_ORDER.index(self.state.phase) if self.state.phase in PHASE_ORDER else 0
        next_idx = current_idx + 1

        if next_idx >= len(PHASE_ORDER):
            self._begin_new_turn()
        else:
            self.state.phase = PHASE_ORDER[next_idx]
            self._log_action("next_phase", f"Phase: {PHASE_DISPLAY_NAMES[self.state.phase]}")

        return {"ok": True}

    def _handle_pass_turn(self, action: dict) -> dict:
        self._begin_new_turn()
        return {"ok": True}

    def _begin_new_turn(self):
        """Switch active player, increment turn, and auto-resolve untap/upkeep/draw."""
        self.state.turn += 1
        self.state.active_player_index = 1 - self.state.active_player_index
        active_idx = self.state.active_player_index
        active_name = self.state.players[active_idx].name

        # --- Untap step: untap all permanents + clear summoning sickness ---
        self.state.phase = "untap"
        untap_count = 0
        for card in self.state.cards.values():
            if card.controller_index == active_idx and card.zone == "battlefield":
                if card.tapped:
                    card.tapped = False
                    untap_count += 1
                card.summoning_sick = False

        self._log_action("new_turn", f"Turn {self.state.turn} — {active_name}'s turn")
        if untap_count > 0:
            self._log_action("untap_all", f"Untapped {untap_count} permanents for {active_name}")

        # --- Upkeep step ---
        self.state.phase = "upkeep"

        # --- Draw step: draw one card ---
        self.state.phase = "draw"
        library = self._library_cards(active_idx)
        if library:
            card = library[0]
            self._move_to_zone(card, "hand")
            self._log_action("draw_card", f"{active_name} drew a card: {card.name}")
        else:
            self._log_action("draw_card", f"{active_name} tried to draw but library is empty!")

        # Advance to main1 after draw
        self.state.phase = "main1"


    def _handle_draw_card(self, action: dict) -> dict:
        player_index = action["player_index"]
        count = action.get("count", 1)
        player = self._get_player(player_index)

        library = self._library_cards(player_index)
        if len(library) < count:
            count = len(library)

        drawn = []
        for i in range(count):
            if not library:
                break
            card = library.pop(0)
            self._move_to_zone(card, "hand")
            drawn.append(card.name)

        drawn_str = ", ".join(drawn) if drawn else "nothing"
        self._log_action("draw_card", f"{player.name} drew {count} card(s): {drawn_str}")
        return {"ok": True, "drawn": drawn}

    def _handle_mill(self, action: dict) -> dict:
        player_index = action["player_index"]
        count = action.get("count", 1)
        player = self._get_player(player_index)

        library = self._library_cards(player_index)
        if len(library) < count:
            count = len(library)

        milled = []
        for i in range(count):
            if not library:
                break
            card = library.pop(0)
            self._move_to_zone(card, "graveyard")
            milled.append(card.name)

        milled_str = ", ".join(milled) if milled else "nothing"
        self._log_action("mill", f"{player.name} milled {count}: {milled_str}")
        return {"ok": True, "milled": milled}

    def _handle_shuffle_library(self, action: dict) -> dict:
        player_index = action["player_index"]
        player = self._get_player(player_index)

        library = self._library_cards(player_index)
        card_ids = [c.id for c in library]
        random.shuffle(card_ids)

        # Rebuild the cards dict with shuffled library order
        non_library = {
            cid: c for cid, c in self.state.cards.items()
            if not (c.zone == "library" and c.owner_index == player_index)
        }
        shuffled_cards = {cid: self.state.cards[cid] for cid in card_ids}
        # Merge: non-library cards first, then shuffled library
        new_cards: Dict[str, CardState] = {}
        new_cards.update(non_library)
        new_cards.update(shuffled_cards)
        self.state.cards = new_cards

        self._log_action("shuffle_library", f"{player.name} shuffled their library")
        return {"ok": True}

    def _handle_create_token(self, action: dict) -> dict:
        player_index = action["player_index"]
        player = self._get_player(player_index)
        name = action["name"]
        power = action.get("power", "0")
        toughness = action.get("toughness", "0")
        type_line = action.get("type_line", "Token Creature")
        abilities = action.get("abilities", "")

        token_id = str(uuid.uuid4())
        token = CardState(
            id=token_id,
            name=name,
            oracle_text=abilities,
            type_line=type_line,
            power=str(power) if power is not None else None,
            toughness=str(toughness) if toughness is not None else None,
            zone="battlefield",
            owner_index=player_index,
            controller_index=player_index,
            is_token=True,
            is_conjured=True,
            scryfall_id=action.get("scryfall_id") or None,
            image_uri=action.get("image_uri") or None,
            large_image_uri=action.get("large_image_uri") or None,
        )
        # Apply saved printing preference (e.g. preferred Treasure/Food art)
        self._apply_printing_pref(token)
        self.state.cards[token_id] = token
        # Summoning sickness for creature tokens (unless haste)
        is_creature = "Creature" in (type_line or "")
        has_haste = "Haste" in (token.keywords or [])
        token.summoning_sick = is_creature and not has_haste
        self._log_action("create_token", f"{player.name} created a {name} token")
        return {"ok": True, "card_id": token_id}

    def _handle_add_card(self, action: dict) -> dict:
        """Add an arbitrary card (by name) to a player's zone, with Scryfall data if available."""
        player_index = action["player_index"]
        player = self._get_player(player_index)
        name = action["name"].strip()
        zone = action.get("zone", "battlefield")

        card_data = scryfall_lookup(name) or {}
        card_id = str(uuid.uuid4())
        card = CardState(
            id=card_id,
            scryfall_id=card_data.get("scryfall_id"),
            name=card_data.get("name", name),
            oracle_text=card_data.get("oracle_text", ""),
            mana_cost=card_data.get("mana_cost", ""),
            type_line=card_data.get("type_line", ""),
            power=card_data.get("power"),
            toughness=card_data.get("toughness"),
            loyalty=card_data.get("loyalty"),
            colors=card_data.get("colors", []),
            color_identity=card_data.get("color_identity", []),
            cmc=card_data.get("cmc", 0),
            image_uri=card_data.get("image_uri"),
            large_image_uri=card_data.get("large_image_uri"),
            zone=zone,
            owner_index=player_index,
            controller_index=player_index,
            is_token=False,
            is_conjured=True,
            layout=card_data.get("layout", "normal"),
            back_face=card_data.get("back_face"),
            related_tokens=card_data.get("related_tokens", []),
        )
        self._apply_printing_pref(card)
        self.state.cards[card_id] = card
        found = "found" if card_data else "not found in Scryfall"
        self._log_action("add_card", f"{player.name} added {card.name} to {zone} ({found})")
        return {"ok": True, "card_id": card_id, "found": bool(card_data)}

    def _handle_set_custom_pt(self, action: dict) -> dict:
        """Set or update a custom P/T badge on any card. Pass None to remove."""
        card = self._get_card(action["card_id"])
        power = action.get("power")
        toughness = action.get("toughness")
        card.custom_power = int(power) if power is not None else None
        card.custom_toughness = int(toughness) if toughness is not None else None
        if power is not None:
            self._log_action("set_custom_pt", f"Set {card.name} P/T badge to {power}/{toughness}")
        else:
            self._log_action("set_custom_pt", f"Removed P/T badge from {card.name}")
        return {"ok": True}

    def _handle_set_loyalty(self, action: dict) -> dict:
        """Update a planeswalker's loyalty value."""
        card = self._get_card(action["card_id"])
        new_loyalty = action["loyalty"]
        old_loyalty = card.loyalty
        card.loyalty = str(new_loyalty)
        self._log_action("set_loyalty", f"{card.name} loyalty {old_loyalty} → {new_loyalty}")
        return {"ok": True}

    def _handle_transform_card(self, action: dict) -> dict:
        """Toggle a double-faced card between front and back face."""
        card = self._get_card(action["card_id"])
        if not card.back_face:
            return {"ok": False, "error": "Card has no back face"}
        card.transformed = not card.transformed
        # Determine displayed name for logging
        if card.transformed:
            display_name = card.back_face.get("name", card.name)
            self._log_action("transform_card", f"{card.name} transformed to {display_name}")
        else:
            self._log_action("transform_card", f"{card.back_face.get('name', card.name)} transformed back to {card.name}")
        return {"ok": True}

    def _handle_clone_card(self, action: dict) -> dict:
        card = self._get_card(action["card_id"])
        clone_id = str(uuid.uuid4())
        clone = card.model_copy(deep=True)
        clone.id = clone_id
        clone.is_token = True  # Clones are treated as tokens
        clone.is_conjured = True  # Deletable (not part of original deck)
        clone.linked_exile_cards = []
        clone.linked_to = None
        self.state.cards[clone_id] = clone
        self._log_action("clone_card", f"Cloned {card.name}")
        return {"ok": True, "card_id": clone_id}

    def _handle_become_copy(self, action: dict) -> dict:
        """Card takes on all copiable characteristics of the target card."""
        card = self._get_card(action["card_id"])
        target = self._get_card(action["target_card_id"])
        old_name = card.name
        # Save original characteristics for revert
        card.original_characteristics = {
            "name": card.name, "mana_cost": card.mana_cost, "type_line": card.type_line,
            "oracle_text": card.oracle_text, "colors": list(card.colors),
            "color_identity": list(card.color_identity), "power": card.power,
            "toughness": card.toughness, "loyalty": card.loyalty, "cmc": card.cmc,
            "keywords": list(card.keywords), "image_uri": card.image_uri,
            "large_image_uri": card.large_image_uri, "scryfall_id": card.scryfall_id,
            "layout": card.layout, "back_face": card.back_face.copy() if card.back_face else None,
            "related_tokens": list(card.related_tokens),
        }
        # Copy copiable characteristics (MTG rule 707.2)
        card.name = target.name
        card.mana_cost = target.mana_cost
        card.type_line = target.type_line
        card.oracle_text = target.oracle_text
        card.colors = list(target.colors)
        card.color_identity = list(target.color_identity)
        card.power = target.power
        card.toughness = target.toughness
        card.loyalty = target.loyalty
        card.cmc = target.cmc
        card.keywords = list(target.keywords)
        card.image_uri = target.image_uri
        card.large_image_uri = target.large_image_uri
        card.scryfall_id = target.scryfall_id
        card.layout = target.layout
        card.back_face = target.back_face.copy() if target.back_face else None
        card.related_tokens = list(target.related_tokens)
        # Summoning sickness: if it became a creature, check haste
        if "Creature" in (card.type_line or ""):
            card.summoning_sick = "Haste" not in (card.keywords or [])
        self._log_action("become_copy", f"{old_name} becomes a copy of {target.name}")
        return {"ok": True}

    def _handle_revert_copy(self, action: dict) -> dict:
        """Revert a card to its original characteristics before it became a copy."""
        card = self._get_card(action["card_id"])
        orig = card.original_characteristics
        if not orig:
            return {"ok": False, "error": "No copy to revert"}
        copy_name = card.name
        for key, value in orig.items():
            setattr(card, key, value)
        card.original_characteristics = None
        self._log_action("revert_copy", f"{copy_name} reverted to {card.name}")
        return {"ok": True}

    def _handle_delete_card(self, action: dict) -> dict:
        card_id = action["card_id"]
        card = self._get_card(card_id)
        name = card.name

        # Clean up linked exile references
        if card.linked_to:
            parent = self.state.cards.get(card.linked_to)
            if parent and card_id in parent.linked_exile_cards:
                parent.linked_exile_cards.remove(card_id)

        # If this card has linked exile cards, move them to regular exile
        for linked_id in list(card.linked_exile_cards):
            linked = self.state.cards.get(linked_id)
            if linked:
                self._move_to_zone(linked, "exile")
                linked.linked_to = None

        self._remove_arrows_for_card(card_id)
        del self.state.cards[card_id]
        self._log_action("delete_card", f"Deleted {name}")
        return {"ok": True}

    def _handle_set_quantity(self, action: dict) -> dict:
        """Set visual quantity badge on a card."""
        card = self._get_card(action["card_id"])
        new_qty = max(1, action.get("quantity", 1))
        card.quantity = new_qty
        return {"ok": True}

    def _handle_add_counter(self, action: dict) -> dict:
        card = self._get_card(action["card_id"])
        counter_type = action["counter_type"]
        amount = action.get("amount", 1)
        card.counters[counter_type] = card.counters.get(counter_type, 0) + amount
        self._update_custom_pt_from_counters(card)
        self._log_action("add_counter", f"Added {amount} {counter_type} counter(s) to {card.name}")
        return {"ok": True}

    def _handle_remove_counter(self, action: dict) -> dict:
        card = self._get_card(action["card_id"])
        counter_type = action["counter_type"]
        amount = action.get("amount", 1)
        current = card.counters.get(counter_type, 0)
        new_val = max(0, current - amount)
        if new_val == 0:
            card.counters.pop(counter_type, None)
        else:
            card.counters[counter_type] = new_val
        self._update_custom_pt_from_counters(card)
        self._log_action("remove_counter", f"Removed {amount} {counter_type} counter(s) from {card.name}")
        return {"ok": True}

    def _update_custom_pt_from_counters(self, card: CardState) -> None:
        """Auto-update custom P/T badge based on +1/+1, -1/-1 counters AND arrow buffs."""
        if card.power is None or card.toughness is None:
            return
        try:
            base_p = int(card.power)
            base_t = int(card.toughness)
        except (ValueError, TypeError):
            return  # Non-numeric P/T (e.g. "*/*") — skip
        plus = card.counters.get("+1/+1", 0)
        minus = card.counters.get("-1/-1", 0)
        counter_delta = plus - minus
        # Sum arrow buffs targeting this card
        arrow_p = sum(a.buff_power for a in self.state.arrows if a.target_card_id == card.id and a.buff_power)
        arrow_t = sum(a.buff_toughness for a in self.state.arrows if a.target_card_id == card.id and a.buff_toughness)
        total_p = counter_delta + arrow_p
        total_t = counter_delta + arrow_t
        if total_p == 0 and total_t == 0 and not card.counters.get("+1/+1") and not card.counters.get("-1/-1"):
            # No modifiers — remove auto P/T badge
            if card.custom_power is not None:
                card.custom_power = None
                card.custom_toughness = None
            return
        card.custom_power = base_p + total_p
        card.custom_toughness = base_t + total_t

    def _handle_link_exile(self, action: dict) -> dict:
        card_id = action["card_id"]
        parent_card_id = action["parent_card_id"]
        card = self._get_card(card_id)
        parent = self._get_card(parent_card_id)

        self._move_to_zone(card, "exile_linked")
        card.linked_to = parent_card_id
        if card_id not in parent.linked_exile_cards:
            parent.linked_exile_cards.append(card_id)

        self._log_action("link_exile", f"Exiled {card.name} linked to {parent.name}")
        return {"ok": True}

    def _handle_unlink_exile(self, action: dict) -> dict:
        card_id = action["card_id"]
        card = self._get_card(card_id)

        if card.linked_to:
            parent = self.state.cards.get(card.linked_to)
            if parent and card_id in parent.linked_exile_cards:
                parent.linked_exile_cards.remove(card_id)
            card.linked_to = None

        self._move_to_zone(card, "exile")
        self._log_action("unlink_exile", f"Unlinked {card.name} from exile")
        return {"ok": True}

    def _handle_attach_card(self, action: dict) -> dict:
        card_id = action["card_id"]
        parent_card_id = action["parent_card_id"]
        card = self._get_card(card_id)
        parent = self._get_card(parent_card_id)

        # If already attached somewhere else, detach first
        if card.attached_to:
            old_parent = self.state.cards.get(card.attached_to)
            if old_parent and card_id in old_parent.attached_cards:
                old_parent.attached_cards.remove(card_id)

        card.attached_to = parent_card_id
        if card_id not in parent.attached_cards:
            parent.attached_cards.append(card_id)

        self._log_action("attach_card", f"Attached {card.name} to {parent.name}")
        return {"ok": True}

    def _handle_detach_card(self, action: dict) -> dict:
        card_id = action["card_id"]
        card = self._get_card(card_id)

        if card.attached_to:
            parent = self.state.cards.get(card.attached_to)
            if parent and card_id in parent.attached_cards:
                parent.attached_cards.remove(card_id)
            card.attached_to = None

        self._log_action("detach_card", f"Detached {card.name}")
        return {"ok": True}

    def _handle_toggle_oracle_text(self, action: dict) -> dict:
        card_id = action["card_id"]
        card = self._get_card(card_id)
        card.show_oracle_text = not card.show_oracle_text
        status = "enabled" if card.show_oracle_text else "disabled"
        self._log_action("toggle_oracle_text", f"Oracle text {status} for {card.name}")
        return {"ok": True}

    def _handle_set_note(self, action: dict) -> dict:
        card = self._get_card(action["card_id"])
        card.note = action.get("note", "").strip()
        if card.note:
            self._log_action("set_note", f"Note on {card.name}: {card.note[:50]}")
        else:
            self._log_action("set_note", f"Removed note from {card.name}")
        return {"ok": True}

    def _handle_toggle_summoning_sick(self, action: dict) -> dict:
        card = self._get_card(action["card_id"])
        card.summoning_sick = not card.summoning_sick
        status = "on" if card.summoning_sick else "off"
        self._log_action("toggle_summoning_sick", f"Summoning sickness {status} for {card.name}")
        return {"ok": True}

    def _handle_create_related_token(self, action: dict) -> dict:
        """Create a token from pre-fetched Scryfall token data."""
        source_card_id = action.get("source_card_id")
        token_data = action.get("token_data")
        if not token_data:
            return {"ok": False, "error": "No token data provided"}

        source_card = self._get_card(source_card_id) if source_card_id else None
        player_index = source_card.controller_index if source_card else action.get("player_index", 0)
        player = self._get_player(player_index)

        card_id = str(uuid.uuid4())
        card = CardState(
            id=card_id,
            scryfall_id=token_data.get("scryfall_id"),
            name=token_data.get("name", "Token"),
            oracle_text=token_data.get("oracle_text", ""),
            type_line=token_data.get("type_line", ""),
            power=token_data.get("power"),
            toughness=token_data.get("toughness"),
            colors=token_data.get("colors", []),
            image_uri=token_data.get("image_uri"),
            large_image_uri=token_data.get("large_image_uri"),
            zone="battlefield",
            owner_index=player_index,
            controller_index=player_index,
            is_token=True,
            is_conjured=True,
        )
        # Apply saved printing preference (e.g. preferred Treasure/Food art)
        self._apply_printing_pref(card)
        self.state.cards[card_id] = card
        # Summoning sickness for creature tokens (unless haste)
        is_creature = "Creature" in (card.type_line or "")
        has_haste = "Haste" in (card.keywords or [])
        card.summoning_sick = is_creature and not has_haste
        source_name = source_card.name if source_card else "manual"
        self._log_action("create_related_token", f"{player.name} created {card.name} token (from {source_name})")
        return {"ok": True, "card_id": card_id}

    def _handle_scry(self, action: dict) -> dict:
        player_index = action["player_index"]
        count = action.get("count", 1)
        player = self._get_player(player_index)

        library = self._library_cards(player_index)
        top_cards = library[:count]
        revealed = [
            {
                "id": c.id,
                "name": c.name,
                "mana_cost": c.mana_cost,
                "type_line": c.type_line,
                "oracle_text": c.oracle_text,
                "power": c.power,
                "toughness": c.toughness,
                "colors": c.colors,
                "image_uri": c.image_uri,
            }
            for c in top_cards
        ]

        self._log_action("scry", f"{player.name} scried {count}")
        return {"ok": True, "type": "scry_reveal", "cards": revealed}

    def _handle_scry_resolve(self, action: dict) -> dict:
        card_ids_top = action.get("card_ids_top", [])
        card_ids_bottom = action.get("card_ids_bottom", [])

        # Find the player index from any of the cards
        player_index = None
        for cid in card_ids_top + card_ids_bottom:
            card = self.state.cards.get(cid)
            if card:
                player_index = card.owner_index
                break

        if player_index is None:
            return {"ok": True}

        # Remove these cards from their current position and reinsert
        # We need to rebuild the library order
        all_scried_ids = set(card_ids_top + card_ids_bottom)
        library = self._library_cards(player_index)
        remaining = [c for c in library if c.id not in all_scried_ids]

        # Rebuild cards dict: non-library cards, then top scry cards, remaining library, bottom scry cards
        non_library = {
            cid: c for cid, c in self.state.cards.items()
            if not (c.zone == "library" and c.owner_index == player_index)
        }

        new_cards: Dict[str, CardState] = {}
        new_cards.update(non_library)
        # Top of library (scry top cards)
        for cid in card_ids_top:
            new_cards[cid] = self.state.cards[cid]
        # Remaining library
        for c in remaining:
            new_cards[c.id] = c
        # Bottom of library (scry bottom cards)
        for cid in card_ids_bottom:
            new_cards[cid] = self.state.cards[cid]

        self.state.cards = new_cards
        self._log_action("scry_resolve", f"Resolved scry: {len(card_ids_top)} to top, {len(card_ids_bottom)} to bottom")
        return {"ok": True}

    def _handle_search_library(self, action: dict) -> dict:
        player_index = action["player_index"]
        card_id = action.get("card_id")

        # If no card_id, return all library cards for the user to pick from
        if card_id is None:
            player = self._get_player(player_index)
            library = self._library_cards(player_index)
            cards_data = [
                {
                    "id": c.id,
                    "name": c.name,
                    "mana_cost": c.mana_cost,
                    "type_line": c.type_line,
                    "oracle_text": c.oracle_text,
                    "power": c.power,
                    "toughness": c.toughness,
                    "colors": c.colors,
                    "image_uri": c.image_uri,
                }
                for c in library
            ]
            return {"ok": True, "type": "search_reveal", "cards": cards_data}

        to_zone = action.get("to_zone", "hand")
        card = self._get_card(card_id)
        player = self._get_player(player_index)

        if card.zone != "library" or card.owner_index != player_index:
            raise ValueError(f"Card {card.name} is not in {player.name}'s library")

        # Handle library_top / library_bottom — card stays in library, reorder via dict
        if to_zone in ("library_bottom", "library_top"):
            pos_label = "top" if to_zone == "library_top" else "bottom"
            self._log_action("search_library", f"{player.name} put {card.name} on {pos_label} of library")

            # Separate non-library cards and remaining library cards
            remaining_lib = [c for c in self._library_cards(player_index) if c.id != card_id]
            remaining_ids = [c.id for c in remaining_lib]
            random.shuffle(remaining_ids)

            non_library = {
                cid: c for cid, c in self.state.cards.items()
                if not (c.zone == "library" and c.owner_index == player_index)
            }
            new_cards: Dict[str, CardState] = {}
            new_cards.update(non_library)

            if to_zone == "library_top":
                # Target card first (top), then shuffled rest
                new_cards[card_id] = self.state.cards[card_id]
                for cid in remaining_ids:
                    new_cards[cid] = self.state.cards[cid]
            else:
                # Shuffled rest first, then target card last (bottom)
                for cid in remaining_ids:
                    new_cards[cid] = self.state.cards[cid]
                new_cards[card_id] = self.state.cards[card_id]

            self.state.cards = new_cards
            return {"ok": True}

        self._move_to_zone(card, to_zone)
        card.controller_index = player_index

        self._log_action("search_library", f"{player.name} searched library for {card.name} -> {to_zone}")

        # Auto-shuffle after search
        library = self._library_cards(player_index)
        card_ids = [c.id for c in library]
        random.shuffle(card_ids)

        non_library = {
            cid: c for cid, c in self.state.cards.items()
            if not (c.zone == "library" and c.owner_index == player_index)
        }
        new_cards: Dict[str, CardState] = {}
        new_cards.update(non_library)
        for cid in card_ids:
            new_cards[cid] = self.state.cards[cid]
        self.state.cards = new_cards

        return {"ok": True}

    def _handle_mulligan(self, action: dict) -> dict:
        player_index = action["player_index"]
        player = self._get_player(player_index)

        # Move all hand cards back to library
        hand = self._hand_cards(player_index)
        for card in hand:
            self._move_to_zone(card, "library")

        # Shuffle library
        library = self._library_cards(player_index)
        card_ids = [c.id for c in library]
        random.shuffle(card_ids)

        non_library = {
            cid: c for cid, c in self.state.cards.items()
            if not (c.zone == "library" and c.owner_index == player_index)
        }
        new_cards: Dict[str, CardState] = {}
        new_cards.update(non_library)
        for cid in card_ids:
            new_cards[cid] = self.state.cards[cid]
        self.state.cards = new_cards

        # Draw 7 new cards
        library = self._library_cards(player_index)
        draw_count = min(7, len(library))
        for i in range(draw_count):
            self._move_to_zone(library[i], "hand")

        self._log_action("mulligan", f"{player.name} took a mulligan (drew 7 new cards)")
        return {"ok": True}

    def _handle_bottom_card(self, action: dict) -> dict:
        card_id = action["card_id"]
        card = self._get_card(card_id)

        if card.zone != "hand":
            raise ValueError(f"Card {card.name} is not in hand")

        # Move to bottom of library: remove from current position, re-add at end
        self._move_to_zone(card, "library")

        # Ensure it's at the bottom by rebuilding order
        other_cards = {cid: c for cid, c in self.state.cards.items() if cid != card_id}
        new_cards: Dict[str, CardState] = {}
        new_cards.update(other_cards)
        new_cards[card_id] = card
        self.state.cards = new_cards

        player = self._get_player(card.owner_index)
        self._log_action("bottom_card", f"{player.name} put {card.name} on the bottom of their library")
        return {"ok": True}

    def _handle_start_game(self, action: dict) -> dict:
        players_data = action["players_data"]
        starting_life = action.get("starting_life", 20)
        first_player_index = action.get("first_player_index", 0)

        # Archive current game before resetting
        self._archive_current_game()

        # Reset state completely
        self.state = GameState()
        self.undo_stack = []
        self.chat_log = []

        # Create players
        for pdata in players_data:
            player = PlayerState(
                name=pdata["name"],
                life=starting_life,
            )
            self.state.players.append(player)

        # Create cards from decklists
        for player_idx, pdata in enumerate(players_data):
            decklist = pdata.get("decklist", [])
            # Support both commander_names (list) and commander_name (single, backwards compat)
            commander_names = pdata.get("commander_names", [])
            if not commander_names and pdata.get("commander_name"):
                commander_names = [pdata["commander_name"]]
            commander_names_lower = [n.lower() for n in commander_names]

            for card_entry in decklist:
                count = card_entry.get("count", 1)
                scryfall_data = card_entry.get("scryfall_data", {})

                for _ in range(count):
                    card_id = str(uuid.uuid4())
                    is_commander = card_entry["name"].lower() in commander_names_lower if commander_names_lower else False

                    card = CardState(
                        id=card_id,
                        scryfall_id=scryfall_data.get("scryfall_id"),
                        name=card_entry["name"],
                        oracle_text=scryfall_data.get("oracle_text", ""),
                        mana_cost=scryfall_data.get("mana_cost", ""),
                        type_line=scryfall_data.get("type_line", ""),
                        power=scryfall_data.get("power"),
                        toughness=scryfall_data.get("toughness"),
                        loyalty=scryfall_data.get("loyalty"),
                        colors=scryfall_data.get("colors", []),
                        color_identity=scryfall_data.get("color_identity", []),
                        cmc=scryfall_data.get("cmc", 0),
                        image_uri=scryfall_data.get("image_uri"),
                        large_image_uri=scryfall_data.get("large_image_uri"),
                        zone="command_zone" if is_commander else "library",
                        owner_index=player_idx,
                        controller_index=player_idx,
                        is_commander=is_commander,
                        layout=scryfall_data.get("layout", "normal"),
                        back_face=scryfall_data.get("back_face"),
                        related_tokens=scryfall_data.get("related_tokens", []),
                        keywords=scryfall_data.get("keywords", []),
                    )
                    self.state.cards[card_id] = card

        # Initialize per-commander tax tracking
        for player_idx, player in enumerate(self.state.players):
            for card in self.state.cards.values():
                if card.is_commander and card.owner_index == player_idx:
                    player.commander_taxes[card.name] = 0

        # Shuffle libraries
        for player_idx in range(len(players_data)):
            library = self._library_cards(player_idx)
            card_ids = [c.id for c in library]
            random.shuffle(card_ids)

            non_library = {
                cid: c for cid, c in self.state.cards.items()
                if not (c.zone == "library" and c.owner_index == player_idx)
            }
            new_cards: Dict[str, CardState] = {}
            new_cards.update(non_library)
            for cid in card_ids:
                new_cards[cid] = self.state.cards[cid]
            self.state.cards = new_cards

        # Draw opening hands (7 cards each)
        for player_idx in range(len(players_data)):
            library = self._library_cards(player_idx)
            draw_count = min(7, len(library))
            for i in range(draw_count):
                self._move_to_zone(library[i], "hand")

        self.state.turn = 1
        self.state.phase = "untap"
        self.state.active_player_index = first_player_index
        self.state.first_player_index = first_player_index
        self.state.game_started = True

        self._log_action("start_game", "Game started!")
        return {"ok": True}

    def _handle_send_chat(self, action: dict) -> dict:
        message = action.get("message", "")
        sender = action.get("sender", "System")
        chat = ChatMessage(
            sender=sender,
            message=message,
            timestamp=datetime.now(timezone.utc).isoformat(),
        )
        self.chat_log.append(chat)
        # Keep chat log reasonable
        if len(self.chat_log) > 500:
            self.chat_log = self.chat_log[-500:]
        return {"ok": True, "type": "chat"}

    def _handle_undo(self, action: dict) -> dict:
        success = self.undo()
        if success:
            return {"ok": True, "type": "undo"}
        return {"ok": False, "error": "Nothing to undo"}

    def _handle_set_mana_pool(self, action: dict) -> dict:
        player_index = action["player_index"]
        mana_pool = action.get("mana_pool", "")
        player = self._get_player(player_index)
        player.mana_pool = mana_pool
        self._log_action("set_mana_pool", f"{player.name} set mana pool to: {mana_pool}")
        return {"ok": True}

    def _handle_set_commander_damage(self, action: dict) -> dict:
        player_index = action["player_index"]
        commander_id = action["commander_id"]
        damage = action["damage"]
        player = self._get_player(player_index)
        player.commander_damage_received[commander_id] = damage
        self._log_action("set_commander_damage", f"{player.name} received {damage} commander damage")
        return {"ok": True}

    def _handle_set_attacking(self, action: dict) -> dict:
        card = self._get_card(action["card_id"])
        card.attacking = action.get("attacking", not card.attacking)
        state_str = "attacking" if card.attacking else "not attacking"
        self._log_action("set_attacking", f"{card.name} is now {state_str}")
        return {"ok": True}

    def _handle_set_blocking(self, action: dict) -> dict:
        card = self._get_card(action["card_id"])
        card.blocking = action.get("blocking_id")
        if card.blocking:
            attacker = self.state.cards.get(card.blocking)
            attacker_name = attacker.name if attacker else "unknown"
            self._log_action("set_blocking", f"{card.name} is blocking {attacker_name}")
        else:
            self._log_action("set_blocking", f"{card.name} is no longer blocking")
        return {"ok": True}

    def _handle_set_face_down(self, action: dict) -> dict:
        card = self._get_card(action["card_id"])
        card.face_down = action.get("face_down", not card.face_down)
        if card.face_down:
            card.face_down_type = action.get("face_down_type", card.face_down_type)
        else:
            card.face_down_type = None
        state_str = "face down" if card.face_down else "face up"
        if card.face_down and card.face_down_type:
            state_str += f" ({card.face_down_type})"
        self._log_action("set_face_down", f"{card.name} turned {state_str}")
        return {"ok": True}

    def _handle_set_card_printing(self, action: dict) -> dict:
        new_scryfall_id = action.get("scryfall_id")
        new_image_uri = action.get("image_uri")
        new_large_image_uri = action.get("large_image_uri")

        # Update by card_name (all copies) or fall back to single card_id
        card_name = action.get("card_name")
        updated = []
        if card_name:
            for c in self.state.cards.values():
                if c.name.lower() == card_name.lower():
                    if new_scryfall_id:
                        c.scryfall_id = new_scryfall_id
                    if new_image_uri:
                        c.image_uri = new_image_uri
                    if new_large_image_uri:
                        c.large_image_uri = new_large_image_uri
                    updated.append(c.name)
        elif action.get("card_id"):
            card = self._get_card(action["card_id"])
            if new_scryfall_id:
                card.scryfall_id = new_scryfall_id
            if new_image_uri:
                card.image_uri = new_image_uri
            if new_large_image_uri:
                card.large_image_uri = new_large_image_uri
            updated.append(card.name)

        if updated:
            self._log_action("set_card_printing", f"Changed printing of {updated[0]} ({len(updated)} card(s))")
        return {"ok": True}

    # ------------------------------------------------------------------
    # Arrows (visual links between cards, optional +X/+X buff)
    # ------------------------------------------------------------------

    def _handle_create_arrow(self, action: dict) -> dict:
        source = self._get_card(action["source_card_id"])
        target = self._get_card(action["target_card_id"])
        arrow_id = str(uuid.uuid4())
        arrow = Arrow(
            id=arrow_id,
            source_card_id=source.id,
            target_card_id=target.id,
        )
        self.state.arrows.append(arrow)
        self._log_action("create_arrow", f"Arrow: {source.name} → {target.name}")
        return {"ok": True, "arrow_id": arrow_id}

    def _handle_remove_arrow(self, action: dict) -> dict:
        arrow_id = action["arrow_id"]
        arrow = next((a for a in self.state.arrows if a.id == arrow_id), None)
        if not arrow:
            return {"ok": False, "error": "Arrow not found"}
        had_buff = arrow.buff_power or arrow.buff_toughness
        target_id = arrow.target_card_id
        self.state.arrows = [a for a in self.state.arrows if a.id != arrow_id]
        if had_buff:
            target = self.state.cards.get(target_id)
            if target and target.zone == "battlefield":
                self._update_custom_pt_from_counters(target)
        self._log_action("remove_arrow", "Removed arrow")
        return {"ok": True}

    def _handle_update_arrow_buff(self, action: dict) -> dict:
        arrow_id = action["arrow_id"]
        arrow = next((a for a in self.state.arrows if a.id == arrow_id), None)
        if not arrow:
            return {"ok": False, "error": "Arrow not found"}
        buff_p = action.get("buff_power")
        buff_t = action.get("buff_toughness")
        arrow.buff_power = int(buff_p) if buff_p is not None else None
        arrow.buff_toughness = int(buff_t) if buff_t is not None else None
        # Recalc target P/T
        target = self.state.cards.get(arrow.target_card_id)
        if target and target.zone == "battlefield":
            self._update_custom_pt_from_counters(target)
        source = self.state.cards.get(arrow.source_card_id)
        src_name = source.name if source else "?"
        tgt_name = target.name if target else "?"
        if buff_p is not None:
            self._log_action("update_arrow_buff", f"Arrow {src_name} → {tgt_name}: +{buff_p}/+{buff_t}")
        else:
            self._log_action("update_arrow_buff", f"Arrow {src_name} → {tgt_name}: buff removed")
        return {"ok": True}

    def _remove_arrows_for_card(self, card_id: str) -> None:
        """Remove all arrows where this card is source or target, recalc P/T on affected targets."""
        affected_targets = set()
        remaining = []
        for a in self.state.arrows:
            if a.source_card_id == card_id or a.target_card_id == card_id:
                if a.buff_power or a.buff_toughness:
                    affected_targets.add(a.target_card_id)
            else:
                remaining.append(a)
        self.state.arrows = remaining
        for tid in affected_targets:
            if tid == card_id:
                continue  # The card leaving doesn't need recalc
            target = self.state.cards.get(tid)
            if target and target.zone == "battlefield":
                self._update_custom_pt_from_counters(target)
