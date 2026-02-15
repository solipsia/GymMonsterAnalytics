/* charts.js — Chart rendering (rolling avg, weekly volume, muscle group, exercise bar) */

function buildWeekBuckets(numWeeks) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dow = today.getDay(); // 0=Sun, 1=Mon, ...
    const mondayOffset = (dow + 6) % 7; // days since last Monday
    const currentMonday = new Date(today);
    currentMonday.setDate(currentMonday.getDate() - mondayOffset);

    const buckets = [];
    for (let i = numWeeks - 1; i >= 0; i--) {
        const start = new Date(currentMonday);
        start.setDate(start.getDate() - i * 7);
        const end = new Date(start);
        end.setDate(end.getDate() + 6); // Sunday

        const days = [];
        for (let d = 0; d < 7; d++) {
            const dt = new Date(start);
            dt.setDate(dt.getDate() + d);
            days.push(dt.toISOString().slice(0, 10));
        }

        const todayStr = today.toISOString().slice(0, 10);
        const isCurrent = todayStr >= days[0] && todayStr <= days[6];
        buckets.push({ start: days[0], end: days[6], days, volume: 0, isCurrent });
    }
    return buckets;
}

function aggregateWeekly(volMap, buckets) {
    for (const bucket of buckets) {
        for (const day of bucket.days) {
            bucket.volume += volMap[day] || 0;
        }
    }
}

function formatWeekRange(startStr, endStr) {
    const opts = { day: 'numeric', month: 'short' };
    return new Date(startStr).toLocaleDateString('en-GB', opts) + ' \u2013 ' +
           new Date(endStr).toLocaleDateString('en-GB', opts);
}

function buildRollingAvgSvg(items, maxVol, windowSize) {
    if (!windowSize) windowSize = 4;
    const n = items.length;
    const points = [];
    for (let i = 0; i < n; i++) {
        const start = Math.max(0, i - windowSize + 1);
        const count = i - start + 1;
        let sum = 0;
        for (let j = start; j <= i; j++) sum += items[j].volume;
        const avg = sum / count;
        const x = ((i + 0.5) / n) * 100;
        const y = 100 - (avg / maxVol) * 100;
        points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
    }
    if (points.length < 2) return '';
    return `<svg class="rolling-avg-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
        <polyline points="${points.join(' ')}" fill="none" stroke="var(--accent)" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
    </svg>`;
}

function renderDailyVolumeChart(dailyVolume) {
    const container = document.getElementById('dailyVolumeChart');
    if (!dailyVolume.length) { container.innerHTML = ''; return; }

    const WEEKS = 52;

    // Build a map of date string -> volume
    const volMap = {};
    for (const d of dailyVolume) volMap[d.date] = d.volume;

    // Build 52-week buckets and aggregate
    const weeks = buildWeekBuckets(WEEKS);
    aggregateWeekly(volMap, weeks);

    const maxVol = Math.max(...weeks.map(w => w.volume));
    if (maxVol === 0) { container.innerHTML = ''; return; }

    const barsHtml = weeks.map(w => {
        const cur = w.isCurrent ? ' current-week' : '';
        if (w.volume === 0) {
            return `<div class="chart-bar${cur}" style="height:1px;"></div>`;
        }
        const pct = Math.max(2, (w.volume / maxVol) * 100);
        return `<div class="chart-bar has-vol${cur}" style="height:${pct}%">
            <div class="chart-tooltip">${formatWeekRange(w.start, w.end)}<br>${w.volume.toFixed(0)} kg</div>
        </div>`;
    }).join('');

    const avgSvg = buildRollingAvgSvg(weeks, maxVol);

    container.innerHTML = `
        <div class="daily-volume-wrap">
            <div class="section-heading">Weekly Full Body Volume</div>
            <div class="chart chart-md">${barsHtml}${avgSvg}</div>
        </div>
    `;
}

