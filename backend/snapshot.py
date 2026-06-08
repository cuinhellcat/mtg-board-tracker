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

# Cards whose oracle text is trivial / universally known — skip in snapshot
ORACLE_SKIP = BASIC_LANDS | {
    # Standard artifact tokens
    "Treasure", "Food", "Clue", "Blood", "Gold",
    "Map", "Powerstone", "Junk", "Shard", "Incubator",
    # Universally known lands
    "Command Tower", "Exotic Orchard", "Path of Ancestry",
    "Mana Confluence", "City of Brass", "Reflecting Pool",
    "Evolving Wilds", "Terramorphic Expanse", "Fabled Passage", "Prismatic Vista",
    "Reliquary Tower",
    # Universally known artifacts
    "Arcane Signet", "Sol Ring",
}

# Regex: matches simple unconditional "{T}: Add {X}" or "{T}: Add {X} or {Y}" etc.
_SIMPLE_MANA_RE = re.compile(
    r"\{T\}: [Aa]dd (\{[WUBRGC]\}(?:\s*(?:or|,)\s*\{[WUBRGC]\})*)\."
)

# Regex: matches reminder text in parentheses — e.g. "(A Food token is an artifact ...)"
_REMINDER_RE = re.compile(r"\s*\([^()]*\)")

# Current oracle mode for snapshot rendering (set per-request)
_oracle_mode = "off"

# Perspective player index for this snapshot run (set per-request) — used to
# label commanders from the active player's point of view ("dein" vs "Gegner").
_perspective_index = 0


def _commander_tag(card: CardState) -> str:
    """Return a prominent commander annotation, perspective-aware."""
    if not card.is_commander:
        return ""
    if card.owner_index == _perspective_index:
        return " *** Diese Karte ist dein Commander ***"
    return " *** Diese Karte ist der Commander eines Gegners ***"


def _strip_reminder_text(text: str) -> str:
    """Remove reminder text (parenthesised clauses) from oracle text."""
    return _REMINDER_RE.sub("", text).strip()


def generate_snapshot(game_state: GameState, action_log: list, notes: str = "", recent_actions_count: int = 1, oracle_mode: str = "off", number_hand: bool = False, perspective_index: Optional[int] = None) -> str:
    """
    Generate a board state snapshot from the LLM player's perspective.

    oracle_mode: "off" (per-card flags only), "reduced" (all oracle minus
    reminder text & trivial cards), "full" (all oracle text verbatim).
    number_hand: if True, prefix each LLM hand card with "Handkarte1:", etc.

    Convention: player index 1 is the LLM, player index 0 is the human.
    """
    global _oracle_mode
    if len(game_state.players) < 2:
        return "=== No game in progress ==="

    _oracle_mode = oracle_mode

    # In reduced/full mode, temporarily force oracle text on all cards
    original_oracle_flags: dict = {}
    if oracle_mode in ("reduced", "full"):
        for cid, card in game_state.cards.items():
            original_oracle_flags[cid] = card.show_oracle_text
            card.show_oracle_text = True

    try:
        return _generate_snapshot_inner(game_state, action_log, notes, recent_actions_count, number_hand, perspective_index)
    finally:
        _oracle_mode = "off"
        # Restore original flags
        for cid, orig in original_oracle_flags.items():
            if cid in game_state.cards:
                game_state.cards[cid].show_oracle_text = orig


def build_board_prompt(game_state: GameState, action_log: list, perspective_index: int,
                       oracle_mode: str = "off", recent_actions_count: int = 1,
                       number_hand: bool = False, notes: str = "", clutter: str = "",
                       hand_note: str = "") -> str:
    """Assemble the full board prompt for a given perspective.

    Mirrors the frontend's buildPromptText(): snapshot (no notes) + INSTRUCTIONS
    (clutter) + HAND NOTE (when hands are numbered/hidden) + ADDITIONAL NOTES.
    Used server-side for LLM conversations so the partner's perspective is correct.
    """
    text = generate_snapshot(
        game_state, action_log, notes="", recent_actions_count=recent_actions_count,
        oracle_mode=oracle_mode, number_hand=number_hand, perspective_index=perspective_index,
    )
    if clutter and clutter.strip():
        text += "\n\n=== INSTRUCTIONS ===\n" + clutter.strip()
    if number_hand and hand_note and hand_note.strip():
        text += "\n\n=== HAND NOTE ===\n" + hand_note.strip()
    if notes and notes.strip():
        text += "\n\n=== ADDITIONAL NOTES ===\n" + notes.strip()
    return text


