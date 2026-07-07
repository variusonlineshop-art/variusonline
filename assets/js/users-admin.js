import { firebaseConfig } from './firebase-config.js';
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import {
    getAuth,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import {
    getFirestore,
    collection,
    getDocs,
    getDoc,
    doc,
    setDoc,
    updateDoc,
    serverTimestamp,
    query,
    orderBy,
    where
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

// Inicializa Firebase (solo si no está)
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Configurables
const CREATE_USER_FUNCTION_URL = 'https://us-central1-variusonline-976f8.cloudfunctions.net/createUser';
const UPDATE_PASSWORD_URL = `${CREATE_USER_FUNCTION_URL}/updatePassword`; // NUEVO ENDPOINT

// Teléfono: operador(3) + local(7) => total 10 dígitos esperado.
const PHONE_MIN_DIGITS = 9;
const PHONE_MAX_DIGITS = 10;

// DOM elementos
const openAddBtn = document.getElementById('openAddBtn');
const userModal = document.getElementById('userModal');
const closeModalBtn = document.getElementById('closeModal');
const userForm = document.getElementById('userForm');
const cancelBtn = document.getElementById('cancelBtn');
const toastEl = document.getElementById('toast');
const usersBody = document.getElementById('usersBody');
const searchInput = document.getElementById('searchInput');
const roleFilter = document.getElementById('roleFilter');
const statusFilter = document.getElementById('statusFilter');
const perPageSelect = document.getElementById('perPageSelect');
const prevPageBtn = document.getElementById('prevPage');
const nextPageBtn = document.getElementById('nextPage');
const pageInfo = document.getElementById('pageInfo');
const applyFiltersBtn = document.getElementById('applyFilters');
const clearFiltersBtn = document.getElementById('clearFilters');
const loadingModal = document.getElementById('loadingModal');
const loadingText = document.getElementById('loadingText');

// NUEVOS ELEMENTOS PARA ROLES (Sincronizados con tu HTML)
const openAddRoleBtn = document.getElementById('openAddRoleBtn');
const roleModal = document.getElementById('roleModal');
const closeRoleModalBtn = document.getElementById('closeRoleModal');
const cancelRoleBtn = document.getElementById('cancelRoleBtn');
const roleForm = document.getElementById('roleForm');
const uRoleSelect = document.getElementById('u_role');

// Commission DOM
const commissionSection = document.getElementById('commissionSection');
const commissionPercentRadio = document.getElementById('commission_percent_radio');
const commissionAmountRadio = document.getElementById('commission_amount_radio');
const commissionPercentBox = document.getElementById('commission_percent_box');
const commissionAmountBox = document.getElementById('commission_amount_box');
const commissionPercentInput = document.getElementById('commission_percent');
const commissionAmountInput = document.getElementById('commission_amount');

// Password inputs & toggles
const pwdInput = document.getElementById('u_password');
const pwdConfirmInput = document.getElementById('u_password_confirm');
let pwdToggle = null;
let pwdConfirmToggle = null;

// NUEVO: helpers para alertas input
function setInputAlert(id, msg, error = true) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg || '';
    el.style.color = error ? 'red' : 'green';
    el.style.fontWeight = error && msg ? 'bold' : 'normal';
    el.style.display = msg ? 'block' : 'none';
}
function clearAllAlerts() {
    ['u_name_alert', 'u_email_alert', 'u_phone_alert', 'u_password_alert', 'u_password_confirm_alert', 'u_role_alert', 'pw_new_alert', 'pw_new_confirm_alert'].forEach(id => setInputAlert(id, '', false));
}

let allUsers = [];
let filteredUsers = [];
let systemRoles = []; // Almacena los roles cargados de la BD
let currentPage = 1;
let presenceMap = {};
let modalMode = 'add'; // 'add' or 'edit'

// Helpers: toast / loading
function showToast(msg, time = 2500) {
    if (!toastEl) { console.log(msg); return; }
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    setTimeout(() => toastEl.classList.add('hidden'), time);
}
function showLoading(msg = 'Cargando...') {
    if (!loadingModal) return;
    if (loadingText) loadingText.textContent = msg;
    loadingModal.classList.remove('hidden');
    loadingModal.setAttribute('aria-hidden', 'false');
}
function hideLoading() {
    if (!loadingModal) return;
    loadingModal.classList.add('hidden');
    loadingModal.setAttribute('aria-hidden', 'true');
}

// Utils
function escapeHtml(s) { if (!s) return ''; return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function roleClass(role) {
    if (!role) return 'role-vendedor';
    switch (role.toLowerCase()) {
        case 'administrador': return 'role-admin';
        case 'vendedor': return 'role-vendedor';
        case 'motorizado': return 'role-motorizado';
        default: return 'role-vendedor';
    }
}
function statusClass(status) {
    switch ((status || '').toLowerCase()) {
        case 'activo': return 'status-activo';
        case 'inactivo': return 'status-inactivo';
        case 'suspendido': return 'status-suspendido';
        default: return 'status-inactivo';
    }
}

// Regex
const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const DOMAIN_REGEX = /^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

// Phone utilities
function normalizePhone(p) { return (p || '').replace(/\D/g, ''); }
function isPhoneFormatValid(phone) {
    if (!phone) return false;
    const len = phone.length;
    return len >= PHONE_MIN_DIGITS && len <= PHONE_MAX_DIGITS;
}

// LÓGICA COLECTIVA DE ROLES DINÁMICOS
async function loadSystemRoles() {
    try {
        const snap = await getDocs(collection(db, 'roles'));
        systemRoles = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Si la colección está vacía en una base de datos nueva, creamos los por defecto
        if (systemRoles.length === 0) {
            const defaultRoles = [
                { id: 'administrador', name: 'Administrador' },
                { id: 'vendedor', name: 'Vendedor' },
                { id: 'motorizado', name: 'Motorizado' }
            ];
            for (const r of defaultRoles) {
                await setDoc(doc(db, 'roles', r.id), { name: r.name, createdAt: serverTimestamp() });
            }
            systemRoles = defaultRoles;
        }
        renderRoleSelects();
    } catch (err) {
        console.error('Error cargando roles del sistema', err);
        showToast('Error al cargar los roles.');
    }
}

function renderRoleSelects() {
    if (uRoleSelect && roleFilter) {
        // Preservar la opción por defecto en cada select
        uRoleSelect.innerHTML = '<option value="">Seleccionar...</option>';
        roleFilter.innerHTML = '<option value="">Todos los roles</option>';

        systemRoles.forEach(role => {
            const optForm = document.createElement('option');
            optForm.value = role.id;
            optForm.textContent = role.name;
            uRoleSelect.appendChild(optForm);

            const optFilter = document.createElement('option');
            optFilter.value = role.id;
            optFilter.textContent = role.name;
            roleFilter.appendChild(optFilter);
        });
    }
}

// Open/Close para el modal de Roles
openAddRoleBtn?.addEventListener('click', () => {
    if (roleModal) {
        roleModal.classList.remove('hidden');
        roleModal.setAttribute('aria-hidden', 'false');
        roleForm.reset();
    }
});
const closeRoleModal = () => {
    if (roleModal) {
        roleModal.classList.add('hidden');
        roleModal.setAttribute('aria-hidden', 'true');
    }
};
closeRoleModalBtn?.addEventListener('click', closeRoleModal);
cancelRoleBtn?.addEventListener('click', closeRoleModal);

roleForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('new_role_id').value.trim().toLowerCase();
    const name = document.getElementById('new_role_name').value.trim();

    if (!id || !name) return;

    showLoading('Guardando nuevo rol...');
    try {
        const roleRef = doc(db, 'roles', id);
        const check = await getDoc(roleRef);
        if (check.exists()) {
            showToast('El ID de este rol ya existe.');
            hideLoading();
            return;
        }
        await setDoc(roleRef, { name: name, createdAt: serverTimestamp() });
        showToast('Rol creado correctamente.');
        closeRoleModal();
        await loadSystemRoles();
    } catch (err) {
        console.error(err);
        showToast('Error al guardar el rol.');
    } finally {
        hideLoading();
    }
});

