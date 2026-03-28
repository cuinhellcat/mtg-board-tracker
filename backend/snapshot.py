"""
Board state snapshot generator.
Produces clean, machine-readable text exports of the current board state,
optimized for LLM consumption.
"""

import re
from typing import Dict, List, Optional, Tuple

from backend.game_engine import PHASE_DISPLAY_NAMES
from backend.models import CardState, GameState

# Basic land names for grouping
BASIC_LANDS = {"Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes",
               "Snow-Covered Plains", "Snow-Covered Island", "Snow-Covered Swamp",
               "Snow-Covered Mountain", "Snow-Covered Forest"}

# Regex: matches simple unconditional "{T}: Add {X}" or "{T}: Add {X} or {Y}" etc.
_SIMPLE_MANA_RE = re.compile(
    r"\{T\}: [Aa]dd (\{[WUBRGC]\}(?:\s*(?:or|,)\s*\{[WUBRGC]\})*)\."
)


def generate_snapshot(game_state: GameState, action_log: list, notes: str = "", recent_actions_count: int = 1, force_all_oracle: bool = False) -> str:
    """
    Generate a board state snapshot from the LLM player's perspective.

    Convention: player index 1 is the LLM, player index 0 is the human.

    Principles:
    - Only mention deviations from defaults (untapped is default, so not annotated)
    - Standard exile is NOT included
    - Linked exile IS included (shown under parent card)
    - Attached cards (Auras/Equipment) are shown under parent card
    - Cards with show_oracle_text flag include oracle text even in brief format
    - LLM sees full hand with oracle text; human hand is hidden (count only)
    - Group identical basic lands
    """
    if len(game_state.players) < 2:
        return "=== No game in progress ==="

    # Temporarily force oracle text on all cards if requested
    original_oracle_flags: dict = {}
    if force_all_oracle:
        for cid, card in game_state.cards.items():
            original_oracle_flags[cid] = card.show_oracle_text
            card.show_oracle_text = True

    try:
        return _generate_snapshot_inner(game_state, action_log, notes, recent_actions_count)
    finally:
        # Restore original flags
        for cid, orig in original_oracle_flags.items():
            if cid in game_state.cards:
                game_state.cards[cid].show_oracle_text = orig


