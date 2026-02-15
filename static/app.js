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
    return _muscleGroupMap[name] || 'Other';
}

async function setMuscleGroup(name, group) {
    _muscleGroupMap[name] = group;
    await apiPost('/api/muscle-groups', { exercise: name, group });
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
            const exList = t.exercises.length > 0
                ? t.exercises.map(e => esc(e)).join(', ')
                : `${t.actionNum} exercise${t.actionNum !== 1 ? 's' : ''}`;
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

function updateMuscleMapColors() {
    const container = document.getElementById('muscleMapContainer');
    const paths = container.querySelectorAll('.muscles path[data-muscle]');
    if (!paths.length || !window._exerciseDaily) return;

    // Find most recent finish time per muscle group (hour-level precision)
    const lastWorked = {};
    const now = new Date();
    const lastTime = window._exerciseLastTime || {};

    for (const [exName, dates] of Object.entries(window._exerciseDaily)) {
        const group = getMuscleGroup(exName);
        const ft = lastTime[exName];
        // Use finishTime if available, otherwise fall back to latest date
        const best = ft || Object.keys(dates).sort().pop();
        if (best && (!lastWorked[group] || best > lastWorked[group])) {
            lastWorked[group] = best;
        }
    }

    // Color each path based on hours since last worked, add tooltip
    paths.forEach(path => {
        const group = path.dataset.muscle;
        const old = path.querySelector('title');
        if (old) old.remove();

        if (!lastWorked[group]) {
            const t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            t.textContent = `${group}: no data`;
            path.appendChild(t);
            return;
        }
        const last = new Date(lastWorked[group].replace(' ', 'T'));
        const hours = Math.max(0, (now - last) / 3600000);
        path.style.fill = muscleFatigueColor(hours);

        const t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        if (hours < 1) t.textContent = `${group}: just now`;
        else if (hours < 24) t.textContent = `${group}: ${Math.floor(hours)}h ago`;
        else {
            const days = Math.floor(hours / 24);
            t.textContent = `${group}: ${days} day${days !== 1 ? 's' : ''} ago`;
        }
        path.appendChild(t);
    });
}

function muscleFatigueColor(hours) {
    // 0 hours = red (hue 0), _recoveryHours+ = green (hue 120)
    const t = Math.min(hours, _recoveryHours) / _recoveryHours; // 0..1
    const hue = t * 120;
    return `hsl(${hue}, 75%, 50%)`;
}

async function renderDetailMuscleMap(exerciseNames) {
    const container = document.getElementById('detailMuscleMap');
    if (!container) return;
    try {
        const resp = await fetch('/static/muscles.svg');
        const svgText = await resp.text();
        container.innerHTML = svgText;

        // Collect muscle groups used by exercises in this workout
        const workedGroups = new Set();
        for (const name of exerciseNames) {
            const group = getMuscleGroup(name);
            if (group && group !== 'Other') workedGroups.add(group);
        }

        // Color muscles: worked = red, others = light grey
        const paths = container.querySelectorAll('.muscles path[data-muscle]');
        paths.forEach(path => {
            const group = path.dataset.muscle;
            if (workedGroups.has(group)) {
                path.style.fill = 'hsl(0, 75%, 50%)';
            } else {
                path.style.fill = '#555';
            }
            const t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            t.textContent = group + (workedGroups.has(group) ? ' (targeted)' : '');
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
    let headerHtml = '<th>Exercise</th><th>Muscle</th>';
    for (let i = 0; i < maxCols; i++) {
        headerHtml += `<th class="history-vol">${i + 1}</th>`;
    }

    let bodyHtml = '';
    for (const ex of exercises) {
        const muscle = getMuscleGroup(ex.name);
        const isDual = getHandleType(ex.name) === 'Dual Handle';
        bodyHtml += `<tr data-exercise="${esc(ex.name)}">`;
        bodyHtml += `<td>${esc(ex.name)}</td>`;
        bodyHtml += `<td class="muscle-col" data-muscle-cell="${esc(ex.name)}">${esc(muscle)}</td>`;

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
    workoutView.style.display = 'block';
    renderExerciseHistoryTable();
    renderMuscleGroupCharts();
}
