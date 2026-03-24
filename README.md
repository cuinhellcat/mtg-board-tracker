# MTG Board State Tracker

A lightweight, local web app for playing **Magic: The Gathering** (Duel Commander, 1v1) against an LLM — or just for tracking your board state with style.

The core idea: instead of manually typing out your board state every turn and watching the LLM hallucinate lands that don't exist, this app generates clean, structured **Snapshots** optimized for LLM consumption. You play both sides manually, copy-paste the snapshot into your LLM of choice, and get back a coherent response.

![Status](https://img.shields.io/badge/Phase_1-Complete-brightgreen)
![Stack](https://img.shields.io/badge/Stack-Python_FastAPI_+_Vanilla_JS-blue)
![License](https://img.shields.io/badge/License-MIT-yellow)

---

## Why This Exists

Playing MTG against LLMs (Claude, Gemini, GPT, local models) is surprisingly fun — but keeping the board state in sync is a nightmare. By turn 12, the LLM confidently taps six lands when it only has four, attacks with creatures that died three turns ago, and forgets half your enchantments.

This tracker solves that by:
- Maintaining a **single source of truth** for the entire game state
- Generating **machine-readable snapshots** that give the LLM exactly what it needs — nothing more, nothing less
- Letting you **manually execute** the LLM's moves with full undo support, so you stay in control

## Features

### Two-Window Architecture
- **Board Window** (horizontal monitor) — the battlefield with all zones, drag & drop, card rendering
- **Command Center** (vertical/second monitor) — phase tracker, life counters, action log, chat, snapshot generation

### Board & Cards
- **Drag & Drop** between all zones (hand, battlefield, graveyard, exile, command zone, library)
- **Battlefield subzones** — Creatures, Lands, Other (auto-sorted)
- **Tap/Untap** — click to toggle, "Untap All" button per player
- **Counters** — +1/+1 counters as a dedicated menu item, plus generic "Add Counter" for anything else (flying, loyalty, charge, etc.)
  - Counter badges are **clickable**: left-click = +1, right-click = -1
- **Custom P/T badge** — auto-calculated from +1/+1 and -1/-1 counters, also manually adjustable (left-click = +1, right-click = -1)
- **Aura/Equipment attachment** — attach cards to other cards, auto-detach when leaving battlefield
- **Linked Exile** — exile cards "under" another card (e.g. Imprint, Hostage Taker). Shown in the card's inventory panel
- **Inventory Panel** — collapsible panel next to cards showing all attached and exiled-under cards. Items are fully interactive: hover for preview, right-click for context menu, drag to move
- **Double-Faced Cards (DFC)** — hover shows both faces side-by-side, transform via context menu
- **Token creation** — from Scryfall's related token data (context menu shows which tokens a card can create)
- **Face-down cards** — Morph, Manifest, etc.
- **Commander Tax** — tracked automatically, manually adjustable via +/- pill

### Snapshots (The Core Feature)
The Command Center generates a text snapshot of the entire board state, formatted for LLM consumption:

```
=== BOARD STATE SNAPSHOT ===
Format: Duel Commander | Turn: 5 | Phase: Main 1 | Active Player: Andre

--- Andre (40 life) ---
Battlefield:
  Creatures:
    Llanowar Elves {G} [Creature — Elf Druid] (1/1) [TAPPED]
    Questing Beast {2}{G}{G} [Creature — Beast] (4/4) — Counters: 2x +1/+1
      → attached: Rancor {G} [Enchantment — Aura]
  Lands: 4x Forest, 2x Stomping Ground
  Other:
    Sylvan Library {1}{G} [Enchantment]
Hand: 3 cards
Graveyard: Lightning Bolt, Swords to Plowshares

--- Recent Actions (last 3) ---
  Andre: Attacked with Questing Beast
  Andre: Cast Rancor targeting Questing Beast
  Andre: Played Stomping Ground (tapped)
```

Key snapshot features:
- Basic lands are **grouped** (not listed individually)
- **Oracle text** is opt-in per card (toggle via context menu) — only included when relevant
- **Attached cards** shown indented under their parent
- **Configurable** recent actions count (persisted in localStorage)
- **Library count** omitted (to prevent LLM from gaming information)

### Scryfall Integration
- **Bulk Oracle Cards** download (~34,000 cards cached locally)
- **Card images** downloaded on demand and cached
- **Art/Printing selector** — right-click any card → "Change Art/Printing" to pick your favorite version
- **Crossover set filter** — auto-swaps TMNT and other crossover art at game start
- **Related tokens** — fetched from Scryfall's `all_parts` data

### Quality of Life
- **Undo** — 100 levels deep, covers every action
- **Auto-save** — atomic writes after every action, shutdown hook via `atexit`
- **Game archive** — finished games saved with timestamps, viewable from landing page
- **Deck storage** — save and load decklists for quick game setup
- **System tray** — runs as a tray icon (no terminal window needed)
- **WebSocket sync** — board and command center stay in sync in real-time
- **Context menus** — right-click cards for all available actions
- **Hover preview** — see full card image on hover (both faces for DFCs)

---

## How to Use (Playing Against an LLM)

1. **Start a game** — pick decks for both players on the setup page
2. **Play your turn** normally — drag cards, tap lands, attack
3. **Generate a snapshot** — click the snapshot button in the Command Center
4. **Copy & paste** the snapshot into your LLM (Claude, Gemini, ChatGPT, etc.)
5. **Read the LLM's response** — it tells you what it wants to do
6. **Execute the LLM's moves** manually on the board (drag, tap, cast)
7. **Repeat** — generate a new snapshot for the next interaction

**Pro tips:**
- Toggle "Oracle Text" on for cards the LLM needs to understand (complex abilities)
- Use the chat for additional context ("I'm not blocking this turn")
- Undo if you misplay the LLM's intended move
- The LLM doesn't see your hand or library — only what's in the snapshot

---

## Installation

### Prerequisites
- Python 3.11+
- A modern browser (Edge, Chrome, Firefox)

### Setup

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/mtg-board-tracker.git
cd mtg-board-tracker

# Install dependencies
pip install -r requirements.txt

# Optional: for system tray support
pip install pystray pillow
```

### Running

**Option A — System Tray (recommended on Windows):**
```bash
python start.py
```
A tray icon appears near the clock. Right-click it to open Board, Command Center, or quit.

**Option B — Direct server:**
```bash
uvicorn backend.main:app --host 0.0.0.0 --port 8000
```
Then open `http://localhost:8000` in your browser.

### First Launch
1. Open `http://localhost:8000` — you'll see the landing page
2. Click **"+ Neues Spiel"** (New Game)
3. Download the Scryfall card database (one-time, ~50MB)
4. Paste your decklists, pick commanders, start the game
5. The **Board** opens in the current tab, **Command Center** opens in a new window — drag it to your second monitor

---

## Project Structure

```
├── backend/
│   ├── main.py            # FastAPI app, routes, WebSocket
│   ├── game_engine.py     # Central state machine, action dispatch, undo, auto-save
│   ├── models.py          # Pydantic models (GameState, CardState, PlayerState)
│   ├── snapshot.py        # LLM-optimized board state text generation
│   ├── scryfall.py        # Scryfall API integration, bulk cache, image download
│   ├── decklist.py        # Decklist parser
│   ├── deck_storage.py    # Save/load/delete deck files
│   └── printing_prefs.py  # Card art preference persistence
├── frontend/
│   ├── static/
│   │   ├── css/           # board.css, command.css, common.css
│   │   └── js/
│   │       ├── board.js   # Board UI, card rendering, context menus, previews
│   │       ├── command.js # Command Center UI, snapshot controls
│   │       ├── dragdrop.js# HTML5 Drag & Drop with custom ghost elements
│   │       ├── ws.js      # Shared WebSocket module
│   │       └── utils.js   # Shared utilities
│   └── templates/         # Jinja2 HTML templates (landing, setup, board, command)
├── cache/                 # Auto-generated: Scryfall data, card images, tokens
├── saves/                 # Auto-generated: current game + archive
├── start.py               # System tray launcher
└── requirements.txt
```

### Architecture

- **Action Dispatch Pattern** — every state change goes through `GameEngine.dispatch()`. No direct state mutation. This gives you undo, action logging, and auto-save for free.
- **WebSocket sync** — both windows connect to the same WebSocket. Any action in either window broadcasts the updated state to all clients.
- **Players as a list** — not hardcoded `player1`/`player2`. Ready for multiplayer expansion.

---

## Controls Reference

### Mouse
| Action | Effect |
|--------|--------|
| **Click** card on battlefield | Tap / Untap |
| **Right-click** card | Context menu (all actions) |
| **Hover** over card | Full card preview |
| **Drag** card | Move between zones |
| **Left-click** counter badge | +1 to that counter |
| **Right-click** counter badge | -1 to that counter |
| **Left-click** P/T badge | +1 power or toughness |
| **Right-click** P/T badge | -1 power or toughness |

### Context Menu Highlights
- **+1/+1 Counter** — dedicated shortcut for the most common counter type
- **Counter hinzufügen...** — add any custom counter (flying, charge, loyalty, etc.)
- **Attach to...** — attach an Aura/Equipment to another card on the battlefield
- **Link Exile** — exile a card "under" another (Imprint, Hostage Taker, etc.)
- **Toggle Oracle Text** — include/exclude this card's oracle text in snapshots
- **Create Token** — shows tokens this card can create (from Scryfall data)
- **Transform** — flip a double-faced card
- **Change Art/Printing** — pick a different card art from all Scryfall printings

---

## Roadmap

- **Phase 1** ✅ — Board State Tracker with snapshot generation (complete)
- **Phase 2** 🔜 — LLM API integration (send snapshots directly, receive responses in-app)
- **Phase 3** 🔮 — Multiplayer (3-4 players, multiple LLM opponents)

---

## Tech Stack

- **Backend:** Python 3.11+, FastAPI, Pydantic, uvicorn, aiohttp
- **Frontend:** Vanilla JavaScript (no framework), HTML5, CSS3
- **Communication:** WebSockets (real-time state sync)
- **Card Data:** [Scryfall API](https://scryfall.com/docs/api) (bulk data + on-demand)
- **Storage:** JSON files (game state, preferences, deck storage)

---

## License

MIT — do whatever you want with it. See [LICENSE](LICENSE).

---

## Acknowledgments

- [Scryfall](https://scryfall.com/) for the incredible card data API
- The MTG community for being endlessly creative
- Claude, Gemini, and the other LLMs that bravely attempt to play Magic (and occasionally tap lands they don't have)

---

*Built with ❤️ and way too much mana by Andre — with the help of Claude Code.*
