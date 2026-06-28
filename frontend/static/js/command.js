/* ============================================================
   command.js - Command Center logic
   Manages chat, snapshot, action log, phase/life tracking
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
    // Signal that Command Center is open
    localStorage.setItem('command-center-open', Date.now().toString());
    window.addEventListener('beforeunload', () => {
        localStorage.removeItem('command-center-open');
    });

    // ---- State ----
    let currentState = null;
    let copyToastTimeout = null;
    let recentActionsCount = parseInt(localStorage.getItem('recentActionsCount') || '1', 10);
    // Conversation UI state
    let activeConversationId = localStorage.getItem('mtg-active-conv') || null;
    let draftPartnerIndex = null;       // partner for a new/empty (unsaved) conversation
    let lastActivePlayerIndex = null;   // to detect turn changes
    let llmBusy = false;
    let llmAbortController = null;       // to cancel an in-flight LLM request
    // Progress-marker grid over bot answers (left=yellow, right=green, drag=multi)
    // Cell size = the text's line-height, so one text line == one row of cells.
    const GRID_CELL_FALLBACK = 21;      // px, used if line-height can't be read
    let gridOn = localStorage.getItem('mtg-grid-on') === '1';
    let gridDrag = null;                // active paint drag: {convId,msgIndex,overlay,cells,color,erase,dirty}

    // ---- DOM references ----
    const chatMessagesEl = document.getElementById('chat-messages');
    const chatEmptyEl = document.getElementById('chat-empty');
    const chatInputEl = document.getElementById('chat-input');
    const chatSendBtn = document.getElementById('chat-send');
    const snapshotTextEl = document.getElementById('snapshot-text');
    const notesTextEl = document.getElementById('notes-text');
    const clutterTextEl = document.getElementById('clutter-text');
    const actionLogEl = document.getElementById('action-log');
    const lifeCountersEl = document.getElementById('life-counters');
    const phaseTrackerEl = document.getElementById('phase-tracker');
    const turnInfoEl = document.getElementById('turn-info');
    const connectionDot = document.getElementById('connection-dot');
    const connectionLabel = document.getElementById('connection-label');
    const copyToastEl = document.getElementById('copy-toast');

    // ---- Connect WebSocket ----
    MTGSocket.connect();

    // ---- Connection status ----
    MTGSocket.onOpen(() => {
        connectionDot.classList.add('connected');
        connectionLabel.textContent = 'Connected';
    });

    MTGSocket.onClose(() => {
        connectionDot.classList.remove('connected');
        connectionLabel.textContent = 'Disconnected';
    });

    // ---- State updates ----
    MTGSocket.onStateUpdate((state) => {
        const firstState = (currentState === null);
        currentState = state;
        renderPhaseTracker(state);
        renderLifeCounters(state);
        renderActionLog(state.action_log || []);
        renderTurnInfo(state);

        // Conversation handling: on a real turn change, open a fresh draft with
        // the new active bot. On first load, restore the saved conversation
        // (or draft the active bot) without overriding.
        const newActive = state.active_player_index;
        if (firstState) {
            const saved = activeConversationId && findConv(activeConversationId);
            if (!saved) { activeConversationId = null; draftPartnerIndex = (newActive >= 1) ? newActive : null; }
        } else if (typeof newActive === 'number' && newActive !== lastActivePlayerIndex) {
            // turn changed → new empty draft for the new active bot (if it's a bot)
            activeConversationId = null;
            draftPartnerIndex = (newActive >= 1) ? newActive : null;
            localStorage.removeItem('mtg-active-conv');
        }
        if (typeof newActive === 'number') lastActivePlayerIndex = newActive;
        renderChatUI();
        if (state.turn > 1 || botHandBtnClicked) {
            document.getElementById('copy-bot-hand').classList.remove('btn-blink');
        }
        if (state.turn > 1 || mulliganBtnClicked) {
            document.getElementById('copy-mulligan-prompt').classList.remove('btn-blink');
        }
        // Request updated snapshot
        requestSnapshot();
    });

    // ---- Snapshot updates ----
    MTGSocket.onSnapshot((text) => {
        snapshotTextEl.value = text;
    });

    const oracleModeEl = document.getElementById('oracle-mode');
    oracleModeEl.value = localStorage.getItem('oracleMode') || 'off';

    // Hand-note: shown when hideOpponentHand is active
    const handNoteWrapper = document.getElementById('hand-note-wrapper');
    const handNoteTextEl = document.getElementById('hand-note-text');
    const defaultHandNote = 'Beim Beschreiben deines Zuges wenn du eine Handkarte ausspielst, nenne zusätzlich die Nummer der Handkarte (im Snapshot mit "Handkarte#" bezeichnet).';

    function syncHandNoteVisibility() {
        const hidden = localStorage.getItem('hideOpponentHand') !== 'false';
        handNoteWrapper.style.display = hidden ? '' : 'none';
    }
    syncHandNoteVisibility();
    // Listen for changes from the board window
    window.addEventListener('storage', (e) => {
        if (e.key === 'hideOpponentHand') {
            syncHandNoteVisibility();
            requestSnapshot();
        }
    });
    handNoteTextEl.value = localStorage.getItem('handNote') || defaultHandNote;
    handNoteTextEl.addEventListener('input', () => {
        localStorage.setItem('handNote', handNoteTextEl.value);
    });

    // Reduce Clutter — persistent LLM instructions
    clutterTextEl.value = localStorage.getItem('mtg-reduce-clutter') || '';
    clutterTextEl.addEventListener('input', () => {
        localStorage.setItem('mtg-reduce-clutter', clutterTextEl.value);
    });

    function requestSnapshot() {
        var hideHand = localStorage.getItem('hideOpponentHand') !== 'false';
        MTGSocket.send({
            action: 'get_snapshot',
            recent_actions_count: recentActionsCount,
            oracle_mode: oracleModeEl.value,
            number_hand: hideHand
        });
    }

    oracleModeEl.addEventListener('change', () => {
        localStorage.setItem('oracleMode', oracleModeEl.value);
        requestSnapshot();
    });

    // ---- Recent Actions Counter ----
    const recentCountEl = document.getElementById('recent-actions-count');
    recentCountEl.textContent = recentActionsCount;

    document.getElementById('recent-actions-plus').addEventListener('click', () => {
        recentActionsCount = Math.min(recentActionsCount + 1, 20);
        recentCountEl.textContent = recentActionsCount;
        localStorage.setItem('recentActionsCount', recentActionsCount);
        requestSnapshot();
    });

    document.getElementById('recent-actions-minus').addEventListener('click', () => {
        recentActionsCount = Math.max(recentActionsCount - 1, 0);
        recentCountEl.textContent = recentActionsCount;
        localStorage.setItem('recentActionsCount', recentActionsCount);
        requestSnapshot();
    });

    // ---- Error messages ----
    MTGSocket.onError((message) => {
        appendBubble('System', message, 'system');
    });

    // ================================================================
    // Conversations (per-bot LLM threads)
    // ================================================================

    function getConversations() { return (currentState && currentState.conversations) || []; }
    function findConv(id) { return getConversations().find((c) => c.id === id) || null; }
    function playerName(idx) {
        if (currentState && currentState.players && currentState.players[idx]) {
            return currentState.players[idx].name;
        }
        return 'Player ' + (idx + 1);
    }
    function botIndices() {
        const n = (currentState && currentState.players) ? currentState.players.length : 0;
        const out = []; for (let i = 1; i < n; i++) out.push(i); return out;
    }
    function activePlayerIndex() { return currentState ? currentState.active_player_index : 0; }
    function genitive(name) { return name + 's'; }  // Lexi → Lexis

    // Partner the send box currently targets (active conversation's partner, or draft)
    function targetPartnerIndex() {
        if (activeConversationId) { const c = findConv(activeConversationId); if (c) return c.partner_index; }
        return draftPartnerIndex;
    }

    // Low-level: render one chat bubble, return the element
    function appendBubble(sender, text, type) {
        if (chatEmptyEl) chatEmptyEl.style.display = 'none';
        const msgEl = document.createElement('div');
        msgEl.className = 'chat-msg ' + (type || 'system');
        const senderEl = document.createElement('div');
        senderEl.className = 'chat-sender';
        senderEl.textContent = sender;
        const textEl = document.createElement('div');
        textEl.className = 'chat-text';
        textEl.textContent = text;
        msgEl.appendChild(senderEl);
        msgEl.appendChild(textEl);
        chatMessagesEl.appendChild(msgEl);
        chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
        return msgEl;
    }

    // Cell size for a text box = its line-height, so a row of cells == a text line.
    function gridCellSize(textEl) {
        const lh = parseFloat(getComputedStyle(textEl).lineHeight);
        return (isFinite(lh) && lh > 0) ? lh : GRID_CELL_FALLBACK;
    }

    // Draw the colored cells of a grid map ("col,row" -> "y"|"g") into an overlay.
    function renderGridCells(overlay, cells, cell) {
        overlay.querySelectorAll('.grid-cell').forEach((c) => c.remove());
        Object.keys(cells).forEach((key) => {
            const parts = key.split(',');
            const col = parseInt(parts[0], 10), row = parseInt(parts[1], 10);
            if (isNaN(col) || isNaN(row)) return;
            const el = document.createElement('div');
            el.className = 'grid-cell ' + (cells[key] === 'g' ? 'g' : 'y');
            el.style.left = (col * cell) + 'px';
            el.style.top = (row * cell) + 'px';
            el.style.width = cell + 'px';
            el.style.height = cell + 'px';
            overlay.appendChild(el);
        });
    }

    // Attach a progress-marker grid overlay to an assistant bubble's text box.
    // Marks are always shown; painting (lines + mouse) is enabled only when gridOn.
    function attachGrid(bubbleEl, convId, msgIndex, gridMap) {
        const textEl = bubbleEl.querySelector('.chat-text');
        if (!textEl) return;
        const cell = gridCellSize(textEl);
        const overlay = document.createElement('div');
        overlay.className = 'chat-grid' + (gridOn ? ' on' : '');
        overlay.style.setProperty('--grid-cell', cell + 'px');
        const cells = Object.assign({}, gridMap);
        renderGridCells(overlay, cells, cell);
        textEl.appendChild(overlay);
        if (!gridOn) return;  // view-only: marks visible, no grid lines / painting

        const cellAt = (e) => {
            const r = overlay.getBoundingClientRect();
            const col = Math.floor((e.clientX - r.left) / cell);
            const row = Math.floor((e.clientY - r.top) / cell);
            if (col < 0 || row < 0) return null;
            return col + ',' + row;
        };
        const applyCell = (key) => {
            if (!key || !gridDrag) return;
            if (gridDrag.erase) {
                if (gridDrag.cells[key]) { delete gridDrag.cells[key]; gridDrag.dirty = true; }
            } else if (gridDrag.cells[key] !== gridDrag.color) {
                gridDrag.cells[key] = gridDrag.color; gridDrag.dirty = true;
            }
            renderGridCells(overlay, gridDrag.cells, cell);
        };

        overlay.addEventListener('contextmenu', (e) => e.preventDefault());
        overlay.addEventListener('mousedown', (e) => {
            if (e.button !== 0 && e.button !== 2) return;
            e.preventDefault();
            const key = cellAt(e);
            if (key === null) return;
            const color = (e.button === 2) ? 'g' : 'y';
            gridDrag = { convId, msgIndex, overlay, cells, color, erase: (cells[key] === color), dirty: false };
            applyCell(key);
        });
        overlay.addEventListener('mousemove', (e) => {
            if (!gridDrag || gridDrag.overlay !== overlay) return;
            applyCell(cellAt(e));
        });
    }

    function renderConversationTabs() {
        const el = document.getElementById('conversation-tabs');
        if (!el) return;
        el.innerHTML = '';
        getConversations().slice().reverse().forEach((c) => {
            const tab = document.createElement('button');
            tab.className = 'conv-tab' + (c.id === activeConversationId ? ' active' : '');
            tab.textContent = playerName(c.partner_index) + ' · T' + c.created_turn;
            tab.addEventListener('click', () => {
                activeConversationId = c.id; draftPartnerIndex = null;
                localStorage.setItem('mtg-active-conv', c.id);
                renderChatUI(); chatInputEl.focus();
            });
            el.appendChild(tab);
        });
    }

    function renderPartnerButtons() {
        const el = document.getElementById('partner-buttons');
        if (!el) return;
        const target = targetPartnerIndex();
        el.innerHTML = '';
        botIndices().forEach((idx) => {
            const b = document.createElement('button');
            b.className = 'partner-btn' + (idx === target ? ' active' : '');
            b.textContent = playerName(idx);
            b.title = 'Neue Unterhaltung mit ' + playerName(idx);
            b.addEventListener('click', () => {
                draftPartnerIndex = idx; activeConversationId = null;
                localStorage.removeItem('mtg-active-conv');
                renderChatUI(); chatInputEl.focus();
            });
            el.appendChild(b);
        });
    }

    function renderConversationMessages() {
        chatMessagesEl.innerHTML = '';
        const conv = activeConversationId ? findConv(activeConversationId) : null;
        if (!conv || conv.messages.length === 0) {
            chatEmptyEl.style.display = '';
            chatMessagesEl.appendChild(chatEmptyEl);
            const t = targetPartnerIndex();
            chatEmptyEl.textContent = (t != null && t >= 1)
                ? ('Neue Unterhaltung mit ' + playerName(t) + ' — schreib unten oder klick „' + genitive(playerName(t)) + ' Zug".')
                : 'Wähle einen Partner.';
            return;
        }
        chatEmptyEl.style.display = 'none';
        const partnerName = playerName(conv.partner_index);
        const convId = conv.id;
        conv.messages.forEach((m, i) => {
            // Detect the board-bearing message by content (robust to deletions),
            // not by position — the first message isn't necessarily the board.
            const isBoard = m.role === 'user' && m.content.indexOf('-- BOARD STATE ===') !== -1;
            const isMull = m.role === 'user' && !isBoard && m.content.indexOf('Mulligan oder Behalten') !== -1;
            let bubble;
            if (isBoard) {
                bubble = appendBubble('Du', '📋 [Boardstate gesendet]', 'user board-chip');
            } else if (isMull) {
                bubble = appendBubble('Du', '🎴 [Mulligan-Frage gesendet]', 'user board-chip');
            } else if (m.role === 'user') {
                bubble = appendBubble('Du', m.content, 'user');
            } else {
                bubble = appendBubble(partnerName, m.content, 'assistant');
            }
            addDeleteButton(bubble, convId, i);
            if (m.role === 'assistant') {
                const hasCells = m.grid && Object.keys(m.grid).length > 0;
                if (gridOn || hasCells) attachGrid(bubble, convId, i, m.grid || {});
            }
        });
    }

    // Add a hover "×" to a chat bubble that deletes that message from the conversation.
    function addDeleteButton(bubbleEl, convId, msgIndex) {
        const del = document.createElement('button');
        del.className = 'msg-delete';
        del.textContent = '×';
        del.title = 'Diese Nachricht löschen';
        del.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteMessage(convId, msgIndex);
        });
        bubbleEl.appendChild(del);
    }

    function deleteMessage(convId, msgIndex) {
        fetch('/api/llm/conversation/delete_message', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ conversation_id: convId, message_index: msgIndex })
        })
        .then((res) => res.json().catch(() => ({ success: false })))
        .then((data) => {
            if (data && data.success && data.conversation_removed && activeConversationId === convId) {
                activeConversationId = null;
                localStorage.removeItem('mtg-active-conv');
            }
            renderChatUI();  // broadcast also refreshes, but re-render immediately
        })
        .catch(() => { renderChatUI(); });
    }

    function renderChatUI() {
        renderConversationTabs();
        renderPartnerButtons();
        renderConversationMessages();
    }

    function setInputsBusy(busy) {
        chatSendBtn.disabled = busy;
        chatInputEl.disabled = busy;
        if (llmAskBtn) llmAskBtn.disabled = busy || activePlayerIndex() < 1;
        const cancelBtn = document.getElementById('llm-cancel-btn');
        if (cancelBtn) cancelBtn.style.display = busy ? '' : 'none';
    }

    // Cancel an in-flight LLM request (aborts the fetch; backend rolls back).
    document.getElementById('llm-cancel-btn').addEventListener('click', () => {
        if (llmAbortController) llmAbortController.abort();
    });

    // Core: send a message into the active/draft conversation (or a forced-new one)
    function sendToConversation(userText, forceNewPartner) {
        if (llmBusy) return;
        userText = (userText || '').trim();

        let convId = activeConversationId;
        let partnerIdx;
        if (forceNewPartner != null) { convId = null; partnerIdx = forceNewPartner; }
        else { partnerIdx = targetPartnerIndex(); }

        if (convId == null && (partnerIdx == null || partnerIdx < 1)) {
            appendBubble('System', 'Kein Bot als Gesprächspartner gewählt.', 'system');
            return;
        }
        const existing = convId ? findConv(convId) : null;
        const isFirst = !existing || existing.messages.length === 0;
        if (!isFirst && !userText) return;  // follow-up needs text

        llmBusy = true; setInputsBusy(true);
        const model = llmModelEl.value;
        const partnerName = playerName(partnerIdx != null ? partnerIdx : (existing ? existing.partner_index : 0));
        if (userText) appendBubble('Du', userText, 'user');
        else if (isFirst) appendBubble('Du', '📋 [Boardstate gesendet]', 'user board-chip');
        appendBubble(partnerName, '… denkt nach (' + model + ')', 'system');
        chatInputEl.value = '';

        const hideHand = localStorage.getItem('hideOpponentHand') !== 'false';
        llmAbortController = new AbortController();
        fetch('/api/llm/conversation', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            signal: llmAbortController.signal,
            body: JSON.stringify({
                conversation_id: convId,
                partner_index: partnerIdx,
                user_text: userText,
                model: model,
                reasoning: llmReasoningEl.value,
                oracle_mode: oracleModeEl.value,
                recent_actions_count: recentActionsCount,
                number_hand: hideHand,
                notes: notesTextEl.value,
                clutter: clutterTextEl.value,
                hand_note: handNoteTextEl.value
            })
        })
        .then((res) => res.json().catch(() => ({ success: false, error: 'Bad response' })))
        .then((data) => {
            if (data && data.success) {
                activeConversationId = data.conversation_id;
                draftPartnerIndex = null;
                localStorage.setItem('mtg-active-conv', data.conversation_id);
            }
            renderChatUI();  // re-sync from the broadcast state
            if (!data || !data.success) {
                if (userText) chatInputEl.value = userText;  // restore for an easy retry
                appendBubble('System', 'LLM-Fehler: ' + ((data && data.error) || 'Unbekannt'), 'system');
            }
        })
        .catch((err) => {
            if (userText) chatInputEl.value = userText;  // restore so you can resend
            renderChatUI();
            if (err && err.name === 'AbortError') {
                appendBubble('System', 'Abgebrochen. Du kannst neu senden.', 'system');
            } else {
                appendBubble('System', 'LLM-Anfrage fehlgeschlagen: ' + err, 'system');
            }
        })
        .finally(() => { llmBusy = false; llmAbortController = null; setInputsBusy(false); refreshLlmLimit(); });
    }

    // Send box = follow-up / first message into the current conversation
    function sendChatMessage() {
        const msg = chatInputEl.value.trim();
        if (!msg) return;
        sendToConversation(msg, null);
    }

    chatSendBtn.addEventListener('click', sendChatMessage);
    chatInputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendChatMessage(); }
    });

    // ---- Progress-marker grid: toggle, clear-all, drag-commit ----
    const gridToggleBtn = document.getElementById('grid-toggle');
    if (gridToggleBtn) {
        gridToggleBtn.classList.toggle('active', gridOn);
        gridToggleBtn.addEventListener('click', () => {
            gridOn = !gridOn;
            localStorage.setItem('mtg-grid-on', gridOn ? '1' : '0');
            gridToggleBtn.classList.toggle('active', gridOn);
            renderChatUI();
        });
    }
    const gridClearBtn = document.getElementById('grid-clear');
    if (gridClearBtn) {
        gridClearBtn.addEventListener('click', () => {
            if (!activeConversationId) return;
            if (!confirm('Alle Gitter-Markierungen in dieser Unterhaltung entfernen?')) return;
            fetch('/api/llm/conversation/clear_grid', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ conversation_id: activeConversationId })
            }).then(() => renderChatUI()).catch(() => {});
        });
    }
    // Commit a paint drag on mouse release (anywhere) — persist the message's grid.
    document.addEventListener('mouseup', () => {
        if (!gridDrag) return;
        const d = gridDrag; gridDrag = null;
        if (!d.dirty) return;
        fetch('/api/llm/conversation/set_grid', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ conversation_id: d.convId, message_index: d.msgIndex, grid: d.cells })
        }).catch(() => {});
    });

    // ================================================================
    // Phase Tracker
    // ================================================================

    function renderPhaseTracker(state) {
        if (!state) return;

        const currentPhase = state.phase || '';
        let html = '';

        MTGUtils.phaseOrder.forEach((phase) => {
            const name = MTGUtils.phaseNames[phase] || phase;
            const isActive = phase === currentPhase;
            html += '<span class="phase-pip' + (isActive ? ' active' : '') + '" data-phase="' + phase + '">'
                + name + '</span>';
        });

        phaseTrackerEl.innerHTML = html;

        // Click handlers for phase pips
        phaseTrackerEl.querySelectorAll('.phase-pip').forEach((pip) => {
            pip.addEventListener('click', () => {
                const phase = pip.getAttribute('data-phase');
                MTGSocket.send({ action: 'set_phase', phase: phase });
            });
        });
    }

    // ================================================================
    // Turn Info
    // ================================================================

    function renderTurnInfo(state) {
        if (!state) {
            turnInfoEl.textContent = '';
            return;
        }

        const turnNum = state.turn || 0;
        const activeIdx = state.active_player_index;
        let activeName = 'Unknown';
        if (state.players && state.players[activeIdx]) {
            activeName = state.players[activeIdx].name || ('Player ' + (activeIdx + 1));
        }

        turnInfoEl.textContent = 'Turn ' + turnNum + ' \u2014 ' + activeName + '\'s turn';

        // Green button: "<Bot>s Zug" — disabled on the human's (player 0) turn.
        const askBtn = document.getElementById('llm-ask-btn');
        if (askBtn && !llmBusy) {
            if (activeIdx >= 1) {
                askBtn.disabled = false;
                askBtn.textContent = activeName + 's Zug';
            } else {
                askBtn.disabled = true;
                askBtn.textContent = 'Du bist dran';
            }
        }
    }

    // ================================================================
    // Life Counters
    // ================================================================

    function renderLifeCounters(state) {
        if (!state || !state.players) {
            lifeCountersEl.innerHTML = '';
            return;
        }

        let html = '';
        state.players.forEach((player, idx) => {
            if (idx > 0) {
                html += '<span class="life-separator">|</span>';
            }
            html += '<div class="life-counter' + (player.eliminated ? ' eliminated' : '') + '">';
            html += '<label class="elim-toggle" title="Hat das Spiel verloren — aus Snapshot &amp; Zugreihenfolge entfernen (Board bleibt)">';
            html += '<input type="checkbox" class="elim-cb" data-player="' + idx + '"' + (player.eliminated ? ' checked' : '') + '>✝</label>';
            html += '<span class="life-player-name">' + MTGUtils.escapeHtml(player.name || 'Player ' + (idx + 1)) + '</span>';
            html += '<button class="life-btn" data-player="' + idx + '" data-delta="-1">-</button>';
            html += '<span class="life-value" id="life-value-' + idx + '">' + (player.life || 0) + '</span>';
            html += '<button class="life-btn" data-player="' + idx + '" data-delta="1">+</button>';
            html += '</div>';
        });

        lifeCountersEl.innerHTML = html;

        // Click handlers for life buttons
        lifeCountersEl.querySelectorAll('.life-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const playerIndex = parseInt(btn.getAttribute('data-player'), 10);
                const delta = parseInt(btn.getAttribute('data-delta'), 10);
                MTGSocket.send({
                    action: 'change_life',
                    player_index: playerIndex,
                    delta: delta
                });
            });
        });

        // Eliminate / revive toggle (reversible — board stays in the tracker)
        lifeCountersEl.querySelectorAll('.elim-cb').forEach((cb) => {
            cb.addEventListener('change', () => {
                MTGSocket.send({
                    action: 'set_eliminated',
                    player_index: parseInt(cb.getAttribute('data-player'), 10),
                    eliminated: cb.checked
                });
            });
        });
    }

    // ================================================================
    // Action Log
    // ================================================================

    function renderActionLog(logEntries) {
        if (!logEntries || logEntries.length === 0) {
            actionLogEl.innerHTML = '<div class="log-empty">No actions recorded yet.</div>';
            return;
        }

        let html = '';
        logEntries.forEach((entry) => {
            const time = entry.timestamp ? MTGUtils.formatTime(entry.timestamp) : '';
            const desc = formatLogEntry(entry);
            const cls = entry.type === 'play_land' ? 'log-entry log-entry-land' : 'log-entry';
            html += '<div class="' + cls + '">';
            html += '<span class="log-time">' + time + '</span>';
            html += '<span class="log-action">' + desc + '</span>';
            html += '</div>';
        });

        actionLogEl.innerHTML = html;

        // Auto-scroll to bottom
        actionLogEl.scrollTop = actionLogEl.scrollHeight;
    }

    function formatLogEntry(entry) {
        if (!entry) return '';
        // Backend provides pre-formatted description strings like "[T1 Main 1] Andre: ..."
        return MTGUtils.escapeHtml(entry.description || entry.type || 'Unknown action');
    }

    // ================================================================
    // Copy Boardstate
    // ================================================================

    // Assemble the full prompt: current snapshot + persistent instructions +
    // hand-note (when hands are hidden) + additional notes. Shared by the
    // "Copy Boardstate" button and the LLM "Zug" button.
    function buildPromptText() {
        let text = snapshotTextEl.value || '';

        const clutter = clutterTextEl.value.trim();
        if (clutter) {
            text += '\n\n=== INSTRUCTIONS ===\n' + clutter;
        }

        const hideHand = localStorage.getItem('hideOpponentHand') !== 'false';
        if (hideHand) {
            const handNote = handNoteTextEl.value.trim();
            if (handNote) {
                text += '\n\n=== HAND NOTE ===\n' + handNote;
            }
        }

        const notes = notesTextEl.value.trim();
        if (notes) {
            text += '\n\n=== ADDITIONAL NOTES ===\n' + notes;
        }

        return text;
    }

    function copySnapshot() {
        const text = buildPromptText();
        navigator.clipboard.writeText(text).then(() => {
            showCopyToast();
        }).catch((err) => {
            console.error('Failed to copy:', err);
            snapshotTextEl.select();
            document.execCommand('copy');
            showCopyToast();
        });
    }

    document.getElementById('copy-snapshot').addEventListener('click', copySnapshot);

    function showCopyToast() {
        copyToastEl.classList.add('visible');
        if (copyToastTimeout) clearTimeout(copyToastTimeout);
        copyToastTimeout = setTimeout(() => {
            copyToastEl.classList.remove('visible');
        }, 1500);
    }

    // ================================================================
    // Copy Bot's Hand
    // ================================================================

    let pendingBotHandCopy = false;

    MTGSocket.on('bot_hand', (data) => {
        if (!pendingBotHandCopy) return;
        pendingBotHandCopy = false;
        const text = data.text || '';
        navigator.clipboard.writeText(text).then(() => {
            showCopyToast();
        }).catch(() => {
            // Fallback
            snapshotTextEl.value = text;
            snapshotTextEl.select();
            document.execCommand('copy');
            showCopyToast();
        });
    });

    // Which opponent is currently shown on the board's top slot (shared via
    // localStorage by board.js). null → backend falls back to the active player.
    function viewedOpponentIndex() {
        const v = parseInt(localStorage.getItem('mtg-top-opponent'), 10);
        return isNaN(v) ? null : v;
    }

    const copyBotHandBtn = document.getElementById('copy-bot-hand');
    let botHandBtnClicked = false;
    copyBotHandBtn.addEventListener('click', () => {
        pendingBotHandCopy = true;
        botHandBtnClicked = true;
        copyBotHandBtn.classList.remove('btn-blink');
        MTGSocket.send({
            action: 'get_bot_hand',
            oracle_mode: oracleModeEl.value,
            number_hand: localStorage.getItem('hideOpponentHand') !== 'false',
            player_index: viewedOpponentIndex()
        });
    });

    // ================================================================
    // Mulligan — ask the top-board bot in its own (per-bot) conversation
    // ================================================================

    const copyMulliganBtn = document.getElementById('copy-mulligan-prompt');
    let mulliganBtnClicked = false;
    const mulliganConvByBot = {};  // botIndex -> conversation id (this session)

    copyMulliganBtn.addEventListener('click', () => {
        if (llmBusy) return;
        const bot = viewedOpponentIndex();
        if (bot == null || bot < 1) {
            appendBubble('System', 'Kein Bot oben im Board State Tracker ausgewählt.', 'system');
            return;
        }
        mulliganBtnClicked = true;
        copyMulliganBtn.classList.remove('btn-blink');

        // Continue this bot's mulligan thread if it still exists, else start one.
        let convId = mulliganConvByBot[bot];
        if (convId && !findConv(convId)) convId = null;

        llmBusy = true; setInputsBusy(true);
        const model = llmModelEl.value;
        appendBubble('Du', '🎴 [Mulligan-Frage gesendet]', 'user board-chip');
        appendBubble(playerName(bot), '… denkt nach (' + model + ')', 'system');

        llmAbortController = new AbortController();
        fetch('/api/llm/conversation', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            signal: llmAbortController.signal,
            body: JSON.stringify({
                conversation_id: convId,
                partner_index: bot,
                kind: 'mulligan',
                user_text: '',
                model: model,
                reasoning: llmReasoningEl.value,
                oracle_mode: oracleModeEl.value
            })
        })
        .then((res) => res.json().catch(() => ({ success: false, error: 'Bad response' })))
        .then((data) => {
            if (data && data.success) {
                mulliganConvByBot[bot] = data.conversation_id;
                activeConversationId = data.conversation_id;
                draftPartnerIndex = null;
                localStorage.setItem('mtg-active-conv', data.conversation_id);
            }
            renderChatUI();
            if (!data || !data.success) {
                appendBubble('System', 'Mulligan-Fehler: ' + ((data && data.error) || 'Unbekannt'), 'system');
            }
        })
        .catch((err) => {
            renderChatUI();
            if (err && err.name === 'AbortError') {
                appendBubble('System', 'Abgebrochen. Du kannst neu senden.', 'system');
            } else {
                appendBubble('System', 'Mulligan-Anfrage fehlgeschlagen: ' + err, 'system');
            }
        })
        .finally(() => { llmBusy = false; llmAbortController = null; setInputsBusy(false); refreshLlmLimit(); });
    });

    // ================================================================
    // LLM: send boardstate to OpenRouter and show the reply in chat
    // ================================================================

    const llmModelEl = document.getElementById('llm-model');
    const llmReasoningEl = document.getElementById('llm-reasoning');
    const llmAskBtn = document.getElementById('llm-ask-btn');
    var DEFAULT_LLM_MODEL = 'google/gemini-3.5-flash';
    llmModelEl.value = localStorage.getItem('mtg-llm-model') || DEFAULT_LLM_MODEL;
    if (!llmModelEl.value) llmModelEl.value = DEFAULT_LLM_MODEL;  // guard if stored id no longer in list

    // Reasoning effort is remembered PER MODEL.
    function loadReasoningForModel() {
        llmReasoningEl.value = localStorage.getItem('mtg-reasoning-' + llmModelEl.value) || 'auto';
    }
    loadReasoningForModel();

    llmModelEl.addEventListener('change', () => {
        localStorage.setItem('mtg-llm-model', llmModelEl.value);
        loadReasoningForModel();  // each model keeps its own setting
    });
    llmReasoningEl.addEventListener('change', () => {
        localStorage.setItem('mtg-reasoning-' + llmModelEl.value, llmReasoningEl.value);
    });

    // ---- OpenRouter limit tracker (progress bar, auto-refreshed after each turn) ----
    const llmLimitFill = document.getElementById('llm-limit-fill');
    const llmLimitText = document.getElementById('llm-limit-text');

    function refreshLlmLimit() {
        fetch('/api/llm/limit')
            .then((res) => res.json().catch(() => ({ success: false })))
            .then((d) => {
                if (!d || !d.success) {
                    llmLimitText.textContent = 'Limit: n/v';
                    return;
                }
                const resetLabel = d.limit_reset === 'daily' ? 'heute' : (d.limit_reset || '');
                const limit = (typeof d.limit === 'number') ? d.limit : null;
                const remaining = (typeof d.limit_remaining === 'number') ? d.limit_remaining : null;

                if (limit === null) {
                    // No cap — show daily usage only, full green bar
                    llmLimitFill.style.width = '100%';
                    llmLimitFill.className = 'llm-limit-fill';
                    const used = (typeof d.usage_daily === 'number') ? d.usage_daily : 0;
                    llmLimitText.textContent = 'Verbraucht ' + resetLabel + ': $' + used.toFixed(2) + ' (kein Limit)';
                    return;
                }

                const frac = limit > 0 ? Math.max(0, Math.min(1, (remaining || 0) / limit)) : 0;
                llmLimitFill.style.width = (frac * 100).toFixed(1) + '%';
                llmLimitFill.className = 'llm-limit-fill' + (frac <= 0.15 ? ' crit' : (frac <= 0.4 ? ' warn' : ''));
                llmLimitText.textContent = 'Limit ' + resetLabel + ': $' + (remaining || 0).toFixed(2) + ' / $' + limit.toFixed(2);
            })
            .catch(() => { llmLimitText.textContent = 'Limit: n/v'; });
    }

    refreshLlmLimit();  // on load

    // Green button: start a NEW conversation with the active bot and send the board.
    llmAskBtn.addEventListener('click', () => {
        const active = activePlayerIndex();
        if (active < 1) return;  // human's turn — no bot to ask
        sendToConversation('', active);
    });

    // ================================================================
    // Export HTML (interactive standalone viewer)
    // ================================================================

    document.getElementById('export-html-btn').addEventListener('click', () => {
        if (!currentState) {
            appendBubble('System', 'No game state to export.', 'system');
            return;
        }

        const html = window.generateStandaloneHTML(currentState);
        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = 'mtg-board-' + Date.now() + '.html';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        appendBubble('System', 'Board exported as interactive HTML.', 'system');
    });

    // ================================================================
    // Undo
    // ================================================================

    document.getElementById('undo-btn').addEventListener('click', () => {
        MTGSocket.send({ action: 'undo' });
    });

    // ================================================================
    // New Game
    // ================================================================

    document.getElementById('new-game-btn').addEventListener('click', () => {
        if (confirm('Start a new game? Current game state will be lost if not exported.')) {
            window.location.href = '/setup';
        }
    });

    // ================================================================
    // Quit App (clean server shutdown)
    // ================================================================

    document.getElementById('quit-app-btn').addEventListener('click', () => {
        if (!confirm('App komplett beenden? Der Server wird heruntergefahren. Stelle sicher, dass dein Spiel gespeichert/exportiert ist.')) {
            return;
        }
        const overlay = document.getElementById('shutdown-overlay');
        const overlayText = document.getElementById('shutdown-overlay-text');
        overlay.style.display = 'flex';
        fetch('/api/app/shutdown', { method: 'POST' })
            .then((res) => res.json().catch(() => ({})))
            .then((data) => {
                if (data && data.success === false) {
                    overlayText.textContent = 'Beenden fehlgeschlagen: ' + (data.error || 'Unbekannt');
                } else {
                    overlayText.textContent = 'Server beendet — du kannst dieses Fenster jetzt schließen.';
                }
            })
            .catch(() => {
                // Connection dropped because the server is shutting down — expected.
                overlayText.textContent = 'Server beendet — du kannst dieses Fenster jetzt schließen.';
            });
    });

    // ================================================================
    // Collapsible Sections
    // ================================================================

    // Collapsible sections: restore saved state and persist on toggle
    document.querySelectorAll('.collapsible-section').forEach((section) => {
        const key = 'cc-collapsed-' + section.id;
        if (localStorage.getItem(key) === 'true') {
            section.classList.add('collapsed');
        } else if (localStorage.getItem(key) === 'false') {
            section.classList.remove('collapsed');
        }
    });
    document.querySelectorAll('.section-toggle').forEach((toggle) => {
        toggle.addEventListener('click', () => {
            const section = toggle.closest('.collapsible-section');
            section.classList.toggle('collapsed');
            localStorage.setItem('cc-collapsed-' + section.id, section.classList.contains('collapsed'));
        });
    });
});
