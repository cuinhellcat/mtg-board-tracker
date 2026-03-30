/**
 * MTG Board State Tracker - Standalone HTML Export
 * Generates a single self-contained HTML file that renders the board state
 * as an interactive viewer (tap/untap, life +/-, card hover preview).
 */

window.generateStandaloneHTML = function (state) {
    var stateJson = JSON.stringify(state);
    var exportDate = new Date().toLocaleString('de-DE');

    // Player names for title
    var p0Name = (state.players && state.players[0]) ? state.players[0].name : 'Player 0';
    var p1Name = (state.players && state.players[1]) ? state.players[1].name : 'Player 1';

    return '<!DOCTYPE html>\n' +
'<html lang="en">\n' +
'<head>\n' +
'<meta charset="UTF-8">\n' +
'<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
'<title>MTG Board — ' + p0Name + ' vs ' + p1Name + ' (' + exportDate + ')</title>\n' +
'<style>\n' + CSS_CONTENT + '\n</style>\n' +
'</head>\n' +
'<body>\n' +
HTML_STRUCTURE + '\n' +
'<script>\nvar GAME_STATE = ' + stateJson + ';\n' +
VIEWER_JS + '\n<\/script>\n' +
'</body>\n' +
'</html>';
};

// ============================================================
// INLINE CSS (stripped-down board.css)
// ============================================================

