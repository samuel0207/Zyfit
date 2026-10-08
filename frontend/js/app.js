// ==========================================================================
// CONFIGURAÇÃO DA API & ESTADO GLOBAL
// ==========================================================================
const API_BASE_URL = window.location.protocol === 'file:' || window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost'
    ? 'http://localhost:8000' 
    : window.location.origin;

let state = {
    token: localStorage.getItem('token') || null,
    user: null, // Logged in user info
    students: [],
    selectedStudentId: null,
    workouts: [],
    catalogExercises: [], // Global exercise catalog
    catalogFilterGroup: '', // Active muscle group filter
    studentWorkouts: [], // Current student portal workouts
    activeStudentWorkoutId: null, // Active workout tab in student portal
    selectedTimelineDay: null, // Active timeline day in student portal
    notifications: [], // Student in-app notifications
    unreadNotificationsCount: 0,
    expiringWorkouts: [] // Admin monitoring
};

// Security and string escaping utilities
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function escapeJs(str) {
    if (!str) return '';
    return String(str)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r');
}

// ==========================================================================
// INICIALIZAÇÃO DA APLICAÇÃO
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
    initApp();
    setupEventListeners();
});

async function initApp() {
    if (state.token) {
        const success = await fetchCurrentUser();
        if (success) {
            routeUser(state.user.role);
        } else {
            logout();
        }
    } else {
        showView('login-screen');
    }
}

// ==========================================================================
// CLIENT-SIDE ROUTER / VIEW SWITCHER
// ==========================================================================
function showView(viewId) {
    document.querySelectorAll('.view').forEach(view => {
        view.classList.add('hidden');
    });
    
    const activeView = document.getElementById(viewId);
    if (activeView) {
        activeView.classList.remove('hidden');
    }
}

function routeUser(role) {
    if (role === 'admin') {
        showView('teacher-dashboard');
        fetchStudents();
        fetchExpiringWorkoutsAdmin();
    } else if (role === 'student') {
        showView('student-portal');
        initStudentPortal();
        fetchStudentNotifications();
    }
}

// ==========================================================================
// NOTIFICAÇÕES TOAST
// ==========================================================================
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.className = `toast toast-${type}`;
    
    // Choose icon based on type
    let icon = '<i class="fa-solid fa-circle-check"></i>';
    if (type === 'error') icon = '<i class="fa-solid fa-triangle-exclamation"></i>';
    if (type === 'info') icon = '<i class="fa-solid fa-circle-info"></i>';
    
    toast.innerHTML = `${icon} <span>${message}</span>`;
    toast.classList.remove('hidden');
    
    setTimeout(() => {
        toast.classList.add('hidden');
    }, 4000);
}

// ==========================================================================
// CLIENTE HTTP (FETCH WRAPPER COM SEGURANÇA JWT)
// ==========================================================================
async function apiRequest(endpoint, options = {}) {
    const url = `${API_BASE_URL}${endpoint}`;
    
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
    };
    
    if (state.token) {
        headers['Authorization'] = `Bearer ${state.token}`;
    }
    
    const config = {
        ...options,
        headers
    };
    
    try {
        const response = await fetch(url, config);
        
        if (response.status === 401) {
            logout();
            showToast('Sessão expirada. Por favor, faça login novamente.', 'error');
            throw new Error('Unauthorized');
        }
        
        if (response.status === 204) {
            return null;
        }
        
        // Safely parse JSON - handle cases where server returns plain text errors
        let data;
        const contentType = response.headers.get('content-type') || '';
        const responseText = await response.text();
        
        try {
            data = JSON.parse(responseText);
        } catch (parseError) {
            // Server returned non-JSON response (e.g. "Internal Server Error")
            console.error(`Non-JSON response from ${endpoint}:`, responseText);
            throw new Error(responseText || `Erro do servidor (${response.status})`);
        }
        
        if (!response.ok) {
            throw new Error(data.detail || 'Erro na requisição da API');
        }
        
        return data;
    } catch (error) {
        console.error(`API Error on ${endpoint}:`, error);
        throw error;
    }
}

// ==========================================================================
// GERENCIAMENTO DE AUTENTICAÇÃO
// ==========================================================================
async function fetchCurrentUser() {
    try {
        const user = await apiRequest('/api/auth/me');
        state.user = user;
        
        // Update user indicators in UI
        const teacherGreeting = document.getElementById('teacher-name');
        if (teacherGreeting) teacherGreeting.innerText = `Olá, ${user.name.split(' ')[0]}`;
        
        const studentGreeting = document.getElementById('student-name-header');
        if (studentGreeting) studentGreeting.innerText = `Olá, ${user.name.split(' ')[0]}`;
        
        return true;
    } catch (e) {
        return false;
    }
}

async function handleLogin(phone, password) {
    const btn = document.getElementById('btn-login');
    const text = btn.querySelector('.btn-text');
    const spinner = btn.querySelector('.spinner');
    
    // Toggle Loading State
    text.classList.add('hidden');
    spinner.classList.remove('hidden');
    btn.disabled = true;
    
    try {
        const data = await apiRequest('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ phone, password, name: 'dummy' }) // name is requested by schema but ignored on login
        });
        
        state.token = data.access_token;
        localStorage.setItem('token', data.access_token);
        
        const userLoaded = await fetchCurrentUser();
        if (userLoaded) {
            showToast('Login efetuado com sucesso!', 'success');
            routeUser(state.user.role);
        }
    } catch (error) {
        showToast(error.message || 'Falha na autenticação. Verifique seu e-mail e senha.', 'error');
    } finally {
        text.classList.remove('hidden');
        spinner.classList.add('hidden');
        btn.disabled = false;
    }
}

function logout() {
    state.token = null;
    state.user = null;
    state.students = [];
    state.selectedStudentId = null;
    state.workouts = [];
    localStorage.removeItem('token');
    
    showView('login-screen');
    
    // Reset inputs
    document.getElementById('login-password').value = '';
    
    // Reset view panels
    document.getElementById('student-profile-view').classList.add('hidden');
    document.getElementById('no-student-selected').classList.remove('hidden');
}

// ==========================================================================
// MÓDULO DO PROFESSOR: GESTÃO DE ALUNOS (CRUD)
// ==========================================================================
async function fetchStudents() {
    const listContainer = document.getElementById('students-list');
    
    try {
        const students = await apiRequest('/api/students');
        state.students = students;
        renderStudentsList(students);
    } catch (e) {
        listContainer.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-triangle-exclamation"></i>
                <p>Falha ao carregar alunos. Tente novamente.</p>
            </div>
        `;
    }
}

function renderStudentsList(studentsList) {
    const listContainer = document.getElementById('students-list');
    
    if (studentsList.length === 0) {
        listContainer.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-users"></i>
                <p>Nenhum aluno cadastrado.</p>
            </div>
        `;
        return;
    }
    
    listContainer.innerHTML = studentsList.map(student => `
        <div class="student-card ${state.selectedStudentId === student.id ? 'active' : ''}" 
             onclick="selectStudent('${student.id}')" data-id="${student.id}">
            <div class="avatar-small">
                <i class="fa-solid fa-user"></i>
            </div>
            <div class="student-card-info">
                <h4>${escapeHtml(student.name)}</h4>
                <p>${escapeHtml(student.phone)}${student.age ? ` • <span class="student-age-pill">${student.age} anos</span>` : ''}</p>
            </div>
            <div class="student-card-arrow">
                <i class="fa-solid fa-chevron-right"></i>
            </div>
        </div>
    `).join('');
}

function backToStudentsList() {
    const sidebar = document.querySelector('.students-section');
    if (sidebar) {
        sidebar.scrollIntoView({ behavior: 'smooth' });
    }
}
window.backToStudentsList = backToStudentsList;

