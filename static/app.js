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

// ── Constants ──

const MUSCLE_GROUPS = ['Abs','Back','Biceps','Calves','Chest','Delts','Forearms','Glutes','Hamstrings','Quads','Traps','Triceps','Other'];
const HANDLE_TYPES = ['Dual Handle', 'Single Weight'];

// ── Muscle group mappings ──

let _muscleGroupMap = {};

async function loadMuscleGroups() {
    try {
        const resp = await fetch('/api/muscle-groups');
        const data = await resp.json();
        if (data.ok) _muscleGroupMap = data.mapping || {};
    } catch(e) {}
}

function getMuscleGroup(name) {
    return _muscleGroupMap[name] || 'Other';
}

async function setMuscleGroup(name, group) {
    _muscleGroupMap[name] = group;
    await fetch('/api/muscle-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exercise: name, group })
    });
}

// ── Handle type mappings ──

let _handleTypeMap = {};

async function loadHandleTypes() {
    try {
        const resp = await fetch('/api/handle-types');
        const data = await resp.json();
        if (data.ok) _handleTypeMap = data.mapping || {};
    } catch(e) {}
}

function getHandleType(name) {
    return _handleTypeMap[name] || 'Dual Handle';
}

async function setHandleType(name, handleType) {
    _handleTypeMap[name] = handleType;
    await fetch('/api/handle-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exercise: name, handleType })
    });
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
        const resp = await fetch('/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
        });
        const data = await resp.json();

        if (data.ok) {
            loginView.style.display = 'none';
            workoutView.style.display = 'block';
            loadWorkouts();
            loadPlannedWorkouts();
            await Promise.all([loadMuscleGroups(), loadHandleTypes()]);
            loadExerciseHistory();
        } else {
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
    await fetch('/logout', { method: 'POST' });
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
        const resp = await fetch('/api/templates');
        const data = await resp.json();
        if (!data.ok || !data.templates || data.templates.length === 0) return;

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
        const resp = await fetch('/api/templates/export');
        const data = await resp.json();
        if (!data.ok) {
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

    // Find most recent exercise date per muscle group
    const lastWorked = {};
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const [exName, dates] of Object.entries(window._exerciseDaily)) {
        const group = getMuscleGroup(exName);
        for (const dateStr of Object.keys(dates)) {
            if (!lastWorked[group] || dateStr > lastWorked[group]) {
                lastWorked[group] = dateStr;
            }
        }
    }

    // Color each path based on days since last worked, add tooltip
    paths.forEach(path => {
        const group = path.dataset.muscle;
        // Remove any existing tooltip
        const old = path.querySelector('title');
        if (old) old.remove();

        if (!lastWorked[group]) {
            const t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            t.textContent = `${group}: no data`;
            path.appendChild(t);
            return;
        }
        const last = new Date(lastWorked[group]);
        last.setHours(0, 0, 0, 0);
        const days = Math.floor((today - last) / 86400000);
        path.style.fill = muscleFatigueColor(days);

        const t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        t.textContent = days === 0 ? `${group}: today` : `${group}: ${days} day${days !== 1 ? 's' : ''} ago`;
        path.appendChild(t);
    });
}

function muscleFatigueColor(days) {
    // 0 days = red (hue 0), 4+ days = green (hue 120)
    const t = Math.min(days, 4) / 4; // 0..1
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
        const resp = await fetch('/api/exercise-history');
        const data = await resp.json();

        if (!data.ok) {
            if (resp.status === 401) return;
            content.innerHTML = '<div class="empty">Could not load exercise history</div>';
            return;
        }

        if (!data.exercises || data.exercises.length === 0) {
            content.innerHTML = '<div class="empty">No completed workout data yet</div>';
            return;
        }

        window._exerciseHistory = data.exercises;
        window._exerciseDaily = data.exercise_daily || {};
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