var CSS_CONTENT = `
/* ---------- ROOT VARIABLES ---------- */
:root {
    --bg-primary: #1c1c1c;
    --bg-surface: #222222;
    --bg-card: #2a2a2a;
    --bg-card-hover: #353535;
    --bg-secondary: #282828;
    --accent: #e94560;
    --accent-glow: rgba(233, 69, 96, 0.4);
    --text-primary: #e0e0e0;
    --text-secondary: #909090;
    --text-muted: #585858;
    --border-color: #383838;
    --border: #383838;
    --drop-highlight: rgba(233, 69, 96, 0.3);
    --zone-bg-battlefield: rgba(255, 255, 255, 0.03);
    --zone-bg-hand: rgba(255, 255, 255, 0.05);
    --zone-bg-command: rgba(255, 255, 255, 0.04);
    --zone-bg-graveyard: rgba(60, 30, 30, 0.45);
    --zone-bg-exile: rgba(50, 40, 55, 0.45);
    --zone-bg-library: rgba(20, 20, 20, 0.5);
    --p0-accent: #00c5cc;
    --p0-accent-dim: rgba(0, 180, 190, 0.18);
    --p0-accent-subtle: rgba(0, 180, 190, 0.08);
    --p0-border: #1a7a80;
    --p0-label-bg: rgba(0, 160, 170, 0.12);
    --p0-card-bg: #0d2e30;
    --p0-card-hover: #163e40;
    --p1-accent: #a855f7;
    --p1-accent-dim: rgba(150, 70, 220, 0.18);
    --p1-accent-subtle: rgba(150, 70, 220, 0.08);
    --p1-border: #7a3aaa;
    --p1-label-bg: rgba(130, 60, 200, 0.12);
    --p1-card-bg: #1e0e30;
    --p1-card-hover: #2c1545;
    --mana-W: #f9faf4;
    --mana-U: #0e68ab;
    --mana-B: #4a4a4a;
    --mana-R: #d3202a;
    --mana-G: #00733e;
    --mana-multi: #c7b037;
    --mana-C: #888888;
    --card-width: 77px;
    --card-height: 107px;
    --card-font: 8px;
    --card-font-sm: 7px;
    --shadow-card: 0 2px 8px rgba(0, 0, 0, 0.4);
    --shadow-hover: 0 4px 20px rgba(0, 0, 0, 0.6);
    --radius-sm: 4px;
    --radius-md: 6px;
    --radius-lg: 10px;
    --transition-fast: 0.15s ease;
    --transition-mid: 0.25s ease;
}

*, *::before, *::after { box-sizing: border-box; }

html, body {
    margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden;
    background: var(--bg-primary); color: var(--text-primary);
    font-family: 'Segoe UI', 'Inter', 'Roboto', Arial, sans-serif;
    font-size: 14px; line-height: 1.4; user-select: none; -webkit-user-select: none;
}

button { cursor: pointer; font-family: inherit; font-size: inherit; }

/* ---------- BOARD CONTAINER ---------- */
#board-container {
    width: 100%; height: 100%; display: flex; flex-direction: column; position: relative;
}

/* ---------- EXPORT BANNER ---------- */
.export-banner {
    background: var(--bg-surface); border-bottom: 1px solid var(--border-color);
    padding: 4px 16px; font-size: 11px; color: var(--text-muted);
    display: flex; justify-content: space-between; align-items: center; flex-shrink: 0;
}
.export-banner strong { color: var(--text-secondary); }

/* ---------- PLAYER HALVES ---------- */
.player-half {
    flex: 1; display: flex; flex-direction: column; min-height: 0; position: relative;
}
.player-label {
    padding: 4px 16px; background: rgba(0, 0, 0, 0.3);
    border-bottom: 1px solid var(--border-color);
    display: flex; align-items: center; gap: 12px; flex-shrink: 0; height: 28px;
}
.player-top .player-label { border-bottom: 1px solid var(--p1-border); background: var(--p1-label-bg); }
.player-bottom .player-label { border-top: 1px solid var(--p0-border); border-bottom: none; background: var(--p0-label-bg); }
.player-top .player-zones { background: var(--p1-accent-subtle); }
.player-bottom .player-zones { background: var(--p0-accent-subtle); }
.player-top .zone { border-color: var(--p1-border); }
.player-bottom .zone { border-color: var(--p0-border); }
.player-top .zone-battlefield  { background: var(--p1-accent-dim); }
.player-top .zone-hand         { background: rgba(150, 70, 220, 0.12); }
.player-top .zone-command      { background: rgba(150, 70, 220, 0.10); }
.player-top .zone-graveyard    { background: rgba(100, 30, 150, 0.25); }
.player-top .zone-exile        { background: rgba(100, 30, 150, 0.20); }
.player-top .zone-library      { background: rgba(100, 30, 150, 0.18); }
.player-bottom .zone-battlefield  { background: var(--p0-accent-dim); }
.player-bottom .zone-hand         { background: rgba(0, 180, 190, 0.12); }
.player-bottom .zone-command      { background: rgba(0, 180, 190, 0.10); }
.player-bottom .zone-graveyard    { background: rgba(0, 100, 110, 0.25); }
.player-bottom .zone-exile        { background: rgba(0, 100, 110, 0.20); }
.player-bottom .zone-library      { background: rgba(0, 100, 110, 0.18); }
.player-top .player-name-display    { color: var(--p1-accent); }
.player-bottom .player-name-display { color: var(--p0-accent); }
.player-name-display {
    font-size: 15px; font-weight: 700; letter-spacing: 0.5px;
    text-transform: uppercase; color: var(--text-primary);
}
.player-zones {
    flex: 1; display: flex; min-height: 0; gap: 2px; padding: 2px;
}

/* ---------- SIDE COLUMNS ---------- */
.side-column { width: 110px; flex-shrink: 0; display: flex; flex-direction: column; gap: 2px; }
.side-left { order: 0; }
.side-right { order: 2; }

/* ---------- MAIN COLUMN ---------- */
.main-column { flex: 1; display: flex; flex-direction: column; gap: 2px; order: 1; min-width: 0; }

/* ---------- ZONES ---------- */
.zone {
    border: 1px solid var(--border-color); border-radius: var(--radius-md);
    padding: 4px; position: relative; overflow: hidden;
    display: flex; flex-direction: column; min-height: 0;
    transition: border-color var(--transition-fast), background-color var(--transition-fast);
}
.zone-label {
    font-size: 10px; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.8px; color: var(--text-muted); padding: 1px 4px;
    flex-shrink: 0; pointer-events: none;
}
.zone-cards {
    flex: 1; display: flex; flex-wrap: wrap; align-content: flex-start;
    gap: 4px; overflow-y: auto; overflow-x: hidden; padding: 2px; min-height: 0;
}
.zone-cards::-webkit-scrollbar { width: 4px; }
.zone-cards::-webkit-scrollbar-track { background: transparent; }
.zone-cards::-webkit-scrollbar-thumb { background: var(--border-color); border-radius: 2px; }
.zone-battlefield { flex: 1; background: var(--zone-bg-battlefield); }
.zone-hand { height: 90px; min-height: 70px; flex-shrink: 0; background: var(--zone-bg-hand); }
.zone-command { flex: 1; background: var(--zone-bg-command); }
.zone-graveyard { flex: 1; background: var(--zone-bg-graveyard); }
.zone-exile { flex: 1; background: var(--zone-bg-exile); }
.zone-library {
    height: 90px; flex-shrink: 0; background: var(--zone-bg-library);
    display: flex; flex-direction: column; align-items: center; justify-content: center;
}

/* Drop target highlight */
.zone.drop-hover {
    border-color: var(--accent) !important;
    background-color: var(--drop-highlight) !important;
    box-shadow: inset 0 0 20px rgba(233, 69, 96, 0.15);
}

/* ---------- LIBRARY ---------- */
.library-icon { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.library-card-back {
    width: 50px; height: 36px;
    background: linear-gradient(135deg, #3a1f5d 0%, #1a1040 50%, #3a1f5d 100%);
    border-radius: 3px; border: 1px solid #5a3d7a; position: relative;
    box-shadow: 1px 1px 0 #2a1545, 2px 2px 0 #1a1040;
}
.library-card-back::after {
    content: ''; position: absolute; top: 4px; left: 4px; right: 4px; bottom: 4px;
    border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 2px;
    background: radial-gradient(ellipse at center, rgba(100, 60, 140, 0.3) 0%, transparent 70%);
}
.library-count { font-size: 16px; font-weight: 700; color: var(--text-secondary); }

/* ---------- CARDS ---------- */
.card {
    display: inline-flex; flex-direction: column;
    background: var(--bg-card); border: 1px solid var(--border-color);
    border-radius: var(--radius-sm); padding: 2px 3px; cursor: pointer;
    position: relative; width: var(--card-width); height: var(--card-height);
    min-width: var(--card-width); max-width: var(--card-width);
    overflow: hidden; transition: transform var(--transition-fast), box-shadow var(--transition-fast), opacity var(--transition-fast);
    box-shadow: var(--shadow-card); flex-shrink: 0;
}
.card:hover { background: var(--bg-card-hover); box-shadow: var(--shadow-hover); z-index: 10; }
.card-header { display: flex; flex-direction: column; gap: 1px; }
.card-name {
    font-size: var(--card-font); font-weight: 700; color: var(--text-primary);
    overflow: hidden; text-overflow: ellipsis; display: -webkit-box;
    -webkit-line-clamp: 2; -webkit-box-orient: vertical; line-height: 1.15; word-break: break-word;
}
.card-mana {
    font-size: var(--card-font); color: var(--text-secondary);
    display: flex; flex-wrap: wrap; gap: 1px; align-items: center; margin-top: 1px;
}
.card-type {
    font-size: var(--card-font-sm); color: var(--text-muted);
    overflow: hidden; text-overflow: ellipsis; display: -webkit-box;
    -webkit-line-clamp: 2; -webkit-box-orient: vertical; line-height: 1.15; margin-top: 1px;
}
.card-pt {
    font-size: var(--card-font); font-weight: 700; color: var(--text-primary);
    text-align: right; margin-top: auto;
}
.card-custom-pt {
    font-size: var(--card-font); font-weight: 700; color: #fff;
    background: #8b4513; border: 1px solid #a0522d; border-radius: 3px;
    padding: 0 3px; text-align: right; margin-top: auto;
    width: fit-content; margin-left: auto;
}
.card-loyalty {
    font-size: var(--card-font); font-weight: 700; color: #fff;
    background: #3a3a6a; border: 1px solid #5555a0; border-radius: 3px;
    padding: 0 3px; text-align: right; margin-top: auto;
    width: fit-content; margin-left: auto;
}

/* Face down */
.card.face-down .card-header, .card.face-down .card-type, .card.face-down .card-pt,
.card.face-down .card-loyalty, .card.face-down .card-custom-pt,
.card.face-down .card-badge-token, .card.face-down .inventory-toggle { display: none; }
.card.face-down[data-owner="0"] {
    background: repeating-linear-gradient(45deg, #0d2e30, #0d2e30 4px, #082022 4px, #082022 8px) !important;
    border-color: #1a7a80 !important;
}
.card.face-down[data-owner="1"] {
    background: repeating-linear-gradient(45deg, #2a1a3e, #2a1a3e 4px, #1e1030 4px, #1e1030 8px) !important;
    border-color: #7a3aaa !important;
}
.card.face-down[data-conjured="true"] {
    background: repeating-linear-gradient(45deg, #2a2a2e, #2a2a2e 4px, #1e1e22 4px, #1e1e22 8px) !important;
    border-color: #666 !important;
}
.card.face-down::after {
    content: 'Face Down'; display: flex; align-items: center; justify-content: center;
    height: 100%; font-size: 8px; font-weight: 600; color: rgba(255, 255, 255, 0.35);
    text-transform: uppercase; letter-spacing: 1px;
}
.card.face-down[data-fd-type="morph"]::after { content: 'Morph\\A 2/2'; white-space: pre; color: rgba(255, 180, 50, 0.7); }
.card.face-down[data-fd-type="manifest"]::after { content: 'Manifest\\A 2/2'; white-space: pre; color: rgba(100, 160, 255, 0.7); }
.card.face-down[data-fd-type="cloaked"]::after { content: 'Cloaked\\A 2/2'; white-space: pre; color: rgba(200, 200, 255, 0.7); }

/* Tapped */
.card.tapped { transform: rotate(-90deg); opacity: 0.75; margin: 10px 15px; }
/* Attacking */
.card.attacking {
    transform: translateY(-6px);
    box-shadow: 0 0 12px rgba(233, 69, 96, 0.5), var(--shadow-card);
    border-color: var(--accent);
}
.card.tapped.attacking { transform: rotate(-90deg) translateX(6px); }
/* Summoning sickness */
.card.summoning-sick::before {
    content: '\\1F4AB'; position: absolute; top: 0; left: 0; right: 0; bottom: 0;
    display: flex; align-items: center; justify-content: center; font-size: 2.2em;
    background: rgba(0, 0, 0, 0.25); border-radius: var(--radius-sm);
    z-index: 5; pointer-events: none; opacity: 0.7;
}

/* Token badge */
.card-badge-token {
    position: absolute; top: -4px; left: -4px; width: 16px; height: 16px;
    background: var(--accent); color: #fff; font-size: 9px; font-weight: 700;
    display: flex; align-items: center; justify-content: center;
    border-radius: 50%; z-index: 2; line-height: 1;
}
/* Transform badge */
.card-badge-transform {
    position: absolute; top: -4px; right: -4px; width: 16px; height: 16px;
    background: #2196f3; color: #fff; font-size: 10px; font-weight: 700;
    display: flex; align-items: center; justify-content: center;
    border-radius: 50%; z-index: 2; line-height: 1;
}
/* Quantity badge */
.quantity-badge {
    position: absolute; top: 0; right: 0; min-width: 22px; height: 20px;
    background: rgba(0, 0, 0, 0.55); color: rgba(255, 255, 255, 0.85);
    font-size: 14px; font-weight: 700; display: flex; align-items: center; justify-content: center;
    border-radius: 0 var(--radius-sm) 0 6px; z-index: 3; padding: 0 5px;
    backdrop-filter: blur(2px);
}

/* Counter badges */
.card-counters { display: flex; flex-wrap: wrap; gap: 2px; margin-top: 2px; }
.counter-badge {
    display: inline-flex; align-items: center; gap: 2px;
    background: rgba(233, 69, 96, 0.2); border: 1px solid rgba(233, 69, 96, 0.4);
    border-radius: 8px; padding: 0 4px; font-size: 9px; font-weight: 600;
    color: #f0a0b0; line-height: 16px; white-space: nowrap;
}

/* Oracle & note indicators */
.oracle-text-indicator { font-size: 7px; color: #b0b060; opacity: 0.7; margin-top: 1px; }
.note-indicator { font-size: 8px; opacity: 0.8; margin-top: 1px; }

/* Inventory */
.inventory-toggle {
    font-size: 11px; color: #90b0b0; background: rgba(30, 50, 50, 0.7);
    border-radius: 4px; padding: 2px 5px; cursor: pointer; z-index: 2;
}
.card-wrapper { display: inline-flex; flex-direction: row-reverse; align-items: flex-start; vertical-align: top; position: relative; }
.card-inventory {
    display: none; flex-direction: column; width: 0;
    max-height: var(--card-height, 107px); overflow-y: auto; overflow-x: hidden;
    background: rgba(20, 20, 30, 0.75); backdrop-filter: blur(4px);
    border: 1px solid rgba(255, 255, 255, 0.1); border-right: none;
    border-radius: 4px 0 0 4px; padding: 0;
    transition: width 0.15s ease, padding 0.15s ease, opacity 0.15s ease;
    opacity: 0; scrollbar-width: thin;
}
.card-inventory.open { display: flex; width: 90px; padding: 3px; opacity: 1; }
.inventory-section { margin-bottom: 2px; }
.inventory-section-label {
    font-size: 7px; text-transform: uppercase; letter-spacing: 0.5px;
    padding: 1px 3px; border-radius: 2px; margin-bottom: 1px;
}
.inventory-attached .inventory-section-label { color: #7dd3d3; background: rgba(40, 100, 100, 0.3); }
.inventory-exiled .inventory-section-label { color: #c090d0; background: rgba(80, 40, 80, 0.3); }
.inventory-item {
    font-size: 8px; padding: 2px 4px; border-radius: 3px; margin: 1px 0;
    cursor: default; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.inventory-item.inv-attached { color: #7dd3d3; background: rgba(40, 100, 100, 0.5); }
.inventory-item.inv-exiled { color: var(--text-muted); background: rgba(80, 40, 80, 0.4); }

/* ---------- MANA SYMBOLS ---------- */
.mana-symbol {
    display: inline-flex; align-items: center; justify-content: center;
    width: 14px; height: 14px; border-radius: 50%;
    font-size: 9px; font-weight: 700; line-height: 1; flex-shrink: 0;
}
.mana-W { background: #f9faf4; color: #333; }
.mana-U { background: #0e68ab; color: #fff; }
.mana-B { background: #4a4a4a; color: #ccc; }
.mana-R { background: #d3202a; color: #fff; }
.mana-G { background: #00733e; color: #fff; }
.mana-C { background: #888888; color: #fff; }
.mana-generic { background: #6b6b6b; color: #fff; }
.mana-X { background: #6b6b6b; color: #fff; }

/* ---------- CARD COLORS ---------- */
.card.card-color-W { border-left: 3px solid #ffffff; }
.card.card-color-U { border-left: 3px solid #0e68ab; }
.card.card-color-B { border-left: 3px solid #000000; }
.card.card-color-R { border-left: 3px solid #d3202a; }
.card.card-color-G { border-left: 3px solid #00733e; }
.card.card-color-multi { border-left: 3px solid #c7b037; }
.card.card-color-C { border-left: 3px solid #888888; }

/* Card sleeves by owner */
.card[data-owner="0"] { background: var(--p0-card-bg); border-top-color: #1a7a80; border-right-color: #1a7a80; border-bottom-color: #1a7a80; }
.card[data-owner="0"]:hover { background: var(--p0-card-hover); border-top-color: var(--p0-accent); border-right-color: var(--p0-accent); border-bottom-color: var(--p0-accent); }
.card[data-owner="1"] { background: var(--p1-card-bg); border-top-color: #7a3aaa; border-right-color: #7a3aaa; border-bottom-color: #7a3aaa; }
.card[data-owner="1"]:hover { background: var(--p1-card-hover); border-top-color: #c89aff; border-right-color: #c89aff; border-bottom-color: #c89aff; }
.card[data-conjured="true"] { background: #2a2a2e; border-top-color: #666; border-right-color: #666; border-bottom-color: #666; }
.card[data-conjured="true"]:hover { background: #3a3a3e; border-top-color: #999; border-right-color: #999; border-bottom-color: #999; }

/* ---------- MIDDLE BAR ---------- */
#middle-bar {
    display: flex; align-items: center; justify-content: center; gap: 0;
    background: var(--bg-surface); border-top: 2px solid var(--border-color);
    border-bottom: 2px solid var(--border-color); padding: 2px 8px;
    flex-shrink: 0; min-height: 36px; z-index: 20;
}
.middle-section { display: flex; align-items: center; justify-content: center; }
.life-section { flex: 0 0 auto; min-width: 160px; padding: 0 16px; }
.phase-section {
    flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px;
    border-left: 1px solid var(--border-color); border-right: 1px solid var(--border-color); padding: 0 16px;
}

/* ---------- LIFE COUNTER ---------- */
.life-counter { display: flex; flex-direction: row; align-items: center; gap: 4px; }
.life-player-name {
    font-size: 10px; font-weight: 600; color: var(--text-muted);
    text-transform: uppercase; letter-spacing: 0.5px;
}
.life-total {
    font-size: 22px; font-weight: 800; color: var(--text-primary);
    min-width: 40px; text-align: center; cursor: default; line-height: 1; padding: 0 2px;
}
.life-btn {
    width: 22px; height: 22px; border: 1px solid var(--border-color);
    border-radius: var(--radius-sm); background: var(--bg-card);
    color: var(--text-primary); font-size: 13px; font-weight: 700;
    display: flex; align-items: center; justify-content: center;
    transition: background var(--transition-fast), border-color var(--transition-fast);
    padding: 0; line-height: 1;
}
.life-btn:hover { background: var(--bg-card-hover); border-color: var(--accent); }
.life-minus:active { background: rgba(233, 69, 96, 0.3); }
.life-plus:active { background: rgba(0, 180, 100, 0.3); }

.commander-damage-row { display: flex; gap: 6px; }
.cmdr-dmg-item {
    display: flex; align-items: center; gap: 2px;
    background: rgba(233, 69, 96, 0.1); border-radius: 3px; padding: 1px 4px;
    font-size: 9px; color: var(--text-muted);
}
.cmdr-dmg-value { font-weight: 700; color: var(--accent); }

/* ---------- EXTRA COUNTERS ---------- */
.extra-counters-row { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 2px; }
.extra-counter-pill {
    display: flex; align-items: center; gap: 2px;
    background: rgba(100, 150, 230, 0.12); border: 1px solid rgba(100, 150, 230, 0.3);
    border-radius: 4px; padding: 1px 3px; font-size: 9px; color: var(--text-secondary);
    white-space: nowrap;
}
.extra-counter-name { color: var(--text-muted); font-size: 8px; text-transform: uppercase; letter-spacing: 0.3px; }
.extra-counter-val { font-weight: 700; color: #7faaff; min-width: 10px; text-align: center; }
.extra-counter-btn {
    background: none; border: none; color: var(--text-muted); cursor: pointer;
    font-size: 9px; padding: 0 1px; line-height: 1;
}
.extra-counter-btn:hover { color: var(--text-primary); }
.cmdr-tax-pill { background: rgba(200, 160, 60, 0.12); border-color: rgba(200, 160, 60, 0.3); }
.cmdr-tax-pill .extra-counter-val { color: #d4aa40; }

/* ---------- PHASE TRACKER ---------- */
.turn-info {
    font-size: 12px; color: var(--text-secondary); display: flex; align-items: center; gap: 8px;
}
#turn-display { font-weight: 700; color: var(--text-primary); }
.active-player-label { color: var(--text-muted); font-size: 11px; }
#active-player-name { color: var(--accent); font-weight: 600; }
.phase-tracker { display: flex; align-items: center; gap: 2px; flex-wrap: nowrap; }
.phase-step {
    font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 3px;
    color: var(--text-muted); background: transparent; white-space: nowrap;
}
.phase-step.active { background: var(--accent); color: #fff; box-shadow: 0 0 8px var(--accent-glow); }
.phase-arrow { font-size: 8px; color: var(--text-muted); opacity: 0.4; }

/* ---------- BATTLEFIELD SUB-ZONES ---------- */
.zone-cards.bf-groups {
    flex-wrap: nowrap; flex-direction: column; align-content: stretch; gap: 2px; overflow-y: auto;
}
.player-bottom .zone-cards.bf-groups { flex-direction: column-reverse; }
.bf-group {
    flex: 1; min-height: 0; display: flex; flex-direction: column;
    border: 1px solid rgba(255, 255, 255, 0.05); border-radius: var(--radius-sm);
    padding: 2px 3px; gap: 1px;
}
.bf-group.bf-nonliving { flex-direction: row; gap: 2px; }
.bf-subgroup {
    flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px;
    border: 1px solid rgba(255, 255, 255, 0.04); border-radius: var(--radius-sm); padding: 2px;
}
.bf-splitter {
    width: 6px; cursor: col-resize; background: rgba(255, 255, 255, 0.08);
    border-radius: 3px; flex-shrink: 0;
}
.bf-splitter:hover, .bf-splitter:active { background: rgba(255, 255, 255, 0.25); }
.subzone-label {
    font-size: 9px; font-weight: 600; color: var(--text-muted);
    text-transform: uppercase; letter-spacing: 0.5px; padding: 0 2px 1px 2px; flex-shrink: 0;
}
.subzone-cards {
    display: flex; flex-wrap: wrap; gap: 3px; flex: 1;
    align-content: flex-start; min-height: 0; overflow-y: auto;
}

/* ---------- CARD PREVIEW (HOVER) ---------- */
.card-preview {
    position: fixed; z-index: 9000; pointer-events: none;
    border-radius: 12px; overflow: hidden;
    box-shadow: 0 8px 40px rgba(0, 0, 0, 0.7);
    background: var(--bg-surface); border: 1px solid var(--border-color);
}
.card-preview img {
    display: block; width: 265px; height: 370px; object-fit: cover; border-radius: 11px;
}

/* ---------- RESPONSIVE TWEAKS ---------- */
@media (max-width: 1200px) {
    .side-column { width: 90px; }
    .card { width: 65px; height: 91px; min-width: 65px; max-width: 65px; }
    .phase-step { font-size: 9px; padding: 2px 4px; }
}
@media (max-width: 900px) {
    .side-column { width: 70px; }
    .phase-tracker { flex-wrap: wrap; justify-content: center; }
}
`;

