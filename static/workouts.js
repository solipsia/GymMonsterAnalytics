/* workouts.js — Workout list, detail views, exercise rendering */

function _buildWorkoutGroups(workouts) {
    const groups = [];
    const groupMap = {};
    for (let i = 0; i < workouts.length; i++) {
        const w = workouts[i];
        const dateKey = w.date || 'unknown';
        if (!groupMap[dateKey]) {
            groupMap[dateKey] = { date: dateKey, workouts: [] };
            groups.push(groupMap[dateKey]);
        }
        groupMap[dateKey].workouts.push({ ...w, _idx: i });
    }
    return groups;
}

function _renderWorkoutItem(w) {
    const statusLabel = w.isFinish === 1 ? 'Completed' : 'Scheduled';
    const mins = w.durationMinute ? `${w.durationMinute} min` : '';
    const cals = w.calorie ? `${w.calorie} kcal` : '';
    const meta = [mins, cals].filter(Boolean).join(' \u00b7 ');
    const volumeBars = _renderVolumeBars(w);
    return `
        <div class="workout-item" data-idx="${w._idx}" data-code="${esc(w.code || '')}">
            <div style="flex:1;min-width:0;">
                <div class="workout-name">${esc(w.name)}</div>
                <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
                    <span class="workout-status">${statusLabel}</span>
                    ${meta ? `<span style="color:var(--text-muted); font-size:0.75rem">${meta}</span>` : ''}
                </div>
                ${volumeBars}
            </div>
        </div>
    `;
}

function _renderVolumeBars(w) {
    const planned = window._templatePlannedVolume && window._templatePlannedVolume[w.code];
    if (!planned || planned <= 0) return '';
    const actual = w.totalCapacity || 0;
    const maxVal = Math.max(planned, actual);
    if (maxVal <= 0) return '';
    const plannedPct = (planned / maxVal) * 100;
    const actualPct = (actual / maxVal) * 100;
    const ratio = actual > 0 ? Math.round((actual / planned) * 100) : 0;
    const ratioColor = ratio >= 100 ? 'var(--success)' : ratio >= 80 ? 'var(--accent)' : 'var(--text-muted)';
    return `
        <div class="volume-bars" title="Actual: ${actual.toFixed(0)} kg / Planned: ${planned.toFixed(0)} kg">
            <div class="volume-bar-track">
                <div class="volume-bar-planned" style="width:${plannedPct}%"></div>
                <div class="volume-bar-actual" style="width:${actualPct}%"></div>
            </div>
            <span class="volume-bar-label" style="color:${ratioColor}">${actual > 0 ? ratio + '%' : 'planned'}</span>
        </div>
    `;
}

function _updateVolumeBars() {
    // Re-render volume bars on existing workout items after planned data loads
    if (!window._workouts) return;
    document.querySelectorAll('.workout-item[data-code]').forEach(el => {
        const code = el.dataset.code;
        const idx = parseInt(el.dataset.idx);
        if (!code || isNaN(idx)) return;
        const w = window._workouts[idx];
        if (!w) return;
        const existing = el.querySelector('.volume-bars');
        const newBars = _renderVolumeBars(w);
        if (newBars && !existing) {
            const container = el.querySelector('div');
            if (container) container.insertAdjacentHTML('beforeend', newBars);
        }
    });
}

function _renderDayGroup(g) {
    const totalVol = g.workouts.reduce((sum, w) => sum + (w.totalCapacity || 0), 0);
    const volLabel = totalVol > 0 ? `${totalVol.toFixed(1)} kg` : '';
    const items = g.workouts.map(w => _renderWorkoutItem(w)).join('');
    return `
        <div class="day-group">
            <div class="day-group-header">
                <span class="day-group-date">${formatDate(g.date)}</span>
                ${volLabel ? `<span class="day-group-volume">${volLabel}</span>` : ''}
            </div>
            ${items}
        </div>
    `;
}

function _wireWorkoutClicks(container) {
    container.querySelectorAll('.workout-item').forEach(el => {
        el.addEventListener('click', () => {
            const w = window._workouts[el.dataset.idx];
            openDetail(w);
        });
    });
}

