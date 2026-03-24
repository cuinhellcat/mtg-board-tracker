#!/usr/bin/env python3
"""
MTG Board State Tracker - System Tray Launcher

Starts the FastAPI/uvicorn server in a background thread and shows
a system tray icon near the Windows clock with options to open the
browser views and quit cleanly.
"""

import os
import sys
import threading
import webbrowser

import pystray
from PIL import Image
import uvicorn

BASE_URL = "http://localhost:8000"
ICON_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mtg_tray_icon.png")


# ------------------------------------------------------------------
# Server
# ------------------------------------------------------------------

_server_instance: uvicorn.Server | None = None


def run_server():
    """Run uvicorn in the current thread (blocking)."""
    global _server_instance
    config = uvicorn.Config(
        "backend.main:app",
        host="0.0.0.0",
        port=8000,
        log_level="info",
    )
    _server_instance = uvicorn.Server(config)
    _server_instance.run()


def stop_server():
    """Signal the uvicorn server to shut down gracefully."""
    if _server_instance is not None:
        _server_instance.should_exit = True


# ------------------------------------------------------------------
# Tray menu actions
# ------------------------------------------------------------------

def open_landing(icon, item):
    webbrowser.open(f"{BASE_URL}/")


def open_setup(icon, item):
    webbrowser.open(f"{BASE_URL}/setup")


def open_board(icon, item):
    webbrowser.open(f"{BASE_URL}/board")


def open_command(icon, item):
    webbrowser.open(f"{BASE_URL}/command")


def quit_app(icon, item):
    stop_server()
    icon.stop()


# ------------------------------------------------------------------
# Main
# ------------------------------------------------------------------

def main():
    # Load tray icon image
    if os.path.exists(ICON_PATH):
        icon_image = Image.open(ICON_PATH)
    else:
        # Fallback: plain coloured square
        icon_image = Image.new("RGB", (64, 64), (30, 30, 40))

    # Start the server in a daemon thread
    server_thread = threading.Thread(target=run_server, daemon=True)
    server_thread.start()

    # Auto-open after a short delay — backend redirects to /board if game active, else /setup
    def auto_open():
        import time
        time.sleep(2)
        webbrowser.open(f"{BASE_URL}/")

    threading.Thread(target=auto_open, daemon=True).start()

    # Build the tray icon
    menu = pystray.Menu(
        pystray.MenuItem("Landing Page", open_landing),
        pystray.MenuItem("New Game", open_setup),
        pystray.MenuItem("Open Board", open_board),
        pystray.MenuItem("Open Command Center", open_command),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Quit", quit_app),
    )

    icon = pystray.Icon(
        name="mtg-tracker",
        icon=icon_image,
        title="MTG Board State Tracker",
        menu=menu,
    )

    # icon.run() blocks until icon.stop() is called
    icon.run()


if __name__ == "__main__":
    main()