// ============================================================
// HTML STRUCTURE
// ============================================================

var HTML_STRUCTURE = `
<div id="board-container">
    <div class="export-banner">
        <span><strong>MTG Board State Export</strong> — Read-only viewer (tap/untap, life +/-, hover preview)</span>
        <span id="export-date"></span>
    </div>

    <!-- OPPONENT (Player 1) - TOP -->
    <div id="player-top" class="player-half player-top" data-player-index="1">
        <div class="player-label">
            <span class="player-name-display" id="player-top-name">Opponent</span>
        </div>
        <div class="player-zones">
            <div class="side-column side-left">
                <div class="zone zone-library" id="zone-library-1">
                    <div class="zone-label">Library</div>
                    <div class="library-icon">
                        <div class="library-card-back"></div>
                        <span class="library-count" id="lib-count-1">0</span>
                    </div>
                </div>
                <div class="zone zone-command" id="zone-command-1">
                    <div class="zone-label">Command</div>
                    <div class="zone-cards"></div>
                </div>
            </div>
            <div class="main-column">
                <div class="zone zone-hand" id="zone-hand-1">
                    <div class="zone-label">Hand (<span id="hand-count-1">0</span>)</div>
                    <div class="zone-cards"></div>
                </div>
                <div class="zone zone-battlefield" id="zone-battlefield-1">
                    <div class="zone-label">Battlefield</div>
                    <div class="zone-cards"></div>
                </div>
            </div>
            <div class="side-column side-right">
                <div class="zone zone-graveyard" id="zone-graveyard-1">
                    <div class="zone-label">GY (<span id="gy-count-1">0</span>)</div>
                    <div class="zone-cards"></div>
                </div>
                <div class="zone zone-exile" id="zone-exile-1">
                    <div class="zone-label">Exile (<span id="ex-count-1">0</span>)</div>
                    <div class="zone-cards"></div>
                </div>
            </div>
        </div>
    </div>

    <!-- MIDDLE BAR -->
    <div id="middle-bar">
        <div class="middle-section life-section">
            <div class="life-counter" id="life-counter-0">
                <span class="life-player-name" id="life-name-0">P1</span>
                <button class="life-btn life-minus" data-player="0" data-delta="-1">&#8722;</button>
                <span class="life-total" id="life-total-0">20</span>
                <button class="life-btn life-plus" data-player="0" data-delta="1">+</button>
                <div class="commander-damage-row" id="cmdr-dmg-0"></div>
                <div class="extra-counters-row" id="extra-counters-0"></div>
            </div>
        </div>
        <div class="middle-section phase-section">
            <div class="turn-info">
                <span id="turn-display">Turn 0</span>
                <span class="active-player-label">&#8212; <span id="active-player-name">...</span>'s Turn</span>
            </div>
            <div class="phase-tracker" id="phase-tracker">
                <span class="phase-step" data-phase="untap">Untap</span>
                <span class="phase-arrow">&#9656;</span>
                <span class="phase-step" data-phase="upkeep">Upkeep</span>
                <span class="phase-arrow">&#9656;</span>
                <span class="phase-step" data-phase="draw">Draw</span>
                <span class="phase-arrow">&#9656;</span>
                <span class="phase-step" data-phase="main1">Main 1</span>
                <span class="phase-arrow">&#9656;</span>
                <span class="phase-step" data-phase="combat_begin">Combat</span>
                <span class="phase-arrow">&#9656;</span>
                <span class="phase-step" data-phase="combat_attackers">Atk</span>
                <span class="phase-arrow">&#9656;</span>
                <span class="phase-step" data-phase="combat_blockers">Blk</span>
                <span class="phase-arrow">&#9656;</span>
                <span class="phase-step" data-phase="combat_damage">Dmg</span>
                <span class="phase-arrow">&#9656;</span>
                <span class="phase-step" data-phase="combat_end">CEnd</span>
                <span class="phase-arrow">&#9656;</span>
                <span class="phase-step" data-phase="main2">Main 2</span>
                <span class="phase-arrow">&#9656;</span>
                <span class="phase-step" data-phase="end_step">End</span>
                <span class="phase-arrow">&#9656;</span>
                <span class="phase-step" data-phase="cleanup">Clean</span>
            </div>
        </div>
        <div class="middle-section life-section">
            <div class="life-counter" id="life-counter-1">
                <span class="life-player-name" id="life-name-1">P2</span>
                <button class="life-btn life-minus" data-player="1" data-delta="-1">&#8722;</button>
                <span class="life-total" id="life-total-1">20</span>
                <button class="life-btn life-plus" data-player="1" data-delta="1">+</button>
                <div class="commander-damage-row" id="cmdr-dmg-1"></div>
                <div class="extra-counters-row" id="extra-counters-1"></div>
            </div>
        </div>
    </div>

    <!-- YOUR SIDE (Player 0) - BOTTOM -->
    <div id="player-bottom" class="player-half player-bottom" data-player-index="0">
        <div class="player-label">
            <span class="player-name-display" id="player-bottom-name">You</span>
        </div>
        <div class="player-zones">
            <div class="side-column side-left">
                <div class="zone zone-command" id="zone-command-0">
                    <div class="zone-label">Command</div>
                    <div class="zone-cards"></div>
                </div>
                <div class="zone zone-library" id="zone-library-0">
                    <div class="zone-label">Library</div>
                    <div class="library-icon">
                        <div class="library-card-back"></div>
                        <span class="library-count" id="lib-count-0">0</span>
                    </div>
                </div>
            </div>
            <div class="main-column">
                <div class="zone zone-battlefield" id="zone-battlefield-0">
                    <div class="zone-label">Battlefield</div>
                    <div class="zone-cards"></div>
                </div>
                <div class="zone zone-hand" id="zone-hand-0">
                    <div class="zone-label">Hand (<span id="hand-count-0">0</span>)</div>
                    <div class="zone-cards"></div>
                </div>
            </div>
            <div class="side-column side-right">
                <div class="zone zone-graveyard" id="zone-graveyard-0">
                    <div class="zone-label">GY (<span id="gy-count-0">0</span>)</div>
                    <div class="zone-cards"></div>
                </div>
                <div class="zone zone-exile" id="zone-exile-0">
                    <div class="zone-label">Exile (<span id="ex-count-0">0</span>)</div>
                    <div class="zone-cards"></div>
                </div>
            </div>
        </div>
    </div>
</div>

<!-- HOVER CARD PREVIEW -->
<div id="card-preview" class="card-preview" style="display: none;">
    <img id="card-preview-img" src="" alt="Card Preview">
</div>
`;

