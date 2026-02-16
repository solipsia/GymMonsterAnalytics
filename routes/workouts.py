"""workouts.py — Workout list, detail, exercise history, and debug routes."""

import time
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests as http_requests
from flask import Blueprint, jsonify, request, session

from helpers import (
    BASE_URL, DEVICE_TYPE,
    auth_headers, check_session_expired, fetch_calendar_months,
    load_history_cache, save_history_cache, load_handle_types,
    exercise_history_cache, cache_lock, CACHE_TTL, CACHE_VERSION,
)

workouts_bp = Blueprint("workouts", __name__)


def _fetch_training_detail(training_id, token, user_id):
    """Fetch completed workout detail for a single training_id (thread-safe)."""
    headers = auth_headers(token, user_id)
    try:
        resp = http_requests.get(
            f"{BASE_URL}/api/app/cttTrainingInfo/{training_id}",
            headers=headers,
            timeout=15,
        )
        body = resp.json()
        if body.get("data"):
            return body["data"]
    except Exception:
        pass
    return None


@workouts_bp.route("/api/workouts")
def get_workouts():
    if not session.get("token"):
        return jsonify({"ok": False, "error": "Not logged in"}), 401

    headers = auth_headers()
    all_days, err = fetch_calendar_months(3, headers)
    if err:
        return err

    workouts = []
    for day in all_days:
        plans = day.get("trainingPlanList") or []
        if not plans:
            continue
        for plan in plans:
            workouts.append({
                "date": day.get("date", ""),
                "name": plan.get("title", "Workout"),
                "code": plan.get("code", ""),
                "templateId": plan.get("templateId"),
                "trainingId": plan.get("trainingId"),
                "isFinish": plan.get("isFinish", 0),
                "actionNum": plan.get("actionNum", 0),
                "calorie": plan.get("calorie", 0),
                "durationMinute": plan.get("durationMinute", 0),
                "trainingTime": plan.get("trainingTime", 0),
                "finishTime": plan.get("finishTime", ""),
                "totalCapacity": plan.get("totalCapacity", 0),
                "type": plan.get("type"),
                "deviceType": plan.get("deviceType"),
                "img": plan.get("img", ""),
            })

    workouts.sort(key=lambda w: w["date"], reverse=True)
    return jsonify({"ok": True, "workouts": workouts})


# ── Exercise history helpers ──

def _extract_completed(all_days):
    """Extract completed workout references from calendar data."""
    completed = []
    for day in all_days:
        plans = day.get("trainingPlanList") or []
        for plan in plans:
            if plan.get("isFinish") == 1 and plan.get("trainingId"):
                completed.append({
                    "date": day.get("date", ""),
                    "trainingId": plan["trainingId"],
                    "finishTime": plan.get("finishTime", ""),
                })
    return completed


def _fetch_uncached_details(completed, history_cache, token, user_id):
    """Fetch training details not yet in cache. Returns updated cache."""
    cached_ids = set(history_cache.get("trainings", {}).keys())
    to_fetch = [w for w in completed if str(w["trainingId"]) not in cached_ids]

    if not to_fetch:
        return history_cache

    with ThreadPoolExecutor(max_workers=10) as executor:
        future_to_workout = {
            executor.submit(_fetch_training_detail, w["trainingId"], token, user_id): w
            for w in to_fetch
        }
        for future in as_completed(future_to_workout):
            w = future_to_workout[future]
            training = future.result()
            if not training:
                continue
            exercises = (
                training.get("cttActionLibraryTrainingInfoList")
                or training.get("actionLibraryTrainingInfoList")
                or []
            )
            extracted = []
            for ex in exercises:
                name = (ex.get("actionLibraryName") or ex.get("name") or "Unknown").strip()
                sets = ex.get("finishedReps") or []
                vol = sum(float(s.get("capacity", 0) or 0) for s in sets)
                max_wt = 0
                for s in sets:
                    cap = float(s.get("capacity", 0) or 0)
                    reps = float(s.get("finishedCount", 0) or 0)
                    if cap > 0 and reps > 0:
                        max_wt = max(max_wt, cap / reps)
                extracted.append({"name": name, "volume": round(vol, 1), "max_weight": round(max_wt, 1)})
            history_cache["trainings"][str(w["trainingId"])] = extracted

    save_history_cache(history_cache)
    return history_cache