async function selectStudent(studentId) {
    state.selectedStudentId = studentId;
    
    // Update active visual card in sidebar
    document.querySelectorAll('.student-card').forEach(card => {
        card.classList.remove('active');
        if (card.dataset.id === studentId) {
            card.classList.add('active');
        }
    });
    
    // Show loading state or profiles directly
    document.getElementById('no-student-selected').classList.add('hidden');
    const profileView = document.getElementById('student-profile-view');
    profileView.classList.remove('hidden');
    
    const student = state.students.find(s => s.id === studentId);
    if (!student) return;
    
    // Fill basic details
    document.getElementById('view-student-name').innerText = student.name;
    document.getElementById('view-student-phone').innerHTML = `<i class="fa-solid fa-mobile-button" style="color: var(--primary-color);"></i> ${student.phone}`;
    document.getElementById('view-student-password').innerText = student.password || '------';
    
    const ageEl = document.getElementById('view-student-age');
    if (ageEl) {
        ageEl.innerText = student.age ? `${student.age} anos` : '--';
    }
    
    document.getElementById('view-student-weight').innerText = student.weight ? `${student.weight} kg` : '--';
    document.getElementById('view-student-height').innerText = student.height ? `${student.height} m` : '--';
    document.getElementById('view-student-goals').innerText = student.goals || 'Nenhum objetivo cadastrado.';
    
    // Calculate IMC
    const imcElement = document.getElementById('view-student-imc');
    if (student.weight && student.height) {
        const imc = (student.weight / (student.height * student.height)).toFixed(1);
        let classification = '';
        if (imc < 18.5) classification = ' (Abaixo)';
        else if (imc < 25) classification = ' (Ideal)';
        else if (imc < 30) classification = ' (Sobrepeso)';
        else classification = ' (Obesidade)';
        imcElement.innerText = `${imc}${classification}`;
    } else {
        imcElement.innerText = '--';
    }

    // Render Goal Date
    renderStudentGoalDate(student);
    
    // Fetch and render Workouts/Treinos
    fetchWorkouts(studentId);
    
    // Fetch and render Activity Panel
    const periodSelect = document.getElementById('activity-period-select');
    const selectedDays = periodSelect ? parseInt(periodSelect.value) : 30;
    fetchStudentActivity(studentId, selectedDays);

    // Responsive: On small screens, scroll down to the student profile
    if (window.innerWidth <= 1024) {
        setTimeout(() => {
            profileView.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
    }
}

// Helper to render Goal Date in student profile view
function renderStudentGoalDate(student) {
    const card = document.getElementById('goal-date-card');
    const valueEl = document.getElementById('view-goal-date');
    const countdownEl = document.getElementById('view-goal-countdown');
    if (!card || !valueEl || !countdownEl) return;

    card.classList.remove('not-set', 'expired', 'soon', 'ok');
    countdownEl.classList.remove('countdown-ok', 'countdown-soon', 'countdown-expired');

    if (!student || !student.goal_date) {
        card.classList.add('not-set');
        valueEl.innerText = 'Não definida';
        countdownEl.innerText = 'Clique para definir meta';
        return;
    }

    const rawDate = student.goal_date.includes('T') ? student.goal_date.split('T')[0] : student.goal_date;
    const parts = rawDate.split('-');
    if (parts.length !== 3) {
        card.classList.add('not-set');
        valueEl.innerText = 'Não definida';
        countdownEl.innerText = 'Clique para definir meta';
        return;
    }

    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    const targetDate = new Date(year, month, day);

    const formattedDate = `${String(day).padStart(2, '0')}/${String(month + 1).padStart(2, '0')}/${year}`;
    valueEl.innerText = formattedDate;

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffMs = targetDate.getTime() - today.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
        const daysAgo = Math.abs(diffDays);
        card.classList.add('expired');
        countdownEl.classList.add('countdown-expired');
        countdownEl.innerHTML = `<i class="fa-solid fa-clock-rotate-left"></i> Expirou há ${daysAgo} dia${daysAgo === 1 ? '' : 's'}`;
    } else if (diffDays === 0) {
        card.classList.add('soon');
        countdownEl.classList.add('countdown-soon');
        countdownEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Vence hoje!`;
    } else if (diffDays <= 7) {
        card.classList.add('soon');
        countdownEl.classList.add('countdown-soon');
        countdownEl.innerHTML = `<i class="fa-regular fa-clock"></i> Faltam ${diffDays} dia${diffDays === 1 ? '' : 's'}`;
    } else {
        card.classList.add('ok');
        countdownEl.classList.add('countdown-ok');
        countdownEl.innerHTML = `<i class="fa-solid fa-bullseye"></i> Faltam ${diffDays} dias`;
    }
}

function openGoalDateEditor() {
    if (!state.selectedStudentId) {
        showToast('Nenhum aluno selecionado.', 'warning');
        return;
    }
    const student = state.students.find(s => s.id === state.selectedStudentId);
    if (!student) {
        showToast('Aluno não encontrado.', 'error');
        return;
    }

    const overlay = document.getElementById('goal-date-editor-overlay');
    const input = document.getElementById('quick-goal-date-input');
    const removeBtn = document.getElementById('btn-remove-quick-goal');

    if (input) {
        input.value = student.goal_date ? (student.goal_date.includes('T') ? student.goal_date.split('T')[0] : student.goal_date) : '';
    }

    if (removeBtn) {
        removeBtn.style.display = student.goal_date ? 'inline-flex' : 'none';
    }

    if (overlay) {
        overlay.classList.remove('hidden');
    }
}

function closeGoalDateEditor() {
    const overlay = document.getElementById('goal-date-editor-overlay');
    if (overlay) {
        overlay.classList.add('hidden');
    }
}

async function saveGoalDate() {
    if (!state.selectedStudentId) return;
    const input = document.getElementById('quick-goal-date-input');
    if (!input || !input.value) {
        showToast('Selecione uma data para a meta.', 'error');
        return;
    }

    try {
        const updated = await apiRequest(`/api/students/${state.selectedStudentId}`, {
            method: 'PUT',
            body: JSON.stringify({ goal_date: input.value })
        });

        const student = state.students.find(s => s.id === state.selectedStudentId);
        if (student) {
            student.goal_date = updated.goal_date || input.value;
            renderStudentGoalDate(student);
        }
        closeGoalDateEditor();
        showToast('Data meta definida com sucesso!', 'success');
    } catch (e) {
        showToast(e.message || 'Erro ao salvar data meta.', 'error');
    }
}

async function removeGoalDate() {
    if (!state.selectedStudentId) return;
    try {
        await apiRequest(`/api/students/${state.selectedStudentId}`, {
            method: 'PUT',
            body: JSON.stringify({ goal_date: null })
        });

        const student = state.students.find(s => s.id === state.selectedStudentId);
        if (student) {
            student.goal_date = null;
            renderStudentGoalDate(student);
        }
        closeGoalDateEditor();
        showToast('Data meta removida com sucesso!', 'info');
    } catch (e) {
        showToast(e.message || 'Erro ao remover data meta.', 'error');
    }
}

// Expose functions globally for inline onclick handlers
window.openGoalDateEditor = openGoalDateEditor;
window.closeGoalDateEditor = closeGoalDateEditor;
window.saveGoalDate = saveGoalDate;
window.removeGoalDate = removeGoalDate;
window.renderStudentGoalDate = renderStudentGoalDate;

async function handleStudentSubmit(event) {
    event.preventDefault();
    const id = document.getElementById('student-form-id').value;
    const name = document.getElementById('student-name').value;
    const phone = document.getElementById('student-phone').value;
    const password = document.getElementById('student-password').value;
    const ageInput = document.getElementById('student-age');
    const age = ageInput && ageInput.value ? parseInt(ageInput.value) : null;
    const weight = parseFloat(document.getElementById('student-weight').value) || null;
    const height = parseFloat(document.getElementById('student-height').value) || null;
    const goals = document.getElementById('student-goals').value || null;
    const goalDateInput = document.getElementById('student-goal-date');
    const goal_date = goalDateInput ? (goalDateInput.value || null) : null;
    
    const payload = { name, phone, age, weight, height, goals, goal_date };
    
    try {
        if (id) {
            // Edit existing student
            if (password) payload.password = password;
            const updated = await apiRequest(`/api/students/${id}`, {
                method: 'PUT',
                body: JSON.stringify(payload)
            });
            const sIdx = state.students.findIndex(s => s.id === id);
            if (sIdx !== -1 && updated) {
                state.students[sIdx] = { ...state.students[sIdx], ...updated };
            }
            showToast('Perfil do aluno atualizado com sucesso!', 'success');
        } else {
            // Create new student
            if (!password) {
                showToast('Defina uma senha de acesso para o novo aluno.', 'error');
                return;
            }
            payload.password = password;
            payload.role = 'student';
            await apiRequest('/api/students', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            showToast('Novo aluno cadastrado com sucesso!', 'success');
        }
        
        closeModal('modal-student');
        await fetchStudents();
        if (state.selectedStudentId) {
            const currentSelected = state.students.find(s => s.id === state.selectedStudentId);
            if (currentSelected) {
                renderStudentGoalDate(currentSelected);
            }
        }
    } catch (e) {
        showToast(e.message || 'Erro ao salvar aluno.', 'error');
    }
}

async function deleteStudent(studentId) {
    if (!confirm('Tem certeza absoluta que deseja excluir este aluno? Esta ação removerá permanentemente o perfil, todas as fichas de treino e o histórico de execuções.')) {
        return;
    }
    
    try {
        await apiRequest(`/api/students/${studentId}`, {
            method: 'DELETE'
        });
        
        showToast('Aluno removido com sucesso!', 'success');
        state.selectedStudentId = null;
        
        // Refresh UI lists
        document.getElementById('student-profile-view').classList.add('hidden');
        document.getElementById('no-student-selected').classList.remove('hidden');
        fetchStudents();
    } catch (e) {
        showToast(e.message || 'Falha ao remover aluno.', 'error');
    }
}

// ==========================================================================
// MÓDULO DO PROFESSOR: GESTÃO DE TREINOS (WORKOUTS)
// ==========================================================================
async function fetchWorkouts(studentId) {
    const workoutsContainer = document.getElementById('workouts-list');
    workoutsContainer.innerHTML = `
        <div class="loading-state">
            <i class="fa-solid fa-circle-notch fa-spin"></i>
            <p>Carregando fichas de treinos...</p>
        </div>
    `;
    
    try {
        const workouts = await apiRequest(`/api/workouts/student/${studentId}`);
        state.workouts = workouts;
        renderWorkoutsList(workouts);
    } catch (e) {
        workoutsContainer.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-triangle-exclamation"></i>
                <p>Falha ao carregar fichas de treinos.</p>
            </div>
        `;
    }
}

function renderWorkoutsList(workoutsList) {
    const workoutsContainer = document.getElementById('workouts-list');
    
    if (workoutsList.length === 0) {
        workoutsContainer.innerHTML = `
            <div class="empty-state glass-card">
                <i class="fa-solid fa-clipboard-list"></i>
                <h4>Nenhuma ficha ativa</h4>
                <p>Este aluno não possui fichas de treino vinculadas. Clique em "Nova Ficha" para criar.</p>
            </div>
        `;
        return;
    }
    
    workoutsContainer.innerHTML = workoutsList.map(workout => {
        const totalExercises = workout.exercises ? workout.exercises.length : 0;
        const exercisesHtml = workout.exercises && totalExercises > 0
            ? workout.exercises.map((ex, index) => `
                <div class="exercise-card-wrapper" id="exercise-card-${ex.id}"
                     draggable="true"
                     data-workout-id="${workout.id}"
                     data-exercise-id="${ex.id}"
                     ondragstart="handleExerciseDragStart(event, '${workout.id}', '${ex.id}')"
                     ondragover="handleExerciseDragOver(event)"
                     ondragleave="handleExerciseDragLeave(event)"
                     ondrop="handleExerciseDrop(event, '${workout.id}', '${ex.id}')"
                     ondragend="handleExerciseDragEnd(event)">
                    <div class="exercise-row">
                        <div class="exercise-main-details">
                            <span class="exercise-reorder-handle" title="Arraste para reposicionar">
                                <i class="fa-solid fa-grip-vertical"></i>
                            </span>
                            <span class="exercise-number">${index + 1}</span>
                            <div class="exercise-meta-info">
                                <h5>${escapeHtml(ex.name)}</h5>
                                <div class="exercise-specs">
                                    <span class="spec-item"><i class="fa-solid fa-repeat"></i> ${ex.sets}x</span>
                                    <span class="spec-item"><i class="fa-solid fa-dumbbell"></i> ${ex.repetitions}</span>
                                    <span class="spec-item"><i class="fa-regular fa-clock"></i> Descanso: ${ex.rest_time}</span>
                                </div>
                            </div>
                        </div>
                        <div class="exercise-right-actions">
                            ${ex.video_url 
                                ? `
                                <div class="exercise-video-actions-admin">
                                    <button type="button" class="btn-video-watch-admin" onclick="playDemonstrationVideo('${escapeJs(ex.name)}', '${escapeJs(ex.video_url)}')" title="Assistir vídeo de execução">
                                        <i class="fa-solid fa-circle-play"></i> Ver Vídeo
                                    </button>
                                    <button type="button" class="btn-icon-sm btn-inline-video-toggle" onclick="toggleInlineExerciseVideo('${ex.id}', '${escapeJs(ex.name)}', '${escapeJs(ex.video_url)}')" title="Expandir vídeo integrado aqui">
                                        <i class="fa-solid fa-film"></i>
                                    </button>
                                </div>`
                                : ''
                            }
                            <div class="exercise-order-actions" title="Alterar ordem do exercício">
                                <button type="button" class="btn-icon-sm btn-reorder" onclick="moveExercise('${workout.id}', '${ex.id}', -1)" title="Subir na ordem" ${index === 0 ? 'disabled' : ''}>
                                    <i class="fa-solid fa-arrow-up"></i>
                                </button>
                                <button type="button" class="btn-icon-sm btn-reorder" onclick="moveExercise('${workout.id}', '${ex.id}', 1)" title="Descer na ordem" ${index === totalExercises - 1 ? 'disabled' : ''}>
                                    <i class="fa-solid fa-arrow-down"></i>
                                </button>
                            </div>
                            <div class="exercise-crud-buttons">
                                <button class="btn-icon-sm" onclick="openEditExercise('${workout.id}', '${ex.id}')" title="Editar exercício">
                                    <i class="fa-regular fa-pen-to-square"></i>
                                </button>
                                <button class="btn-icon-sm btn-danger" onclick="deleteExercise('${ex.id}')" title="Excluir exercício">
                                    <i class="fa-regular fa-trash-can"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                    ${ex.video_url ? `<div id="inline-video-${ex.id}" class="exercise-inline-video hidden"></div>` : ''}
                </div>
            `).join('')
            : `<p class="empty-state" style="padding: 15px;">Nenhum exercício cadastrado nesta ficha.</p>`;
            
        const daysHtml = workout.days_of_week 
            ? `<div class="workout-days-badge" style="margin-top: 6px; font-size: 0.75rem; color: var(--primary-color); display: flex; align-items: center; gap: 4px; font-weight: 500;">
                 <i class="fa-regular fa-calendar-days"></i> ${workout.days_of_week}
               </div>`
            : '';

        // Dates and deadline badge
        let datesHtml = '';
        if (workout.start_date || workout.end_date) {
            const startFmt = workout.start_date ? new Date(workout.start_date + 'T00:00:00').toLocaleDateString('pt-BR') : 'Início imediato';
            const endFmt = workout.end_date ? new Date(workout.end_date + 'T00:00:00').toLocaleDateString('pt-BR') : 'Sem prazo final';
            
            let statusBadge = '';
            if (workout.status === 'expired') {
                const daysAgo = Math.abs(workout.days_remaining || 0);
                statusBadge = `<span class="workout-status-badge badge-status-expired"><i class="fa-solid fa-triangle-exclamation"></i> Vencido há ${daysAgo} dia(s)</span>`;
            } else if (workout.status === 'expiring_today') {
                statusBadge = `<span class="workout-status-badge badge-status-expiring-today"><i class="fa-solid fa-bell"></i> Vence Hoje!</span>`;
            } else if (workout.status === 'expiring_soon') {
                statusBadge = `<span class="workout-status-badge badge-status-expiring-soon"><i class="fa-solid fa-clock"></i> Vence em ${workout.days_remaining} dia(s)</span>`;
            } else if (workout.status === 'active') {
                statusBadge = `<span class="workout-status-badge badge-status-active"><i class="fa-solid fa-circle-check"></i> Válido (${workout.days_remaining} dias restantes)</span>`;
            }

            // WhatsApp direct action
            let waAlertBtn = '';
            const currentStudent = state.students.find(s => s.id === state.selectedStudentId);
            if (currentStudent && currentStudent.phone && (workout.status === 'expired' || workout.status === 'expiring_today' || workout.status === 'expiring_soon')) {
                let cleanPhone = currentStudent.phone.replace(/\D/g, '');
                if (cleanPhone && !cleanPhone.startsWith('55') && (cleanPhone.length === 10 || cleanPhone.length === 11)) {
                    cleanPhone = '55' + cleanPhone;
                }
                const msg = workout.status === 'expired'
                    ? `Olá, ${currentStudent.name}! Notei que o prazo da sua ficha "${workout.title}" encerrou em ${endFmt}. Vamos agendar sua reavaliação para atualizarmos seu treino?`
                    : `Olá, ${currentStudent.name}! O prazo da sua ficha "${workout.title}" termina ${workout.status === 'expiring_today' ? 'hoje' : 'em breve'} (${endFmt}). Vamos combinar o próximo ciclo de treino?`;
                waAlertBtn = `
                    <a href="https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}" target="_blank" class="btn-whatsapp-action" style="font-size: 0.75rem; padding: 4px 10px; border-radius: 6px;" title="Avisar aluno no WhatsApp">
                        <i class="fa-brands fa-whatsapp"></i> Avisar no WhatsApp
                    </a>
                `;
            }

            datesHtml = `
                <div style="margin-top: 8px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 0.8rem; color: var(--text-secondary);">
                    <span><i class="fa-regular fa-calendar-days" style="color: var(--primary-color);"></i> <strong>Início:</strong> ${startFmt} &bull; <strong>Término:</strong> ${endFmt}</span>
                    ${statusBadge}
                    ${waAlertBtn}
                </div>
            `;
        }
            
        return `
            <div class="workout-sheet-card glass-card">
                <div class="workout-sheet-header">
                    <div>
                        <h4>${workout.title}</h4>
                        <p>${workout.description || 'Sem descrição cadastrada.'}</p>
                        ${daysHtml}
                        ${datesHtml}
                    </div>
                    <div class="workout-sheet-actions">
                        <button class="btn-icon-sm" onclick="openEditWorkout('${workout.id}')" title="Editar ficha de treino">
                            <i class="fa-regular fa-pen-to-square"></i>
                        </button>
                        <button class="btn-icon-sm btn-danger" onclick="deleteWorkout('${workout.id}')" title="Excluir ficha de treino">
                            <i class="fa-regular fa-trash-can"></i>
                        </button>
                    </div>
                </div>
                
                <div class="exercises-list-table">
                    ${exercisesHtml}
                </div>
                
                <button class="btn-add-exercise-inline" onclick="openAddExercise('${workout.id}')">
                    <i class="fa-solid fa-plus-circle"></i> Adicionar Exercício à Ficha
                </button>
            </div>
        `;
    }).join('');
}

async function handleWorkoutSubmit(event) {
    event.preventDefault();
    const id = document.getElementById('workout-form-id').value;
    const title = document.getElementById('workout-title').value;
    const description = document.getElementById('workout-description').value || null;
    const start_date = document.getElementById('workout-start-date').value || null;
    const end_date = document.getElementById('workout-end-date').value || null;
    
    const checkedDays = Array.from(document.querySelectorAll('input[name="workout-days"]:checked'))
        .map(input => input.value)
        .join(', ');
        
    try {
        if (id) {
            // Edit workout header
            await apiRequest(`/api/workouts/${id}`, {
                method: 'PUT',
                body: JSON.stringify({ 
                    title, 
                    description, 
                    days_of_week: checkedDays || null,
                    start_date,
                    end_date
                })
            });
            showToast('Ficha de treino atualizada com sucesso!', 'success');
        } else {
            // Create workout sheet
            await apiRequest('/api/workouts', {
                method: 'POST',
                body: JSON.stringify({
                    student_id: state.selectedStudentId,
                    title,
                    description,
                    days_of_week: checkedDays || null,
                    start_date,
                    end_date
                })
            });
            showToast('Nova ficha de treino criada com sucesso!', 'success');
        }
        
        closeModal('modal-workout');
        fetchWorkouts(state.selectedStudentId);
        fetchExpiringWorkoutsAdmin(); // Atualiza monitor de prazos em tempo real
    } catch (e) {
        showToast(e.message || 'Erro ao salvar ficha de treino.', 'error');
    }
}

async function deleteWorkout(workoutId) {
    if (!confirm('Deseja excluir esta ficha de treino permanentemente? Todos os exercícios associados serão apagados.')) {
        return;
    }
    
    try {
        await apiRequest(`/api/workouts/${workoutId}`, {
            method: 'DELETE'
        });
        showToast('Ficha de treino excluída com sucesso!', 'success');
        fetchWorkouts(state.selectedStudentId);
    } catch (e) {
        showToast(e.message || 'Falha ao excluir ficha de treino.', 'error');
    }
}

// ==========================================================================
// MÓDULO DO PROFESSOR: GESTÃO DE EXERCÍCIOS (CRUD)
// ==========================================================================
async function handleExerciseSubmit(event) {
    event.preventDefault();
    const id = document.getElementById('exercise-form-id').value;
    const workoutId = document.getElementById('exercise-workout-id').value;
    const name = document.getElementById('exercise-name').value;
    const sets = parseInt(document.getElementById('exercise-sets').value);
    const repetitions = document.getElementById('exercise-repetitions').value;
    const rest_time = document.getElementById('exercise-rest').value;
    const video_url = document.getElementById('exercise-video').value || null;
    
    const payload = { name, sets, repetitions, rest_time, video_url };
    
    try {
        if (id) {
            // Edit exercise
            await apiRequest(`/api/exercises/${id}`, {
                method: 'PUT',
                body: JSON.stringify(payload)
            });
            showToast('Exercício atualizado com sucesso!', 'success');
        } else {
            // Create exercise
            payload.workout_id = workoutId;
            payload.order_index = 0; // Default index
            await apiRequest('/api/exercises', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            showToast('Exercício adicionado com sucesso à ficha!', 'success');
        }
        
        closeModal('modal-exercise');
        fetchWorkouts(state.selectedStudentId);
    } catch (e) {
        showToast(e.message || 'Falha ao salvar exercício.', 'error');
    }
}

async function deleteExercise(exerciseId) {
    if (!confirm('Deseja excluir este exercício?')) {
        return;
    }
    
    try {
        await apiRequest(`/api/exercises/${exerciseId}`, {
            method: 'DELETE'
        });
        showToast('Exercício excluído com sucesso!', 'success');
        fetchWorkouts(state.selectedStudentId);
    } catch (e) {
        showToast(e.message || 'Falha ao excluir exercício.', 'error');
    }
}

// ==========================================================================
// REORDENAÇÃO DE EXERCÍCIOS (BOTÕES E DRAG & DROP)
// ==========================================================================
let draggedExerciseInfo = null;

async function moveExercise(workoutId, exerciseId, direction) {
    const workout = state.workouts.find(w => w.id === workoutId);
    if (!workout || !workout.exercises || workout.exercises.length <= 1) return;

    const currentIndex = workout.exercises.findIndex(e => e.id === exerciseId);
    if (currentIndex === -1) return;

    const targetIndex = currentIndex + direction;
    if (targetIndex < 0 || targetIndex >= workout.exercises.length) return;

    // Swap items locally for instant feedback
    const [movedExercise] = workout.exercises.splice(currentIndex, 1);
    workout.exercises.splice(targetIndex, 0, movedExercise);

    // Sync order_index in memory
    workout.exercises.forEach((ex, idx) => {
        ex.order_index = idx;
    });

    // Re-render immediately
    renderWorkoutsList(state.workouts);

    // Persist new order on backend
    try {
        const orderedIds = workout.exercises.map(e => e.id);
        await apiRequest('/api/exercises/reorder', {
            method: 'POST',
            body: JSON.stringify({
                workout_id: workoutId,
                ordered_ids: orderedIds
            })
        });
        showToast('Ordem dos exercícios atualizada! ✓', 'success');
    } catch (err) {
        console.error('Falha ao reordenar exercícios:', err);
        showToast('Erro ao salvar nova ordem dos exercícios.', 'error');
        fetchWorkouts(state.selectedStudentId);
    }
}

function handleExerciseDragStart(e, workoutId, exerciseId) {
    draggedExerciseInfo = { workoutId, exerciseId };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', exerciseId);
    const card = document.getElementById(`exercise-card-${exerciseId}`);
    if (card) {
        card.classList.add('is-dragging');
    }
}

function handleExerciseDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const card = e.currentTarget;
    if (card && !card.classList.contains('is-dragging')) {
        card.classList.add('drag-over');
    }
}

function handleExerciseDragLeave(e) {
    const card = e.currentTarget;
    if (card) {
        card.classList.remove('drag-over');
    }
}

function handleExerciseDragEnd(e) {
    document.querySelectorAll('.exercise-card-wrapper').forEach(el => {
        el.classList.remove('is-dragging', 'drag-over');
    });
    draggedExerciseInfo = null;
}

async function handleExerciseDrop(e, targetWorkoutId, targetExerciseId) {
    e.preventDefault();
    e.stopPropagation();

    document.querySelectorAll('.exercise-card-wrapper').forEach(el => {
        el.classList.remove('is-dragging', 'drag-over');
    });

    if (!draggedExerciseInfo) return;
    const { workoutId: sourceWorkoutId, exerciseId: sourceExerciseId } = draggedExerciseInfo;

    // Only allow reordering within the same workout
    if (sourceWorkoutId !== targetWorkoutId || sourceExerciseId === targetExerciseId) {
        draggedExerciseInfo = null;
        return;
    }

    const workout = state.workouts.find(w => w.id === targetWorkoutId);
    if (!workout || !workout.exercises) {
        draggedExerciseInfo = null;
        return;
    }

    const sourceIndex = workout.exercises.findIndex(e => e.id === sourceExerciseId);
    const targetIndex = workout.exercises.findIndex(e => e.id === targetExerciseId);

    if (sourceIndex === -1 || targetIndex === -1) {
        draggedExerciseInfo = null;
        return;
    }

    // Move in memory
    const [moved] = workout.exercises.splice(sourceIndex, 1);
    workout.exercises.splice(targetIndex, 0, moved);

    workout.exercises.forEach((ex, idx) => {
        ex.order_index = idx;
    });

    // Re-render immediately
    renderWorkoutsList(state.workouts);

    draggedExerciseInfo = null;

    // Persist new order on backend
    try {
        const orderedIds = workout.exercises.map(e => e.id);
        await apiRequest('/api/exercises/reorder', {
            method: 'POST',
            body: JSON.stringify({
                workout_id: targetWorkoutId,
                ordered_ids: orderedIds
            })
        });
        showToast('Ordem dos exercícios atualizada! ✓', 'success');
    } catch (err) {
        console.error('Falha ao salvar reordenação:', err);
        showToast('Erro ao salvar nova ordem dos exercícios.', 'error');
        fetchWorkouts(state.selectedStudentId);
    }
}

// ==========================================================================
// MODAL CONTROLLERS (OPEN / CLOSE / POPULATE)
// ==========================================================================
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('hidden');
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('hidden');
        // Reset corresponding forms inside the modal
        const form = modal.querySelector('form');
        if (form) form.reset();
        
        // Teardown video player to prevent background audio playback
        if (modalId === 'modal-video-player') {
            const frameContainer = document.getElementById('video-player-frame-container');
            if (frameContainer) {
                frameContainer.innerHTML = '';
            }
        }

        // Also clean up live video preview boxes
        const wp = document.getElementById('exercise-video-preview-box');
        if (wp) { wp.innerHTML = ''; wp.classList.add('hidden'); }
        const cp = document.getElementById('catalog-exercise-video-preview-box');
        if (cp) { cp.innerHTML = ''; cp.classList.add('hidden'); }
    }
}