async function loadWorkouts() {
    const recentSection = document.getElementById('recentWorkoutsSection');
    const recentContent = document.getElementById('recentWorkoutsContent');
    recentContent.innerHTML = '<div class="spinner">Loading workouts...</div>';
    recentSection.style.display = 'block';

    try {
        const data = await apiFetch('/api/workouts');

        if (!data) return;
        if (!data.ok) {
            recentContent.innerHTML = '<div class="empty">Error loading workouts</div>';
            return;
        }

        if (!data.workouts || data.workouts.length === 0) {
            recentContent.innerHTML = '<div class="empty">No workouts found in the last 3 months</div>';
            return;
        }

        window._workouts = data.workouts;
        window._workoutGroups = _buildWorkoutGroups(data.workouts);

        // Render only the most recent day on the home page
        const recentGroup = window._workoutGroups[0];
        const totalVol = recentGroup.workouts.reduce((sum, w) => sum + (w.totalCapacity || 0), 0);
        const volLabel = totalVol > 0 ? `${totalVol.toFixed(1)} kg` : '';
        const items = recentGroup.workouts.map(w => _renderWorkoutItem(w)).join('');

        recentContent.innerHTML = `
            <div class="day-group">
                <div class="day-group-header">
                    <span class="day-group-date">${formatDate(recentGroup.date)}</span>
                    ${volLabel ? `<span class="day-group-volume">${volLabel}</span>` : ''}
                </div>
                <div class="recent-workouts-grid">${items}</div>
            </div>
            <button class="history-link-btn" onclick="showFullHistory()">Exercise History</button>
        `;
        _wireWorkoutClicks(recentContent);
    } catch (e) {
        recentContent.innerHTML = '<div class="empty">Connection error</div>';
    }
}

function showFullHistory() {
    workoutView.style.display = 'none';
    historyView.style.display = 'block';

    const list = document.getElementById('workoutList');
    if (!window._workoutGroups) return;

    list.innerHTML = window._workoutGroups.map(g => _renderDayGroup(g)).join('');
    _wireWorkoutClicks(list);
}

async function openDetail(w) {
    workoutView.style.display = 'none';
    historyView.style.display = 'none';
    detailView.style.display = 'block';
    const content = document.getElementById('detailContent');
    content.innerHTML = '<div class="spinner">Loading workout details...</div>';

    // For completed workouts with a trainingId, fetch actual performance data
    if (w.isFinish === 1 && w.trainingId) {
        try {
            const data = await apiFetch(`/api/training/${w.trainingId}`);
            if (data && data.ok && data.training) {
                renderTrainingDetail(content, data.training, w);
                return;
            }
        } catch (e) {
            // Fall through to template view
        }
    }

    // Fall back to template view
    if (!w.code) {
        content.innerHTML = `
            <div class="detail-title">${esc(w.name)}</div>
            <div class="detail-date">${formatDate(w.date)}</div>
            <div class="empty">No template code — this may be an official Speediance program.<br>Detail view is only available for custom workouts.</div>
        `;
        return;
    }

    try {
        const data = await apiFetch(`/api/workout/${encodeURIComponent(w.code)}`);

        if (!data || !data.ok || !data.detail) {
            content.innerHTML = `
                <div class="detail-title">${esc(w.name)}</div>
                <div class="detail-date">${formatDate(w.date)}</div>
                <div class="empty">Details not available for this workout type.<br><small>Code: ${esc(w.code)}</small></div>
            `;
            return;
        }

        const detail = data.detail;
        window._editingTemplate = JSON.parse(JSON.stringify(detail));
        const exercises = detail.actionLibraryList || [];
        const exerciseNames = exercises.map(ex => ex.title || ex.name || ex.groupName || '').filter(Boolean);

        let html = `
            <div class="detail-title">${esc(detail.name || w.name)}</div>
            <div class="detail-date">${formatDate(w.date)}</div>
            <div class="detail-header-row">
                <div id="detailMuscleMap" class="detail-muscle-map"></div>
                <div id="detailVolumeChart" class="detail-volume-chart"></div>
            </div>
            <div style="color:var(--text-muted); font-size:0.75rem; margin-bottom:1rem;">Showing planned template (no performance data available)</div>
        `;

        // Muscle volume summary table
        html += buildMuscleVolumeSummary(exercises);

        if (exercises.length === 0) {
            html += '<div class="empty">No exercises found in this workout.</div>';
        } else {
            html += '<div class="section-heading" style="margin-top:0.5rem;">Exercises</div>';
            html += exercises.map((ex, idx) => renderExercise(ex, idx)).join('');
        }

        html += `
            <div id="saveSection" style="margin-top:1rem; display:flex; align-items:center; gap:1rem;">
                <button id="saveTemplateBtn" onclick="saveTemplateWeights()" disabled
                        style="width:auto; padding:0.6rem 1.5rem; font-size:0.9rem;">
                    Save Weights
                </button>
                <span id="saveStatus" style="font-size:0.85rem;"></span>
            </div>
        `;

        content.innerHTML = html;
        renderDetailMuscleMap(exerciseNames);
        renderWorkoutVolumeChart(w.code);
    } catch (e) {
        content.innerHTML = `<div class="empty">Connection error: ${esc(e.message)}</div>`;
    }
}

