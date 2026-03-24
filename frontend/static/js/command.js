/* ============================================================
   command.js - Command Center logic
   Manages chat, snapshot, action log, phase/life tracking
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
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
        // Request updated snapshot
        requestSnapshot();
    });

    // ---- Snapshot updates ----
    MTGSocket.onSnapshot((text) => {
        snapshotTextEl.value = text;
    });

    function requestSnapshot() {
        MTGSocket.send({ action: 'get_snapshot', recent_actions_count: recentActionsCount });
    }

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
            html += '<div class="log-entry">';
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

    document.getElementById('copy-snapshot').addEventListener('click', () => {
        let text = snapshotTextEl.value || '';

        // Append additional notes if any
        const notes = notesTextEl.value.trim();
        if (notes) {
            text += '\n\n=== ADDITIONAL NOTES ===\n' + notes;
        }

        navigator.clipboard.writeText(text).then(() => {
            showCopyToast();
        }).catch((err) => {
            console.error('Failed to copy:', err);
            // Fallback: select the text
            snapshotTextEl.select();
            document.execCommand('copy');
            showCopyToast();
        });
    });

    function showCopyToast() {
        copyToastEl.classList.add('visible');
        if (copyToastTimeout) clearTimeout(copyToastTimeout);
        copyToastTimeout = setTimeout(() => {
            copyToastEl.classList.remove('visible');
        }, 1500);
    }

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
        a.click();

        URL.revokeObjectURL(url);
        addChatMessage('System', 'Game data exported.', 'system');
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

    document.querySelectorAll('.section-toggle').forEach((toggle) => {
        toggle.addEventListener('click', () => {
            const section = toggle.closest('.collapsible-section');
            section.classList.toggle('collapsed');
        });
    });
});
