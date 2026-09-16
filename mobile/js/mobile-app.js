// ==========================================================================
// ZYFIT MOBILE APP — CORE LOGIC
// ==========================================================================
const API_BASE = (() => {
    const h = window.location.hostname;
    if (h === 'localhost' || h === '127.0.0.1') return `http://${h}:8000`;
    return window.location.origin;
})();

const state = {
    token: localStorage.getItem('zyfit_token') || null,
    user: null,
    workouts: [],
    activeWorkoutId: null,
    selectedDay: null,
    notifications: [],
    unreadNotificationsCount: 0
};

// ==========================================================================
// INIT
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
    registerSW();
    bindEvents();
    initApp();
});

function registerSW() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/mobile/sw.js').catch(() => {});
    }
}

async function initApp() {
    if (state.token) {
        const ok = await fetchMe();
        if (ok) { showDashboard(); return; }
        logout();
    }
    showView('login-screen');
}

// ==========================================================================
// VIEWS
// ==========================================================================
function showView(id) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
}

function showDashboard() {
    showView('dashboard-screen');
    document.getElementById('header-greeting').textContent =
        `Olá, ${state.user.name.split(' ')[0]}`;
    loadWorkouts();
    loadMobileNotifications();
    requestNotificationPermission();
}

// ==========================================================================
// API CLIENT
// ==========================================================================
async function api(endpoint, opts = {}) {
    const headers = { 'Content-Type': 'application/json', ...opts.headers };
    if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
    const res = await fetch(`${API_BASE}${endpoint}`, { ...opts, headers });
    if (res.status === 401) { logout(); throw new Error('Sessão expirada'); }
    if (res.status === 204) return null;
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(text || `Erro ${res.status}`); }
    if (!res.ok) throw new Error(data.detail || 'Erro na API');
    return data;
}

// ==========================================================================
// AUTH
// ==========================================================================
async function fetchMe() {
    try {
        state.user = await api('/api/auth/me');
        return true;
    } catch { return false; }
}

async function handleLogin(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-login');
    const phone = document.getElementById('login-phone').value.trim();
    const password = document.getElementById('login-password').value;
    if (!phone || !password) return;

    btn.classList.add('loading');
    btn.disabled = true;

    try {
        const data = await api('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ phone, password, name: 'x' })
        });
        state.token = data.access_token;
        localStorage.setItem('zyfit_token', data.access_token);
        await fetchMe();
        toast('Login realizado com sucesso!', 'success');
        showDashboard();
    } catch (err) {
        toast(err.message || 'Telefone ou senha incorretos.', 'error');
        btn.classList.add('shake-anim');
        setTimeout(() => btn.classList.remove('shake-anim'), 500);
    } finally {
        btn.classList.remove('loading');
        btn.disabled = false;
    }
}

function logout() {
    state.token = null;
    state.user = null;
    state.workouts = [];
    state.activeWorkoutId = null;
    state.selectedDay = null;
    localStorage.removeItem('zyfit_token');
    showView('login-screen');
    document.getElementById('login-password').value = '';
}

// ==========================================================================
// WORKOUTS
// ==========================================================================
async function loadWorkouts() {
    const content = document.getElementById('app-content');
    renderSkeleton(content);

    try {
        const workouts = await api('/api/student-portal/my-workouts');
        state.workouts = workouts;
        if (!state.selectedDay) autoSelectToday();
        renderDashboard();
    } catch (err) {
        content.innerHTML = `
            <div class="empty-state glass-card">
                <div class="empty-icon"><i class="fa-solid fa-triangle-exclamation"></i></div>
                <h4>Falha ao carregar treinos</h4>
                <p>${err.message}</p>
                <button class="btn-primary" style="margin-top:16px;width:auto;padding:12px 24px" onclick="loadWorkouts()">
                    <i class="fa-solid fa-rotate-right"></i> Tentar Novamente
                </button>
            </div>`;
    }
}

function renderSkeleton(container) {
    container.innerHTML = `
        <div class="skeleton skeleton-card" style="height:120px;margin-bottom:16px"></div>
        <div class="skeleton skeleton-card" style="height:70px;margin-bottom:16px"></div>
        <div class="skeleton skeleton-card" style="height:90px;margin-bottom:10px"></div>
        <div class="skeleton skeleton-card" style="height:90px;margin-bottom:10px"></div>
        <div class="skeleton skeleton-card" style="height:90px"></div>`;
}

