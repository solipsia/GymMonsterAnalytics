# Gym Monster Analytics

Web app for viewing Speediance Gym Monster workout history. Python Flask backend serving a single-page HTML frontend.

## Tech Stack

- **Backend:** Python Flask + requests, organized into blueprints
- **Frontend:** Vanilla HTML/CSS/JS (no frameworks), split into separate static files
- **API:** Speediance EU region (`https://euapi.speediance.com`)
- **Auth:** Email/password login, token persisted in `config.json`

## Project Structure

```
app.py                  # Flask entry point (creates app, registers blueprints)
helpers.py              # Shared constants, config/cache I/O, HTTP headers, API helpers
routes/
  __init__.py
  auth.py               # Auth blueprint: login, logout, check, index
  workouts.py           # Workouts blueprint: list, detail, exercise history, debug
  settings.py           # Settings blueprint: muscle groups, handle types, app settings
templates/
  index.html            # HTML shell (structure only, ~100 lines)
static/
  style.css             # All CSS (~480 lines, unified .chart/.chart-bar system for bar charts)
  app.js                # Core: utilities, constants, auth, data mappings, muscle map, history table
  charts.js             # Chart rendering: rolling avg, daily volume, muscle group, exercise bar
  workouts.js           # Workout list, detail views, exercise rendering
  settings.js           # Settings page with exercise mapping table
  muscles.svg           # Inline SVG body map with data-muscle attributes per path
resources/
  muscles-optimised.svg # Source SVG with embedded reference image (not served)
config.json             # Auto-generated auth token persistence (do not commit)
exercise_history.json   # Persistent training detail cache (auto-generated, do not commit)
muscle_groups.json      # Persistent exercise-to-muscle-group mappings (auto-generated, do not commit)
handle_types.json       # Persistent exercise-to-handle-type mappings (auto-generated, do not commit)
settings.json           # Persistent app settings like recovery hours (auto-generated, do not commit)
requirements.txt        # flask, requests
MuscleGroupMap.txt      # Reference list of available muscle group names
```

## Running

```bash
pip install -r requirements.txt
python app.py            # Starts on http://localhost:5000
```

## Key Architecture

- Single-page app with views toggled via JS: login, workout list, workout detail, exercise detail, settings
- Flask proxies all Speediance API calls (avoids CORS, keeps token server-side)
- Auth flow: login stores token in Flask session + `config.json`; on page load `/api/check` restores session from `config.json`
- `secret_key` regenerates each restart (session cookie invalidates but config.json recovers it)
- Device type hardcoded to `1` (Gym Monster)
- Exercise history has two cache layers:
  - **Persistent disk cache** (`exercise_history.json`): stores extracted exercise data (volume + max weight) per `trainingId`. Past workouts never change, so only new workouts are fetched via API. Keyed by `user_id` for multi-user safety. Has a `version` field — bumping `CACHE_VERSION` in `helpers.py` forces a full re-fetch.
  - **In-memory cache** (`exercise_history_cache`, 5min TTL): avoids re-reading disk and re-processing on every request
