"""auth.py — Authentication routes (login, logout, check, index)."""

import requests as http_requests
from flask import Blueprint, render_template, request, jsonify, session

from helpers import (
    load_config, save_config, clear_config,
    login_headers, BASE_URL,
    exercise_history_cache, cache_lock,
)

auth_bp = Blueprint("auth", __name__)


@auth_bp.route("/")
def index():
    return render_template("index.html")


@auth_bp.route("/api/check")
def check_auth():
    """Check if we have a saved session (from config file or session)."""
    if session.get("token"):
        return jsonify({"ok": True})
    cfg = load_config()
    if cfg.get("token") and cfg.get("user_id"):
        session["token"] = cfg["token"]
        session["user_id"] = cfg["user_id"]
        return jsonify({"ok": True})
    return jsonify({"ok": False})


@auth_bp.route("/login", methods=["POST"])
def login():
    data = request.get_json()
    email = data.get("email", "").strip()
    password = data.get("password", "")

    if not email or not password:
        return jsonify({"ok": False, "error": "Email and password required"}), 400

    headers = login_headers()

    # Step 1: Verify identity
    resp = http_requests.post(
        f"{BASE_URL}/api/app/v2/login/verifyIdentity",
        json={"type": 2, "userIdentity": email},
        headers=headers,
    )
    if resp.status_code != 200:
        return jsonify({"ok": False, "error": f"Verify failed ({resp.status_code})"}), 502

    verify = resp.json().get("data", {})
    if not verify.get("isExist"):
        return jsonify({"ok": False, "error": "Account does not exist"}), 401
    if not verify.get("hasPwd"):
        return jsonify({"ok": False, "error": "No password set on this account"}), 401

    # Step 2: Login
    resp = http_requests.post(
        f"{BASE_URL}/api/app/v2/login/byPass",
        json={"userIdentity": email, "password": password, "type": 2},
        headers=headers,
    )
    if resp.status_code != 200:
        return jsonify({"ok": False, "error": "Login failed"}), 401

    login_data = resp.json().get("data", {})
    token = login_data.get("token")
    user_id = login_data.get("appUserId")

    if not token or not user_id:
        return jsonify({"ok": False, "error": "No token in response"}), 502

    session["token"] = token
    session["user_id"] = str(user_id)
    save_config(token, str(user_id))

    return jsonify({"ok": True})


@auth_bp.route("/logout", methods=["POST"])
def logout():
    session.clear()
    clear_config()
    with cache_lock:
        exercise_history_cache["data"] = None
        exercise_history_cache["timestamp"] = 0
        exercise_history_cache["user_id"] = None
    return jsonify({"ok": True})
