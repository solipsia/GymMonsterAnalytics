"""helpers.py — Shared constants, config I/O, headers, and cache infrastructure."""

import os
import time
import json
import threading
from datetime import datetime, timedelta

import requests
from flask import session, jsonify

BASE_URL = "https://euapi.speediance.com"
HOST = "euapi.speediance.com"
DEVICE_TYPE = 1  # Gym Monster

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(_BASE_DIR, "config.json")
HISTORY_CACHE_FILE = os.path.join(_BASE_DIR, "exercise_history.json")
MUSCLE_GROUPS_FILE = os.path.join(_BASE_DIR, "muscle_groups.json")
HANDLE_TYPES_FILE = os.path.join(_BASE_DIR, "handle_types.json")
SETTINGS_FILE = os.path.join(_BASE_DIR, "settings.json")

MOBILE_DEVICES = json.dumps({
    "brand": "google",
    "device": "emulator64_x86_64_arm64",
    "deviceType": "sdk_gphone64_x86_64",
    "os": "",
    "os_version": "31",
    "manufacturer": "Google",
})

# In-memory cache for exercise history
exercise_history_cache = {"data": None, "timestamp": 0, "user_id": None}
cache_lock = threading.Lock()
CACHE_TTL = 300  # 5 minutes
CACHE_VERSION = 2  # Bump to invalidate persistent cache when schema changes


# ── Config file I/O ──

def load_config():
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, "r") as f:
            return json.load(f)
    return {}


def save_config(token, user_id):
    with open(CONFIG_FILE, "w") as f:
        json.dump({"token": token, "user_id": user_id}, f)


def clear_config():
    if os.path.exists(CONFIG_FILE):
        os.remove(CONFIG_FILE)


# ── History cache I/O ──

def load_history_cache():
    """Load persistent training detail cache from disk."""
    if os.path.exists(HISTORY_CACHE_FILE):
        try:
            with open(HISTORY_CACHE_FILE, "r") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    return {"user_id": None, "trainings": {}, "version": CACHE_VERSION}


def save_history_cache(cache):
    """Save persistent training detail cache to disk."""
    with open(HISTORY_CACHE_FILE, "w") as f:
        json.dump(cache, f)


# ── Muscle groups I/O ──

def load_muscle_groups():
    """Load muscle group mappings from disk."""
    if os.path.exists(MUSCLE_GROUPS_FILE):
        try:
            with open(MUSCLE_GROUPS_FILE, "r") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    return {}


def save_muscle_groups(mapping):
    """Save muscle group mappings to disk."""
    with open(MUSCLE_GROUPS_FILE, "w") as f:
        json.dump(mapping, f)


# ── Handle types I/O ──

def load_handle_types():
    """Load handle type mappings from disk."""
    if os.path.exists(HANDLE_TYPES_FILE):
        try:
            with open(HANDLE_TYPES_FILE, "r") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    return {}


def save_handle_types(mapping):
    """Save handle type mappings to disk."""
    with open(HANDLE_TYPES_FILE, "w") as f:
        json.dump(mapping, f)


# ── App settings I/O ──

def load_settings():
    """Load app settings from disk."""
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, "r") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    return {}


def save_settings(settings):
    """Save app settings to disk."""
    with open(SETTINGS_FILE, "w") as f:
        json.dump(settings, f)


# ── HTTP headers ──

def login_headers():
    return {
        "Host": HOST,
        "User-Agent": "Dart/3.9 (dart:io)",
        "Content-Type": "application/json",
        "Timestamp": str(int(time.time() * 1000)),
        "Utc_offset": "+0000",
        "Versioncode": "40304",
        "Mobiledevices": MOBILE_DEVICES,
        "Timezone": "GMT",
        "Accept-Language": "en",
        "App_type": "SOFTWARE",
    }


def auth_headers(token=None, user_id=None):
    """Build auth headers. Uses Flask session by default, or explicit params for threads."""
    return {
        "Host": HOST,
        "App_user_id": user_id or session.get("user_id", ""),
        "Token": token or session.get("token", ""),
        "Timestamp": str(int(time.time() * 1000)),
        "Versioncode": "40304",
        "Mobiledevices": MOBILE_DEVICES,
        "Content-Type": "application/json",
        "User-Agent": "Dart/3.9 (dart:io)",
    }


def check_session_expired(body):
    """Check if API response indicates session expiry. Returns error response or None."""
    if body.get("code") == 91:
        session.clear()
        clear_config()
        return jsonify({"ok": False, "error": "Session expired"}), 401
    return None


def fetch_calendar_months(n_months, headers):
    """Fetch n_months of calendar data sequentially. Returns (all_days, error_response)."""
    all_days = []
    today = datetime.now()
    for months_back in range(n_months):
        dt = today - timedelta(days=months_back * 30)
        month_str = dt.strftime("%Y-%m")
        try:
            resp = requests.get(
                f"{BASE_URL}/api/app/v5/trainingCalendar/monthNew",
                params={"date": month_str, "selectedDeviceType": DEVICE_TYPE},
                headers=headers,
            )
            if resp.status_code == 200:
                body = resp.json()
                expired = check_session_expired(body)
                if expired:
                    return None, expired
                days = body.get("data", [])
                if days:
                    all_days.extend(days)
        except requests.RequestException:
            continue
    return all_days, None
