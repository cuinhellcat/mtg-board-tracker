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
    let chatMessages = [];
    let copyToastTimeout = null;
    let recentActionsCount = parseInt(localStorage.getItem('recentActionsCount') || '1', 10);

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
        currentState = state;
        renderPhaseTracker(state);
        renderLifeCounters(state);
        renderActionLog(state.action_log || []);
        renderTurnInfo(state);
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

    // ---- Chat messages from server ----
    MTGSocket.onChatMessage((data) => {
        const sender = data.sender || 'AI';
        const text = data.message || data.text || '';
        addChatMessage(sender, text, 'assistant');
    });

    // ---- Error messages ----
    MTGSocket.onError((message) => {
        addChatMessage('System', message, 'system');
    });

    // ================================================================
    // Chat
    // ================================================================

    chatSendBtn.addEventListener('click', sendChatMessage);

    chatInputEl.addEventListener('keydown', (e) => {
        // Ctrl+Enter or Cmd+Enter to send
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            sendChatMessage();
        }
    });

    function sendChatMessage() {
        const msg = chatInputEl.value.trim();
        if (!msg) return;

        MTGSocket.send({ action: 'send_chat', message: msg });
        addChatMessage('You', msg, 'user');
        chatInputEl.value = '';
        chatInputEl.focus();
    }

    function addChatMessage(sender, text, type) {
        const timestamp = new Date().toISOString();
        const entry = { sender, text, type, timestamp };
        chatMessages.push(entry);

        // Hide empty message
        if (chatEmptyEl) {
            chatEmptyEl.style.display = 'none';
        }

        // Create message element
        const msgEl = document.createElement('div');
        msgEl.className = 'chat-msg ' + (type || 'system');

        const senderEl = document.createElement('div');
        senderEl.className = 'chat-sender';
        senderEl.textContent = sender;

        const textEl = document.createElement('div');
        textEl.className = 'chat-text';
        textEl.textContent = text;

        const timeEl = document.createElement('div');
        timeEl.className = 'chat-time';
        timeEl.textContent = MTGUtils.formatTime(timestamp);

        msgEl.appendChild(senderEl);
        msgEl.appendChild(textEl);
        msgEl.appendChild(timeEl);

        chatMessagesEl.appendChild(msgEl);

        // Auto-scroll to bottom
        chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    }

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
            html += '<div class="life-counter">';
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

    function copySnapshot() {
        let text = snapshotTextEl.value || '';

        // Append reduce-clutter instructions (persistent)
        const clutter = clutterTextEl.value.trim();
        if (clutter) {
            text += '\n\n=== INSTRUCTIONS ===\n' + clutter;
        }

        // Append hand-note when opponent hand is hidden
        const hideHand = localStorage.getItem('hideOpponentHand') !== 'false';
        if (hideHand) {
            const handNote = handNoteTextEl.value.trim();
            if (handNote) {
                text += '\n\n=== HAND NOTE ===\n' + handNote;
            }
        }

        // Append additional notes if any
        const notes = notesTextEl.value.trim();
        if (notes) {
            text += '\n\n=== ADDITIONAL NOTES ===\n' + notes;
        }

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
    document.getElementById('copy-snapshot-top').addEventListener('click', copySnapshot);

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

    const copyBotHandBtn = document.getElementById('copy-bot-hand');
    let botHandBtnClicked = false;
    copyBotHandBtn.addEventListener('click', () => {
        pendingBotHandCopy = true;
        botHandBtnClicked = true;
        copyBotHandBtn.classList.remove('btn-blink');
        MTGSocket.send({
            action: 'get_bot_hand',
            oracle_mode: oracleModeEl.value,
            number_hand: localStorage.getItem('hideOpponentHand') !== 'false'
        });
    });

    // ================================================================
    // Mulligan Prompt
    // ================================================================

    let pendingMulliganPrompt = false;

    MTGSocket.on('mulligan_prompt', (data) => {
        if (!pendingMulliganPrompt) return;
        pendingMulliganPrompt = false;
        const text = data.text || '';
        navigator.clipboard.writeText(text).then(() => {
            showCopyToast();
        }).catch(() => {
            snapshotTextEl.value = text;
            snapshotTextEl.select();
            document.execCommand('copy');
            showCopyToast();
        });
    });

    const copyMulliganBtn = document.getElementById('copy-mulligan-prompt');
    let mulliganBtnClicked = false;
    copyMulliganBtn.addEventListener('click', () => {
        pendingMulliganPrompt = true;
        mulliganBtnClicked = true;
        copyMulliganBtn.classList.remove('btn-blink');
        MTGSocket.send({
            action: 'get_mulligan_prompt',
            oracle_mode: oracleModeEl.value
        });
    });

    // ================================================================
    // Export
    // ================================================================

    document.getElementById('export-btn').addEventListener('click', () => {
        if (!currentState) {
            addChatMessage('System', 'No game state to export.', 'system');
            return;
        }

        const exportData = {
            state: currentState,
            chatMessages: chatMessages,
            notes: notesTextEl.value,
            exportedAt: new Date().toISOString()
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = 'mtg-game-export-' + Date.now() + '.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        addChatMessage('System', 'Game data exported.', 'system');
    });

    // ================================================================
    // Export HTML (interactive standalone viewer)
    // ================================================================

    document.getElementById('export-html-btn').addEventListener('click', () => {
        if (!currentState) {
            addChatMessage('System', 'No game state to export.', 'system');
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
        addChatMessage('System', 'Board exported as interactive HTML.', 'system');
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