- `ThreadPoolExecutor(max_workers=10)` for parallel API fetching of uncached training details
- `_fetch_training_detail()` uses `auth_headers(token, user_id)` with explicit params (not Flask session) since it runs inside thread pool workers
- **Shared helpers in `helpers.py`**: `check_session_expired(body)` handles code-91 expiry (used by all API routes), `fetch_calendar_months(n, headers)` does sequential month fetching (used by workouts + exercise history), `auth_headers(token, user_id)` supports both session-based and explicit-param usage
- **Exercise history decomposed into helpers**: `_extract_completed()`, `_fetch_uncached_details()`, `_build_exercise_results()`, `_build_daily_volumes()` — each ~25 lines, called by `get_exercise_history()`
- Exercise history table filters: zero-volume sessions excluded, only exercises done in last 14 days shown
- Exercise history table shows muscle group column (sorted by muscle group, then name), and % change for volume columns (first value absolute, subsequent values as +N% / -N% with green/red coloring)
- Muscle group mappings: stored server-side in `muscle_groups.json` via `/api/muscle-groups` endpoints. In-memory cache `_muscleGroupMap` loaded at startup via `loadMuscleGroups()`.
- Handle type mappings: stored server-side in `handle_types.json` via `/api/handle-types` endpoints. In-memory cache `_handleTypeMap` loaded at startup via `loadHandleTypes()`. Options: "Dual Handle" (default) or "Single Weight". When "Dual Handle", workout detail tables show an extra "Per Handle" column (total weight / 2).
- **App settings**: stored server-side in `settings.json` via `/api/settings` endpoints. `_recoveryHours` global (default 96) loaded at startup via `loadSettings()`. Currently stores `recoveryHours` (muscle full recovery time in hours, configurable 24–168h via slider in settings page).
- `/api/exercise-history` response: `{exercises: [...], daily_volume: [{date, volume}], exercise_daily: {exercise_name: {date: volume}}, exercise_last_time: {exercise_name: "YYYY-MM-DD HH:MM:SS"}}`
- Weekly volume bar chart: `renderDailyVolumeChart()` shows 52 weeks of total volume per week (Mon–Sun) below the exercise history table. Calendar data fetches 13 months to cover the range. Week buckets built by `buildWeekBuckets()`, aggregated by `aggregateWeekly()`. Tooltips show week date range via `formatWeekRange()`.
- Per-muscle-group volume charts: `renderMuscleGroupCharts()` shows one half-height (70px) chart per muscle group below the weekly volume chart. Groups exercises by muscle mapping from `_muscleGroupMap`, sums daily volumes into weekly buckets from `window._exerciseDaily`. Only renders charts for groups with non-zero volume. Iterates `MUSCLE_GROUPS` array for consistent ordering.
- **Settings page**: accessible via gear icon next to Log Out. Has a "Muscle Full Recovery Time" slider (24h–168h, default 96h/4 days) that controls fatigue color gradient timing, plus exercise mapping table listing ALL exercises (from `_exerciseDaily` + existing mappings) with muscle group and handle type dropdowns. `openSettings()` / `closeSettings()` toggle the view. Changes save immediately to server.
- **Rolling average line**: `buildRollingAvgSvg(items, maxVol, windowSize=4)` computes moving average including zeros, renders as SVG polyline overlaid on bar charts. Applied to weekly volume chart and all muscle group charts.
- **Muscle map**: SVG body diagram (`static/muscles.svg`) displayed on the left side of `#muscleMapContainer`. Body outline paths in gray, muscle paths color-coded by fatigue: red (just exercised) → orange → green (fully recovered). Unexercised muscles stay dark gray. Each `<path>` has a `data-muscle` attribute mapping to a muscle group (Chest, Delts, Triceps, Biceps, Forearms, Back, Abs, Traps, Glutes, Quads, Hamstrings, Calves). `loadMuscleMap()` fetches and inlines the SVG into `#muscleMapSvg` wrapper; `updateMuscleMapColors()` uses `_exerciseLastTime` (finish timestamps from calendar API) for hour-level precision, falling back to date strings from `_exerciseDaily`. Colors set via `muscleFatigueColor(hours)` using HSL interpolation (hue 0→120 over `_recoveryHours`, default 96h/4 days, configurable in settings). Tooltips show "just now" / "Xh ago" / "X days ago".
- **Planned workouts**: Displayed to the right of the muscle map in `#plannedWorkoutsSection`. `loadPlannedWorkouts()` fetches `/api/templates` and renders cards in a 2-column grid showing template name + exercise names. Cards are clickable (reuses `openDetail()` flow). Container scrolls vertically if content exceeds muscle map height (267px). `#muscleMapContainer` uses flexbox with `#muscleMapSvg` (fixed) and `#plannedWorkoutsSection` (flex: 1) as siblings.

## Backend Routes