def _generate_snapshot_inner(game_state: GameState, action_log: list, notes: str, recent_actions_count: int) -> str:
    llm_index = 1
    human_index = 0
    llm_player = game_state.players[llm_index]
    human_player = game_state.players[human_index]

    # Determine active player label
    active_name = game_state.players[game_state.active_player_index].name
    if game_state.active_player_index == llm_index:
        active_label = f"{active_name} (You)"
    else:
        active_label = f"{active_name} (Opponent)"

    # Calculate whose Nth turn this is (tournament-style)
    # Turn 1 belongs to first_player, Turn 2 to the other, Turn 3 to first again, etc.
    active_idx = game_state.active_player_index
    first_idx = game_state.first_player_index
    if active_idx == first_idx:
        player_turn_num = (game_state.turn + 1) // 2
    else:
        player_turn_num = game_state.turn // 2

    ordinals = {1: "1st", 2: "2nd", 3: "3rd"}
    ordinal = ordinals.get(player_turn_num, f"{player_turn_num}th")
    turn_detail = f"Turn {game_state.turn} ({active_name}'s {ordinal})"

    phase_display = PHASE_DISPLAY_NAMES.get(game_state.phase, game_state.phase)

    lines = []
    lines.append("=== MTG DUEL COMMANDER -- BOARD STATE ===")
    lines.append(f"{turn_detail} | Phase: {phase_display} | Active Player: {active_label}")
    lines.append("")

    # --- YOUR STATUS (LLM) ---
    lines.append(f"--- YOUR STATUS ({llm_player.name}) ---")
    lines.append(f"Life: {llm_player.life}")
    for cmd_name, cmd_tax in llm_player.commander_taxes.items():
        if cmd_tax > 0:
            if len(llm_player.commander_taxes) > 1:
                lines.append(f"Commander Tax ({cmd_name}): {cmd_tax}")
            else:
                lines.append(f"Commander Tax: {cmd_tax}")
    for cname, cval in llm_player.extra_counters.items():
        if cval > 0:
            lines.append(f"{cname}: {cval}")
    lines.append("")

    # LLM Hand (full detail)
    llm_hand = _get_zone_cards(game_state, llm_index, "hand")
    lines.append(f"Hand ({len(llm_hand)} cards):")
    if llm_hand:
        for card in llm_hand:
            lines.append(f"  - {_format_card_full(card)}")
    else:
        lines.append("  (empty)")
    lines.append("")

    # LLM Battlefield
    llm_battlefield = _get_zone_cards(game_state, llm_index, "battlefield", controller=True)
    lines.append("Battlefield:")
    if llm_battlefield:
        _render_battlefield_grouped(llm_battlefield, game_state, lines, is_own=True)
    else:
        lines.append("  (empty)")
    lines.append("")

    # LLM Graveyard
    llm_graveyard = _get_zone_cards(game_state, llm_index, "graveyard")
    lines.append("Graveyard:")
    if llm_graveyard:
        for card in llm_graveyard:
            lines.append(f"  - {_format_card_brief(card)}")
    else:
        lines.append("  (empty)")
    lines.append("")

    # LLM Command Zone
    llm_command = _get_zone_cards(game_state, llm_index, "command_zone")
    if llm_command:
        lines.append("Command Zone:")
        for card in llm_command:
            cmd_tax = llm_player.commander_taxes.get(card.name, 0)
            cast_count = cmd_tax // 2
            cast_note = f" (cast {cast_count}x, tax {cmd_tax})" if cast_count > 0 else ""
            lines.append(f"  - {_format_card_brief(card)}{cast_note}")
        lines.append("")

    # --- OPPONENT STATUS (Human) ---
    lines.append(f"--- OPPONENT STATUS ({human_player.name}) ---")
    lines.append(f"Life: {human_player.life}")
    for cmd_name, cmd_tax in human_player.commander_taxes.items():
        if cmd_tax > 0:
            if len(human_player.commander_taxes) > 1:
                lines.append(f"Commander Tax ({cmd_name}): {cmd_tax}")
            else:
                lines.append(f"Commander Tax: {cmd_tax}")
    for cname, cval in human_player.extra_counters.items():
        if cval > 0:
            lines.append(f"{cname}: {cval}")
    lines.append("")

    # Human Hand (hidden)
    human_hand = _get_zone_cards(game_state, human_index, "hand")
    lines.append(f"Hand: {len(human_hand)} cards (hidden)")
    lines.append("")

    # Human Battlefield
    human_battlefield = _get_zone_cards(game_state, human_index, "battlefield", controller=True)
    lines.append("Battlefield:")
    if human_battlefield:
        _render_battlefield_grouped(human_battlefield, game_state, lines, is_own=False)
    else:
        lines.append("  (empty)")
    lines.append("")

    # Human Graveyard (with oracle text for LLM context)
    human_graveyard = _get_zone_cards(game_state, human_index, "graveyard")
    lines.append("Graveyard:")
    if human_graveyard:
        for card in human_graveyard:
            lines.append(f"  - {_format_card_full(card)}")
    else:
        lines.append("  (empty)")
    lines.append("")

    # Human Command Zone
    human_command = _get_zone_cards(game_state, human_index, "command_zone")
    if human_command:
        lines.append("Command Zone:")
        for card in human_command:
            cmd_tax = human_player.commander_taxes.get(card.name, 0)
            cast_count = cmd_tax // 2
            cast_note = f" (cast {cast_count}x, tax {cmd_tax})" if cast_count > 0 else ""
            lines.append(f"  - {_format_card_brief(card)}{cast_note}")
        lines.append("")

    # --- STACK (shared zone) ---
    stack_cards = [c for c in game_state.cards.values() if c.zone == "stack"]
    stack_cards.sort(key=lambda c: c.zone_moved_at, reverse=True)
    if stack_cards:
        lines.append("=== STACK ===")
        for card in stack_cards:
            owner = game_state.players[card.controller_index].name if card.controller_index < len(game_state.players) else "?"
            lines.append(f"  - {_format_card_brief(card)} (cast by {owner})")
        lines.append("")

    # --- RECENT ACTIONS ---
    if action_log and recent_actions_count > 0:
        recent = action_log[-recent_actions_count:]
        label = f"last {len(recent)}" if len(recent) > 1 else "last"
        lines.append(f"=== RECENT ACTIONS ({label}) ===")
        for entry in recent:
            desc = entry.get("description", "") if isinstance(entry, dict) else entry.description
            lines.append(desc)
        lines.append("")

    # --- ADDITIONAL NOTES ---
    if notes and notes.strip():
        lines.append("=== ADDITIONAL NOTES ===")
        lines.append(notes.strip())
        lines.append("")

    return "\n".join(lines)