// Firestore duplicates
async function isEmailTaken(email, excludeId = null) {
    if (!email) return false;
    const emailLower = email.toLowerCase();
    const q = query(collection(db, 'users'), where('emailLower', '==', emailLower));
    const snap = await getDocs(q);
    for (const d of snap.docs) {
        if (d.id !== excludeId) return true;
    }
    return false;
}

async function isPhoneTaken(phone, excludeId = null) {
    if (!phone) return false;
    const norm = normalizePhone(phone);
    const q = query(collection(db, 'users'), where('phone', '==', norm));
    const snap = await getDocs(q);
    for (const d of snap.docs) {
        if (d.id !== excludeId) return true;
    }
    return false;
}

// Format timestamp
function formatTimestamp(ts) {
    if (!ts) return '';
    try {
        let dateObj;
        if (typeof ts.toDate === 'function') dateObj = ts.toDate();
        else if (ts instanceof Date) dateObj = ts;
        else if (typeof ts === 'number') dateObj = new Date(ts);
        else dateObj = new Date(ts);
        return dateObj.toLocaleString();
    } catch (err) {
        return '';
    }
}

async function loadUsers() {
    try {
        const q = query(collection(db, 'users'), orderBy('createdAt', 'desc'));
        const snap = await getDocs(q);
        allUsers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        applyFiltersAndRender();
    } catch (err) {
        console.error('Error loading users', err);
        showToast('Error cargando usuarios.');
    }
}

// Filters & render
function applyFiltersAndRender() {
    const q = (searchInput?.value || '').toLowerCase();
    const r = roleFilter?.value || '';
    const s = statusFilter?.value || '';
    filteredUsers = allUsers.filter(u => {
        const matchesQ = !q || (
            (u.name || '').toLowerCase().includes(q) ||
            (u.email || '').toLowerCase().includes(q) ||
            (String(u.phone || '')).toLowerCase().includes(q)
        );
        const matchesRole = !r || u.role === r;
        const matchesStatus = !s || (u.status === s);
        return matchesQ && matchesRole && matchesStatus;
    });
    currentPage = 1;
    renderTable();
}