| Route | Method | Blueprint | Purpose |
|-------|--------|-----------|---------|
| `/` | GET | auth | Serve frontend |
| `/login` | POST | auth | Two-step Speediance login (verify identity + login by password) |
| `/logout` | POST | auth | Clear session and config.json |
| `/api/check` | GET | auth | Check/restore saved auth |
| `/api/workouts` | GET | workouts | Fetch last 3 months of calendar data |
| `/api/workout/<code>` | GET | workouts | Get workout template detail (planned exercises) |
| `/api/training/<id>` | GET | workouts | Get completed workout data (actual performance) |
| `/api/exercise-history` | GET | workouts | Aggregated exercise volume history (persistent + in-memory cache) |
| `/api/templates` | GET | workouts | List all custom training templates with exercise names |
| `/api/muscle-groups` | GET | settings | Return saved muscle group mappings |
| `/api/muscle-groups` | POST | settings | Save a single exercise-to-muscle-group mapping |
| `/api/handle-types` | GET | settings | Return saved handle type mappings |
| `/api/handle-types` | POST | settings | Save a single exercise-to-handle-type mapping |
| `/api/settings` | GET | settings | Return app settings (recovery hours, etc.) |
| `/api/settings` | POST | settings | Update app settings (merges with existing) |

## Speediance API Notes

- Calendar API fields differ from template API: `title` (not `name`), `code` (not `templateCode`), `isFinish` (not `status`)
- Completed workout detail endpoint: `/api/app/cttTrainingInfo/{trainingId}`
  - Exercise list key: `cttActionLibraryTrainingInfoList`
  - Per-set data in `finishedReps` array with `finishedCount`, `targetCount`, `capacity`, `avgWeight`
- **Custom template list**: `GET /api/app/v4/customTrainingTemplate/appPage?pageNo=1&pageSize=-1&deviceTypes=1`
  - Returns array of templates with `name`, `code`, `actionNum`, `actionInfoList` (exercise thumbnails)
- **Custom template detail**: `GET /api/app/v3/customTrainingTemplate/detailByCode?code={code}`
  - Returns `actionLibraryList` array — each exercise has `title`, `img`, `setsAndReps` (comma-separated), `weights` (comma-separated, per-handle kg for dual-handle exercises — multiply by 2 for total), `sportMode`, `breakTime2`
- **Template CRUD**: `POST /api/app/v2/customTrainingTemplate` (create/update), `DELETE /api/app/customTrainingTemplate?ids={id}` (delete)
- **Exercise library**: `GET /api/app/actionLibraryTab/list?deviceType=1` (categories), `GET /api/app/actionLibraryGroup/trainingPartGroup?tabId={id}&deviceTypeList=1` (exercises by category)
- Volume values from the API are in raw units (display directly as kg, do NOT divide by 1000)
- Weight per set is calculated as `volume / reps` (not from avgWeight)
- Some API fields (countType, sportMode) may be numbers — always coerce with `String()` before `.split()`
- Mobile device headers are spoofed (Dart user-agent, emulated Android)

## UI Theme

Dark slate theme using CSS custom properties in `static/style.css` (`--bg-base: #0f172a`, `--bg-surface: #1e293b`, `--primary: #818cf8` indigo, `--accent: #22d3ee` cyan, `--success: #4ade80` green, `--bar-current: #c084fc` purple). All colors defined as CSS variables in `:root`.

## Frontend File Organization