def _build_exercise_results(completed, history_cache, cutoff_date):
    """Build filtered exercise history list from completed workouts and cache."""
    exercise_map = {}
    for w in completed:
        tid = str(w["trainingId"])
        exercises = history_cache.get("trainings", {}).get(tid, [])
        for ex in exercises:
            vol = ex["volume"]
            if vol <= 0:
                continue
            name = ex["name"]
            if name not in exercise_map:
                exercise_map[name] = {"count": 0, "sessions": []}
            exercise_map[name]["count"] += 1
            exercise_map[name]["sessions"].append({
                "date": w["date"],
                "volume": vol,
                "max_weight": ex.get("max_weight", 0),
            })

    result = []
    for name, data in sorted(exercise_map.items()):
        data["sessions"].sort(key=lambda s: s["date"])
        if data["sessions"][-1]["date"] < cutoff_date:
            continue
        overall_max_weight = max((s.get("max_weight", 0) for s in data["sessions"]), default=0)
        result.append({
            "name": name,
            "count": data["count"],
            "history": data["sessions"][-20:],
            "all_history": data["sessions"],
            "max_weight": round(overall_max_weight, 1),
        })
    return result


def _build_daily_volumes(completed, history_cache):
    """Build daily volume totals and per-exercise daily maps."""
    daily_vol_map = {}
    exercise_daily = {}
    exercise_last_time = {}
    for w in completed:
        tid = str(w["trainingId"])
        date = w["date"]
        finish_time = w.get("finishTime", "")
        exercises = history_cache.get("trainings", {}).get(tid, [])
        day_total = 0
        for ex in exercises:
            vol = ex["volume"]
            if vol <= 0:
                continue
            day_total += vol
            name = ex["name"]
            if name not in exercise_daily:
                exercise_daily[name] = {}
            exercise_daily[name][date] = exercise_daily[name].get(date, 0) + round(vol, 1)
            if finish_time and (name not in exercise_last_time or finish_time > exercise_last_time[name]):
                exercise_last_time[name] = finish_time
        if day_total > 0:
            daily_vol_map[date] = daily_vol_map.get(date, 0) + day_total

    daily_volume = [{"date": d, "volume": round(v, 1)} for d, v in sorted(daily_vol_map.items())]
    return daily_volume, exercise_daily, exercise_last_time


@workouts_bp.route("/api/exercise-history")
def get_exercise_history():
    """Aggregate exercise volume history across all completed workouts."""
    if not session.get("token"):
        return jsonify({"ok": False, "error": "Not logged in"}), 401

    token = session["token"]
    user_id = session["user_id"]

    with cache_lock:
        if (
            exercise_history_cache["data"] is not None
            and exercise_history_cache["user_id"] == user_id
            and time.time() - exercise_history_cache["timestamp"] < CACHE_TTL
        ):
            return jsonify({
                "ok": True,
                "exercises": exercise_history_cache["data"],
                "daily_volume": exercise_history_cache.get("daily_volume", []),
                "exercise_daily": exercise_history_cache.get("exercise_daily", {}),
                "exercise_last_time": exercise_history_cache.get("exercise_last_time", {}),
            })

    headers = auth_headers()
    all_days, err = fetch_calendar_months(13, headers)
    if err:
        return err

    completed = _extract_completed(all_days)

    history_cache = load_history_cache()
    if history_cache.get("user_id") != user_id or history_cache.get("version") != CACHE_VERSION:
        history_cache = {"user_id": user_id, "trainings": {}, "version": CACHE_VERSION}

    history_cache = _fetch_uncached_details(completed, history_cache, token, user_id)

    today = datetime.now()
    cutoff_date = (today - timedelta(days=14)).strftime("%Y-%m-%d")
    result = _build_exercise_results(completed, history_cache, cutoff_date)
    daily_volume, exercise_daily, exercise_last_time = _build_daily_volumes(completed, history_cache)

    with cache_lock:
        exercise_history_cache["data"] = result
        exercise_history_cache["daily_volume"] = daily_volume
        exercise_history_cache["exercise_daily"] = exercise_daily
        exercise_history_cache["exercise_last_time"] = exercise_last_time
        exercise_history_cache["timestamp"] = time.time()
        exercise_history_cache["user_id"] = user_id

    return jsonify({"ok": True, "exercises": result, "daily_volume": daily_volume, "exercise_daily": exercise_daily, "exercise_last_time": exercise_last_time})


