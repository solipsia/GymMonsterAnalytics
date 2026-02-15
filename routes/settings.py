"""settings.py — Muscle group and handle type mapping routes."""

from flask import Blueprint, request, jsonify

from helpers import (
    load_muscle_groups, save_muscle_groups,
    load_handle_types, save_handle_types,
    load_settings, save_settings,
)

settings_bp = Blueprint("settings", __name__)


@settings_bp.route("/api/muscle-groups")
def get_muscle_groups():
    """Return saved muscle group mappings."""
    return jsonify({"ok": True, "mapping": load_muscle_groups()})


@settings_bp.route("/api/muscle-groups", methods=["POST"])
def save_muscle_group():
    """Save a single exercise-to-muscle-group mapping."""
    data = request.get_json()
    exercise = data.get("exercise")
    group = data.get("group")
    if not exercise or not group:
        return jsonify({"ok": False, "error": "Missing exercise or group"}), 400
    mapping = load_muscle_groups()
    mapping[exercise] = group
    save_muscle_groups(mapping)
    return jsonify({"ok": True})


@settings_bp.route("/api/handle-types")
def get_handle_types():
    """Return saved handle type mappings."""
    return jsonify({"ok": True, "mapping": load_handle_types()})


@settings_bp.route("/api/handle-types", methods=["POST"])
def save_handle_type():
    """Save a single exercise-to-handle-type mapping."""
    data = request.get_json()
    exercise = data.get("exercise")
    handle_type = data.get("handleType")
    if not exercise or not handle_type:
        return jsonify({"ok": False, "error": "Missing exercise or handleType"}), 400
    mapping = load_handle_types()
    mapping[exercise] = handle_type
    save_handle_types(mapping)
    return jsonify({"ok": True})


@settings_bp.route("/api/settings")
def get_settings():
    """Return app settings."""
    return jsonify({"ok": True, "settings": load_settings()})


@settings_bp.route("/api/settings", methods=["POST"])
def update_settings():
    """Update app settings (merges with existing)."""
    data = request.get_json()
    settings = load_settings()
    settings.update(data)
    save_settings(settings)
    return jsonify({"ok": True})