function renderTable() {
    const perPageVal = perPageSelect?.value || '10';
    const perPage = perPageVal === 'all' ? (filteredUsers.length || 1) : parseInt(perPageVal, 10);
    const total = filteredUsers.length;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    if (currentPage > totalPages) currentPage = totalPages;
    const start = (currentPage - 1) * perPage;
    const pageItems = filteredUsers.slice(start, start + perPage);

    if (pageInfo) pageInfo.textContent = `${total ? start + 1 : 0}-${Math.min(start + perPage, total)} de ${total}`;

    // Dentro de renderTable() en users-admin.js
    usersBody.innerHTML = '';
    for (const u of pageItems) {
        const state = presenceMap[u.id] || 'offline';
        const isOnline = state === 'online';
        const tr = document.createElement('tr');

        // Clases dinámicas para la fila según el estado
        tr.className = "group border-b border-slate-100 hover:bg-slate-50/70 transition-colors duration-200";

        const statusLower = (u.status || '').toLowerCase();
        if (statusLower === 'suspendido') tr.classList.add('bg-rose-50/30');
        else if (statusLower === 'inactivo') tr.classList.add('bg-slate-50/40');

        const formatName = (name) => {
            if (!name) return '—';
            return name.toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
        };

        // 1. Columna de Nombre y Email (Con Avatar dinámico)
        const tdName = document.createElement('td');
        tdName.className = "px-6 py-4 whitespace-nowrap";
        const initials = formatName(u.name).split(' ').map(n => n[0]).join('').slice(0, 2);

        tdName.innerHTML = `
        <div class="flex items-center gap-3">
            <div class="relative flex items-center justify-center w-10 h-10 rounded-xl bg-purple-50 text-primary font-bold text-sm border border-purple-100/50 uppercase tracking-wider shrink-0">
                ${initials}
                <span class="absolute bottom-0 right-0 block h-2.5 w-2.5 rounded-full ring-2 ring-white ${isOnline ? 'bg-emerald-500' : 'bg-slate-300'}" title="${isOnline ? 'Conectado' : 'Desconectado'}"></span>
            </div>
            <div class="flex flex-col">
                <span class="font-semibold text-slate-800 leading-tight">${escapeHtml(formatName(u.name))}</span>
                <span class="text-xs text-slate-400 mt-0.5 font-normal">${escapeHtml((u.email || '').toLowerCase())}</span>
            </div>
        </div>
    `;

        // 2. Columna de Rol (Badges estilizados)
        const tdRole = document.createElement('td');
        tdRole.className = "px-6 py-4 whitespace-nowrap";
        const roleObj = systemRoles.find(r => r.id === u.role);
        const printableRole = roleObj ? roleObj.name : u.role;

        // Clases personalizadas de Tailwind para los roles
        let roleColorClass = "bg-slate-100 text-slate-700 border-slate-200";
        if (u.role === 'administrador') roleColorClass = "bg-purple-50 text-purple-700 border-purple-100";
        else if (u.role === 'vendedor') roleColorClass = "bg-blue-50 text-blue-700 border-blue-100";
        else if (u.role === 'motorizado') roleColorClass = "bg-amber-50 text-amber-700 border-amber-100";
        else if (u.role === 'gerente') roleColorClass = "bg-emerald-50 text-emerald-700 border-emerald-100";

        tdRole.innerHTML = `
        <span class="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium border ${roleColorClass}">
            ${escapeHtml(printableRole || '')}
        </span>
    `;

        // 3. Columna de Teléfono
        const tdPhone = document.createElement('td');
        tdPhone.className = "px-6 py-4 whitespace-nowrap text-slate-600 font-medium font-mono text-xs";
        tdPhone.textContent = u.phone || '—';

        // 4. Columna de Fechas (Formato compacto y limpio)
        const tdDate = document.createElement('td');
        tdDate.className = "px-6 py-4 whitespace-nowrap text-xs text-slate-500 space-y-1";
        const createdStr = u.createdAt ? formatTimestamp(u.createdAt).split(',')[0] : '';
        const updatedStr = u.updatedAt ? formatTimestamp(u.updatedAt).split(',')[0] : '';

        let dateHtml = `<div><span class="text-slate-400 font-medium">Alta:</span> ${escapeHtml(createdStr)}</div>`;
        if (statusLower === 'suspendido' && updatedStr) {
            dateHtml += `<div><span class="text-rose-400 font-medium">Susp:</span> ${escapeHtml(updatedStr)}</div>`;
        }
        tdDate.innerHTML = dateHtml;

        // 5. Columna de Estado (Píldoras de estado refinadas)
        const tdStatus = document.createElement('td');
        tdStatus.className = "px-6 py-4 whitespace-nowrap";

        let statusColorClass = "bg-emerald-50 text-emerald-700 border-emerald-100";
        if (statusLower === 'inactivo') statusColorClass = "bg-slate-100 text-slate-600 border-slate-200";
        else if (statusLower === 'suspendido') statusColorClass = "bg-rose-50 text-rose-700 border-rose-100";

        tdStatus.innerHTML = `
        <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${statusColorClass}">
            ${escapeHtml(u.status || 'Activo')}
        </span>
    `;

        // 6. Botones de Acción (Estilo unificado, moderno y con efectos hover)
        const tdActions = document.createElement('td');
        tdActions.className = "px-6 py-4 whitespace-nowrap text-right text-sm font-medium";

        const isActive = (statusLower === 'activo');

        tdActions.innerHTML = `
        <div class="flex items-center justify-end gap-1.5 opacity-80 group-hover:opacity-100 transition-opacity">
            <!-- Editar -->
            <button class="btn-view p-2 bg-slate-50 hover:bg-slate-100 text-slate-600 hover:text-slate-900 rounded-xl border border-slate-200/60 transition shadow-sm" data-id="${u.id}" title="Editar">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
            </button>
            
            <!-- Activar / Inactivar -->
            <button class="btn-toggle-status p-2 ${isActive ? 'bg-amber-50 hover:bg-amber-100 text-amber-600 hover:text-amber-700' : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-600 hover:text-emerald-700'} rounded-xl border border-transparent transition shadow-sm" data-id="${u.id}" data-action="${isActive ? 'inactivate' : 'activate'}" title="${isActive ? 'Inactivar' : 'Activar'}">
                ${isActive ?
                `<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"/></svg>` :
                `<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>`
            }
            </button>
            
            <!-- Suspender -->
            <button class="btn-suspender p-2 bg-rose-50 hover:bg-rose-100 text-rose-600 hover:text-rose-700 rounded-xl border border-transparent transition shadow-sm" data-id="${u.id}" title="Suspender">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-14v4M1 7h22M9 3h6"/></svg>
            </button>
            
            <!-- Permisos -->
            <button class="btn-permissions p-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 hover:text-indigo-700 rounded-xl border border-transparent transition shadow-sm" data-id="${u.id}" title="Permisos">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"/></svg>
            </button>
            
            <!-- Llave de Contraseña -->
            <button class="btn-password p-2 bg-teal-50 hover:bg-teal-100 text-teal-600 hover:text-teal-700 rounded-xl border border-transparent transition shadow-sm" data-id="${u.id}" title="Cambiar Contraseña">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 7a2 2 0 012 2m4 4a2 2 0 01-2 2H5a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1h3l3 3H17v2h4z"/></svg>
            </button>
        </div>
    `;

        tr.appendChild(tdName);
        tr.appendChild(tdRole);
        tr.appendChild(tdPhone);
        tr.appendChild(tdDate);
        tr.appendChild(tdStatus);
        tr.appendChild(tdActions);
        usersBody.appendChild(tr);
    }

    // Attach handlers
    usersBody.querySelectorAll('.btn-view').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.getAttribute('data-id');
            const docSnap = allUsers.find(x => x.id === id);
            if (docSnap) openModal('edit', docSnap);
        });
    });

    // ---------- MODAL DE CONFIRMACIÓN PERSONALIZADO ----------
    function showCustomConfirm({ title, message, confirmText = 'Aceptar', cancelText = 'Cancelar', variant = 'primary', onConfirm }) {
        let modal = document.getElementById('customConfirmModal');

        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'customConfirmModal';
            modal.className = 'fixed inset-0 z-[110] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 hidden';
            modal.setAttribute('role', 'dialog');
            modal.setAttribute('aria-modal', 'true');

            modal.innerHTML = `
            <div class="bg-white rounded-2xl shadow-xl w-full max-w-md border border-slate-100 transform transition-all overflow-hidden p-6 space-y-4">
                <div class="flex items-start gap-3.5">
                    <div id="confirmIconContainer" class="p-2.5 rounded-xl shrink-0">
                        <!-- Icono Dinámico -->
                        <svg id="confirmIcon" class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"></svg>
                    </div>
                    <div>
                        <h3 id="confirmTitle" class="text-base font-bold text-slate-900"></h3>
                        <p id="confirmMessage" class="text-sm text-slate-500 mt-1 leading-relaxed"></p>
                    </div>
                </div>
                <div class="flex justify-end gap-3 pt-2 border-t border-slate-50">
                    <button id="confirmCancelBtn" type="button" class="px-4 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 text-sm font-medium rounded-xl transition"></button>
                    <button id="confirmSuccessBtn" type="button" class="px-4 py-2.5 text-sm font-semibold rounded-xl transition shadow-sm"></button>
                </div>
            </div>
        `;
            document.body.appendChild(modal);
        }

        // Configurar Variantes visuales
        const iconContainer = modal.querySelector('#confirmIconContainer');
        const icon = modal.querySelector('#confirmIcon');
        const successBtn = modal.querySelector('#confirmSuccessBtn');

        if (variant === 'danger') {
            iconContainer.className = 'p-2.5 rounded-xl shrink-0 bg-rose-50 text-rose-600';
            icon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>`;
            successBtn.className = 'px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold rounded-xl transition shadow-sm';
        } else if (variant === 'warning') {
            iconContainer.className = 'p-2.5 rounded-xl shrink-0 bg-amber-50 text-amber-600';
            icon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>`;
            successBtn.className = 'px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl transition shadow-sm';
        } else { // primary / success
            iconContainer.className = 'p-2.5 rounded-xl shrink-0 bg-purple-50 text-primary';
            icon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>`;
            successBtn.className = 'px-4 py-2.5 bg-primary hover:bg-purple-700 text-white text-sm font-semibold rounded-xl transition shadow-sm';
        }

        // Inyectar contenido
        modal.querySelector('#confirmTitle').textContent = title;
        modal.querySelector('#confirmMessage').textContent = message;
        modal.querySelector('#confirmCancelBtn').textContent = cancelText;
        successBtn.textContent = confirmText;

        // Mostrar modal
        modal.classList.remove('hidden');

        // Manejadores de eventos limpios
        const closeModal = () => modal.classList.add('hidden');

        modal.querySelector('#confirmCancelBtn').onclick = () => closeModal();

        successBtn.onclick = () => {
            closeModal();
            if (typeof onConfirm === 'function') onConfirm();
        };
    }

    usersBody.querySelectorAll('.btn-suspender').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.getAttribute('data-id');

            showCustomConfirm({
                title: '¿Suspender usuario?',
                message: 'Esta acción cambiará el estado del usuario a "suspendido", restringiendo de inmediato su acceso al sistema.',
                confirmText: 'Sí, suspender',
                cancelText: 'Cancelar',
                variant: 'danger',
                onConfirm: async () => {
                    try {
                        showLoading('Suspendiendo usuario...');
                        await updateDoc(doc(db, 'users', id), { status: 'suspendido', updatedAt: serverTimestamp() });
                        showToast('Usuario suspendido.');
                        await loadUsers();
                    } catch (err) {
                        console.error('Error suspending user', err);
                        showToast('Error al suspender usuario.');
                    } finally {
                        hideLoading();
                    }
                }
            });
        });
    });
    usersBody.querySelectorAll('.btn-toggle-status').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.getAttribute('data-id');
            const action = e.currentTarget.getAttribute('data-action');
            const newStatus = action === 'inactivate' ? 'Inactivo' : 'Activo';

            showCustomConfirm({
                title: newStatus === 'Activo' ? '¿Activar usuario?' : '¿Inactivar usuario?',
                message: newStatus === 'Activo'
                    ? 'El usuario recuperará todos sus accesos asignados de manera normal.'
                    : 'El usuario pasará a estar inactivo temporalmente.',
                confirmText: newStatus === 'Activo' ? 'Sí, activar' : 'Sí, inactivar',
                cancelText: 'Volver',
                variant: newStatus === 'Activo' ? 'primary' : 'warning',
                onConfirm: async () => {
                    try {
                        showLoading(newStatus === 'Activo' ? 'Activando...' : 'Inactivando...');
                        await updateDoc(doc(db, 'users', id), { status: newStatus, updatedAt: serverTimestamp() });
                        showToast(`Usuario ${newStatus === 'Activo' ? 'activado' : 'inactivado'}.`);
                        await loadUsers();
                    } catch (err) {
                        console.error('Error toggling status', err);
                        showToast('Error cambiando estado.');
                    } finally {
                        hideLoading();
                    }
                }
            });
        });
    });

    usersBody.querySelectorAll('.btn-password').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.getAttribute('data-id');
            openPasswordModal(id);
        });
    });
    usersBody.querySelectorAll('.btn-permissions').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.getAttribute('data-id');
            openPermissionsModal(id);
        });
    });
}