@workouts_bp.route("/api/templates")
def get_templates():
    """Fetch all custom training templates with exercise names."""
    if not session.get("token"):
        return jsonify({"ok": False, "error": "Not logged in"}), 401

    headers = auth_headers()

    try:
        resp = http_requests.get(
            f"{BASE_URL}/api/app/v4/customTrainingTemplate/appPage",
            params={"pageNo": 1, "pageSize": -1, "deviceTypes": DEVICE_TYPE},
            headers=headers,
            timeout=15,
        )
        body = resp.json()
        expired = check_session_expired(body)
        if expired:
            return expired
        templates_raw = body.get("data") or []
    except http_requests.RequestException as e:
        return jsonify({"ok": False, "error": f"Failed to list templates: {e}"}), 500

    # Load handle types for accurate volume calculation
    handle_types = load_handle_types()

    # Fetch detail for each template in parallel to get exercise names + planned volume
    def _fetch_template_detail(code):
        try:
            r = http_requests.get(
                f"{BASE_URL}/api/app/v3/customTrainingTemplate/detailByCode",
                params={"code": code},
                headers=headers,
                timeout=10,
            )
            d = r.json().get("data")
            if d:
                exercises = d.get("actionLibraryList") or []
                names = [ex.get("title", "Unknown") for ex in exercises]
                # Compute planned volume: sum(reps × total_weight) per set
                planned_vol = 0
                for ex in exercises:
                    reps_csv = str(ex.get("setsAndReps") or "")
                    weights_csv = str(ex.get("weights") or "")
                    counters_csv = str(ex.get("counterweight2") or ex.get("counterweight") or "")
                    reps_list = reps_csv.split(",")
                    weights_list = weights_csv.split(",")
                    counters_list = counters_csv.split(",")
                    for i in range(len(reps_list)):
                        if not reps_list[i]:
                            continue
                        counter = counters_list[i].strip() if i < len(counters_list) else ""
                        if counter and counter != "0":
                            continue  # Skip RM/counterweight exercises
                        try:
                            rep_val = float(reps_list[i])
                            wt = float(weights_list[i]) if i < len(weights_list) and weights_list[i] else 0
                            ex_name = ex.get("title", "")
                            is_dual = handle_types.get(ex_name, "Dual Handle") == "Dual Handle"
                            total_wt = wt * 2 if is_dual else wt
                            planned_vol += rep_val * total_wt
                        except (ValueError, IndexError):
                            pass
                return {"names": names, "plannedVolume": round(planned_vol, 1)}
        except Exception:
            pass
        return None

    code_map = {}
    with ThreadPoolExecutor(max_workers=10) as executor:
        future_to_code = {
            executor.submit(_fetch_template_detail, t["code"]): t["code"]
            for t in templates_raw if t.get("code")
        }
        for future in as_completed(future_to_code):
            code = future_to_code[future]
            result = future.result()
            if result is not None:
                code_map[code] = result

    templates = []
    for t in templates_raw:
        code = t.get("code", "")
        detail = code_map.get(code, {})
        templates.append({
            "name": t.get("name", "Untitled"),
            "code": code,
            "actionNum": t.get("actionNum", 0),
            "exercises": detail.get("names", []) if isinstance(detail, dict) else detail,
            "plannedVolume": detail.get("plannedVolume", 0) if isinstance(detail, dict) else 0,
        })

    return jsonify({"ok": True, "templates": templates})


