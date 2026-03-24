/* ============================================================
   utils.js - Shared utilities for MTG Board State Tracker
   Used by: board.js, command.js
   Provides: window.MTGUtils
   ============================================================ */

window.MTGUtils = {
    /**
     * Convert mana cost string like "{2}{U}{B}" to styled HTML spans.
     */
    renderManaCost(manaCost) {
        if (!manaCost) return '';
        return manaCost.replace(/\{([^}]+)\}/g, (match, symbol) => {
            const colorClass = MTGUtils._getColorClass(symbol);
            return '<span class="mana-symbol ' + colorClass + '">' + symbol + '</span>';
        });
    },

    /**
     * Map a mana symbol string to the appropriate CSS class.
     */
    _getColorClass(symbol) {
        const map = {
            'W': 'mana-W',
            'U': 'mana-U',
            'B': 'mana-B',
            'R': 'mana-R',
            'G': 'mana-G',
            'C': 'mana-C'
        };
        if (map[symbol]) return map[symbol];
        // Hybrid/special symbols - use first color found
        for (const c of ['W', 'U', 'B', 'R', 'G']) {
            if (symbol.includes(c)) return map[c];
        }
        // Numeric / generic mana
        return 'mana-generic';
    },

    /**
     * Get the primary CSS color value for a card (useful for drag indicators, borders).
     */
    getCardColor(card) {
        if (!card.colors || card.colors.length === 0) return 'var(--mana-colorless)';
        if (card.colors.length > 1) return 'var(--mana-gold)';
        const colorMap = {
            W: 'var(--mana-white)',
            U: 'var(--mana-blue)',
            B: 'var(--mana-black)',
            R: 'var(--mana-red)',
            G: 'var(--mana-green)'
        };
        return colorMap[card.colors[0]] || 'var(--mana-colorless)';
    },

    /**
     * Format counters object into a readable string.
     */
    formatCounters(counters) {
        if (!counters || Object.keys(counters).length === 0) return '';
        return Object.entries(counters)
            .filter(([_, v]) => v > 0)
            .map(([type, count]) => type + ' \u00d7' + count)
            .join(', ');
    },

    /**
     * Phase display names.
     */
    phaseNames: {
        untap: 'Untap',
        upkeep: 'Upkeep',
        draw: 'Draw',
        main1: 'Main 1',
        combat_begin: 'Begin Combat',
        combat_attackers: 'Declare Attackers',
        combat_blockers: 'Declare Blockers',
        combat_damage: 'Combat Damage',
        combat_end: 'End Combat',
        main2: 'Main 2',
        end_step: 'End Step',
        cleanup: 'Cleanup'
    },

    /**
     * Phase order for sequential rendering.
     */
    phaseOrder: [
        'untap', 'upkeep', 'draw', 'main1',
        'combat_begin', 'combat_attackers', 'combat_blockers',
        'combat_damage', 'combat_end',
        'main2', 'end_step', 'cleanup'
    ],

    /**
     * Zone display names.
     */
    zoneNames: {
        library: 'Library',
        hand: 'Hand',
        battlefield: 'Battlefield',
        graveyard: 'Graveyard',
        exile: 'Exile',
        exile_linked: 'Linked Exile',
        command_zone: 'Command Zone'
    },

    /**
     * Get all cards controlled by a player in a specific zone.
     */
    getCardsInZone(state, playerIndex, zone) {
        if (!state || !state.cards) return [];
        return Object.values(state.cards).filter(function (c) {
            return c.controller_index === playerIndex && c.zone === zone;
        });
    },

    /**
     * Get all cards owned by a player in a specific zone.
     */
    getOwnedCardsInZone(state, playerIndex, zone) {
        if (!state || !state.cards) return [];
        return Object.values(state.cards).filter(function (c) {
            return c.owner_index === playerIndex && c.zone === zone;
        });
    },

    /**
     * Truncate text with ellipsis.
     */
    truncate(text, maxLen) {
        if (!text || text.length <= maxLen) return text || '';
        return text.substring(0, maxLen - 3) + '...';
    },

    /**
     * Format an ISO timestamp string to HH:MM:SS (German locale).
     */
    formatTime(isoString) {
        if (!isoString) return '';
        const d = new Date(isoString);
        return d.toLocaleTimeString('de-DE', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    },

    /**
     * Escape HTML special characters to prevent XSS.
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    /**
     * Create an HTML element with attributes and children.
     */
    createElement(tag, attrs, children) {
        const el = document.createElement(tag);
        if (attrs) {
            for (const [key, value] of Object.entries(attrs)) {
                if (key === 'className') {
                    el.className = value;
                } else if (key === 'textContent') {
                    el.textContent = value;
                } else if (key === 'innerHTML') {
                    el.innerHTML = value;
                } else if (key.startsWith('on')) {
                    el.addEventListener(key.substring(2).toLowerCase(), value);
                } else {
                    el.setAttribute(key, value);
                }
            }
        }
        if (children) {
            if (typeof children === 'string') {
                el.textContent = children;
            } else if (Array.isArray(children)) {
                children.forEach(function (child) {
                    if (typeof child === 'string') {
                        el.appendChild(document.createTextNode(child));
                    } else if (child) {
                        el.appendChild(child);
                    }
                });
            }
        }
        return el;
    }
};