def _role_block(human_name: str, play_mode: str) -> str:
    """Build the opening role/instruction text, varied by play mode.

    competitive: ruthless, play to win (default).
    casual:      kitchen-table — focus the real threat, deals allowed.
    playtest:    only attack the human if the human is clearly the biggest threat.
    """
    base = (
        "Deine Rolle: Du bist ein Magic-Spieler in einer Commanderrunde. "
        "Verhalte dich exakt wie ein Spieler in einer Commander-Runde. "
        "Nenne deinen Spielzug mit allen nötigen Infos, lasse überflüssige Informationen weg. "
        "Erkläre nicht warum du es tust. "
        f"{human_name}, einer deiner Gegner, legt alle Karten. "
        "Er benötigt nur Informationen darüber was du tust, nicht was deine Pläne sind."
    )
    if play_mode == "casual":
        base += (
            " Spielstil: Dies ist eine lockere Küchentisch-Runde. Bewerte, wer der größte "
            "Threat ist, und richte deine Aggression vor allem dorthin — mach harmlose Spieler "
            "nicht einfach platt, nur weil es gerade möglich ist. Politik gehört dazu: Du darfst "
            "Absprachen und Deals vorschlagen, annehmen und einhalten "
            "(z. B. \"Ich greife dich diese Runde nicht an, wenn ...\"). Ein faires, "
            "unterhaltsames Spiel ist dir wichtiger als die maximale Gewinnchance."
        )
    elif play_mode == "playtest":
        base += (
            f" Spielmodus PLAYTEST: {human_name} testet gerade sein Deck. Greife {human_name} "
            f"NUR an, wenn {human_name} eindeutig der mit Abstand größte Threat am Tisch ist. "
            f"Andernfalls greife {human_name} unter keinen Umständen an und ziele auch mit "
            f"Removal/Effekten nicht auf ihn. Richte Angriffe stattdessen gegen die anderen "
            "Bots und spiele ansonsten ganz normal und sinnvoll."
        )
    return base