@workouts_bp.route("/api/templates/export")
def export_templates():
    """Export all custom training templates with full exercise details for LLM analysis."""
    if not session.get("token"):
        return jsonify({"ok": False, "error": "Not logged in"}), 401

    headers = auth_headers()

    try:
        resp = http_requests.get(
            f"{BASE_URL}/api/app/v4/customTrainingTemplate/appPage",
            params={"pageNo": 1, "pageSize": -1, "deviceTypes": DEVICE_TYPE},
            headers=headers,
            timeout=15,
        )
        body = resp.json()
        expired = check_session_expired(body)
        if expired:
            return expired
        templates_raw = body.get("data") or []
    except http_requests.RequestException as e:
        return jsonify({"ok": False, "error": f"Failed to list templates: {e}"}), 500

    def _fetch_full_detail(code):
        try:
            r = http_requests.get(
                f"{BASE_URL}/api/app/v3/customTrainingTemplate/detailByCode",
                params={"code": code},
                headers=headers,
                timeout=10,
            )
            d = r.json().get("data")
            if d:
                return d.get("actionLibraryList") or []
        except Exception:
            pass
        return None

    modeNames = {'1': 'Standard', '2': 'Eccentric', '3': 'Eccentric', '4': 'Chain'}

    detail_map = {}
    with ThreadPoolExecutor(max_workers=10) as executor:
        future_to_code = {
            executor.submit(_fetch_full_detail, t["code"]): t["code"]
            for t in templates_raw if t.get("code")
        }
        for future in as_completed(future_to_code):
            code = future_to_code[future]
            result = future.result()
            if result is not None:
                detail_map[code] = result

    templates = []
    for t in templates_raw:
        code = t.get("code", "")
        raw_exercises = detail_map.get(code, [])
        exercises = []
        for ex in raw_exercises:
            name = ex.get("title") or ex.get("name") or "Unknown"
            reps_list = str(ex.get("setsAndReps") or "").split(",")
            weights_list = str(ex.get("weights") or "").split(",")
            modes_list = str(ex.get("sportMode") or "").split(",")
            rest_list = str(ex.get("breakTime2") or ex.get("breakTime") or "").split(",")
            counters_list = str(ex.get("counterweight2") or ex.get("counterweight") or "").split(",")
            count_types = str(ex.get("countType") or "").split(",")
            left_right = str(ex.get("leftRight") or "").split(",")

            sets = []
            for i in range(len(reps_list)):
                if not reps_list[i]:
                    continue
                is_time = count_types[i] == '2' if i < len(count_types) else False
                rep_val = reps_list[i]
                weight_kg = float(weights_list[i]) if i < len(weights_list) and weights_list[i] else 0
                counter = counters_list[i] if i < len(counters_list) else ""
                mode_code = modes_list[i] if i < len(modes_list) else ""
                rest_s = rest_list[i] if i < len(rest_list) else ""
                side_code = left_right[i] if i < len(left_right) else ""

                s = {
                    "set": i + 1,
                    "reps": f"{rep_val}s" if is_time else int(rep_val) if rep_val.isdigit() else rep_val,
                    "weight_per_handle_kg": weight_kg,
                    "total_weight_kg": weight_kg * 2 if weight_kg else 0,
                    "mode": modeNames.get(mode_code, mode_code or "Standard"),
                    "rest_seconds": int(rest_s) if rest_s and rest_s.isdigit() else 0,
                }
                if counter and counter != "0":
                    s["counterweight_rm"] = counter
                if side_code == "1":
                    s["side"] = "Left"
                elif side_code == "2":
                    s["side"] = "Right"
                sets.append(s)

            exercises.append({"name": name, "sets": sets})
        templates.append({"name": t.get("name", "Untitled"), "exercises": exercises})

    return jsonify({"ok": True, "templates": templates})


@workouts_bp.route("/api/workout/<template_code>")
def get_workout_detail(template_code):
    if not session.get("token"):
        return jsonify({"ok": False, "error": "Not logged in"}), 401

    headers = auth_headers()

    try:
        resp = http_requests.get(
            f"{BASE_URL}/api/app/v3/customTrainingTemplate/detailByCode",
            params={"code": template_code},
            headers=headers,
        )
        body = resp.json()
        expired = check_session_expired(body)
        if expired:
            return expired
        data = body.get("data")
        if data:
            return jsonify({"ok": True, "detail": data})
    except http_requests.RequestException as e:
        print(f"Custom template error: {e}")

    return jsonify({
        "ok": False,
        "error": "Could not load workout details",
        "debug": f"Endpoint returned: {body}" if 'body' in dir() else "Request failed",
    }), 404


KG_TO_API = 2.2  # Speediance API stores weights in internal units (~lbs); GET returns kg, POST expects internal


