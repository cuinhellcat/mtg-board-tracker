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

    /** @type {boolean} Whether we are in "become copy" mode waiting for a click. */
    var copyMode = false;

    /** @type {string|null} Card ID that will become a copy. */
    var copyCardId = null;

    /** @type {boolean} Whether we are in "create arrow" mode waiting for a click. */
    var arrowMode = false;

    /** @type {string|null} Source card ID for arrow creation. */
    var arrowSourceCardId = null;

    /** @type {string|null} Card ID selected in search modal. */
    var searchSelectedCardId = null;

    /** @type {number|null} Player index for search/scry. */
    var searchPlayerIndex = null;

    /** Debounce token for render. */
    var _renderRafId = null;

    /** True while a drag-and-drop is in progress — suppresses hover preview. */
    var _isDragging = false;


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
    function openCardPicker(title, onSelect, options) {
        _pickerCallback = onSelect;
        _pickerActiveIndex = -1;
        _pickerResults = [];

        var modal = document.getElementById('card-picker-modal');
        var input = document.getElementById('card-picker-input');
        var results = document.getElementById('card-picker-results');
        document.getElementById('card-picker-title').textContent = title;

        // Token toggle visibility
        var tokenToggle = document.getElementById('card-picker-token-toggle');
        var tokenCb = document.getElementById('card-picker-token-cb');
        if (options && options.showTokenToggle) {
            tokenToggle.style.display = '';
            tokenCb.checked = !!(options && options.defaultTokenMode);
        } else {
            tokenToggle.style.display = 'none';
            tokenCb.checked = false;
        }

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
                var tokenCb = document.getElementById('card-picker-token-cb');
                var isToken = tokenCb && tokenCb.checked;
                var url = isToken
                    ? '/api/cards/search-tokens?q=' + encodeURIComponent(query) + '&limit=15'
                    : '/api/cards/search?q=' + encodeURIComponent(query) + '&limit=15';
                fetch(url)
                    .then(function (r) { return r.json(); })
                    .then(function (data) {
                        _pickerRenderResults(data.results || []);
                    });
            }, 150);
        });

        // Re-search when token checkbox is toggled
        var tokenCbEl = document.getElementById('card-picker-token-cb');
        if (tokenCbEl) {
            tokenCbEl.addEventListener('change', function () {
                var ev = new Event('input');
                input.dispatchEvent(ev);
            });
        }

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

    function escapeAttr(str) {
        return escapeHtml(str);
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
        // Sort by zone_moved_at so the most recently moved card is last (top)
        cards.sort(function (a, b) { return (a.zone_moved_at || 0) - (b.zone_moved_at || 0); });
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
        if (card.summoning_sick) el.classList.add('summoning-sick');
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
            ptHtml = '<div class="card-loyalty" title="Left-click: +1 / Right-click: -1">Loy: ' + escapeHtml(String(displayLoyalty)) + '</div>';
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

        // Note indicator
        var noteIndicator = '';
        if (card.note) {
            noteIndicator = '<div class="note-indicator" title="' + escapeHtml(card.note) + '">📝</div>';
        }

        // Inventory toggle indicator (shows when card has attachments/exiled)
        var inventoryToggle = '';
        if (hasInventory) {
            inventoryToggle = '<div class="inventory-toggle" title="Toggle inventory">▶ ' +
                (attachedData.length + linkedExileData.length) + '</div>';
        }

        // Quantity badge (only shown when > 1)
        var quantityBadge = '';
        if (card.quantity > 1) {
            quantityBadge = '<span class="quantity-badge" data-card-id="' + card.id +
                '" title="Left-click: +1 / Right-click: -1">×' + card.quantity + '</span>';
        }

        el.innerHTML = tokenBadge + transformBadge + quantityBadge +
            '<div class="card-header">' +
                '<div class="card-name">' + escapeHtml(displayName) + '</div>' +
                '<div class="card-mana">' + renderManaCost(displayMana) + '</div>' +
            '</div>' +
            '<div class="card-type">' + escapeHtml(displayType) + '</div>' +
            ptHtml +
            customPtHtml +
            counterHtml +
            oracleIndicator +
            noteIndicator +
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

        // Loyalty badge click handlers: left +1, right -1
        if (displayLoyalty !== null) {
            var loyaltyBadge = el.querySelector('.card-loyalty');
            if (loyaltyBadge) {
                loyaltyBadge.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var cur = parseInt(card.loyalty, 10) || 0;
                    MTGSocket.send({ action: 'set_loyalty', card_id: card.id, loyalty: cur + 1 });
                });
                loyaltyBadge.addEventListener('contextmenu', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    var cur = parseInt(card.loyalty, 10) || 0;
                    MTGSocket.send({ action: 'set_loyalty', card_id: card.id, loyalty: cur - 1 });
                });
            }
        }

        // Quantity badge: left-click +1, right-click -1
        if (card.quantity > 1) {
            var qtyBadge = el.querySelector('.quantity-badge');
            if (qtyBadge) {
                qtyBadge.addEventListener('click', function (e) {
                    e.stopPropagation();
                    MTGSocket.send({ action: 'set_quantity', card_id: card.id, quantity: card.quantity + 1 });
                });
                qtyBadge.addEventListener('contextmenu', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    MTGSocket.send({ action: 'set_quantity', card_id: card.id, quantity: card.quantity - 1 });
                });
            }
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

            // If in copy mode, handle differently
            if (copyMode) {
                handleCopyTarget(card.id);
                return;
            }

            // If in arrow mode, handle differently
            if (arrowMode) {
                handleArrowTarget(card.id);
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
            updateArrows();
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

        // Stack zone
        renderStackArea(state);

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

        // Preserve scroll positions across re-render (outer + each subzone)
        var savedScrollTop = container.scrollTop;
        var savedSubzoneScrolls = {};
        container.querySelectorAll('.subzone-cards').forEach(function (sub) {
            var group = sub.closest('[data-battlefield-group]');
            if (group) savedSubzoneScrolls[group.dataset.battlefieldGroup] = sub.scrollTop;
        });

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
        var landsDiv = makeSubzone('bf-subgroup bf-lands', 'Lands', 'land', lands);
        var otherDiv = makeSubzone('bf-subgroup bf-other', 'Other', 'other', other);

        // Apply persisted split ratio
        var savedRatio = parseFloat(localStorage.getItem('mtg-bf-split') || '50');
        landsDiv.style.flex = '0 0 ' + savedRatio + '%';
        otherDiv.style.flex = '1 1 auto';

        // Draggable splitter between Lands and Other
        var splitter = document.createElement('div');
        splitter.className = 'bf-splitter';
        splitter.addEventListener('mousedown', function (startEvt) {
            startEvt.preventDefault();
            var rect = nonliving.getBoundingClientRect();
            function onMove(moveEvt) {
                var pct = ((moveEvt.clientX - rect.left) / rect.width) * 100;
                pct = Math.max(10, Math.min(90, pct));
                landsDiv.style.flex = '0 0 ' + pct + '%';
                localStorage.setItem('mtg-bf-split', pct.toFixed(1));
            }
            function onUp() {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });

        nonliving.appendChild(landsDiv);
        nonliving.appendChild(splitter);
        nonliving.appendChild(otherDiv);
        container.appendChild(nonliving);

        var creaturesDiv = makeSubzone('bf-group bf-creatures', 'Creatures', 'creature', creatures);
        container.appendChild(creaturesDiv);

        // Restore scroll positions (outer + each subzone)
        container.scrollTop = savedScrollTop;
        container.querySelectorAll('.subzone-cards').forEach(function (sub) {
            var group = sub.closest('[data-battlefield-group]');
            if (group && savedSubzoneScrolls[group.dataset.battlefieldGroup]) {
                sub.scrollTop = savedSubzoneScrolls[group.dataset.battlefieldGroup];
            }
        });
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

        var savedScrollTop = container.scrollTop;
        container.innerHTML = '';
        cards.forEach(function (card) {
            container.appendChild(createCardElement(card));
        });
        container.scrollTop = savedScrollTop;
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

        var savedScrollTop = container.scrollTop;
        var handCards = getCardsInZone(state, 'hand', playerIndex);
        document.getElementById('hand-count-' + playerIndex).textContent = handCards.length;

        container.innerHTML = '';

        // LLM hand (player 1): optionally show as numbered card backs
        var hideOpponentHand = playerIndex === 1 &&
            document.getElementById('hide-opponent-hand') &&
            document.getElementById('hide-opponent-hand').checked;

        if (hideOpponentHand) {
            // Use frozen hand order from GameState for stable numbering
            var frozen = (currentState && currentState.frozen_hand_order) || [];
            // Fallback: if frozen is empty (old save / toggled mid-game), use current order
            if (frozen.length === 0) {
                frozen = handCards.map(function (c) { return c.id; });
            }

            handCards.forEach(function (card) {
                var frozenIdx = frozen.indexOf(card.id);
                var displayNum = frozenIdx !== -1 ? frozenIdx + 1 : frozen.length + 1;

                var back = document.createElement('div');
                back.className = 'hidden-hand-card card';
                back.innerHTML = '<span class="hidden-hand-number">' + displayNum + '</span>';
                back.dataset.cardId = card.id;
                back.dataset.zone = 'hand';
                back.dataset.playerIndex = String(playerIndex);
                // Context menu (right-click)
                back.addEventListener('contextmenu', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    showCardContextMenu(e, card);
                });
                back.addEventListener('click', function (e) {
                    e.stopPropagation();
                });
                DragDrop.makeCardDraggable(back);
                container.appendChild(back);
            });
        } else {
            handCards.forEach(function (card) {
                container.appendChild(createCardElement(card));
            });
        }
        container.scrollTop = savedScrollTop;
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

        // Commander Tax pills (one per commander, shown if > 0)
        var taxes = player.commander_taxes || {};
        var taxNames = Object.keys(taxes);
        taxNames.forEach(function(cmdName) {
            var tax = taxes[cmdName];
            if (tax <= 0) return;
            // Short label: use just "Tax" for single commander, commander name for partners
            var label = taxNames.length > 1 ? escapeHtml(cmdName) : 'Tax';
            var taxPill = document.createElement('span');
            taxPill.className = 'extra-counter-pill cmdr-tax-pill';
            taxPill.innerHTML =
                '<span class="extra-counter-btn cmdr-tax-btn" data-player="' + playerIndex + '" data-commander="' + escapeAttr(cmdName) + '" data-delta="-2">−</span>' +
                '<span class="extra-counter-name">' + label + '</span>' +
                '<span class="extra-counter-val">' + tax + '</span>' +
                '<span class="extra-counter-btn cmdr-tax-btn" data-player="' + playerIndex + '" data-commander="' + escapeAttr(cmdName) + '" data-delta="2">+</span>';
            row.appendChild(taxPill);
        });

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
                    commander_name: this.dataset.commander,
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
       STACK ZONE
       ================================================================== */

    function renderStackArea(state) {
        var container = document.getElementById('stack-cards');
        if (!container) return;
        container.innerHTML = '';

        // Gather all stack cards, sorted by zone_moved_at (oldest first = bottom)
        var stackCards = [];
        var allCards = state.cards || {};
        for (var id in allCards) {
            if (allCards[id].zone === 'stack') stackCards.push(allCards[id]);
        }
        stackCards.sort(function (a, b) { return (a.zone_moved_at || 0) - (b.zone_moved_at || 0); });

        var resolveBtn = document.getElementById('btn-resolve-stack');

        if (stackCards.length === 0) {
            resolveBtn.style.display = 'none';
            return;
        }
        resolveBtn.style.display = '';

        // Cards float above everything — position upward from the stack zone
        var overlap = 40;

        stackCards.forEach(function (card, i) {
            var wrapper = document.createElement('div');
            wrapper.className = 'stack-card-wrapper card';
            wrapper.dataset.cardId = card.id;
            wrapper.dataset.cardName = card.name;
            wrapper.dataset.zone = 'stack';
            wrapper.dataset.owner = card.owner_index;
            wrapper.dataset.controller = card.controller_index;
            wrapper.dataset.colors = (card.colors || []).join(',');
            wrapper.setAttribute('draggable', 'true');

            // Fan rotation + stack upward (negative top so cards go above the bar)
            var angle = (i - (stackCards.length - 1) / 2) * 3;
            var offsetY = -(i * overlap) - 340; // push cards above the middle-bar
            wrapper.style.top = offsetY + 'px';
            wrapper.style.left = '-80px'; // center relative to the small stack zone
            wrapper.style.transform = 'rotate(' + angle + 'deg)';
            wrapper.style.zIndex = 500 + i;

            var imgSrc = card.image_uri || '';
            var img = document.createElement('img');
            img.className = 'stack-card-img';
            img.src = imgSrc;
            img.alt = card.name;
            img.draggable = false;

            var label = document.createElement('div');
            label.className = 'stack-card-name';
            label.textContent = card.name;

            wrapper.appendChild(img);
            wrapper.appendChild(label);
            container.appendChild(wrapper);

            DragDrop.makeCardDraggable(wrapper);

            // Hover preview
            wrapper.addEventListener('mouseenter', function (e) { showCardPreview(card, e); });
            wrapper.addEventListener('mouseleave', hideCardPreview);

            // Right-click context menu
            wrapper.addEventListener('contextmenu', function (e) {
                e.preventDefault();
                e.stopPropagation();
                showCardContextMenu(e, card);
            });
        });
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

        // Arrow: only show for battlefield cards
        var arrowItem = menu.querySelector('[data-action="create_arrow"]');
        if (arrowItem) {
            arrowItem.style.display = (card.zone === 'battlefield') ? 'block' : 'none';
        }
        // Manage Arrows: only show if this card has outgoing arrows
        var manageArrowsItem = menu.querySelector('[data-action="manage_arrows"]');
        if (manageArrowsItem) {
            var hasArrows = currentState && currentState.arrows && currentState.arrows.some(function (a) {
                return a.source_card_id === card.id;
            });
            manageArrowsItem.style.display = hasArrows ? 'block' : 'none';
        }

        // Oracle text toggle: show checkmark when enabled
        var oracleItem = menu.querySelector('[data-action="toggle_oracle_text"]');
        if (oracleItem) {
            oracleItem.textContent = card.show_oracle_text ? '☰ Oracle Text für LLM ✓' : '☰ Oracle Text für LLM';
        }

        // Revert copy: only show if card has original_characteristics
        var revertItem = menu.querySelector('[data-action="revert_copy"]');
        if (revertItem) {
            revertItem.style.display = card.original_characteristics ? 'block' : 'none';
        }

        // Note indicator
        var noteItem = menu.querySelector('[data-action="set_note"]');
        if (noteItem) {
            noteItem.textContent = card.note ? '📝 Note ✓' : '📝 Note...';
        }

        // Summoning sickness toggle: only on battlefield
        var summSickItem = menu.querySelector('[data-action="toggle_summoning_sick"]');
        if (summSickItem) {
            summSickItem.style.display = (card.zone === 'battlefield') ? 'block' : 'none';
            summSickItem.textContent = card.summoning_sick ? '💫 Summoning Sickness ✓' : '💫 Summoning Sickness';
        }

        var qtyItem = menu.querySelector('[data-action="set_quantity"]');
        if (qtyItem) {
            qtyItem.textContent = card.quantity > 1 ? 'Remove Quantity Badge' : 'Set Quantity (×2, ×3...)';
        }

        var deleteItem = menu.querySelector('[data-action="delete_card"]');
        if (deleteItem) {
            deleteItem.style.display = (card.is_conjured || card.is_token) ? 'block' : 'none';
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

        // Move-to group: show for graveyard, normal exile, and stack cards
        var moveToGroup = document.getElementById('ctx-move-to-group');
        if (moveToGroup) {
            moveToGroup.style.display = (card.zone === 'graveyard' || card.zone === 'exile' || card.zone === 'stack') ? '' : 'none';
        }

        // Stack: show for hand, battlefield, command_zone cards
        var stackItem = menu.querySelector('[data-zone="stack"]');
        if (stackItem) {
            var canStack = card.zone === 'hand' || card.zone === 'battlefield' || card.zone === 'command_zone';
            stackItem.style.display = canStack ? 'block' : 'none';
        }

        // Library (bottom): only for hand cards
        var bottomItem = menu.querySelector('[data-zone="library_bottom"]');
        if (bottomItem) {
            bottomItem.style.display = (card.zone === 'hand') ? 'block' : 'none';
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

            case 'set_quantity':
                // Start with 2 (user activates because they have more than 1)
                var currentCard = currentState && currentState.cards ? currentState.cards[cardId] : null;
                var currentQty = (currentCard && currentCard.quantity > 1) ? currentCard.quantity : 1;
                var newQty = currentQty > 1 ? 1 : 2;  // Toggle: if already has quantity, reset to 1 (remove badge)
                MTGSocket.send({ action: 'set_quantity', card_id: cardId, quantity: newQty });
                break;

            case 'create_token':
                handleCreateToken();
                break;

            case 'clone_card':
                MTGSocket.send({ action: 'clone_card', card_id: cardId });
                break;

            case 'become_copy':
                startCopyMode(cardId);
                break;

            case 'revert_copy':
                MTGSocket.send({ action: 'revert_copy', card_id: cardId });
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

            case 'create_arrow':
                startArrowMode(cardId);
                break;

            case 'manage_arrows':
                openArrowModal(cardId);
                break;

            case 'toggle_summoning_sick':
                MTGSocket.send({ action: 'toggle_summoning_sick', card_id: cardId });
                break;

            case 'set_note':
                var ctxCardNote = currentState && currentState.cards[cardId];
                var existingNote = (ctxCardNote && ctxCardNote.note) || '';
                var newNote = prompt('Note (appears in snapshot as oracle text):', existingNote);
                if (newNote !== null) {
                    MTGSocket.send({ action: 'set_note', card_id: cardId, note: newNote });
                }
                break;

            case 'toggle_oracle_text':
                MTGSocket.send({ action: 'toggle_oracle_text', card_id: cardId });
                break;

            case 'copy_oracle_text':
                var ctxCard = currentState && currentState.cards[cardId];
                if (ctxCard) {
                    var text = ctxCard.name;
                    if (ctxCard.mana_cost) text += ' ' + ctxCard.mana_cost;
                    text += '\n' + ctxCard.type_line;
                    if (ctxCard.oracle_text) text += '\n\n' + ctxCard.oracle_text;
                    if (ctxCard.power !== null && ctxCard.toughness !== null) text += '\n\n' + ctxCard.power + '/' + ctxCard.toughness;
                    if (ctxCard.loyalty !== null) text += '\n\nLoyalty: ' + ctxCard.loyalty;
                    var fallbackCopy = function(t) {
                        var ta = document.createElement('textarea');
                        ta.value = t;
                        ta.style.position = 'fixed';
                        ta.style.opacity = '0';
                        document.body.appendChild(ta);
                        ta.select();
                        document.execCommand('copy');
                        document.body.removeChild(ta);
                    };
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(text).catch(function() { fallbackCopy(text); });
                    } else {
                        fallbackCopy(text);
                    }
                }
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

    /** Handle create token — opens card picker with token search, then creates. */
    function handleCreateToken(playerIndex) {
        var pi = playerIndex !== undefined ? playerIndex : 1;

        openCardPicker('Token erstellen — Name suchen', function (token) {
            // Token found via search: create directly with Scryfall data
            if (token.type_line) {
                MTGSocket.send({
                    action: 'create_token',
                    player_index: pi,
                    name: token.name,
                    power: token.power || null,
                    toughness: token.toughness || null,
                    type_line: token.type_line,
                    abilities: token.oracle_text || '',
                    scryfall_id: token.scryfall_id || '',
                    image_uri: token.image_uri || '',
                    large_image_uri: token.large_image_uri || ''
                });
            } else {
                // Fallback: manual prompts for custom tokens
                var name = token.name;
                var pt = prompt('Power/Toughness (z.B. 2/2, leer für Nicht-Kreatur):');
                var power = null, toughness = null;
                var defaultType = 'Token — ' + name.trim();
                if (pt && pt.trim()) {
                    var parts = pt.split('/');
                    power = (parts[0] || '0').trim();
                    toughness = (parts[1] || '0').trim();
                    defaultType = 'Token Creature — ' + name.trim();
                }
                var typeLine = prompt('Type line:', defaultType) || defaultType;
                var abilities = prompt('Abilities (optional):') || '';
                MTGSocket.send({
                    action: 'create_token',
                    player_index: pi,
                    name: name.trim(),
                    power: power,
                    toughness: toughness,
                    type_line: typeLine.trim(),
                    abilities: abilities.trim()
                });
            }
        }, { showTokenToggle: true, defaultTokenMode: true });
    }

    function handleCustomToken(playerIndex) {
        var pi = playerIndex !== undefined ? playerIndex : 1;
        var name = prompt('Token Name:');
        if (!name || !name.trim()) return;
        var pt = prompt('Power/Toughness (z.B. 2/2, leer für Nicht-Kreatur):');
        var power = null, toughness = null;
        var defaultType = 'Token — ' + name.trim();
        if (pt && pt.trim()) {
            var parts = pt.split('/');
            power = (parts[0] || '0').trim();
            toughness = (parts[1] || '0').trim();
            defaultType = 'Token Creature — ' + name.trim();
        }
        var typeLine = prompt('Type line:', defaultType) || defaultType;
        var abilities = prompt('Abilities (optional):') || '';
        MTGSocket.send({
            action: 'create_token',
            player_index: pi,
            name: name.trim(),
            power: power,
            toughness: toughness,
            type_line: typeLine.trim(),
            abilities: abilities.trim()
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

            case 'copy_library':
                copyLibraryToClipboard(pi);
                break;

            case 'mill':
                openMillDialog(pi);
                break;

            case 'mulligan':
                MTGSocket.send({ action: 'mulligan', player_index: pi });
                break;
        }

        hideAllContextMenus();
    }

    function openMillDialog(playerIndex) {
        var dialog = document.getElementById('mill-dialog');
        var input = document.getElementById('mill-count');
        input.value = '1';
        dialog.style.display = '';
        input.focus();
        input.select();

        var minusBtn = document.getElementById('mill-minus');
        var plusBtn = document.getElementById('mill-plus');
        var confirmBtn = document.getElementById('mill-confirm');
        var cancelBtn = document.getElementById('mill-cancel');

        function cleanup() {
            dialog.style.display = 'none';
            minusBtn.replaceWith(minusBtn.cloneNode(true));
            plusBtn.replaceWith(plusBtn.cloneNode(true));
            confirmBtn.replaceWith(confirmBtn.cloneNode(true));
            cancelBtn.replaceWith(cancelBtn.cloneNode(true));
            input.removeEventListener('keydown', onKeydown);
        }

        function doMill() {
            var count = parseInt(input.value, 10);
            if (count > 0) {
                MTGSocket.send({ action: 'mill', player_index: playerIndex, count: count });
            }
            cleanup();
        }

        function onKeydown(e) {
            if (e.key === 'Enter') { e.preventDefault(); doMill(); }
            else if (e.key === 'Escape') { cleanup(); }
        }

        input.addEventListener('keydown', onKeydown);

        document.getElementById('mill-minus').addEventListener('click', function () {
            var v = parseInt(input.value, 10) || 1;
            if (v > 1) input.value = v - 1;
        });
        document.getElementById('mill-plus').addEventListener('click', function () {
            var v = parseInt(input.value, 10) || 0;
            input.value = v + 1;
        });
        document.getElementById('mill-confirm').addEventListener('click', doMill);
        document.getElementById('mill-cancel').addEventListener('click', cleanup);
    }

    function copyLibraryToClipboard(playerIndex) {
        if (!currentState) return;
        var libCards = getCardsInZone(currentState, 'library', playerIndex);
        if (libCards.length === 0) {
            showErrorToast('Library is empty');
            return;
        }
        var playerName = currentState.players[playerIndex]
            ? currentState.players[playerIndex].name : 'Player ' + playerIndex;
        var lines = [playerName + "'s Library (" + libCards.length + ' cards):'];
        libCards.forEach(function (card) {
            var parts = [card.name];
            if (card.mana_cost) parts.push(card.mana_cost);
            if (card.type_line) parts.push('[' + card.type_line + ']');
            lines.push('  - ' + parts.join(' '));
        });
        var text = lines.join('\n');
        navigator.clipboard.writeText(text).then(function () {
            showErrorToast('Library copied!');
        }).catch(function () {
            showErrorToast('Copy failed');
        });
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
            case 'bf_custom_token':
                handleCustomToken(pi);
                break;

            case 'bf_add_card_battlefield':
            case 'bf_add_card_hand':
                var addZone = actionType === 'bf_add_card_hand' ? 'hand' : 'battlefield';
                var addPi = pi;
                openCardPicker('Karte hinzufügen — Name suchen', function (card) {
                    var isToken = card.type_line && card.type_line.toLowerCase().indexOf('token') !== -1;
                    if (isToken) {
                        MTGSocket.send({
                            action: 'create_token',
                            player_index: addPi,
                            name: card.name,
                            power: card.power || null,
                            toughness: card.toughness || null,
                            type_line: card.type_line,
                            abilities: card.oracle_text || '',
                            scryfall_id: card.scryfall_id || '',
                            image_uri: card.image_uri || '',
                            large_image_uri: card.large_image_uri || ''
                        });
                    } else {
                        MTGSocket.send({
                            action: 'add_card',
                            player_index: addPi,
                            name: card.name.trim(),
                            zone: addZone
                        });
                    }
                }, { showTokenToggle: true });
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
       BECOME COPY MODE
       ================================================================== */

    function startCopyMode(cardId) {
        copyMode = true;
        copyCardId = cardId;
        document.getElementById('copy-card-prompt').style.display = 'flex';
    }

    function cancelCopyMode() {
        copyMode = false;
        copyCardId = null;
        document.getElementById('copy-card-prompt').style.display = 'none';
    }

    function handleCopyTarget(targetCardId) {
        if (!copyCardId) return;
        MTGSocket.send({
            action: 'become_copy',
            card_id: copyCardId,
            target_card_id: targetCardId
        });
        cancelCopyMode();
    }

    /* ==================================================================
       ARROW MODE
       ================================================================== */

    function startArrowMode(cardId) {
        arrowMode = true;
        arrowSourceCardId = cardId;
        document.getElementById('arrow-prompt').style.display = 'flex';
    }

    function cancelArrowMode() {
        arrowMode = false;
        arrowSourceCardId = null;
        document.getElementById('arrow-prompt').style.display = 'none';
    }

    function handleArrowTarget(targetCardId) {
        if (!arrowSourceCardId) return;
        MTGSocket.send({
            action: 'create_arrow',
            source_card_id: arrowSourceCardId,
            target_card_id: targetCardId
        });
        cancelArrowMode();
    }

    /* ==================================================================
       ARROW SVG RENDERING
       ================================================================== */

    function updateArrows() {
        if (!currentState || !currentState.arrows) return;
        // Remove old SVG overlays
        document.querySelectorAll('.arrow-svg-overlay').forEach(function (el) { el.remove(); });

        var arrows = currentState.arrows;
        if (!arrows.length) return;

        // Count arrows per source card for arc offset calculation
        var sourceArrowIndex = {};
        arrows.forEach(function (arrow) {
            if (!sourceArrowIndex[arrow.source_card_id]) sourceArrowIndex[arrow.source_card_id] = 0;
        });

        arrows.forEach(function (arrow) {
            var sourceEl = document.querySelector('.card[data-card-id="' + arrow.source_card_id + '"]');
            var targetEl = document.querySelector('.card[data-card-id="' + arrow.target_card_id + '"]');
            if (!sourceEl || !targetEl) return;

            // Find common ancestor battlefield zone
            var sourceZone = sourceEl.closest('.zone-battlefield');
            var targetZone = targetEl.closest('.zone-battlefield');
            if (!sourceZone || !targetZone) return;

            // Use the board container as the SVG parent for cross-zone arrows
            var container = sourceZone === targetZone ? sourceZone : document.getElementById('board-container');
            if (!container) container = document.body;

            var svg = container.querySelector('.arrow-svg-overlay');
            if (!svg) {
                svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('class', 'arrow-svg-overlay');
                svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:50;overflow:visible;';
                container.style.position = container.style.position || 'relative';
                container.appendChild(svg);
            }

            // Ensure defs with arrowhead markers exist
            if (!svg.querySelector('defs')) {
                var defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
                var marker1 = createArrowMarker('arrowhead-white', 'rgba(255,255,255,0.7)');
                var marker2 = createArrowMarker('arrowhead-green', 'rgba(100,220,100,0.85)');
                defs.appendChild(marker1);
                defs.appendChild(marker2);
                svg.appendChild(defs);
            }

            var containerRect = container.getBoundingClientRect();
            var srcRect = sourceEl.getBoundingClientRect();
            var tgtRect = targetEl.getBoundingClientRect();

            var x1 = srcRect.left + srcRect.width / 2 - containerRect.left;
            var y1 = srcRect.top + srcRect.height / 2 - containerRect.top;
            var x2 = tgtRect.left + tgtRect.width / 2 - containerRect.left;
            var y2 = tgtRect.top + tgtRect.height / 2 - containerRect.top;

            // Arc offset: increases per arrow from the same source
            var idx = sourceArrowIndex[arrow.source_card_id]++;
            var arcBase = 40 + idx * 25;

            // Control point perpendicular to the midpoint
            var mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
            var dx = x2 - x1, dy = y2 - y1;
            var dist = Math.sqrt(dx * dx + dy * dy) || 1;
            // Arc strength scales with distance but has a minimum
            var arcStrength = Math.max(arcBase, dist * 0.2 + idx * 20);
            // Perpendicular direction (always curve upward/left)
            var cx = mx + (-dy / dist) * arcStrength;
            var cy = my + (dx / dist) * arcStrength;

            var hasBuff = arrow.buff_power != null || arrow.buff_toughness != null;
            var color = hasBuff ? 'rgba(100,220,100,0.85)' : 'rgba(255,255,255,0.7)';
            var markerUrl = hasBuff ? 'url(#arrowhead-green)' : 'url(#arrowhead-white)';

            var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', 'M' + x1 + ',' + y1 + ' Q' + cx + ',' + cy + ' ' + x2 + ',' + y2);
            path.setAttribute('stroke', color);
            path.setAttribute('stroke-width', '2');
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke-dasharray', hasBuff ? 'none' : '6,3');
            path.setAttribute('marker-end', markerUrl);
            svg.appendChild(path);

            // Label for buff — placed at the curve apex (control point area)
            if (hasBuff) {
                // Point on quadratic bezier at t=0.5: B = 0.25*P0 + 0.5*CP + 0.25*P2
                var labelX = 0.25 * x1 + 0.5 * cx + 0.25 * x2;
                var labelY = 0.25 * y1 + 0.5 * cy + 0.25 * y2;

                var text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                text.setAttribute('x', labelX);
                text.setAttribute('y', labelY);
                text.setAttribute('fill', color);
                text.setAttribute('font-size', '11');
                text.setAttribute('font-weight', 'bold');
                text.setAttribute('text-anchor', 'middle');
                text.setAttribute('dominant-baseline', 'middle');
                text.textContent = '+' + (arrow.buff_power || 0) + '/+' + (arrow.buff_toughness || 0);
                svg.appendChild(text);
            }
        });
    }

    function createArrowMarker(id, color) {
        var marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
        marker.setAttribute('id', id);
        marker.setAttribute('markerWidth', '8');
        marker.setAttribute('markerHeight', '6');
        marker.setAttribute('refX', '8');
        marker.setAttribute('refY', '3');
        marker.setAttribute('orient', 'auto');
        marker.setAttribute('markerUnits', 'strokeWidth');
        var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M0,0 L8,3 L0,6 Z');
        path.setAttribute('fill', color);
        marker.appendChild(path);
        return marker;
    }

    /* ==================================================================
       ARROW MANAGEMENT MODAL
       ================================================================== */

    function openArrowModal(cardId) {
        if (!currentState || !currentState.arrows) return;
        var arrows = currentState.arrows.filter(function (a) {
            return a.source_card_id === cardId;
        });
        if (!arrows.length) {
            alert('No arrows from this card.');
            return;
        }

        var listEl = document.getElementById('arrow-modal-list');
        listEl.innerHTML = '';

        arrows.forEach(function (arrow) {
            var targetCard = currentState.cards[arrow.target_card_id];
            var targetName = targetCard ? targetCard.name : '(unknown)';
            // Active buff from server (null = no buff yet)
            var hasActiveBuff = arrow.buff_power != null;
            var curP = hasActiveBuff ? arrow.buff_power : 1;
            var curT = hasActiveBuff ? arrow.buff_toughness : 1;
            // Track whether user has confirmed the buff
            var buffConfirmed = hasActiveBuff;

            var row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:8px;padding:6px;background:rgba(255,255,255,0.05);border-radius:4px;';

            var nameSpan = document.createElement('span');
            nameSpan.textContent = '→ ' + targetName;
            nameSpan.style.cssText = 'flex:1;color:#ddd;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
            row.appendChild(nameSpan);

            // Buff display
            var buffDisplay = document.createElement('span');
            buffDisplay.style.cssText = 'font-weight:bold; min-width:60px; text-align:center; cursor:pointer;';
            buffDisplay.title = 'Click to type custom value';

            function updateDisplay() {
                if (buffConfirmed && curP === 0 && curT === 0) {
                    buffDisplay.textContent = 'no buff';
                    buffDisplay.style.color = '#888';
                } else if (!buffConfirmed) {
                    buffDisplay.textContent = '+' + curP + '/+' + curT;
                    buffDisplay.style.color = '#886';  // dim/pending color
                } else {
                    buffDisplay.textContent = '+' + curP + '/+' + curT;
                    buffDisplay.style.color = '#6dc';
                }
                setBtn.style.display = buffConfirmed ? 'none' : '';
            }

            // Click on display to manually enter value
            buffDisplay.addEventListener('click', function () {
                var val = prompt('Buff (z.B. +2/+2 oder 3):', '+' + curP + '/+' + curT);
                if (val === null) return;
                val = val.trim().replace(/\+/g, '');
                if (!val || val === '0' || val === '0/0') {
                    curP = 0; curT = 0;
                } else {
                    var parts = val.split('/');
                    curP = parseInt(parts[0]) || 0;
                    curT = parts.length > 1 ? (parseInt(parts[1]) || 0) : curP;
                }
                buffConfirmed = true;
                updateDisplay();
                sendBuff();
            });
            row.appendChild(buffDisplay);

            function sendBuff() {
                if (curP === 0 && curT === 0) {
                    MTGSocket.send({ action: 'update_arrow_buff', arrow_id: arrow.id, buff_power: null, buff_toughness: null });
                } else {
                    MTGSocket.send({ action: 'update_arrow_buff', arrow_id: arrow.id, buff_power: curP, buff_toughness: curT });
                }
            }

            // "Set" button — confirms the pending default, hidden once confirmed
            var setBtn = document.createElement('button');
            setBtn.className = 'btn btn-sm';
            setBtn.textContent = 'Set';
            setBtn.style.cssText = 'padding:2px 8px;';
            setBtn.addEventListener('click', function () {
                buffConfirmed = true;
                updateDisplay();
                sendBuff();
            });
            row.appendChild(setBtn);

            // − button
            var minusBtn = document.createElement('button');
            minusBtn.className = 'btn btn-sm';
            minusBtn.textContent = '−';
            minusBtn.style.cssText = 'padding:2px 10px;font-size:14px;font-weight:bold;';
            minusBtn.addEventListener('click', function () {
                curP--; curT--;
                buffConfirmed = true;
                updateDisplay();
                sendBuff();
            });
            row.appendChild(minusBtn);

            // + button
            var plusBtn = document.createElement('button');
            plusBtn.className = 'btn btn-sm';
            plusBtn.textContent = '+';
            plusBtn.style.cssText = 'padding:2px 10px;font-size:14px;font-weight:bold;';
            plusBtn.addEventListener('click', function () {
                curP++; curT++;
                buffConfirmed = true;
                updateDisplay();
                sendBuff();
            });
            row.appendChild(plusBtn);

            // Delete button
            var delBtn = document.createElement('button');
            delBtn.className = 'btn btn-sm btn-danger';
            delBtn.textContent = '✕';
            delBtn.style.cssText = 'padding:2px 8px;margin-left:4px;';
            delBtn.addEventListener('click', function () {
                MTGSocket.send({ action: 'remove_arrow', arrow_id: arrow.id });
                row.remove();
            });
            row.appendChild(delBtn);

            updateDisplay();

            listEl.appendChild(row);
        });

        document.getElementById('arrow-modal-overlay').style.display = 'flex';
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

    // Preview zoom state
    var ZOOM_LEVELS = [1, 1.3, 1.6, 2.0];
    var BASE_WIDTH = 265;
    var BASE_HEIGHT = 370;
    var previewZoomIndex = 0;
    var previewZoomCard = null;  // scryfall_id of currently previewed card
    var previewCardRef = null;   // full card object for current preview
    var cardZoomPrefs = JSON.parse(localStorage.getItem('cardZoomPrefs') || '{}');
    var globalHoverZoom = parseInt(localStorage.getItem('mtg-hover-zoom') || '0', 10);


    function saveCardZoomPref(scryfallId, zoomIdx) {
        if (!scryfallId) return;
        if (zoomIdx === 0) {
            delete cardZoomPrefs[scryfallId];
        } else {
            cardZoomPrefs[scryfallId] = zoomIdx;
        }
        localStorage.setItem('cardZoomPrefs', JSON.stringify(cardZoomPrefs));
    }

    function applyPreviewZoom() {
        if (!previewEl || previewEl.style.display === 'none') return;
        var zoom = ZOOM_LEVELS[previewZoomIndex];
        var w = Math.round(BASE_WIDTH * zoom);
        var h = Math.round(BASE_HEIGHT * zoom);
        var imgs = previewEl.querySelectorAll('.card-preview-face img');
        for (var i = 0; i < imgs.length; i++) {
            imgs[i].style.width = w + 'px';
            imgs[i].style.height = h + 'px';
        }
        var fallback = previewEl.querySelector('.card-preview-fallback');
        if (fallback) {
            fallback.style.width = w + 'px';
            fallback.style.minHeight = h + 'px';
        }
        // Switch to large image when zoomed in (respect transform state)
        if (zoom > 1 && previewCardRef) {
            var bf = previewCardRef.back_face || {};
            var isXformed = previewCardRef.transformed && bf.name;
            var frontLarge = previewCardRef.large_image_uri;
            var backLarge = bf.large_image_uri;
            var mainLarge = isXformed ? (backLarge || frontLarge) : frontLarge;
            var otherLarge = isXformed ? frontLarge : backLarge;
            if (mainLarge && previewImg && previewImg.src !== mainLarge) {
                previewImg.src = mainLarge;
            }
            if (otherLarge && previewBackImg && previewBackImg.src !== otherLarge) {
                previewBackImg.src = otherLarge;
            }
        }
    }

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
        if (_isDragging) return;
        if (!previewEl) initPreviewRefs();
        previewCardRef = card;
        previewZoomCard = card.scryfall_id || card.id;
        previewZoomIndex = cardZoomPrefs[previewZoomCard] !== undefined ? cardZoomPrefs[previewZoomCard] : globalHoverZoom;

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
            // Left = active face (clear), right = inactive face (dimmed)
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
        applyPreviewZoom();
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
        previewCardRef = null;
        previewZoomCard = null;
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
                            showZoneViewer('Graveyard — ' + getPlayerName(pi), cards, 'graveyard');
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
                            showZoneViewer('Exile — ' + getPlayerName(pi), cards, 'exile');
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

    var zvSelectedCardId = null;
    var zvSourceZone = null;

    function showZoneViewer(title, cards, sourceZone) {
        zvSelectedCardId = null;
        zvSourceZone = sourceZone || null;
        var modal = document.getElementById('zone-viewer-modal');
        document.getElementById('zone-viewer-title').textContent = title;
        document.getElementById('zv-destination').style.display = 'none';

        var grid = document.getElementById('zone-viewer-list');
        grid.innerHTML = '';

        cards.forEach(function (card) {
            var item = document.createElement('div');
            item.className = 'zv-item';
            item.dataset.cardId = card.id;

            if (card.image_uri) {
                var img = document.createElement('img');
                img.src = card.image_uri;
                img.alt = card.name;
                img.loading = 'lazy';
                img.onerror = function () {
                    this.parentNode.innerHTML = createZoneViewerFallback(card);
                };
                item.appendChild(img);
            } else {
                item.innerHTML = createZoneViewerFallback(card);
            }

            var label = document.createElement('div');
            label.className = 'zv-label';
            label.textContent = card.name;
            item.appendChild(label);

            // Left-click: select card, show destination buttons
            item.addEventListener('click', function () {
                zvSelectedCardId = card.id;
                document.getElementById('zv-selected-name').textContent = card.name;
                document.getElementById('zv-destination').style.display = 'block';
                // Hide destination button matching current zone
                var destBtns = document.querySelectorAll('.zv-dest-buttons .btn');
                for (var i = 0; i < destBtns.length; i++) {
                    destBtns[i].style.display = (destBtns[i].dataset.dest === zvSourceZone) ? 'none' : '';
                }
                // Selected styling
                grid.querySelectorAll('.zv-item').forEach(function (el) { el.classList.remove('zv-selected'); });
                item.classList.add('zv-selected');
            });

            // Hover preview
            item.addEventListener('mouseenter', function (e) { showCardPreview(card, e); });
            item.addEventListener('mousemove', function (e) { moveCardPreview(e); });
            item.addEventListener('mouseleave', function () { hideCardPreview(); });

            // Right-click: context menu
            item.addEventListener('contextmenu', function (e) {
                e.preventDefault();
                e.stopPropagation();
                showCardContextMenu(e, card);
            });

            grid.appendChild(item);
        });

        modal.style.display = 'flex';
    }

    function handleZvDestination(toZone) {
        if (!zvSelectedCardId) return;
        if (toZone === 'library_top') {
            MTGSocket.send({ action: 'move_card', card_id: zvSelectedCardId, to_zone: 'library', to_player_index: getCardOwner(zvSelectedCardId) });
        } else if (toZone === 'library_bottom') {
            MTGSocket.send({ action: 'bottom_card', card_id: zvSelectedCardId });
        } else {
            MTGSocket.send({ action: 'move_card', card_id: zvSelectedCardId, to_zone: toZone, to_player_index: getCardOwner(zvSelectedCardId) });
        }
        // Remove the card from the grid
        var el = document.querySelector('.zv-item[data-card-id="' + zvSelectedCardId + '"]');
        if (el) el.remove();
        zvSelectedCardId = null;
        document.getElementById('zv-destination').style.display = 'none';
        // Close modal if no cards left
        if (document.getElementById('zone-viewer-list').children.length === 0) {
            hideZoneViewer();
        }
    }

    function createZoneViewerFallback(card) {
        return '<div class="zv-fallback">' +
            '<div class="zv-fb-name">' + escapeHtml(card.name) + '</div>' +
            '<div class="zv-fb-type">' + escapeHtml(card.type_line) + '</div>' +
            '<div class="zv-fb-text">' + escapeHtml(card.oracle_text || '') + '</div>' +
            '</div>';
    }

    function hideZoneViewer() {
        document.getElementById('zone-viewer-modal').style.display = 'none';
        hideCardPreview();
        zvSelectedCardId = null;
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

        var url = '/api/cards/printings?name=' + encodeURIComponent(card.name);
        if (card.is_token) {
            url += '&is_token=1';
        }
        fetch(url)
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
                large_image_uri: printing.large_image_uri || '',
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

    var scryZones = { top: [], bottom: [], graveyard: [] };
    var scryDragCardId = null;

    function showScryModal(data) {
        scryZones.top = (data.cards || []).slice();
        scryZones.bottom = [];
        scryZones.graveyard = [];
        renderScryLists();
        document.getElementById('scry-modal').style.display = 'flex';
    }

    function renderScryLists() {
        ['top', 'bottom', 'graveyard'].forEach(function (zone) {
            var listEl = document.getElementById('scry-' + zone + '-list');
            listEl.innerHTML = '';
            scryZones[zone].forEach(function (card, idx) {
                listEl.appendChild(createScryCardItem(card, zone, idx));
            });
        });
    }

    function removeFromScryZone(cardId) {
        for (var z in scryZones) {
            scryZones[z] = scryZones[z].filter(function (c) { return c.id !== cardId; });
        }
    }

    function findScryCard(cardId) {
        for (var z in scryZones) {
            for (var i = 0; i < scryZones[z].length; i++) {
                if (scryZones[z][i].id === cardId) return scryZones[z][i];
            }
        }
        return null;
    }

    function createScryCardItem(card, zone, index) {
        var item = document.createElement('div');
        item.className = 'scry-card-item';
        item.draggable = true;
        item.dataset.cardId = card.id;

        // Reorder buttons for top zone
        var reorderHtml = '';
        if (zone === 'top' && scryZones.top.length > 1) {
            reorderHtml =
                '<span class="scry-reorder">' +
                (index > 0 ? '<button class="scry-btn-up" title="Move up">▲</button>' : '') +
                (index < scryZones.top.length - 1 ? '<button class="scry-btn-down" title="Move down">▼</button>' : '') +
                '</span>';
        }

        item.innerHTML =
            '<span class="scry-card-info">' +
                '<span class="card-name">' + escapeHtml(card.name) + '</span>' +
                '<span class="card-mana">' + renderManaCost(card.mana_cost) + '</span>' +
            '</span>' +
            reorderHtml;

        // Drag start
        item.addEventListener('dragstart', function (e) {
            scryDragCardId = card.id;
            e.dataTransfer.effectAllowed = 'move';
            item.classList.add('scry-dragging');
        });
        item.addEventListener('dragend', function () {
            item.classList.remove('scry-dragging');
            scryDragCardId = null;
        });

        // Reorder button handlers
        var upBtn = item.querySelector('.scry-btn-up');
        if (upBtn) {
            upBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                scryZones.top.splice(index, 1);
                scryZones.top.splice(index - 1, 0, card);
                renderScryLists();
            });
        }
        var downBtn = item.querySelector('.scry-btn-down');
        if (downBtn) {
            downBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                scryZones.top.splice(index, 1);
                scryZones.top.splice(index + 1, 0, card);
                renderScryLists();
            });
        }

        // Hover preview
        item.addEventListener('mouseenter', function (e) { showCardPreview(card, e); });
        item.addEventListener('mousemove', function (e) { moveCardPreview(e); });
        item.addEventListener('mouseleave', function () { hideCardPreview(); });

        return item;
    }

    function setupScryDropZones() {
        ['top', 'bottom', 'graveyard'].forEach(function (zone) {
            var dropEl = document.getElementById('scry-drop-' + zone);
            dropEl.addEventListener('dragover', function (e) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                dropEl.classList.add('scry-drop-active');
            });
            dropEl.addEventListener('dragleave', function () {
                dropEl.classList.remove('scry-drop-active');
            });
            dropEl.addEventListener('drop', function (e) {
                e.preventDefault();
                dropEl.classList.remove('scry-drop-active');
                if (!scryDragCardId) return;
                var card = findScryCard(scryDragCardId);
                if (!card) return;
                removeFromScryZone(scryDragCardId);
                scryZones[zone].push(card);
                renderScryLists();
            });
        });
    }

    var SCRY_ORACLE_SKIP = new Set([
        'Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes',
        'Snow-Covered Plains', 'Snow-Covered Island', 'Snow-Covered Swamp',
        'Snow-Covered Mountain', 'Snow-Covered Forest',
        'Treasure', 'Food', 'Clue', 'Blood', 'Gold',
        'Map', 'Powerstone', 'Junk', 'Shard', 'Incubator'
    ]);

    function stripReminderText(text) {
        return text.replace(/\s*\([^()]*\)/g, '').trim();
    }

    function copyScryCards() {
        var allCards = scryZones.top.concat(scryZones.bottom).concat(scryZones.graveyard);
        if (!allCards.length) return;
        var lines = ['Scry/Surveil (' + allCards.length + ' cards):'];
        allCards.forEach(function (card) {
            var parts = [card.name];
            if (card.mana_cost) parts.push(card.mana_cost);
            if (card.type_line) parts.push('[' + card.type_line + ']');
            if (card.oracle_text && !SCRY_ORACLE_SKIP.has(card.name)) {
                var oracle = stripReminderText(card.oracle_text.replace(/\n/g, ' / '));
                if (oracle) parts.push('-- ' + oracle);
            }
            lines.push('  - ' + parts.join(' '));
        });
        navigator.clipboard.writeText(lines.join('\n')).catch(function () {});
        var btn = document.getElementById('scry-copy');
        btn.textContent = 'Copied!';
        setTimeout(function () { btn.textContent = 'Copy for Bot'; }, 1500);
    }

    function confirmScry() {
        MTGSocket.send({
            action: 'scry_resolve',
            card_ids_top: scryZones.top.map(function (c) { return c.id; }),
            card_ids_bottom: scryZones.bottom.map(function (c) { return c.id; }),
            card_ids_graveyard: scryZones.graveyard.map(function (c) { return c.id; })
        });

        document.getElementById('scry-modal').style.display = 'none';
        scryZones = { top: [], bottom: [], graveyard: [] };
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
        // Hide-opponent-hand toggle (persisted in localStorage)
        var hideHandCb = document.getElementById('hide-opponent-hand');
        if (hideHandCb) {
            hideHandCb.checked = localStorage.getItem('hideOpponentHand') !== 'false';
            hideHandCb.addEventListener('change', function () {
                localStorage.setItem('hideOpponentHand', hideHandCb.checked);
                scheduleRender();
            });
        }

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

            // Cancel copy mode on click that is not on a card
            if (copyMode && !e.target.closest('.card')) {
                cancelCopyMode();
            }

            // Cancel arrow mode on click that is not on a card
            if (arrowMode && !e.target.closest('.card')) {
                cancelArrowMode();
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

        // Copy card cancel
        document.getElementById('copy-card-cancel').addEventListener('click', function (e) {
            e.stopPropagation();
            cancelCopyMode();
        });

        // Arrow cancel
        document.getElementById('arrow-cancel').addEventListener('click', function (e) {
            e.stopPropagation();
            cancelArrowMode();
        });

        // Arrow modal close
        document.getElementById('arrow-modal-close').addEventListener('click', function () {
            document.getElementById('arrow-modal-overlay').style.display = 'none';
        });

        // Stack resolve button
        document.getElementById('btn-resolve-stack').addEventListener('click', function () {
            if (!currentState) return;
            var stackCards = [];
            for (var id in currentState.cards) {
                if (currentState.cards[id].zone === 'stack') stackCards.push(currentState.cards[id]);
            }
            if (stackCards.length === 0) return;
            stackCards.sort(function (a, b) { return (a.zone_moved_at || 0) - (b.zone_moved_at || 0); });
            var topCard = stackCards[stackCards.length - 1];

            // Determine resolve destination
            var typeLine = (topCard.type_line || '').toLowerCase();
            var destZone;
            if (typeLine.indexOf('instant') !== -1 || typeLine.indexOf('sorcery') !== -1) {
                destZone = 'graveyard';
            } else {
                destZone = 'battlefield';
            }

            MTGSocket.send({
                action: 'move_card',
                card_id: topCard.id,
                to_zone: destZone,
                to_player_index: topCard.controller_index
            });
        });

        // Scry/Surveil
        setupScryDropZones();
        document.getElementById('scry-confirm').addEventListener('click', function () {
            confirmScry();
        });
        document.getElementById('scry-copy').addEventListener('click', function () {
            copyScryCards();
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

        // Zone viewer destination buttons
        document.querySelectorAll('.zv-dest-buttons .btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                handleZvDestination(this.dataset.dest);
            });
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

            // Numpad +/-: zoom card preview
            if (previewEl && previewEl.style.display !== 'none' && previewZoomCard) {
                if (e.key === '+' || e.key === 'Add') {
                    e.preventDefault();
                    if (previewZoomIndex < ZOOM_LEVELS.length - 1) {
                        previewZoomIndex++;
                        saveCardZoomPref(previewZoomCard, previewZoomIndex);
                        applyPreviewZoom();
                    }
                } else if (e.key === '-' || e.key === 'Subtract') {
                    e.preventDefault();
                    if (previewZoomIndex > 0) {
                        previewZoomIndex--;
                        saveCardZoomPref(previewZoomCard, previewZoomIndex);
                        applyPreviewZoom();
                    }
                }
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

    function showCommandCenterDialog() {
        var overlay = document.getElementById('cc-dialog-overlay');
        overlay.style.display = 'flex';

        document.getElementById('cc-yes').addEventListener('click', function () {
            overlay.style.display = 'none';
            window.open('/command', 'mtg-command');
        });

        document.getElementById('cc-no').addEventListener('click', function () {
            overlay.style.display = 'none';
            var hintOverlay = document.getElementById('cc-hint-overlay');
            hintOverlay.style.display = 'flex';

            document.getElementById('cc-hint-ok').addEventListener('click', function () {
                hintOverlay.style.display = 'none';
            });
        });
    }

    function init() {
        initPreviewRefs();
        createConnectionStatus();

        // Initialize drag-drop
        DragDrop.init();

        // Hide hover preview during drag-and-drop
        document.addEventListener('dragstart', function () { _isDragging = true; hideCardPreview(); });
        document.addEventListener('dragend',   function () { _isDragging = false; });

        // Set up static UI interactions
        setupLifeCounters();
        setupPhaseTracker();
        setupLibraryInteractions();
        setupZoneViewers();
        bindEvents();

        // Offer to open Command Center (only if not already open)
        if (!localStorage.getItem('command-center-open')) {
            showCommandCenterDialog();
        }

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

        // Hover image scale slider (0–3, maps to ZOOM_LEVELS indices)
        var hoverSlider = document.getElementById('hover-scale-slider');
        if (hoverSlider) {
            var savedHoverZoom = localStorage.getItem('mtg-hover-zoom');
            if (savedHoverZoom !== null) {
                globalHoverZoom = parseInt(savedHoverZoom, 10);
                hoverSlider.value = globalHoverZoom;
            }
            hoverSlider.addEventListener('input', function () {
                globalHoverZoom = parseInt(hoverSlider.value, 10);
                localStorage.setItem('mtg-hover-zoom', globalHoverZoom);
                cardZoomPrefs = {};
                localStorage.removeItem('cardZoomPrefs');
                previewZoomIndex = globalHoverZoom;
                applyPreviewZoom();
            });
            var hoverResetBtn = document.getElementById('btn-hover-scale-reset');
            if (hoverResetBtn) {
                hoverResetBtn.addEventListener('click', function () {
                    globalHoverZoom = 0;
                    hoverSlider.value = 0;
                    localStorage.removeItem('mtg-hover-zoom');
                    cardZoomPrefs = {};
                    localStorage.removeItem('cardZoomPrefs');
                    previewZoomIndex = 0;
                    applyPreviewZoom();
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