def _get_zone_cards(
    game_state: GameState,
    player_index: int,
    zone: str,
    controller: bool = False,
) -> List[CardState]:
    """
    Get cards in a zone for a player.
    If controller=True, match by controller_index; otherwise by owner_index.
    """
    cards = []
    for card in game_state.cards.values():
        if card.zone != zone:
            continue
        if controller:
            if card.controller_index == player_index:
                cards.append(card)
        else:
            if card.owner_index == player_index:
                cards.append(card)
    return cards


def _format_card_full(card: CardState) -> str:
    """
    Format a card with full detail: Name {ManaCost} [TypeLine] (counters) -- OracleText -- TAPPED
    """
    prefix = f"{card.quantity}x " if card.quantity > 1 else ""
    parts = [prefix + card.name]

    if card.mana_cost:
        parts.append(card.mana_cost)

    # Skip type line for basic lands — the LLM knows what they are
    if card.type_line and card.name not in BASIC_LANDS:
        parts.append(f"[{card.type_line}]")

    # Power/toughness for creatures
    if card.power is not None and card.toughness is not None:
        parts.append(f"({card.power}/{card.toughness})")

    # Loyalty for planeswalkers
    if card.loyalty is not None:
        parts.append(f"(Loyalty: {card.loyalty})")

    # Counters — verbose format: "Counters: 3x +1/+1, Flying"
    if card.counters:
        counter_strs = []
        for ctype, count in card.counters.items():
            counter_strs.append(f"{count}x {ctype}")
        parts.append(f"(Counters: {', '.join(counter_strs)})")

    # Oracle text — only when explicitly flagged per card
    if card.show_oracle_text and card.oracle_text:
        oracle = card.oracle_text.replace("\n", " / ")
        parts.append(f"-- {oracle}")

    # User note — always shown, appears like oracle text
    if card.note:
        parts.append(f"-- NOTE: {card.note}")

    # State annotations (only deviations from default)
    annotations = []
    if card.tapped:
        annotations.append("TAPPED")
    if card.face_down:
        annotations.append("FACE DOWN")
    if card.attacking:
        annotations.append("ATTACKING")
    if card.blocking:
        annotations.append("BLOCKING")

    if annotations:
        parts.append("-- " + ", ".join(annotations))

    return " ".join(parts)


def _format_card_brief(card: CardState) -> str:
    """Format a card briefly: Name {ManaCost} [TypeLine]. Includes oracle text if show_oracle_text is enabled."""
    prefix = f"{card.quantity}x " if card.quantity > 1 else ""
    parts = [prefix + card.name]

    if card.mana_cost:
        parts.append(card.mana_cost)

    # Skip type line for basic lands
    if card.type_line and card.name not in BASIC_LANDS:
        parts.append(f"[{card.type_line}]")

    if card.power is not None and card.toughness is not None:
        parts.append(f"({card.power}/{card.toughness})")

    if card.counters:
        counter_strs = []
        for ctype, count in card.counters.items():
            counter_strs.append(f"{count}x {ctype}")
        parts.append(f"(Counters: {', '.join(counter_strs)})")

    # Include oracle text when explicitly flagged
    if card.show_oracle_text and card.oracle_text:
        oracle = card.oracle_text.replace("\n", " / ")
        parts.append(f"-- {oracle}")

    # User note
    if card.note:
        parts.append(f"-- NOTE: {card.note}")

    return " ".join(parts)