| File | Contents |
|------|----------|
| `static/app.js` | `formatDate()`, `esc()`, `str()`, `apiFetch()`, `apiPost()`, `MUSCLE_GROUPS`, `HANDLE_TYPES`, muscle/handle mapping functions, `doLogin()`, `doLogout()`, `loadSettings()`, `loadMuscleMap()`, `updateMuscleMapColors()`, `muscleFatigueColor()`, `loadPlannedWorkouts()`, `openTemplateDetail()`, `renderExerciseHistoryTable()`, `loadExerciseHistory()`, `showWorkoutList()` |
| `static/charts.js` | `buildWeekBuckets()`, `aggregateWeekly()`, `formatWeekRange()`, `buildRollingAvgSvg(items, maxVol, windowSize)`, `renderDailyVolumeChart()`, `renderMuscleGroupCharts()`, `renderExerciseBarChart()` |
| `static/workouts.js` | `loadWorkouts()`, `openDetail()`, `renderTrainingDetail()`, `renderTrainingExercise()`, `renderExercise()`, `openExerciseDetail()` |
| `static/settings.js` | `formatRecoveryLabel()`, `initRecoverySlider()`, `openSettings()`, `closeSettings()` |
| `templates/index.html` | HTML structure + init script (session check, Enter key listeners) |

Load order: `app.js` → `charts.js` → `workouts.js` → `settings.js` → inline init script.

## Frontend Data Flow

- `window._workouts` — workout list from `/api/workouts`, used by click handlers
- `window._exerciseDaily` — per-exercise daily volume data `{exercise_name: {date: volume}}` from `/api/exercise-history`, used by `renderMuscleGroupCharts()`, `updateMuscleMapColors()`, and settings page exercise list
- `window._exerciseHistory` — exercise history from `/api/exercise-history`, used by:
  - Exercise history table on home screen (`loadExerciseHistory()`) — rows are clickable
  - Bar charts in detail view (`renderExerciseBarChart()`)
  - Exercise detail view (`openExerciseDetail()`) — shows sessions count, max weight, full volume bar chart
- Workout list groups items by date (`.day-group`) with daily volume totals
- `window._exerciseLastTime` — per-exercise most recent finish timestamp `{exercise_name: "YYYY-MM-DD HH:MM:SS"}` from `/api/exercise-history`, used by `updateMuscleMapColors()` for hour-level fatigue precision
- `loadMuscleGroups()`, `loadHandleTypes()`, and `loadSettings()` are awaited before `loadExerciseHistory()` so mappings and settings are available for table rendering and muscle map coloring
- `loadWorkouts()`, `loadPlannedWorkouts()`, and `loadExerciseHistory()` fire in parallel on page load (planned workouts and workouts fire immediately; exercise history fires after muscle groups, handle types, and settings are loaded)

## Code Conventions

- No external JS/CSS frameworks — keep it vanilla
- All JS functions are global scope (no ES modules), loaded via `<script>` tags in order
- **API fetch pattern**: use `apiFetch(url)` / `apiPost(url, body)` for all server calls — handles JSON parsing and 401 redirect to login. Returns `null` on 401, data object otherwise. Always check `if (!data) return;` before `if (!data.ok)`.
- **CSS chart system**: all bar charts use `.chart` base + size modifier (`.chart-xs`/`.chart-sm`/`.chart-md`/`.chart-lg`). Bars use `.chart-bar`, empties use `.chart-bar-empty`, tooltips use `.chart-tooltip`. Volume bars add `.has-vol` for fill color, `.current-week` for highlight.
- **Python session expiry**: use `check_session_expired(body)` → returns error tuple or `None`. Pattern: `expired = check_session_expired(body); if expired: return expired`
- **Python calendar fetch**: use `fetch_calendar_months(n, headers)` → returns `(all_days, error_response)`. Pattern: `all_days, err = fetch_calendar_months(3, headers); if err: return err`
- Two rendering paths for workout detail:
  - `renderTrainingExercise(ex, workoutDate)` — completed workouts with actual performance data (returns `{html, totalVolume}`). Columns: Set, Reps, Total Weight, Per Handle (dual-handle only), Volume.
  - `renderExercise()` — template/planned workouts (returns HTML string). Columns: Set, Reps, Total Weight, Per Handle (dual-handle only), Mode, Rest.
- Weight styling in both renderers: dual-handle exercises show Total Weight in muted grey and Per Handle in bold; single-weight exercises show Total Weight in bold
