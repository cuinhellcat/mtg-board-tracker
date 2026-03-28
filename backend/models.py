"""
Pydantic models for the MTG Duel Commander Board State Tracker.
Central data structures representing the complete game state.
"""

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, model_validator


class CardState(BaseModel):
    """Represents the full state of a single card in the game."""
    id: str  # UUID
    scryfall_id: Optional[str] = None
    name: str
    oracle_text: str = ""
    mana_cost: str = ""
    type_line: str = ""
    power: Optional[str] = None
    toughness: Optional[str] = None
    loyalty: Optional[str] = None
    colors: List[str] = Field(default_factory=list)
    color_identity: List[str] = Field(default_factory=list)
    cmc: float = 0
    image_uri: Optional[str] = None
    large_image_uri: Optional[str] = None
    zone: str  # "library", "hand", "battlefield", "graveyard", "exile", "exile_linked", "command_zone", "stack"
    zone_moved_at: int = 0  # incremental counter for ordering within a zone
    owner_index: int
    controller_index: int
    tapped: bool = False
    counters: Dict[str, int] = Field(default_factory=dict)  # e.g. {"+1/+1": 2}
    is_token: bool = False
    is_conjured: bool = False  # True for tokens and manually added cards (neutral styling, deletable)
    is_commander: bool = False
    linked_exile_cards: List[str] = Field(default_factory=list)  # IDs of cards in linked exile under this card
    linked_to: Optional[str] = None  # ID of parent card (for exile_linked cards)
    attached_cards: List[str] = Field(default_factory=list)  # IDs of Auras/Equipment attached to this card
    attached_to: Optional[str] = None  # ID of card this Aura/Equipment is attached to
    show_oracle_text: bool = False  # If True, include oracle text in LLM snapshot
    note: str = ""  # User note — shown in snapshot as if part of oracle text
    face_down: bool = False
    face_down_type: Optional[str] = None  # "morph", "manifest", "cloaked" — visual label only
    attacking: bool = False
    blocking: Optional[str] = None
    battlefield_group: Optional[str] = None  # "creature", "land", "other" – user override for subzone placement
    custom_power: Optional[int] = None    # Manual P/T badge (e.g. for animated lands)
    custom_toughness: Optional[int] = None
    # Double-faced card support
    layout: str = "normal"  # "normal", "transform", "modal_dfc", "flip", etc.
    back_face: Optional[Dict] = None  # {name, oracle_text, mana_cost, type_line, power, toughness, loyalty, image_uri}
    transformed: bool = False
    keywords: List[str] = Field(default_factory=list)  # Scryfall keywords, e.g. ["Haste", "Flying"]
    summoning_sick: bool = False  # True on the turn a creature enters the battlefield (no haste)
    # Related tokens (from Scryfall all_parts)
    related_tokens: List[Dict] = Field(default_factory=list)  # [{name, type_line, scryfall_id, uri}]
    original_characteristics: Optional[Dict] = None  # Saved before "become copy" so it can be reverted
    quantity: int = 1  # Visual quantity badge (for representing multiple copies with one card element)


class PlayerState(BaseModel):
    """Represents a single player's state."""
    name: str
    life: int = 20
    commander_taxes: Dict[str, int] = Field(default_factory=dict)  # commander_name → tax amount
    commander_damage_received: Dict[str, int] = Field(default_factory=dict)
    extra_counters: Dict[str, int] = Field(default_factory=dict)  # e.g. {"Poison": 3, "Experience": 7}
    mana_pool: str = ""

    @model_validator(mode="before")
    @classmethod
    def _migrate_commander_tax(cls, data: Any) -> Any:
        """Migrate old single commander_tax (int) to commander_taxes (dict)."""
        if isinstance(data, dict):
            old_tax = data.pop("commander_tax", None)
            if old_tax and isinstance(old_tax, int) and old_tax > 0:
                if not data.get("commander_taxes"):
                    data["commander_taxes"] = {"Commander": old_tax}
        return data


class ActionEntry(BaseModel):
    """A single entry in the game action log."""
    id: str  # UUID
    type: str
    description: str
    turn: int
    phase: str
    timestamp: str  # ISO datetime


class GameState(BaseModel):
    """The complete game state - single source of truth."""
    players: List[PlayerState] = Field(default_factory=list)
    cards: Dict[str, CardState] = Field(default_factory=dict)  # card_id -> CardState
    turn: int = 0
    phase: str = "untap"
    active_player_index: int = 0
    first_player_index: int = 0
    zone_move_counter: int = 0
    action_log: List[ActionEntry] = Field(default_factory=list)
    game_started: bool = False


class ChatMessage(BaseModel):
    """A chat message between players or from the system."""
    sender: str  # player name or "System"
    message: str
    timestamp: str
