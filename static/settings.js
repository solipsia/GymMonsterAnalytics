/* settings.js — Settings page with exercise mapping table */

function formatRecoveryLabel(hours) {
    const days = hours / 24;
    if (hours % 24 === 0) return `${Math.round(days)} day${days !== 1 ? 's' : ''} (${hours}h)`;
    return `${days.toFixed(1)} days (${hours}h)`;
}

function initRecoverySlider() {
    const slider = document.getElementById('recoverySlider');
    const label = document.getElementById('recoveryLabel');
    slider.value = _recoveryHours;
    label.textContent = formatRecoveryLabel(_recoveryHours);

    slider.addEventListener('input', () => {
        const h = parseInt(slider.value);
        label.textContent = formatRecoveryLabel(h);
    });
    slider.addEventListener('change', async () => {
        const h = parseInt(slider.value);
        _recoveryHours = h;
        await apiPost('/api/settings', { recoveryHours: h });
        updateMuscleMapColors();
    });
}

function openSettings() {
    workoutView.style.display = 'none';
    settingsView.style.display = 'block';

    initRecoverySlider();

    // Collect ALL exercise names from exerciseDaily + existing mappings
    const names = new Set();
    if (window._exerciseDaily) {
        for (const n of Object.keys(window._exerciseDaily)) names.add(n);
    }
    for (const n of Object.keys(_muscleGroupMap)) names.add(n);
    for (const n of Object.keys(_handleTypeMap)) names.add(n);

    // Sort by muscle group then name
    const sorted = [...names].sort((a, b) => {
        const ga = getMuscleGroup(a), gb = getMuscleGroup(b);
        return ga.localeCompare(gb) || a.localeCompare(b);
    });

    const tbody = document.getElementById('settingsTableBody');
    tbody.innerHTML = sorted.map(name => {
        const currentMuscle = getMuscleGroup(name);
        const muscleOpts = MUSCLE_GROUPS.map(g =>
            `<option value="${g}"${g === currentMuscle ? ' selected' : ''}>${g}</option>`
        ).join('');
        const currentHandle = getHandleType(name);
        const handleOpts = HANDLE_TYPES.map(h =>
            `<option value="${h}"${h === currentHandle ? ' selected' : ''}>${h}</option>`
        ).join('');
        return `<tr>
            <td>${esc(name)}</td>
            <td><select class="settings-select" data-exercise="${esc(name)}" data-field="muscle">${muscleOpts}</select></td>
            <td><select class="settings-select" data-exercise="${esc(name)}" data-field="handle">${handleOpts}</select></td>
        </tr>`;
    }).join('');

    tbody.querySelectorAll('select').forEach(sel => {
        sel.addEventListener('change', function() {
            const ex = this.dataset.exercise;
            if (this.dataset.field === 'muscle') {
                setMuscleGroup(ex, this.value);
            } else {
                setHandleType(ex, this.value);
            }
        });
    });
}

function closeSettings() {
    settingsView.style.display = 'none';
    workoutView.style.display = 'block';
    renderExerciseHistoryTable();
    renderMuscleGroupCharts();
}