function renderMuscleGroupCharts() {
    const container = document.getElementById('muscleGroupCharts');
    const exerciseDaily = window._exerciseDaily;
    if (!exerciseDaily || Object.keys(exerciseDaily).length === 0) {
        container.innerHTML = '';
        return;
    }

    const WEEKS = 52;

    // Group exercises by muscle group, sum daily volumes
    const groupVolumes = {}; // {group: {date: volume}}
    for (const [exName, dateMap] of Object.entries(exerciseDaily)) {
        const group = getMuscleGroup(exName);
        if (!groupVolumes[group]) groupVolumes[group] = {};
        for (const [date, vol] of Object.entries(dateMap)) {
            groupVolumes[group][date] = (groupVolumes[group][date] || 0) + vol;
        }
    }

    // Render a chart for each group that has volume, sorted by group name
    let html = '';
    for (const group of MUSCLE_GROUPS) {
        const volMap = groupVolumes[group];
        if (!volMap) continue;

        const weeks = buildWeekBuckets(WEEKS);
        aggregateWeekly(volMap, weeks);

        const maxVol = Math.max(...weeks.map(w => w.volume));
        if (maxVol === 0) continue;

        const barsHtml = weeks.map(w => {
            const cur = w.isCurrent ? ' current-week' : '';
            if (w.volume === 0) {
                return `<div class="chart-bar${cur}" style="height:1px;"></div>`;
            }
            const pct = Math.max(3, (w.volume / maxVol) * 100);
            return `<div class="chart-bar has-vol${cur}" style="height:${pct}%">
                <div class="chart-tooltip">${formatWeekRange(w.start, w.end)}<br>${w.volume.toFixed(0)} kg</div>
            </div>`;
        }).join('');

        const avgSvg = buildRollingAvgSvg(weeks, maxVol);

        html += `
            <div class="daily-volume-wrap">
                <div class="section-heading" style="font-size:1rem;">${esc(group)}</div>
                <div class="chart chart-sm">${barsHtml}${avgSvg}</div>
            </div>
        `;
    }

    container.innerHTML = html;
}

function renderWorkoutVolumeChart(templateCode) {
    const container = document.getElementById('detailVolumeChart');
    if (!container || !window._workouts) return;

    // Find all completed instances of this template
    const instances = window._workouts
        .filter(w => w.code === templateCode && w.isFinish === 1 && w.totalCapacity > 0)
        .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    if (instances.length === 0) {
        container.innerHTML = '';
        return;
    }

    // Find the index of each instance in window._workouts for click navigation
    const itemsWithIdx = instances.map(w => {
        const idx = window._workouts.indexOf(w);
        return { date: w.date, volume: w.totalCapacity || 0, idx };
    });
    const maxVol = Math.max(...itemsWithIdx.map(i => i.volume));
    if (maxVol === 0) { container.innerHTML = ''; return; }

    const barsHtml = itemsWithIdx.map(item => {
        const pct = Math.max(3, (item.volume / maxVol) * 100);
        return `<div class="chart-bar has-vol clickable-bar" data-workout-idx="${item.idx}" style="height:${pct}%; cursor:pointer;">
            <div class="chart-tooltip">${formatDate(item.date)}<br>${item.volume.toFixed(0)} kg</div>
        </div>`;
    }).join('');

    const avgSvg = buildRollingAvgSvg(itemsWithIdx, maxVol, 4);

    container.innerHTML = `
        <div class="daily-volume-wrap">
            <div class="section-heading" style="font-size:0.9rem;">Workout Volume History (${itemsWithIdx.length} sessions)</div>
            <div class="chart chart-sm">${barsHtml}${avgSvg}</div>
        </div>
    `;

    container.querySelectorAll('.clickable-bar').forEach(bar => {
        bar.addEventListener('click', () => {
            const idx = parseInt(bar.dataset.workoutIdx, 10);
            if (idx >= 0 && window._workouts[idx]) {
                openDetail(window._workouts[idx]);
            }
        });
    });
}

function renderExerciseBarChart(exerciseName, currentDate) {
    if (!window._exerciseHistory) return '';
    const ex = window._exerciseHistory.find(e => e.name === exerciseName);
    if (!ex || ex.history.length === 0) return '';

    const maxVol = Math.max(...ex.history.map(h => h.volume));
    if (maxVol === 0) return '';

    const maxBars = 10;
    const padded = new Array(maxBars).fill(null);
    const offset = maxBars - ex.history.length;
    for (let i = 0; i < ex.history.length; i++) {
        padded[offset + i] = ex.history[i];
    }

    const barsHtml = padded.map(h => {
        if (!h) return '<div class="chart-bar-empty"></div>';
        const pct = Math.max(5, (h.volume / maxVol) * 100);
        const isCurrent = h.date === currentDate;
        return `<div class="chart-bar ${isCurrent ? 'bar-current' : ''}" style="height:${pct}%">
            <div class="chart-tooltip">${h.date}: ${h.volume.toFixed(0)} kg</div>
        </div>`;
    }).join('');

    return `
        <div class="exercise-history-bar">
            <div class="exercise-history-label">Volume history (${ex.count} sessions)</div>
            <div class="chart chart-xs">${barsHtml}</div>
        </div>
    `;
}