def _generate_snapshot_inner(game_state: GameState, action_log: list, notes: str, recent_actions_count: int, number_hand: bool = False, perspective_index: Optional[int] = None) -> str:
    global _perspective_index
    player_count = len(game_state.players)
    active_idx = game_state.active_player_index
    # Perspective = whose board/hand this is ("you"). Defaults to the active
    # player, but can be any player (e.g. asking Emma during Lexi's turn).
    if perspective_index is None:
        perspective_index = active_idx
    _perspective_index = perspective_index

    def _eliminated(i: int) -> bool:
        return getattr(game_state.players[i], "eliminated", False)

    perspective_name = game_state.players[perspective_index].name
    active_name = game_state.players[active_idx].name
    # Opponents shown = everyone else who is still in the game.
    opp_indices = [i for i in range(player_count) if i != perspective_index and not _eliminated(i)]
    eliminated_names = [game_state.players[i].name for i in range(player_count)
                        if i != perspective_index and _eliminated(i)]

    # "Active Player" shows the real active player; mark "(You)" only when that
    # is also the perspective player.
    active_label = f"{active_name} (You)" if active_idx == perspective_index else active_name

    # Calculate whose Nth turn this is. Players rotate in seating order, so the
    # active player's personal turn number is (turn - 1) // player_count + 1.
    pc = player_count or 1
    player_turn_num = (game_state.turn - 1) // pc + 1
    ordinals = {1: "1st", 2: "2nd", 3: "3rd"}
    ordinal = ordinals.get(player_turn_num, f"{player_turn_num}th")
    turn_detail = f"Turn {game_state.turn} ({active_name}'s {ordinal})"

    phase_display = PHASE_DISPLAY_NAMES.get(game_state.phase, game_state.phase)

    lines = []
    opp_names = [game_state.players[i].name for i in opp_indices]
    human_name = game_state.players[0].name if game_state.players else "Andre"

    # 1) Role / instruction block first — sharpened for weaker LLMs; varies by mode.
    play_mode = getattr(game_state, "play_mode", "competitive")
    lines.append(_role_block(human_name, play_mode))
    lines.append("")

    # 2) Who you are / who you play against.
    if opp_names:
        lines.append(
            f"Du bist {perspective_name} und spielst gegen {_join_names_de(opp_names)}."
        )
        lines.append("")

    # 3) Then the heading + turn/phase line.
    format_title = game_state.format.upper() if hasattr(game_state, "format") else "COMMANDER"
    lines.append(f"=== MTG {format_title} -- BOARD STATE ===")
    lines.append(f"{turn_detail} | Phase: {phase_display} | Active Player: {active_label}")
    # Turn order around the table, starting with the active player — alive only.
    turn_order = [game_state.players[(active_idx + i) % player_count].name
                  for i in range(player_count)
                  if not _eliminated((active_idx + i) % player_count)]
    lines.append("Zugreihenfolge: " + " → ".join(turn_order))
    if eliminated_names:
        lines.append(f"Ausgeschieden (hat das Spiel verloren): {_join_names_de(eliminated_names)}.")
    lines.append("")

    # --- Perspective player's own board (full detail) ---
    _render_self_section(game_state, lines, perspective_index, number_hand)

    # --- Opponents (public info only; hands as counts) ---
    for opp_idx in opp_indices:
        _render_opponent_section(game_state, lines, opp_idx)

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


def _join_names_de(names: List[str]) -> str:
    """Join names as German enumeration: 'A', 'A und B', 'A, B und C'."""
    if not names:
        return ""
    if len(names) == 1:
        return names[0]
    return ", ".join(names[:-1]) + " und " + names[-1]


def _render_player_status(player, lines: List[str]) -> None:
    """Append Life / Commander Tax / extra counters for a player, then a blank line."""
    lines.append(f"Life: {player.life}")
    for cmd_name, cmd_tax in player.commander_taxes.items():
        if cmd_tax > 0:
            if len(player.commander_taxes) > 1:
                lines.append(f"Commander Tax ({cmd_name}): {cmd_tax}")
            else:
                lines.append(f"Commander Tax: {cmd_tax}")
    for cname, cval in player.extra_counters.items():
        if cval > 0:
            lines.append(f"{cname}: {cval}")
    lines.append("")


def _render_command_zone(game_state: GameState, lines: List[str], player, player_index: int) -> None:
    """Append the Command Zone block (with per-commander cast/tax note) if non-empty."""
    cards = _get_zone_cards(game_state, player_index, "command_zone")
    if not cards:
        return
    lines.append("Command Zone:")
    for card in cards:
        cmd_tax = player.commander_taxes.get(card.name, 0)
        cast_count = cmd_tax // 2
        cast_note = f" (cast {cast_count}x, tax {cmd_tax})" if cast_count > 0 else ""
        lines.append(f"  - {_format_card_brief(card)}{cast_note}")
    lines.append("")