// ==========================================================================
// DAY SELECTION
// ==========================================================================
const DAYS_FULL = ['Segunda','Terça','Quarta','Quinta','Sexta','Sábado','Domingo'];
const DAYS_SHORT = ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'];

function autoSelectToday() {
    const map = {
        'segunda': 'Segunda', 'terça': 'Terça', 'quarta': 'Quarta',
        'quinta': 'Quinta', 'sexta': 'Sexta', 'sábado': 'Sábado', 'domingo': 'Domingo'
    };
    let raw = new Intl.DateTimeFormat('pt-BR', { weekday: 'long' }).format(new Date());
    raw = raw.split('-')[0].trim().toLowerCase();
    state.selectedDay = map[raw] || 'Segunda';

    const wForDay = state.workouts.filter(w =>
        w.days_of_week && w.days_of_week.includes(state.selectedDay)
    );
    state.activeWorkoutId = wForDay.length > 0 ? wForDay[0].id : null;
}

function selectDay(dayName) {
    state.selectedDay = dayName;
    const wForDay = state.workouts.filter(w =>
        w.days_of_week && w.days_of_week.includes(dayName)
    );
    state.activeWorkoutId = wForDay.length > 0 ? wForDay[0].id : null;
    renderDashboard();
}

function getTodayName() {
    const map = {
        'segunda': 'Segunda', 'terça': 'Terça', 'quarta': 'Quarta',
        'quinta': 'Quinta', 'sexta': 'Sexta', 'sábado': 'Sábado', 'domingo': 'Domingo'
    };
    let raw = new Intl.DateTimeFormat('pt-BR', { weekday: 'long' }).format(new Date());
    raw = raw.split('-')[0].trim().toLowerCase();
    return map[raw] || 'Segunda';
}