def _extract_simple_mana(card: CardState) -> Optional[str]:
    """
    Extract mana production from a non-basic land if it's a simple,
    unconditional tap ability.  Returns e.g. "{B}/{G}" or None.
    Basic lands return None (the LLM knows what they do).
    """
    if card.name in BASIC_LANDS or not card.oracle_text:
        return None
    matches = _SIMPLE_MANA_RE.findall(card.oracle_text)
    if not matches:
        return None
    # If multiple tap abilities, pick the one with most colored symbols
    best_symbols: List[str] = []
    for raw in matches:
        symbols = re.findall(r"\{[WUBRGC]\}", raw)
        if len(symbols) > len(best_symbols):
            best_symbols = symbols
    if not best_symbols:
        return None
    return "/".join(best_symbols)


_FACE_DOWN_LABELS = {
    "morph": "Morph creature 2/2",
    "manifest": "Manifest creature 2/2",
    "cloaked": "Cloaked creature 2/2 (ward 2)",
}


def _format_card_perspective(card: CardState, is_own: bool) -> Optional[str]:
    """
    Return a special string for face-down / transformed cards, or None for normal rendering.

    Face-down:
      - Own cards: full name + "(face down as Morph 2/2)" hint
      - Opponent cards: just "Morph creature 2/2" — no name revealed
    Transformed:
      - Use back_face data for rendering
    """
    if card.face_down:
        fd_label = _FACE_DOWN_LABELS.get(card.face_down_type, "Face-down Card")
        if is_own:
            return f"{card.name} (face down as {fd_label})"
        else:
            return fd_label
    return None


def _get_display_card(card: CardState) -> CardState:
    """Return a card with transformed display values applied (if transformed)."""
    if not card.transformed or not card.back_face:
        return card
    bf = card.back_face
    # Create a shallow copy with back-face values overlaid
    display = card.model_copy()
    display.name = bf.get("name", card.name)
    display.oracle_text = bf.get("oracle_text", "")
    display.mana_cost = bf.get("mana_cost", "")
    display.type_line = bf.get("type_line", "")
    display.power = bf.get("power")
    display.toughness = bf.get("toughness")
    display.loyalty = bf.get("loyalty")
    return display


def _classify_card(card: CardState) -> str:
    """Classify a card into 'land', 'creature', or 'other' by type line."""
    type_line = card.type_line or ""
    if "Creature" in type_line:
        return "creature"
    if "Land" in type_line:
        return "land"
    return "other"


def _render_battlefield_grouped(
    cards: List[CardState], game_state: GameState, lines: List[str],
    is_own: bool = True,
) -> None:
    """
    Render battlefield cards with light type grouping.
    No subzone distinction — just visual grouping for readability.
    Lands are shown compactly (basic lands grouped), others get full detail.
    is_own: True for LLM's own cards, False for opponent's.
    """
    # Apply transform display + separate face-down cards
    # Skip cards that are attached to another card (they render under parent)
    display_cards = []
    face_down_lines = []
    creature_fd_lines = []
    for c in cards:
        if c.attached_to:
            continue
        fd_text = _format_card_perspective(c, is_own)
        if fd_text:
            if c.face_down_type in ("morph", "manifest", "cloaked"):
                creature_fd_lines.append(f"    - {fd_text}")
            else:
                face_down_lines.append(f"    - {fd_text}")
        else:
            display_cards.append(_get_display_card(c))

    lands = [c for c in display_cards if _classify_card(c) == "land"]
    creatures = [c for c in display_cards if _classify_card(c) == "creature"]
    others = [c for c in display_cards if _classify_card(c) == "other"]

    if lands:
        grouped = _group_basic_lands(lands)
        land_strs = []
        land_linked_lines = []
        for item in grouped:
            if isinstance(item, str):
                # Grouped basic lands (e.g. "Swamp x3")
                land_strs.append(item)
            else:
                text = item.name
                mana = _extract_simple_mana(item)
                if mana:
                    text += f" ({mana})"
                if item.tapped:
                    text += " TAPPED"
                land_strs.append(text)
                for linked_id in item.linked_exile_cards:
                    linked = game_state.cards.get(linked_id)
                    if linked:
                        linked_label = "face-down card" if linked.face_down else linked.name
                        land_linked_lines.append(
                            f"    ({item.name} holds in exile: {linked_label})"
                        )
                for att_id in item.attached_cards:
                    att = game_state.cards.get(att_id)
                    if att:
                        land_linked_lines.append(
                            f"    ({item.name} enchanted by: {att.name})"
                        )
        lines.append(f"  Lands: {', '.join(land_strs)}")
        lines.extend(land_linked_lines)

    if creatures or creature_fd_lines:
        lines.append("  Creatures:")
        for card in creatures:
            lines.append(f"    - {_format_card_full(card)}")
            for linked_id in card.linked_exile_cards:
                linked = game_state.cards.get(linked_id)
                if linked:
                    linked_label = "face-down card" if linked.face_down else linked.name
                    lines.append(f"      -> holds in exile: {linked_label}")
            _render_attached_cards(card, game_state, lines)
        lines.extend(creature_fd_lines)

    if others:
        lines.append("  Other Permanents:")
        for card in others:
            lines.append(f"    - {_format_card_full(card)}")
            for linked_id in card.linked_exile_cards:
                linked = game_state.cards.get(linked_id)
                if linked:
                    linked_label = "face-down card" if linked.face_down else linked.name
                    lines.append(f"      -> holds in exile: {linked_label}")
            _render_attached_cards(card, game_state, lines)

    if face_down_lines:
        lines.append("  Face Down:")
        lines.extend(face_down_lines)


