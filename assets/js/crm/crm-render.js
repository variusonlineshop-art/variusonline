// --- VARIABLES DE ESTADO Y PAGINACIÓN ---
const ITEMS_PER_PAGE = 10; 

window.currentPageClientes = 1;
window.currentDataClientes = [];
window.currentPagePedidos = 1;
window.currentDataPedidos = [];
window.currentPageProductos = 1;
window.currentDataProductos = [];

window.cambiarPaginaClientes = function (page) {
    window.currentPageClientes = page;
    renderClientes(window.currentDataClientes, true);
};

window.cambiarPaginaPedidos = function (page) {
    window.currentPagePedidos = page;
    renderPedidos(window.currentDataPedidos, true);
};

window.cambiarPaginaProductos = function (page) {
    window.currentPageProductos = page;
    renderProductosCards(window.currentDataProductos, true);
};

export function getValidDate(d) {
    if (!d) return 0;
    if (typeof d.toDate === 'function') return d.toDate().getTime();
    return new Date(d).getTime();
}

/**
 * Renderiza clientes agrupados por teléfono/identidad (única tarjeta por cliente)
 */
export function renderClientes(clientes, keepPage = false) {
    const container = document.getElementById('crm-clientes-container');
    const paginationContainer = document.getElementById('crm-pagination-controls');
    if (!container) return;

    // 🚀 AGRUPACIÓN POR CLIENTE (Basado en teléfono o nombre normalizado)
    const clientesAgrupadosMap = {};
    clientes.forEach(c => {
        const key = (c.telefono || c.nombre || "").trim().toLowerCase();
        if (!key) return;

        if (!clientesAgrupadosMap[key]) {
            clientesAgrupadosMap[key] = {
                ...c,
                montoTotal: 0,
                // Guardamos los IDs de todas las órdenes para que el modal de productos busque en todas
                orderIds: [],
                allOrderItems: []
            };
        }

        // Consolidamos montos, ítems y mantenemos la orden más reciente
        clientesAgrupadosMap[key].montoTotal += Number(c.montoTotal) || 0;
        clientesAgrupadosMap[key].orderIds.push(c.id);
        
        if (Array.isArray(c.items)) {
            clientesAgrupadosMap[key].allOrderItems.push(...c.items);
        }

        const currentLatest = getValidDate(clientesAgrupadosMap[key].ultVenta || clientesAgrupadosMap[key].paymentUpdatedAt);
        const incomingDate = getValidDate(c.ultVenta || c.paymentUpdatedAt);
        if (incomingDate >= currentLatest) {
            clientesAgrupadosMap[key].ultVenta = c.ultVenta;
            clientesAgrupadosMap[key].status = c.status;
            clientesAgrupadosMap[key].vendedor = c.vendedor || clientesAgrupadosMap[key].vendedor;
        }
    });

    let clientesUnicos = Object.values(clientesAgrupadosMap);

    // Ordenar de más nuevo a más viejo
    clientesUnicos.sort((a, b) => {
        const dateA = getValidDate(a.ultVenta || a.paymentUpdatedAt);
        const dateB = getValidDate(b.ultVenta || b.paymentUpdatedAt);
        return dateB - dateA;
    });

    window.currentDataClientes = clientesUnicos;
    if (!keepPage) window.currentPageClientes = 1;

    const totalPages = Math.ceil(clientesUnicos.length / ITEMS_PER_PAGE);
    if (window.currentPageClientes > totalPages && totalPages > 0) window.currentPageClientes = totalPages;

    if (clientesUnicos.length === 0) {
        container.innerHTML = `<div class="text-center py-8 text-gray-400"><i class="fa-solid fa-folder-open text-3xl mb-2 block"></i>No se encontraron coincidencias para tu búsqueda.</div>`;
        if (paginationContainer) paginationContainer.innerHTML = '';
        return;
    }

    const startIndex = (window.currentPageClientes - 1) * ITEMS_PER_PAGE;
    const paginatedClientes = clientesUnicos.slice(startIndex, startIndex + ITEMS_PER_PAGE);

    container.innerHTML = paginatedClientes.map(c => {
        const badgeColor = c.status === 'Contactado' ? 'bg-green-50 text-green-600 border-green-200' : c.status === 'Pagado' ? 'bg-purple-50 text-purple-600 border-purple-200' : 'bg-blue-50 text-blue-600 border-blue-200';

        // Pasamos el identificador principal o el primer ID de orden para buscar todos sus productos
        const primaryRefId = c.orderIds[0] || c.id;

        return `
            <div class="p-4 sm:p-5 rounded-2xl bg-white border border-gray-100 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 hover:shadow-md transition-all">
                <div class="flex items-start sm:items-center gap-3 sm:gap-4 w-full">
                    <div class="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-gray-100 text-gray-700 font-bold text-base sm:text-lg flex items-center justify-center uppercase border shrink-0">
                        ${c.nombre.charAt(0)}
                    </div>
                    <div class="min-w-0 flex-1">
                        <div class="flex flex-wrap items-center gap-1.5">
                            <h4 class="font-bold text-gray-800 text-sm sm:text-base truncate max-w-[160px] sm:max-w-none">${c.nombre}</h4>
                            <span class="text-[9px] sm:text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border ${badgeColor}">${c.status}</span>
                            <span class="text-[9px] bg-gray-100 text-gray-500 font-mono px-2 py-0.5 rounded-md">(${c.orderIds.length} órdenes)</span>
                        </div>
                        <p class="text-[11px] sm:text-xs text-gray-500 font-medium mt-0.5 break-words">
                            <i class="fa-solid fa-user-tie text-[9px]"></i> ${c.vendedor ? `Vendedor: ${c.vendedor} • ` : ""}
                            <i class="fa-solid fa-phone text-[9px]"></i> ${c.telefono} 
                            ${c.email ? `• <i class="fa-solid fa-envelope text-[9px]"></i> <span class="block sm:inline truncate">${c.email}</span>` : ''}
                        </p>
                        <p class="text-[10px] sm:text-[11px] text-gray-400 mt-1">
                            Última interacción: <span class="font-semibold text-gray-600">${c.ultVenta || 'N/A'}</span> 
                            • Total Acumulado: <span class="font-bold text-emerald-600">$${(Number(c.montoTotal) || 0).toFixed(2)}</span>
                        </p>
                    </div>
                </div>
                <div class="flex flex-wrap gap-2 w-full lg:w-auto mt-2 lg:mt-0 justify-start lg:justify-end">
                    <!-- BOTÓN DE PRODUCTOS (Abre todas las órdenes del cliente) -->
                    <button onclick="showProductosModal('${primaryRefId}')" class="px-3 py-2 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-600 rounded-xl text-[11px] font-bold transition-colors flex items-center justify-center gap-1 shadow-sm flex-1 sm:flex-none">
                        <i class="fa-solid fa-box-open"></i> Productos (${c.allOrderItems.length})
                    </button>
                    
                    <button onclick="showLeadsModal('${primaryRefId}', '${c.nombre}')" class="px-3 py-2 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-xl text-[11px] font-bold text-gray-600 transition-colors flex items-center justify-center gap-1 flex-1 sm:flex-none" type="button">
                        <i class="fa-solid fa-clock-rotate-left"></i> Historial
                    </button>
                    <a href="https://wa.me/${c.telefono.replace(/[\s+]/g, '')}" target="_blank" onclick="handleLead('whatsapp','${primaryRefId}');" class="px-3 py-2 bg-emerald-500 text-white rounded-xl text-[11px] font-bold hover:bg-emerald-600 text-center transition-colors shadow-sm flex items-center justify-center gap-1 flex-1 sm:flex-none">
                        <i class="fa-brands fa-whatsapp"></i> WhatsApp
                    </a>
                    <a href="tel:${c.telefono.replace(/\s+/g, '')}" onclick="handleLead('llamada','${primaryRefId}');" class="px-3 py-2 bg-blue-50 text-blue-600 rounded-xl text-[11px] font-bold hover:bg-blue-100 text-center transition-colors border border-blue-200 flex items-center justify-center gap-1 flex-1 sm:flex-none">
                        <i class="fa-solid fa-phone"></i> Llamar
                    </a>
                </div>
            </div>
        `;
    }).join('');

    renderPaginationControlsHTML(totalPages, window.currentPageClientes, paginationContainer, 'cambiarPaginaClientes');
}