// ==========================================================================
// RENDER DASHBOARD
// ==========================================================================
function renderDashboard() {
    const content = document.getElementById('app-content');
    const today = getTodayName();
    const activeW = state.workouts.find(w => w.id === state.activeWorkoutId);

    let total = 0, done = 0;
    if (activeW && activeW.exercises) {
        total = activeW.exercises.length;
        done = activeW.exercises.filter(e => e.completed_today).length;
    }
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const circumference = 2 * Math.PI * 40; // r=40

    // User stats
    const w = state.user.weight;
    const h = state.user.height;
    let imcText = '--';
    if (w && h) imcText = (w / (h * h)).toFixed(1);

    let html = '';

    // Alert Banner if any workout expired or expiring today
    const expiredW = state.workouts.filter(w => w.status === 'expired');
    const expiringTodayW = state.workouts.filter(w => w.status === 'expiring_today');
    const expiringSoonW = state.workouts.filter(w => w.status === 'expiring_soon');

    if (expiredW.length > 0) {
        const ew = expiredW[0];
        const daysAgo = Math.abs(ew.days_remaining || 0);
        html += `
        <div class="mobile-deadline-banner mobile-banner-expired" onclick="openMobileNotifications()">
            <div class="mobile-banner-icon"><i class="fa-solid fa-triangle-exclamation" style="color:#ef4444"></i></div>
            <div class="mobile-banner-text">
                <h4>Ficha de Treino Vencida!</h4>
                <p>O prazo da sua ficha <strong>"${ew.title}"</strong> encerrou há ${daysAgo} dia(s). Toque para ver detalhes e avisar seu treinador.</p>
            </div>
        </div>`;
    } else if (expiringTodayW.length > 0) {
        const ew = expiringTodayW[0];
        html += `
        <div class="mobile-deadline-banner mobile-banner-expiring-today" onclick="openMobileNotifications()">
            <div class="mobile-banner-icon"><i class="fa-solid fa-bell" style="color:#f97316"></i></div>
            <div class="mobile-banner-text">
                <h4>Treino Vence Hoje!</h4>
                <p>A vigência da sua ficha <strong>"${ew.title}"</strong> termina hoje. Prepare-se para sua próxima periodização!</p>
            </div>
        </div>`;
    } else if (expiringSoonW.length > 0) {
        const ew = expiringSoonW[0];
        html += `
        <div class="mobile-deadline-banner mobile-banner-expiring-soon">
            <div class="mobile-banner-icon"><i class="fa-solid fa-clock" style="color:#eab308"></i></div>
            <div class="mobile-banner-text">
                <h4>Treino Vence em Breve</h4>
                <p>Faltam apenas <strong>${ew.days_remaining} dia(s)</strong> para o término da ficha <strong>"${ew.title}"</strong>.</p>
            </div>
        </div>`;
    }

    // 1) Welcome
    html += `
    <div class="welcome-card glass-card">
        <div class="welcome-greeting">Bora treinar, ${state.user.name.split(' ')[0]}! 💪</div>
        <div class="welcome-goals">Foco: <strong>${state.user.goals || 'Manter saúde e constância.'}</strong></div>
        <div class="stats-row">
            <div class="stat-pill">
                <span class="stat-label">Peso</span>
                <span class="stat-value">${w ? w + ' kg' : '--'}</span>
            </div>
            <div class="stat-pill">
                <span class="stat-label">Altura</span>
                <span class="stat-value">${h ? h + ' m' : '--'}</span>
            </div>
            <div class="stat-pill">
                <span class="stat-label">IMC</span>
                <span class="stat-value">${imcText}</span>
            </div>
        </div>
    </div>`;

    // 2) Progress ring (only if workout active)
    if (activeW && total > 0) {
        const dashoffset = circumference - (pct / 100) * circumference;
        const isComplete = pct === 100;
        html += `
        <div class="progress-section glass-card">
            <div class="progress-ring-wrapper">
                <svg class="progress-ring" width="72" height="72" viewBox="0 0 90 90">
                    <circle class="progress-ring-bg" cx="45" cy="45" r="40"/>
                    <circle class="progress-ring-fill ${isComplete ? 'complete' : ''}"
                        cx="45" cy="45" r="40"
                        stroke-dasharray="${circumference}"
                        stroke-dashoffset="${dashoffset}"
                        style="animation: ringFill 1.2s ease forwards"/>
                </svg>
                <span class="progress-percent">${pct}%</span>
            </div>
            <div class="progress-info">
                <h3>${isComplete ? '🎉 Treino Completo!' : `${done} de ${total} exercícios`}</h3>
                <p>${isComplete ? 'Parabéns pelo esforço!' : 'Continue firme!'}</p>
                <span class="workout-title-tag"><i class="fa-solid fa-dumbbell"></i> ${activeW.title}</span>
            </div>
        </div>`;
    }

    // 3) Weekly timeline
    html += `
    <div class="timeline-card glass-card">
        <div class="timeline-header"><i class="fa-regular fa-calendar-check"></i> Cronograma Semanal</div>
        <div class="days-grid">
            ${DAYS_FULL.map((d, i) => {
                const isToday = d === today;
                const isSel = d === state.selectedDay;
                const hasW = state.workouts.some(w => w.days_of_week && w.days_of_week.includes(d));
                const cls = ['day-pill'];
                if (hasW) cls.push('has-workout'); else cls.push('is-rest');
                if (isSel) cls.push('selected');
                if (isToday) cls.push('is-today');
                return `
                <div class="${cls.join(' ')}" onclick="selectDay('${d}')">
                    <span class="day-name">${DAYS_SHORT[i]}</span>
                    <span class="day-dot"></span>
                    ${isToday ? '<span class="today-label">Hoje</span>' : ''}
                </div>`;
            }).join('')}
        </div>
    </div>`;

    // 4) Exercises or rest
    if (!activeW) {
        if (state.workouts.length === 0) {
            html += `
            <div class="empty-state glass-card">
                <div class="empty-icon"><i class="fa-solid fa-clipboard-question"></i></div>
                <h4>Nenhuma ficha disponível</h4>
                <p>Sua professora ainda não vinculou fichas de treino para você.</p>
            </div>`;
        } else {
            html += `
            <div class="rest-day-card glass-card">
                <div class="rest-emoji">😴</div>
                <h3>Dia de Descanso</h3>
                <p>Não há treinos agendados para <strong>${state.selectedDay}</strong>. Aproveite para descansar e se recuperar! 💧</p>
            </div>`;
        }
    } else if (!activeW.exercises || activeW.exercises.length === 0) {
        html += `
        <div class="empty-state glass-card">
            <div class="empty-icon"><i class="fa-solid fa-dumbbell"></i></div>
            <h4>Ficha "${activeW.title}" vazia</h4>
            <p>Aguarde a professora adicionar exercícios.</p>
        </div>`;
    } else {
        let deadlineBadge = '';
        if (activeW.start_date || activeW.end_date) {
            const endFmt = activeW.end_date ? new Date(activeW.end_date + 'T00:00:00').toLocaleDateString('pt-BR') : 'Sem fim';
            let pillClass = 'pill-active';
            let pillText = `Até ${endFmt}`;
            if (activeW.status === 'expired') {
                pillClass = 'pill-expired';
                pillText = `Vencido`;
            } else if (activeW.status === 'expiring_today') {
                pillClass = 'pill-expiring-today';
                pillText = `Vence Hoje!`;
            } else if (activeW.status === 'expiring_soon') {
                pillClass = 'pill-expiring-soon';
                pillText = `Vence em ${activeW.days_remaining}d`;
            }
            deadlineBadge = `<span class="workout-deadline-pill ${pillClass}"><i class="fa-regular fa-clock"></i> ${pillText}</span>`;
        }

        html += `
        <div class="exercises-section">
            <div class="section-title" style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                <div style="display:flex;align-items:center;gap:8px;">
                    <i class="fa-solid fa-list-check"></i> Exercícios
                    <span class="exercise-count">${done}/${total}</span>
                </div>
                ${deadlineBadge}
            </div>
            ${activeW.exercises.map((ex, idx) => `
            <div class="exercise-card glass-card ${ex.completed_today ? 'completed' : ''}" id="ex-${ex.id}">
                <div class="check-btn" onclick="toggleComplete('${ex.id}', ${ex.completed_today})">
                    <i class="fa-solid fa-check"></i>
                </div>
                <div class="exercise-info">
                    <div class="exercise-name">${idx + 1}. ${ex.name}</div>
                    <div class="exercise-specs">
                        <span class="spec-tag"><i class="fa-solid fa-repeat"></i> ${ex.sets}x</span>
                        <span class="spec-tag"><i class="fa-solid fa-dumbbell"></i> ${ex.repetitions}</span>
                        <span class="spec-tag"><i class="fa-regular fa-clock"></i> ${ex.rest_time}</span>
                    </div>
                    ${ex.video_url ? `
                    <button class="btn-video" onclick="playVideo('${escHtml(ex.name)}', '${escHtml(ex.video_url)}')">
                        <i class="fa-brands fa-youtube"></i> Ver Execução
                    </button>` : ''}
                </div>
            </div>`).join('')}
        </div>`;
    }

    content.innerHTML = html;

    // Check for 100% completion celebration
    if (activeW && total > 0 && pct === 100) {
        if (!state._celebrated) { celebrate(); state._celebrated = true; }
    } else {
        state._celebrated = false;
    }
}

