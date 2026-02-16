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
config.json             # Auto-generated auth token + email persistence (do not commit)
exercise_history.json   # Persistent training detail cache (auto-generated, do not commit)
muscle_groups.json      # Persistent exercise-to-muscle mappings with secondary (auto-generated, do not commit)
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

- Single-page app with views toggled via JS: login, workout list, workout detail, exercise detail, exercise history, settings
- Flask proxies all Speediance API calls (avoids CORS, keeps token server-side)
- Auth flow: login stores token + email in Flask session + `config.json`; on page load `/api/check` restores session from `config.json`. User email displayed below logout button.
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
- Exercise history table shows Muscle and Secondary columns (sorted by muscle group, then name), with a single "Weight History" colspan header over the 20 value columns. Values show % change (first value absolute, subsequent as +N% / -N% with green/red coloring)
- Muscle group mappings: stored server-side in `muscle_groups.json` via `/api/muscle-groups` endpoints. Each entry is `{primary, secondary, secondaryPercent}` (migrated from old flat `"exercise": "group"` format on load). In-memory cache `_muscleGroupMap` loaded at startup via `loadMuscleGroups()`. Accessor functions: `getMuscleGroup(name)` (returns primary), `getSecondaryMuscle(name)` (returns secondary or "None"), `getSecondaryPercent(name)` (returns 0–100, default 50). `setMuscleGroup(name, group, secondary, secondaryPercent)` saves all fields (undefined params keep existing values).
- Handle type mappings: stored server-side in `handle_types.json` via `/api/handle-types` endpoints. In-memory cache `_handleTypeMap` loaded at startup via `loadHandleTypes()`. Options: "Dual Handle" (default) or "Single Weight". When "Dual Handle", workout detail tables show an extra "Per Handle" column (total weight / 2).
- **App settings**: stored server-side in `settings.json` via `/api/settings` endpoints. `_recoveryHours` global (default 96) loaded at startup via `loadSettings()`. Currently stores `recoveryHours` (muscle full recovery time in hours, configurable 24–168h via slider in settings page).
- `/api/exercise-history` response: `{exercises: [...], daily_volume: [{date, volume}], exercise_daily: {exercise_name: {date: volume}}, exercise_last_time: {exercise_name: "YYYY-MM-DD HH:MM:SS"}}`
- Weekly volume bar chart: `renderDailyVolumeChart()` shows 52 weeks of total volume per week (Mon–Sun) below the exercise history table. Calendar data fetches 13 months to cover the range. Week buckets built by `buildWeekBuckets()`, aggregated by `aggregateWeekly()`. Tooltips show week date range via `formatWeekRange()`.
- Per-muscle-group volume charts: `renderMuscleGroupCharts()` shows one half-height (70px) chart per muscle group in a **two-column grid** (`#muscleGroupCharts`) below the weekly volume chart. Each tile includes a **mini muscle map SVG** (full card height, left-aligned, z-index above chart) with the target muscle highlighted in red; body outline in lighter grey (`#334155` fill, `#666` stroke), non-highlighted muscles in `#475569`. SVG text cached in `window._muscleSvgText` from `loadMuscleMap()`. Groups exercises by muscle mapping, sums daily volumes into weekly buckets. Primary gets 100%, secondary gets scaled volume. Iterates `MUSCLE_GROUPS` for consistent ordering.
- **Settings page**: accessible via gear icon next to Log Out. Has a "Muscle Full Recovery Time" slider (24h–168h, default 96h/4 days) that controls fatigue color gradient timing, plus exercise mapping table listing ALL exercises (from `_exerciseDaily` + existing mappings) with columns: Primary Muscle, Secondary Muscle (dropdown with "None" + all muscle groups), % Secondary (0–100 number input, disabled when secondary is "None"), and Weight Type. New/unconfigured exercises default to primary="Other", secondary="None", %=50. `openSettings()` / `closeSettings()` toggle the view. Changes save immediately to server.
- **Rolling average line**: `buildRollingAvgSvg(items, maxVol, windowSize=4)` computes moving average including zeros, renders as SVG polyline overlaid on bar charts. Applied to weekly volume chart and all muscle group charts.
- **Muscle map (main page)**: SVG body diagram (`static/muscles.svg`) displayed on the left side of `#muscleMapContainer`. Body outline paths in gray, muscle paths color-coded by stacking fatigue model. Each `<path>` has a `data-muscle` attribute mapping to a muscle group (Chest, Delts, Triceps, Biceps, Forearms, Back, Abs, Traps, Glutes, Quads, Hamstrings, Calves). `loadMuscleMap()` fetches and inlines the SVG into `#muscleMapSvg` wrapper. `computeMuscleFatigue()` calculates fatigue level (0.0–1.0) per muscle group using a stacking decay model:
  - **Fatigue contributions**: primary exercises add 1.0, secondary exercises add `secondaryPercent/100` (e.g., 50% → 0.5)
  - **Linear decay**: fatigue decreases at a constant rate of `1/recoveryHours` per hour (100% fatigue takes full `recoveryHours` to reach 0%)
  - **Stacking**: events are processed chronologically per muscle group — decay applied between events, new contributions added and capped at 1.0
  - **Precision**: uses `_exerciseLastTime` timestamps for hour-level precision on the most recent date, date-level precision for older events
  - `updateMuscleMapColors()` calls `computeMuscleFatigue()` and colors via `muscleFatigueColor(fatigue)`: fatigue 1.0 = red (hue 0), 0.0 = green (hue 120). Unexercised muscles stay dark gray. Tooltips show "X% fatigued" or "recovered"/"no data".