function renderTrainingDetail(container, training, w) {
    const title = training.title || training.name || w.name;
    const exercises = training.cttActionLibraryTrainingInfoList
        || training.actionLibraryTrainingInfoList
        || training.actionList
        || [];

    // Summary stats
    const duration = training.durationMinute || w.durationMinute || 0;
    const calories = training.calorie || training.calories || w.calorie || 0;

    // Render exercises first to compute total volume from corrected values
    let exercisesHtml = '';
    let totalVolume = 0;
    if (exercises.length === 0) {
        exercisesHtml = '<div class="empty">No exercise data found.</div>';
    } else {
        exercises.forEach(ex => {
            const result = renderTrainingExercise(ex, w.date);
            exercisesHtml += result.html;
            totalVolume += result.totalVolume;
        });
    }

    let statsHtml = '';
    const stats = [];
    if (duration) stats.push(`${duration} min`);
    if (calories) stats.push(`${calories} kcal`);
    if (totalVolume) stats.push(`${totalVolume.toFixed(1)} kg total volume`);
    if (stats.length) {
        statsHtml = `<div style="color:var(--accent); font-size:0.85rem; margin-bottom:1rem;">${stats.join(' · ')}</div>`;
    }

    container.innerHTML = `
        <div class="detail-title">${esc(title)}</div>
        <div class="detail-date">${formatDate(w.date)}</div>
        ${statsHtml}
        ${exercisesHtml}
    `;
}

function renderTrainingExercise(ex, workoutDate) {
    const name = ex.actionLibraryName || ex.name || ex.title || 'Exercise';
    const sets = ex.finishedReps || ex.sets || [];
    const isDual = getHandleType(name) === 'Dual Handle';

    if (sets.length === 0) {
        return {
            html: `
                <div class="exercise-card">
                    <div class="exercise-name">${esc(name)}</div>
                    <div style="color:var(--text-muted); font-size:0.85rem;">No set data</div>
                </div>
            `,
            totalVolume: 0
        };
    }

    let rows = '';
    let exerciseVolume = 0;
    for (let i = 0; i < sets.length; i++) {
        const s = sets[i];
        const reps = s.finishedCount || s.reps || s.count || '-';
        const target = s.targetCount || s.target || '';
        const repLabel = target ? `${reps} / ${target}` : `${reps}`;

        // Volume: use raw capacity (no /1000 division)
        const cap = s.capacity || s.totalCapacity;
        const vol = cap ? parseFloat(cap) : 0;
        const volLabel = vol ? `${vol.toFixed(1)} kg` : '-';
        exerciseVolume += vol;

        // Weight = volume / reps
        let weightLabel = '-';
        let perHandleLabel = '';
        const repsNum = parseFloat(reps);
        if (vol > 0 && repsNum > 0) {
            const totalWeight = vol / repsNum;
            weightLabel = `${totalWeight.toFixed(1)} kg`;
            if (isDual) {
                perHandleLabel = `${(totalWeight / 2).toFixed(1)} kg`;
            }
        }

        rows += `<tr>
            <td>${i + 1}</td>
            <td>${repLabel}</td>
            <td style="${isDual ? 'color:var(--text-muted)' : 'font-weight:600'}">${weightLabel}</td>
            <td style="font-weight:600">${isDual ? perHandleLabel : '-'}</td>
            <td>${volLabel}</td>
        </tr>`;
    }

    const barChartHtml = renderExerciseBarChart(name, workoutDate);

    return {
        html: `
            <div class="exercise-card">
                <div class="exercise-name">${esc(name)}</div>
                <div style="color:var(--accent); font-size:0.85rem; margin-bottom:0.5rem;">Volume: ${exerciseVolume.toFixed(1)} kg</div>
                <table class="sets-table">
                    <thead><tr>
                        <th>Set</th><th>Reps</th><th>Total Weight</th><th>Per Handle</th><th>Volume</th>
                    </tr></thead>
                    <tbody>${rows}</tbody>
                </table>
                ${barChartHtml}
            </div>
        `,
        totalVolume: exerciseVolume
    };
}