// Student Modal triggers
document.getElementById('btn-add-student-modal').addEventListener('click', () => {
    document.getElementById('form-student').reset();
    document.getElementById('modal-student-title').innerText = 'Cadastrar Novo Aluno';
    document.getElementById('student-form-id').value = '';
    document.getElementById('student-password-container').style.display = 'block';
    document.getElementById('student-password').required = true;
    const ageInput = document.getElementById('student-age');
    if (ageInput) ageInput.value = '';
    const goalDateInput = document.getElementById('student-goal-date');
    if (goalDateInput) goalDateInput.value = '';
    openModal('modal-student');
});

document.getElementById('btn-edit-student').addEventListener('click', () => {
    const student = state.students.find(s => s.id === state.selectedStudentId);
    if (!student) return;
    
    document.getElementById('modal-student-title').innerText = 'Editar Perfil do Aluno';
    document.getElementById('student-form-id').value = student.id;
    document.getElementById('student-name').value = student.name;
    document.getElementById('student-phone').value = student.phone;
    document.getElementById('student-password-container').style.display = 'block';
    document.getElementById('student-password').required = false; // password is optional when editing
    document.getElementById('student-password').placeholder = 'Deixe em branco para manter a senha atual';
    const ageInput = document.getElementById('student-age');
    if (ageInput) ageInput.value = student.age || '';
    document.getElementById('student-weight').value = student.weight || '';
    document.getElementById('student-height').value = student.height || '';
    document.getElementById('student-goals').value = student.goals || '';
    const goalDateInput = document.getElementById('student-goal-date');
    if (goalDateInput) {
        goalDateInput.value = student.goal_date ? (student.goal_date.includes('T') ? student.goal_date.split('T')[0] : student.goal_date) : '';
    }
    openModal('modal-student');
});