// Reemplazar la función openPermissionsModal por esta versión mejorada
async function openPermissionsModal(userId) {
    const modal = document.getElementById('modalPermissions');
    const permissionsContainer = document.getElementById('permissionsContainer') || document.getElementById('permissionsPagesGrid');

    if (!modal || !permissionsContainer) {
        console.warn('Modal de permisos o contenedor no encontrado', { modal: !!modal, permissionsContainer: !!permissionsContainer });
        return;
    }

    if (!userId) {
        console.warn('openPermissionsModal llamado sin userId');
        return;
    }

    // Intentar sacar el usuario desde memoria; si no existe, cargar desde Firestore
    let userObj = allUsers.find(u => u.id === userId);
    let allowedPages = Array.isArray(userObj?.allowedPages) ? userObj.allowedPages : [];

    if (!userObj) {
        try {
            const snap = await getDoc(doc(db, 'users', userId));
            if (snap.exists()) {
                userObj = { id: snap.id, ...snap.data() };
                allowedPages = Array.isArray(userObj.allowedPages) ? userObj.allowedPages : [];
            } else {
                console.warn('Documento de usuario no encontrado en Firestore para id=', userId);
            }
        } catch (err) {
            console.error('Error fetching user doc', err);
        }
    }

    // Normalizar allowedPages para comparar con mod.id
    const allowedNorm = (allowedPages || []).map(p => String(p).trim().toLowerCase());

    console.log('openPermissionsModal userId=', userId, 'allowedPages=', allowedPages, 'allowedNorm=', allowedNorm);

    const modules = [
        { id: 'panel', name: 'Panel', icon: '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>' },
        { id: 'usuarios', name: 'Usuarios', icon: '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/></svg>' },
        { id: 'productos', name: 'Productos', icon: '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>' },
        { id: 'categoria', name: 'Categoría', icon: '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M7 7h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>' },
        { id: 'pedidos', name: 'Pedidos', icon: '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>' },
        { id: 'cierre_caja', name: 'Cierre de Caja', icon: '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>' },
        { id: 'crm', name: 'CRM', icon: '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>' },
        { id: 'visitas', name: 'Visitas', icon: '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>' },
        { id: 'routes', name: 'Rutas', icon: '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>' }
    ];

    // Limpiar contenedor
    permissionsContainer.className = "grid grid-cols-1 sm:grid-cols-2 gap-3 p-4";
    permissionsContainer.innerHTML = '';

    // Renderizar tarjetas y sincronizar estado
    modules.forEach(mod => {
        const hasPermission = allowedNorm.includes(mod.id);
        console.log('module', mod.id, 'hasPermission=', hasPermission);

        const card = document.createElement('label');
        card.className = `
            relative flex items-center justify-between p-3.5 rounded-xl border cursor-pointer select-none
            transition-all duration-200 group
            ${hasPermission ? 'bg-purple-50/60 border-purple-200 hover:border-purple-300' : 'bg-white border-slate-200 hover:bg-slate-50 hover:border-slate-300'}
        `;

        card.innerHTML = `
            <div class="flex items-center gap-3">
                <div class="flex items-center justify-center w-8 h-8 rounded-lg transition-colors ${hasPermission ? 'bg-purple-500 text-white' : 'bg-slate-100 text-slate-500 group-hover:bg-slate-200'}">
                    ${mod.icon}
                </div>
                <span class="text-sm font-semibold ${hasPermission ? 'text-purple-900' : 'text-slate-700'}">${mod.name}</span>
            </div>

            <input type="checkbox" class="permission-checkbox sr-only" data-module="${mod.id}">

            <div class="w-8 h-5 bg-slate-200 rounded-full transition-colors relative after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all"></div>
        `;

        permissionsContainer.appendChild(card);

        const checkbox = card.querySelector('input.permission-checkbox');
        const iconBox = card.querySelector('.rounded-lg');
        const labelText = card.querySelector('span');
        const switchVisual = card.querySelector('.w-8.h-5');

        const onChange = () => {
            const isChecked = checkbox.checked;
            if (isChecked) {
                card.classList.remove('bg-white', 'border-slate-200', 'hover:bg-slate-50', 'hover:border-slate-300');
                card.classList.add('bg-purple-50/60', 'border-purple-200', 'hover:border-purple-300');
                if (iconBox) { iconBox.classList.remove('bg-slate-100', 'text-slate-500', 'group-hover:bg-slate-200'); iconBox.classList.add('bg-purple-500', 'text-white'); }
                if (labelText) { labelText.classList.remove('text-slate-700'); labelText.classList.add('text-purple-900'); }
                if (switchVisual) { switchVisual.classList.add('!bg-purple-600', 'after:translate-x-full', 'after:border-white'); }
            } else {
                card.classList.remove('bg-purple-50/60', 'border-purple-200', 'hover:border-purple-300');
                card.classList.add('bg-white', 'border-slate-200', 'hover:bg-slate-50', 'hover:border-slate-300');
                if (iconBox) { iconBox.classList.remove('bg-purple-500', 'text-white'); iconBox.classList.add('bg-slate-100', 'text-slate-500', 'group-hover:bg-slate-200'); }
                if (labelText) { labelText.classList.remove('text-purple-900'); labelText.classList.add('text-slate-700'); }
                if (switchVisual) { switchVisual.classList.remove('!bg-purple-600', 'after:translate-x-full', 'after:border-white'); }
            }

            const countEl = document.getElementById('permissionsSelectedCount');
            if (countEl) countEl.textContent = permissionsContainer.querySelectorAll('.permission-checkbox:checked').length;

            const selectAll = document.getElementById('permissionsSelectAll');
            if (selectAll) {
                const total = permissionsContainer.querySelectorAll('.permission-checkbox').length;
                const checked = permissionsContainer.querySelectorAll('.permission-checkbox:checked').length;
                selectAll.checked = (total > 0 && checked === total);
                selectAll.indeterminate = (checked > 0 && checked < total);
            }
        };

        checkbox.addEventListener('change', onChange);

        // Forzar estado inicial y disparar el change para sincronizar clases
        checkbox.checked = hasPermission;
        setTimeout(() => checkbox.dispatchEvent(new Event('change')), 0);
    });

    // Inicializar contador y selectAll
    const countEl = document.getElementById('permissionsSelectedCount');
    if (countEl) countEl.textContent = permissionsContainer.querySelectorAll('.permission-checkbox:checked').length;

    const selectAll = document.getElementById('permissionsSelectAll');
    if (selectAll) {
        selectAll.checked = permissionsContainer.querySelectorAll('.permission-checkbox:checked').length === permissionsContainer.querySelectorAll('.permission-checkbox').length;
        selectAll.indeterminate = false;
        selectAll.onchange = () => {
            const check = selectAll.checked;
            permissionsContainer.querySelectorAll('.permission-checkbox').forEach(cb => { cb.checked = check; cb.dispatchEvent(new Event('change')); });
        };
    }

    // Mostrar modal
    modal.style.setProperty('display', 'flex', 'important');
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');

    // Cerrar modal
    const closeBtn = document.getElementById('cancelPermissionsBtn') || document.getElementById('closePermissionsModal');
    if (closeBtn) {
        closeBtn.onclick = () => {
            modal.style.setProperty('display', 'none', 'important');
            modal.classList.add('hidden');
            modal.setAttribute('aria-hidden', 'true');
        };
    }

    // Guardar cambios
    const saveBtn = document.getElementById('savePermissionsBtn');
    if (saveBtn) {
        saveBtn.onclick = async () => {
            const selectedModules = Array.from(permissionsContainer.querySelectorAll('.permission-checkbox:checked')).map(cb => cb.getAttribute('data-module'));
            try {
                showLoading('Actualizando permisos...');
                await updateDoc(doc(db, 'users', userId), { allowedPages: selectedModules, updatedAt: serverTimestamp() });
                showToast('Permisos guardados correctamente.');
                modal.style.setProperty('display', 'none', 'important');
                modal.classList.add('hidden');
                modal.setAttribute('aria-hidden', 'true');
                await loadUsers();
            } catch (err) {
                console.error('Error guardando permisos', err);
                showToast('Error guardando permisos');
            } finally {
                hideLoading();
            }
        };
    }
}