def _render_self_section(game_state: GameState, lines: List[str], index: int, number_hand: bool) -> None:
    """Render the active player's own board: hand (full), battlefield, graveyard, command zone."""
    player = game_state.players[index]
    lines.append(f"--- YOUR STATUS ({player.name}) ---")
    _render_player_status(player, lines)

    # Hand — full detail, with optional stable "Handkarte N" numbering
    hand = _get_zone_cards(game_state, index, "hand")
    lines.append(f"Hand ({len(hand)} cards):")
    if hand:
        # Each player has its own frozen order (stable within a turn). LOCAL copy
        # — never mutate game_state. Fall back to live order if none frozen yet.
        frozen = game_state.frozen_hand_orders.get(index)
        order = list(frozen) if frozen else [c.id for c in hand]
        for card in hand:
            if number_hand:
                if card.id not in order:
                    order.append(card.id)
                num = order.index(card.id) + 1
                prefix = f"Handkarte{num}: "
            else:
                prefix = ""
            lines.append(f"  - {prefix}{_format_card_full(card)}{_format_back_face(card)}")
    else:
        lines.append("  (empty)")
    lines.append("")

    # Battlefield (own — reveals face-down cards)
    battlefield = _get_zone_cards(game_state, index, "battlefield", controller=True)
    lines.append("Battlefield:")
    if battlefield:
        _render_battlefield_grouped(battlefield, game_state, lines, is_own=True)
    else:
        lines.append("  (empty)")
    lines.append("")

    # Graveyard (own — brief)
    graveyard = _get_zone_cards(game_state, index, "graveyard")
    lines.append("Graveyard:")
    if graveyard:
        for card in graveyard:
            lines.append(f"  - {_format_card_brief(card)}{_format_back_face(card)}")
    else:
        lines.append("  (empty)")
    lines.append("")

    _render_command_zone(game_state, lines, player, index)


def _render_opponent_section(game_state: GameState, lines: List[str], index: int) -> None:
    """Render an opponent's public board: hand as count only, battlefield + graveyard visible."""
    player = game_state.players[index]
    lines.append(f"--- OPPONENT: {player.name} ---")
    _render_player_status(player, lines)

    # Hand hidden — count only
    hand = _get_zone_cards(game_state, index, "hand")
    lines.append(f"Hand: {len(hand)} cards (hidden)")
    lines.append("")

    # Battlefield (public — face-down cards stay hidden via is_own=False)
    battlefield = _get_zone_cards(game_state, index, "battlefield", controller=True)
    lines.append("Battlefield:")
    if battlefield:
        _render_battlefield_grouped(battlefield, game_state, lines, is_own=False)
    else:
        lines.append("  (empty)")
    lines.append("")

    # Graveyard (public — full detail for context)
    graveyard = _get_zone_cards(game_state, index, "graveyard")
    lines.append("Graveyard:")
    if graveyard:
        for card in graveyard:
            lines.append(f"  - {_format_card_full(card)}{_format_back_face(card)}")
    else:
        lines.append("  (empty)")
    lines.append("")

    _render_command_zone(game_state, lines, player, index)


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
    # Sort by zone_moved_at to match frontend ordering
    cards.sort(key=lambda c: c.zone_moved_at or 0)
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
    if card.custom_power is not None and card.custom_toughness is not None:
        if card.power is not None and card.toughness is not None:
            parts.append(f"(including counters and pumps: {card.custom_power}/{card.custom_toughness})")
        else:
            # Non-creature turned creature via a manual P/T badge
            parts.append(f"({card.custom_power}/{card.custom_toughness})")
    elif card.power is not None and card.toughness is not None:
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

    # Oracle text — honours the oracle mode/flag
    oracle = _oracle_for_card(card)
    if oracle:
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

    result = " ".join(parts)
    return result + _commander_tag(card)


def _format_back_face(card: CardState) -> str:
    """Format back-face info for MDFCs and split/aftermath cards.
    Returns empty string if card has no back face or layout doesn't warrant it."""
    if card.layout not in ("modal_dfc", "split", "aftermath") or not card.back_face:
        return ""
    bf = card.back_face
    bf_name = bf.get("name", "")
    if not bf_name:
        return ""
    bf_parts = [bf_name]
    bf_type = bf.get("type_line", "")
    if bf_type:
        bf_parts.append(f"[{bf_type}]")
    bf_oracle = bf.get("oracle_text", "")
    if bf_oracle:
        bf_oracle = bf_oracle.replace("\n", " / ")
        if _oracle_mode == "reduced":
            skip = bf_name in ORACLE_SKIP
            if not skip:
                bf_oracle = _strip_reminder_text(bf_oracle)
            else:
                bf_oracle = ""
        if bf_oracle:
            bf_parts.append(f"-- {bf_oracle}")
    return " // Back: " + " ".join(bf_parts)


