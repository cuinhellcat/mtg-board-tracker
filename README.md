# MTG Board State Tracker

A lightweight, local web app for playing **Magic: The Gathering** (Commander) against AI bots — or just for tracking your board state with style.

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

### Multiplayer Commander (1 Human + up to 3 Bots)
- Play a **4-player Commander pod**: you (default **Andre**) plus AI opponents (default **Lexi**, **Emma**, **Dainty** — all names editable in setup; 2–4 players supported)
- **Your board is always at the bottom.** The **top board switches** between opponents via name buttons, and **auto-switches** to whoever becomes the active player on "Pass Turn"
- You physically operate every player's board; each bot only ever sees a **text snapshot from its own perspective** (its hand open, everyone else's hand shown as counts)

### Two-Window Architecture
- **Board Window** (horizontal monitor) — your board (bottom) + one switchable opponent board (top), all zones, drag & drop, card rendering
- **Command Center** (vertical/second monitor) — phase tracker, life counters (all players), action log, chat, snapshot generation, and a clean **"⏻ App beenden"** (quit) button that shuts the server down gracefully

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
"Copy Boardstate" generates a text snapshot **from the perspective of the active player** — exactly what that bot would see at the table. It opens with a role instruction, then the bot's own board in full, then each opponent with public zones only (hands as counts):

```
Deine Rolle: Du bist ein Magic-Spieler in einer Commanderrunde. ...
Andre, einer deiner Gegner, legt alle Karten. ...

Du bist Lexi und spielst gegen Andre, Emma und Dainty.

=== MTG COMMANDER -- BOARD STATE ===
Turn 5 (Lexi's 2nd) | Phase: Main 1 | Active Player: Lexi (You)
Zugreihenfolge: Lexi → Emma → Dainty → Andre

--- YOUR STATUS (Lexi) ---
Life: 40
Hand (3 cards):
  - Handkarte1: Llanowar Elves {G} [Creature — Elf Druid] (1/1)
  ...
Battlefield:
  Lands: 4x Forest
  Creatures:
    - Questing Beast {2}{G}{G} (4/4) — Counters: 2x +1/+1

--- OPPONENT: Andre ---
Life: 40
Hand: 5 cards (hidden)
Battlefield: ...
```

Key snapshot features:
- **Active-player perspective** — own hand fully visible (with stable "HandkarteN" numbering that matches the board's hidden-hand numbers), opponents' hands shown as counts only
- **Turn order** line so the bot knows who acts next
- Basic lands are **grouped** (not listed individually)
- **Oracle text** has three modes — Off / Reduced / Full — selectable in the Command Center
- **Attached cards** shown indented under their parent
- **Configurable** recent-actions depth and an extra notes field, both appended to the copy
- **Per-bot hand / mulligan copy** — switch the top board to a bot, then "Copy Bot's Hand (Mulligan)" to get that bot's opening-hand prompt

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
- **In-app quit** — "⏻ App beenden" in the Command Center shuts the server down cleanly (localhost-only), so you can stop it even when launched from the app menu with no terminal or tray
- **WebSocket sync** — board and command center stay in sync in real-time
- **Context menus** — right-click cards for all available actions
- **Hover preview** — see full card image on hover (both faces for DFCs)

---

## How to Use (Playing a Pod vs. Bots)

1. **Start a game** — on the setup page, fill in up to 4 players (you + bots) and their decks
2. **Mulligans** — switch the top board to each bot and use **"Copy Bot's Hand (Mulligan)"** to get that bot's keep/mulligan decision
3. **On a bot's turn** — the top board auto-switches to the active bot. Click **"Copy Boardstate"** to get the snapshot from that bot's perspective
4. **Copy & paste** it into a fresh chat for that bot (Claude, Gemini, ChatGPT, local model, …) — each call is intentionally context-free
5. **Read the bot's response** and **execute its moves** manually on its board (drag, tap, cast)
6. **Pass Turn** — advance to the next player and repeat

**Pro tips:**
- Each bot is a **separate, fresh chat** — anything that must carry over goes into the **Additional Notes** field, which is appended to the copy
- Use the **Oracle Text** mode (Off / Reduced / Full) for cards the bot needs to understand
- Undo (100 levels) if you misplay a bot's intended move
- A bot only sees its own hand — every other hand is shown as a count in its snapshot

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

**Linux / macOS — one-shot script (recommended):**
```bash
bash run.sh
```
(Call it via `bash`, not `./run.sh` — OneDrive/rclone mounts are `noexec`, so
the script can't be executed directly, but `bash` reading it works fine.)

Creates a virtualenv on first run (outside this folder, so OneDrive doesn't
choke on the venv's symlinks), installs dependencies, then launches. The app
opens in your browser. If a system-tray backend is available a tray icon with a
Quit menu is shown; otherwise it runs in the foreground (quit with Ctrl+C).

On KDE/GNOME you can also install a clickable launcher (no terminal needed):
copy `mtg-tracker.desktop` into `~/.local/share/applications/` and adjust the
paths inside it. The app then appears in your application menu as
"MTG Board Tracker".

**Windows — System Tray:**
```bash
python start.py
```
A tray icon appears near the clock. Right-click it to open Board, Command Center, or quit.

**Any platform — direct server:**
```bash
uvicorn backend.main:app --host 0.0.0.0 --port 8000
```
Then open `http://localhost:8000` in your browser.

> **Note on the venv & OneDrive:** This project folder lives in OneDrive, which
> uses a filesystem that can't create the symlinks `python -m venv` needs. Put
> the virtualenv elsewhere (`run.sh` uses `~/.venvs/mtg-board-tracker`), or
> override the location with `MTG_VENV=/path/to/venv ./run.sh`.

### First Launch
1. Open `http://localhost:8000` — you'll see the landing page
2. Click **"+ Neues Spiel"** (New Game)
3. Download the Scryfall card database (one-time, ~50MB)
4. Fill in the players (you + up to 3 bots), paste each decklist, pick commanders, start the game
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
- **Players as a list** — supports a 2–4 player pod. The board renders a fixed bottom slot (you) and one switchable top slot (the selected/active opponent), decoupled from player index so the same DOM serves any opponent.

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
- **Multiplayer** ✅ — 2–4 player pod (1 human + up to 3 bots), switchable opponent board, per-bot perspective snapshots (complete)
- **Phase 2** 🔜 — LLM API integration (send snapshots directly, receive responses in-app)

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