// Exponer la función al scope global (fuera de la función)
window.openPermissionsModal = openPermissionsModal;

// ---------- MODAL CAMBIO CONTRASEÑA ----------
function openPasswordModal(uid) {
    let modal = document.getElementById('modalPassword');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'modalPassword';
        modal.className = 'modal-password';
        modal.innerHTML = `
            <div class="modal-content">
                <h2>Cambiar contraseña</h2>
                <input id="pw_new" type="password" placeholder="Nueva contraseña" required style="display:block;margin-bottom:5px;">
                <span id="pw_new_alert" class="alert-input" style="color:red;font-size:13px;display:none;"></span>
                <input id="pw_new_confirm" type="password" placeholder="Confirmar contraseña" required style="display:block;margin-bottom:5px;">
                <span id="pw_new_confirm_alert" class="alert-input" style="color:red;font-size:13px;display:none;"></span>
                <div style="margin-top:1em;">
                    <button id="pw_save_btn" class="btn">Guardar</button>
                    <button id="pw_cancel_btn" class="btn-secondary" style="margin-left:12px;">Cancelar</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    document.getElementById('pw_new').value = '';
    setInputAlert('pw_new_alert', '', false);
    document.getElementById('pw_new_confirm').value = '';
    setInputAlert('pw_new_confirm_alert', '', false);

    document.getElementById('pw_cancel_btn').onclick = () => {
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
    };
    document.getElementById('pw_save_btn').onclick = async () => {
        const newPw = document.getElementById('pw_new').value;
        const confirmPw = document.getElementById('pw_new_confirm').value;
        let ok = true;

        if (!newPw) {
            setInputAlert('pw_new_alert', 'Campo requerido', true); ok = false;
        } else if (
            newPw.length < 6 || newPw.length > 8 ||
            !/[A-Z]/.test(newPw) ||
            !/[a-z]/.test(newPw) ||
            !/[0-9]/.test(newPw) ||
            !/[\W_]/.test(newPw)) {
            setInputAlert('pw_new_alert', 'Debe tener 6-8 caracteres, mayúsculas, minúsculas, número y carácter especial.', true);
            ok = false;
        } else {
            setInputAlert('pw_new_alert', '', false);
        }
        if (newPw !== confirmPw) {
            setInputAlert('pw_new_confirm_alert', 'Las contraseñas no coinciden.', true); ok = false;
        } else {
            setInputAlert('pw_new_confirm_alert', '', false);
        }
        if (!ok) return;
        showLoading('Actualizando contraseña...');
        try {
            const idToken = await auth.currentUser.getIdToken(true);
            const res = await fetch(UPDATE_PASSWORD_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + idToken
                },
                body: JSON.stringify({ uid, password: newPw })
            });
            const data = await res.json();
            if (res.ok) {
                showToast('Contraseña actualizada.');
                modal.style.display = 'none';
                modal.setAttribute('aria-hidden', 'true');
            } else {
                setInputAlert('pw_new_alert', data.error || 'Error actualizando contraseña', true);
            }
        } catch (err) {
            setInputAlert('pw_new_alert', 'Error de red/server.', true);
        } finally {
            hideLoading();
        }
    };
}

// -----------------------------
// Commission helpers & role logic
// -----------------------------
function shouldShowCommissionForRole(role) {
    return role === 'vendedor' || role === 'motorizado' || role === 'gerente';
}
function clearCommissionFields() {
    if (commissionPercentRadio) commissionPercentRadio.checked = false;
    if (commissionAmountRadio) commissionAmountRadio.checked = false;
    if (commissionPercentInput) commissionPercentInput.value = '';
    if (commissionAmountInput) commissionAmountInput.value = '';
    if (commissionPercentBox) commissionPercentBox.style.display = 'none';
    if (commissionAmountBox) commissionAmountBox.style.display = 'none';
}
function updateCommissionVisibilityByRole(role) {
    if (!commissionSection) return;
    if (shouldShowCommissionForRole(role)) {
        commissionSection.style.display = 'block';
        commissionSection.classList.remove('hidden'); // Forzar remoción de clase Tailwind
        if (commissionPercentRadio) commissionPercentRadio.setAttribute('required', 'true');
        if (commissionAmountRadio) commissionAmountRadio.setAttribute('required', 'true');
    } else {
        commissionSection.style.display = 'none';
        commissionSection.classList.add('hidden');
        if (commissionPercentRadio) commissionPercentRadio.removeAttribute('required');
        if (commissionAmountRadio) commissionAmountRadio.removeAttribute('required');
        clearCommissionFields();
    }
    showCommissionBoxes();
}
function showCommissionBoxes() {
    if (!commissionPercentBox || !commissionAmountBox) return;
    if (commissionPercentRadio && commissionPercentRadio.checked) {
        commissionPercentBox.style.display = 'block';
        commissionPercentBox.classList.remove('hidden');
        commissionAmountBox.style.display = 'none';
        commissionAmountBox.classList.add('hidden');
        commissionPercentInput?.setAttribute('required', 'true');
        commissionAmountInput?.removeAttribute('required');
    } else if (commissionAmountRadio && commissionAmountRadio.checked) {
        commissionAmountBox.style.display = 'block';
        commissionAmountBox.classList.remove('hidden');
        commissionPercentBox.style.display = 'none';
        commissionPercentBox.classList.add('hidden');
        commissionAmountInput?.setAttribute('required', 'true');
        commissionPercentInput?.removeAttribute('required');
    } else {
        commissionPercentBox.style.display = 'none';
        commissionPercentBox.classList.add('hidden');
        commissionAmountBox.style.display = 'none';
        commissionAmountBox.classList.add('hidden');
        commissionPercentInput?.removeAttribute('required');
        commissionAmountInput?.removeAttribute('required');
    }
}
function getCommissionFromForm() {
    if (commissionPercentRadio && commissionPercentRadio.checked) {
        const v = parseFloat(commissionPercentInput?.value || '0');
        return { commissionType: 'percent', commissionValue: isNaN(v) ? 0 : v };
    }
    if (commissionAmountRadio && commissionAmountRadio.checked) {
        const v = parseFloat(commissionAmountInput?.value || '0');
        return { commissionType: 'amount', commissionValue: isNaN(v) ? 0 : v };
    }
    return { commissionType: null, commissionValue: null };
}

// -----------------------------
// Password toggles
// -----------------------------
function createToggleBtn() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'icon-btn small pwd-toggle absolute right-3 text-slate-400 hover:text-slate-600 focus:outline-none';
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('aria-label', 'Mostrar / ocultar contraseña');
    btn.textContent = '👁️';
    btn.style.fontSize = '14px';
    return btn;
}
function removePasswordToggles() {
    try { if (pwdToggle && pwdToggle.parentNode) pwdToggle.remove(); } catch (e) { }
    try { if (pwdConfirmToggle && pwdConfirmToggle.parentNode) pwdConfirmToggle.remove(); } catch (e) { }
    pwdToggle = null;
    pwdConfirmToggle = null;
    if (pwdInput) {
        pwdInput.type = 'password';
        pwdInput.value = '';
    }
    if (pwdConfirmInput) {
        pwdConfirmInput.type = 'password';
        pwdConfirmInput.value = '';
    }
}

function showPasswordTogglesIfNeeded() {
    if (!pwdInput || !pwdConfirmInput) return;
    const bothHaveText = (pwdInput.value && pwdInput.value.length > 0) && (pwdConfirmInput.value && pwdConfirmInput.value.length > 0);
    const pwdParent = pwdInput.parentNode;
    const pwdConfirmParent = pwdConfirmInput.parentNode;

    if (bothHaveText) {
        if (!pwdToggle) {
            pwdToggle = createToggleBtn();
            pwdToggle.addEventListener('click', () => {
                const isPwd = pwdInput.type === 'password';
                pwdInput.type = isPwd ? 'text' : 'password';
                pwdToggle.textContent = isPwd ? '🙈' : '👁️';
                pwdToggle.setAttribute('aria-pressed', String(!isPwd));
            });
            pwdParent.appendChild(pwdToggle);
        }
        if (!pwdConfirmToggle) {
            pwdConfirmToggle = createToggleBtn();
            pwdConfirmToggle.addEventListener('click', () => {
                const isPwd = pwdConfirmInput.type === 'password';
                pwdConfirmInput.type = isPwd ? 'text' : 'password';
                pwdConfirmToggle.textContent = isPwd ? '🙈' : '👁️';
                pwdConfirmToggle.setAttribute('aria-pressed', String(!isPwd));
            });
            pwdConfirmParent.appendChild(pwdConfirmToggle);
        }
    } else {
        if (pwdToggle) { pwdToggle.remove(); pwdToggle = null; }
        if (pwdConfirmToggle) { pwdConfirmToggle.remove(); pwdConfirmToggle = null; }
        if (pwdInput) pwdInput.type = 'password';
        if (pwdConfirmInput) pwdConfirmInput.type = 'password';
    }
}

if (pwdInput && pwdConfirmInput) {
    pwdInput.addEventListener('input', showPasswordTogglesIfNeeded);
    pwdConfirmInput.addEventListener('input', showPasswordTogglesIfNeeded);
}

// -----------------------------
// Validation
// -----------------------------
function validateForm(values, isEdit = false) {
    let ok = true;
    clearAllAlerts();
    if (!values.name || !values.name.trim()) { setInputAlert('u_name_alert', 'El nombre es requerido.', true); ok = false; }

    const emailExtSelectEl = document.getElementById('u_email_ext');
    const emailExtCustomEl = document.getElementById('u_email_ext_custom');
    if (!values.email) { setInputAlert('u_email_alert', 'Correo requerido.', true); ok = false; }
    else if (!EMAIL_REGEX.test(values.email)) { setInputAlert('u_email_alert', 'Correo inválido.', true); ok = false; }
    else if (emailExtSelectEl && emailExtSelectEl.value === 'otro') {
        const custom = (emailExtCustomEl?.value || '').trim();
        if (!custom) { setInputAlert('u_email_alert', 'Ingresa la extensión de correo.', true); ok = false; }
        else if (!DOMAIN_REGEX.test(custom)) { setInputAlert('u_email_alert', 'Dominio inválido.', true); ok = false; }
    }

    const operator = (document.getElementById('u_operator')?.value || '').trim();
    const phoneLocal = (document.getElementById('u_phone_local')?.value || '').trim();
    const fullPhone = values.phone || '';
    if (!operator) { setInputAlert('u_phone_alert', 'Selecciona la operadora.', true); ok = false; }
    else if (phoneLocal.length !== 7) { setInputAlert('u_phone_alert', 'El número local debe tener 7 dígitos.', true); ok = false; }
    else if (!isPhoneFormatValid(fullPhone)) { setInputAlert('u_phone_alert', `Teléfono inválido. Debe tener entre ${PHONE_MIN_DIGITS} y ${PHONE_MAX_DIGITS} dígitos.`, true); ok = false; }

    if (!values.role || !values.role.trim()) { setInputAlert('u_role_alert', 'Selecciona un rol.', true); ok = false; }

    if (!isEdit || (values.password || values.confirm)) {
        const pw = values.password || '';
        const confirm = values.confirm || '';
        const okLen = pw.length >= 6 && pw.length <= 8;
        const okUpper = /[A-Z]/.test(pw);
        const okLower = /[a-z]/.test(pw);
        const okNumber = /[0-9]/.test(pw);
        const okSpecial = /[\W_]/.test(pw);
        if (!okLen || !okUpper || !okLower || !okNumber || !okSpecial) {
            setInputAlert('u_password_alert', 'La contraseña debe tener 6-8 caracteres e incluir mayúscula, minúscula, número y carácter especial.', true);
            ok = false;
        }
        if (pw !== confirm) { setInputAlert('u_password_confirm_alert', 'Las contraseñas no coinciden.', true); ok = false; }
    }

    if (shouldShowCommissionForRole(values.role)) {
        if (!values.commissionType) { showToast('Selecciona el tipo de comisión (porcentaje o monto).'); ok = false; }
        else {
            if (values.commissionType === 'percent') {
                if (values.commissionValue == null || isNaN(values.commissionValue) || values.commissionValue < 0 || values.commissionValue > 100) {
                    showToast('Ingresa un porcentaje de comisión válido (0-100).'); ok = false;
                }
            } else if (values.commissionType === 'amount') {
                if (values.commissionValue == null || isNaN(values.commissionValue) || values.commissionValue < 0) {
                    showToast('Ingresa un monto de comisión válido.'); ok = false;
                }
            }
        }
    }
    return ok;
}

// -----------------------------
// Form submit (Cloud Function)
// -----------------------------
userForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const userId = document.getElementById('userId')?.value;
    const name = (document.getElementById('u_name')?.value || '').trim();
    const email = getFullEmailFromForm();
    const phone = getFullPhoneFromForm();
    const role = document.getElementById('u_role')?.value;
    const status = (document.getElementById('u_status')?.value) || 'Activo';
    const password = document.getElementById('u_password')?.value;
    const confirm = document.getElementById('u_password_confirm')?.value;

    const commission = getCommissionFromForm();
    const commissionType = commission.commissionType;
    const commissionValue = commission.commissionValue;

    const values = { name, email, phone, role, status, password, confirm, commissionType, commissionValue };
    const isEdit = !!userId;
    if (!validateForm(values, isEdit)) return;

    try {
        const emailTaken = await isEmailTaken(email, isEdit ? userId : null);
        if (emailTaken) { setInputAlert('u_email_alert', 'El correo ya está registrado.', true); return; }
        if (phone) {
            const phoneTaken = await isPhoneTaken(phone, isEdit ? userId : null);
            if (phoneTaken) { setInputAlert('u_phone_alert', 'El teléfono ya está registrado.', true); return; }
        }
    } catch (err) {
        showToast('Error verificando duplicados.');
        return;
    }

    showLoading(isEdit ? 'Actualizando usuario...' : 'Creando usuario...');

    try {
        if (!isEdit) {
            const payload = { name, email, phone, role, status, password };
            if (commissionType) {
                payload.commissionType = commissionType;
                payload.commissionValue = commissionValue;
            }
            let idToken = null;
            try {
                if (auth && auth.currentUser) {
                    idToken = await auth.currentUser.getIdToken(true);
                }
            } catch (tErr) { console.error(tErr); }

            const headers = { 'Content-Type': 'application/json' };
            if (idToken) headers['Authorization'] = 'Bearer ' + idToken;
            const res = await fetch(CREATE_USER_FUNCTION_URL, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload),
            });

            let textBody = await res.text();
            let jsonBody = null;
            try { jsonBody = JSON.parse(textBody); } catch (_) { }

            if (!res.ok) {
                let userMsg = 'Error creando usuario.';
                if (jsonBody && jsonBody.error) userMsg = jsonBody.error;
                showToast(userMsg);
                return;
            }

            try {
                if (jsonBody && jsonBody.uid) {
                    const uid = jsonBody.uid;
                    const userRef = doc(db, 'users', uid);
                    const userSnap = await getDoc(userRef);
                    const baseData = { name, email, phone: normalizePhone(phone), role, status, emailLower: email.toLowerCase() };
                    if (!userSnap.exists()) {
                        const toSet = { ...baseData, createdAt: serverTimestamp() };
                        if (commissionType) { toSet.commissionType = commissionType; toSet.commissionValue = commissionValue; }
                        await setDoc(userRef, toSet);
                    } else {
                        const toUpdate = {};
                        if (commissionType) { toUpdate.commissionType = commissionType; toUpdate.commissionValue = commissionValue; }
                        if (Object.keys(toUpdate).length) await updateDoc(userRef, toUpdate);
                    }
                }
            } catch (fireErr) { console.error(fireErr); }
            showToast('Usuario creado correctamente.');
        } else {
            const updateObj = { name, phone, role, status, updatedAt: serverTimestamp() };
            if (commissionType) {
                updateObj.commissionType = commissionType;
                updateObj.commissionValue = commissionValue;
            } else {
                updateObj.commissionType = null;
                updateObj.commissionValue = null;
            }
            await updateDoc(doc(db, 'users', userId), updateObj);
            showToast('Usuario actualizado.');
        }
        closeModal();
        await loadUsers();
    } catch (err) {
        showToast('Error guardando usuario.');
    } finally {
        hideLoading();
    }
});

function getFullEmailFromForm() {
    const localEl = document.getElementById('u_email_local');
    const extSelectEl = document.getElementById('u_email_ext');
    const extCustomEl = document.getElementById('u_email_ext_custom');
    const local = (localEl?.value || '').trim();
    const extSelect = extSelectEl?.value;
    const ext = extSelect === 'otro' ? (extCustomEl?.value || '').trim() : extSelect;
    if (!local || !ext) return '';
    return `${local}@${ext}`;
}
function getFullPhoneFromForm() {
    const operator = (document.getElementById('u_operator')?.value || '').trim();
    const local = (document.getElementById('u_phone_local')?.value || '').trim();
    return normalizePhone((operator || '') + (local || ''));
}

function openModal(mode = 'add', data = null) {
    removePasswordToggles();
    modalMode = mode;
    const titleEl = document.getElementById('modalTitle');
    const userIdEl = document.getElementById('userId');
    if (titleEl) titleEl.textContent = mode === 'add' ? 'Agregar Usuario' : 'Editar Usuario';
    if (userIdEl) userIdEl.value = data?.id || '';
    if (document.getElementById('u_name')) document.getElementById('u_name').value = data?.name || '';

    const emailLocalEl = document.getElementById('u_email_local');
    const emailExtSelect = document.getElementById('u_email_ext');
    const emailExtCustom = document.getElementById('u_email_ext_custom');
    const emailFull = data?.email || '';
    if (emailLocalEl && emailExtSelect && emailExtCustom) {
        if (emailFull && emailFull.includes('@')) {
            const [local, domain] = emailFull.split('@');
            emailLocalEl.value = local || '';
            const found = Array.from(emailExtSelect.options).some(opt => opt.value === domain);
            if (found) {
                emailExtSelect.value = domain;
                emailExtCustom.style.display = 'none';
                emailExtCustom.value = '';
            } else {
                emailExtSelect.value = 'otro';
                emailExtCustom.style.display = 'block';
                emailExtCustom.value = domain || '';
            }
        } else {
            emailLocalEl.value = '';
            emailExtSelect.value = 'gmail.com';
            emailExtCustom.style.display = 'none';
            emailExtCustom.value = '';
        }
    }

    const operatorEl = document.getElementById('u_operator');
    const phoneLocalEl = document.getElementById('u_phone_local');
    const phoneStored = data?.phone || '';
    if (operatorEl && phoneLocalEl) {
        if (phoneStored && phoneStored.length >= 7) {
            const norm = normalizePhone(phoneStored);
            if (norm.length >= 10) {
                const op = norm.slice(0, 3);
                const local = norm.slice(3);
                operatorEl.value = op;
                phoneLocalEl.value = local;
            } else {
                operatorEl.value = '';
                phoneLocalEl.value = norm;
            }
        } else {
            operatorEl.value = '';
            phoneLocalEl.value = '';
        }
    }

    if (document.getElementById('u_role')) document.getElementById('u_role').value = data?.role || '';
    if (document.getElementById('u_status')) document.getElementById('u_status').value = data?.status || 'Activo';

    if (pwdInput) pwdInput.value = '';
    if (pwdConfirmInput) pwdConfirmInput.value = '';

    clearAllAlerts();

    const setRequired = (id, req) => { const el = document.getElementById(id); if (!el) return; if (req) el.setAttribute('required', 'true'); else el.removeAttribute('required'); };
    const addRequired = mode === 'add';
    setRequired('u_email_local', addRequired);
    setRequired('u_email_ext', addRequired);
    setRequired('u_operator', addRequired);
    setRequired('u_phone_local', addRequired);
    setRequired('u_role', addRequired);
    setRequired('u_password', addRequired);
    setRequired('u_password_confirm', addRequired);

    if (emailExtSelect && emailExtSelect.value === 'otro' && addRequired) emailExtCustom.setAttribute('required', 'true');
    else if (emailExtCustom) emailExtCustom.removeAttribute('required');

    const cType = data?.commissionType || '';
    const cValue = data?.commissionValue != null ? data.commissionValue : '';
    if (commissionPercentRadio) commissionPercentRadio.checked = cType === 'percent';
    if (commissionAmountRadio) commissionAmountRadio.checked = cType === 'amount';
    if (commissionPercentInput) commissionPercentInput.value = (cType === 'percent' && cValue !== '') ? cValue : '';
    if (commissionAmountInput) commissionAmountInput.value = (cType === 'amount' && cValue !== '') ? cValue : '';

    const currentRole = document.getElementById('u_role')?.value || '';
    updateCommissionVisibilityByRole(currentRole);

    if (userModal) {
        userModal.classList.remove('hidden');
        userModal.setAttribute('aria-hidden', 'false');
    }
}

function closeModal() {
    removePasswordToggles();
    if (!userModal) return;
    userModal.classList.add('hidden');
    userModal.setAttribute('aria-hidden', 'true');
}

// -----------------------------
// UI wiring
// -----------------------------
openAddBtn?.addEventListener('click', () => openModal('add'));
closeModalBtn?.addEventListener('click', closeModal);
cancelBtn?.addEventListener('click', (e) => { e.preventDefault(); closeModal(); });
userModal?.addEventListener('click', (e) => { if (e.target === userModal) closeModal(); });

const roleSelectEl = document.getElementById('u_role');
if (roleSelectEl) {
    roleSelectEl.addEventListener('change', (e) => {
        const role = e.target.value;
        updateCommissionVisibilityByRole(role);
    });
}
const phoneLocalInput = document.getElementById('u_phone_local');
if (phoneLocalInput) {
    phoneLocalInput.addEventListener('input', (e) => {
        const cleaned = normalizePhone(e.target.value);
        if (cleaned.length > 7) {
            e.target.value = cleaned.slice(0, 7);
            setInputAlert('u_phone_alert', 'Máximo 7 dígitos (parte local).', true);
            setTimeout(() => setInputAlert('u_phone_alert', '', false), 2200);
        } else {
            e.target.value = cleaned;
            setInputAlert('u_phone_alert', '', false);
        }
    });
}
const emailLocalInput = document.getElementById('u_email_local');
const emailExtSelectEl = document.getElementById('u_email_ext');
const emailExtCustomEl = document.getElementById('u_email_ext_custom');
if (emailLocalInput) {
    emailLocalInput.addEventListener('input', (e) => {
        const v = e.target.value;
        if (v.includes('@')) {
            const [local, rest] = v.split('@');
            e.target.value = local || '';
            if (rest && rest.length && emailExtSelectEl && emailExtCustomEl) {
                const domainCandidate = rest.split('/')[0].split('?')[0];
                const found = Array.from(emailExtSelectEl.options).some(opt => opt.value === domainCandidate);
                if (found) {
                    emailExtSelectEl.value = domainCandidate;
                    emailExtCustomEl.style.display = 'none';
                    emailExtCustomEl.value = '';
                    emailExtCustomEl.removeAttribute('required');
                } else {
                    emailExtSelectEl.value = 'otro';
                    emailExtCustomEl.style.display = 'block';
                    emailExtCustomEl.value = domainCandidate;
                    if (modalMode === 'add') emailExtCustomEl.setAttribute('required', 'true');
                }
            }
            setInputAlert('u_email_alert', '', false);
        } else {
            e.target.value = v.replace(/\s+/g, ' ').trimStart();
            setInputAlert('u_email_alert', '', false);
        }
    });
}
if (emailExtSelectEl) {
    emailExtSelectEl.addEventListener('change', () => {
        if (!emailExtCustomEl) return;
        if (emailExtSelectEl.value === 'otro') {
            emailExtCustomEl.style.display = 'block';
            emailExtCustomEl.focus();
            if (modalMode === 'add') emailExtCustomEl.setAttribute('required', 'true');
        } else {
            emailExtCustomEl.style.display = 'none';
            emailExtCustomEl.value = '';
            emailExtCustomEl.removeAttribute('required');
        }
        setInputAlert('u_email_alert', '', false);
    });
}
if (emailExtCustomEl) {
    emailExtCustomEl.addEventListener('input', (e) => {
        const v = e.target.value;
        if (v.includes('@')) e.target.value = v.replace(/@/g, '');
        setInputAlert('u_email_alert', '', false);
    });
}
document.addEventListener('click', (e) => {
    if (e.target && (e.target.id === 'commission_percent_radio' || e.target.id === 'commission_amount_radio')) {
        setTimeout(showCommissionBoxes, 0);
    }
});
applyFiltersBtn?.addEventListener('click', () => applyFiltersAndRender());
clearFiltersBtn?.addEventListener('click', () => { if (searchInput) searchInput.value = ''; if (roleFilter) roleFilter.value = ''; if (statusFilter) statusFilter.value = ''; if (perPageSelect) perPageSelect.value = '10'; applyFiltersAndRender(); });
if (searchInput) searchInput.addEventListener('input', () => { currentPage = 1; applyFiltersAndRender(); });
roleFilter?.addEventListener('change', () => { currentPage = 1; applyFiltersAndRender(); });
statusFilter?.addEventListener('change', () => { currentPage = 1; applyFiltersAndRender(); });
perPageSelect?.addEventListener('change', () => { currentPage = 1; renderTable(); });
prevPageBtn?.addEventListener('click', () => { if (currentPage > 1) { currentPage--; renderTable(); } });
nextPageBtn?.addEventListener('click', () => {
    const perPageVal = perPageSelect?.value || '10';
    const perPage = perPageVal === 'all' ? (filteredUsers.length || 1) : parseInt(perPageVal, 10);
    const totalPages = Math.max(1, Math.ceil(filteredUsers.length / perPage));
    if (currentPage < totalPages) currentPage++;
    renderTable();
});

window.addEventListener('presence:list', (e) => {
    const users = (e.detail && e.detail.users) || [];
    const map = {};
    for (const u of users) map[u.uid] = (u.state === 'online' ? 'online' : 'offline');
    presenceMap = map;
    if (allUsers.length) renderTable();
});

onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = 'index.html'; return; }
    try {
        const s = await getDoc(doc(db, 'users', user.uid));
        if (s.exists()) {
            const r = s.data().role;
            if (r !== 'administrador') { window.location.href = `/admin/${r}.html`; return; }
        } else { window.location.href = 'index.html'; return; }
    } catch (err) { console.error(err); }

    // CARGAR PRIMERO LOS ROLES Y LUEGO LOS USUARIOS
    await loadSystemRoles();
    await loadUsers();
});
