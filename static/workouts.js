/* workouts.js — Workout list, detail views, exercise rendering */

async function loadWorkouts() {
    const list = document.getElementById('workoutList');
    list.innerHTML = '<div class="spinner">Loading workouts...</div>';

    try {
        const data = await apiFetch('/api/workouts');

        if (!data) return; // 401 handled by apiFetch
        if (!data.ok) {
            list.innerHTML = '<div class="empty">Error loading workouts</div>';
            return;
        }

        if (!data.workouts || data.workouts.length === 0) {
            list.innerHTML = '<div class="empty">No workouts found in the last 3 months</div>';
            return;
        }

        window._workouts = data.workouts;

        // Group workouts by date
        const groups = [];
        const groupMap = {};
        for (let i = 0; i < data.workouts.length; i++) {
            const w = data.workouts[i];
            const dateKey = w.date || 'unknown';
            if (!groupMap[dateKey]) {
                groupMap[dateKey] = { date: dateKey, workouts: [] };
                groups.push(groupMap[dateKey]);
            }
            groupMap[dateKey].workouts.push({ ...w, _idx: i });
        }

        list.innerHTML = groups.map(g => {
            const totalVol = g.workouts.reduce((sum, w) => sum + (w.totalCapacity || 0), 0);
            const volLabel = totalVol > 0 ? `${totalVol.toFixed(1)} kg` : '';

            const items = g.workouts.map(w => {
                const statusLabel = w.isFinish === 1 ? 'Completed' : 'Scheduled';
                const mins = w.durationMinute ? `${w.durationMinute} min` : '';
                const cals = w.calorie ? `${w.calorie} kcal` : '';
                const meta = [mins, cals].filter(Boolean).join(' \u00b7 ');
                return `
                    <div class="workout-item" data-idx="${w._idx}">
                        <div>
                            <div class="workout-name">${esc(w.name)}</div>
                            <span class="workout-status">${statusLabel}</span>
                            ${meta ? `<span style="color:var(--text-muted); font-size:0.75rem; margin-left:0.5rem">${meta}</span>` : ''}
                        </div>
                    </div>
                `;
            }).join('');

            return `
                <div class="day-group">
                    <div class="day-group-header">
                        <span class="day-group-date">${formatDate(g.date)}</span>
                        ${volLabel ? `<span class="day-group-volume">${volLabel}</span>` : ''}
                    </div>
                    ${items}
                </div>
            `;
        }).join('');

        list.querySelectorAll('.workout-item').forEach(el => {
            el.addEventListener('click', () => {
                const w = window._workouts[el.dataset.idx];
                openDetail(w);
            });
        });
    } catch (e) {
        list.innerHTML = '<div class="empty">Connection error</div>';
    }
}

async function openDetail(w) {
    workoutView.style.display = 'none';
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

        if (exercises.length === 0) {
            html += '<div class="empty">No exercises found in this workout.</div>';
        } else {
            html += exercises.map(ex => renderExercise(ex)).join('');
        }

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

function renderExercise(ex) {
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
        if (counters[i] && counters[i] !== '0') {
            weightLabel = `RM ${counters[i]}`;
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
            <td style="${isDual ? 'color:var(--text-muted)' : 'font-weight:600'}">${weightLabel}</td>
            <td style="font-weight:600">${isDual ? perHandleLabel : '-'}</td>
            <td>${mode}</td>
            <td>${rest}</td>
        </tr>`;
    }

    return `
        <div class="exercise-card">
            <div class="exercise-name">${esc(name)}</div>
            <table class="sets-table">
                <thead><tr>
                    <th>Set</th><th>Reps</th><th>Total Weight</th><th>Per Handle</th><th>Mode</th><th>Rest</th>
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
