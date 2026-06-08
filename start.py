#!/usr/bin/env python3
"""
MTG Board State Tracker - Cross-platform launcher.

Starts the FastAPI/uvicorn server and opens the browser. If a system-tray
backend is available (always on Windows; on Linux/macOS only when ``pystray``
and its GUI backend are installed), a tray icon is shown with quick links and
a Quit entry. Otherwise the server runs in the foreground and is stopped with
Ctrl+C — no tray required.
"""

import os
import sys
import threading
import time
import webbrowser

import uvicorn

from backend.main import app

BASE_URL = "http://localhost:8000"
HOST = "0.0.0.0"
PORT = 8000
ICON_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mtg_tray_icon.png")


# ------------------------------------------------------------------
# Server
# ------------------------------------------------------------------

_server_instance: "uvicorn.Server | None" = None
_tray_icon = None  # set in main() when a tray is available


def run_server():
    """Run uvicorn in the current thread (blocking)."""
    global _server_instance
    config = uvicorn.Config(
        app,
        host=HOST,
        port=PORT,
        log_level="info",
    )
    _server_instance = uvicorn.Server(config)
    _server_instance.run()


def stop_server():
    """Signal the uvicorn server to shut down gracefully."""
    if _server_instance is not None:
        _server_instance.should_exit = True


def request_shutdown():
    """Fully quit the app: stop the server and the tray icon (if running).

    Registered on ``app.state`` so the web ``POST /api/app/shutdown`` endpoint
    can trigger a clean shutdown regardless of how the app was launched.
    """
    stop_server()
    if _tray_icon is not None:
        try:
            _tray_icon.stop()
        except Exception:
            pass


def open_browser_delayed(delay: float = 2.0):
    """Open the landing page after a short delay (server needs a moment)."""
    def _open():
        time.sleep(delay)
        webbrowser.open(f"{BASE_URL}/")

    threading.Thread(target=_open, daemon=True).start()


# ------------------------------------------------------------------
# Optional system tray
# ------------------------------------------------------------------

def _build_tray():
    """Return a configured pystray.Icon, or None if a tray isn't available.

    Importing pystray on Linux pulls in a GUI backend (AppIndicator/GTK or
    Xlib). If none is installed the import or Icon construction raises — in
    that case we fall back to the terminal launcher.
    """
    try:
        import pystray
        from PIL import Image
    except Exception:
        return None

    try:
        if os.path.exists(ICON_PATH):
            icon_image = Image.open(ICON_PATH)
        else:
            icon_image = Image.new("RGB", (64, 64), (30, 30, 40))

        def open_url(path):
            return lambda icon, item: webbrowser.open(f"{BASE_URL}{path}")

        def quit_app(icon, item):
            stop_server()
            icon.stop()

        menu = pystray.Menu(
            pystray.MenuItem("Landing Page", open_url("/")),
            pystray.MenuItem("New Game", open_url("/setup")),
            pystray.MenuItem("Open Board", open_url("/board")),
            pystray.MenuItem("Open Command Center", open_url("/command")),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Quit", quit_app),
        )

        return pystray.Icon(
            name="mtg-tracker",
            icon=icon_image,
            title="MTG Board State Tracker",
            menu=menu,
        )
    except Exception:
        return None


# ------------------------------------------------------------------
# Main
# ------------------------------------------------------------------

def main():
    global _tray_icon

    # Let the web shutdown endpoint trigger a clean quit (server + tray).
    app.state.request_shutdown = request_shutdown

    icon = _build_tray()
    _tray_icon = icon

    if icon is not None:
        # Tray mode: server runs in the background, icon.run() owns the main thread.
        threading.Thread(target=run_server, daemon=True).start()
        open_browser_delayed()
        icon.run()  # blocks until Quit
    else:
        # Terminal mode: open the browser, then run the server in the foreground.
        print(f"MTG Board State Tracker — open {BASE_URL}/  (Ctrl+C to quit)")
        open_browser_delayed()
        try:
            run_server()  # blocks; Ctrl+C triggers uvicorn's graceful shutdown
        except KeyboardInterrupt:
            stop_server()


if __name__ == "__main__":
    main()
