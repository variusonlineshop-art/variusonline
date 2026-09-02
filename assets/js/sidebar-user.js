import { firebaseConfig } from './firebase-config.js';
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";
import { getFirestore, doc as fsDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";
import { logout } from './auth.js';
import './presence.js';
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const PAGE_CATALOG = {
    panel: { name: 'Panel', icon: '🏠', url: './' },
    usuarios: { name: 'Usuarios', icon: '👥', url: 'usuarios.html' },
    productos: { name: 'Productos', icon: '📦', url: 'product.html' },
    categoria: { name: 'Categoría', icon: '🔖', url: 'category.html' },
    pedidos: { name: 'Pedidos', icon: '📋', url: 'motorizado.html' },
    cierre_caja: { name: 'Cierre de Caja', icon: '💰', url: 'cierre-caja.html' },
    crm: { name: 'CRM', icon: '🖥️', url: 'crm.html' },
    //chat: { name: 'Chat', icon: '💬', url: 'chats.html' },
    visitas: { name: 'Visitas', icon: '👁️', url: 'visits.html' },
    routes: { name: 'Mis Rutas', icon: '📍', url: 'routes.html' },
    //comunicaciones: { name: 'Comunicaciones', icon: '📢', url: '#' }
};
const ROLE_DEFAULT_MENUS = {
    motorizado: ['panel', 'pedidos', 'routes', 'chat'],
    vendedor: ['panel', 'productos', 'categoria', 'visitas', 'chat'],
    admin: ['panel', 'usuarios', 'productos', 'categoria', 'pedidos', 'comunicaciones', 'cierre_caja', 'crm', 'chat', 'visitas', 'routes'],
    administrador: ['panel', 'usuarios', 'productos', 'categoria', 'pedidos', 'comunicaciones', 'cierre_caja', 'crm', 'chat', 'visitas', 'routes']
};
function updateSidebarUI(nombre, role, email) {
    const nameContainer = document.querySelector('.sidebar-user .name');
    const avatarEl = document.querySelector('.sidebar-user .avatar');
    if (nameContainer) {
        const nombreFormateado = toTitleCase(nombre);
        let rolDisplay = role || 'motorizado';
        if (role === 'admin') rolDisplay = 'administrador';
        const rolFormateado = rolDisplay.toLowerCase();
        nameContainer.innerHTML = `
            <span class="block font-bold text-slate-800 text-sm tracking-tight">${nombreFormateado}</span>
            <span class="block text-[10px] font-extrabold text-emerald-600 tracking-wider mt-0.5">${rolFormateado}</span>
        `;
    }
    if (avatarEl && nombre) {
        const initials = nombre.split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase();
        avatarEl.textContent = initials;
    }
}
function buildSidebarMenu(allowedPages) {
    const navList = document.querySelector('.nav-list');
    if (!navList) return;
    let html = '';
    const currentPath = window.location.pathname;
    let currentFilename = currentPath.substring(currentPath.lastIndexOf('/') + 1);
    if (!currentFilename || currentFilename === 'index.html') {
        currentFilename = 'administrador.html';
    }
    const esPanelPrincipal = (currentFilename === 'administrador.html' || currentFilename === 'motorizado.html');
    const paginasUnicas = Array.from(new Set(allowedPages));
    const localRole = sessionStorage.getItem('user_role') || '';
    const localTipo = sessionStorage.getItem('motorizado_tipo') || '';
    if (localRole.toLowerCase().trim() === 'motorizado' && localTipo.toLowerCase().trim() === 'subcontratado') {
        console.log("🧼 Chofer Subcontratado detectado: Purgando y ocultando barra de menú.");
        navList.innerHTML = '';
        return;
    }
    paginasUnicas.forEach(key => {
        const page = PAGE_CATALOG[key];
        if (page) {
            const itemFilename = page.url.substring(page.url.lastIndexOf('/') + 1) || page.url;
            let isCurrentPage = (currentFilename === itemFilename);
            if (currentFilename === 'administrador.html' && key === 'panel') {
                isCurrentPage = true;
            }
            const activeClasses = isCurrentPage
                ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-200/50 active'
                : 'text-slate-500 hover:bg-slate-50';
            if (esPanelPrincipal && (key === 'panel' || key === 'comunicaciones')) {
                const jsAction = key === 'comunicaciones'
                    ? "window.switchModuloAdministrador('comunicaciones');"
                    : "window.switchModuloAdministrador('ordenes');";
                const idAttr = key === 'comunicaciones' ? 'id="link-nav-comunicaciones"' : 'id="link-nav-panel"';
                const itemClasses = key === 'panel' ? activeClasses : 'text-slate-500 hover:bg-slate-50';
                html += `
                    <li class="nav-item mb-1">
                        <a ${idAttr} href="javascript:void(0);" onclick="${jsAction}" class="flex items-center gap-4 px-6 h-14 rounded-2xl font-bold text-sm tracking-tight transition-all ${itemClasses}">
                            <span class="nav-icon text-base">${page.icon}</span>
                            <span class="nav-text tracking-tight">${page.name}</span>
                        </a>
                    </li>`;
            } else {
                html += `
                    <li class="nav-item mb-1">
                        <a href="./${page.url}" class="flex items-center gap-4 px-6 h-14 rounded-2xl font-bold text-sm tracking-tight transition-all ${activeClasses}">
                            <span class="nav-icon text-base">${page.icon}</span>
                            <span class="nav-text tracking-tight">${page.name}</span>
                        </a>
                    </li>`;
            }
        }
    });
    navList.innerHTML = html;
}
function toTitleCase(str) {
    if (!str) return '';
    return str.toLowerCase().split(' ').map(word => {
        return word.charAt(0).toUpperCase() + word.slice(1);
    }).join(' ');
}
function applyRoleRestrictions(role) {
    const r = role.toLowerCase().trim();
    const allSelectors = '.admin-only, .seller-only, .motor-only';
    document.querySelectorAll(allSelectors).forEach(el => {
        el.style.setProperty('display', 'none', 'important');
    });
    if (r === 'administrador' || r === 'admin') {
        document.querySelectorAll(allSelectors).forEach(el => el.style.display = '');
    } else if (r === 'vendedor') {
        document.querySelectorAll('.seller-only').forEach(el => el.style.display = '');
    } else if (r === 'motorizado') {
        document.querySelectorAll('.motor-only').forEach(el => el.style.display = '');
    }
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

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = '/login.html';
        return;
    }
    try {
        const userDocRef = fsDoc(db, 'users', user.uid);
        const userSnap = await getDoc(userDocRef);
        if (userSnap.exists()) {
            const data = userSnap.data();
            const vNombre = data.nombre || data.name || "OPERADOR LOGÍSTICO";
            const vRole = (data.rol || data.role || "motorizado").toLowerCase().trim();
            const vEmail = user.email;
            let allowed = data.allowedPages;
            if (!allowed || !Array.isArray(allowed) || allowed.length === 0) {
                allowed = ROLE_DEFAULT_MENUS[vRole] || ['panel'];
            }
            if ((vRole === 'admin' || vRole === 'administrador') && !allowed.includes('comunicaciones')) {
                allowed.push('comunicaciones');
            }
            updateSidebarUI(vNombre, vRole, vEmail);
            buildSidebarMenu(allowed);
            setTimeout(() => {
                applyRoleRestrictions(vRole);
            }, 100);
        } else {
            console.warn("⚠️ El documento de usuario no existe en la colección 'users'.");
            updateSidebarUI("Invitado", "sin rol");
        }
    } catch (err) {
        console.error("❌ Error en el cargador dinámico de barra lateral:", err);
    }
});
