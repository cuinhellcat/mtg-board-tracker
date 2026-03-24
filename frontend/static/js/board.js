/**
 * MTG Board State Tracker - Board Window Main Logic
 * Handles state rendering, card creation, context menus, hover previews,
 * life counters, phase tracker, scry modal, search library modal, and
 * zone viewer modals.
 */

(function () {
    'use strict';

    /* ==================================================================
       STATE
       ================================================================== */

    /** @type {Object|null} The latest GameState received from the server. */
    var currentState = null;

    /** @type {string|null} Card ID being context-menu'd. */
    var contextCardId = null;

    /** @type {number|null} Player index for library context menu. */
    var contextLibraryPlayer = null;

    /** @type {number|null} Player index for battlefield context menu. */
    var contextBattlefieldPlayer = null;

    /** @type {boolean} Whether we are in "link exile" mode waiting for a click. */
    var linkExileMode = false;

    /** @type {string|null} Card ID to link as exile child. */
    var linkExileCardId = null;

    /** @type {boolean} Whether we are in "attach card" mode waiting for a click. */
    var attachMode = false;

    /** @type {string|null} Card ID to attach (Aura/Equipment). */
    var attachCardId = null;

    /** @type {string|null} Card ID selected in search modal. */
    var searchSelectedCardId = null;

    /** @type {number|null} Player index for search/scry. */
    var searchPlayerIndex = null;

    /** Debounce token for render. */
    var _renderRafId = null;

    /* ==================================================================
       ERROR TOAST
       ================================================================== */

    function showErrorToast(message) {
        var toast = document.createElement('div');
        toast.style.cssText = 'position:fixed;top:20px;right:20px;background:#c0392b;color:#fff;padding:10px 18px;border-radius:6px;z-index:99999;font-size:13px;max-width:400px;box-shadow:0 4px 12px rgba(0,0,0,0.4);';
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(function () { toast.remove(); }, 5000);
    }

    /* ==================================================================
       CARD PICKER (autocomplete search modal)
       ================================================================== */

    var _pickerCallback = null;
    var _pickerDebounce = null;
    var _pickerActiveIndex = -1;
    var _pickerResults = [];

    /**
     * Open the card picker modal.
     * @param {string} title - Modal title text
     * @param {function(Object)} onSelect - Callback with {name, type_line} or {name} for free text
     */
    function openCardPicker(title, onSelect) {
        _pickerCallback = onSelect;
        _pickerActiveIndex = -1;
        _pickerResults = [];

        var modal = document.getElementById('card-picker-modal');
        var input = document.getElementById('card-picker-input');
        var results = document.getElementById('card-picker-results');
        document.getElementById('card-picker-title').textContent = title;

        input.value = '';
        results.innerHTML = '';
        modal.style.display = '';

        setTimeout(function () { input.focus(); }, 50);
    }

    function closeCardPicker() {
        document.getElementById('card-picker-modal').style.display = 'none';
        _pickerCallback = null;
        _pickerResults = [];
        _pickerActiveIndex = -1;
    }

    function _pickerRenderResults(items) {
        _pickerResults = items;
        _pickerActiveIndex = items.length > 0 ? 0 : -1;
        var container = document.getElementById('card-picker-results');
        container.innerHTML = '';

        items.forEach(function (card, i) {
            var div = document.createElement('div');
            div.className = 'card-picker-item' + (i === 0 ? ' active' : '');

            var nameSpan = document.createElement('span');
            nameSpan.className = 'card-picker-name';
            nameSpan.textContent = card.name;
            div.appendChild(nameSpan);

            var typeLine = card.type_line || '';
            var isToken = typeLine.toLowerCase().indexOf('token') !== -1;
            if (isToken) {
                var badge = document.createElement('span');
                badge.className = 'card-picker-badge-token';
                badge.textContent = 'TOKEN';
                div.appendChild(badge);
            }

            var typeSpan = document.createElement('span');
            typeSpan.className = 'card-picker-type';
            typeSpan.textContent = typeLine;
            div.appendChild(typeSpan);

            (function (c) {
                div.addEventListener('click', function () {
                    var cb = _pickerCallback;
                    closeCardPicker();
                    if (cb) cb(c);
                });
            })(card);

            container.appendChild(div);
        });
    }

    function _pickerSetActive(index) {
        var items = document.querySelectorAll('#card-picker-results .card-picker-item');
        if (_pickerActiveIndex >= 0 && _pickerActiveIndex < items.length) {
            items[_pickerActiveIndex].classList.remove('active');
        }
        _pickerActiveIndex = index;
        if (index >= 0 && index < items.length) {
            items[index].classList.add('active');
            items[index].scrollIntoView({ block: 'nearest' });
        }
    }

    // Event listeners for card picker
    document.addEventListener('DOMContentLoaded', function () {
        var input = document.getElementById('card-picker-input');
        if (!input) return;

        input.addEventListener('input', function () {
            var query = this.value.trim();
            clearTimeout(_pickerDebounce);
            if (query.length < 2) {
                document.getElementById('card-picker-results').innerHTML = '';
                _pickerResults = [];
                return;
            }
            _pickerDebounce = setTimeout(function () {
                fetch('/api/cards/search?q=' + encodeURIComponent(query) + '&limit=15')
                    .then(function (r) { return r.json(); })
                    .then(function (data) {
                        _pickerRenderResults(data.results || []);
                    });
            }, 150);
        });

        input.addEventListener('keydown', function (e) {
            var count = _pickerResults.length;
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (_pickerActiveIndex < count - 1) _pickerSetActive(_pickerActiveIndex + 1);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (_pickerActiveIndex > 0) _pickerSetActive(_pickerActiveIndex - 1);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (_pickerActiveIndex >= 0 && _pickerActiveIndex < count) {
                    var card = _pickerResults[_pickerActiveIndex];
                    var cb = _pickerCallback;
                    closeCardPicker();
                    if (cb) cb(card);
                } else if (this.value.trim()) {
                    // Free text entry (no match selected)
                    var text = this.value.trim();
                    var cb2 = _pickerCallback;
                    closeCardPicker();
                    if (cb2) cb2({ name: text });
                }
            } else if (e.key === 'Escape') {
                closeCardPicker();
            }
        });

        document.getElementById('card-picker-cancel').addEventListener('click', closeCardPicker);
        document.getElementById('card-picker-modal').addEventListener('click', function (e) {
            if (e.target === this) closeCardPicker();
        });
    });

    /* ==================================================================
       MANA SYMBOL RENDERING
       ================================================================== */

    var MANA_REGEX = /\{([^}]+)\}/g;

    /**
     * Convert a mana cost string like "{2}{U}{B}" into HTML with styled spans.
     * @param {string} manaCost
     * @param {boolean} [large] - Use large mana symbols.
     * @returns {string} HTML string
     */
    function renderManaCost(manaCost, large) {
        if (!manaCost) return '';
        var sizeClass = large ? ' mana-symbol-lg' : '';
        return manaCost.replace(MANA_REGEX, function (match, sym) {
            sym = sym.toUpperCase();
            var cssClass = 'mana-symbol' + sizeClass;
            var label = sym;

            switch (sym) {
                case 'W': cssClass += ' mana-W'; label = 'W'; break;
                case 'U': cssClass += ' mana-U'; label = 'U'; break;
                case 'B': cssClass += ' mana-B'; label = 'B'; break;
                case 'R': cssClass += ' mana-R'; label = 'R'; break;
                case 'G': cssClass += ' mana-G'; label = 'G'; break;
                case 'C': cssClass += ' mana-C'; label = 'C'; break;
                case 'X': cssClass += ' mana-X'; label = 'X'; break;
                default:
                    // Numeric or hybrid - treat as generic
                    cssClass += ' mana-generic';
                    label = sym;
                    break;
            }
            return '<span class="' + cssClass + '">' + escapeHtml(label) + '</span>';
        });
    }

    /* ==================================================================
       UTILITY
       ================================================================== */

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                  .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    /** Get cards from state filtered by zone and player index. */
    function getCardsInZone(state, zone, playerIndex) {
        var cards = [];
        var allCards = state.cards || {};
        for (var id in allCards) {
            if (!allCards.hasOwnProperty(id)) continue;
            var c = allCards[id];
            if (c.zone === zone && c.controller_index === playerIndex) {
                cards.push(c);
            }
        }
        return cards;
    }

    /** Determine the primary color class for a card. */
    function cardColorClass(card) {
        var typeLine = card.type_line || '';
        if (typeLine.indexOf('Land') !== -1) return '';
        var colors = card.colors || [];
        if (colors.length === 0) return 'card-color-C';
        if (colors.length > 1) return 'card-color-multi';
        return 'card-color-' + colors[0];
    }

    /** Position an element (context menu, preview) within viewport. */
    function clampToViewport(el, x, y) {
        var vw = window.innerWidth;
        var vh = window.innerHeight;
        var rect = el.getBoundingClientRect();
        var w = rect.width || el.offsetWidth || 200;
        var h = rect.height || el.offsetHeight || 300;

        if (x + w > vw - 8) x = vw - w - 8;
        if (y + h > vh - 8) y = vh - h - 8;
        if (x < 8) x = 8;
        if (y < 8) y = 8;

        el.style.left = x + 'px';
        el.style.top = y + 'px';
    }

    /* ==================================================================
       CARD ELEMENT CREATION
       ================================================================== */

    /**
     * Create a DOM element for a card.
     * @param {Object} card - CardState from the game state.
     * @returns {HTMLElement}
     */
    function createCardElement(card) {
        // Resolve display values — use back face data when transformed
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
        el.dataset.cardName = displayName;
        el.dataset.zone = card.zone;
        el.dataset.owner = card.owner_index;
        el.dataset.controller = card.controller_index;
        el.dataset.colors = (card.colors || []).join(',');
        if (card.is_conjured) el.dataset.conjured = 'true';
        if (isTransformed) el.classList.add('transformed');

        if (card.tapped) el.classList.add('tapped');
        if (card.attacking) el.classList.add('attacking');
        if (card.face_down) {
            el.classList.add('face-down');
            if (card.face_down_type) el.dataset.fdType = card.face_down_type;
        }

        // Token badge
        var tokenBadge = '';
        if (card.is_token) {
            tokenBadge = '<span class="card-badge-token" title="Token">T</span>';
        }

        // Transform badge
        var transformBadge = '';
        if (isTransformed) {
            transformBadge = '<span class="card-badge-transform" title="Transformed">↻</span>';
        }

        // Counters (clickable: left +1, right -1)
        var counterHtml = '';
        var counterTypes = [];
        if (card.counters && Object.keys(card.counters).length > 0) {
            counterHtml = '<div class="card-counters">';
            for (var ctype in card.counters) {
                if (card.counters.hasOwnProperty(ctype) && card.counters[ctype] > 0) {
                    counterTypes.push(ctype);
                    counterHtml += '<span class="counter-badge counter-badge-clickable" data-counter-type="' +
                        escapeHtml(ctype) + '" title="Left-click: +1 / Right-click: -1">' +
                        card.counters[ctype] + 'x ' + escapeHtml(ctype) + '</span>';
                }
            }
            counterHtml += '</div>';
        }

        // Power/toughness or loyalty
        var ptHtml = '';
        var hasCustomPt = card.custom_power !== null && card.custom_power !== undefined;
        if (displayPower !== null && displayToughness !== null) {
            ptHtml = '<div class="card-pt">' + escapeHtml(displayPower) + '/' + escapeHtml(displayToughness) + '</div>';
        } else if (displayLoyalty !== null) {
            ptHtml = '<div class="card-pt">Loy: ' + escapeHtml(String(displayLoyalty)) + '</div>';
        }

        // Custom P/T badge (manual override, e.g. animated lands)
        var customPtHtml = '';
        if (hasCustomPt) {
            customPtHtml = '<div class="card-custom-pt" title="Left-click: +1 / Right-click: -1">' +
                '<span class="custom-pt-power" data-card-id="' + card.id + '">' + card.custom_power + '</span>' +
                '/' +
                '<span class="custom-pt-toughness" data-card-id="' + card.id + '">' + card.custom_toughness + '</span>' +
                '</div>';
        }

        // Collect linked exile & attached card data for inventory panel
        var linkedExileData = [];
        if (card.linked_exile_cards && card.linked_exile_cards.length > 0) {
            card.linked_exile_cards.forEach(function (linkedId) {
                var linkedCard = currentState && currentState.cards ? currentState.cards[linkedId] : null;
                if (linkedCard) linkedExileData.push(linkedCard);
            });
        }
        var attachedData = [];
        if (card.attached_cards && card.attached_cards.length > 0) {
            card.attached_cards.forEach(function (attId) {
                var attCard = currentState && currentState.cards ? currentState.cards[attId] : null;
                if (attCard) attachedData.push(attCard);
            });
        }
        var hasInventory = linkedExileData.length > 0 || attachedData.length > 0;

        // Oracle text indicator
        var oracleIndicator = '';
        if (card.show_oracle_text) {
            oracleIndicator = '<div class="oracle-text-indicator">☰ Oracle</div>';
        }

        // Inventory toggle indicator (shows when card has attachments/exiled)
        var inventoryToggle = '';
        if (hasInventory) {
            inventoryToggle = '<div class="inventory-toggle" title="Toggle inventory">▶ ' +
                (attachedData.length + linkedExileData.length) + '</div>';
        }

        el.innerHTML = tokenBadge + transformBadge +
            '<div class="card-header">' +
                '<div class="card-name">' + escapeHtml(displayName) + '</div>' +
                '<div class="card-mana">' + renderManaCost(displayMana) + '</div>' +
            '</div>' +
            '<div class="card-type">' + escapeHtml(displayType) + '</div>' +
            ptHtml +
            customPtHtml +
            counterHtml +
            oracleIndicator +
            inventoryToggle;

        // --- Event listeners ---

        // Custom P/T badge: left-click +1, right-click -1
        if (hasCustomPt) {
            var ptBadge = el.querySelector('.card-custom-pt');
            if (ptBadge) {
                ptBadge.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var target = e.target;
                    var newP = card.custom_power;
                    var newT = card.custom_toughness;
                    if (target.classList.contains('custom-pt-power')) {
                        newP += 1;
                    } else if (target.classList.contains('custom-pt-toughness')) {
                        newT += 1;
                    } else {
                        // Clicked on the "/" or the badge itself — increment power
                        newP += 1;
                    }
                    MTGSocket.send({ action: 'set_custom_pt', card_id: card.id, power: newP, toughness: newT });
                });
                ptBadge.addEventListener('contextmenu', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    var target = e.target;
                    var newP = card.custom_power;
                    var newT = card.custom_toughness;
                    if (target.classList.contains('custom-pt-power')) {
                        newP -= 1;
                    } else if (target.classList.contains('custom-pt-toughness')) {
                        newT -= 1;
                    } else {
                        newT -= 1;
                    }
                    MTGSocket.send({ action: 'set_custom_pt', card_id: card.id, power: newP, toughness: newT });
                });
            }
        }

        // Counter badge click handlers: left +1, right -1
        if (counterTypes.length > 0) {
            el.querySelectorAll('.counter-badge-clickable').forEach(function (badge) {
                badge.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var ct = this.dataset.counterType;
                    MTGSocket.send({ action: 'add_counter', card_id: card.id, counter_type: ct, amount: 1 });
                });
                badge.addEventListener('contextmenu', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    var ct = this.dataset.counterType;
                    MTGSocket.send({ action: 'remove_counter', card_id: card.id, counter_type: ct, amount: 1 });
                });
            });
        }

        // Click: tap/untap on battlefield
        el.addEventListener('click', function (e) {
            e.stopPropagation();

            // If in link-exile mode, handle differently
            if (linkExileMode) {
                handleLinkExileTarget(card.id);
                return;
            }

            // If in attach mode, handle differently
            if (attachMode) {
                handleAttachTarget(card.id);
                return;
            }

            // Tap/untap only on battlefield
            if (card.zone === 'battlefield') {
                MTGSocket.send({ action: 'tap_toggle', card_id: card.id });
            }
        });

        // Right-click: context menu
        el.addEventListener('contextmenu', function (e) {
            e.preventDefault();
            e.stopPropagation();
            showCardContextMenu(e, card);
        });

        // Hover: card preview
        el.addEventListener('mouseenter', function (e) {
            showCardPreview(card, e);
        });

        el.addEventListener('mousemove', function (e) {
            moveCardPreview(e);
        });

        el.addEventListener('mouseleave', function () {
            hideCardPreview();
        });

        // Make card element draggable
        DragDrop.makeCardDraggable(el);

        // --- Build wrapper with inventory panel ---
        if (!hasInventory) {
            return el;
        }

        var wrapper = document.createElement('div');
        wrapper.className = 'card-wrapper';
        wrapper.appendChild(el);

        // Build inventory panel
        var panel = document.createElement('div');
        panel.className = 'card-inventory open';

        // Helper: create inventory item for a card
        function createInventoryItem(invCard, sectionClass) {
            var item = document.createElement('div');
            item.className = 'inventory-item ' + sectionClass;
            item.dataset.cardId = invCard.id;
            item.dataset.cardName = invCard.name;
            item.dataset.colors = (invCard.colors || []).join(',');
            item.draggable = true;
            item.textContent = invCard.name;

            // Hover: card preview
            item.addEventListener('mouseenter', function (e) {
                e.stopPropagation();
                showCardPreview(invCard, e);
            });
            item.addEventListener('mousemove', function (e) {
                e.stopPropagation();
                moveCardPreview(e);
            });
            item.addEventListener('mouseleave', function (e) {
                e.stopPropagation();
                hideCardPreview();
            });
            // Right-click: context menu
            item.addEventListener('contextmenu', function (e) {
                e.preventDefault();
                e.stopPropagation();
                showCardContextMenu(e, invCard);
            });
            // Make draggable via DragDrop system
            DragDrop.makeCardDraggable(item);
            return item;
        }

        // Attached section (teal)
        if (attachedData.length > 0) {
            var attSection = document.createElement('div');
            attSection.className = 'inventory-section inventory-attached';
            var attLabel = document.createElement('div');
            attLabel.className = 'inventory-section-label';
            attLabel.textContent = 'Attached';
            attSection.appendChild(attLabel);
            attachedData.forEach(function (attCard) {
                attSection.appendChild(createInventoryItem(attCard, 'inv-attached'));
            });
            panel.appendChild(attSection);
        }

        // Linked exile section (purple)
        if (linkedExileData.length > 0) {
            var exSection = document.createElement('div');
            exSection.className = 'inventory-section inventory-exiled';
            var exLabel = document.createElement('div');
            exLabel.className = 'inventory-section-label';
            exLabel.textContent = 'Exiled';
            exSection.appendChild(exLabel);
            linkedExileData.forEach(function (exCard) {
                exSection.appendChild(createInventoryItem(exCard, 'inv-exiled'));
            });
            panel.appendChild(exSection);
        }

        wrapper.appendChild(panel);

        // Toggle button on the card
        var toggleBtn = el.querySelector('.inventory-toggle');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                var isOpen = panel.classList.toggle('open');
                toggleBtn.textContent = (isOpen ? '▶ ' : '◀ ') +
                    (attachedData.length + linkedExileData.length);
            });
        }

        return wrapper;
    }

    /**
     * Create a card-back element (for opponent's hand when hidden).
     * @returns {HTMLElement}
     */
    function createCardBack() {
        var el = document.createElement('div');
        el.className = 'card-back';
        return el;
    }

    /* ==================================================================
       RENDERING
       ================================================================== */

    /**
     * Schedule a full board re-render. Uses requestAnimationFrame to debounce.
     */
    function scheduleRender() {
        if (_renderRafId) cancelAnimationFrame(_renderRafId);
        _renderRafId = requestAnimationFrame(function () {
            _renderRafId = null;
            renderBoard();
        });
    }

    /**
     * Full board render from currentState.
     */
    function renderBoard() {
        if (!currentState) return;

        var state = currentState;

        // Check game_started
        var noGameEl = document.getElementById('no-game-message');
        if (!state.game_started) {
            noGameEl.style.display = 'flex';
            return;
        } else {
            noGameEl.style.display = 'none';
        }

        var numPlayers = state.players ? state.players.length : 0;

        // Player names
        // Player 0 = human (you, bottom), Player 1 = LLM/opponent (top)
        if (numPlayers > 0) {
            document.getElementById('player-bottom-name').textContent = state.players[0].name + ' (You)';
            document.getElementById('life-name-0').textContent = state.players[0].name;
        }
        if (numPlayers > 1) {
            document.getElementById('player-top-name').textContent = state.players[1].name + ' (Opponent)';
            document.getElementById('life-name-1').textContent = state.players[1].name;
        }

        // Render zones for each player
        for (var pi = 0; pi < numPlayers && pi < 2; pi++) {
            renderPlayerZones(state, pi);
        }

        // Life totals
        for (var li = 0; li < numPlayers && li < 2; li++) {
            document.getElementById('life-total-' + li).textContent = state.players[li].life;
            renderCommanderDamage(state, li);
            renderExtraCounters(state, li);
        }

        // Turn / phase
        document.getElementById('turn-display').textContent = 'Turn ' + state.turn;
        if (state.players[state.active_player_index]) {
            document.getElementById('active-player-name').textContent =
                state.players[state.active_player_index].name;
        }

        // Phase tracker
        renderPhaseTracker(state.phase);
    }

    /** Classify a battlefield card into creature / land / other.
     *  Respects user override (battlefield_group) if set. */
    function getCardBattlefieldGroup(card) {
        if (card.battlefield_group) return card.battlefield_group;
        var type = card.type_line || '';
        if (type.indexOf('Creature') !== -1) return 'creature';
        if (type.indexOf('Land') !== -1) return 'land';
        return 'other';
    }

    /**
     * Render battlefield with sub-zones: Creatures / Lands / Other.
     * Cards are visually sorted but still belong to the 'battlefield' zone for drag-drop.
     */
    function renderBattlefieldZone(zoneId, cards) {
        var zoneEl = document.getElementById(zoneId);
        if (!zoneEl) return;
        var container = zoneEl.querySelector('.zone-cards');
        if (!container) return;

        // Filter out cards that are attached to another card (they appear as badges)
        var visibleCards = cards.filter(function (c) { return !c.attached_to; });

        var creatures = visibleCards.filter(function (c) { return getCardBattlefieldGroup(c) === 'creature'; });
        var lands    = visibleCards.filter(function (c) { return getCardBattlefieldGroup(c) === 'land'; });
        var other    = visibleCards.filter(function (c) { return getCardBattlefieldGroup(c) === 'other'; });

        container.className = 'zone-cards bf-groups';
        container.innerHTML = '';

        function makeSubzone(cssClass, label, groupName, cardList) {
            var div = document.createElement('div');
            div.className = cssClass + ' bf-drop-subzone';
            div.dataset.battlefieldGroup = groupName;
            var lbl = document.createElement('div');
            lbl.className = 'subzone-label';
            lbl.textContent = label + (cardList.length ? ' (' + cardList.length + ')' : '');
            var cards_div = document.createElement('div');
            cards_div.className = 'subzone-cards';
            cardList.forEach(function (c) { cards_div.appendChild(createCardElement(c)); });
            div.appendChild(lbl);
            div.appendChild(cards_div);
            return div;
        }

        var nonliving = document.createElement('div');
        nonliving.className = 'bf-group bf-nonliving';
        nonliving.appendChild(makeSubzone('bf-subgroup bf-lands', 'Lands', 'land', lands));
        nonliving.appendChild(makeSubzone('bf-subgroup bf-other', 'Other', 'other', other));
        container.appendChild(nonliving);

        var creaturesDiv = makeSubzone('bf-group bf-creatures', 'Creatures', 'creature', creatures);
        container.appendChild(creaturesDiv);
    }

    /**
     * Render all zones for a given player index.
     */
    function renderPlayerZones(state, playerIndex) {
        // Battlefield (grouped by type)
        renderBattlefieldZone('zone-battlefield-' + playerIndex, getCardsInZone(state, 'battlefield', playerIndex));

        // Hand
        renderHandZone(state, playerIndex);

        // Command zone
        renderZoneCards('zone-command-' + playerIndex, getCardsInZone(state, 'command_zone', playerIndex));

        // Library count
        var libCards = getCardsInZone(state, 'library', playerIndex);
        document.getElementById('lib-count-' + playerIndex).textContent = libCards.length;

        // Graveyard: show top card + count
        var gyCards = getCardsInZone(state, 'graveyard', playerIndex);
        document.getElementById('gy-count-' + playerIndex).textContent = gyCards.length;
        renderStackZone('zone-graveyard-' + playerIndex, gyCards);

        // Exile: show cards that are in standard exile (not linked)
        var exCards = getCardsInZone(state, 'exile', playerIndex);
        document.getElementById('ex-count-' + playerIndex).textContent = exCards.length;
        renderStackZone('zone-exile-' + playerIndex, exCards);
    }

    /**
     * Render cards into a zone container, replacing existing content.
     */
    function renderZoneCards(zoneId, cards) {
        var zoneEl = document.getElementById(zoneId);
        if (!zoneEl) return;
        var container = zoneEl.querySelector('.zone-cards');
        if (!container) return;

        container.innerHTML = '';
        cards.forEach(function (card) {
            container.appendChild(createCardElement(card));
        });
    }

    /**
     * Render hand zone. For player 0 (opponent), shows card backs by default.
     * For player 1 (human), shows actual cards.
     */
    function renderHandZone(state, playerIndex) {
        var zoneId = 'zone-hand-' + playerIndex;
        var zoneEl = document.getElementById(zoneId);
        if (!zoneEl) return;
        var container = zoneEl.querySelector('.zone-cards');
        if (!container) return;

        var handCards = getCardsInZone(state, 'hand', playerIndex);
        document.getElementById('hand-count-' + playerIndex).textContent = handCards.length;

        container.innerHTML = '';

        if (playerIndex === 0) {
            // Opponent hand: show card backs (can still drag them for manual tracking)
            handCards.forEach(function (card) {
                // Show as actual cards since this is a board state tracker, not a hidden info game.
                // The user manually manages both sides.
                container.appendChild(createCardElement(card));
            });
        } else {
            // Human hand: show all cards
            handCards.forEach(function (card) {
                container.appendChild(createCardElement(card));
            });
        }
    }

    /**
     * Render a stack zone (graveyard/exile) showing only the top card.
     */
    function renderStackZone(zoneId, cards) {
        var zoneEl = document.getElementById(zoneId);
        if (!zoneEl) return;
        var container = zoneEl.querySelector('.zone-cards');
        if (!container) return;

        container.innerHTML = '';
        if (cards.length > 0) {
            // Show top card (last added)
            var topCard = cards[cards.length - 1];
            container.appendChild(createCardElement(topCard));
        }
    }

    /**
     * Render commander damage sub-counters.
     */
    function renderCommanderDamage(state, playerIndex) {
        var row = document.getElementById('cmdr-dmg-' + playerIndex);
        if (!row) return;
        var player = state.players[playerIndex];
        if (!player) return;

        row.innerHTML = '';
        var dmg = player.commander_damage_received || {};
        for (var src in dmg) {
            if (!dmg.hasOwnProperty(src)) continue;
            if (dmg[src] <= 0) continue;
            var item = document.createElement('span');
            item.className = 'cmdr-dmg-item';
            item.innerHTML = '<span>' + escapeHtml(src) + '</span> <span class="cmdr-dmg-value">' + dmg[src] + '</span>';
            row.appendChild(item);
        }
    }

    /**
     * Render extra player counters (Poison, Experience, etc.) as pills.
     */
    function renderExtraCounters(state, playerIndex) {
        var row = document.getElementById('extra-counters-' + playerIndex);
        if (!row) return;
        var player = state.players[playerIndex];
        if (!player) return;

        row.innerHTML = '';

        // Commander Tax pill (always shown if > 0)
        var tax = player.commander_tax || 0;
        if (tax > 0) {
            var taxPill = document.createElement('span');
            taxPill.className = 'extra-counter-pill cmdr-tax-pill';
            taxPill.innerHTML =
                '<span class="extra-counter-btn cmdr-tax-btn" data-player="' + playerIndex + '" data-delta="-2">−</span>' +
                '<span class="extra-counter-name">Tax</span>' +
                '<span class="extra-counter-val">' + tax + '</span>' +
                '<span class="extra-counter-btn cmdr-tax-btn" data-player="' + playerIndex + '" data-delta="2">+</span>';
            row.appendChild(taxPill);
        }

        var counters = player.extra_counters || {};
        for (var name in counters) {
            if (!counters.hasOwnProperty(name)) continue;
            var val = counters[name];
            if (val <= 0) continue;
            var pill = document.createElement('span');
            pill.className = 'extra-counter-pill';
            pill.innerHTML =
                '<span class="extra-counter-btn" data-player="' + playerIndex + '" data-name="' + escapeHtml(name) + '" data-delta="-1">−</span>' +
                '<span class="extra-counter-name">' + escapeHtml(name) + '</span>' +
                '<span class="extra-counter-val">' + val + '</span>' +
                '<span class="extra-counter-btn" data-player="' + playerIndex + '" data-name="' + escapeHtml(name) + '" data-delta="1">+</span>';
            row.appendChild(pill);
        }
        // wire up extra counter buttons
        row.querySelectorAll('.extra-counter-btn:not(.cmdr-tax-btn)').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                MTGSocket.send({
                    action: 'set_player_counter',
                    player_index: parseInt(this.dataset.player, 10),
                    counter_name: this.dataset.name,
                    delta: parseInt(this.dataset.delta, 10)
                });
            });
        });
        // wire up commander tax buttons
        row.querySelectorAll('.cmdr-tax-btn').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                MTGSocket.send({
                    action: 'set_commander_tax',
                    player_index: parseInt(this.dataset.player, 10),
                    delta: parseInt(this.dataset.delta, 10)
                });
            });
        });
    }

    /**
     * Render phase tracker highlighting the current phase.
     */
    function renderPhaseTracker(currentPhase) {
        var steps = document.querySelectorAll('.phase-step');
        for (var i = 0; i < steps.length; i++) {
            if (steps[i].dataset.phase === currentPhase) {
                steps[i].classList.add('active');
            } else {
                steps[i].classList.remove('active');
            }
        }
    }

    /* ==================================================================
       CONTEXT MENUS
       ================================================================== */

    function showCardContextMenu(e, card) {
        contextCardId = card.id;

        var menu = document.getElementById('context-menu');
        menu.style.display = 'block';

        // Show/hide items based on card state
        var unlinkItem = menu.querySelector('[data-action="unlink_exile"]');
        if (unlinkItem) {
            unlinkItem.style.display = (card.zone === 'exile_linked') ? 'block' : 'none';
        }

        // Detach: only show when card is attached to something
        var detachItem = menu.querySelector('[data-action="detach_card"]');
        if (detachItem) {
            detachItem.style.display = card.attached_to ? 'block' : 'none';
        }

        // Attach: only show for battlefield cards
        var attachItem = menu.querySelector('[data-action="attach_card"]');
        if (attachItem) {
            attachItem.style.display = (card.zone === 'battlefield') ? 'block' : 'none';
        }

        // Oracle text toggle: show checkmark when enabled
        var oracleItem = menu.querySelector('[data-action="toggle_oracle_text"]');
        if (oracleItem) {
            oracleItem.textContent = card.show_oracle_text ? '☰ Oracle Text für LLM ✓' : '☰ Oracle Text für LLM';
        }

        var deleteItem = menu.querySelector('[data-action="delete_card"]');
        if (deleteItem) {
            deleteItem.style.display = card.is_conjured ? 'block' : 'none';
        }

        var removePtItem = menu.querySelector('[data-action="remove_pt_badge"]');
        if (removePtItem) {
            var hasPt = card.custom_power !== null && card.custom_power !== undefined;
            removePtItem.style.display = hasPt ? 'block' : 'none';
        }

        // Face-down type options: only visible when card is face down
        var fdTypeItems = menu.querySelectorAll('[data-action="set_face_down_type"]');
        for (var i = 0; i < fdTypeItems.length; i++) {
            fdTypeItems[i].style.display = card.face_down ? 'block' : 'none';
        }

        // Transform option: only visible for double-faced cards
        var transformItem = menu.querySelector('[data-action="transform_card"]');
        if (transformItem) {
            var hasDfc = card.back_face && card.back_face.name;
            transformItem.style.display = hasDfc ? 'block' : 'none';
        }

        // Related tokens: dynamically populate
        var tokenContainer = document.getElementById('related-tokens-container');
        tokenContainer.innerHTML = '';
        if (card.related_tokens && card.related_tokens.length > 0) {
            card.related_tokens.forEach(function (token) {
                var item = document.createElement('div');
                item.className = 'ctx-item ctx-item-token';
                item.textContent = '⊕ ' + token.name;
                if (token.type_line) {
                    item.title = token.type_line;
                }
                item.addEventListener('click', function (e) {
                    e.stopPropagation();
                    MTGSocket.send({
                        action: 'create_related_token',
                        source_card_id: card.id,
                        scryfall_id: token.scryfall_id,
                    });
                    hideAllContextMenus();
                });
                tokenContainer.appendChild(item);
            });
        }

        // Position the menu
        clampToViewport(menu, e.clientX + 2, e.clientY + 2);
        // Recalculate after display to get proper dimensions
        requestAnimationFrame(function () {
            clampToViewport(menu, e.clientX + 2, e.clientY + 2);
        });
    }

    function showLibraryContextMenu(e, playerIndex) {
        contextLibraryPlayer = playerIndex;

        var menu = document.getElementById('library-context-menu');
        menu.style.display = 'block';

        // Hide Mulligan after turn 1 to prevent accidental clicks
        var mulliganItem = menu.querySelector('[data-action="mulligan"]');
        if (mulliganItem) {
            var turn = currentState ? (currentState.turn || 0) : 0;
            mulliganItem.style.display = (turn <= 1) ? 'block' : 'none';
        }

        clampToViewport(menu, e.clientX + 2, e.clientY + 2);
        requestAnimationFrame(function () {
            clampToViewport(menu, e.clientX + 2, e.clientY + 2);
        });
    }

    function hideAllContextMenus() {
        document.getElementById('context-menu').style.display = 'none';
        document.getElementById('library-context-menu').style.display = 'none';
        document.getElementById('battlefield-context-menu').style.display = 'none';
        contextCardId = null;
        contextLibraryPlayer = null;
        contextBattlefieldPlayer = null;
    }

    /* ==================================================================
       CARD CONTEXT MENU ACTIONS
       ================================================================== */

    function handleCardContextAction(actionType, el) {
        if (!contextCardId) return;
        var cardId = contextCardId;

        switch (actionType) {
            case 'counter_plus':
                MTGSocket.send({
                    action: 'add_counter',
                    card_id: cardId,
                    counter_type: el.dataset.counter || '+1/+1',
                    amount: 1
                });
                break;

            case 'counter_minus':
                MTGSocket.send({
                    action: 'remove_counter',
                    card_id: cardId,
                    counter_type: el.dataset.counter || '+1/+1',
                    amount: 1
                });
                break;

            case 'add_custom_counter':
                var counterName = prompt('Counter type (e.g. +1/+1, loyalty, charge):');
                if (counterName) {
                    MTGSocket.send({
                        action: 'add_counter',
                        card_id: cardId,
                        counter_type: counterName.trim(),
                        amount: 1
                    });
                }
                break;

            case 'set_pt_badge':
                var ptVal = prompt('Power/Toughness (e.g. 3/3):');
                if (ptVal) {
                    var ptParts = ptVal.split('/');
                    var cPower = parseInt(ptParts[0], 10);
                    var cTough = parseInt(ptParts[1], 10);
                    if (!isNaN(cPower) && !isNaN(cTough)) {
                        MTGSocket.send({
                            action: 'set_custom_pt',
                            card_id: cardId,
                            power: cPower,
                            toughness: cTough
                        });
                    }
                }
                break;

            case 'remove_pt_badge':
                MTGSocket.send({
                    action: 'set_custom_pt',
                    card_id: cardId,
                    power: null,
                    toughness: null
                });
                break;

            case 'create_token':
                handleCreateToken();
                break;

            case 'clone_card':
                MTGSocket.send({ action: 'clone_card', card_id: cardId });
                break;

            case 'toggle_face_down':
                MTGSocket.send({ action: 'set_face_down', card_id: cardId });
                break;

            case 'transform_card':
                MTGSocket.send({ action: 'transform_card', card_id: cardId });
                break;

            case 'set_face_down_type':
                MTGSocket.send({
                    action: 'set_face_down',
                    card_id: cardId,
                    face_down: true,
                    face_down_type: el.dataset.fdType
                });
                break;

            case 'move_to':
                var zone = el.dataset.zone;
                if (zone === 'library_top') {
                    // Move to library (server handles putting on top)
                    MTGSocket.send({
                        action: 'move_card',
                        card_id: cardId,
                        to_zone: 'library',
                        to_player_index: getCardOwner(cardId)
                    });
                } else if (zone === 'library_bottom') {
                    MTGSocket.send({
                        action: 'bottom_card',
                        card_id: cardId
                    });
                } else {
                    MTGSocket.send({
                        action: 'move_card',
                        card_id: cardId,
                        to_zone: zone,
                        to_player_index: getCardOwner(cardId)
                    });
                }
                break;

            case 'link_exile':
                startLinkExileMode(cardId);
                break;

            case 'unlink_exile':
                MTGSocket.send({ action: 'unlink_exile', card_id: cardId });
                break;

            case 'attach_card':
                startAttachMode(cardId);
                break;

            case 'detach_card':
                MTGSocket.send({ action: 'detach_card', card_id: cardId });
                break;

            case 'toggle_oracle_text':
                MTGSocket.send({ action: 'toggle_oracle_text', card_id: cardId });
                break;

            case 'delete_card':
                MTGSocket.send({ action: 'delete_card', card_id: cardId });
                break;

            case 'change_printing':
                openPrintingPicker(cardId);
                break;
        }

        hideAllContextMenus();
    }

    /** Get the owner_index for a card from current state. */
    function getCardOwner(cardId) {
        if (currentState && currentState.cards && currentState.cards[cardId]) {
            return currentState.cards[cardId].owner_index;
        }
        return 0;
    }

    /** Handle create token — opens card picker, then prompts for details. */
    function handleCreateToken() {
        // Determine which player to create it for
        var pi = 1; // Default to human player
        if (contextCardId && currentState && currentState.cards[contextCardId]) {
            pi = currentState.cards[contextCardId].controller_index;
        }

        openCardPicker('Token erstellen — Name suchen', function (card) {
            var name = card.name;
            var pt = prompt('Power/Toughness (e.g. 2/2):');
            if (!pt) return;
            var parts = pt.split('/');
            var power = (parts[0] || '0').trim();
            var toughness = (parts[1] || '0').trim();
            var defaultType = 'Token Creature — ' + name.trim();
            if (card.type_line) defaultType = card.type_line;
            var typeLine = prompt('Type line:', defaultType);
            if (!typeLine) typeLine = 'Token Creature';
            var defaultAbilities = card.oracle_text || '';
            var abilities = prompt('Abilities (optional):', defaultAbilities) || '';

            MTGSocket.send({
                action: 'create_token',
                player_index: pi,
                name: name.trim(),
                power: power,
                toughness: toughness,
                type_line: typeLine.trim(),
                abilities: abilities.trim()
            });
        });
    }

    /* ==================================================================
       LIBRARY CONTEXT MENU ACTIONS
       ================================================================== */

    function handleLibraryContextAction(actionType) {
        if (contextLibraryPlayer === null) return;
        var pi = contextLibraryPlayer;

        switch (actionType) {
            case 'draw_card':
                MTGSocket.send({ action: 'draw_card', player_index: pi, count: 1 });
                break;

            case 'shuffle_library':
                MTGSocket.send({ action: 'shuffle_library', player_index: pi });
                break;

            case 'scry':
                var count = prompt('Scry how many cards?', '1');
                if (count && parseInt(count, 10) > 0) {
                    MTGSocket.send({ action: 'scry', player_index: pi, count: parseInt(count, 10) });
                }
                break;

            case 'search_library':
                MTGSocket.send({ action: 'search_library', player_index: pi });
                break;

            case 'mulligan':
                MTGSocket.send({ action: 'mulligan', player_index: pi });
                break;
        }

        hideAllContextMenus();
    }

    /* ==================================================================
       BATTLEFIELD CONTEXT MENU
       ================================================================== */

    function showBattlefieldContextMenu(e, playerIndex) {
        contextBattlefieldPlayer = playerIndex;
        var menu = document.getElementById('battlefield-context-menu');
        menu.style.display = 'block';
        requestAnimationFrame(function () {
            clampToViewport(menu, e.clientX + 2, e.clientY + 2);
        });
    }

    function handleBattlefieldContextAction(actionType) {
        var pi = contextBattlefieldPlayer !== null ? contextBattlefieldPlayer : 0;
        hideAllContextMenus();

        switch (actionType) {
            case 'bf_create_token':
                contextCardId = null;
                var origPi = pi;
                openCardPicker('Token erstellen — Name suchen', function (card) {
                    var name = card.name;
                    var pt = prompt('Power/Toughness (e.g. 2/2):');
                    if (!pt) return;
                    var parts = pt.split('/');
                    var power = (parts[0] || '0').trim();
                    var toughness = (parts[1] || '0').trim();
                    var defaultType = 'Token Creature — ' + name.trim();
                    if (card.type_line) defaultType = card.type_line;
                    var typeLine = prompt('Type line:', defaultType);
                    if (!typeLine) typeLine = 'Token Creature';
                    var defaultAbilities = card.oracle_text || '';
                    var abilities = prompt('Abilities (optional):', defaultAbilities) || '';
                    MTGSocket.send({
                        action: 'create_token',
                        player_index: origPi,
                        name: name.trim(),
                        power: power,
                        toughness: toughness,
                        type_line: typeLine.trim(),
                        abilities: abilities.trim()
                    });
                });
                break;

            case 'bf_add_card_battlefield':
            case 'bf_add_card_hand':
                var addZone = actionType === 'bf_add_card_hand' ? 'hand' : 'battlefield';
                var addPi = pi;
                openCardPicker('Karte hinzufügen — Name suchen', function (card) {
                    MTGSocket.send({
                        action: 'add_card',
                        player_index: addPi,
                        name: card.name.trim(),
                        zone: addZone
                    });
                });
                break;
        }
    }

    /* ==================================================================
       LINK EXILE MODE
       ================================================================== */

    function startLinkExileMode(cardId) {
        linkExileMode = true;
        linkExileCardId = cardId;
        document.getElementById('link-exile-prompt').style.display = 'flex';
    }

    function cancelLinkExileMode() {
        linkExileMode = false;
        linkExileCardId = null;
        document.getElementById('link-exile-prompt').style.display = 'none';
    }

    function handleLinkExileTarget(parentCardId) {
        if (!linkExileCardId) return;
        MTGSocket.send({
            action: 'link_exile',
            card_id: linkExileCardId,
            parent_card_id: parentCardId
        });
        cancelLinkExileMode();
    }

    /* ==================================================================
       ATTACH CARD MODE (Aura/Equipment)
       ================================================================== */

    function startAttachMode(cardId) {
        attachMode = true;
        attachCardId = cardId;
        document.getElementById('attach-card-prompt').style.display = 'flex';
    }

    function cancelAttachMode() {
        attachMode = false;
        attachCardId = null;
        document.getElementById('attach-card-prompt').style.display = 'none';
    }

    function handleAttachTarget(parentCardId) {
        if (!attachCardId) return;
        MTGSocket.send({
            action: 'attach_card',
            card_id: attachCardId,
            parent_card_id: parentCardId
        });
        cancelAttachMode();
    }

    /* ==================================================================
       CARD PREVIEW (HOVER)
       ================================================================== */

    var previewEl = null;
    var previewImg = null;
    var previewFallback = null;
    var previewBackEl = null;
    var previewBackImg = null;
    var frontOverlay = null;
    var backOverlay = null;

    function initPreviewRefs() {
        previewEl = document.getElementById('card-preview');
        previewImg = document.getElementById('card-preview-img');
        previewFallback = document.getElementById('card-preview-fallback');
        previewBackEl = document.getElementById('card-preview-back');
        previewBackImg = document.getElementById('card-preview-back-img');
        frontOverlay = document.getElementById('front-face-overlay');
        backOverlay = document.getElementById('back-face-overlay');
    }

    function showCardPreview(card, e) {
        if (!previewEl) initPreviewRefs();

        // Resolve display image — use back face image when transformed
        var bf = card.back_face || {};
        var isDfc = !!(bf.name && bf.image_uri);
        var isTransformed = card.transformed && bf.name;
        var frontImageUri = card.image_uri;
        var backImageUri = bf.image_uri;

        // For transformed cards, swap: show back face as "front" position
        var displayImageUri = isTransformed ? (backImageUri || frontImageUri) : frontImageUri;

        // Front face image
        if (displayImageUri) {
            previewImg.src = displayImageUri;
            previewImg.style.display = 'block';
            previewFallback.style.display = 'none';
            previewImg.onerror = function () {
                previewImg.style.display = 'none';
                showPreviewFallback(card);
            };
        } else {
            previewImg.style.display = 'none';
            showPreviewFallback(card);
        }

        // Back face: show for DFCs, hide for normal cards
        if (isDfc) {
            var otherImageUri = isTransformed ? frontImageUri : backImageUri;
            previewBackImg.src = otherImageUri || '';
            previewBackEl.style.display = 'block';
            previewBackImg.onerror = function () {
                previewBackEl.style.display = 'none';
            };
            // Active face = no overlay, inactive face = overlay
            frontOverlay.className = 'card-preview-face-overlay';
            backOverlay.className = 'card-preview-face-overlay inactive';
        } else {
            previewBackEl.style.display = 'none';
            frontOverlay.className = 'card-preview-face-overlay';
        }

        // Status bar
        var statusParts = [];
        if (isTransformed) statusParts.push('Transformed');
        if (card.tapped) statusParts.push('Tapped');
        if (card.attacking) statusParts.push('Attacking');
        if (card.is_token) statusParts.push('Token');
        if (card.is_commander) statusParts.push('Commander');
        if (card.face_down) statusParts.push('Face Down');
        var counterParts = [];
        if (card.counters && Object.keys(card.counters).length > 0) {
            for (var ct in card.counters) {
                if (card.counters.hasOwnProperty(ct) && card.counters[ct] > 0) {
                    counterParts.push(card.counters[ct] + 'x ' + ct);
                }
            }
        }
        var statusEl = document.getElementById('card-preview-status');
        var statusHtml = statusParts.map(function(s) { return escapeHtml(s); }).join(' | ');
        if (counterParts.length > 0) {
            if (statusHtml) statusHtml += ' | ';
            statusHtml += '<span class="preview-counter-highlight">' + escapeHtml(counterParts.join(', ')) + '</span>';
        }
        statusEl.innerHTML = statusHtml;

        previewEl.style.display = 'block';
        moveCardPreview(e);
    }

    function showPreviewFallback(card) {
        previewFallback.style.display = 'flex';
        document.getElementById('preview-name').textContent = card.name;
        document.getElementById('preview-mana').innerHTML = renderManaCost(card.mana_cost, true);
        document.getElementById('preview-type').textContent = card.type_line || '';
        document.getElementById('preview-text').textContent = card.oracle_text || '';

        var ptText = '';
        if (card.power !== null && card.toughness !== null) {
            ptText = card.power + '/' + card.toughness;
        } else if (card.loyalty !== null) {
            ptText = 'Loyalty: ' + card.loyalty;
        }
        document.getElementById('preview-pt').textContent = ptText;
    }

    function moveCardPreview(e) {
        if (!previewEl || previewEl.style.display === 'none') return;
        var x = e.clientX + 20;
        var y = e.clientY - 40;
        clampToViewport(previewEl, x, y);
    }

    function hideCardPreview() {
        if (!previewEl) initPreviewRefs();
        previewEl.style.display = 'none';
    }

    /* ==================================================================
       LIFE COUNTERS
       ================================================================== */

    function setupLifeCounters() {
        // Plus/minus buttons
        document.querySelectorAll('.life-btn').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                var pi = parseInt(this.dataset.playerIndex, 10);
                var delta = parseInt(this.dataset.delta, 10);
                MTGSocket.send({ action: 'change_life', player_index: pi, delta: delta });
            });
        });

        // Click on life total to type a custom amount
        document.querySelectorAll('.life-total').forEach(function (el) {
            el.addEventListener('click', function (e) {
                e.stopPropagation();
                var piStr = this.id.replace('life-total-', '');
                var pi = parseInt(piStr, 10);
                var current = parseInt(this.textContent, 10);
                var input = prompt('Set life total (or +N/-N for delta):', current);
                if (input === null) return;
                input = input.trim();
                if (input.charAt(0) === '+' || input.charAt(0) === '-') {
                    var delta = parseInt(input, 10);
                    if (!isNaN(delta)) {
                        MTGSocket.send({ action: 'change_life', player_index: pi, delta: delta });
                    }
                } else {
                    var newLife = parseInt(input, 10);
                    if (!isNaN(newLife)) {
                        var delta2 = newLife - current;
                        if (delta2 !== 0) {
                            MTGSocket.send({ action: 'change_life', player_index: pi, delta: delta2 });
                        }
                    }
                }
            });
        });
    }

    /* ==================================================================
       PHASE TRACKER
       ================================================================== */

    function setupPhaseTracker() {
        // Click on phase steps to jump
        document.querySelectorAll('.phase-step').forEach(function (step) {
            step.addEventListener('click', function () {
                MTGSocket.send({ action: 'set_phase', phase: this.dataset.phase });
            });
        });

        // Next phase button
        document.getElementById('btn-next-phase').addEventListener('click', function () {
            MTGSocket.send({ action: 'next_phase' });
        });

        // Pass turn button
        document.getElementById('btn-pass-turn').addEventListener('click', function () {
            MTGSocket.send({ action: 'pass_turn' });
        });

        // Untap all buttons (one per player)
        document.querySelectorAll('.untap-all-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                MTGSocket.send({ action: 'untap_all', player_index: parseInt(btn.dataset.playerIndex, 10) });
            });
        });

        // Add counter buttons (one per player)
        document.querySelectorAll('.add-counter-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var pi = parseInt(btn.dataset.playerIndex, 10);
                var name = prompt('Counter name (e.g. Poison, Experience, Energy):');
                if (!name || !name.trim()) return;
                MTGSocket.send({
                    action: 'set_player_counter',
                    player_index: pi,
                    counter_name: name.trim(),
                    delta: 1
                });
            });
        });
    }

    /* ==================================================================
       LIBRARY INTERACTIONS
       ================================================================== */

    function setupLibraryInteractions() {
        for (var i = 0; i < 2; i++) {
            (function (pi) {
                var libZone = document.getElementById('zone-library-' + pi);
                if (!libZone) return;

                // Click: draw a card
                libZone.addEventListener('click', function (e) {
                    e.stopPropagation();
                    MTGSocket.send({ action: 'draw_card', player_index: pi, count: 1 });
                });

                // Right-click: library context menu
                libZone.addEventListener('contextmenu', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    showLibraryContextMenu(e, pi);
                });
            })(i);
        }

        // Battlefield right-click (not on a card) → battlefield context menu
        for (var bi = 0; bi < 2; bi++) {
            (function (pi) {
                var bfZone = document.getElementById('zone-battlefield-' + pi);
                if (!bfZone) return;
                bfZone.addEventListener('contextmenu', function (e) {
                    if (e.target.closest('.card')) return; // card has its own menu
                    e.preventDefault();
                    e.stopPropagation();
                    showBattlefieldContextMenu(e, pi);
                });
            })(bi);
        }
    }

    /* ==================================================================
       GRAVEYARD / EXILE ZONE VIEWER
       ================================================================== */

    function setupZoneViewers() {
        for (var i = 0; i < 2; i++) {
            (function (pi) {
                // Graveyard click
                var gyZone = document.getElementById('zone-graveyard-' + pi);
                if (gyZone) {
                    gyZone.addEventListener('click', function (e) {
                        e.stopPropagation();
                        if (!currentState) return;
                        var cards = getCardsInZone(currentState, 'graveyard', pi);
                        if (cards.length > 0) {
                            showZoneViewer('Graveyard — ' + getPlayerName(pi), cards);
                        }
                    });
                }

                // Exile click
                var exZone = document.getElementById('zone-exile-' + pi);
                if (exZone) {
                    exZone.addEventListener('click', function (e) {
                        e.stopPropagation();
                        if (!currentState) return;
                        var cards = getCardsInZone(currentState, 'exile', pi);
                        if (cards.length > 0) {
                            showZoneViewer('Exile — ' + getPlayerName(pi), cards);
                        }
                    });
                }
            })(i);
        }
    }

    function getPlayerName(pi) {
        if (currentState && currentState.players && currentState.players[pi]) {
            return currentState.players[pi].name;
        }
        return 'Player ' + (pi + 1);
    }

    function showZoneViewer(title, cards) {
        var modal = document.getElementById('zone-viewer-modal');
        document.getElementById('zone-viewer-title').textContent = title;

        var list = document.getElementById('zone-viewer-list');
        list.innerHTML = '';

        cards.forEach(function (card) {
            var item = document.createElement('div');
            item.className = 'zone-viewer-card';
            item.dataset.cardId = card.id;

            if (card.image_uri) {
                var img = document.createElement('img');
                img.src = card.image_uri;
                img.alt = card.name;
                img.onerror = function () {
                    // Replace with fallback
                    this.parentNode.innerHTML = createZoneViewerFallback(card);
                };
                item.appendChild(img);
            } else {
                item.innerHTML = createZoneViewerFallback(card);
            }

            var nameLabel = document.createElement('div');
            nameLabel.style.fontSize = '11px';
            nameLabel.style.color = '#e0e0e0';
            nameLabel.style.textAlign = 'center';
            nameLabel.style.maxWidth = '160px';
            nameLabel.style.overflow = 'hidden';
            nameLabel.style.textOverflow = 'ellipsis';
            nameLabel.style.whiteSpace = 'nowrap';
            nameLabel.textContent = card.name;
            item.appendChild(nameLabel);

            // Right-click on a card in the viewer for context menu
            item.addEventListener('contextmenu', function (e) {
                e.preventDefault();
                e.stopPropagation();
                showCardContextMenu(e, card);
            });

            list.appendChild(item);
        });

        modal.style.display = 'flex';
    }

    function createZoneViewerFallback(card) {
        return '<div class="zone-viewer-card-fallback">' +
            '<div class="zv-name">' + escapeHtml(card.name) + '</div>' +
            '<div class="zv-type">' + escapeHtml(card.type_line) + '</div>' +
            '<div class="zv-text">' + escapeHtml(card.oracle_text || '') + '</div>' +
            '</div>';
    }

    function hideZoneViewer() {
        document.getElementById('zone-viewer-modal').style.display = 'none';
    }

    // ------------------------------------------------------------------
    // Printing Picker Modal
    // ------------------------------------------------------------------

    var printingPickerCardId = null;
    var printingPickerCardName = null;

    function openPrintingPicker(cardId) {
        if (!currentState || !currentState.cards || !currentState.cards[cardId]) return;
        var card = currentState.cards[cardId];
        printingPickerCardId = cardId;
        printingPickerCardName = card.name;

        hideCardPreview();
        document.getElementById('printing-card-name').textContent = card.name;
        document.getElementById('printing-grid').innerHTML = '';
        document.getElementById('printing-loading').style.display = 'block';
        var printingModal = document.getElementById('printing-modal');
        printingModal.style.display = 'flex';

        fetch('/api/cards/printings?name=' + encodeURIComponent(card.name))
            .then(function (r) { return r.json(); })
            .then(function (data) {
                document.getElementById('printing-loading').style.display = 'none';
                renderPrintingGrid(data.printings || []);
            })
            .catch(function () {
                document.getElementById('printing-loading').textContent = 'Error loading printings.';
            });
    }

    function renderPrintingGrid(printings) {
        var grid = document.getElementById('printing-grid');
        grid.innerHTML = '';

        if (printings.length === 0) {
            grid.innerHTML = '<div class="printing-loading">No printings found.</div>';
            return;
        }

        var currentCard = currentState && currentState.cards
            ? currentState.cards[printingPickerCardId] : null;

        printings.forEach(function (printing) {
            var item = document.createElement('div');
            item.className = 'printing-item';

            // Highlight the currently active printing
            if (currentCard && currentCard.scryfall_id === printing.scryfall_id) {
                item.classList.add('printing-current');
            }

            var img = document.createElement('img');
            img.src = printing.image_uri;
            img.alt = printing.set_name;
            img.loading = 'lazy';
            img.onerror = function () {
                this.style.display = 'none';
            };
            item.appendChild(img);

            var label = document.createElement('div');
            label.className = 'printing-label';
            var labelText = printing.set_name || printing.set || '';
            if (printing.released_at) {
                labelText += ' (' + printing.released_at.slice(0, 4) + ')';
            }
            label.textContent = labelText;
            item.appendChild(label);

            item.addEventListener('click', function () {
                selectPrinting(printing);
            });

            grid.appendChild(item);
        });
    }

    function selectPrinting(printing) {
        fetch('/api/cards/set-printing', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                card_id: printingPickerCardId,
                card_name: printingPickerCardName,
                scryfall_id: printing.scryfall_id,
                image_uri: printing.image_uri,
                set_name: printing.set_name || ''
            })
        }).then(function () {
            hidePrintingModal();
        });
    }

    function hidePrintingModal() {
        document.getElementById('printing-modal').style.display = 'none';
        printingPickerCardId = null;
        printingPickerCardName = null;
    }

    /* ==================================================================
       SCRY MODAL
       ================================================================== */

    var scryTopCards = [];
    var scryBottomCards = [];

    function showScryModal(data) {
        scryTopCards = (data.cards || []).slice();
        scryBottomCards = [];

        renderScryLists();

        document.getElementById('scry-modal').style.display = 'flex';
    }

    function renderScryLists() {
        var topList = document.getElementById('scry-top-list');
        var bottomList = document.getElementById('scry-bottom-list');
        topList.innerHTML = '';
        bottomList.innerHTML = '';

        scryTopCards.forEach(function (card, idx) {
            topList.appendChild(createScryCardItem(card, 'top', idx));
        });

        scryBottomCards.forEach(function (card, idx) {
            bottomList.appendChild(createScryCardItem(card, 'bottom', idx));
        });
    }

    function createScryCardItem(card, location, index) {
        var item = document.createElement('div');
        item.className = 'scry-card-item';
        item.dataset.cardId = card.id;
        item.dataset.location = location;
        item.dataset.index = index;

        var list = location === 'top' ? scryTopCards : scryBottomCards;

        // Reorder buttons (only when list has >1 items)
        var reorderHtml = '';
        if (location === 'top' && scryTopCards.length > 1) {
            reorderHtml =
                '<span class="scry-reorder">' +
                (index > 0 ? '<button class="scry-btn-up" title="Move up">▲</button>' : '') +
                (index < scryTopCards.length - 1 ? '<button class="scry-btn-down" title="Move down">▼</button>' : '') +
                '</span>';
        }

        item.innerHTML =
            '<span class="scry-card-info">' +
                '<span class="card-name">' + escapeHtml(card.name) + '</span>' +
                '<span class="card-mana">' + renderManaCost(card.mana_cost) + '</span>' +
            '</span>' +
            reorderHtml;

        // Click card info to toggle between top and bottom
        item.querySelector('.scry-card-info').addEventListener('click', function () {
            if (location === 'top') {
                scryTopCards.splice(index, 1);
                scryBottomCards.push(card);
            } else {
                scryBottomCards.splice(index, 1);
                scryTopCards.push(card);
            }
            renderScryLists();
        });

        // Reorder button handlers
        var upBtn = item.querySelector('.scry-btn-up');
        if (upBtn) {
            upBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                scryTopCards.splice(index, 1);
                scryTopCards.splice(index - 1, 0, card);
                renderScryLists();
            });
        }
        var downBtn = item.querySelector('.scry-btn-down');
        if (downBtn) {
            downBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                scryTopCards.splice(index, 1);
                scryTopCards.splice(index + 1, 0, card);
                renderScryLists();
            });
        }

        // Hover preview
        item.addEventListener('mouseenter', function (e) {
            showCardPreview(card, e);
        });
        item.addEventListener('mousemove', function (e) {
            moveCardPreview(e);
        });
        item.addEventListener('mouseleave', function () {
            hideCardPreview();
        });

        return item;
    }

    function confirmScry() {
        var topIds = scryTopCards.map(function (c) { return c.id; });
        var bottomIds = scryBottomCards.map(function (c) { return c.id; });

        MTGSocket.send({
            action: 'scry_resolve',
            card_ids_top: topIds,
            card_ids_bottom: bottomIds
        });

        document.getElementById('scry-modal').style.display = 'none';
        scryTopCards = [];
        scryBottomCards = [];
    }

    /* ==================================================================
       SEARCH LIBRARY MODAL
       ================================================================== */

    var searchCards = [];

    function showSearchModal(data) {
        searchCards = data.cards || [];
        searchSelectedCardId = null;
        searchPlayerIndex = data.player_index;

        document.getElementById('search-filter').value = '';
        document.getElementById('search-destination').style.display = 'none';

        renderSearchList('');

        document.getElementById('search-modal').style.display = 'flex';
        document.getElementById('search-filter').focus();
    }

    function renderSearchList(filter) {
        var list = document.getElementById('search-card-list');
        list.innerHTML = '';

        var filtered = searchCards;
        if (filter) {
            var lowerFilter = filter.toLowerCase();
            filtered = searchCards.filter(function (c) {
                return c.name.toLowerCase().indexOf(lowerFilter) !== -1 ||
                       (c.type_line || '').toLowerCase().indexOf(lowerFilter) !== -1 ||
                       (c.oracle_text || '').toLowerCase().indexOf(lowerFilter) !== -1;
            });
        }

        filtered.forEach(function (card) {
            var item = document.createElement('div');
            item.className = 'search-card-item';
            if (card.id === searchSelectedCardId) {
                item.classList.add('selected');
            }
            item.dataset.cardId = card.id;

            item.innerHTML =
                '<span class="search-card-name">' + escapeHtml(card.name) + '</span>' +
                '<span class="search-card-type">' + escapeHtml(card.type_line || '') + '</span>' +
                '<span class="search-card-mana">' + renderManaCost(card.mana_cost) + '</span>';

            item.addEventListener('click', function () {
                searchSelectedCardId = card.id;
                document.getElementById('search-selected-name').textContent = card.name;
                document.getElementById('search-destination').style.display = 'block';

                // Update selected styling
                list.querySelectorAll('.search-card-item').forEach(function (el) {
                    el.classList.remove('selected');
                });
                item.classList.add('selected');
            });

            // Hover preview
            item.addEventListener('mouseenter', function (e) {
                showCardPreview(card, e);
            });
            item.addEventListener('mousemove', function (e) {
                moveCardPreview(e);
            });
            item.addEventListener('mouseleave', function () {
                hideCardPreview();
            });

            list.appendChild(item);
        });
    }

    function handleSearchDestination(toZone) {
        if (!searchSelectedCardId) return;

        console.log('[Search] Sending search_library:', {
            player_index: searchPlayerIndex,
            card_id: searchSelectedCardId,
            to_zone: toZone
        });
        MTGSocket.send({
            action: 'search_library',
            player_index: searchPlayerIndex !== null ? searchPlayerIndex : 0,
            card_id: searchSelectedCardId,
            to_zone: toZone
        });

        document.getElementById('search-modal').style.display = 'none';
        searchSelectedCardId = null;
        searchCards = [];
    }

    function hideSearchModal() {
        document.getElementById('search-modal').style.display = 'none';
        searchSelectedCardId = null;
        searchCards = [];
    }

    /* ==================================================================
       EVENT BINDING
       ================================================================== */

    function bindEvents() {
        // Dismiss context menus on click elsewhere
        document.addEventListener('click', function (e) {
            // Check if click is inside a context menu
            if (!e.target.closest('.context-menu')) {
                hideAllContextMenus();
            }

            // Cancel link exile mode on click that is not on a card
            if (linkExileMode && !e.target.closest('.card')) {
                cancelLinkExileMode();
            }

            // Cancel attach mode on click that is not on a card
            if (attachMode && !e.target.closest('.card')) {
                cancelAttachMode();
            }
        });

        // Card context menu actions
        document.getElementById('context-menu').addEventListener('click', function (e) {
            var item = e.target.closest('.ctx-item');
            if (!item) return;
            e.stopPropagation();
            handleCardContextAction(item.dataset.action, item);
        });

        // Library context menu actions
        document.getElementById('library-context-menu').addEventListener('click', function (e) {
            var item = e.target.closest('.ctx-item');
            if (!item) return;
            e.stopPropagation();
            handleLibraryContextAction(item.dataset.action);
        });

        // Battlefield context menu actions
        document.getElementById('battlefield-context-menu').addEventListener('click', function (e) {
            var item = e.target.closest('.ctx-item');
            if (!item) return;
            e.stopPropagation();
            handleBattlefieldContextAction(item.dataset.action);
        });

        // Link exile cancel
        document.getElementById('link-exile-cancel').addEventListener('click', function (e) {
            e.stopPropagation();
            cancelLinkExileMode();
        });

        // Attach card cancel
        document.getElementById('attach-card-cancel').addEventListener('click', function (e) {
            e.stopPropagation();
            cancelAttachMode();
        });

        // Scry confirm
        document.getElementById('scry-confirm').addEventListener('click', function () {
            confirmScry();
        });

        // Search filter input
        document.getElementById('search-filter').addEventListener('input', function () {
            renderSearchList(this.value);
        });

        // Search destination buttons
        document.querySelectorAll('.search-dest-buttons .btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                handleSearchDestination(this.dataset.dest);
            });
        });

        // Search cancel
        document.getElementById('search-cancel').addEventListener('click', function () {
            hideSearchModal();
        });

        // Zone viewer close
        document.getElementById('zone-viewer-close').addEventListener('click', function () {
            hideZoneViewer();
        });

        // Printing picker cancel
        document.getElementById('printing-cancel').addEventListener('click', function () {
            hidePrintingModal();
        });

        // Close modals on overlay click (outside modal content)
        document.querySelectorAll('.modal-overlay').forEach(function (overlay) {
            overlay.addEventListener('click', function (e) {
                if (e.target === this) {
                    this.style.display = 'none';
                }
            });
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', function (e) {
            // Escape: close modals and context menus
            if (e.key === 'Escape') {
                hideAllContextMenus();
                hideCardPreview();
                hideZoneViewer();
                hideSearchModal();
                hidePrintingModal();
                document.getElementById('scry-modal').style.display = 'none';
                cancelLinkExileMode();
            }

            // Ctrl+Z: undo
            if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                MTGSocket.send({ action: 'undo' });
            }
        });
    }

    /* ==================================================================
       CONNECTION STATUS INDICATOR
       ================================================================== */

    function createConnectionStatus() {
        var el = document.createElement('div');
        el.className = 'connection-status disconnected';
        el.id = 'connection-status';
        el.textContent = 'Disconnected';
        document.body.appendChild(el);
        return el;
    }

    function updateConnectionStatus() {
        var el = document.getElementById('connection-status');
        if (!el) return;
        if (window.MTGSocket && window.MTGSocket.isConnected()) {
            el.className = 'connection-status connected';
            el.textContent = 'Connected';
        } else {
            el.className = 'connection-status disconnected';
            el.textContent = 'Disconnected';
        }
    }

    /* ==================================================================
       INITIALIZATION
       ================================================================== */

    function init() {
        initPreviewRefs();
        createConnectionStatus();

        // Initialize drag-drop
        DragDrop.init();

        // Set up static UI interactions
        setupLifeCounters();
        setupPhaseTracker();
        setupLibraryInteractions();
        setupZoneViewers();
        bindEvents();

        // Connect WebSocket
        if (window.MTGSocket) {
            MTGSocket.onStateUpdate(function (state) {
                currentState = state;
                scheduleRender();
                updateConnectionStatus();
            });

            MTGSocket.onScryReveal(function (data) {
                showScryModal(data);
            });

            MTGSocket.onSearchReveal(function (data) {
                showSearchModal(data);
            });

            MTGSocket.onError(function (message) {
                console.error('[Board] Server error:', message);
                showErrorToast(message);
            });

            MTGSocket.onOpen(function () {
                updateConnectionStatus();
            });

            MTGSocket.onClose(function () {
                updateConnectionStatus();
            });

            MTGSocket.connect();
        } else {
            console.error('[Board] MTGSocket not found. Make sure ws.js is loaded.');
        }

        // Periodic connection status check
        setInterval(updateConnectionStatus, 3000);

        // Card size slider
        var CARD_SIZE_DEFAULT = 77;
        var sizeSlider = document.getElementById('card-size-slider');
        if (sizeSlider) {
            var savedSize = localStorage.getItem('mtg-card-width');
            if (savedSize) {
                sizeSlider.value = savedSize;
            }
            applyCardSize(parseInt(sizeSlider.value, 10));
            sizeSlider.addEventListener('input', function () {
                var w = parseInt(sizeSlider.value, 10);
                applyCardSize(w);
                localStorage.setItem('mtg-card-width', w);
            });
            var resetBtn = document.getElementById('btn-card-size-reset');
            if (resetBtn) {
                resetBtn.addEventListener('click', function () {
                    sizeSlider.value = CARD_SIZE_DEFAULT;
                    applyCardSize(CARD_SIZE_DEFAULT);
                    localStorage.removeItem('mtg-card-width');
                });
            }
        }

        // Card font size slider
        var CARD_FONT_DEFAULT = 8;
        var fontSlider = document.getElementById('card-font-slider');
        if (fontSlider) {
            var savedFont = localStorage.getItem('mtg-card-font');
            if (savedFont) {
                fontSlider.value = savedFont;
            }
            applyCardFont(parseFloat(fontSlider.value));
            fontSlider.addEventListener('input', function () {
                var f = parseFloat(fontSlider.value);
                applyCardFont(f);
                localStorage.setItem('mtg-card-font', f);
            });
            var fontResetBtn = document.getElementById('btn-card-font-reset');
            if (fontResetBtn) {
                fontResetBtn.addEventListener('click', function () {
                    fontSlider.value = CARD_FONT_DEFAULT;
                    applyCardFont(CARD_FONT_DEFAULT);
                    localStorage.removeItem('mtg-card-font');
                });
            }
        }
    }

    function applyCardSize(w) {
        var h = Math.round(w * 1.39); // 5:7 ratio
        document.documentElement.style.setProperty('--card-width', w + 'px');
        document.documentElement.style.setProperty('--card-height', h + 'px');
    }

    function applyCardFont(f) {
        var sm = Math.max(f - 1, 4); // smaller variant stays 1px below
        document.documentElement.style.setProperty('--card-font', f + 'px');
        document.documentElement.style.setProperty('--card-font-sm', sm + 'px');
    }

    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
