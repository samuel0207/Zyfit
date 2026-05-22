// ==========================================================================
// CONFIGURAÇÃO DA API & ESTADO GLOBAL
// ==========================================================================
const API_BASE_URL = window.location.protocol === 'file:' || window.location.hostname === '127.0.0.1' 
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
    selectedTimelineDay: null // Active timeline day in student portal
};

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
    } else if (role === 'student') {
        showView('student-portal');
        initStudentPortal();
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
                <h4>${student.name}</h4>
                <p>${student.phone}</p>
            </div>
            <div class="student-card-arrow">
                <i class="fa-solid fa-chevron-right"></i>
            </div>
        </div>
    `).join('');
}

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
    
    // Fetch and render Workouts/Treinos
    fetchWorkouts(studentId);
}

async function handleStudentSubmit(event) {
    event.preventDefault();
    const id = document.getElementById('student-form-id').value;
    const name = document.getElementById('student-name').value;
    const phone = document.getElementById('student-phone').value;
    const password = document.getElementById('student-password').value;
    const weight = parseFloat(document.getElementById('student-weight').value) || null;
    const height = parseFloat(document.getElementById('student-height').value) || null;
    const goals = document.getElementById('student-goals').value || null;
    
    const payload = { name, phone, weight, height, goals };
    
    try {
        if (id) {
            // Edit existing student
            if (password) payload.password = password;
            await apiRequest(`/api/students/${id}`, {
                method: 'PUT',
                body: JSON.stringify(payload)
            });
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
        fetchStudents();
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
        const exercisesHtml = workout.exercises && workout.exercises.length > 0
            ? workout.exercises.map((ex, index) => `
                <div class="exercise-row">
                    <div class="exercise-main-details">
                        <span class="exercise-number">${index + 1}</span>
                        <div class="exercise-meta-info">
                            <h5>${ex.name}</h5>
                            <div class="exercise-specs">
                                <span class="spec-item"><i class="fa-solid fa-repeat"></i> ${ex.sets}x</span>
                                <span class="spec-item"><i class="fa-solid fa-dumbbell"></i> ${ex.repetitions}</span>
                                <span class="spec-item"><i class="fa-regular fa-clock"></i> Descanso: ${ex.rest_time}</span>
                            </div>
                        </div>
                    </div>
                    <div class="exercise-right-actions">
                        ${ex.video_url 
                            ? `<span class="btn-video-badge" title="${ex.video_url}"><i class="fa-brands fa-youtube"></i> Execução</span>`
                            : ''
                        }
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
            `).join('')
            : `<p class="empty-state" style="padding: 15px;">Nenhum exercício cadastrado nesta ficha.</p>`;
            
        const daysHtml = workout.days_of_week 
            ? `<div class="workout-days-badge" style="margin-top: 6px; font-size: 0.75rem; color: var(--primary-color); display: flex; align-items: center; gap: 4px; font-weight: 500;">
                 <i class="fa-regular fa-calendar-days"></i> ${workout.days_of_week}
               </div>`
            : '';
            
        return `
            <div class="workout-sheet-card glass-card">
                <div class="workout-sheet-header">
                    <div>
                        <h4>${workout.title}</h4>
                        <p>${workout.description || 'Sem descrição cadastrada.'}</p>
                        ${daysHtml}
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
    
    const checkedDays = Array.from(document.querySelectorAll('input[name="workout-days"]:checked'))
        .map(input => input.value)
        .join(', ');
        
    try {
        if (id) {
            // Edit workout header
            await apiRequest(`/api/workouts/${id}`, {
                method: 'PUT',
                body: JSON.stringify({ title, description, days_of_week: checkedDays || null })
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
                    days_of_week: checkedDays || null
                })
            });
            showToast('Nova ficha de treino criada com sucesso!', 'success');
        }
        
        closeModal('modal-workout');
        fetchWorkouts(state.selectedStudentId);
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
    }
}

// Student Modal triggers
document.getElementById('btn-add-student-modal').addEventListener('click', () => {
    document.getElementById('form-student').reset();
    document.getElementById('modal-student-title').innerText = 'Cadastrar Novo Aluno';
    document.getElementById('student-form-id').value = '';
    document.getElementById('student-password-container').style.display = 'block';
    document.getElementById('student-password').required = true;
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
    document.getElementById('student-weight').value = student.weight || '';
    document.getElementById('student-height').value = student.height || '';
    document.getElementById('student-goals').value = student.goals || '';
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
}

// ==========================================================================
// MÓDULO DO ALUNO (STUDENT PORTAL & EMBEDDED PLAYER)
// ==========================================================================
async function initStudentPortal() {
    const studentMain = document.querySelector('.student-main');
    
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
                <div class="profile-stats" style="margin-bottom: 0; display: flex; gap: 10px;">
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
    
    studentMain.innerHTML = welcomeHtml + timelineHtml + exercisesHtml;
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
        <div class="catalog-card">
            <div class="catalog-card-header">
                <h4>${ex.name}</h4>
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
                ? `<div><span class="muscle-badge"><i class="fa-solid fa-crosshairs"></i> ${ex.muscle_group}</span></div>` 
                : ''
            }
            ${ex.description 
                ? `<p class="catalog-card-description">${ex.description}</p>` 
                : ''
            }
            ${ex.video_url 
                ? `<div class="catalog-card-video"><i class="fa-brands fa-youtube"></i> ${ex.video_url}</div>` 
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
