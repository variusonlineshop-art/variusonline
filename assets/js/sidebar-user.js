import { firebaseConfig } from './firebase-config.js';
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import { getFirestore, doc as fsDoc, getDoc } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";
import { logout } from './auth.js';
import { applyUiRestrictions } from './rbac.js';
import './presence.js';

// Catálogo de páginas disponibles
const PAGE_CATALOG = {
    panel:      { name: 'Panel',        icon: '🏠',   url: './' },
    usuarios:   { name: 'Usuarios',     icon: '👥',   url: './usuarios.html' },
    productos:  { name: 'Productos',    icon: '📦',   url: './product.html' },
    categoria:  { name: 'Categoría',    icon: '🔖',   url: './category.html' },
    pedidos:    { name: 'Pedidos',      icon: '📋',   url: './orders.html' },
    cierre_caja:{ name: 'Cierre de Caja', icon: '💰', url: './cierre-caja.html' },
    crm:        { name: 'CRM',          icon: '🖥️',   url: './crm.html' },
    chat:       { name: 'Chat',         icon: '💬',   url: './chats.html' },
    visitas:    { name: 'Visitas',      icon: '👁️',   url: './visits.html' },
    routes:     { name: 'Mis Rutas',    icon: '📍',   url: './routes.html' }
};

// Inicialización Firebase
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- UTILIDADES DE UI ---

/** Actualiza el bloque de usuario en el sidebar */
function updateSidebarUI(name, role, email = '') {
    const nameEl = document.querySelector('.sidebar-user .name') || document.getElementById('sidebar-name');
    const metaEl = document.querySelector('.sidebar-user .email') || document.getElementById('sidebar-email');
    const avatarEl = document.querySelector('.sidebar-user .avatar') || document.getElementById('sidebar-avatar');

    if (nameEl) nameEl.textContent = name;
    if (metaEl) metaEl.textContent = role || email;
    if (avatarEl) {
        const initials = name ? name.split(' ').map(s => s[0]).join('').slice(0,2).toUpperCase() : 'U';
        avatarEl.textContent = initials || 'U';
    }
}

/** Construye el menú lateral (solo rellena .nav-list, no cambia listeners ni aside) */
function buildSidebarMenu(allowedPages) {
    const navList = document.querySelector('.nav-list');
    if (!navList) return;
    // fallback si no hay data aún
    if (!Array.isArray(allowedPages) || !allowedPages.length) {
        navList.innerHTML = `
            <li class="nav-skeleton"></li>
            <li class="nav-skeleton"></li>
            <li class="nav-skeleton"></li>
        `;
        return;
    }
    let html = '';
    const current = window.location.pathname.split('/').pop() || 'index.html';
    allowedPages.forEach(key => {
        const page = PAGE_CATALOG[key];
        if (!page) return;
        const isActive = page.url.includes(current) ? 'active' : '';
        html += `
            <li class="nav-item ${isActive}">
                <a href="${page.url}" class="nav-link">
                    <span class="nav-icon">${page.icon}</span>
                    <span class="nav-text">${page.name}</span>
                </a>
            </li>`;
    });
    navList.innerHTML = html;
}

/** Muestra un error solo en el usuario/sidebar, no recarga nada */
function showSidebarUserError(msg) {
    updateSidebarUI('Invitado', msg || 'No disponible');
    buildSidebarMenu(['panel']); // solo acceso básico
}

// --- LOGOUT INTERACTIVO y seguro ---
document.addEventListener('click', async (e) => {
    const logoutBtn = e.target.closest('.logout-btn, #logout, .sidebar-user .logout-btn');
    if (!logoutBtn) return;
    e.preventDefault();

    // Notifica presencia, luego logout (si presence.js lo soporta)
    try {
        if (window.__presence && typeof window.__presence.setUserOfflineImmediately === 'function') {
            const currentUser = auth.currentUser;
            if (currentUser) {
                await window.__presence.setUserOfflineImmediately(currentUser.uid);
            }
        }
        await logout();
        // Redirección adicional, defensiva
        window.location.href = '../index.html';
    } catch (err) {
        updateSidebarUI('Invitado', 'Error al cerrar sesión');
        console.error('Error al cerrar sesión:', err);
    }
});

// ------ PRESENCE: UI pill mínima en la esquina del usuario (opcional) --------
function updatePresenceIndicator(state) {
    const indicator = document.querySelector('.sidebar-user .presence-indicator');
    if (!indicator) return;
    indicator.classList.remove('online', 'offline', 'error');
    if (state === 'online') indicator.classList.add('online');
    else if (state === 'offline') indicator.classList.add('offline');
    else indicator.classList.add('error');
}
// Puedes agregar un pequeño elemento ".presence-indicator" en sidebar.html si quieres la pill visual

// ------ FLUJO PRINCIPAL: AuthStateChanged rápido y resiliente ---------
onAuthStateChanged(auth, async (user) => {
    const sidebarEl = document.querySelector('aside.sidebar');
    if (sidebarEl) sidebarEl.classList.add('sidebar-loading');

    // 1. No hay usuario → muestra "modo visitante", no fuerces recarga
    if (!user) {
        showSidebarUserError('No autenticado');
        if (sidebarEl) sidebarEl.classList.remove('sidebar-loading');
        return;
    }
    // 2. Actualiza datos mínimos de inmediato mientras consulta Firestore
    updateSidebarUI(
        user.displayName || (user.email ? user.email.split('@')[0] : 'Usuario'),
        'Cargando…',
        user.email || ''
    );
    buildSidebarMenu(); // muestra esqueleto mientras resuelve
    // 3. Consulta Firestore detalles del usuario y menú
    try {
        const userSnap = await getDoc(fsDoc(db, 'users', user.uid));
        if (userSnap.exists()) {
            const data = userSnap.data();
            const finalName = data.name || user.displayName || (user.email ? user.email.split('@')[0] : 'Usuario');
            const finalRole = data.role || 'Usuario';
            updateSidebarUI(finalName, finalRole, user.email);
            applyUiRestrictions(finalRole);

            if (Array.isArray(data.allowedPages) && data.allowedPages.length > 0) {
                buildSidebarMenu(data.allowedPages);
            } else {
                buildSidebarMenu(['panel']);
            }
        } else {
            showSidebarUserError('Usuario sin datos');
        }
    } catch (err) {
        showSidebarUserError('Error de conexión');
        console.error("Error cargando perfil:", err);
    } finally {
        if (sidebarEl) sidebarEl.classList.remove('sidebar-loading');
    }
});

// Actualiza la presencia (si deseas la pill visual)
window.addEventListener('presence:me', (e) => {
    const { state } = e.detail || {};
    updatePresenceIndicator(state);
});

// Carga por defecto: skeleton mínimo
buildSidebarMenu();
updateSidebarUI('Cargando…', '', '');
