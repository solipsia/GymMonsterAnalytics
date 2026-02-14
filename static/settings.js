/* settings.js — Settings page with exercise mapping table */

function openSettings() {
    workoutView.style.display = 'none';
    settingsView.style.display = 'block';

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
