<<<<<<< HEAD
import { firebaseConfig } from './firebase-config.js';
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import { getFirestore, doc as fsDoc, getDoc } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";
import { logout } from './auth.js';
import { applyUiRestrictions } from './rbac.js';

import './presence.js';

/** Catálogo de páginas soportadas **/
const PAGE_CATALOG = {
    panel:      { name: 'Panel',         icon: '🏠',    url: './' },
    usuarios:   { name: 'Usuarios',      icon: '👥',    url: 'usuarios.html' },
    productos:  { name: 'Productos',     icon: '📦',    url: './product.html' },
    categoria:  { name: 'Categoría',     icon: '🔖',    url: './category.html' },
    pedidos:    { name: 'Pedidos',       icon: '📋',    url: 'orders.html' },
    cierre_caja:{ name: 'Cierre de Caja',icon: '💰',    url: 'cierre-caja.html' },
    crm:        { name: 'CRM',           icon: '🖥️',   url: 'crm.html' },
    chat:       { name: 'Chat',          icon: '💬',    url: 'chats.html' },
    visitas:    { name: 'Visitas',       icon: '👁️',    url: './visits.html' }
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

function whenReady(selector, timeout = 3000) {
    return new Promise((resolve) => {
        const el = document.querySelector(selector);
        if (el) return resolve(el);
        const obs = new MutationObserver(() => {
            const found = document.querySelector(selector);
            if (found) {
                obs.disconnect();
                resolve(found);
            }
        });
        obs.observe(document.documentElement, { childList: true, subtree: true });
        setTimeout(() => {
            obs.disconnect();
            resolve(document.querySelector(selector));
        }, timeout);
    });
}

function getInitials(name) {
    if (!name) return '';
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Construye el menú sidebar según allowedPages **/
function buildSidebarMenu(allowedPages) {
    const navList = document.querySelector('.nav-list');
    if (!navList) return;
    navList.innerHTML = ''; // Borra contenido actual

    allowedPages.forEach(key => {
        const page = PAGE_CATALOG[key];
        if (!page) return; // Ignora claves que no existen en el catálogo

        const li = document.createElement('li');
        li.className = 'nav-item';

        // Resalta el item activo según URL
        const current = window.location.pathname.split('/').pop() || 'index.html';
        let isActive = false;
        try {
            let pageTarget = new URL(page.url, window.location.href).pathname.split('/').pop();
            if (!pageTarget) pageTarget = 'index.html';
            isActive = (pageTarget === current || current.endsWith(pageTarget));
        } catch {
            // Degrada a comparación simple
            isActive = page.url && current.endsWith(page.url);
        }
        if (isActive) li.classList.add('active');

        li.innerHTML = `
            <a href="${page.url}" class="nav-link">
                <span class="nav-icon" aria-hidden="true">${page.icon}</span>
                <span class="nav-text">${page.name}</span>
            </a>
        `;
        navList.appendChild(li);
    });
}

/** Sidebar user section **/
async function init() {
    const sidebarEl = await whenReady('aside.sidebar');
    if (!sidebarEl) {
        console.warn('sidebar-user: sidebar no encontrada en el DOM');
        return;
    }

    const nameEl = sidebarEl.querySelector('.sidebar-user .name') || document.getElementById('sidebar-name');
    const metaEl = sidebarEl.querySelector('.sidebar-user .email') || document.getElementById('sidebar-email');
    const avatarEl = sidebarEl.querySelector('.sidebar-user .avatar') || document.getElementById('sidebar-avatar');
    const logoutBtn = sidebarEl.querySelector('.sidebar-user .logout-btn, .sidebar-user #logout, #logout, .logout-btn');
    const topSearch = document.querySelector('.top-search');

    // --- PRESENCE INDICATOR ---
    function ensurePresenceIndicator() {
        if (!topSearch) return null;
        let indicator = topSearch.querySelector('.presence-indicator');
        if (!indicator) {
            indicator = document.createElement('span');
            indicator.className = 'presence-indicator offline';
            indicator.setAttribute('aria-hidden', 'true');
            indicator.setAttribute('title', 'Estado de conexión: offline');
            topSearch.appendChild(indicator);

            const label = document.createElement('span');
            label.className = 'presence-label';
            label.textContent = 'offline';
            topSearch.appendChild(label);
        }
        return topSearch.querySelector('.presence-indicator');
    }

    function updatePresenceIndicator(state) {
        const indicator = ensurePresenceIndicator();
        if (!indicator) return;
        const label = topSearch.querySelector('.presence-label');
        indicator.classList.remove('online', 'offline', 'error');
        if (state === 'online') {
            indicator.classList.add('online');
            indicator.setAttribute('title', 'Conectado (online)');
            if (label) label.textContent = 'Conectado';
        } else if (state === 'offline') {
            indicator.classList.add('offline');
            indicator.setAttribute('title', 'Desconectado (offline)');
            if (label) label.textContent = 'Desconectado';
        } else {
            indicator.classList.add('error');
            indicator.setAttribute('title', 'Estado desconocido');
            if (label) label.textContent = 'Desconocido';
        }
    }

    window.addEventListener('presence:me', (e) => {
        const { state } = e.detail || {};
        updatePresenceIndicator(state);
    });

    /** Actualiza zona superior usuario **/
    function setSidebar(name, role) {
        if (nameEl) nameEl.textContent = name || 'Invitado';
        if (metaEl) metaEl.textContent = role ? (role.charAt(0).toUpperCase() + role.slice(1)) : '';
        if (avatarEl) avatarEl.textContent = getInitials(name || role || 'U');
    }

    // ==== ON AUTH STATE CHANGED ====
    onAuthStateChanged(auth, async (user) => {
        sidebarEl.classList.add('sidebar-loading');
        if (!user) {
            setSidebar('Invitado', '');
            applyUiRestrictions('');
            updatePresenceIndicator('offline');
            sidebarEl.classList.remove('sidebar-loading');
            buildSidebarMenu([]); // Quita menú
            return;
        }
        try {
            const userRef = fsDoc(db, 'users', user.uid);
            const userSnap = await getDoc(userRef);

            let displayName = user.displayName || user.email || 'Usuario';
            let role = '';
            let allowedPages = [];

            if (userSnap.exists()) {
                const data = userSnap.data();
                displayName = data.name || displayName;
                role = data.role || '';
                allowedPages = Array.isArray(data.allowedPages) ? data.allowedPages : [];
            }

            setSidebar(displayName, role);
            applyUiRestrictions(role);
            updatePresenceIndicator('online');
            buildSidebarMenu(allowedPages);

        } catch (err) {
            console.error('Error obtaining user doc for sidebar:', err);
            setSidebar(user.displayName || user.email || 'Usuario', '');
            applyUiRestrictions('');
            updatePresenceIndicator('');
            buildSidebarMenu([]);
        }
        sidebarEl.classList.remove('sidebar-loading');
    });

    if (logoutBtn) {
        logoutBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            try {
                if (window.__presence && typeof window.__presence.setUserOfflineImmediately === 'function') {
                    const currentUser = auth.currentUser;
                    if (currentUser && currentUser.uid) {
                        await window.__presence.setUserOfflineImmediately(currentUser.uid);
                    }
                }
                await logout();
            } catch (err) {
                console.error('Error logging out from sidebar:', err);
            }
        });
    } else {
        console.debug('sidebar-user: logout button not found yet');
    }

    // --- OVERLAY/TOGGLE LÓGICA (como ya tienes, lo puedes conservar igual) ---
    function getOverlayElement() {
        let ov = document.querySelector('.overlay');
        if (ov) return ov;
        ov = document.createElement('div');
        ov.className = 'overlay';
        ov.setAttribute('aria-hidden', 'true');
        ov.style.position = 'fixed';
        ov.style.inset = '0';
        ov.style.background = 'rgba(0,0,0,0.24)';
        ov.style.display = 'none';
        ov.style.opacity = '0';
        ov.style.pointerEvents = 'none';
        ov.style.zIndex = '70';
        document.body.appendChild(ov);
        return ov;
    }

    const overlay = getOverlayElement();
    const navToggle = document.getElementById('nav-toggle');
    const hamburgerButtons = Array.from(document.querySelectorAll('.hamburger, .hamburger-box, [data-sidebar-toggle]'));

    const desiredSidebarZ = 80;
    sidebarEl.style.zIndex = sidebarEl.style.zIndex || String(desiredSidebarZ);
    const sidebarComputed = getComputedStyle(sidebarEl).position;
    if (!sidebarComputed || sidebarComputed === 'static') {
        sidebarEl.style.position = 'relative';
    }

    function positionOverlay() {
        const rect = sidebarEl.getBoundingClientRect();
        if (rect.width >= window.innerWidth - 2) {
            overlay.style.left = '0';
            overlay.style.right = '0';
            overlay.style.zIndex = String(desiredSidebarZ - 10);
        } else {
            overlay.style.left = Math.max(rect.right, 0) + 'px';
            overlay.style.right = '0';
            overlay.style.zIndex = String(desiredSidebarZ - 10);
        }
    }

    function openSidebar() {
        sidebarEl.classList.add('open');
        sidebarEl.setAttribute('aria-hidden', 'false');
        positionOverlay();
        overlay.style.display = '';
        requestAnimationFrame(() => { overlay.style.opacity = '1'; overlay.style.pointerEvents = 'auto'; overlay.setAttribute('aria-hidden', 'false'); });
        if (navToggle && !navToggle.checked) navToggle.checked = true;
    }

    function closeSidebar() {
        sidebarEl.classList.remove('open');
        sidebarEl.setAttribute('aria-hidden', 'true');
        overlay.style.opacity = '0';
        overlay.style.pointerEvents = 'none';
        overlay.setAttribute('aria-hidden', 'true');
        if (navToggle && navToggle.checked) navToggle.checked = false;
        setTimeout(() => { if (!navToggle || !navToggle.checked) overlay.style.display = 'none'; }, 220);
    }

    if (navToggle) {
        if (navToggle.checked) openSidebar(); else closeSidebar();
        navToggle.addEventListener('change', () => {
            if (navToggle.checked) openSidebar(); else closeSidebar();
        });
    }

    hamburgerButtons.forEach(h => {
        h.addEventListener('click', (e) => {
            if (!navToggle) {
                e.preventDefault();
                if (sidebarEl.classList.contains('open')) closeSidebar(); else openSidebar();
            }
        });
    });

    overlay.addEventListener('click', () => closeSidebar());
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && sidebarEl.classList.contains('open')) {
            closeSidebar();
        }
    });

    sidebarEl.addEventListener('click', (ev) => {
        const a = ev.target.closest && ev.target.closest('a[href]');
        if (!a) return;
        setTimeout(() => {
            if (window.innerWidth <= 900) {
                closeSidebar();
            }
        }, 80);
    });

    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (sidebarEl.classList.contains('open')) {
                positionOverlay();
            }
        }, 80);
    });

    window.__sidebar = {
        open: openSidebar,
        close: closeSidebar,
        toggle: () => sidebarEl.classList.contains('open') ? closeSidebar() : openSidebar()
    };

    ensurePresenceIndicator();
}

