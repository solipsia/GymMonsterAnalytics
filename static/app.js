/* app.js — Core utilities, data constants, auth, exercise history table */

const loginView = document.getElementById('loginView');
const workoutView = document.getElementById('workoutView');
const detailView = document.getElementById('detailView');
const settingsView = document.getElementById('settingsView');

// ── Utilities ──

function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-GB', {
        weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
    });
}

function esc(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
}

function str(v) { return v == null ? '' : String(v); }

async function apiFetch(url, options) {
    const resp = await fetch(url, options);
    if (resp.status === 401) {
        workoutView.style.display = 'none';
        loginView.style.display = 'block';
        return null;
    }
    return resp.json();
}

async function apiPost(url, body) {
    return apiFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

// ── Constants ──

const MUSCLE_GROUPS = ['Abs','Back','Biceps','Calves','Chest','Delts','Forearms','Glutes','Hamstrings','Quads','Traps','Triceps','Other'];
const HANDLE_TYPES = ['Dual Handle', 'Single Weight'];

// ── Muscle group mappings ──

let _muscleGroupMap = {};

async function loadMuscleGroups() {
    try {
        const data = await apiFetch('/api/muscle-groups');
        if (data && data.ok) _muscleGroupMap = data.mapping || {};
    } catch(e) {}
}

function getMuscleGroup(name) {
    const entry = _muscleGroupMap[name];
    if (!entry) return 'Other';
    return typeof entry === 'string' ? entry : (entry.primary || 'Other');
}

function getSecondaryMuscle(name) {
    const entry = _muscleGroupMap[name];
    if (!entry || typeof entry === 'string') return 'None';
    return entry.secondary || 'None';
}

function getSecondaryPercent(name) {
    const entry = _muscleGroupMap[name];
    if (!entry || typeof entry === 'string') return 50;
    return entry.secondaryPercent != null ? entry.secondaryPercent : 50;
}

async function setMuscleGroup(name, group, secondary, secondaryPercent) {
    const entry = _muscleGroupMap[name];
    const current = (entry && typeof entry === 'object') ? entry : { primary: getMuscleGroup(name), secondary: 'None', secondaryPercent: 50 };
    if (group !== undefined) current.primary = group;
    if (secondary !== undefined) current.secondary = secondary;
    if (secondaryPercent !== undefined) current.secondaryPercent = secondaryPercent;
    _muscleGroupMap[name] = current;
    await apiPost('/api/muscle-groups', { exercise: name, group: current.primary, secondary: current.secondary, secondaryPercent: current.secondaryPercent });
}

// ── Handle type mappings ──

let _handleTypeMap = {};
let _recoveryHours = 96; // default 4 days, loaded from settings

async function loadSettings() {
    const data = await apiFetch('/api/settings');
    if (data && data.ok && data.settings) {
        if (data.settings.recoveryHours) _recoveryHours = data.settings.recoveryHours;
    }
}

async function loadHandleTypes() {
    try {
        const data = await apiFetch('/api/handle-types');
        if (data && data.ok) _handleTypeMap = data.mapping || {};
    } catch(e) {}
}

function getHandleType(name) {
    return _handleTypeMap[name] || 'Dual Handle';
}

async function setHandleType(name, handleType) {
    _handleTypeMap[name] = handleType;
    await apiPost('/api/handle-types', { exercise: name, handleType });
}

// ── Auth ──

async function doLogin() {
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const errorEl = document.getElementById('loginError');
    const btn = document.getElementById('loginBtn');

    errorEl.style.display = 'none';

    if (!email || !password) {
        errorEl.textContent = 'Please enter email and password.';
        errorEl.style.display = 'block';
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Logging in...';

    try {
        const data = await apiPost('/login', { email, password });

        if (data && data.ok) {
            document.getElementById('userEmail').textContent = data.email || email;
            loginView.style.display = 'none';
            workoutView.style.display = 'block';
            loadWorkouts();
            loadPlannedWorkouts();
            await Promise.all([loadMuscleGroups(), loadHandleTypes()]);
            loadExerciseHistory();
        } else if (data) {
            errorEl.textContent = data.error || 'Login failed';
            errorEl.style.display = 'block';
        }
    } catch (e) {
        errorEl.textContent = 'Connection error';
        errorEl.style.display = 'block';
    }

    btn.disabled = false;
    btn.textContent = 'Log In';
}

async function doLogout() {
    await apiPost('/logout', {});
    workoutView.style.display = 'none';
    loginView.style.display = 'block';
    document.getElementById('password').value = '';
    window._workouts = null;
    window._exerciseHistory = null;
    window._exerciseDaily = null;
    document.getElementById('exerciseHistorySection').style.display = 'none';
    document.getElementById('muscleMapContainer').style.display = 'none';
}

// ── Muscle map ──

async function loadMuscleMap() {
    const container = document.getElementById('muscleMapContainer');
    const svgWrap = document.getElementById('muscleMapSvg');
    try {
        const resp = await fetch('/static/muscles.svg');
        const svgText = await resp.text();
        window._muscleSvgText = svgText;
        svgWrap.innerHTML = svgText;
        container.style.display = 'flex';
    } catch (e) {
        container.style.display = 'none';
    }
}

async function loadPlannedWorkouts() {
    const section = document.getElementById('plannedWorkoutsSection');
    if (!section) return;
    try {
        const data = await apiFetch('/api/templates');
        if (!data || !data.ok || !data.templates || data.templates.length === 0) return;

        let html = '<div class="planned-heading">Planned Workouts <a href="#" class="export-link" onclick="exportTemplatesJSON(event)">Export JSON</a></div><div class="planned-grid">';
        for (const t of data.templates) {
            let exList;
            if (t.exercises.length > 0) {
                const muscles = [...new Set(t.exercises.map(e => getMuscleGroup(e)).filter(g => g && g !== 'Other'))];
                exList = muscles.length > 0 ? muscles.map(m => esc(m)).join(', ') : `${t.exercises.length} exercise${t.exercises.length !== 1 ? 's' : ''}`;
            } else {
                exList = `${t.actionNum} exercise${t.actionNum !== 1 ? 's' : ''}`;
            }
            html += `<div class="planned-card" data-template-code="${esc(t.code)}" onclick="openTemplateDetail(this)">`;
            html += `<div class="planned-card-name">${esc(t.name)}</div>`;
            html += `<div class="planned-card-exercises">${exList}</div>`;
            html += '</div>';
        }
        html += '</div>';
        section.innerHTML = html;
    } catch (e) {
        // Silently fail — planned workouts are supplementary
    }
}

function openTemplateDetail(el) {
    const code = el.dataset.templateCode;
    const name = el.querySelector('.planned-card-name').textContent;
    openDetail({ code, name, isFinish: 0 });
}

async function exportTemplatesJSON(e) {
    e.preventDefault();
    const link = e.target;
    const origText = link.textContent;
    link.textContent = 'Exporting...';
    try {
        const data = await apiFetch('/api/templates/export');
        if (!data || !data.ok) {
            link.textContent = 'Error';
            setTimeout(() => link.textContent = origText, 2000);
            return;
        }
        const json = JSON.stringify(data.templates, null, 2);
        await navigator.clipboard.writeText(json);
        link.textContent = 'Copied!';
    } catch (err) {
        link.textContent = 'Failed';
    }
    setTimeout(() => link.textContent = origText, 2000);
}

function computeMuscleFatigue() {
    // Build per-muscle-group fatigue events: {group: {date: contribution}}
    // Primary = 1.0, secondary = secondaryPercent/100
    const muscleEvents = {};
    const exerciseDaily = window._exerciseDaily || {};
    const lastTime = window._exerciseLastTime || {};

    for (const [exName, dateMap] of Object.entries(exerciseDaily)) {
        const primary = getMuscleGroup(exName);
        const secondary = getSecondaryMuscle(exName);
        const secPct = getSecondaryPercent(exName) / 100;

        for (const date of Object.keys(dateMap)) {
            if (!muscleEvents[primary]) muscleEvents[primary] = {};
            muscleEvents[primary][date] = (muscleEvents[primary][date] || 0) + 1.0;

            if (secondary && secondary !== 'None') {
                if (!muscleEvents[secondary]) muscleEvents[secondary] = {};
                muscleEvents[secondary][date] = (muscleEvents[secondary][date] || 0) + secPct;
            }
        }
    }

    const now = new Date();
    const fatigue = {}; // {group: 0..1}

    for (const [group, dateContribs] of Object.entries(muscleEvents)) {
        const dates = Object.keys(dateContribs).sort();
        let currentFatigue = 0;
        let lastMs = null;

        for (const date of dates) {
            const dateMs = new Date(date + 'T12:00:00').getTime();
            if (lastMs !== null) {
                // Decay since last event
                const hoursBetween = (dateMs - lastMs) / 3600000;
                currentFatigue = Math.max(0, currentFatigue - hoursBetween / _recoveryHours);
            }
            // Add new fatigue, cap at 1.0
            currentFatigue = Math.min(1.0, currentFatigue + dateContribs[date]);
            lastMs = dateMs;
        }

        // Decay from last event to now — use best available timestamp for the last date
        if (lastMs !== null) {
            const lastDate = dates[dates.length - 1];
            // Find most precise timestamp for this muscle's last date
            let bestTimestamp = lastDate + 'T12:00:00';
            for (const [exName] of Object.entries(exerciseDaily)) {
                const group2 = getMuscleGroup(exName);
                const sec2 = getSecondaryMuscle(exName);
                if (group2 !== group && sec2 !== group) continue;
                const ft = lastTime[exName];
                if (ft && ft.slice(0, 10) === lastDate && ft > bestTimestamp) {
                    bestTimestamp = ft.replace(' ', 'T');
                }
            }
            const hoursSince = Math.max(0, (now - new Date(bestTimestamp)) / 3600000);
            currentFatigue = Math.max(0, currentFatigue - hoursSince / _recoveryHours);
        }

        fatigue[group] = currentFatigue;
    }

    return fatigue;
}

function updateMuscleMapColors() {
    const container = document.getElementById('muscleMapContainer');
    const paths = container.querySelectorAll('.muscles path[data-muscle]');
    if (!paths.length || !window._exerciseDaily) return;

    const fatigue = computeMuscleFatigue();

    paths.forEach(path => {
        const group = path.dataset.muscle;
        const old = path.querySelector('title');
        if (old) old.remove();

        const f = fatigue[group];
        if (f == null || f <= 0) {
            const t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            t.textContent = `${group}: ${f == null ? 'no data' : 'recovered'}`;
            path.appendChild(t);
            return;
        }

        path.style.fill = muscleFatigueColor(f);

        const pct = Math.round(f * 100);
        const t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        t.textContent = `${group}: ${pct}% fatigued`;
        path.appendChild(t);
    });
}

function muscleFatigueColor(fatigue) {
    // fatigue 1.0 = red (hue 0), 0.0 = green (hue 120)
    const hue = (1 - fatigue) * 120;
    return `hsl(${hue}, 75%, 50%)`;
}

async function renderDetailMuscleMap(exerciseNames) {
    const container = document.getElementById('detailMuscleMap');
    if (!container) return;
    try {
        const resp = await fetch('/static/muscles.svg');
        const svgText = await resp.text();
        container.innerHTML = svgText;

        // Collect muscle groups: track primary vs secondary-only
        const primaryGroups = new Set();
        const secondaryGroups = new Set();
        for (const name of exerciseNames) {
            const group = getMuscleGroup(name);
            if (group && group !== 'Other') primaryGroups.add(group);
            const sec = getSecondaryMuscle(name);
            if (sec && sec !== 'None') secondaryGroups.add(sec);
        }

        // Color muscles: primary = red, secondary-only = orange, others = grey
        const paths = container.querySelectorAll('.muscles path[data-muscle]');
        paths.forEach(path => {
            const group = path.dataset.muscle;
            let label = group;
            if (primaryGroups.has(group)) {
                path.style.fill = 'hsl(0, 75%, 50%)';
                label += ' (primary)';
            } else if (secondaryGroups.has(group)) {
                path.style.fill = 'hsl(30, 85%, 50%)';
                label += ' (secondary)';
            } else {
                path.style.fill = '#555';
            }
            const t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            t.textContent = label;
            path.appendChild(t);
        });

        // Body outline stays default (grey)
        container.style.display = 'flex';
    } catch (e) {
        container.style.display = 'none';
    }
}

// ── Exercise history table ──

function renderExerciseHistoryTable() {
    if (!window._exerciseHistory) return;
    const content = document.getElementById('exerciseHistoryContent');
    const exercises = window._exerciseHistory.slice();

    // Sort by muscle group then exercise name
    exercises.sort((a, b) => {
        const ga = getMuscleGroup(a.name), gb = getMuscleGroup(b.name);
        return ga.localeCompare(gb) || a.name.localeCompare(b.name);
    });

    const maxCols = 20;
    let headerHtml = '<th>Exercise</th><th>Muscle</th><th>Secondary</th>';
    headerHtml += `<th class="history-vol history-span-header" colspan="${maxCols}">Weight History</th>`;

    let bodyHtml = '';
    for (const ex of exercises) {
        const muscle = getMuscleGroup(ex.name);
        const secondary = getSecondaryMuscle(ex.name);
        const secDisplay = secondary && secondary !== 'None' ? secondary : '';
        const isDual = getHandleType(ex.name) === 'Dual Handle';
        bodyHtml += `<tr data-exercise="${esc(ex.name)}">`;
        bodyHtml += `<td>${esc(ex.name)}</td>`;
        bodyHtml += `<td class="muscle-col" data-muscle-cell="${esc(ex.name)}">${esc(muscle)}</td>`;
        bodyHtml += `<td class="muscle-col">${esc(secDisplay)}</td>`;

        const offset = maxCols - ex.history.length;
        let prevWt = null;
        for (let i = 0; i < maxCols; i++) {
            const h = i >= offset ? ex.history[i - offset] : null;
            if (h) {
                let wt = h.max_weight || 0;
                if (isDual) wt = wt / 2;
                wt = Math.round(wt);
                const label = wt.toFixed(0);
                const unit = isDual ? 'kg/hand' : 'kg';
                let cls = 'has-value';
                if (prevWt !== null) {
                    if (wt > prevWt) cls = 'positive';
                    else if (wt < prevWt) cls = 'negative';
                }
                bodyHtml += `<td class="history-vol ${cls}" title="${h.date}: ${label} ${unit}">${label}</td>`;
                prevWt = wt;
            } else {
                bodyHtml += '<td class="history-vol">-</td>';
            }
        }
        bodyHtml += '</tr>';
    }

    content.innerHTML = `
        <div class="history-table-wrap">
            <table class="history-table">
                <thead><tr>${headerHtml}</tr></thead>
                <tbody>${bodyHtml}</tbody>
            </table>
        </div>
    `;

    content.querySelectorAll('.history-table tbody tr').forEach(row => {
        row.addEventListener('click', () => {
            const name = row.dataset.exercise;
            if (name) openExerciseDetail(name);
        });
    });
}

async function loadExerciseHistory() {
    const section = document.getElementById('exerciseHistorySection');
    const content = document.getElementById('exerciseHistoryContent');
    section.style.display = 'block';
    content.innerHTML = '<div class="spinner">Loading exercise history...</div>';
    loadMuscleMap();

    try {
        const data = await apiFetch('/api/exercise-history');

        if (!data) return; // 401 handled by apiFetch
        if (!data.ok) {
            content.innerHTML = '<div class="empty">Could not load exercise history</div>';
            return;
        }

        if (!data.exercises || data.exercises.length === 0) {
            content.innerHTML = '<div class="empty">No completed workout data yet</div>';
            return;
        }

        window._exerciseHistory = data.exercises;
        window._exerciseDaily = data.exercise_daily || {};
        window._exerciseLastTime = data.exercise_last_time || {};
        renderExerciseHistoryTable();
        renderDailyVolumeChart(data.daily_volume || []);
        renderMuscleGroupCharts();
        updateMuscleMapColors();
    } catch (e) {
        content.innerHTML = '<div class="empty">Connection error loading history</div>';
    }
}

// ── View navigation ──

function showWorkoutList() {
    detailView.style.display = 'none';
    historyView.style.display = 'none';
    workoutView.style.display = 'block';
    renderExerciseHistoryTable();
    renderMuscleGroupCharts();
}