function escHtml(s) {
    return s.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// ==========================================================================
// EXERCISE COMPLETION
// ==========================================================================
async function toggleComplete(exerciseId, isCompleted) {
    const card = document.getElementById(`ex-${exerciseId}`);
    try {
        if (isCompleted) {
            await api(`/api/student-portal/exercises/${exerciseId}/complete`, { method: 'DELETE' });
            toast('Conclusão desfeita.', 'info');
        } else {
            await api(`/api/student-portal/exercises/${exerciseId}/complete`, { method: 'POST' });
            toast('Exercício concluído! 💪', 'success');
            // Quick visual feedback
            if (card) { card.classList.add('completed'); }
        }
        // Reload data
        const workouts = await api('/api/student-portal/my-workouts');
        state.workouts = workouts;
        renderDashboard();
    } catch (err) {
        toast(err.message || 'Erro ao atualizar.', 'error');
    }
}

// ==========================================================================
// CELEBRATION (Confetti)
// ==========================================================================
function celebrate() {
    const colors = ['#8b5cf6', '#ec4899', '#06b6d4', '#10b981', '#f59e0b', '#f43f5e'];
    for (let i = 0; i < 40; i++) {
        const piece = document.createElement('div');
        piece.className = 'confetti-piece';
        piece.style.left = Math.random() * 100 + 'vw';
        piece.style.top = Math.random() * 40 + 'vh';
        piece.style.background = colors[Math.floor(Math.random() * colors.length)];
        piece.style.animationDelay = Math.random() * 1 + 's';
        piece.style.animationDuration = (1.5 + Math.random()) + 's';
        piece.style.width = (6 + Math.random() * 6) + 'px';
        piece.style.height = (6 + Math.random() * 6) + 'px';
        document.body.appendChild(piece);
        setTimeout(() => piece.remove(), 3000);
    }
}

// ==========================================================================
// VIDEO PLAYER
// ==========================================================================
function playVideo(name, url) {
    const modal = document.getElementById('video-modal');
    const title = document.getElementById('video-title');
    const container = document.getElementById('video-container');
    const wrapper = document.getElementById('video-wrapper');

    title.textContent = `Execução: ${name}`;

    const isShorts = url.includes('/shorts/');
    wrapper.className = 'video-wrapper' + (isShorts ? ' shorts' : '');

    const ytId = parseYT(url);
    const vimeoId = parseVimeo(url);

    if (ytId) {
        container.innerHTML = `<iframe src="https://www.youtube.com/embed/${ytId}?autoplay=1&rel=0"
            allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture"
            allowfullscreen></iframe>`;
    } else if (vimeoId) {
        container.innerHTML = `<iframe src="https://player.vimeo.com/video/${vimeoId}?autoplay=1"
            allow="autoplay;fullscreen;picture-in-picture" allowfullscreen></iframe>`;
    } else if (/\.(mp4|webm|ogg)$/i.test(url)) {
        container.innerHTML = `<video controls autoplay style="width:100%;height:100%"><source src="${url}"></video>`;
    } else {
        container.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:20px;text-align:center">
                <i class="fa-solid fa-link" style="font-size:2rem;color:var(--primary);margin-bottom:12px"></i>
                <p style="color:var(--text-secondary);margin-bottom:16px">O link não pode ser embutido.</p>
                <a href="${url}" target="_blank" style="color:var(--primary);font-weight:600;text-decoration:none">
                    Abrir em Nova Aba <i class="fa-solid fa-up-right-from-square"></i>
                </a>
            </div>`;
    }
    modal.classList.add('active');
}

function closeVideo() {
    const modal = document.getElementById('video-modal');
    const container = document.getElementById('video-container');
    modal.classList.remove('active');
    container.innerHTML = '';
}

function parseYT(url) {
    let m = url.match(/youtube\.com\/shorts\/([^#&?]*)/);
    if (m && m[1]) return m[1];
    m = url.match(/^.*(youtu\.be\/|v\/|embed\/|watch\?v=|&v=)([^#&?]*).*/);
    return (m && m[2].length === 11) ? m[2] : null;
}

function parseVimeo(url) {
    const m = url.match(/vimeo\.com\/(?:video\/)?([0-9]+)/);
    return m ? m[1] : null;
}

// ==========================================================================
// TOAST NOTIFICATIONS
// ==========================================================================
function toast(msg, type = 'success') {
    const el = document.getElementById('toast');
    const icons = {
        success: 'fa-circle-check', error: 'fa-triangle-exclamation', info: 'fa-circle-info'
    };
    el.className = `toast toast-${type}`;
    el.innerHTML = `<i class="fa-solid ${icons[type] || icons.success}"></i> <span>${msg}</span>`;
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('show'), 3500);
}

// ==========================================================================
// PULL TO REFRESH
// ==========================================================================
function setupPullToRefresh() {
    const content = document.getElementById('app-content');
    const indicator = document.getElementById('pull-indicator');
    if (!content || !indicator) return;

    let startY = 0, pulling = false;

    content.addEventListener('touchstart', e => {
        if (content.scrollTop === 0) {
            startY = e.touches[0].clientY;
            pulling = true;
        }
    }, { passive: true });

    content.addEventListener('touchmove', e => {
        if (!pulling) return;
        const dy = e.touches[0].clientY - startY;
        if (dy > 10 && dy < 120) {
            indicator.classList.add('active');
            if (dy > 60) indicator.classList.add('ready');
            else indicator.classList.remove('ready');
        }
    }, { passive: true });

    content.addEventListener('touchend', () => {
        if (indicator.classList.contains('ready')) {
            loadWorkouts();
            toast('Atualizando treinos...', 'info');
        }
        indicator.classList.remove('active', 'ready');
        pulling = false;
    });
}

// ==========================================================================
// EVENT BINDINGS
// ==========================================================================
function bindEvents() {
    document.getElementById('login-form').addEventListener('submit', handleLogin);
    document.getElementById('btn-logout-mobile').addEventListener('click', logout);
    document.getElementById('toggle-password').addEventListener('click', () => {
        const inp = document.getElementById('login-password');
        const icon = document.querySelector('#toggle-password i');
        if (inp.type === 'password') {
            inp.type = 'text'; icon.className = 'fa-solid fa-eye-slash';
        } else {
            inp.type = 'password'; icon.className = 'fa-regular fa-eye';
        }
    });
    document.getElementById('btn-close-video').addEventListener('click', closeVideo);
    document.getElementById('video-modal').addEventListener('click', e => {
        if (e.target.id === 'video-modal') closeVideo();
    });

    setupPullToRefresh();
}

// ==========================================================================
// MOBILE NOTIFICATIONS
// ==========================================================================
async function loadMobileNotifications() {
    try {
        const data = await api('/api/notifications');
        state.notifications = data.notifications || [];
        state.unreadNotificationsCount = data.total_unread || 0;
        updateMobileBadge();

        // Se houver notificação urgente não lida, dispara notificação nativa
        const urgent = state.notifications.filter(n => !n.is_read && (n.type === 'workout_deadline' || n.type === 'workout_expired'));
        if (urgent.length > 0) {
            triggerMobilePushNotification(urgent[0].title, urgent[0].message);
        }
    } catch (err) {
        console.warn('Erro ao carregar notificações mobile:', err);
    }
}

function updateMobileBadge() {
    const badge = document.getElementById('mobile-notification-badge');
    if (!badge) return;
    const count = state.unreadNotificationsCount;
    if (count > 0) {
        badge.textContent = count > 99 ? '99+' : count;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
    }
}

function triggerMobilePushNotification(title, body) {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
        try {
            new Notification(title, {
                body,
                icon: '/mobile/icons/icon-192.png'
            });
        } catch (e) {
            if (navigator.serviceWorker && navigator.serviceWorker.ready) {
                navigator.serviceWorker.ready.then(reg => {
                    reg.showNotification(title, {
                        body,
                        icon: '/mobile/icons/icon-192.png'
                    });
                }).catch(() => {});
            }
        }
    }
}

function openMobileNotifications() {
    renderMobileNotifications();
    const modal = document.getElementById('notifications-modal');
    if (modal) modal.classList.add('active');
}

function closeMobileNotifications() {
    const modal = document.getElementById('notifications-modal');
    if (modal) modal.classList.remove('active');
}

function renderMobileNotifications() {
    const container = document.getElementById('mobile-notifications-list');
    if (!container) return;

    if (!state.notifications || state.notifications.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 30px 10px; color: var(--text-muted);">
                <i class="fa-regular fa-bell-slash" style="font-size: 2rem; margin-bottom: 10px; display: block; opacity: 0.3;"></i>
                <p style="font-size: 0.9rem;">Nenhuma notificação encontrada.</p>
                <small>Avisos de término de treinos aparecerão aqui.</small>
            </div>
        `;
        return;
    }

    container.innerHTML = state.notifications.map(n => {
        const timeFmt = new Date(n.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        const icon = n.type === 'workout_expired' ? 'fa-triangle-exclamation' : (n.type === 'workout_deadline' ? 'fa-bell' : 'fa-clock');
        const iconColor = n.type === 'workout_expired' ? '#ef4444' : (n.type === 'workout_deadline' ? '#f97316' : '#eab308');

        return `
            <div class="mobile-notif-card ${n.is_read ? '' : 'unread'}" onclick="markMobileNotificationRead('${n.id}')">
                <i class="fa-solid ${icon}" style="color: ${iconColor}; font-size: 1.1rem; margin-top: 2px;"></i>
                <div style="flex: 1;">
                    <div class="mobile-notif-title">${n.title}</div>
                    <div class="mobile-notif-msg">${n.message}</div>
                    <div class="mobile-notif-time"><i class="fa-regular fa-clock"></i> ${timeFmt}</div>
                </div>
            </div>
        `;
    }).join('');
}

async function markMobileNotificationRead(id) {
    try {
        await api(`/api/notifications/${id}/read`, { method: 'PUT' });
        const notif = state.notifications.find(n => n.id === id);
        if (notif) notif.is_read = true;
        state.unreadNotificationsCount = Math.max(0, state.unreadNotificationsCount - 1);
        updateMobileBadge();
        renderMobileNotifications();
    } catch (err) {}
}

async function markAllMobileNotificationsRead() {
    try {
        await api('/api/notifications/read-all', { method: 'PUT' });
        state.notifications.forEach(n => n.is_read = true);
        state.unreadNotificationsCount = 0;
        updateMobileBadge();
        renderMobileNotifications();
        toast('Todas marcadas como lidas', 'success');
    } catch (err) {
        toast('Erro ao atualizar notificações', 'error');
    }
}