def _format_card_brief(card: CardState) -> str:
    """Format a card briefly: Name {ManaCost} [TypeLine]. Includes oracle text if show_oracle_text is enabled."""
    prefix = f"{card.quantity}x " if card.quantity > 1 else ""
    parts = [prefix + card.name]

    if card.mana_cost:
        parts.append(card.mana_cost)

    # Skip type line for basic lands
    if card.type_line and card.name not in BASIC_LANDS:
        parts.append(f"[{card.type_line}]")

    if card.custom_power is not None and card.custom_toughness is not None:
        if card.power is not None and card.toughness is not None:
            parts.append(f"(including counters and pumps: {card.custom_power}/{card.custom_toughness})")
        else:
            parts.append(f"({card.custom_power}/{card.custom_toughness})")
    elif card.power is not None and card.toughness is not None:
        parts.append(f"({card.power}/{card.toughness})")

    if card.counters:
        counter_strs = []
        for ctype, count in card.counters.items():
            counter_strs.append(f"{count}x {ctype}")
        parts.append(f"(Counters: {', '.join(counter_strs)})")

    # Include oracle text when explicitly flagged
    if card.show_oracle_text and card.oracle_text:
        skip = _oracle_mode == "reduced" and card.name in ORACLE_SKIP
        if not skip:
            oracle = card.oracle_text.replace("\n", " / ")
            if _oracle_mode == "reduced":
                oracle = _strip_reminder_text(oracle)
            if oracle:
                parts.append(f"-- {oracle}")

    # User note
    if card.note:
        parts.append(f"-- NOTE: {card.note}")

    result = " ".join(parts)
    return result + _commander_tag(card)


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
    "morph": ("Morph creature", ""),
    "manifest": ("Manifest creature", ""),
    "cloaked": ("Cloaked creature", " (ward 2)"),
}


def _oracle_for_card(card: CardState) -> str:
    """Return the card's oracle text honouring the current oracle mode/flag, or ""."""
    if card.show_oracle_text and card.oracle_text:
        skip = _oracle_mode == "reduced" and card.name in ORACLE_SKIP
        if not skip:
            oracle = card.oracle_text.replace("\n", " / ")
            if _oracle_mode == "reduced":
                oracle = _strip_reminder_text(oracle)
            return oracle
    return ""