@workouts_bp.route("/api/workout/save", methods=["POST"])
def save_workout_template():
    """Save modified workout template back to Speediance API.

    The Speediance GET API returns weights in kg, but the POST API expects
    weights in an internal unit (approx. lbs, factor ~2.2). We convert
    all non-counterweight weights from kg to the internal unit before saving.
    """
    if not session.get("token"):
        return jsonify({"ok": False, "error": "Not logged in"}), 401

    data = request.get_json()
    if not data or not data.get("id"):
        return jsonify({"ok": False, "error": "Missing template data or id"}), 400

    # Convert weights from kg (as returned by GET) to API internal units
    for ex in data.get("actionLibraryList") or []:
        weights_csv = str(ex.get("weights") or "")
        counters_csv = str(ex.get("counterweight2") or ex.get("counterweight") or "")
        weights = weights_csv.split(",")
        counters = counters_csv.split(",")
        converted = []
        for i, w in enumerate(weights):
            w = w.strip()
            if not w:
                converted.append(w)
                continue
            # Skip conversion for preset/RM exercises (counterweight is the real value)
            counter = counters[i].strip() if i < len(counters) else ""
            if counter and counter != "0":
                converted.append(w)
                continue
            try:
                kg_val = float(w)
                api_val = kg_val * KG_TO_API
                converted.append(f"{api_val:.1f}")
            except ValueError:
                converted.append(w)
        ex["weights"] = ",".join(converted)

    headers = auth_headers()
    try:
        resp = http_requests.post(
            f"{BASE_URL}/api/app/v2/customTrainingTemplate",
            headers=headers,
            json=data,
            timeout=15,
        )
        body = resp.json()
        expired = check_session_expired(body)
        if expired:
            return expired
        if body.get("code") == 0:
            return jsonify({"ok": True})
        return jsonify({"ok": False, "error": body.get("msg", "Save failed")}), 500
    except http_requests.RequestException as e:
        return jsonify({"ok": False, "error": f"Save failed: {e}"}), 500


@workouts_bp.route("/api/training/<int:training_id>")
def get_training_detail(training_id):
    """Fetch actual completed workout data (real reps/weights performed)."""
    if not session.get("token"):
        return jsonify({"ok": False, "error": "Not logged in"}), 401

    headers = auth_headers()

    endpoints = [
        f"{BASE_URL}/api/app/cttTrainingInfo/{training_id}",
        f"{BASE_URL}/api/app/trainingInfo/cttTrainingInfo/{training_id}",
        f"{BASE_URL}/api/app/trainingInfo/cttTrainingInfoDetail/{training_id}",
    ]

    for url in endpoints:
        try:
            resp = http_requests.get(url, headers=headers, timeout=10)
            body = resp.json()
            expired = check_session_expired(body)
            if expired:
                return expired
            data = body.get("data")
            if data:
                return jsonify({"ok": True, "training": data, "source": url})
        except http_requests.RequestException:
            continue

    return jsonify({"ok": False, "error": "Could not load training data"}), 404


@workouts_bp.route("/api/debug/calendar")
def debug_calendar():
    """Returns raw calendar data for the current month."""
    if not session.get("token"):
        return jsonify({"ok": False, "error": "Not logged in"}), 401
    headers = auth_headers()
    month_str = datetime.now().strftime("%Y-%m")
    resp = http_requests.get(
        f"{BASE_URL}/api/app/v5/trainingCalendar/monthNew",
        params={"date": month_str, "selectedDeviceType": DEVICE_TYPE},
        headers=headers,
    )
    return jsonify(resp.json())


@workouts_bp.route("/api/debug/training/<int:training_id>")
def debug_training(training_id):
    """Probe multiple possible training record endpoints to find the right one."""
    if not session.get("token"):
        return jsonify({"ok": False, "error": "Not logged in"}), 401

    headers = auth_headers()
    results = {}

    candidates = [
        f"{BASE_URL}/api/app/customTraining/detail?id={training_id}",
        f"{BASE_URL}/api/app/v2/customTraining/detail?id={training_id}",
        f"{BASE_URL}/api/app/v3/customTraining/detail?id={training_id}",
        f"{BASE_URL}/api/app/trainingCalendar/detail?trainingId={training_id}",
        f"{BASE_URL}/api/app/v5/trainingCalendar/detail?trainingId={training_id}",
        f"{BASE_URL}/api/app/trainingResult/detail?id={training_id}",
        f"{BASE_URL}/api/app/v2/trainingResult/detail?id={training_id}",
        f"{BASE_URL}/api/app/finishTraining/detail?id={training_id}",
        f"{BASE_URL}/api/app/completedTraining/detail?id={training_id}",
        f"{BASE_URL}/api/app/trainingHistory/detail?id={training_id}",
        f"{BASE_URL}/api/app/v2/trainingHistory/detail?id={training_id}",
        f"{BASE_URL}/api/app/workoutRecord/detail?id={training_id}",
    ]

    for url in candidates:
        try:
            resp = http_requests.get(url, headers=headers, timeout=5)
            body = resp.json()
            has_data = body.get("data") is not None and body.get("data") != {}
            results[url] = {
                "status": resp.status_code,
                "code": body.get("code"),
                "has_data": has_data,
                "preview": str(body)[:300],
            }
        except Exception as e:
            results[url] = {"error": str(e)}

    return jsonify({"ok": True, "results": results})