document.getElementById('btn-delete-student').addEventListener('click', () => {
    if (state.selectedStudentId) {
        deleteStudent(state.selectedStudentId);
    }
});

// Helper to configure days selector checkboxes visually
function setupWorkoutDays(daysStr = '') {
    const daysList = daysStr ? daysStr.split(',').map(d => d.trim()) : [];
    document.querySelectorAll('input[name="workout-days"]').forEach(input => {
        const isChecked = daysList.includes(input.value);
        input.checked = isChecked;
        const parent = input.parentElement;
        if (parent) {
            parent.classList.toggle('selected', isChecked);
            parent.style.background = isChecked ? 'var(--primary-color)' : 'rgba(255,255,255,0.05)';
            parent.style.borderColor = isChecked ? 'var(--primary-color)' : 'rgba(255,255,255,0.1)';
        }
    });
}

// Workout Modal triggers
document.getElementById('btn-add-workout-modal').addEventListener('click', () => {
    document.getElementById('modal-workout-title').innerText = 'Criar Ficha de Treino';
    document.getElementById('workout-form-id').value = '';
    document.getElementById('workout-title').value = '';
    document.getElementById('workout-description').value = '';
    document.getElementById('workout-start-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('workout-end-date').value = '';
    setupWorkoutDays('');
    openModal('modal-workout');
});

function openEditWorkout(workoutId) {
    const workout = state.workouts.find(w => w.id === workoutId);
    if (!workout) return;
    
    document.getElementById('modal-workout-title').innerText = 'Editar Ficha de Treino';
    document.getElementById('workout-form-id').value = workout.id;
    document.getElementById('workout-title').value = workout.title;
    document.getElementById('workout-description').value = workout.description || '';
    document.getElementById('workout-start-date').value = workout.start_date || '';
    document.getElementById('workout-end-date').value = workout.end_date || '';
    setupWorkoutDays(workout.days_of_week || '');
    openModal('modal-workout');
}

// Exercise Modal triggers
function openAddExercise(workoutId) {
    document.getElementById('modal-exercise-title').innerText = 'Adicionar Exercício';
    document.getElementById('exercise-form-id').value = '';
    document.getElementById('exercise-workout-id').value = workoutId;
    document.getElementById('exercise-catalog-select').value = '';
    document.getElementById('exercise-catalog-selector-group').style.display = 'block';
    populateCatalogSelector();
    openModal('modal-exercise');
}

function openEditExercise(workoutId, exerciseId) {
    const workout = state.workouts.find(w => w.id === workoutId);
    if (!workout) return;
    
    const ex = workout.exercises.find(e => e.id === exerciseId);
    if (!ex) return;
    
    document.getElementById('modal-exercise-title').innerText = 'Editar Exercício';
    document.getElementById('exercise-form-id').value = ex.id;
    document.getElementById('exercise-workout-id').value = workoutId;
    document.getElementById('exercise-name').value = ex.name;
    document.getElementById('exercise-sets').value = ex.sets;
    document.getElementById('exercise-repetitions').value = ex.repetitions;
    document.getElementById('exercise-rest').value = ex.rest_time;
    document.getElementById('exercise-video').value = ex.video_url || '';
    document.getElementById('exercise-catalog-selector-group').style.display = 'none';
    openModal('modal-exercise');
}

// ==========================================================================
// OUTRAS INICIALIZAÇÕES & EVENT LISTENERS
// ==========================================================================
function setupEventListeners() {
    // 1. Password reveal toggle
    const togglePass = document.getElementById('toggle-password');
    if (togglePass) {
        togglePass.addEventListener('click', () => {
            const passInput = document.getElementById('login-password');
            const icon = togglePass.querySelector('i');
            if (passInput.type === 'password') {
                passInput.type = 'text';
                icon.className = 'fa-solid fa-eye-slash';
            } else {
                passInput.type = 'password';
                icon.className = 'fa-regular fa-eye';
            }
        });
    }

    // 2. Login submit form
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const phone = document.getElementById('login-phone').value;
            const password = document.getElementById('login-password').value;
            handleLogin(phone, password);
        });
    }

    // 3. Logouts buttons
    document.getElementById('btn-logout').addEventListener('click', logout);
    document.getElementById('btn-student-logout').addEventListener('click', logout);

    // 4. Close modal buttons generic listener
    document.querySelectorAll('.btn-close-modal').forEach(btn => {
        btn.addEventListener('click', () => {
            const openModal = btn.closest('.modal');
            if (openModal) {
                closeModal(openModal.id);
            }
        });
    });

    // 5. Submit form handlers
    document.getElementById('form-student').addEventListener('submit', handleStudentSubmit);
    document.getElementById('form-workout').addEventListener('submit', handleWorkoutSubmit);
    document.getElementById('form-exercise').addEventListener('submit', handleExerciseSubmit);
    document.getElementById('form-catalog-exercise').addEventListener('submit', handleCatalogExerciseSubmit);

    // 6. Dynamic student search filter
    const searchInput = document.getElementById('student-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const q = e.target.value.toLowerCase().trim();
            const filtered = state.students.filter(student => 
                student.name.toLowerCase().includes(q) || 
                student.phone.toLowerCase().includes(q)
            );
            renderStudentsList(filtered);
        });
    }

    // 7. Catalog search filter
    const catalogSearchInput = document.getElementById('catalog-search');
    if (catalogSearchInput) {
        catalogSearchInput.addEventListener('input', (e) => {
            const q = e.target.value.toLowerCase().trim();
            const filtered = state.catalogExercises.filter(ex => {
                const matchesName = ex.name.toLowerCase().includes(q);
                const matchesGroup = !state.catalogFilterGroup || ex.muscle_group === state.catalogFilterGroup;
                return matchesName && matchesGroup;
            });
            renderCatalogList(filtered);
        });
    }

    // 8. Catalog modal open button
    document.getElementById('btn-add-catalog-modal').addEventListener('click', () => {
        document.getElementById('form-catalog-exercise').reset();
        document.getElementById('modal-catalog-title').innerText = 'Novo Exercício no Catálogo';
        document.getElementById('catalog-form-id').value = '';
        openModal('modal-catalog-exercise');
    });

    // 9. Video live previews in exercise modals
    setupVideoLivePreviews();
}

// ==========================================================================
// MÓDULO DO ALUNO (STUDENT PORTAL & EMBEDDED PLAYER)
// ==========================================================================
async function initStudentPortal() {
    const studentMain = document.querySelector('.student-main');
    
    // Solicita permissão para notificações do navegador se suportado
    if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission().catch(() => {});
    }

    // Carrega notificações do aluno
    fetchStudentNotifications();

    try {
        const workouts = await apiRequest('/api/student-portal/my-workouts');
        state.studentWorkouts = workouts;
        
        if (workouts.length > 0 && !state.activeStudentWorkoutId) {
            state.activeStudentWorkoutId = workouts[0].id;
        }
        
        renderStudentPortal();
    } catch (e) {
        studentMain.innerHTML = `
            <div class="glass-card" style="padding: 40px; text-align: center; max-width: 600px; margin: 100px auto;">
                <i class="fa-solid fa-triangle-exclamation" style="font-size: 2.5rem; color: var(--danger); margin-bottom: 20px;"></i>
                <h3>Falha ao carregar seus treinos</h3>
                <p style="color: var(--text-secondary); margin-top: 10px;">Verifique sua conexão e recarregue a página.</p>
                <button class="btn-primary" onclick="initStudentPortal()" style="margin-top: 20px;">Tentar Novamente</button>
            </div>
        `;
    }
}

