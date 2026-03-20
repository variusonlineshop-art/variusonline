import { firebaseConfig } from './firebase-config.js';
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import { getFirestore, doc as fsDoc, getDoc } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";
import { logout } from './auth.js';
import { applyUiRestrictions } from './rbac.js';
import './presence.js';

const PAGE_CATALOG = {
    panel: { name: 'Panel', icon: '🏠', url: './' },
    usuarios: { name: 'Usuarios', icon: '👥', url: './usuarios.html' },
    productos: { name: 'Productos', icon: '📦', url: './product.html' },
    categoria: { name: 'Categoría', icon: '🔖', url: './category.html' },
    pedidos: { name: 'Pedidos', icon: '📋', url: './orders.html' },
    cierre_caja: { name: 'Cierre de Caja', icon: '💰', url: './cierre-caja.html' },
    crm: { name: 'CRM', icon: '🖥️', url: './crm.html' },
    chat: { name: 'Chat', icon: '💬', url: './chats.html' },
    visitas: { name: 'Visitas', icon: '👁️', url: './visits.html' },
    routes: { name: 'Mis Rutas', icon: '📍', url: './routes.html' }
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- MEJORA: Función de UI centralizada ---
function updateSidebarUI(name, role, email = '') {
    const nameEl = document.querySelector('.sidebar-user .name') || document.getElementById('sidebar-name');
    const metaEl = document.querySelector('.sidebar-user .email') || document.getElementById('sidebar-email');
    const avatarEl = document.querySelector('.sidebar-user .avatar') || document.getElementById('sidebar-avatar');

    if (nameEl) nameEl.textContent = name;
    if (metaEl) metaEl.textContent = role || email; // Muestra el email si no hay rol aún
    if (avatarEl) {
        const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
        avatarEl.textContent = initials || 'U';
    }
}

function buildSidebarMenu(allowedPages) {
    const navList = document.querySelector('.nav-list');
    if (!navList || !allowedPages || allowedPages.length === 0) return;

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

document.addEventListener('click', async (e) => {
    const logoutBtn = e.target.closest('.logout-btn, #logout, .sidebar-user .logout-btn');
    if (!logoutBtn) return;

    e.preventDefault();
    console.log("Cerrando sesión...");

    try {
        // 1. Notificar presencia antes de matar la sesión
        if (window.__presence && typeof window.__presence.setUserOfflineImmediately === 'function') {
            const currentUser = auth.currentUser;
            if (currentUser) {
                await window.__presence.setUserOfflineImmediately(currentUser.uid);
            }
        }

        // 2. Ejecutar el logout importado de auth.js
        await logout();

        // 3. Redirección manual si auth.js no lo hace
        window.location.href = '../index.html';
    } catch (err) {
        console.error('Error al cerrar sesión:', err);
    }
});

function updatePresenceIndicator(state) {
    const indicator = ensurePresenceIndicator();
    if (!indicator) return;

    const label = topSearch.querySelector('.presence-label');
    indicator.classList.remove('online', 'offline', 'error');

    // Mapeo de estados para consistencia con presence.js
    if (state === 'online') {
        indicator.classList.add('online');
        if (label) label.textContent = 'En línea';
    } else {
        indicator.classList.add('offline');
        if (label) label.textContent = 'Desconectado';
    }
}

// --- EL CAMBIO CRÍTICO: Escuchar Auth de forma eficiente ---
onAuthStateChanged(auth, async (user) => {
    const sidebarEl = document.querySelector('aside.sidebar');
    if (sidebarEl) sidebarEl.classList.add('sidebar-loading');

    if (!user) {
        window.location.href = '/index.html'; // Redirigir si no hay sesión
        return;
    }

    // 1. Mostrar datos de Auth INMEDIATAMENTE (Nombre/Email)
    // Esto evita que el usuario vea "Invitado" mientras Firestore carga
    updateSidebarUI(user.displayName || user.email.split('@')[0], 'Cargando...', user.email);

    try {
        // 2. Traer datos de Firestore en segundo plano
        const userSnap = await getDoc(fsDoc(db, 'users', user.uid));

        // Busca esta parte en el código anterior y cámbiala por esta versión:
        if (userSnap.exists()) {
            const data = userSnap.data();
            // Prioridad: 1. Nombre en DB, 2. Nombre en Auth, 3. Email
            const finalName = data.name || user.displayName || user.email.split('@')[0];
            const finalRole = data.role || 'Usuario';

            updateSidebarUI(finalName, finalRole);
            applyUiRestrictions(finalRole);

            if (data.allowedPages && data.allowedPages.length > 0) {
                buildSidebarMenu(data.allowedPages);
            } else {
                // Si no hay páginas en DB, ponemos una por defecto para que no salga vacío
                buildSidebarMenu(['panel']);
            }
        }
    } catch (err) {
        console.error("Error cargando perfil:", err);
    } finally {
        if (sidebarEl) sidebarEl.classList.remove('sidebar-loading');
    }
});
window.addEventListener('presence:me', (e) => {
    const { state } = e.detail || {};
    updatePresenceIndicator(state);
});