init();
=======
import { firebaseConfig } from './firebase-config.js';
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import { getFirestore, doc as fsDoc, getDoc } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";
import { logout } from './auth.js';
import { applyUiRestrictions } from './rbac.js';

import './presence.js';

/** Catálogo de páginas soportadas **/
const PAGE_CATALOG = {
    panel:      { name: 'Panel',         icon: '🏠',    url: './' },
    usuarios:   { name: 'Usuarios',      icon: '👥',    url: 'usuarios.html' },
    productos:  { name: 'Productos',     icon: '📦',    url: './product.html' },
    categoria:  { name: 'Categoría',     icon: '🔖',    url: './category.html' },
    pedidos:    { name: 'Pedidos',       icon: '📋',    url: 'orders.html' },
    cierre_caja:{ name: 'Cierre de Caja',icon: '💰',    url: 'cierre-caja.html' },
    crm:        { name: 'CRM',           icon: '🖥️',   url: 'crm.html' },
    chat:       { name: 'Chat',          icon: '💬',    url: 'chats.html' },
    visitas:    { name: 'Visitas',       icon: '👁️',    url: './visits.html' }
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

function whenReady(selector, timeout = 3000) {
    return new Promise((resolve) => {
        const el = document.querySelector(selector);
        if (el) return resolve(el);
        const obs = new MutationObserver(() => {
            const found = document.querySelector(selector);
            if (found) {
                obs.disconnect();
                resolve(found);
            }
        });
        obs.observe(document.documentElement, { childList: true, subtree: true });
        setTimeout(() => {
            obs.disconnect();
            resolve(document.querySelector(selector));
        }, timeout);
    });
}

function getInitials(name) {
    if (!name) return '';
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Construye el menú sidebar según allowedPages **/
function buildSidebarMenu(allowedPages) {
    const navList = document.querySelector('.nav-list');
    if (!navList) return;
    navList.innerHTML = ''; // Borra contenido actual

    allowedPages.forEach(key => {
        const page = PAGE_CATALOG[key];
        if (!page) return; // Ignora claves que no existen en el catálogo

        const li = document.createElement('li');
        li.className = 'nav-item';

        // Resalta el item activo según URL
        const current = window.location.pathname.split('/').pop() || 'index.html';
        let isActive = false;
        try {
            let pageTarget = new URL(page.url, window.location.href).pathname.split('/').pop();
            if (!pageTarget) pageTarget = 'index.html';
            isActive = (pageTarget === current || current.endsWith(pageTarget));
        } catch {
            // Degrada a comparación simple
            isActive = page.url && current.endsWith(page.url);
        }
        if (isActive) li.classList.add('active');

        li.innerHTML = `
            <a href="${page.url}" class="nav-link">
                <span class="nav-icon" aria-hidden="true">${page.icon}</span>
                <span class="nav-text">${page.name}</span>
            </a>
        `;
        navList.appendChild(li);
    });
}

/** Sidebar user section **/
async function init() {
    const sidebarEl = await whenReady('aside.sidebar');
    if (!sidebarEl) {
        console.warn('sidebar-user: sidebar no encontrada en el DOM');
        return;
    }

    const nameEl = sidebarEl.querySelector('.sidebar-user .name') || document.getElementById('sidebar-name');
    const metaEl = sidebarEl.querySelector('.sidebar-user .email') || document.getElementById('sidebar-email');
    const avatarEl = sidebarEl.querySelector('.sidebar-user .avatar') || document.getElementById('sidebar-avatar');
    const logoutBtn = sidebarEl.querySelector('.sidebar-user .logout-btn, .sidebar-user #logout, #logout, .logout-btn');
    const topSearch = document.querySelector('.top-search');

    // --- PRESENCE INDICATOR ---
    function ensurePresenceIndicator() {
        if (!topSearch) return null;
        let indicator = topSearch.querySelector('.presence-indicator');
        if (!indicator) {
            indicator = document.createElement('span');
            indicator.className = 'presence-indicator offline';
            indicator.setAttribute('aria-hidden', 'true');
            indicator.setAttribute('title', 'Estado de conexión: offline');
            topSearch.appendChild(indicator);

            const label = document.createElement('span');
            label.className = 'presence-label';
            label.textContent = 'offline';
            topSearch.appendChild(label);
        }
        return topSearch.querySelector('.presence-indicator');
    }

    function updatePresenceIndicator(state) {
        const indicator = ensurePresenceIndicator();
        if (!indicator) return;
        const label = topSearch.querySelector('.presence-label');
        indicator.classList.remove('online', 'offline', 'error');
        if (state === 'online') {
            indicator.classList.add('online');
            indicator.setAttribute('title', 'Conectado (online)');
            if (label) label.textContent = 'Conectado';
        } else if (state === 'offline') {
            indicator.classList.add('offline');
            indicator.setAttribute('title', 'Desconectado (offline)');
            if (label) label.textContent = 'Desconectado';
        } else {
            indicator.classList.add('error');
            indicator.setAttribute('title', 'Estado desconocido');
            if (label) label.textContent = 'Desconocido';
        }
    }

    window.addEventListener('presence:me', (e) => {
        const { state } = e.detail || {};
        updatePresenceIndicator(state);
    });

    /** Actualiza zona superior usuario **/
    function setSidebar(name, role) {
        if (nameEl) nameEl.textContent = name || 'Invitado';
        if (metaEl) metaEl.textContent = role ? (role.charAt(0).toUpperCase() + role.slice(1)) : '';
        if (avatarEl) avatarEl.textContent = getInitials(name || role || 'U');
    }

    // ==== ON AUTH STATE CHANGED ====
    onAuthStateChanged(auth, async (user) => {
        sidebarEl.classList.add('sidebar-loading');
        if (!user) {
            setSidebar('Invitado', '');
            applyUiRestrictions('');
            updatePresenceIndicator('offline');
            sidebarEl.classList.remove('sidebar-loading');
            buildSidebarMenu([]); // Quita menú
            return;
        }
        try {
            const userRef = fsDoc(db, 'users', user.uid);
            const userSnap = await getDoc(userRef);

            let displayName = user.displayName || user.email || 'Usuario';
            let role = '';
            let allowedPages = [];

            if (userSnap.exists()) {
                const data = userSnap.data();
                displayName = data.name || displayName;
                role = data.role || '';
                allowedPages = Array.isArray(data.allowedPages) ? data.allowedPages : [];
            }

            setSidebar(displayName, role);
            applyUiRestrictions(role);
            updatePresenceIndicator('online');
            buildSidebarMenu(allowedPages);

        } catch (err) {
            console.error('Error obtaining user doc for sidebar:', err);
            setSidebar(user.displayName || user.email || 'Usuario', '');
            applyUiRestrictions('');
            updatePresenceIndicator('');
            buildSidebarMenu([]);
        }
        sidebarEl.classList.remove('sidebar-loading');
    });

    if (logoutBtn) {
        logoutBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            try {
                if (window.__presence && typeof window.__presence.setUserOfflineImmediately === 'function') {
                    const currentUser = auth.currentUser;
                    if (currentUser && currentUser.uid) {
                        await window.__presence.setUserOfflineImmediately(currentUser.uid);
                    }
                }
                await logout();
            } catch (err) {
                console.error('Error logging out from sidebar:', err);
            }
        });
    } else {
        console.debug('sidebar-user: logout button not found yet');
    }

    // --- OVERLAY/TOGGLE LÓGICA (como ya tienes, lo puedes conservar igual) ---
    function getOverlayElement() {
        let ov = document.querySelector('.overlay');
        if (ov) return ov;
        ov = document.createElement('div');
        ov.className = 'overlay';
        ov.setAttribute('aria-hidden', 'true');
        ov.style.position = 'fixed';
        ov.style.inset = '0';
        ov.style.background = 'rgba(0,0,0,0.24)';
        ov.style.display = 'none';
        ov.style.opacity = '0';
        ov.style.pointerEvents = 'none';
        ov.style.zIndex = '70';
        document.body.appendChild(ov);
        return ov;
    }

    const overlay = getOverlayElement();
    const navToggle = document.getElementById('nav-toggle');
    const hamburgerButtons = Array.from(document.querySelectorAll('.hamburger, .hamburger-box, [data-sidebar-toggle]'));

    const desiredSidebarZ = 80;
    sidebarEl.style.zIndex = sidebarEl.style.zIndex || String(desiredSidebarZ);
    const sidebarComputed = getComputedStyle(sidebarEl).position;
    if (!sidebarComputed || sidebarComputed === 'static') {
        sidebarEl.style.position = 'relative';
    }

    function positionOverlay() {
        const rect = sidebarEl.getBoundingClientRect();
        if (rect.width >= window.innerWidth - 2) {
            overlay.style.left = '0';
            overlay.style.right = '0';
            overlay.style.zIndex = String(desiredSidebarZ - 10);
        } else {
            overlay.style.left = Math.max(rect.right, 0) + 'px';
            overlay.style.right = '0';
            overlay.style.zIndex = String(desiredSidebarZ - 10);
        }
    }

    function openSidebar() {
        sidebarEl.classList.add('open');
        sidebarEl.setAttribute('aria-hidden', 'false');
        positionOverlay();
        overlay.style.display = '';
        requestAnimationFrame(() => { overlay.style.opacity = '1'; overlay.style.pointerEvents = 'auto'; overlay.setAttribute('aria-hidden', 'false'); });
        if (navToggle && !navToggle.checked) navToggle.checked = true;
    }

    function closeSidebar() {
        sidebarEl.classList.remove('open');
        sidebarEl.setAttribute('aria-hidden', 'true');
        overlay.style.opacity = '0';
        overlay.style.pointerEvents = 'none';
        overlay.setAttribute('aria-hidden', 'true');
        if (navToggle && navToggle.checked) navToggle.checked = false;
        setTimeout(() => { if (!navToggle || !navToggle.checked) overlay.style.display = 'none'; }, 220);
    }

    if (navToggle) {
        if (navToggle.checked) openSidebar(); else closeSidebar();
        navToggle.addEventListener('change', () => {
            if (navToggle.checked) openSidebar(); else closeSidebar();
        });
    }

    hamburgerButtons.forEach(h => {
        h.addEventListener('click', (e) => {
            if (!navToggle) {
                e.preventDefault();
                if (sidebarEl.classList.contains('open')) closeSidebar(); else openSidebar();
            }
        });
    });

    overlay.addEventListener('click', () => closeSidebar());
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && sidebarEl.classList.contains('open')) {
            closeSidebar();
        }
    });

    sidebarEl.addEventListener('click', (ev) => {
        const a = ev.target.closest && ev.target.closest('a[href]');
        if (!a) return;
        setTimeout(() => {
            if (window.innerWidth <= 900) {
                closeSidebar();
            }
        }, 80);
    });

    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (sidebarEl.classList.contains('open')) {
                positionOverlay();
            }
        }, 80);
    });

    window.__sidebar = {
        open: openSidebar,
        close: closeSidebar,
        toggle: () => sidebarEl.classList.contains('open') ? closeSidebar() : openSidebar()
    };

    ensurePresenceIndicator();
}

init();
>>>>>>> d2f19fa0b0b836456b14c5e230525c756803ef9e