def _render_attached_cards(
    card: CardState, game_state: GameState, lines: List[str],
) -> None:
    """Render attached Auras/Equipment under a parent card."""
    if not card.attached_cards:
        return
    att_names = []
    for att_id in card.attached_cards:
        att = game_state.cards.get(att_id)
        if att:
            att_display = _get_display_card(att)
            att_names.append(_format_card_brief(att_display))
    if att_names:
        lines.append(f"      -> attached: {', '.join(att_names)}")


def _group_basic_lands(cards: List[CardState]) -> list:
    """
    Group identical basic lands for compact display.
    Returns a mixed list: strings for grouped lands, CardState for non-basics.
    Example: "Island x4 (1 tapped)"
    """
    # Separate basic lands from non-basics
    basic_groups: Dict[str, List[CardState]] = {}
    non_basics: List[CardState] = []

    for card in cards:
        if card.name in BASIC_LANDS and not card.counters and not card.linked_exile_cards and not card.attached_cards:
            if card.name not in basic_groups:
                basic_groups[card.name] = []
            basic_groups[card.name].append(card)
        else:
            non_basics.append(card)

    result: list = []

    # Add grouped basics
    for land_name, land_cards in sorted(basic_groups.items()):
        count = len(land_cards)
        tapped_count = sum(1 for c in land_cards if c.tapped)

        if count == 1:
            # Single basic land, show normally
            result.append(land_cards[0])
        else:
            # Grouped display
            if tapped_count == 0:
                result.append(f"{land_name} x{count}")
            elif tapped_count == count:
                result.append(f"{land_name} x{count} (all tapped)")
            else:
                result.append(f"{land_name} x{count} ({tapped_count} tapped)")

    # Add non-basics
    result.extend(non_basics)

    return result


def generate_bot_hand(game_state: GameState, force_all_oracle: bool = False) -> str:
    """Generate a text snippet of the bot's (LLM, player index 1) hand cards."""
    if len(game_state.players) < 2:
        return "(No game in progress)"

    llm_index = 1
    llm_player = game_state.players[llm_index]
    hand_cards = _get_zone_cards(game_state, llm_index, "hand")

    lines = [f"{llm_player.name}'s Hand ({len(hand_cards)} cards):"]
    if hand_cards:
        for card in hand_cards:
            show = force_all_oracle or card.show_oracle_text
            orig = card.show_oracle_text
            card.show_oracle_text = show
            lines.append(f"  - {_format_card_full(card)}")
            card.show_oracle_text = orig
    else:
        lines.append("  (empty)")

    return "\n".join(lines)