def _format_card_perspective(card: CardState, is_own: bool) -> Optional[str]:
    """
    Return a special string for face-down / transformed cards, or None for normal rendering.

    Face-down:
      - Own cards (controller's perspective): full name + "(face down …)" hint,
        plus the real oracle text when the oracle toggle is on (reduced/full).
      - Opponent cards: just "Morph creature 2/2" / "Face-down card" — no name.
      - P/T reflects +1/+1 counters and arrow buffs via custom_power (else base 2/2)
    Transformed:
      - Use back_face data for rendering
    """
    if card.face_down:
        # Own (controlled) face-down cards may carry their real oracle text.
        oracle = _oracle_for_card(card) if is_own else ""
        oracle_part = f" -- {oracle}" if oracle else ""
        # A user note (e.g. "foretold") is a public annotation — show it either way.
        note_part = f" -- NOTE: {card.note}" if card.note else ""
        own_extra = oracle_part + note_part
        label_info = _FACE_DOWN_LABELS.get(card.face_down_type)
        if label_info:
            # Morph / Manifest / Cloaked — a 2/2 creature
            base, suffix = label_info
            if card.custom_power is not None and card.custom_toughness is not None:
                pt = f"{card.custom_power}/{card.custom_toughness}"
            else:
                pt = "2/2"
            fd_label = f"{base} {pt}{suffix}"
            if is_own:
                return f"{card.name} (face down as {fd_label}){own_extra}"
            return f"{fd_label}{note_part}"
        # Plain face-down card — not necessarily a creature
        if is_own:
            return f"{card.name} (face down){own_extra}"
        return f"Face-down card{note_part}"
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
    """Classify a card into 'land', 'creature', or 'other' by type line.

    For DFCs with combined type lines (e.g. 'Artifact // Land'),
    use only the active face — front face for untransformed cards
    (transformed cards already have back-face type via _get_display_card).

    A manual custom P/T badge marks the card as a creature (e.g. an animated
    land / artifact the user turned into a creature on the board).
    """
    if card.custom_power is not None:
        return "creature"
    type_line = card.type_line or ""
    if " // " in type_line and not card.transformed:
        type_line = type_line.split(" // ")[0]
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
            fd_annotations = []
            if c.tapped:
                fd_annotations.append("TAPPED")
            if c.attacking:
                fd_annotations.append("ATTACKING")
            if c.blocking:
                fd_annotations.append("BLOCKING")
            fd_suffix = (" -- " + ", ".join(fd_annotations)) if fd_annotations else ""
            fd_line = f"    - {fd_text}{fd_suffix}{_format_attached_inline(c, game_state)}"
            if c.face_down_type in ("morph", "manifest", "cloaked"):
                creature_fd_lines.append(fd_line)
            else:
                face_down_lines.append(fd_line)
        else:
            display_cards.append(_get_display_card(c))

    lands = [c for c in display_cards if _classify_card(c) == "land"]
    creatures = [c for c in display_cards if _classify_card(c) == "creature"]
    others = [c for c in display_cards if _classify_card(c) == "other"]

    if lands:
        grouped = _group_basic_lands(lands)
        land_strs = []
        land_linked_lines = []
        # Lands that need full detail (DFCs, complex abilities) go here
        land_full_lines = []
        for item in grouped:
            if isinstance(item, str):
                # Grouped basic lands (e.g. "Swamp x3")
                land_strs.append(item)
            else:
                # Check if this land needs full rendering (DFC, attached auras, or complex oracle)
                is_dfc = item.transformed or bool(item.back_face and item.back_face.get("name"))
                has_attached = bool(item.attached_cards)
                mana = _extract_simple_mana(item)
                has_complex_oracle = bool(item.oracle_text) and (
                    mana is None or item.oracle_text.count("\n") > 0
                    or len(item.oracle_text) > 60
                )
                needs_full = is_dfc or has_attached or (has_complex_oracle and _oracle_mode in ("reduced", "full"))

                if needs_full:
                    # Render as full card line
                    label = f"    - {_format_card_full(item)}{_format_attached_inline(item, game_state)}"
                    if is_dfc and not item.transformed:
                        label += " (front face)"
                    elif is_dfc and item.transformed:
                        label += " (transformed)"
                    land_full_lines.append(label)
                else:
                    text = item.name
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
        if land_strs:
            lines.append(f"  Lands: {', '.join(land_strs)}")
        lines.extend(land_linked_lines)
        if land_full_lines:
            if not land_strs:
                lines.append("  Lands:")
            lines.extend(land_full_lines)

    if creatures or creature_fd_lines:
        lines.append("  Creatures:")
        for card in creatures:
            lines.append(f"    - {_format_card_full(card)}{_format_attached_inline(card, game_state)}")
            for linked_id in card.linked_exile_cards:
                linked = game_state.cards.get(linked_id)
                if linked:
                    linked_label = "face-down card" if linked.face_down else linked.name
                    lines.append(f"      -> holds in exile: {linked_label}")
        lines.extend(creature_fd_lines)

    if others:
        lines.append("  Other Permanents:")
        for card in others:
            lines.append(f"    - {_format_card_full(card)}{_format_attached_inline(card, game_state)}")
            for linked_id in card.linked_exile_cards:
                linked = game_state.cards.get(linked_id)
                if linked:
                    linked_label = "face-down card" if linked.face_down else linked.name
                    lines.append(f"      -> holds in exile: {linked_label}")

    if face_down_lines:
        lines.append("  Face Down:")
        lines.extend(face_down_lines)