export function renderPedidos(clientes, keepPage = false) {
    const container = document.getElementById('crm-pedidos-container');
    const paginationContainer = document.getElementById('crm-pedidos-pagination');
    if (!container) return;

    let pedidosPagados = clientes.filter(c => c.status && c.status.toLowerCase() === 'pagado');
    const totalPedidos = pedidosPagados.length;
    const facturacionTotal = pedidosPagados.reduce((acc, p) => acc + (Number(p.montoTotal) || 0), 0);

    const elCount = document.getElementById('kpi-pedidos-count');
    const elRevenue = document.getElementById('kpi-pedidos-revenue');
    if (elCount) elCount.textContent = totalPedidos;
    if (elRevenue) elRevenue.textContent = `$${facturacionTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    pedidosPagados.sort((a, b) => {
        const dateA = getValidDate(a.paymentUpdatedAt || a.ultVenta || a.createdAt);
        const dateB = getValidDate(b.paymentUpdatedAt || b.ultVenta || b.createdAt);
        return dateB - dateA;
    });

    window.currentDataPedidos = pedidosPagados;
    if (!keepPage) window.currentPagePedidos = 1;

    const totalPages = Math.ceil(pedidosPagados.length / ITEMS_PER_PAGE);
    if (window.currentPagePedidos > totalPages && totalPages > 0) window.currentPagePedidos = totalPages;

    if (totalPedidos === 0) {
        container.innerHTML = `
            <div class="text-center py-12 text-gray-400 bg-white rounded-3xl border border-gray-100 p-6 shadow-sm">
                <i class="fa-solid fa-basket-shopping text-3xl mb-2 block text-gray-300"></i>
                <p class="font-bold text-gray-700">No hay pedidos registrados</p>
                <p class="text-xs text-gray-400 mt-1">Intenta con otra búsqueda o limpia los filtros.</p>
            </div>
        `;
        if (paginationContainer) paginationContainer.innerHTML = '';
        return;
    }

    const startIndex = (window.currentPagePedidos - 1) * ITEMS_PER_PAGE;
    const paginatedPedidos = pedidosPagados.slice(startIndex, startIndex + ITEMS_PER_PAGE);

    container.innerHTML = paginatedPedidos.map(p => {
        return `
            <div class="p-4 sm:p-5 rounded-2xl bg-white border border-gray-100 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 hover:shadow-md transition-all">
                <div class="flex items-start sm:items-center gap-3 sm:gap-4 w-full">
                    <div class="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-purple-50 text-purple-700 font-bold text-base sm:text-lg flex items-center justify-center uppercase border border-purple-100 shrink-0">
                        ${p.nombre ? p.nombre.charAt(0) : '?'}
                    </div>
                    <div class="min-w-0 flex-1">
                        <div class="flex flex-wrap items-center gap-1.5">
                            <h4 class="font-bold text-gray-800 text-sm sm:text-base truncate max-w-[160px] sm:max-w-none">${p.nombre}</h4>
                            <span class="text-[9px] sm:text-[10px] uppercase font-black tracking-wider px-2 py-0.5 rounded-full border bg-purple-50 text-purple-600 border-purple-200 shadow-sm">${p.status}</span>
                            <span class="text-[9px] bg-gray-100 text-gray-500 font-mono px-2 py-0.5 rounded-md">ID: ${p.id}</span>
                        </div>
                        <p class="text-[11px] sm:text-xs text-gray-500 font-medium mt-0.5 break-words">
                            <i class="fa-solid fa-user-tie text-[9px]"></i> ${p.vendedor ? `Vendedor: ${p.vendedor} • ` : ""}
                            <i class="fa-solid fa-phone text-[9px]"></i> ${p.telefono}
                        </p>
                        <p class="text-[10px] sm:text-[11px] text-gray-400 mt-1">
                            Fecha: <span class="font-semibold text-gray-600">${p.ultVenta || p.paymentUpdatedAt || 'N/A'}</span> • 
                            Monto: <span class="font-bold text-emerald-600">$${(Number(p.montoTotal) || 0).toFixed(2)}</span>
                        </p>
                    </div>
                </div>
                <div class="flex flex-wrap gap-2 w-full lg:w-auto mt-2 lg:mt-0 justify-start lg:justify-end">
                    <button onclick="showProductosModal('${p.id}')" class="px-3 py-2 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-600 rounded-xl text-[11px] font-bold transition-colors flex items-center justify-center gap-1 shadow-sm flex-1 sm:flex-none">
                        <i class="fa-solid fa-box-open"></i> Productos
                    </button>
                    <button onclick="showLeadsModal('${p.id}', '${p.nombre}')" class="px-3 py-2 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-xl text-[11px] font-bold text-gray-600 transition-colors flex items-center justify-center gap-1 flex-1 sm:flex-none" type="button">
                        <i class="fa-solid fa-clock-rotate-left"></i> Historial
                    </button>
                    <a href="https://wa.me/${p.telefono.replace(/[\s+]/g, '')}" target="_blank" onclick="handleLead('whatsapp','${p.id}');" class="px-3 py-2 bg-emerald-500 text-white rounded-xl text-[11px] font-bold hover:bg-emerald-600 text-center transition-colors shadow-sm flex items-center justify-center gap-1 flex-1 sm:flex-none">
                        <i class="fa-brands fa-whatsapp"></i> WhatsApp
                    </a>
                </div>
            </div>
        `;
    }).join('');

    renderPaginationControlsHTML(totalPages, window.currentPagePedidos, paginationContainer, 'cambiarPaginaPedidos');
}

export function renderProductosCards(productos, keepPage = false) {
    const container = document.getElementById('crm-productos-cards');
    const paginationContainer = document.getElementById('crm-productos-pagination');
    if (!container) return;

    productos.sort((a, b) => getValidDate(b.ultimaVenta) - getValidDate(a.ultimaVenta));

    window.currentDataProductos = productos;
    if (!keepPage) window.currentPageProductos = 1;

    const totalPages = Math.ceil(productos.length / ITEMS_PER_PAGE);
    if (window.currentPageProductos > totalPages && totalPages > 0) window.currentPageProductos = totalPages;

    if (productos.length === 0) {
        container.innerHTML = `<div class="col-span-full text-center text-gray-400 py-8"><i class="fa-solid fa-box-open text-4xl mb-3 block"></i>No se encontraron productos que coincidan.</div>`;
        if (paginationContainer) paginationContainer.innerHTML = '';
        return;
    }

    const startIndex = (window.currentPageProductos - 1) * ITEMS_PER_PAGE;
    const paginatedProductos = productos.slice(startIndex, startIndex + ITEMS_PER_PAGE);

    container.innerHTML = paginatedProductos.map((prod, idx) => {
        let fechaUltimaVenta = prod.ultimaVenta ? new Date(getValidDate(prod.ultimaVenta)).toLocaleString('es-VE') : '-';
        return `
            <div class="bg-white rounded-2xl border border-gray-100 shadow flex flex-col p-4 sm:p-5 gap-3 hover:shadow-md transition">
                <div class="flex items-center gap-3">
                    <img src="${prod.imagen || 'https://via.placeholder.com/60'}" alt="${prod.nombre}" class="w-14 h-14 sm:w-16 sm:h-16 rounded-xl border border-gray-200 object-cover bg-gray-100 shrink-0">
                    <div class="min-w-0 flex-1">
                        <h4 class="font-bold text-gray-800 text-sm sm:text-base truncate">${prod.nombre}</h4>
                        <span class="inline-block bg-gray-100 text-indigo-700 text-[9px] font-bold px-2 py-0.5 rounded-full mt-0.5">#${startIndex + idx + 1} VENDIDO</span>
                    </div>
                </div>
                <div class="grid grid-cols-1 gap-1 text-[11px] sm:text-xs text-gray-500 mt-1">
                    <div><span class="font-semibold text-gray-700">Precio (u.o):</span> $${prod.precioUnitario?.toFixed(2) ?? '0.00'}</div>
                    <div><span class="font-semibold text-gray-700">Uds. vendidas:</span> <span class="text-indigo-700 font-extrabold">${prod.cantidadTotal}</span></div>
                    <div><span class="font-semibold text-gray-700">Último pago:</span> <span class="text-emerald-700 font-bold block sm:inline">${fechaUltimaVenta}</span></div>
                </div>
            </div>
        `;
    }).join('');

    renderPaginationControlsHTML(totalPages, window.currentPageProductos, paginationContainer, 'cambiarPaginaProductos');
}

export function renderPaginationControlsHTML(totalPages, currentPage, container, functionName) {
    if (!container) return;
    if (totalPages <= 1) { container.innerHTML = ''; return; }

    let pages = [];
    if (totalPages <= 7) {
        for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
        if (currentPage <= 4) pages = [1, 2, 3, 4, 5, '...', totalPages];
        else if (currentPage >= totalPages - 3) pages = [1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
        else pages = [1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages];
    }

    let html = `<button onclick="${functionName}(${currentPage - 1})" class="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-bold text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all" ${currentPage === 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i></button>`;

    pages.forEach(p => {
        if (p === '...') {
            html += `<span class="px-2 py-1.5 text-gray-400 font-bold tracking-widest">...</span>`;
        } else {
            const activeClass = p === currentPage ? 'bg-blue-500 text-white border-blue-500 shadow-sm' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50';
            html += `<button onclick="${functionName}(${p})" class="w-8 h-8 flex items-center justify-center rounded-lg border text-sm font-bold transition-all ${activeClass}">${p}</button>`;
        }
    });

    html += `<button onclick="${functionName}(${currentPage + 1})" class="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-bold text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all" ${currentPage === totalPages ? 'disabled' : ''}><i class="fa-solid fa-chevron-right"></i></button>`;
    container.innerHTML = html;
}

export function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('bg-white', 'text-blue-600', 'shadow-sm');
        btn.classList.add('text-gray-500');
    });

    const targetTab = document.getElementById(`tab-${tabId}`);
    const targetBtn = document.getElementById(`btn-tab-${tabId}`);

    if (targetTab) targetTab.classList.add('active');
    if (targetBtn) {
        targetBtn.classList.add('bg-white', 'text-blue-600', 'shadow-sm');
        targetBtn.classList.remove('text-gray-500');
    }

    if (tabId === 'agenda' && typeof window.renderAgenda === 'function') {
        window.renderAgenda();
    } else if (typeof window.applyCrmFilters === 'function') {
        window.applyCrmFilters();
    }
}

export function showToast(msj) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.innerText = msj;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3000);
}