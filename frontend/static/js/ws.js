/* ============================================================
   ws.js - Shared WebSocket module for MTG Board State Tracker
   Used by: board.js, command.js
   Provides: window.MTGSocket
   ============================================================ */

window.MTGSocket = (function () {
    let ws = null;
    let handlers = {
        state_update: [],
        scry_reveal: [],
        search_reveal: [],
        snapshot: [],
        error: [],
        chat_message: [],
        open: [],
        close: []
    };
    let reconnectInterval = null;
    let serverShutdown = false;

    function connect() {
        // Prevent duplicate connections
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
            return;
        }

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            console.log('WebSocket connected');
            if (reconnectInterval) {
                clearInterval(reconnectInterval);
                reconnectInterval = null;
            }
            handlers.open.forEach(cb => cb());
            // Request current state on connect
            send({ action: 'get_state' });
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                const type = data.type;
                // Server shutting down — stop reconnecting
                if (type === 'server_shutdown') {
                    serverShutdown = true;
                    if (reconnectInterval) {
                        clearInterval(reconnectInterval);
                        reconnectInterval = null;
                    }
                    return;
                }
                if (handlers[type]) {
                    handlers[type].forEach(cb => cb(data));
                }
            } catch (e) {
                console.error('Failed to parse WebSocket message:', e);
            }
        };

        ws.onclose = () => {
            console.log('WebSocket disconnected');
            handlers.close.forEach(cb => cb());
            // No auto-reconnect — UI shows a clickable "Reconnect" indicator
            // so the user consciously notices disconnects (see board.js connection-status).
        };

        ws.onerror = (err) => {
            console.error('WebSocket error:', err);
        };
    }

    function send(actionObj) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(actionObj));
        } else {
            console.warn('WebSocket not connected, cannot send:', actionObj.action);
        }
    }

    function on(type, callback) {
        if (!handlers[type]) {
            handlers[type] = [];
        }
        handlers[type].push(callback);
    }

    function off(type, callback) {
        if (!handlers[type]) return;
        handlers[type] = handlers[type].filter(cb => cb !== callback);
    }

    return {
        connect,
        send,
        on,
        off,

        // Convenience subscription methods
        onStateUpdate(cb) {
            on('state_update', (data) => cb(data.state));
        },
        onScryReveal(cb) {
            on('scry_reveal', cb);
        },
        onSearchReveal(cb) {
            on('search_reveal', cb);
        },
        onSnapshot(cb) {
            on('snapshot', (data) => cb(data.text));
        },
        onError(cb) {
            on('error', (data) => cb(data.message || data.error || 'Unknown error'));
        },
        onChatMessage(cb) {
            on('chat_message', cb);
        },
        onOpen(cb) {
            on('open', cb);
        },
        onClose(cb) {
            on('close', cb);
        },

        isConnected() {
            return ws && ws.readyState === WebSocket.OPEN;
        }
    };
})();