// ============================================================
// VIEWER JAVASCRIPT (runs standalone in the exported HTML)
// ============================================================

var VIEWER_JS = `
(function() {
    'use strict';

    var state = GAME_STATE;

    // ---- Utility ----
    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                  .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    var MANA_REGEX = /\\{([^}]+)\\}/g;
    function renderManaCost(manaCost) {
        if (!manaCost) return '';
        return manaCost.replace(MANA_REGEX, function(match, sym) {
            sym = sym.toUpperCase();
            var cssClass = 'mana-symbol';
            switch (sym) {
                case 'W': cssClass += ' mana-W'; break;
                case 'U': cssClass += ' mana-U'; break;
                case 'B': cssClass += ' mana-B'; break;
                case 'R': cssClass += ' mana-R'; break;
                case 'G': cssClass += ' mana-G'; break;
                case 'C': cssClass += ' mana-C'; break;
                case 'X': cssClass += ' mana-X'; break;
                default: cssClass += ' mana-generic'; break;
            }
            return '<span class="' + cssClass + '">' + escapeHtml(sym) + '</span>';
        });
    }

    function cardColorClass(card) {
        var typeLine = card.type_line || '';
        if (typeLine.indexOf('Land') !== -1) return '';
        var colors = card.colors || [];
        if (colors.length === 0) return 'card-color-C';
        if (colors.length > 1) return 'card-color-multi';
        return 'card-color-' + colors[0];
    }

    function getCardsInZone(zone, playerIndex) {
        var cards = [];
        var allCards = state.cards || {};
        for (var id in allCards) {
            if (!allCards.hasOwnProperty(id)) continue;
            var c = allCards[id];
            if (c.zone === zone && c.controller_index === playerIndex) cards.push(c);
        }
        cards.sort(function(a, b) { return (a.zone_moved_at || 0) - (b.zone_moved_at || 0); });
        return cards;
    }

    function getCardBattlefieldGroup(card) {
        if (card.battlefield_group) return card.battlefield_group;
        var type = card.type_line || '';
        if (type.indexOf('Creature') !== -1) return 'creature';
        if (type.indexOf('Land') !== -1) return 'land';
        return 'other';
    }

    // ---- Card Element Creation ----
    function createCardElement(card) {
        var bf = card.back_face || {};
        var isTransformed = card.transformed && bf.name;
        var displayName = isTransformed ? bf.name : card.name;
        var displayMana = isTransformed ? (bf.mana_cost || '') : card.mana_cost;
        var displayType = isTransformed ? (bf.type_line || '') : card.type_line;
        var displayPower = isTransformed ? bf.power : card.power;
        var displayToughness = isTransformed ? bf.toughness : card.toughness;
        var displayLoyalty = isTransformed ? bf.loyalty : card.loyalty;

        var el = document.createElement('div');
        el.className = 'card ' + cardColorClass(card);
        el.dataset.cardId = card.id;
        el.dataset.owner = card.owner_index;
        el.dataset.controller = card.controller_index;
        if (card.is_conjured) el.dataset.conjured = 'true';
        if (isTransformed) el.classList.add('transformed');
        if (card.tapped) el.classList.add('tapped');
        if (card.summoning_sick) el.classList.add('summoning-sick');
        if (card.attacking) el.classList.add('attacking');
        if (card.face_down) {
            el.classList.add('face-down');
            if (card.face_down_type) el.dataset.fdType = card.face_down_type;
        }

        // Token badge
        var tokenBadge = card.is_token ? '<span class="card-badge-token" title="Token">T</span>' : '';
        var transformBadge = isTransformed ? '<span class="card-badge-transform" title="Transformed">&#8635;</span>' : '';
        var quantityBadge = (card.quantity > 1) ? '<span class="quantity-badge">\\u00d7' + card.quantity + '</span>' : '';

        // Counters
        var counterHtml = '';
        if (card.counters && Object.keys(card.counters).length > 0) {
            counterHtml = '<div class="card-counters">';
            for (var ctype in card.counters) {
                if (card.counters.hasOwnProperty(ctype) && card.counters[ctype] > 0) {
                    counterHtml += '<span class="counter-badge">' + card.counters[ctype] + 'x ' + escapeHtml(ctype) + '</span>';
                }
            }
            counterHtml += '</div>';
        }

        // P/T or loyalty
        var ptHtml = '';
        if (displayPower !== null && displayPower !== undefined && displayToughness !== null && displayToughness !== undefined) {
            ptHtml = '<div class="card-pt">' + escapeHtml(String(displayPower)) + '/' + escapeHtml(String(displayToughness)) + '</div>';
        } else if (displayLoyalty !== null && displayLoyalty !== undefined) {
            ptHtml = '<div class="card-loyalty">Loy: ' + escapeHtml(String(displayLoyalty)) + '</div>';
        }

        // Custom P/T
        var customPtHtml = '';
        if (card.custom_power !== null && card.custom_power !== undefined) {
            customPtHtml = '<div class="card-custom-pt">' + card.custom_power + '/' + card.custom_toughness + '</div>';
        }

        // Oracle / note indicators
        var oracleIndicator = card.show_oracle_text ? '<div class="oracle-text-indicator">\\u2630 Oracle</div>' : '';
        var noteIndicator = card.note ? '<div class="note-indicator" title="' + escapeHtml(card.note) + '">\\ud83d\\udcdd</div>' : '';

        // Inventory toggle (attached/linked)
        var linkedExileData = [];
        if (card.linked_exile_cards && card.linked_exile_cards.length > 0) {
            card.linked_exile_cards.forEach(function(linkedId) {
                var linked = state.cards[linkedId];
                if (linked) linkedExileData.push(linked);
            });
        }
        var attachedData = [];
        if (card.attached_cards && card.attached_cards.length > 0) {
            card.attached_cards.forEach(function(attId) {
                var att = state.cards[attId];
                if (att) attachedData.push(att);
            });
        }
        var hasInventory = linkedExileData.length > 0 || attachedData.length > 0;
        var inventoryToggle = hasInventory
            ? '<div class="inventory-toggle">\\u25b6 ' + (attachedData.length + linkedExileData.length) + '</div>'
            : '';

        el.innerHTML = tokenBadge + transformBadge + quantityBadge +
            '<div class="card-header">' +
                '<div class="card-name">' + escapeHtml(displayName) + '</div>' +
                '<div class="card-mana">' + renderManaCost(displayMana) + '</div>' +
            '</div>' +
            '<div class="card-type">' + escapeHtml(displayType) + '</div>' +
            ptHtml + customPtHtml + counterHtml + oracleIndicator + noteIndicator + inventoryToggle;

        // Click: tap/untap on battlefield
        el.addEventListener('click', function(e) {
            e.stopPropagation();
            if (card.zone === 'battlefield') {
                card.tapped = !card.tapped;
                el.classList.toggle('tapped');
            }
        });

        // Hover: card preview
        el.addEventListener('mouseenter', function(e) { showPreview(card, e); });
        el.addEventListener('mousemove', function(e) { movePreview(e); });
        el.addEventListener('mouseleave', function() { hidePreview(); });

        // Build wrapper with inventory panel if needed
        if (!hasInventory) return el;

        var wrapper = document.createElement('div');
        wrapper.className = 'card-wrapper';
        wrapper.appendChild(el);

        var panel = document.createElement('div');
        panel.className = 'card-inventory open';

        function makeInvItem(invCard, cls) {
            var item = document.createElement('div');
            item.className = 'inventory-item ' + cls;
            item.textContent = invCard.name;
            item.addEventListener('mouseenter', function(e) { showPreview(invCard, e); });
            item.addEventListener('mousemove', function(e) { movePreview(e); });
            item.addEventListener('mouseleave', function() { hidePreview(); });
            return item;
        }

        if (attachedData.length > 0) {
            var sec = document.createElement('div');
            sec.className = 'inventory-section inventory-attached';
            var lbl = document.createElement('div');
            lbl.className = 'inventory-section-label';
            lbl.textContent = 'Attached';
            sec.appendChild(lbl);
            attachedData.forEach(function(c) { sec.appendChild(makeInvItem(c, 'inv-attached')); });
            panel.appendChild(sec);
        }
        if (linkedExileData.length > 0) {
            var sec2 = document.createElement('div');
            sec2.className = 'inventory-section inventory-exiled';
            var lbl2 = document.createElement('div');
            lbl2.className = 'inventory-section-label';
            lbl2.textContent = 'Exiled';
            sec2.appendChild(lbl2);
            linkedExileData.forEach(function(c) { sec2.appendChild(makeInvItem(c, 'inv-exiled')); });
            panel.appendChild(sec2);
        }
        wrapper.appendChild(panel);

        var toggleBtn = el.querySelector('.inventory-toggle');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                var isOpen = panel.classList.toggle('open');
                toggleBtn.textContent = (isOpen ? '\\u25b6 ' : '\\u25c0 ') +
                    (attachedData.length + linkedExileData.length);
            });
        }

        return wrapper;
    }

    // ---- Card Preview ----
    var previewEl = null;
    var previewImg = null;

    function showPreview(card, e) {
        if (!previewEl) {
            previewEl = document.getElementById('card-preview');
            previewImg = document.getElementById('card-preview-img');
        }
        var src = card.large_image_uri || card.image_uri || '';
        if (!src) { previewEl.style.display = 'none'; return; }
        previewImg.src = src;
        previewEl.style.display = 'block';
        movePreview(e);
    }

    function movePreview(e) {
        if (!previewEl || previewEl.style.display === 'none') return;
        var x = e.clientX + 20;
        var y = e.clientY - 100;
        var vw = window.innerWidth;
        var vh = window.innerHeight;
        if (x + 280 > vw) x = e.clientX - 285;
        if (y + 385 > vh) y = vh - 385;
        if (y < 5) y = 5;
        previewEl.style.left = x + 'px';
        previewEl.style.top = y + 'px';
    }

    function hidePreview() {
        if (previewEl) previewEl.style.display = 'none';
    }

    // ---- Rendering ----
    function renderBattlefieldZone(zoneId, cards) {
        var zoneEl = document.getElementById(zoneId);
        if (!zoneEl) return;
        var container = zoneEl.querySelector('.zone-cards');
        if (!container) return;

        var visibleCards = cards.filter(function(c) { return !c.attached_to; });
        var creatures = visibleCards.filter(function(c) { return getCardBattlefieldGroup(c) === 'creature'; });
        var lands = visibleCards.filter(function(c) { return getCardBattlefieldGroup(c) === 'land'; });
        var other = visibleCards.filter(function(c) { return getCardBattlefieldGroup(c) === 'other'; });

        container.className = 'zone-cards bf-groups';
        container.innerHTML = '';

        function makeSubzone(cssClass, label, cardList) {
            var div = document.createElement('div');
            div.className = cssClass;
            var lbl = document.createElement('div');
            lbl.className = 'subzone-label';
            lbl.textContent = label + (cardList.length ? ' (' + cardList.length + ')' : '');
            var cardsDiv = document.createElement('div');
            cardsDiv.className = 'subzone-cards';
            cardList.forEach(function(c) { cardsDiv.appendChild(createCardElement(c)); });
            div.appendChild(lbl);
            div.appendChild(cardsDiv);
            return div;
        }

        var nonliving = document.createElement('div');
        nonliving.className = 'bf-group bf-nonliving';
        nonliving.appendChild(makeSubzone('bf-subgroup bf-lands', 'Lands', lands));

        var splitter = document.createElement('div');
        splitter.className = 'bf-splitter';
        nonliving.appendChild(splitter);

        nonliving.appendChild(makeSubzone('bf-subgroup bf-other', 'Other', other));
        container.appendChild(nonliving);
        container.appendChild(makeSubzone('bf-group bf-creatures', 'Creatures', creatures));
    }

    function renderZoneCards(zoneId, cards) {
        var zoneEl = document.getElementById(zoneId);
        if (!zoneEl) return;
        var container = zoneEl.querySelector('.zone-cards');
        if (!container) return;
        container.innerHTML = '';
        cards.forEach(function(card) { container.appendChild(createCardElement(card)); });
    }

    function renderPlayerZones(playerIndex) {
        renderBattlefieldZone('zone-battlefield-' + playerIndex, getCardsInZone('battlefield', playerIndex));
        renderZoneCards('zone-hand-' + playerIndex, getCardsInZone('hand', playerIndex));
        renderZoneCards('zone-command-' + playerIndex, getCardsInZone('command_zone', playerIndex));

        var libCards = getCardsInZone('library', playerIndex);
        document.getElementById('lib-count-' + playerIndex).textContent = libCards.length;

        // Graveyard: show ALL cards (not just top)
        var gyCards = getCardsInZone('graveyard', playerIndex);
        document.getElementById('gy-count-' + playerIndex).textContent = gyCards.length;
        renderZoneCards('zone-graveyard-' + playerIndex, gyCards);

        // Exile: show ALL cards
        var exCards = getCardsInZone('exile', playerIndex);
        document.getElementById('ex-count-' + playerIndex).textContent = exCards.length;
        renderZoneCards('zone-exile-' + playerIndex, exCards);

        document.getElementById('hand-count-' + playerIndex).textContent = getCardsInZone('hand', playerIndex).length;
    }

    function renderCommanderDamage(playerIndex) {
        var row = document.getElementById('cmdr-dmg-' + playerIndex);
        if (!row) return;
        var player = state.players[playerIndex];
        if (!player) return;
        row.innerHTML = '';
        var dmg = player.commander_damage_received || {};
        for (var src in dmg) {
            if (!dmg.hasOwnProperty(src) || dmg[src] <= 0) continue;
            var item = document.createElement('span');
            item.className = 'cmdr-dmg-item';
            item.innerHTML = '<span>' + escapeHtml(src) + '</span> <span class="cmdr-dmg-value">' + dmg[src] + '</span>';
            row.appendChild(item);
        }
    }

    function renderExtraCounters(playerIndex) {
        var row = document.getElementById('extra-counters-' + playerIndex);
        if (!row) return;
        var player = state.players[playerIndex];
        if (!player) return;
        row.innerHTML = '';

        // Commander Tax
        var taxes = player.commander_taxes || {};
        var taxNames = Object.keys(taxes);
        taxNames.forEach(function(cmdName) {
            var tax = taxes[cmdName];
            if (tax <= 0) return;
            var label = taxNames.length > 1 ? escapeHtml(cmdName) : 'Tax';
            var pill = document.createElement('span');
            pill.className = 'extra-counter-pill cmdr-tax-pill';
            pill.innerHTML =
                '<span class="extra-counter-btn" data-field="tax" data-player="' + playerIndex + '" data-commander="' + escapeHtml(cmdName) + '" data-delta="-2">\\u2212</span>' +
                '<span class="extra-counter-name">' + label + '</span>' +
                '<span class="extra-counter-val">' + tax + '</span>' +
                '<span class="extra-counter-btn" data-field="tax" data-player="' + playerIndex + '" data-commander="' + escapeHtml(cmdName) + '" data-delta="2">+</span>';
            row.appendChild(pill);
        });

        // Extra counters (Poison, Experience, etc.)
        var counters = player.extra_counters || {};
        for (var name in counters) {
            if (!counters.hasOwnProperty(name) || counters[name] <= 0) continue;
            var pill = document.createElement('span');
            pill.className = 'extra-counter-pill';
            pill.innerHTML =
                '<span class="extra-counter-btn" data-field="extra" data-player="' + playerIndex + '" data-name="' + escapeHtml(name) + '" data-delta="-1">\\u2212</span>' +
                '<span class="extra-counter-name">' + escapeHtml(name) + '</span>' +
                '<span class="extra-counter-val">' + counters[name] + '</span>' +
                '<span class="extra-counter-btn" data-field="extra" data-player="' + playerIndex + '" data-name="' + escapeHtml(name) + '" data-delta="1">+</span>';
            row.appendChild(pill);
        }

        // Wire up counter buttons
        row.querySelectorAll('.extra-counter-btn').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                var pi = parseInt(this.dataset.player, 10);
                var delta = parseInt(this.dataset.delta, 10);
                if (this.dataset.field === 'tax') {
                    var cmd = this.dataset.commander;
                    state.players[pi].commander_taxes[cmd] = Math.max(0, (state.players[pi].commander_taxes[cmd] || 0) + delta);
                } else {
                    var n = this.dataset.name;
                    state.players[pi].extra_counters[n] = Math.max(0, (state.players[pi].extra_counters[n] || 0) + delta);
                }
                renderExtraCounters(pi);
            });
        });
    }

    function renderPhaseTracker(currentPhase) {
        var steps = document.querySelectorAll('.phase-step');
        for (var i = 0; i < steps.length; i++) {
            steps[i].classList.toggle('active', steps[i].dataset.phase === currentPhase);
        }
    }

    // ---- Life Buttons ----
    document.querySelectorAll('.life-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            var pi = parseInt(this.dataset.player, 10);
            var delta = parseInt(this.dataset.delta, 10);
            state.players[pi].life += delta;
            document.getElementById('life-total-' + pi).textContent = state.players[pi].life;
        });
    });

    // ---- Full Render ----
    function renderBoard() {
        var numPlayers = state.players ? state.players.length : 0;

        if (numPlayers > 0) {
            document.getElementById('player-bottom-name').textContent = state.players[0].name + ' (You)';
            document.getElementById('life-name-0').textContent = state.players[0].name;
        }
        if (numPlayers > 1) {
            document.getElementById('player-top-name').textContent = state.players[1].name + ' (Opponent)';
            document.getElementById('life-name-1').textContent = state.players[1].name;
        }

        for (var pi = 0; pi < numPlayers && pi < 2; pi++) {
            renderPlayerZones(pi);
            document.getElementById('life-total-' + pi).textContent = state.players[pi].life;
            renderCommanderDamage(pi);
            renderExtraCounters(pi);
        }

        document.getElementById('turn-display').textContent = 'Turn ' + state.turn;
        if (state.players[state.active_player_index]) {
            document.getElementById('active-player-name').textContent =
                state.players[state.active_player_index].name;
        }
        renderPhaseTracker(state.phase);

        document.getElementById('export-date').textContent = 'Exported: ' + new Date().toLocaleString();
    }

    document.addEventListener('DOMContentLoaded', renderBoard);
})();
`;