def _format_attached_inline(card: CardState, game_state: GameState) -> str:
    """Return an inline ' [attached: ...]' suffix for a card's attached auras/equipment,
    or empty string. Uses ';' as separator because the brief format may contain commas."""
    if not card.attached_cards:
        return ""
    att_strs = []
    for att_id in card.attached_cards:
        att = game_state.cards.get(att_id)
        if att:
            att_display = _get_display_card(att)
            att_strs.append(_format_card_brief(att_display))
    if not att_strs:
        return ""
    return f" [attached: {'; '.join(att_strs)}]"


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


def generate_bot_hand(game_state: GameState, oracle_mode: str = "off", number_hand: bool = False, player_index: Optional[int] = None) -> str:
    """Generate a text snippet of a player's hand cards.

    player_index defaults to the active player when not given.
    """
    global _oracle_mode
    if len(game_state.players) < 2:
        return "(No game in progress)"

    _oracle_mode = oracle_mode
    idx = player_index if player_index is not None else game_state.active_player_index
    player = game_state.players[idx]
    hand_cards = _get_zone_cards(game_state, idx, "hand")

    lines = [f"{player.name}'s Hand ({len(hand_cards)} cards):"]
    if hand_cards:
        # Use this player's own frozen order (stable within a turn); fall back to
        # live order if none frozen yet.
        frozen = game_state.frozen_hand_orders.get(idx)
        order = list(frozen) if frozen else [c.id for c in hand_cards]
        for card in hand_cards:
            show = oracle_mode != "off" or card.show_oracle_text
            orig = card.show_oracle_text
            card.show_oracle_text = show
            if number_hand:
                if card.id not in order:
                    order.append(card.id)
                num = order.index(card.id) + 1
                prefix = f"Handkarte{num}: "
            else:
                prefix = ""
            lines.append(f"  - {prefix}{_format_card_full(card)}{_format_back_face(card)}")
            card.show_oracle_text = orig
    else:
        lines.append("  (empty)")

    _oracle_mode = "off"
    return "\n".join(lines)


def generate_mulligan_prompt(game_state: GameState, oracle_mode: str = "off", player_index: Optional[int] = None) -> str:
    """Generate a mulligan decision prompt: commander info + hand + question.

    player_index defaults to the active player when not given.
    """
    global _oracle_mode
    if len(game_state.players) < 2:
        return "(No game in progress)"

    _oracle_mode = oracle_mode
    idx = player_index if player_index is not None else game_state.active_player_index

    lines: List[str] = []

    # Find the player's commanders
    commanders = [
        c for c in game_state.cards.values()
        if c.is_commander and c.owner_index == idx
    ]
    if commanders:
        for cmd in commanders:
            oracle = cmd.oracle_text or ""
            if oracle and oracle_mode == "reduced":
                oracle = _strip_reminder_text(oracle)
            oracle_part = f" -- {oracle.replace(chr(10), ' / ')}" if oracle else ""
            lines.append(f"Das ist dein Commander: {cmd.name} {cmd.mana_cost} [{cmd.type_line}]{oracle_part}")
        lines.append("")

    # Hand cards (always with oracle in reduced style)
    hand_cards = _get_zone_cards(game_state, idx, "hand")
    lines.append(f"Das ist deine Starthand ({len(hand_cards)} Karten):")
    for card in hand_cards:
        orig = card.show_oracle_text
        card.show_oracle_text = oracle_mode != "off"
        lines.append(f"  - {_format_card_full(card)}{_format_back_face(card)}")
        card.show_oracle_text = orig

    lines.append("")
    lines.append("Du spielst in einer Commanderrunde. Das ist deine Starthand. Machst du einen Mulligan? Nur die Entscheidung. Ohne Begründung. Ich bin dein Gegner. Verrate mir nicht, wieso du behältst oder Mulligan machen willst. Nur die Entscheidung bitte: Mulligan oder Behalten? Bedenke: Der erste Mulligan ist kostenlos. Pro jeden weiteren Mulligan über den ersten hinaus: Eine Karte unter die Bibliothek.")

    _oracle_mode = "off"
    return "\n".join(lines)
