// Componente de Renderizado de UI

/**
 * Renderiza los clientes en el contenedor del CRM
 * @param {Array} clientes - Lista de clientes procesados
 */
export function renderClientes(clientes) {
    const container = document.getElementById('crm-clientes-container');
    if (!container) return;

    if (clientes.length === 0) {
        container.innerHTML = `
            <div class="text-center py-8 text-gray-400">
                <i class="fa-solid fa-folder-open text-3xl mb-2 block"></i>
                No se encontraron clientes con estado "Contactado" o "Postergado".
            </div>
        `;
        return;
    }

    container.innerHTML = clientes.map(c => {
        // Estilo de badge dinámico según el estado en Firebase
        const badgeColor = c.status === 'Contactado'
            ? 'bg-green-50 text-green-600 border-green-200'
            : c.status === 'Pagado'
                ? 'bg-purple-50 text-purple-600 border-purple-200' // Estilo para los finalizados
                : 'bg-blue-50 text-blue-600 border-blue-200';

        return `
            <div class="p-5 rounded-2xl bg-white border border-gray-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 hover:shadow-md transition-all">
                <div class="flex items-center gap-4">
                    <div class="w-12 h-12 rounded-full bg-gray-100 text-gray-700 font-bold text-lg flex items-center justify-center uppercase border">
                        ${c.nombre.charAt(0)}
                    </div>
                    <div>
                        <div class="flex items-center gap-2">
                            <h4 class="font-bold text-gray-800 text-base">${c.nombre}</h4>
                            <span class="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border ${badgeColor}">
                                ${c.status}
                            </span>
                        </div>
                        <p class="text-xs text-gray-500 font-medium mt-0.5">
                            <i class="fa-solid fa-user-tie text-[10px]"></i>
                            ${c.vendedor ? `Vendedor: ${c.vendedor} • ` : ""}
                            <i class="fa-solid fa-phone text-[10px]"></i> ${c.telefono} 
                            ${c.email ? `• <i class="fa-solid fa-envelope text-[10px]"></i> ${c.email}` : ''}
                        </p>
                        <p class="text-[11px] text-gray-400 mt-1">
                            Última interacción: <span class="font-semibold text-gray-600">${c.ultVenta}</span> 
                            • Total acumulado: <span class="font-bold text-emerald-600">$${c.montoTotal.toFixed(2)}</span>
                        </p>
                    </div>
                </div>
                <div class="flex gap-2 w-full sm:w-auto">
                    <button 
                        onclick="showLeadsModal('${c.id}', '${c.nombre}')" 
                        class="flex-1 sm:flex-none px-4 py-2 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-xl text-xs font-bold text-gray-600 transition-colors"
                        type="button"
                    >
                        <i class="fa-solid fa-clock-rotate-left"></i> Historial
                    </button>
                    <a 
                        href="https://wa.me/${c.telefono.replace(/[\s+]/g, '')}" 
                        target="_blank" 
                        onclick="handleLead('whatsapp','${c.id}');"
                        class="flex-1 sm:flex-none px-4 py-2 bg-emerald-500 text-white rounded-xl text-xs font-bold hover:bg-emerald-600 text-center transition-colors shadow-sm"
                    >
                        <i class="fa-brands fa-whatsapp"></i> WhatsApp
                    </a>
                    <a 
                        href="tel:${c.telefono.replace(/\s+/g, '')}" 
                        onclick="handleLead('llamada','${c.id}');"
                        class="flex-1 sm:flex-none px-4 py-2 bg-blue-50 text-blue-600 rounded-xl text-xs font-bold hover:bg-blue-100 text-center transition-colors border border-blue-200"
                    >
                        <i class="fa-solid fa-phone"></i> Llamar
                    </a>
                    <a 
                        href="sms:${c.telefono.replace(/\s+/g, '')}" 
                        onclick="handleLead('sms','${c.id}');"
                        class="flex-1 sm:flex-none px-4 py-2 bg-yellow-50 text-yellow-600 rounded-xl text-xs font-bold hover:bg-yellow-100 text-center transition-colors border border-yellow-200"
                    >
                        <i class="fa-solid fa-comment"></i> SMS
                    </a>
                </div>
            </div>
        `;
    }).join('');
}

export function renderProductosCards(productos) {
    const container = document.getElementById('crm-productos-cards');
    if (!container) return;

    container.innerHTML = '';
    if (!productos.length) {
        container.innerHTML = `
            <div class="col-span-full text-center text-gray-400 py-8">
                <i class="fa-solid fa-box-open text-4xl mb-3 block"></i>
                No hay productos vendidos en órdenes con estatus "Pagado".
            </div>
        `;
        return;
    }

    productos.forEach((prod, idx) => {
        // --- FECHA DE ÚLTIMO PAGO ---
        let fechaUltimaVenta = '-';
        if (prod.ultimaVenta) {
            let fechaJS = null;
            if (typeof prod.ultimaVenta === 'object' && typeof prod.ultimaVenta.toDate === 'function') {
                fechaJS = prod.ultimaVenta.toDate();
            } else if (typeof prod.ultimaVenta === 'string' || typeof prod.ultimaVenta === 'number') {
                fechaJS = new Date(prod.ultimaVenta);
            }
            if (fechaJS && !isNaN(fechaJS.getTime())) {
                fechaUltimaVenta = fechaJS.toLocaleString('es-VE');
            }
        }

        container.innerHTML += `
            <div class="bg-white rounded-2xl border border-gray-100 shadow flex flex-col p-5 gap-3 hover:shadow-md transition">
                <div class="flex items-center gap-3">
                    <img src="${prod.imagen || 'https://via.placeholder.com/60'}" alt="${prod.nombre}" class="w-16 h-16 rounded-xl border border-gray-200 object-cover bg-gray-100 flex-shrink-0">
                    <div>
                        <h4 class="font-bold text-gray-800 text-base">${prod.nombre}</h4>
                        <span class="bg-gray-100 text-indigo-700 text-[10px] font-bold px-2 py-0.5 rounded-full ml-0">
                            #${idx + 1} MÁS VENDIDO
                        </span>
                    </div>
                </div>
                <div class="grid grid-cols-1 gap-1 text-xs text-gray-500 mt-2">
                    <div>
                        <span class="font-semibold text-gray-700">Precio (última orden):</span>
                        $${prod.precioUnitario?.toFixed(2) ?? '0.00'}
                    </div>
                    <div>
                        <span class="font-semibold text-gray-700">Unidades vendidas:</span>
                        <span class="text-indigo-700 font-extrabold">${prod.cantidadTotal}</span>
                    </div>
                    <div>
                        <span class="font-semibold text-gray-700">Último pago:</span>
                        <span class="text-emerald-700 font-bold">${fechaUltimaVenta}</span>
                    </div>
                </div>
            </div>
        `;
    });
}
/**
 * Cambiador de pestañas de la interfaz
 */
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
    }
}

/**
 * Genera mensajes Toast flotantes
 */
export function showToast(msj) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.innerText = msj;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3000);
}