- **Muscle map (detail view)**: `renderDetailMuscleMap(exerciseNames)` shows a smaller SVG in the planned workout detail header. Primary muscles colored red, secondary-only muscles colored orange, unworked muscles grey. Tooltips show "(primary)" or "(secondary)".
- **Editable template weights**: In the template detail view, weight cells are inline `<input type="number" class="weight-input">` fields. The editable value is the bold one: per-handle for dual-handle exercises, total weight for single-weight. RM (counterweight) exercises are read-only. Input values equal the raw API `weights` field value — no conversion needed on save. `onWeightInput()` updates the computed column live and enables the Save button. `saveTemplateWeights()` collects inputs, rebuilds each exercise's `weights` CSV in the stored `window._editingTemplate` object, and POSTs the complete template to `/api/workout/save` (which proxies to Speediance `POST /api/app/v2/customTrainingTemplate`). Uses read-modify-write pattern: only `weights` fields are changed, all other template data is preserved from the original API response.
- **Planned workouts**: Displayed to the right of the muscle map in `#plannedWorkoutsSection`. `loadPlannedWorkouts()` fetches `/api/templates` and renders cards in a 2-column grid showing template name + **primary muscle groups** (not exercise names). Cards are clickable (reuses `openDetail()` flow). Container scrolls vertically if content exceeds muscle map height (267px). `#muscleMapContainer` uses flexbox with `#muscleMapSvg` (fixed) and `#plannedWorkoutsSection` (flex: 1) as siblings.
- **Last Workout section**: Shows only the most recent day's workouts in a 2-column grid (`#recentWorkoutsSection`) above Weight History. Includes an "Exercise History" button (styled to match day-group-date: cyan accent, small padding) that navigates to `#historyView` — a separate full-page view with the complete workout list grouped by date. `showFullHistory()` renders the full list; `showWorkoutList()` returns to the home page.
- **Exercise History view** (`#historyView`): Full workout history list (all day-groups), accessed via "Exercise History" button on home page. Has a Back button to return to the main view. Clicking a workout opens the detail view as normal.
- **Planned vs Actual volume bars**: On each workout card (Last Workout + Exercise History), horizontal bars compare planned template volume (grey) vs actual completed volume (indigo). Shows percentage label: green (>=100%), cyan (>=80%), muted (<80%). Only shown for custom templates with planned volume data. `_renderVolumeBars(w)` generates the HTML; `_updateVolumeBars()` retroactively inserts bars after template data loads (since workouts and templates load in parallel). Backend `/api/templates` computes `plannedVolume` per template from `actionLibraryList` weights/reps using handle type mappings.
- **Activity heatmap**: GitHub-style year calendar (`#activityHeatmap`) between Last Workout and Weight History sections. `renderActivityHeatmap(dailyVolume)` builds a CSS grid of 53 weeks × 7 days (Mon–Sun, Monday at top). Green intensity based on volume quartiles (4 levels). Shows "N workouts in the last year" header. Tooltips on hover show date + volume. Uses `daily_volume` data from exercise history API.

## Backend Routes