function renderStudentPortal() {
    const studentMain = document.querySelector('.student-main');
    
    // 1. Calculate Weekly Schedule Timeline
    const daysOfWeekList = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
    const daysShort = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
    
    // Get current day of the week in Portuguese
    const dateOptions = { weekday: 'long' };
    let currentDayRaw = new Intl.DateTimeFormat('pt-BR', dateOptions).format(new Date());
    // Normalize to: capitalize first letter, remove "-feira"
    let currentDayName = currentDayRaw.charAt(0).toUpperCase() + currentDayRaw.slice(1);
    if (currentDayName.includes('-feira')) {
        currentDayName = currentDayName.split('-')[0];
    }
    
    // Safety check for accent characters
    const dayMapping = {
        'Segunda': 'Segunda', 'Terca': 'Terça', 'Terça': 'Terça',
        'Quarta': 'Quarta', 'Quinta': 'Quinta', 'Sexta': 'Sexta',
        'Sabado': 'Sábado', 'Sábado': 'Sábado', 'Domingo': 'Domingo'
    };
    const currentDayMatched = dayMapping[currentDayName] || 'Segunda';

    // Auto-initialize selected timeline day to today
    if (!state.selectedTimelineDay) {
        state.selectedTimelineDay = currentDayMatched;
        
        // Auto-select active workout for today if it exists
        const workoutsForToday = state.studentWorkouts.filter(w => 
            w.days_of_week && w.days_of_week.includes(currentDayMatched)
        );
        if (workoutsForToday.length > 0) {
            state.activeStudentWorkoutId = workoutsForToday[0].id;
        } else if (state.studentWorkouts.length > 0) {
            state.activeStudentWorkoutId = null; // rest day by default
        }
    }

    const activeWorkout = state.studentWorkouts.find(w => w.id === state.activeStudentWorkoutId);
    let totalExercises = 0;
    let completedExercises = 0;
    
    if (activeWorkout && activeWorkout.exercises) {
        totalExercises = activeWorkout.exercises.length;
        completedExercises = activeWorkout.exercises.filter(ex => ex.completed_today).length;
    }
    
    const progressPercent = totalExercises > 0 ? Math.round((completedExercises / totalExercises) * 100) : 0;
    
    // Calculate IMC for welcome stats
    const weight = state.user.weight;
    const height = state.user.height;
    let imcHtml = '--';
    if (weight && height) {
        const imc = (weight / (height * height)).toFixed(1);
        imcHtml = `IMC: ${imc}`;
    }
    
    // Welcome Banner HTML
    const welcomeHtml = `
        <div class="welcome-banner glass-card">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 14px;">
                <div>
                    <h1>Bora treinar, ${state.user.name.split(' ')[0]}! 💪</h1>
                    <p>Foco nos seus objetivos: <strong>${state.user.goals || 'Manter saúde e constância.'}</strong></p>
                </div>
                <div class="profile-stats" style="margin-bottom: 0; display: flex; gap: 10px; flex-wrap: wrap;">
                    <div class="stat-box" style="padding: 8px 16px; background: rgba(255,255,255,0.02);">
                        <span class="stat-label">Idade</span>
                        <span class="stat-value" style="font-size: 1.05rem;">${state.user.age ? `${state.user.age} anos` : '--'}</span>
                    </div>
                    <div class="stat-box" style="padding: 8px 16px; background: rgba(255,255,255,0.02);">
                        <span class="stat-label">Peso</span>
                        <span class="stat-value" style="font-size: 1.05rem;">${weight ? `${weight} kg` : '--'}</span>
                    </div>
                    <div class="stat-box" style="padding: 8px 16px; background: rgba(255,255,255,0.02);">
                        <span class="stat-label">Altura</span>
                        <span class="stat-value" style="font-size: 1.05rem;">${height ? `${height} m` : '--'}</span>
                    </div>
                    <div class="stat-box" style="padding: 8px 16px; background: rgba(255,255,255,0.02);">
                        <span class="stat-label">Físico</span>
                        <span class="stat-value" style="font-size: 1.05rem;">${imcHtml}</span>
                    </div>
                    ${state.user.goal_date ? (() => {
                        const raw = state.user.goal_date.includes('T') ? state.user.goal_date.split('T')[0] : state.user.goal_date;
                        const p = raw.split('-');
                        const dt = p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : raw;
                        return `
                        <div class="stat-box" style="padding: 8px 16px; background: rgba(255, 68, 68, 0.08); border: 1px solid rgba(255, 68, 68, 0.25);">
                            <span class="stat-label" style="color: #ff8888;"><i class="fa-solid fa-bullseye"></i> Meta</span>
                            <span class="stat-value" style="font-size: 1.05rem; color: #fff;">${dt}</span>
                        </div>`;
                    })() : ''}
                </div>
            </div>
            
            ${totalExercises > 0 ? `
                <div class="progress-section">
                    <div class="progress-bar-container">
                        <div class="progress-bar-fill" style="width: ${progressPercent}%;"></div>
                    </div>
                    <span class="progress-percentage">${progressPercent}% Concluído</span>
                </div>
            ` : ''}
        </div>
    `;

    // Build timeline items
    const timelineHtml = `
        <div class="weekly-timeline-container glass-card" style="margin-top: 20px; padding: 20px;">
            <h3 style="font-size: 1rem; font-weight: 600; margin-bottom: 15px; display: flex; align-items: center; gap: 8px;">
                <i class="fa-regular fa-calendar-check" style="color: var(--primary-color);"></i> Cronograma Semanal de Treinos
            </h3>
            <div class="weekly-days-grid" style="text-align: center;">
                ${daysOfWeekList.map((dayName, idx) => {
                    const isToday = dayName === currentDayMatched;
                    const isSelected = dayName === state.selectedTimelineDay;
                    
                    // Find workouts scheduled for this day
                    const workoutsForDay = state.studentWorkouts.filter(w => 
                        w.days_of_week && w.days_of_week.includes(dayName)
                    );
                    
                    let dayTreinoTitle = 'Descanso';
                    hasTreino = false;
                    
                    if (workoutsForDay.length > 0) {
                        dayTreinoTitle = workoutsForDay[0].title;
                        hasTreino = true;
                    }
                    
                    const pillClasses = ['timeline-day-pill'];
                    if (isToday) pillClasses.push('is-today');
                    if (isSelected) pillClasses.push('selected');
                    if (hasTreino) {
                        pillClasses.push('has-workout');
                    } else {
                        pillClasses.push('is-rest');
                    }
                    
                    const activePill = isToday ? `<span class="today-badge" style="font-size: 0.62rem; background: rgba(255,255,255,0.25); color: #fff; padding: 2px 6px; border-radius: 10px; font-weight: 600; display: inline-block; margin-top: 4px;">HOJE</span>` : '';
                    
                    return `
                        <div class="${pillClasses.join(' ')}" onclick="selectTimelineDay('${dayName}')" style="cursor: pointer;">
                            <span class="day-name" style="font-size: 0.75rem; text-transform: uppercase; font-weight: 600; color: var(--text-secondary);">${daysShort[idx]}</span>
                            <div class="day-status" style="font-size: 0.65rem; font-weight: 500; margin-top: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; display: flex; align-items: center; gap: 2px; justify-content: center; color: ${hasTreino ? '#fff' : 'rgba(255,255,255,0.3)'};">
                                ${hasTreino ? `<i class="fa-solid fa-dumbbell" style="font-size: 0.65rem; color: var(--primary-color);"></i>` : '<i class="fa-solid fa-bed" style="font-size: 0.65rem;"></i>'} 
                                ${hasTreino ? 'Treino' : 'Descanso'}
                            </div>
                            ${activePill}
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;

    // Calculate alert banner for expired or expiring workouts
    let alertBannerHtml = '';
    const expiredWorkouts = (state.studentWorkouts || []).filter(w => w.status === 'expired');
    const expiringTodayWorkouts = (state.studentWorkouts || []).filter(w => w.status === 'expiring_today');
    const expiringSoonWorkouts = (state.studentWorkouts || []).filter(w => w.status === 'expiring_soon');

    if (expiredWorkouts.length > 0) {
        const w = expiredWorkouts[0];
        const daysAgo = Math.abs(w.days_remaining || 0);
        alertBannerHtml = `
            <div class="workout-deadline-alert-banner alert-banner-expired">
                <div style="display: flex; align-items: center; gap: 14px;">
                    <i class="fa-solid fa-triangle-exclamation alert-banner-icon" style="color: #ef4444;"></i>
                    <div class="alert-banner-text">
                        <h4>Atenção: Ficha de Treino Vencida!</h4>
                        <p>O prazo do seu treino <strong>"${w.title}"</strong> encerrou há ${daysAgo} dia(s). Entre em contato com seu professor/treinador para agendar sua reavaliação física e montar seu novo treino!</p>
                    </div>
                </div>
                <button class="btn-primary" onclick="openNotificationsModal()" style="padding: 8px 16px; font-size: 0.85rem; background: #ef4444; border-color: #dc2626; cursor: pointer;">
                    Ver Detalhes
                </button>
            </div>
        `;
    } else if (expiringTodayWorkouts.length > 0) {
        const w = expiringTodayWorkouts[0];
        alertBannerHtml = `
            <div class="workout-deadline-alert-banner alert-banner-expiring-today">
                <div style="display: flex; align-items: center; gap: 14px;">
                    <i class="fa-solid fa-bell alert-banner-icon" style="color: #f97316;"></i>
                    <div class="alert-banner-text">
                        <h4>O Prazo do seu Treino Encerra Hoje!</h4>
                        <p>Hoje é o último dia da ficha <strong>"${w.title}"</strong>. Comunique seu treinador para preparar sua próxima fase de treinos!</p>
                    </div>
                </div>
                <button class="btn-primary" onclick="openNotificationsModal()" style="padding: 8px 16px; font-size: 0.85rem; background: #f97316; border-color: #ea580c; cursor: pointer;">
                    Ver Notificação
                </button>
            </div>
        `;
    } else if (expiringSoonWorkouts.length > 0) {
        const w = expiringSoonWorkouts[0];
        alertBannerHtml = `
            <div class="workout-deadline-alert-banner alert-banner-expiring-soon">
                <div style="display: flex; align-items: center; gap: 14px;">
                    <i class="fa-solid fa-clock alert-banner-icon" style="color: #eab308;"></i>
                    <div class="alert-banner-text">
                        <h4>Seu Treino Vence em Breve</h4>
                        <p>Faltam apenas <strong>${w.days_remaining} dia(s)</strong> para o término da ficha <strong>"${w.title}"</strong>. Foco na reta final!</p>
                    </div>
                </div>
            </div>
        `;
    }

    // Active workout deadline card
    let activeWorkoutDeadlineInfo = '';
    if (activeWorkout && (activeWorkout.start_date || activeWorkout.end_date)) {
        const startFmt = activeWorkout.start_date ? new Date(activeWorkout.start_date + 'T00:00:00').toLocaleDateString('pt-BR') : 'Início imediato';
        const endFmt = activeWorkout.end_date ? new Date(activeWorkout.end_date + 'T00:00:00').toLocaleDateString('pt-BR') : 'Sem prazo final';
        let badge = '';
        if (activeWorkout.status === 'expired') {
            badge = `<span class="workout-status-badge badge-status-expired"><i class="fa-solid fa-triangle-exclamation"></i> Vencido há ${Math.abs(activeWorkout.days_remaining || 0)} dia(s)</span>`;
        } else if (activeWorkout.status === 'expiring_today') {
            badge = `<span class="workout-status-badge badge-status-expiring-today"><i class="fa-solid fa-bell"></i> Vence Hoje!</span>`;
        } else if (activeWorkout.status === 'expiring_soon') {
            badge = `<span class="workout-status-badge badge-status-expiring-soon"><i class="fa-solid fa-clock"></i> Vence em ${activeWorkout.days_remaining} dia(s)</span>`;
        } else if (activeWorkout.status === 'active') {
            badge = `<span class="workout-status-badge badge-status-active"><i class="fa-solid fa-circle-check"></i> Válido (${activeWorkout.days_remaining} dias restantes)</span>`;
        }
        activeWorkoutDeadlineInfo = `
            <div class="glass-card" style="margin-top: 15px; padding: 12px 18px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; font-size: 0.85rem;">
                <div style="color: var(--text-secondary);">
                    <i class="fa-regular fa-calendar-check" style="color: var(--primary-color);"></i> <strong>Vigência:</strong> ${startFmt} até ${endFmt}
                </div>
                ${badge}
            </div>
        `;
    }

    // Exercises HTML
    let exercisesHtml = '';
    if (!activeWorkout) {
        if (state.studentWorkouts.length === 0) {
            exercisesHtml = `
                <div class="empty-state glass-card" style="padding: 40px;">
                    <i class="fa-solid fa-clipboard-question" style="font-size: 3rem; color: rgba(255,255,255,0.05); margin-bottom: 16px;"></i>
                    <h4>Nenhuma ficha disponível</h4>
                    <p>Sua professora ainda não vinculou nenhuma ficha de treino ativa para você.</p>
                </div>
            `;
        } else {
            // Scheduled Rest Day!
            exercisesHtml = `
                <div class="empty-state glass-card" style="padding: 50px 20px; text-align: center; margin-top: 20px;">
                    <div style="font-size: 3.5rem; margin-bottom: 20px; filter: drop-shadow(0 0 10px rgba(6, 182, 212, 0.2));">😴</div>
                    <h3 style="font-size: 1.3rem; font-weight: 700; color: #fff; margin-bottom: 10px;">Dia de Descanso e Recuperação</h3>
                    <p style="color: var(--text-secondary); max-width: 450px; margin: 0 auto; font-size: 0.92rem; line-height: 1.6;">
                        Não há treinos agendados para <strong>${state.selectedTimelineDay}</strong>. Aproveite para descansar a musculatura, se manter hidratado e se recuperar para o próximo treino! 💧
                    </p>
                </div>
            `;
        }
    } else if (!activeWorkout.exercises || activeWorkout.exercises.length === 0) {
        exercisesHtml = `
            <div class="empty-state glass-card" style="padding: 40px; margin-top: 20px;">
                <i class="fa-solid fa-dumbbell" style="font-size: 3rem; color: rgba(255,255,255,0.05); margin-bottom: 16px;"></i>
                <h4>Ficha "${activeWorkout.title}" vazia</h4>
                <p>Não há exercícios cadastrados nesta ficha. Aguarde a professora adicionar.</p>
            </div>
        `;
    } else {
        exercisesHtml = `
            ${activeWorkoutDeadlineInfo}
            <div class="student-exercises-list" style="margin-top: 20px;">
                ${activeWorkout.exercises.map((ex, idx) => `
                    <div class="student-exercise-card glass-card ${ex.completed_today ? 'completed' : ''}">
                        <div class="student-exercise-left">
                            <div class="checkbox-wrapper" onclick="toggleExerciseCompletion('${ex.id}', ${ex.completed_today})">
                                <div class="checkbox-custom">
                                    <i class="fa-solid fa-check"></i>
                                </div>
                            </div>
                            <div class="student-exercise-info">
                                <h4 class="student-exercise-title">${idx + 1}. ${ex.name}</h4>
                                <div class="exercise-specs" style="margin-top: 6px;">
                                    <span class="spec-item"><i class="fa-solid fa-repeat"></i> ${ex.sets}x</span>
                                    <span class="spec-item"><i class="fa-solid fa-dumbbell"></i> ${ex.repetitions}</span>
                                    <span class="spec-item"><i class="fa-regular fa-clock"></i> Descanso: ${ex.rest_time}</span>
                                </div>
                            </div>
                        </div>
                        
                        ${ex.video_url ? `
                            <div>
                                <button class="btn-secondary btn-video-watch" onclick="playDemonstrationVideo('${ex.name}', '${ex.video_url}')">
                                    <i class="fa-brands fa-youtube"></i> Execução
                                </button>
                            </div>
                        ` : ''}
                    </div>
                `).join('')}
            </div>
        `;
    }
    
    studentMain.innerHTML = alertBannerHtml + welcomeHtml + timelineHtml + exercisesHtml;
}

function selectTimelineDay(dayName) {
    state.selectedTimelineDay = dayName;
    
    // Find workouts scheduled for this day
    const workoutsForDay = state.studentWorkouts.filter(w => 
        w.days_of_week && w.days_of_week.includes(dayName)
    );
    
    if (workoutsForDay.length > 0) {
        state.activeStudentWorkoutId = workoutsForDay[0].id;
    } else {
        state.activeStudentWorkoutId = null; // rest day!
    }
    
    renderStudentPortal();
}

