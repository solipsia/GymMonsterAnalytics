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

    // Group exercises by muscle group, sum daily volumes (primary 100% + secondary scaled)
    const groupVolumes = {}; // {group: {date: volume}}
    for (const [exName, dateMap] of Object.entries(exerciseDaily)) {
        const primary = getMuscleGroup(exName);
        const secondary = getSecondaryMuscle(exName);
        const secPct = getSecondaryPercent(exName) / 100;

        if (!groupVolumes[primary]) groupVolumes[primary] = {};
        for (const [date, vol] of Object.entries(dateMap)) {
            groupVolumes[primary][date] = (groupVolumes[primary][date] || 0) + vol;
        }

        if (secondary && secondary !== 'None') {
            if (!groupVolumes[secondary]) groupVolumes[secondary] = {};
            for (const [date, vol] of Object.entries(dateMap)) {
                groupVolumes[secondary][date] = (groupVolumes[secondary][date] || 0) + vol * secPct;
            }
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

        // Build mini muscle map SVG with this group highlighted
        let miniSvg = '';
        if (window._muscleSvgText) {
            miniSvg = `<div class="muscle-chart-svg" data-highlight="${esc(group)}">${window._muscleSvgText}</div>`;
        }

        html += `
            <div class="daily-volume-wrap muscle-chart-tile">
                ${miniSvg}
                <div class="section-heading muscle-chart-title" style="font-size:1rem;">${esc(group)}</div>
                <div class="chart chart-sm">${barsHtml}${avgSvg}</div>
            </div>
        `;
    }

    container.innerHTML = html;

    // Color each mini muscle map: highlight the target group in red, others dark grey
    container.querySelectorAll('.muscle-chart-svg').forEach(wrap => {
        const target = wrap.dataset.highlight;
        wrap.querySelectorAll('.muscles path[data-muscle]').forEach(path => {
            path.style.fill = path.dataset.muscle === target ? 'hsl(0, 75%, 50%)' : '#475569';
        });
        wrap.querySelectorAll('.body-outline path').forEach(path => {
            path.style.fill = '#334155';
            path.style.stroke = '#666';
        });
    });
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

function renderActivityHeatmap(dailyVolume) {
    const container = document.getElementById('activityHeatmap');
    if (!container) return;
    if (!dailyVolume || dailyVolume.length === 0) { container.innerHTML = ''; return; }

    // Build volume map
    const volMap = {};
    for (const d of dailyVolume) volMap[d.date] = d.volume;

    // Calculate grid: 53 weeks, starting from Monday ~52 weeks ago
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dow = today.getDay(); // 0=Sun, 1=Mon, ...
    const daysSinceMonday = (dow + 6) % 7; // Mon=0, Tue=1, ..., Sun=6
    // Start: go back 52 full weeks + remaining days to hit a Monday
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - 364 - daysSinceMonday);

    // Build all dates in range
    const allDates = [];
    const d = new Date(startDate);
    while (d <= today) {
        allDates.push(d.toISOString().slice(0, 10));
        d.setDate(d.getDate() + 1);
    }

    // Count workout days and compute volume quantiles
    const volumes = allDates.map(dt => volMap[dt] || 0).filter(v => v > 0);
    const workoutCount = volumes.length;
    volumes.sort((a, b) => a - b);
    const q1 = volumes[Math.floor(volumes.length * 0.25)] || 0;
    const q2 = volumes[Math.floor(volumes.length * 0.50)] || 0;
    const q3 = volumes[Math.floor(volumes.length * 0.75)] || 0;

    const COLORS = ['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353'];
    function volumeColor(vol) {
        if (vol <= 0) return COLORS[0];
        if (vol <= q1) return COLORS[1];
        if (vol <= q2) return COLORS[2];
        if (vol <= q3) return COLORS[3];
        return COLORS[4];
    }

    // Build week columns (each column is Mon..Sun)
    const weeks = [];
    let weekStart = new Date(startDate);
    while (weekStart <= today) {
        const week = [];
        for (let dayOff = 0; dayOff < 7; dayOff++) {
            const dt = new Date(weekStart);
            dt.setDate(dt.getDate() + dayOff);
            if (dt > today) {
                week.push(null);
            } else {
                week.push(dt.toISOString().slice(0, 10));
            }
        }
        weeks.push(week);
        weekStart.setDate(weekStart.getDate() + 7);
    }

    // Month labels: find first week where a month starts
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const monthLabels = new Array(weeks.length).fill('');
    let lastMonth = -1;
    for (let wi = 0; wi < weeks.length; wi++) {
        // Check first day of week (Monday)
        const dt = weeks[wi][0];
        if (!dt) continue;
        const m = parseInt(dt.slice(5, 7)) - 1;
        if (m !== lastMonth) {
            monthLabels[wi] = monthNames[m];
            lastMonth = m;
        }
    }

    // Day labels: Mon=0, Tue=1, Wed=2, Thu=3, Fri=4, Sat=5, Sun=6
    const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    // Build HTML using CSS grid
    const numCols = weeks.length + 1; // +1 for day labels column
    let gridHtml = `<div class="heatmap-grid" style="grid-template-columns: 28px repeat(${weeks.length}, 11px);">`;

    // Month label row
    gridHtml += '<div></div>'; // empty corner
    for (let wi = 0; wi < weeks.length; wi++) {
        gridHtml += `<div class="heatmap-month-label">${monthLabels[wi]}</div>`;
    }

    // Day rows (0=Sun, 1=Mon, ..., 6=Sat)
    for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
        gridHtml += `<div class="heatmap-day-label">${dayLabels[dayIdx]}</div>`;
        for (let wi = 0; wi < weeks.length; wi++) {
            const dt = weeks[wi][dayIdx];
            if (!dt) {
                gridHtml += '<div></div>';
                continue;
            }
            const vol = volMap[dt] || 0;
            const color = volumeColor(vol);
            const tipDate = new Date(dt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
            const tipText = vol > 0 ? `${tipDate}: ${vol.toFixed(0)} kg` : `${tipDate}: No workouts`;
            gridHtml += `<div class="heatmap-cell" style="background:${color}"><div class="heatmap-tip">${tipText}</div></div>`;
        }
    }
    gridHtml += '</div>';

    container.innerHTML = `
        <div class="heatmap-wrap">
            <div class="heatmap-header">${workoutCount} workouts in the last year</div>
            <div class="heatmap-container">${gridHtml}</div>
        </div>
    `;
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

    const barsHtml = padded.map((h, i) => {
        if (!h) return '<div class="chart-bar-empty"></div>';
        const pct = Math.max(5, (h.volume / maxVol) * 100);
        const isCurrent = h.date === currentDate;

        // Calculate % change from previous non-null bar
        let changeHtml = '';
        let prevIdx = i - 1;
        while (prevIdx >= 0 && !padded[prevIdx]) prevIdx--;
        if (prevIdx >= 0 && padded[prevIdx] && padded[prevIdx].volume > 0) {
            const prev = padded[prevIdx].volume;
            const delta = ((h.volume - prev) / prev) * 100;
            const sign = delta > 0 ? '+' : '';
            const color = delta > 0 ? 'var(--success)' : delta < 0 ? '#f87171' : 'var(--text-muted)';
            changeHtml = `<div class="bar-change" style="color:${color}">${sign}${Math.round(delta)}%</div>`;
        }

        return `<div class="chart-bar ${isCurrent ? 'bar-current' : ''}" style="height:${pct}%">
            ${changeHtml}
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