| Route | Method | Blueprint | Purpose |
|-------|--------|-----------|---------|
| `/` | GET | auth | Serve frontend |
| `/login` | POST | auth | Two-step Speediance login (verify identity + login by password), returns email |
| `/logout` | POST | auth | Clear session and config.json |
| `/api/check` | GET | auth | Check/restore saved auth, returns email |
| `/api/workouts` | GET | workouts | Fetch last 3 months of calendar data |
| `/api/workout/<code>` | GET | workouts | Get workout template detail (planned exercises) |
| `/api/training/<id>` | GET | workouts | Get completed workout data (actual performance) |
| `/api/exercise-history` | GET | workouts | Aggregated exercise volume history (persistent + in-memory cache) |
| `/api/templates` | GET | workouts | List all custom training templates with exercise names and planned volumes |
| `/api/workout/save` | POST | workouts | Save modified workout template weights to Speediance API |
| `/api/muscle-groups` | GET | settings | Return saved muscle group mappings |
| `/api/muscle-groups` | POST | settings | Save exercise muscle mapping (group, secondary, secondaryPercent) |
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
- **Weight unit conversion**: The GET API returns weights in **kg**, but the POST API expects weights in an **internal unit** (≈ lbs, factor **2.2**). When saving template weights, multiply kg values by 2.2 before POSTing. Do NOT convert counterweight/RM values. The constant `KG_TO_API = 2.2` is defined in `routes/workouts.py`.
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
| `static/app.js` | `formatDate()`, `esc()`, `str()`, `apiFetch()`, `apiPost()`, `MUSCLE_GROUPS`, `HANDLE_TYPES`, muscle mapping functions (`getMuscleGroup`, `getSecondaryMuscle`, `getSecondaryPercent`, `setMuscleGroup`), handle mapping functions, `doLogin()`, `doLogout()`, `loadSettings()`, `loadMuscleMap()`, `computeMuscleFatigue()`, `updateMuscleMapColors()`, `muscleFatigueColor()`, `renderDetailMuscleMap()`, `loadPlannedWorkouts()`, `openTemplateDetail()`, `renderExerciseHistoryTable()`, `loadExerciseHistory()`, `showWorkoutList()` |
| `static/charts.js` | `buildWeekBuckets()`, `aggregateWeekly()`, `formatWeekRange()`, `buildRollingAvgSvg(items, maxVol, windowSize)`, `renderDailyVolumeChart()`, `renderMuscleGroupCharts()`, `renderActivityHeatmap()`, `renderExerciseBarChart()` |
| `static/workouts.js` | `_buildWorkoutGroups()`, `_renderWorkoutItem()`, `_renderVolumeBars()`, `_updateVolumeBars()`, `_renderDayGroup()`, `_wireWorkoutClicks()`, `loadWorkouts()`, `showFullHistory()`, `openDetail()`, `renderTrainingDetail()`, `renderTrainingExercise()`, `renderExercise(ex, exIdx)`, `onWeightInput()`, `saveTemplateWeights()`, `buildMuscleVolumeSummary()`, `openExerciseDetail()` |
| `static/settings.js` | `formatRecoveryLabel()`, `initRecoverySlider()`, `openSettings()`, `closeSettings()` |
| `templates/index.html` | HTML structure + init script (session check, Enter key listeners) |

Load order: `app.js` → `charts.js` → `workouts.js` → `settings.js` → inline init script.

## Frontend Data Flow

- `window._workouts` — workout list from `/api/workouts`, used by click handlers
- `window._exerciseDaily` — per-exercise daily volume data `{exercise_name: {date: volume}}` from `/api/exercise-history`, used by `renderMuscleGroupCharts()`, `computeMuscleFatigue()`, and settings page exercise list
- `window._exerciseHistory` — exercise history from `/api/exercise-history`, used by:
  - Exercise history table on home screen (`loadExerciseHistory()`) — rows are clickable
  - Bar charts in detail view (`renderExerciseBarChart()`)
  - Exercise detail view (`openExerciseDetail()`) — shows sessions count, max weight, full volume bar chart
- `window._templatePlannedVolume` — planned volume per template code `{code: volume_kg}` from `/api/templates`, used by `_renderVolumeBars()` for planned vs actual comparison bars on workout cards
- `window._workoutGroups` — workouts grouped by date, built by `_buildWorkoutGroups()`, used by recent workouts section and full history view
- Workout list groups items by date (`.day-group`) with daily volume totals
- `window._exerciseLastTime` — per-exercise most recent finish timestamp `{exercise_name: "YYYY-MM-DD HH:MM:SS"}` from `/api/exercise-history`, used by `computeMuscleFatigue()` for hour-level precision on the most recent exercise date
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
  - `renderExercise()` — template/planned workouts (returns HTML string). Shows muscle group labels after exercise name: `(Primary, Secondary N%)`. Columns: Set, Reps, Total Weight, Per Handle (dual-handle only), Mode, Rest.
- Weight styling in both renderers: dual-handle exercises show Total Weight in muted grey and Per Handle in bold; single-weight exercises show Total Weight in bold
- **Planned workout muscle volume summary**: `buildMuscleVolumeSummary(exercises)` renders a table between the detail header and exercise cards showing per-muscle-group volume distribution. Calculates planned volume per exercise (reps × weight), distributes 100% to primary muscle and `secondaryPercent%` to secondary muscle. Table columns: Muscle Group, Primary, Secondary, Total Effective. Sorted by total effective volume descending, with totals row. Exercises using RM (counterweight) are excluded since no real weight is available. An "Exercises" section heading separates the summary table from individual exercise cards.
