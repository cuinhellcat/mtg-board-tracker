/**
 * MTG Board State Tracker - Drag and Drop Module
 * Handles all drag-and-drop interactions for moving cards between zones.
 *
 * Uses the HTML5 Drag and Drop API with custom drag images (compact colored
 * "knödel" showing just the card name).
 */

(function () {
    'use strict';

    /* ------------------------------------------------------------------ */
    /*  Color helpers                                                      */
    /* ------------------------------------------------------------------ */

    /** Map a card's colors array to a single background color for the drag ghost. */
    function ghostColorForCard(cardEl) {
        var colors = (cardEl.dataset.colors || '').split(',').filter(Boolean);
        if (colors.length === 0) return '#888888';   // Colorless
        if (colors.length > 1) return '#c7b037';     // Multicolor / Gold
        switch (colors[0]) {
            case 'W': return '#f9faf4';
            case 'U': return '#0e68ab';
            case 'B': return '#4a4a4a';
            case 'R': return '#d3202a';
            case 'G': return '#00733e';
            default:  return '#888888';
        }
    }

    /** Pick a legible text color given the ghost background. */
    function ghostTextColor(bg) {
        // Light backgrounds get dark text
        if (bg === '#f9faf4' || bg === '#c7b037') return '#333';
        return '#fff';
    }

    /* ------------------------------------------------------------------ */
    /*  Ghost element management                                           */
    /* ------------------------------------------------------------------ */

    var _ghostEl = null;

    function createGhost(cardEl) {
        removeGhost();
        var ghost = document.createElement('div');
        ghost.className = 'drag-ghost';
        var bg = ghostColorForCard(cardEl);
        ghost.style.background = bg;
        ghost.style.color = ghostTextColor(bg);
        ghost.textContent = cardEl.dataset.cardName || '?';
        document.body.appendChild(ghost);
        _ghostEl = ghost;
        return ghost;
    }

    function removeGhost() {
        if (_ghostEl && _ghostEl.parentNode) {
            _ghostEl.parentNode.removeChild(_ghostEl);
        }
        _ghostEl = null;
    }

    /* ------------------------------------------------------------------ */
    /*  Drag handlers (attached to card elements)                          */
    /* ------------------------------------------------------------------ */

    function onDragStart(e) {
        var cardEl = e.currentTarget;
        var cardId = cardEl.dataset.cardId;
        if (!cardId) {
            e.preventDefault();
            return;
        }

        // Store card id in the transfer
        e.dataTransfer.setData('text/plain', cardId);
        e.dataTransfer.effectAllowed = 'move';

        // Create custom drag image (compact knödel)
        var ghost = createGhost(cardEl);
        // Position ghost off-screen so it renders but the user sees it as the drag image
        try {
            e.dataTransfer.setDragImage(ghost, ghost.offsetWidth / 2, ghost.offsetHeight / 2);
        } catch (_ignored) {
            // setDragImage may throw in some older browsers; drag still works
        }

        // Visual feedback on the source card
        cardEl.classList.add('dragging');
    }

    function onDragEnd(e) {
        e.currentTarget.classList.remove('dragging');
        removeGhost();
        // Remove all drop-hover highlights (safety cleanup)
        var highlighted = document.querySelectorAll('.drop-hover');
        for (var i = 0; i < highlighted.length; i++) {
            highlighted[i].classList.remove('drop-hover');
        }
        clearSubzoneHighlights();
    }

    /* ------------------------------------------------------------------ */
    /*  Drop-target handlers (attached to zone elements)                   */
    /* ------------------------------------------------------------------ */

    function findZoneFromTarget(el) {
        // Walk up the DOM until we find a .zone element
        while (el && !el.classList.contains('zone')) {
            el = el.parentElement;
        }
        return el;
    }

    /** Walk up from drop target to find if we're inside a battlefield subzone. */
    function findBattlefieldGroup(el) {
        while (el && !el.classList.contains('zone')) {
            if (el.classList.contains('bf-drop-subzone') && el.dataset.battlefieldGroup) {
                return el.dataset.battlefieldGroup;
            }
            el = el.parentElement;
        }
        return null;
    }

    /** Find the nearest subzone or zone for highlight purposes. */
    function findHighlightTarget(el) {
        while (el && !el.classList.contains('zone')) {
            if (el.classList.contains('bf-drop-subzone')) return el;
            el = el.parentElement;
        }
        return el; // fallback to zone
    }

    function clearSubzoneHighlights() {
        var highlighted = document.querySelectorAll('.bf-drop-subzone.drop-hover-subzone');
        for (var i = 0; i < highlighted.length; i++) {
            highlighted[i].classList.remove('drop-hover-subzone');
        }
    }

    function onDragOver(e) {
        e.preventDefault(); // required to allow drop
        e.dataTransfer.dropEffect = 'move';

        var zone = findZoneFromTarget(e.target);
        if (zone) zone.classList.add('drop-hover');

        // Highlight specific subzone
        clearSubzoneHighlights();
        var subzone = findHighlightTarget(e.target);
        if (subzone && subzone.classList.contains('bf-drop-subzone')) {
            subzone.classList.add('drop-hover-subzone');
        }
    }

    function onDragEnter(e) {
        e.preventDefault();
        var zone = findZoneFromTarget(e.target);
        if (zone) zone.classList.add('drop-hover');
    }

    function onDragLeave(e) {
        var zone = findZoneFromTarget(e.target);
        if (!zone) return;

        // Only remove highlight if we truly left the zone (not just moved to a child)
        var related = e.relatedTarget;
        if (related && zone.contains(related)) return;
        zone.classList.remove('drop-hover');
        clearSubzoneHighlights();
    }

    function onDrop(e) {
        e.preventDefault();
        var zone = findZoneFromTarget(e.target);
        if (!zone) return;

        zone.classList.remove('drop-hover');

        var cardId = e.dataTransfer.getData('text/plain');
        if (!cardId) return;

        var targetZone = zone.dataset.zone;
        var targetPlayerIndex = parseInt(zone.dataset.playerIndex, 10);

        if (isNaN(targetPlayerIndex) || !targetZone) return;

        // Check if dropped on a specific battlefield subzone
        var battlefieldGroup = findBattlefieldGroup(e.target);

        // Send move_card action via WebSocket
        var msg = {
            action: 'move_card',
            card_id: cardId,
            to_zone: targetZone
        };
        // Stack is a shared zone — preserve the card's existing controller
        if (targetZone !== 'stack') {
            msg.to_player_index = targetPlayerIndex;
        }
        if (battlefieldGroup) {
            msg.battlefield_group = battlefieldGroup;
        }
        if (window.MTGSocket) {
            window.MTGSocket.send(msg);
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Public API                                                         */
    /* ------------------------------------------------------------------ */

    window.DragDrop = {
        /**
         * Initialize the drag-drop system.
         * Call once on page load. Sets up zone drop targets for all existing zones.
         */
        init: function () {
            var zones = document.querySelectorAll('.zone');
            for (var i = 0; i < zones.length; i++) {
                this.makeZoneDropTarget(zones[i]);
            }
        },

        /**
         * Make a card element draggable.
         * @param {HTMLElement} cardEl - A .card element with data-card-id set.
         */
        makeCardDraggable: function (cardEl) {
            if (!cardEl || cardEl._dragInitialized) return;
            cardEl.setAttribute('draggable', 'true');
            cardEl.addEventListener('dragstart', onDragStart);
            cardEl.addEventListener('dragend', onDragEnd);
            cardEl._dragInitialized = true;
        },

        /**
         * Set up a zone element as a drop target.
         * @param {HTMLElement} zoneEl - A .zone element with data-zone and data-player-index.
         */
        makeZoneDropTarget: function (zoneEl) {
            if (!zoneEl || zoneEl._dropInitialized) return;
            zoneEl.addEventListener('dragover', onDragOver);
            zoneEl.addEventListener('dragenter', onDragEnter);
            zoneEl.addEventListener('dragleave', onDragLeave);
            zoneEl.addEventListener('drop', onDrop);
            zoneEl._dropInitialized = true;
        }
    };
})();