function renderExercise(ex, exIdx) {
    const name = ex.title || ex.name || ex.groupName || 'Exercise';
    const reps = str(ex.setsAndReps).split(',').filter(Boolean);
    const weights = str(ex.weights).split(',').filter(Boolean);
    const breakTimes = str(ex.breakTime2 || ex.breakTime).split(',').filter(Boolean);
    const modes = str(ex.sportMode).split(',').filter(Boolean);
    const counters = str(ex.counterweight2 || ex.counterweight).split(',').filter(Boolean);
    const countTypes = str(ex.countType).split(',').filter(Boolean);
    const leftRight = str(ex.leftRight).split(',').filter(Boolean);
    const numSets = reps.length;
    const isDual = getHandleType(name) === 'Dual Handle';
    const editable = exIdx !== undefined;

    const modeNames = { '1': 'Standard', '2': 'Eccentric', '3': 'Eccentric', '4': 'Chain' };

    let rows = '';
    for (let i = 0; i < numSets; i++) {
        const repVal = reps[i] || '-';
        const isTime = countTypes[i] === '2';
        const repLabel = isTime ? `${repVal}s` : `${repVal} reps`;

        // Weight: prefer counterweight (preset RM), else use kg value
        // API weights field stores per-handle weight, so total = value * 2 for dual handle
        let weightLabel = '-';
        let perHandleLabel = '';
        const isRM = counters[i] && counters[i] !== '0';

        if (isRM) {
            weightLabel = `RM ${counters[i]}`;
        } else if (editable) {
            // Editable mode: show input for the bold (primary) weight field
            const rawVal = parseFloat(weights[i]) || 0;
            const inputVal = rawVal > 0 ? rawVal.toFixed(1) : '';
            const inputHtml = `<input type="number" class="weight-input" value="${inputVal}" min="0" step="0.5" data-ex="${exIdx}" data-set="${i}" oninput="onWeightInput(this,${exIdx},${i},${isDual})" placeholder="0">`;
            if (isDual) {
                const totalDisplay = rawVal > 0 ? `${(rawVal * 2).toFixed(1)} kg` : '-';
                weightLabel = `<span id="calc-total-${exIdx}-${i}" style="color:var(--text-muted)">${totalDisplay}</span>`;
                perHandleLabel = `${inputHtml} kg`;
            } else {
                weightLabel = `${inputHtml} kg`;
            }
        } else if (weights[i] && weights[i] !== '0') {
            const perHandle = parseFloat(weights[i]);
            if (isDual) {
                weightLabel = `${(perHandle * 2).toFixed(1)} kg`;
                perHandleLabel = `${perHandle.toFixed(1)} kg`;
            } else {
                weightLabel = `${perHandle.toFixed(1)} kg`;
            }
        }

        const rest = breakTimes[i] ? `${breakTimes[i]}s` : '-';
        const mode = modeNames[modes[i]] || modes[i] || '-';
        const side = leftRight[i] === '1' ? ' (L)' : leftRight[i] === '2' ? ' (R)' : '';

        rows += `<tr>
            <td>${i + 1}${side}</td>
            <td>${repLabel}</td>
            <td style="${isDual && !isRM ? 'color:var(--text-muted)' : (!isRM && !editable ? 'font-weight:600' : '')}">${weightLabel}</td>
            <td style="${!isRM && !editable && isDual ? 'font-weight:600' : ''}">${isDual ? (perHandleLabel || '-') : '-'}</td>
            <td>${mode}</td>
            <td>${rest}</td>
        </tr>`;
    }

    // Muscle group labels
    const primary = getMuscleGroup(name);
    const secondary = getSecondaryMuscle(name);
    const secPct = getSecondaryPercent(name);
    let muscleLabel = primary;
    if (secondary && secondary !== 'None') {
        muscleLabel += `, ${secondary} ${secPct}%`;
    }

    return `
        <div class="exercise-card">
            <div class="exercise-name">${esc(name)} <span style="color:var(--text-muted); font-weight:400; font-size:0.85rem">(${esc(muscleLabel)})</span></div>
            <table class="sets-table">
                <thead><tr>
                    <th>Set</th><th>Reps</th><th>Total Weight</th><th>Per Handle</th><th>Mode</th><th>Rest</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    `;
}