async function toggleExerciseCompletion(exerciseId, isCompletedToday) {
    try {
        if (isCompletedToday) {
            // Undo completion
            await apiRequest(`/api/student-portal/exercises/${exerciseId}/complete`, {
                method: 'DELETE'
            });
            showToast('Conclusão de exercício desfeita.', 'info');
        } else {
            // Check in
            await apiRequest(`/api/student-portal/exercises/${exerciseId}/complete`, {
                method: 'POST'
            });
            showToast('Exercício concluído! Excelente trabalho!', 'success');
        }
        
        // Refresh portal instantly
        initStudentPortal();
    } catch (e) {
        showToast(e.message || 'Erro ao atualizar conclusão.', 'error');
    }
}

// Parse and play YouTube / Vimeo embeds
function playDemonstrationVideo(exerciseName, videoUrl) {
    const container = document.getElementById('video-player-frame-container');
    const title = document.getElementById('video-player-title');
    const modalContent = document.querySelector('.modal-video-content');
    const wrapper = document.querySelector('.video-container-wrapper');
    
    title.innerText = `Execução: ${exerciseName}`;
    
    const isShorts = videoUrl.includes('/shorts/') || videoUrl.includes('youtube.com/shorts');
    
    // Adapt aspect ratio and size for vertical YouTube Shorts
    if (isShorts) {
        if (modalContent) modalContent.style.maxWidth = '380px';
        if (wrapper) wrapper.style.paddingBottom = '177.78%'; // 9:16 aspect ratio
    } else {
        if (modalContent) modalContent.style.maxWidth = '800px';
        if (wrapper) wrapper.style.paddingBottom = '56.25%'; // 16:9 aspect ratio
    }
    
    // Check if YouTube
    const ytUrl = parseYouTubeUrl(videoUrl);
    // Check if Vimeo
    const vimeoUrl = parseVimeoUrl(videoUrl);
    
    if (ytUrl) {
        container.innerHTML = `
            <iframe src="${ytUrl}" 
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" 
                    allowfullscreen>
            </iframe>
        `;
    } else if (vimeoUrl) {
        container.innerHTML = `
            <iframe src="${vimeoUrl}" 
                    allow="autoplay; fullscreen; picture-in-picture" 
                    allowfullscreen>
            </iframe>
        `;
    } else {
        // Fallback: raw video element (mp4, etc) or plain link if it's not a standard direct video
        const isDirectVideo = videoUrl.endsWith('.mp4') || videoUrl.endsWith('.webm') || videoUrl.endsWith('.ogg');
        if (isDirectVideo) {
            container.innerHTML = `
                <video controls autoplay style="width:100%; height:100%; border-radius: var(--radius-md);">
                    <source src="${videoUrl}" type="video/mp4">
                    Seu navegador não suporta a exibição de vídeos.
                </video>
            `;
        } else {
            container.innerHTML = `
                <div style="padding: 40px; text-align: center; color: var(--text-secondary);">
                    <i class="fa-solid fa-link" style="font-size: 2.5rem; margin-bottom: 16px; color: var(--primary);"></i>
                    <p>O link fornecido não pode ser embutido diretamente.</p>
                    <a href="${videoUrl}" target="_blank" class="btn-primary" style="margin-top: 20px; text-decoration: none;">
                        Abrir Link em Nova Aba <i class="fa-solid fa-up-right-from-square"></i>
                    </a>
                </div>
            `;
        }
    }
    
    openModal('modal-video-player');
}

function parseYouTubeUrl(url) {
    // Check for YouTube Shorts first
    const shortsRegExp = /youtube\.com\/shorts\/([^#\&\?]*)/;
    const shortsMatch = url.match(shortsRegExp);
    if (shortsMatch && shortsMatch[1]) {
        return `https://www.youtube.com/embed/${shortsMatch[1]}?autoplay=1&rel=0`;
    }

    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    if (match && match[2].length === 11) {
        return `https://www.youtube.com/embed/${match[2]}?autoplay=1&rel=0`;
    }
    return null;
}

function parseVimeoUrl(url) {
    const regExp = /vimeo\.com\/(?:video\/)?([0-9]+)/;
    const match = url.match(regExp);
    if (match && match[1]) {
        return `https://player.vimeo.com/video/${match[1]}?autoplay=1&color=06b6d4`;
    }
    return null;
}

// Expose modal player globally
window.playDemonstrationVideo = playDemonstrationVideo;
window.parseYouTubeUrl = parseYouTubeUrl;
window.parseVimeoUrl = parseVimeoUrl;

// Build embedded iframe or video player for inline viewing and previews
function buildVideoEmbedHtml(videoUrl, title) {
    if (!videoUrl) return '';
    const isShorts = videoUrl.includes('/shorts/') || videoUrl.includes('youtube.com/shorts');
    const ytUrl = parseYouTubeUrl(videoUrl);
    const vimeoUrl = parseVimeoUrl(videoUrl);
    const aspectClass = isShorts ? 'aspect-vertical' : 'aspect-widescreen';

    if (ytUrl) {
        return `
            <div class="video-embed-box ${aspectClass}">
                <iframe src="${ytUrl}" 
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                        allowfullscreen>
                </iframe>
            </div>
        `;
    } else if (vimeoUrl) {
        return `
            <div class="video-embed-box ${aspectClass}">
                <iframe src="${vimeoUrl}" 
                        allow="autoplay; fullscreen; picture-in-picture" 
                        allowfullscreen>
                </iframe>
            </div>
        `;
    } else {
        const isDirectVideo = videoUrl.endsWith('.mp4') || videoUrl.endsWith('.webm') || videoUrl.endsWith('.ogg');
        if (isDirectVideo) {
            return `
                <div class="video-embed-box ${aspectClass}">
                    <video controls autoplay style="width:100%; height:100%; border-radius: var(--radius-sm);">
                        <source src="${videoUrl}" type="video/mp4">
                    </video>
                </div>
            `;
        } else {
            return `
                <div class="video-embed-fallback">
                    <p><i class="fa-solid fa-video"></i> Link de vídeo demonstrativo:</p>
                    <a href="${videoUrl}" target="_blank" class="btn-primary-sm" style="text-decoration:none;">
                        Abrir em nova aba <i class="fa-solid fa-arrow-up-right-from-square"></i>
                    </a>
                </div>
            `;
        }
    }
}
window.buildVideoEmbedHtml = buildVideoEmbedHtml;

function toggleInlineExerciseVideo(id, name, videoUrl) {
    const el = document.getElementById(`inline-video-${id}`);
    if (!el) return;
    if (!el.classList.contains('hidden')) {
        el.innerHTML = '';
        el.classList.add('hidden');
    } else {
        el.innerHTML = `
            <div class="inline-video-header">
                <span><i class="fa-solid fa-play"></i> ${escapeHtml(name)}</span>
                <button type="button" class="btn-close-inline" onclick="toggleInlineExerciseVideo('${id}')" title="Fechar prévia">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            ${buildVideoEmbedHtml(videoUrl, name)}
        `;
        el.classList.remove('hidden');
    }
}
window.toggleInlineExerciseVideo = toggleInlineExerciseVideo;

function toggleInlineCatalogVideo(id, name, videoUrl) {
    const el = document.getElementById(`inline-catalog-video-${id}`);
    if (!el) return;
    if (!el.classList.contains('hidden')) {
        el.innerHTML = '';
        el.classList.add('hidden');
    } else {
        el.innerHTML = `
            <div class="inline-video-header">
                <span><i class="fa-solid fa-play"></i> ${escapeHtml(name)}</span>
                <button type="button" class="btn-close-inline" onclick="toggleInlineCatalogVideo('${id}')" title="Fechar prévia">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            ${buildVideoEmbedHtml(videoUrl, name)}
        `;
        el.classList.remove('hidden');
    }
}
window.toggleInlineCatalogVideo = toggleInlineCatalogVideo;

function setupVideoLivePreviews() {
    const attachLivePreview = (inputId, btnId, previewBoxId) => {
        const input = document.getElementById(inputId);
        const btn = document.getElementById(btnId);
        const box = document.getElementById(previewBoxId);
        if (!input || !box) return;

        const renderPreview = () => {
            const url = input.value.trim();
            if (!url) {
                box.innerHTML = '';
                box.classList.add('hidden');
                return;
            }
            box.innerHTML = `
                <div class="preview-box-header">
                    <span><i class="fa-solid fa-video"></i> Prévia Integrada do Vídeo</span>
                    <button type="button" class="btn-close-inline" onclick="this.closest('.modal-video-preview-box').classList.add('hidden'); this.closest('.modal-video-preview-box').innerHTML='';" title="Fechar prévia">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
                ${buildVideoEmbedHtml(url, 'Demonstração')}
            `;
            box.classList.remove('hidden');
        };

        if (btn) {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                renderPreview();
            });
        }
        input.addEventListener('change', renderPreview);
        input.addEventListener('blur', () => {
            if (input.value.trim()) renderPreview();
        });
    };

    attachLivePreview('exercise-video', 'btn-preview-workout-video', 'exercise-video-preview-box');
    attachLivePreview('catalog-exercise-video', 'btn-preview-catalog-video', 'catalog-exercise-video-preview-box');
}
window.setupVideoLivePreviews = setupVideoLivePreviews;


