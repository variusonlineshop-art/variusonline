const SIDEBAR_URL = new URL('../components/sidebar.html', import.meta.url).href;
const SIDEBAR_MODULE = new URL('./sidebar-user.js', import.meta.url).href;
const SIDEBAR_CONTAINER_ID = 'app-sidebar';

// Garantiza toggle y overlay funcionales siempre
async function ensureNavToggleAndOverlay() {
    let navToggle = document.getElementById('nav-toggle');
    if (!navToggle) {
        navToggle = document.createElement('input');
        navToggle.id = 'nav-toggle';
        navToggle.type = 'checkbox';
        navToggle.className = 'nav-toggle';
        navToggle.setAttribute('aria-hidden', 'true');
        document.body.insertAdjacentElement('afterbegin', navToggle);
    }

    let overlay = document.querySelector('.overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'overlay';
        overlay.setAttribute('aria-hidden', 'true');
        overlay.style.display = 'none';
        overlay.style.opacity = '0';
        overlay.style.pointerEvents = 'none';
        navToggle.insertAdjacentElement('afterend', overlay);
    }

    return { navToggle, overlay };
}

// Estilos para collapse en desktop (no hace falta editar CSS global)
function injectSidebarCollapseStyles() {
    if (document.getElementById('sidebar-collapse-styles')) return;
    const css = `
html.sidebar-collapsed .sidebar {
  transform: translateX(-108%);
  box-shadow: none;
}
html.sidebar-collapsed .main {
  margin-left: 0 !important;
}
html.sidebar-collapsed .overlay {
  display: none !important;
  opacity: 0 !important;
  pointer-events: none !important;
}
@media (max-width: 900px) {}
`;
    const s = document.createElement('style');
    s.id = 'sidebar-collapse-styles';
    s.textContent = css;
    document.head.appendChild(s);
}

async function loadSidebar() {
    const placeholder = document.getElementById(SIDEBAR_CONTAINER_ID);
    const { navToggle, overlay } = await ensureNavToggleAndOverlay();

    // 1. Insertar el HTML del sidebar inmediatamente (solo si no existe)
    if (!document.querySelector('aside.sidebar')) {
        try {
            const res = await fetch(SIDEBAR_URL, { cache: 'no-store' });
            if (!res.ok) throw new Error(`Error ${res.status} al cargar ${SIDEBAR_URL}`);
            const html = await res.text();
            if (placeholder) {
                placeholder.insertAdjacentHTML('afterend', html);
                placeholder.remove();
            } else {
                overlay.insertAdjacentHTML('afterend', html);
            }
        } catch (err) {
            // Si falla el fetch, muestra mensaje placeholder
            const fallback = document.createElement('aside');
            fallback.className = 'sidebar';
            fallback.innerHTML = `<div style="padding:2rem;color:#c00">No se pudo cargar el menú lateral.</div>`;
            overlay.insertAdjacentElement('afterend', fallback);
        }
    }

    // 2. Overlay y toggle: SIEMPRE responsivos
    function syncOverlay() {
        if (navToggle.checked) {
            overlay.style.display = '';
            overlay.style.opacity = '1';
            overlay.style.pointerEvents = 'auto';
            overlay.setAttribute('aria-hidden', 'false');
        } else {
            overlay.style.opacity = '0';
            overlay.style.pointerEvents = 'none';
            setTimeout(() => { if (!navToggle.checked) overlay.style.display = 'none'; }, 220);
            overlay.setAttribute('aria-hidden', 'true');
        }
    }
    syncOverlay();

    // Collapse styles para desktop
    injectSidebarCollapseStyles();

    function syncBodyCollapsed() {
        const root = document.documentElement;
        if (navToggle.checked) root.classList.add('sidebar-collapsed');
        else root.classList.remove('sidebar-collapsed');
    }
    syncBodyCollapsed();

    // Listeners NO dependen de la data de usuario, siempre activos
    navToggle.addEventListener('change', () => {
        syncOverlay();
        syncBodyCollapsed();
    });

    overlay.addEventListener('click', () => {
        navToggle.checked = false;
        navToggle.dispatchEvent(new Event('change'));
    });

    // Ajuste responsive: en móvil, nunca forzar collapsed class
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (window.innerWidth <= 900) {
                document.documentElement.classList.remove('sidebar-collapsed');
            } else {
                syncBodyCollapsed();
            }
            // reemite evento resize por si otras partes dependen
            window.dispatchEvent(new Event('resize'));
        }, 120);
    });

    // 3. IMPORT del módulo de usuario (asíncrono y seguro)
    setTimeout(() => {
        import(SIDEBAR_MODULE).catch(err => {
            // Fallback visual simple si falla el import
            const nameEl = document.getElementById('sidebar-name');
            if (nameEl) nameEl.textContent = 'Error al cargar menú';
        });
    }, 0);
}

loadSidebar();