function onWeightInput(input, exIdx, setIdx, isDual) {
    const val = parseFloat(input.value) || 0;
    if (isDual) {
        const totalSpan = document.getElementById(`calc-total-${exIdx}-${setIdx}`);
        if (totalSpan) {
            totalSpan.textContent = val > 0 ? `${(val * 2).toFixed(1)} kg` : '-';
        }
    }
    const saveBtn = document.getElementById('saveTemplateBtn');
    if (saveBtn) saveBtn.disabled = false;
}

async function saveTemplateWeights() {
    const btn = document.getElementById('saveTemplateBtn');
    const status = document.getElementById('saveStatus');
    const template = window._editingTemplate;

    if (!template || !template.id) {
        status.textContent = 'Error: no template loaded (missing id)';
        status.style.color = 'var(--error-text, #f87171)';
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Saving...';
    status.textContent = '';

    // Collect all weight inputs and validate
    const inputs = document.querySelectorAll('.weight-input');
    const exercises = template.actionLibraryList || [];
    const changes = {};

    for (const input of inputs) {
        const exIdx = parseInt(input.dataset.ex);
        const setIdx = parseInt(input.dataset.set);
        const val = input.value === '' ? 0 : parseFloat(input.value);

        if (isNaN(val) || val < 0) {
            status.textContent = `Invalid weight in exercise ${exIdx + 1}, set ${setIdx + 1}`;
            status.style.color = 'var(--error-text, #f87171)';
            btn.disabled = false;
            btn.textContent = 'Save Weights';
            return;
        }

        if (!changes[exIdx]) changes[exIdx] = {};
        changes[exIdx][setIdx] = val;
    }

    // Apply changes to template weights CSVs
    for (const [exIdxStr, sets] of Object.entries(changes)) {
        const exIdx = parseInt(exIdxStr);
        const ex = exercises[exIdx];
        if (!ex) continue;
        const currentWeights = str(ex.weights).split(',');
        for (const [setIdxStr, val] of Object.entries(sets)) {
            const setIdx = parseInt(setIdxStr);
            while (currentWeights.length <= setIdx) currentWeights.push('0');
            currentWeights[setIdx] = val.toString();
        }
        ex.weights = currentWeights.join(',');
    }

    // POST to backend
    const data = await apiPost('/api/workout/save', template);
    if (!data) return; // 401 handled by apiPost

    if (data.ok) {
        status.textContent = 'Saved successfully';
        status.style.color = 'var(--success)';
        btn.textContent = 'Save Weights';

        // Update muscle volume summary in-place
        const summaryEl = document.querySelector('.muscle-volume-summary');
        if (summaryEl) {
            const newSummary = buildMuscleVolumeSummary(exercises);
            if (newSummary) {
                summaryEl.outerHTML = newSummary;
            }
        }
    } else {
        status.textContent = data.error || 'Save failed';
        status.style.color = 'var(--error-text, #f87171)';
        btn.disabled = false;
        btn.textContent = 'Save Weights';
    }
}

function buildMuscleVolumeSummary(exercises) {
    // Calculate planned volume per exercise, then distribute to muscle groups
    const muscleVolumes = {}; // { group: { primary: N, secondary: N } }

    for (const ex of exercises) {
        const name = ex.title || ex.name || ex.groupName || '';
        if (!name) continue;

        const reps = str(ex.setsAndReps).split(',').filter(Boolean);
        const weights = str(ex.weights).split(',').filter(Boolean);
        const counters = str(ex.counterweight2 || ex.counterweight).split(',').filter(Boolean);
        const isDual = getHandleType(name) === 'Dual Handle';

        let exerciseVolume = 0;
        for (let i = 0; i < reps.length; i++) {
            const repVal = parseFloat(reps[i]) || 0;
            // Skip if using RM (counterweight) — no real weight to calculate volume from
            if (counters[i] && counters[i] !== '0') continue;
            const wVal = parseFloat(weights[i]) || 0;
            const totalWeight = isDual ? wVal * 2 : wVal;
            exerciseVolume += repVal * totalWeight;
        }

        if (exerciseVolume <= 0) continue;

        const primary = getMuscleGroup(name);
        const secondary = getSecondaryMuscle(name);
        const secPct = getSecondaryPercent(name) / 100;

        // Primary contribution
        if (!muscleVolumes[primary]) muscleVolumes[primary] = { primary: 0, secondary: 0 };
        muscleVolumes[primary].primary += exerciseVolume;

        // Secondary contribution (scaled)
        if (secondary && secondary !== 'None') {
            if (!muscleVolumes[secondary]) muscleVolumes[secondary] = { primary: 0, secondary: 0 };
            muscleVolumes[secondary].secondary += exerciseVolume * secPct;
        }
    }

    const groups = Object.keys(muscleVolumes).sort((a, b) => {
        const totalA = muscleVolumes[a].primary + muscleVolumes[a].secondary;
        const totalB = muscleVolumes[b].primary + muscleVolumes[b].secondary;
        return totalB - totalA;
    });

    if (groups.length === 0) return '';

    let rows = '';
    let totalPrimary = 0, totalSecondary = 0;
    for (const g of groups) {
        const p = muscleVolumes[g].primary;
        const s = muscleVolumes[g].secondary;
        const total = p + s;
        totalPrimary += p;
        totalSecondary += s;
        rows += `<tr>
            <td style="font-weight:500">${esc(g)}</td>
            <td style="text-align:right">${p > 0 ? p.toFixed(1) : '-'}</td>
            <td style="text-align:right">${s > 0 ? s.toFixed(1) : '-'}</td>
            <td style="text-align:right; font-weight:600">${total.toFixed(1)}</td>
        </tr>`;
    }

    const grandTotal = totalPrimary + totalSecondary;
    rows += `<tr style="border-top:2px solid var(--border)">
        <td style="font-weight:600; color:var(--accent)">Total</td>
        <td style="text-align:right; font-weight:600; color:var(--accent)">${totalPrimary.toFixed(1)}</td>
        <td style="text-align:right; font-weight:600; color:var(--accent)">${totalSecondary.toFixed(1)}</td>
        <td style="text-align:right; font-weight:600; color:var(--accent)">${grandTotal.toFixed(1)}</td>
    </tr>`;

    return `
        <div class="muscle-volume-summary">
            <div class="section-heading" style="font-size:1rem; margin-bottom:0.5rem;">Muscle Volume (kg)</div>
            <table class="sets-table">
                <thead><tr>
                    <th>Muscle Group</th>
                    <th style="text-align:right">Primary</th>
                    <th style="text-align:right">Secondary</th>
                    <th style="text-align:right">Total Effective</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    `;
}

function openExerciseDetail(exerciseName) {
    if (!window._exerciseHistory) return;
    const ex = window._exerciseHistory.find(e => e.name === exerciseName);
    if (!ex) return;

    workoutView.style.display = 'none';
    detailView.style.display = 'block';
    const content = document.getElementById('detailContent');

    const sessions = ex.all_history || ex.history;
    const maxWeight = ex.max_weight || 0;

    // Bar chart
    const maxVol = Math.max(...sessions.map(s => s.volume));
    const barsHtml = sessions.map(s => {
        const pct = Math.max(4, (s.volume / maxVol) * 100);
        return `<div class="chart-bar" style="height:${pct}%">
            <div class="chart-tooltip">${formatDate(s.date)}<br>${s.volume.toFixed(0)} kg</div>
        </div>`;
    }).join('');

    content.innerHTML = `
        <div class="detail-title">${esc(exerciseName)}</div>
        <div class="exercise-stats">
            <div class="exercise-stat">
                <div class="exercise-stat-value">${ex.count}</div>
                <div class="exercise-stat-label">Sessions</div>
            </div>
            <div class="exercise-stat">
                <div class="exercise-stat-value">${maxWeight > 0 ? maxWeight.toFixed(1) + ' kg' : '-'}</div>
                <div class="exercise-stat-label">Max Weight</div>
            </div>
        </div>
        <div class="section-heading">Volume per Session</div>
        <div class="chart chart-lg">${barsHtml}</div>
    `;
}