// ==========================================================================
// ADMIN TAB SWITCHING SYSTEM
// ==========================================================================
function switchAdminTab(tabId) {
    // Toggle tab buttons
    document.querySelectorAll('.admin-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    
    // Toggle tab content
    document.querySelectorAll('.admin-tab-content').forEach(content => {
        content.classList.add('hidden');
    });
    const activeContent = document.getElementById(tabId);
    if (activeContent) {
        activeContent.classList.remove('hidden');
    }
    
    // Load catalog data when switching to catalog tab
    if (tabId === 'tab-catalog') {
        fetchCatalogExercises();
    } else if (tabId === 'tab-deadlines') {
        fetchExpiringWorkoutsAdmin();
    }
}


// ==========================================================================
// MÓDULO DO CATÁLOGO DE EXERCÍCIOS (CRUD)
// ==========================================================================
async function fetchCatalogExercises() {
    const listContainer = document.getElementById('catalog-list');
    
    try {
        const exercises = await apiRequest('/api/catalog');
        state.catalogExercises = exercises;
        renderCatalogList(exercises);
    } catch (e) {
        listContainer.innerHTML = `
            <div class="catalog-empty-state">
                <i class="fa-solid fa-triangle-exclamation"></i>
                <h4>Falha ao carregar catálogo</h4>
                <p>Verifique sua conexão e tente novamente.</p>
            </div>
        `;
    }
}

function renderCatalogList(exercisesList) {
    const listContainer = document.getElementById('catalog-list');
    
    if (exercisesList.length === 0) {
        const isFiltering = state.catalogFilterGroup || document.getElementById('catalog-search').value;
        listContainer.innerHTML = `
            <div class="catalog-empty-state">
                <i class="fa-solid fa-${isFiltering ? 'filter-circle-xmark' : 'book-open'}"></i>
                <h4>${isFiltering ? 'Nenhum exercício encontrado' : 'Catálogo vazio'}</h4>
                <p>${isFiltering 
                    ? 'Nenhum exercício corresponde aos filtros aplicados.' 
                    : 'Cadastre seu primeiro exercício clicando em "Novo Exercício" acima.'
                }</p>
            </div>
        `;
        return;
    }
    
    listContainer.innerHTML = exercisesList.map(ex => `
        <div class="catalog-card" id="catalog-card-${ex.id}">
            <div class="catalog-card-header">
                <h4>${escapeHtml(ex.name)}</h4>
                <div class="catalog-card-actions">
                    <button class="btn-icon-sm" onclick="openEditCatalogExercise('${ex.id}')" title="Editar exercício">
                        <i class="fa-regular fa-pen-to-square"></i>
                    </button>
                    <button class="btn-icon-sm btn-danger" onclick="deleteCatalogExercise('${ex.id}')" title="Excluir exercício">
                        <i class="fa-regular fa-trash-can"></i>
                    </button>
                </div>
            </div>
            ${ex.muscle_group 
                ? `<div><span class="muscle-badge"><i class="fa-solid fa-crosshairs"></i> ${escapeHtml(ex.muscle_group)}</span></div>` 
                : ''
            }
            ${ex.description 
                ? `<p class="catalog-card-description">${escapeHtml(ex.description)}</p>` 
                : ''
            }
            ${ex.video_url 
                ? `
                <div class="catalog-card-video-integrated">
                    <button type="button" class="btn-catalog-video-play" onclick="playDemonstrationVideo('${escapeJs(ex.name)}', '${escapeJs(ex.video_url)}')" title="Assistir vídeo demonstrativo">
                        <i class="fa-solid fa-circle-play"></i> Vídeo Demonstrativo
                    </button>
                    <button type="button" class="btn-icon-sm btn-catalog-inline-toggle" onclick="toggleInlineCatalogVideo('${ex.id}', '${escapeJs(ex.name)}', '${escapeJs(ex.video_url)}')" title="Ver vídeo integrado neste card">
                        <i class="fa-solid fa-film"></i>
                    </button>
                </div>
                <div id="inline-catalog-video-${ex.id}" class="exercise-inline-video hidden"></div>
                ` 
                : ''
            }
        </div>
    `).join('');
}

function filterCatalogByGroup(group) {
    state.catalogFilterGroup = group;
    
    // Toggle active pill
    document.querySelectorAll('.muscle-filter-pill').forEach(pill => {
        pill.classList.toggle('active', pill.dataset.group === group);
    });
    
    // Filter and render
    const searchQuery = document.getElementById('catalog-search').value.toLowerCase().trim();
    const filtered = state.catalogExercises.filter(ex => {
        const matchesGroup = !group || ex.muscle_group === group;
        const matchesSearch = !searchQuery || ex.name.toLowerCase().includes(searchQuery);
        return matchesGroup && matchesSearch;
    });
    renderCatalogList(filtered);
}

async function handleCatalogExerciseSubmit(event) {
    event.preventDefault();
    const id = document.getElementById('catalog-form-id').value;
    const name = document.getElementById('catalog-exercise-name').value;
    const muscle_group = document.getElementById('catalog-exercise-muscle-group').value || null;
    const video_url = document.getElementById('catalog-exercise-video').value || null;
    const description = document.getElementById('catalog-exercise-description').value || null;
    
    const payload = { name, muscle_group, video_url, description };
    
    try {
        if (id) {
            await apiRequest(`/api/catalog/${id}`, {
                method: 'PUT',
                body: JSON.stringify(payload)
            });
            showToast('Exercício do catálogo atualizado!', 'success');
        } else {
            await apiRequest('/api/catalog', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            showToast('Exercício adicionado ao catálogo!', 'success');
        }
        
        closeModal('modal-catalog-exercise');
        fetchCatalogExercises();
    } catch (e) {
        showToast(e.message || 'Erro ao salvar exercício no catálogo.', 'error');
    }
}

function openEditCatalogExercise(exerciseId) {
    const ex = state.catalogExercises.find(e => e.id === exerciseId);
    if (!ex) return;
    
    document.getElementById('modal-catalog-title').innerText = 'Editar Exercício do Catálogo';
    document.getElementById('catalog-form-id').value = ex.id;
    document.getElementById('catalog-exercise-name').value = ex.name;
    document.getElementById('catalog-exercise-muscle-group').value = ex.muscle_group || '';
    document.getElementById('catalog-exercise-video').value = ex.video_url || '';
    document.getElementById('catalog-exercise-description').value = ex.description || '';
    openModal('modal-catalog-exercise');
}

async function deleteCatalogExercise(exerciseId) {
    if (!confirm('Deseja excluir este exercício do catálogo? Isso não afeta exercícios já adicionados às fichas dos alunos.')) {
        return;
    }
    
    try {
        await apiRequest(`/api/catalog/${exerciseId}`, {
            method: 'DELETE'
        });
        showToast('Exercício removido do catálogo!', 'success');
        fetchCatalogExercises();
    } catch (e) {
        showToast(e.message || 'Falha ao excluir exercício do catálogo.', 'error');
    }
}


// ==========================================================================
// CATALOG SELECTOR IN EXERCISE MODAL
// ==========================================================================
async function populateCatalogSelector() {
    const select = document.getElementById('exercise-catalog-select');
    if (!select) return;
    
    // Fetch catalog if not already loaded
    if (state.catalogExercises.length === 0) {
        try {
            const exercises = await apiRequest('/api/catalog');
            state.catalogExercises = exercises;
        } catch (e) {
            // Silently fail — manual entry still works
        }
    }
    
    // Build options grouped by muscle group
    select.innerHTML = '<option value="">-- Digitar manualmente --</option>';
    
    const groups = {};
    state.catalogExercises.forEach(ex => {
        const group = ex.muscle_group || 'Sem grupo';
        if (!groups[group]) groups[group] = [];
        groups[group].push(ex);
    });
    
    Object.keys(groups).sort().forEach(groupName => {
        const optgroup = document.createElement('optgroup');
        optgroup.label = groupName;
        groups[groupName].forEach(ex => {
            const option = document.createElement('option');
            option.value = ex.id;
            option.textContent = ex.name;
            option.dataset.name = ex.name;
            option.dataset.videoUrl = ex.video_url || '';
            optgroup.appendChild(option);
        });
        select.appendChild(optgroup);
    });
}

function onCatalogExerciseSelected(catalogId) {
    if (!catalogId) return; // Manual entry selected
    
    const exercise = state.catalogExercises.find(ex => ex.id === catalogId);
    if (!exercise) return;
    
    // Auto-fill fields from catalog
    document.getElementById('exercise-name').value = exercise.name;
    if (exercise.video_url) {
        document.getElementById('exercise-video').value = exercise.video_url;
    }
}


// ==========================================================================
// MÓDULO DO PROFESSOR: PAINEL DE ATIVIDADE DO ALUNO
// ==========================================================================
let currentActivityData = null;

async function fetchStudentActivity(studentId, days = 30) {
    const timelineContainer = document.getElementById('activity-timeline');
    const calendarGrid = document.getElementById('activity-calendar-grid');
    
    if (timelineContainer) {
        timelineContainer.innerHTML = `
            <div class="loading-state">
                <i class="fa-solid fa-circle-notch fa-spin"></i>
                <p>Carregando atividades...</p>
            </div>
        `;
    }
    
    try {
        const data = await apiRequest(`/api/students/${studentId}/activity?days=${days}`);
        currentActivityData = data;
        renderActivityPanel(data, days);
    } catch (e) {
        if (timelineContainer) {
            timelineContainer.innerHTML = `
                <div class="activity-empty-state">
                    <i class="fa-solid fa-triangle-exclamation"></i>
                    <h4>Falha ao carregar atividades</h4>
                    <p>Não foi possível carregar o histórico de atividades deste aluno.</p>
                </div>
            `;
        }
    }
}

function renderActivityPanel(data, days) {
    // 1. Update Summary Stats
    document.getElementById('stat-active-days').innerText = data.total_active_days;
    document.getElementById('stat-exercises-done').innerText = data.total_exercises_done;
    
    const avg = data.total_active_days > 0
        ? (data.total_exercises_done / data.total_active_days).toFixed(1)
        : '0';
    document.getElementById('stat-avg-exercises').innerText = avg;
    
    // 2. Render Calendar Heatmap
    renderActivityCalendar(data, days);
    
    // 3. Render Activity Timeline
    renderActivityTimeline(data);
}

function renderActivityCalendar(data, days) {
    const calendarGrid = document.getElementById('activity-calendar-grid');
    if (!calendarGrid) return;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Build exercise count map per date
    const exerciseCountByDate = {};
    data.activity.forEach(dayGroup => {
        exerciseCountByDate[dayGroup.date] = dayGroup.exercises.length;
    });
    
    // Find max exercises in a day for scaling
    const counts = Object.values(exerciseCountByDate);
    const maxExercises = counts.length > 0 ? Math.max(...counts) : 1;
    
    // Generate cells for last N days
    let cellsHtml = '';
    for (let i = days - 1; i >= 0; i--) {
        const cellDate = new Date(today);
        cellDate.setDate(cellDate.getDate() - i);
        const dateStr = cellDate.toISOString().split('T')[0];
        
        const count = exerciseCountByDate[dateStr] || 0;
        let level = 0;
        if (count > 0) {
            const ratio = count / maxExercises;
            if (ratio <= 0.25) level = 1;
            else if (ratio <= 0.5) level = 2;
            else if (ratio <= 0.75) level = 3;
            else level = 4;
        }
        
        const isToday = i === 0;
        const dayNum = cellDate.getDate();
        const monthShort = cellDate.toLocaleDateString('pt-BR', { month: 'short' });
        const weekdayShort = cellDate.toLocaleDateString('pt-BR', { weekday: 'short' });
        
        const tooltipText = count > 0
            ? `${count} exercício${count > 1 ? 's' : ''} em ${dayNum} ${monthShort}`
            : `Sem atividade em ${dayNum} ${monthShort}`;
        
        cellsHtml += `
            <div class="calendar-day-cell level-${level} ${isToday ? 'is-today' : ''}" 
                 data-date="${dateStr}" 
                 data-count="${count}" 
                 data-tooltip="${tooltipText}"
                 onmouseenter="showCalendarTooltip(event, this)"
                 onmouseleave="hideCalendarTooltip()">
            </div>
        `;
    }
    
    calendarGrid.innerHTML = cellsHtml;
}

// Calendar tooltip functions
let calendarTooltipEl = null;

function showCalendarTooltip(event, cell) {
    if (!calendarTooltipEl) {
        calendarTooltipEl = document.createElement('div');
        calendarTooltipEl.className = 'calendar-tooltip';
        document.body.appendChild(calendarTooltipEl);
    }
    
    const tooltipText = cell.dataset.tooltip;
    calendarTooltipEl.innerText = tooltipText;
    calendarTooltipEl.style.display = 'block';
    
    const rect = cell.getBoundingClientRect();
    calendarTooltipEl.style.left = `${rect.left + rect.width / 2}px`;
    calendarTooltipEl.style.top = `${rect.top}px`;
}

function hideCalendarTooltip() {
    if (calendarTooltipEl) {
        calendarTooltipEl.style.display = 'none';
    }
}

function renderActivityTimeline(data) {
    const timelineContainer = document.getElementById('activity-timeline');
    if (!timelineContainer) return;
    
    if (data.activity.length === 0) {
        timelineContainer.innerHTML = `
            <div class="activity-empty-state">
                <i class="fa-solid fa-bed"></i>
                <h4>Nenhuma atividade registrada</h4>
                <p>Este aluno ainda não executou exercícios no período selecionado.</p>
            </div>
        `;
        return;
    }
    
    const todayStr = new Date().toISOString().split('T')[0];
    
    timelineContainer.innerHTML = data.activity.map(dayGroup => {
        const dateObj = new Date(dayGroup.date + 'T12:00:00');
        const dateFormatted = dateObj.toLocaleDateString('pt-BR', { 
            day: '2-digit', 
            month: 'long',
            year: 'numeric'
        });
        const weekday = dateObj.toLocaleDateString('pt-BR', { weekday: 'long' });
        const weekdayCapitalized = weekday.charAt(0).toUpperCase() + weekday.slice(1);
        const isToday = dayGroup.date === todayStr;
        
        const exercisesHtml = dayGroup.exercises.map(ex => {
            let timeStr = '';
            if (ex.completed_at) {
                const completedDate = new Date(ex.completed_at);
                timeStr = completedDate.toLocaleTimeString('pt-BR', { 
                    hour: '2-digit', 
                    minute: '2-digit' 
                });
            }
            
            return `
                <div class="timeline-exercise-item">
                    <div class="timeline-check-icon">
                        <i class="fa-solid fa-check"></i>
                    </div>
                    <div class="timeline-exercise-info">
                        <div class="timeline-exercise-name">${ex.exercise_name}</div>
                        <div class="timeline-exercise-workout">
                            <i class="fa-solid fa-file-lines"></i> ${ex.workout_title}
                        </div>
                    </div>
                    ${timeStr ? `<span class="timeline-exercise-time">${timeStr}</span>` : ''}
                </div>
            `;
        }).join('');
        
        return `
            <div class="timeline-day-group">
                <div class="timeline-day-header">
                    <div class="timeline-day-date">
                        <div class="date-icon">
                            <i class="fa-regular fa-calendar-check"></i>
                        </div>
                        <div>
                            <div class="date-text">${dateFormatted}</div>
                            <div class="date-weekday">${weekdayCapitalized}</div>
                        </div>
                    </div>
                    <span class="timeline-day-count ${isToday ? 'is-today-badge' : ''}">
                        ${isToday ? '🟢 HOJE — ' : ''}${dayGroup.exercises.length} exercício${dayGroup.exercises.length > 1 ? 's' : ''}
                    </span>
                </div>
                <div class="timeline-exercises-list">
                    ${exercisesHtml}
                </div>
            </div>
        `;
    }).join('');
}

function onActivityPeriodChange(days) {
    if (state.selectedStudentId) {
        fetchStudentActivity(state.selectedStudentId, parseInt(days));
    }
}


// ==========================================================================
// PREENCHIMENTO RÁPIDO DE DATAS (MODAL DE TREINO)
// ==========================================================================
function setWorkoutDuration(days) {
    let startInput = document.getElementById('workout-start-date');
    let endInput = document.getElementById('workout-end-date');
    
    let startDate = startInput && startInput.value ? new Date(startInput.value + 'T00:00:00') : new Date();
    if (startInput && !startInput.value) {
        startInput.value = startDate.toISOString().split('T')[0];
    }
    
    let endDate = new Date(startDate.getTime());
    endDate.setDate(endDate.getDate() + days);
    if (endInput) {
        endInput.value = endDate.toISOString().split('T')[0];
    }
}

function clearWorkoutDates() {
    const startInput = document.getElementById('workout-start-date');
    const endInput = document.getElementById('workout-end-date');
    if (startInput) startInput.value = '';
    if (endInput) endInput.value = '';
}


// ==========================================================================
// CENTRAL DE NOTIFICAÇÕES (PORTAL DO ALUNO)
// ==========================================================================
async function fetchStudentNotifications() {
    try {
        const data = await apiRequest('/api/notifications');
        state.notifications = data.notifications || [];
        state.unreadNotificationsCount = data.total_unread || 0;
        updateNotificationBadge();
        
        // Se houver notificação não lida de expiração ou término hoje, dispara notificação nativa do navegador
        const unreadDeadlines = state.notifications.filter(n => !n.is_read && (n.type === 'workout_deadline' || n.type === 'workout_expired'));
        if (unreadDeadlines.length > 0) {
            const first = unreadDeadlines[0];
            triggerBrowserNotification(first.title, first.message);
        }
    } catch (e) {
        console.warn('Falha ao obter notificações:', e);
    }
}

function updateNotificationBadge() {
    const badge = document.getElementById('notification-badge');
    if (!badge) return;
    const count = state.unreadNotificationsCount;
    if (count > 0) {
        badge.innerText = count > 99 ? '99+' : count;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

function triggerBrowserNotification(title, body) {
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") {
        try {
            new Notification(title, {
                body: body,
                icon: '/mobile/icons/icon-192.png'
            });
        } catch (e) {
            if (navigator.serviceWorker && navigator.serviceWorker.ready) {
                navigator.serviceWorker.ready.then(reg => {
                    reg.showNotification(title, {
                        body: body,
                        icon: '/mobile/icons/icon-192.png'
                    });
                }).catch(() => {});
            }
        }
    } else if (Notification.permission === "default") {
        Notification.requestPermission().then(permission => {
            if (permission === "granted") {
                triggerBrowserNotification(title, body);
            }
        }).catch(() => {});
    }
}

function openNotificationsModal() {
    renderNotificationsList();
    openModal('modal-notifications');
}

function renderNotificationsList() {
    const container = document.getElementById('notifications-list');
    if (!container) return;
    
    if (!state.notifications || state.notifications.length === 0) {
        container.innerHTML = `
            <div class="notification-empty-state">
                <i class="fa-regular fa-bell-slash" style="font-size: 2.2rem; color: rgba(255,255,255,0.1); margin-bottom: 12px;"></i>
                <p>Nenhuma notificação no momento.</p>
                <small style="color: var(--text-muted);">Quando o prazo de algum treino estiver vencendo ou encerrar, avisaremos aqui!</small>
            </div>
        `;
        return;
    }
    
    container.innerHTML = state.notifications.map(n => {
        const timeFmt = new Date(n.created_at).toLocaleString('pt-BR', { 
            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' 
        });
        const icon = n.type === 'workout_expired' 
            ? 'fa-triangle-exclamation' 
            : (n.type === 'workout_deadline' ? 'fa-bell' : 'fa-clock');
        const iconColor = n.type === 'workout_expired' 
            ? '#ef4444' 
            : (n.type === 'workout_deadline' ? '#f97316' : '#eab308');

        return `
            <div class="notification-card ${n.is_read ? '' : 'unread'}" id="notif-card-${n.id}">
                <div style="font-size: 1.2rem; color: ${iconColor}; margin-top: 2px;">
                    <i class="fa-solid ${icon}"></i>
                </div>
                <div class="notification-card-content">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
                        <h4 class="notification-card-title">${n.title}</h4>
                        ${!n.is_read ? `
                            <button class="btn-icon-sm" style="width: 26px; height: 26px; font-size: 0.75rem;" title="Marcar como lida" onclick="markNotificationRead('${n.id}')">
                                <i class="fa-solid fa-check"></i>
                            </button>
                        ` : ''}
                    </div>
                    <p class="notification-card-msg">${n.message}</p>
                    <span class="notification-card-time"><i class="fa-regular fa-clock"></i> ${timeFmt}</span>
                </div>
            </div>
        `;
    }).join('');
}

async function markNotificationRead(id) {
    try {
        await apiRequest(`/api/notifications/${id}/read`, { method: 'PUT' });
        const notif = state.notifications.find(n => n.id === id);
        if (notif) notif.is_read = true;
        state.unreadNotificationsCount = Math.max(0, state.unreadNotificationsCount - 1);
        updateNotificationBadge();
        renderNotificationsList();
    } catch (e) {
        showToast('Erro ao atualizar notificação', 'error');
    }
}

async function markAllNotificationsRead() {
    try {
        await apiRequest('/api/notifications/read-all', { method: 'PUT' });
        state.notifications.forEach(n => n.is_read = true);
        state.unreadNotificationsCount = 0;
        updateNotificationBadge();
        renderNotificationsList();
        showToast('Todas as notificações foram marcadas como lidas!', 'success');
    } catch (e) {
        showToast('Erro ao atualizar notificações', 'error');
    }
}


// ==========================================================================
// MONITOR DE PRAZOS DOS TREINOS (ADMIN)
// ==========================================================================
async function fetchExpiringWorkoutsAdmin() {
    const listContainer = document.getElementById('deadlines-list');
    const badge = document.getElementById('admin-deadlines-badge');
    const filterTypeSelect = document.getElementById('deadlines-filter-type');
    const filterType = filterTypeSelect ? filterTypeSelect.value : 'all';
    const filterSelect = document.getElementById('deadlines-filter-days');
    const filterDays = filterSelect ? filterSelect.value : 30;

    try {
        const expiring = await apiRequest(`/api/admin/expiring-workouts?days=${filterDays}&item_type=${filterType}`);
        state.expiringWorkouts = expiring;

        if (badge) {
            const urgentCount = expiring.filter(x => x.status === 'expired' || x.status === 'expiring_today').length;
            if (urgentCount > 0) {
                badge.innerText = urgentCount;
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        }

        if (!listContainer) return;

        if (expiring.length === 0) {
            listContainer.innerHTML = `
                <div class="empty-state glass-card" style="padding: 50px 20px; text-align: center;">
                    <i class="fa-solid fa-circle-check" style="font-size: 3rem; color: #22c55e; margin-bottom: 16px;"></i>
                    <h4>Nenhum prazo vencido ou prestes a vencer!</h4>
                    <p style="color: var(--text-secondary); max-width: 450px; margin: 0 auto; line-height: 1.6;">
                        Todos os alunos com fichas ou metas com prazo estão em dia no período selecionado.
                    </p>
                </div>
            `;
            return;
        }

        listContainer.innerHTML = `
            <div class="deadlines-grid">
                ${expiring.map(item => {
                    const isGoal = item.type === 'goal';
                    const startFmt = item.start_date ? new Date(item.start_date + 'T00:00:00').toLocaleDateString('pt-BR') : 'Início imediato';
                    const endFmt = item.end_date ? new Date(item.end_date + 'T00:00:00').toLocaleDateString('pt-BR') : '--';
                    
                    let cardClass = 'deadline-card-expired';
                    let badgeClass = 'badge-status-expired';
                    let badgeLabel = '';
                    let badgeIcon = 'fa-triangle-exclamation';

                    if (item.status === 'expired') {
                        const daysAgo = Math.abs(item.days_remaining || 0);
                        badgeLabel = `Vencido há ${daysAgo} dia(s)`;
                        cardClass = 'deadline-card-expired';
                        badgeClass = 'badge-status-expired';
                    } else if (item.status === 'expiring_today') {
                        badgeLabel = 'Vence Hoje!';
                        cardClass = 'deadline-card-expiring-today';
                        badgeClass = 'badge-status-expiring-today';
                        badgeIcon = 'fa-bell';
                    } else {
                        badgeLabel = `Vence em ${item.days_remaining} dia(s)`;
                        cardClass = 'deadline-card-expiring-soon';
                        badgeClass = 'badge-status-expiring-soon';
                        badgeIcon = 'fa-clock';
                    }

                    const typeBadge = isGoal 
                        ? `<span style="font-size: 0.72rem; padding: 2px 8px; border-radius: 6px; background: rgba(236, 72, 153, 0.15); color: #f472b6; border: 1px solid rgba(236, 72, 153, 0.3); font-weight: 600;"><i class="fa-solid fa-bullseye"></i> Data Meta</span>`
                        : `<span style="font-size: 0.72rem; padding: 2px 8px; border-radius: 6px; background: rgba(168, 85, 247, 0.15); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.3); font-weight: 600;"><i class="fa-solid fa-file-lines"></i> Ficha de Treino</span>`;

                    const titleHtml = isGoal
                        ? `<div style="font-size: 0.95rem; color: #f3f4f6; font-weight: 600; margin-bottom: 6px;"><i class="fa-solid fa-bullseye" style="color: var(--primary-color);"></i> ${item.workout_title}</div>`
                        : `<div style="font-size: 0.95rem; color: #f3f4f6; font-weight: 600; margin-bottom: 6px;"><i class="fa-solid fa-dumbbell" style="color: var(--primary-color);"></i> ${item.workout_title}</div>`;

                    const periodHtml = isGoal
                        ? `<span><i class="fa-regular fa-calendar-check"></i> <strong>Data da Meta:</strong> ${endFmt}</span>`
                        : `<span><i class="fa-regular fa-calendar-days"></i> <strong>Período:</strong> ${startFmt} até ${endFmt}</span>`;

                    const actionButton = isGoal
                        ? `<button class="btn-secondary" style="font-size: 0.8rem; padding: 6px 12px;" onclick="selectStudentAndOpenWorkouts('${item.student_id}')"><i class="fa-solid fa-user"></i> Ver Aluno</button>`
                        : `<button class="btn-secondary" style="font-size: 0.8rem; padding: 6px 12px;" onclick="selectStudentAndOpenWorkouts('${item.student_id}')"><i class="fa-solid fa-pen-to-square"></i> Ver Fichas</button>`;

                    return `
                        <div class="deadline-item-card glass-card ${cardClass}">
                            <div>
                                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 8px;">
                                    <div style="display: flex; align-items: center; gap: 8px;">
                                        <h4 style="font-size: 1.05rem; font-weight: 700; color: #fff;">${item.student_name}</h4>
                                        ${typeBadge}
                                    </div>
                                    <span class="workout-status-badge ${badgeClass}">
                                        <i class="fa-solid ${badgeIcon}"></i> ${badgeLabel}
                                    </span>
                                </div>
                                
                                ${titleHtml}
                                
                                <div style="font-size: 0.8rem; color: var(--text-secondary); display: flex; flex-direction: column; gap: 4px;">
                                    ${periodHtml}
                                    <span><i class="fa-solid fa-phone"></i> <strong>Telefone:</strong> ${item.student_phone || 'Sem telefone'}</span>
                                </div>
                            </div>
                            
                            <div style="display: flex; gap: 10px; align-items: center; justify-content: space-between; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 12px; margin-top: 8px;">
                                ${actionButton}
                                
                                ${item.whatsapp_link ? `
                                    <a href="${item.whatsapp_link}" target="_blank" class="btn-whatsapp-action" title="Abrir conversa no WhatsApp com mensagem pronta">
                                        <i class="fa-brands fa-whatsapp" style="font-size: 1rem;"></i> Notificar no WhatsApp
                                    </a>
                                ` : `
                                    <span style="font-size: 0.75rem; color: var(--text-muted);">Sem WhatsApp</span>
                                `}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    } catch (e) {
        if (listContainer) {
            listContainer.innerHTML = `<p class="empty-state">Erro ao carregar monitoramento de prazos.</p>`;
        }
    }
}

function selectStudentAndOpenWorkouts(studentId) {
    switchAdminTab('tab-students');
    selectStudent(studentId);
}

// Global scope bindings
window.fetchExpiringWorkoutsAdmin = fetchExpiringWorkoutsAdmin;
window.selectStudentAndOpenWorkouts = selectStudentAndOpenWorkouts;

