import { listenCrmOrders, listenCrmLeads } from './crm-firebase.js';
import { renderClientes, switchTab, showToast, renderProductosCards, renderPedidos, renderPaginationControlsHTML, getValidDate } from './crm-render.js';
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
    getFirestore, collection, query, where, getDocs, doc, updateDoc, addDoc, Timestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";
import { firebaseConfig } from '../firebase-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

window.switchTab = switchTab;

document.addEventListener('DOMContentLoaded', () => {
    showToast("Conectando al CRM en tiempo real...");
    window.crmState = window.crmState || { clientes: [], leads: [] };

    listenCrmOrders((clientesFiltrados) => {
        window.crmState = { ...window.crmState, clientes: clientesFiltrados };
        window.applyCrmFilters(); 
    });

    listenCrmLeads((leadsRegistrados) => {
        window.crmState = { ...window.crmState, leads: leadsRegistrados };
        const containerComunicaciones = document.getElementById('tab-comunicaciones');
        if (containerComunicaciones && window.getComputedStyle(containerComunicaciones).display !== 'none') {
            if (typeof window.renderComunicaciones === 'function') window.renderComunicaciones();
        }
    });
});

/////////////////////////////
window.getAgendaMap = function getAgendaMap() {
    const state = window.crmState || { clientes: [] };
    const map = {};
    state.clientes.forEach(order => {
        if (order.status && order.status.toLowerCase() === 'postergado' && Array.isArray(order.postponeHistory)) {
            order.postponeHistory.forEach(pos => {
                if (!pos.date) return;
                if (!map[pos.date]) map[pos.date] = [];
                map[pos.date].push({ ...order, postponeHistory: order.postponeHistory, postponeData: pos });
            });
        }
    });
    return map;
};

window.showAgendaFullCalendarDay = function (date, orders) {
    document.getElementById('agendaModalTitle').innerHTML = `
        <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center text-base shadow-sm border border-blue-100">
                <i class="fa-solid fa-calendar-day"></i>
            </div>
            <div>
                <h3 class="font-black text-gray-800 text-lg">Órdenes Programadas</h3>
                <p class="text-xs text-gray-400 font-medium">${date}</p>
            </div>
        </div>
    `;
    const modalBody = document.getElementById('agendaModalBody');
    let html = "";
    if (!orders.length) {
        html = `<div class="text-center py-12 text-gray-400"><div class="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-3 border border-dashed border-gray-200"><i class="fa-solid fa-calendar-xmark text-xl text-gray-300"></i></div><p class="text-sm font-bold text-gray-700">No hay pendientes</p></div>`;
    } else {
        orders.forEach(order => {
            const allPostpones = (order.postponeHistory || []).filter(pos => pos.date === date);
            html += `
            <div class="border border-gray-100 rounded-2xl p-5 bg-gradient-to-b from-white to-gray-50/50 shadow-sm mb-4 last:mb-0 hover:border-gray-200 transition-all">
                <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 pb-4 mb-4 border-b border-gray-100">
                    <div>
                        <span class="text-[10px] bg-gray-100 text-gray-600 font-bold px-2 py-0.5 rounded-md font-mono">ID: ${order.id}</span>
                        <h4 class="font-bold text-gray-800 text-base mt-1 flex items-center gap-1.5"><i class="fa-solid fa-user text-xs text-gray-400"></i> ${order.nombre}</h4>
                    </div>
                </div>
            </div>`;
        });
    }
    modalBody.innerHTML = html;
    document.getElementById('agendaModalBackdrop').classList.remove('hidden');
    document.getElementById('agendaModal').classList.remove('hidden');
};

window.renderAgenda = function renderAgenda() {
    const agendaMap = window.getAgendaMap();
    const container = document.getElementById('crm-agenda-container');
    if (!container) return;
    container.innerHTML = '';
    const fcDiv = document.createElement('div');
    fcDiv.id = 'fullcalendar';
    container.appendChild(fcDiv);

    const events = [];
    Object.keys(agendaMap).forEach(date => {
        const orders = agendaMap[date];
        events.push({ title: `${orders.length} órdenes postergadas`, start: date, allDay: true, extendedProps: { orders } });
    });

    if (typeof FullCalendar === "undefined") return;

    const calendar = new FullCalendar.Calendar(fcDiv, {
        initialView: 'dayGridMonth',
        locale: 'es',
        height: 500,
        events,
        fixedWeekCount: false,
        headerToolbar: { left: 'prev,next today', center: 'title', right: '' },
        eventClick(info) {
            const orders = info.event.extendedProps.orders;
            if (orders && orders.length) window.showAgendaFullCalendarDay(info.event.startStr, orders);
        },
    });
    calendar.render();
};

window.closeAgendaModal = function closeAgendaModal() {
    document.getElementById('agendaModalBackdrop').classList.add('hidden');
    document.getElementById('agendaModal').classList.add('hidden');
}

// ----------------------------------------------------
// FILTROS GLOBALES
// ----------------------------------------------------
window.applyCrmFilters = function applyCrmFilters() {
    window.currentPageClientes = 1;
    window.currentPagePedidos = 1;
    window.currentPageProductos = 1;
    window.currentPageComunicaciones = 1;

    const state = window.crmState || { clientes: [] };
    const status = document.getElementById('crmFilterStatus').value;
    const date = document.getElementById('crmFilterDate').value;
    const searchInput = document.getElementById('crm-search-input');
    const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : "";

    let filtrados = [...state.clientes];

    if (searchTerm) {
        filtrados = filtrados.filter(c => {
            const matchText = (c.nombre || "").toLowerCase().includes(searchTerm) ||
                              (c.telefono || "").includes(searchTerm) ||
                              (c.id || "").toLowerCase().includes(searchTerm);
            
            const matchProduct = c.items && Array.isArray(c.items) && c.items.some(item =>
                (item.name || "").toLowerCase().includes(searchTerm)
            );
            return matchText || matchProduct;
        });
    }

    if (status !== "all") {
        filtrados = filtrados.filter(c => c.status && c.status.toLowerCase() === status.toLowerCase());
    }

    if (date) {
        filtrados = filtrados.filter(c => c.ultVenta && c.ultVenta.startsWith(date));
    }

    const containerClientes = document.getElementById('tab-clientes');
    const containerPedidos = document.getElementById('tab-pedidos');
    const containerComunicaciones = document.getElementById('tab-comunicaciones');
    const containerProductos = document.getElementById('tab-productos');

    if (containerClientes && window.getComputedStyle(containerClientes).display !== 'none') {
        renderClientes(filtrados, true);
    }
    if (containerPedidos && window.getComputedStyle(containerPedidos).display !== 'none') {
        renderPedidos(filtrados, true);
    }
    if (containerComunicaciones && window.getComputedStyle(containerComunicaciones).display !== 'none') {
        if (typeof window.renderComunicaciones === 'function') window.renderComunicaciones();
    }
    if (containerProductos && window.getComputedStyle(containerProductos).display !== 'none') {
        if (typeof window.loadProductosVendidos === 'function') window.loadProductosVendidos();
    }

    const totalMonto = filtrados.reduce((acc, c) => acc + (Number(c.montoTotal) || 0), 0);
    const kpiQty = document.getElementById('crm-kpi-qty');
    const kpiAmount = document.getElementById('crm-kpi-amount');
    if (kpiQty) kpiQty.innerText = filtrados.length;
    if (kpiAmount) kpiAmount.innerText = `$${totalMonto.toFixed(2)}`;
};

window.clearCrmFilters = function clearCrmFilters() {
    document.getElementById('crmFilterDate').value = '';
    document.getElementById('crmFilterStatus').value = 'all';
    document.getElementById('crmFilterChannel').value = 'all';
    const searchInput = document.getElementById('crm-search-input');
    if(searchInput) searchInput.value = '';
    window.applyCrmFilters();
};

window.loadProductosVendidos = async function loadProductosVendidos() {
    const state = window.crmState || { clientes: [] };
    // Tomamos todas las órdenes (pagadas y no pagadas si gustas, o filtradas)
    const pagadas = state.clientes.filter(o => o.status && o.status.toLowerCase() === "pagado");
    
    const searchInput = document.getElementById('crm-search-input');
    const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : "";

    const productosMap = {}; 
    pagadas.forEach(order => {
        const fechaPago = order.paymentUpdatedAt || order.fechaPago || order.paymentDate || "";
        if (!order.items) return;
        order.items.forEach(item => {
            if (!item.productId) return;
            if (!productosMap[item.productId]) {
                productosMap[item.productId] = {
                    productId: item.productId,
                    nombre: item.name,
                    precioUnitario: item.price,
                    cantidadTotal: 0,
                    montoTotal: 0,
                    ultimaVenta: null
                };
            }
            const cantidad = Number(item.quantity) || 1;
            productosMap[item.productId].cantidadTotal += cantidad;
            productosMap[item.productId].montoTotal += (item.subtotal || ((item.price || 0) * cantidad));

            if (fechaPago && (!productosMap[item.productId].ultimaVenta || new Date(fechaPago) > new Date(productosMap[item.productId].ultimaVenta))) {
                productosMap[item.productId].ultimaVenta = fechaPago;
            }
        });
    });

    const productosIds = Object.keys(productosMap);
    let productosDb = {};
    if (productosIds.length) {
        const productsSnaps = await getDocs(collection(db, "product"));
        productsSnaps.forEach(doc => { productosDb[doc.id] = doc.data(); });
    }

    let productosArray = productosIds.map(pid => {
        const prod = productosMap[pid];
        const dbData = productosDb[pid];
        let imagen = "";
        if (prod.img) imagen = prod.img;
        else if (dbData && dbData.images?.length > 0) imagen = dbData.images[0];
        else if (dbData && dbData.imageUrls?.length > 0) imagen = dbData.imageUrls[0];
        return { ...prod, imagen };
    });

    if (searchTerm) {
        productosArray = productosArray.filter(p => (p.nombre || "").toLowerCase().includes(searchTerm));
    }

    renderProductosCards(productosArray, true);
};


// ----------------------------------------------------
// MODAL DETALLE DE PRODUCTOS (CONSOLIDA TODAS LAS ÓRDENES DEL CLIENTE)
// ----------------------------------------------------

window.closeProductosModal = function() {
    document.getElementById('productosModalBackdrop').classList.add('hidden');
    document.getElementById('productosModal').classList.add('hidden');
};

window.showProductosModal = function(orderOrClientId) {
    const state = window.crmState || { clientes: [] };
    
    // Buscamos la orden inicial de referencia
    const refOrder = state.clientes.find(c => c.id === orderOrClientId);
    if(!refOrder) {
        showToast("Error: No se encontró información del cliente.");
        return;
    }

    // 🚀 RECOPILAMOS TODAS LAS ÓRDENES DE ESTE CLIENTE (Por teléfono o nombre coincidente)
    const clienteKey = (refOrder.telefono || refOrder.nombre || "").trim().toLowerCase();
    const todasLasOrdenesDelCliente = state.clientes.filter(c => 
        (c.telefono || c.nombre || "").trim().toLowerCase() === clienteKey
    );

    const titleEl = document.getElementById('productosModalTitle');
    const subtitleEl = document.getElementById('productosModalSubtitle');
    const listEl = document.getElementById('productosModalList');

    titleEl.innerHTML = `<i class="fa-solid fa-box-open text-indigo-500"></i> Historial de Solicitudes — ${refOrder.nombre}`;
    subtitleEl.innerHTML = `Teléfono: <span class="font-bold">${refOrder.telefono}</span> | Total Órdenes Registradas: <span class="text-indigo-600 font-bold">${todasLasOrdenesDelCliente.length}</span>`;

    // Consolidamos todos los ítems de todas las órdenes (pagadas y no pagadas)
    let todosLosProductos = [];
    todasLasOrdenesDelCliente.forEach(orden => {
        if (Array.isArray(orden.items)) {
            orden.items.forEach(item => {
                todosLosProductos.push({
                    ...item,
                    orderId: orden.id,
                    orderStatus: orden.status,
                    orderDate: orden.ultVenta || orden.createdAt || 'Sin fecha'
                });
            });
        }
    });

    if (todosLosProductos.length === 0) {
        listEl.innerHTML = `
            <div class="text-center py-10 text-gray-400">
                <i class="fa-solid fa-basket-shopping text-3xl mb-2"></i>
                <p class="font-bold text-gray-700">Sin Productos</p>
                <p class="text-xs">Este cliente no posee productos en sus órdenes registradas.</p>
            </div>
        `;
    } else {
        listEl.innerHTML = todosLosProductos.map(item => {
            const precio = Number(item.price) || 0;
            const cantidad = Number(item.quantity) || 1;
            const subtotal = item.subtotal || (precio * cantidad);
            
            const badgeStatusColor = item.orderStatus.toLowerCase() === 'pagado' 
                ? 'bg-purple-50 text-purple-600 border-purple-200' 
                : 'bg-blue-50 text-blue-600 border-blue-200';

            return `
            <div class="flex flex-col sm:flex-row items-start sm:items-center gap-4 bg-gray-50 border border-gray-100 rounded-2xl p-4 transition hover:bg-gray-100/50">
                <div class="w-12 h-12 rounded-xl bg-white border border-gray-200 flex items-center justify-center overflow-hidden flex-shrink-0 shadow-sm">
                    ${item.img ? `<img src="${item.img}" class="w-full h-full object-cover">` : `<i class="fa-solid fa-box text-gray-300"></i>`}
                </div>
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                        <h4 class="font-bold text-gray-800 text-sm truncate">${item.name || 'Producto Desconocido'}</h4>
                        <span class="text-[9px] px-2 py-0.5 rounded-full border uppercase font-black ${badgeStatusColor}">${item.orderStatus}</span>
                    </div>
                    <p class="text-[11px] text-gray-500 mt-0.5">
                        <span class="font-semibold">Precio:</span> $${precio.toFixed(2)} 
                        <span class="mx-1 text-gray-300">|</span> 
                        <span class="font-semibold text-indigo-600">Cant: ${cantidad}</span>
                    </p>
                    <p class="text-[10px] text-gray-400 mt-1">
                        Orden ID: <span class="font-mono">${item.orderId}</span> • Fecha: ${item.orderDate}
                    </p>
                </div>
                <div class="text-right self-end sm:self-center">
                    <p class="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Subtotal</p>
                    <p class="font-black text-emerald-600 text-sm">$${subtotal.toFixed(2)}</p>
                </div>
            </div>
            `;
        }).join('');
    }

    document.getElementById('productosModalBackdrop').classList.remove('hidden');
    document.getElementById('productosModal').classList.remove('hidden');
};


// ----------------------------------------------------
// LEADS Y COMUNICACIONES
// ----------------------------------------------------
window.handleLead = async function handleLead(type, clienteId) {
    if (type === 'historial') return; 
    const clientes = window.crmState?.clientes || [];
    const cliente = clientes.find(c => c.id === clienteId);
    if (!cliente) return;
    const lead = {
        clienteId: cliente.id,
        nombre: cliente.nombre,
        telefono: cliente.telefono,
        email: cliente.email,
        vendedor: cliente.vendedor,
        canal: type,
        fecha: new Date().toISOString(),
        timestamp: Timestamp.now()
    };
    try {
        await addDoc(collection(db, "leads"), lead);
    } catch (e) {
        console.error("Error registrando el lead:", e);
    }
};

window.leadsModalState = { clienteId: null, clienteNombre: null };
window.showLeadsModal = async function showLeadsModal(clienteId, clienteNombre) {
    window.leadsModalState = { clienteId, clienteNombre };
    document.getElementById('leadsModalTitle').innerHTML = `<i class="fa-solid fa-clock-rotate-left text-blue-500"></i> Historial — ${clienteNombre}`;
    const listDiv = document.getElementById('leadsModalList');
    listDiv.innerHTML = `<div class="flex flex-col items-center justify-center py-8 text-gray-400 gap-2"><i class="fa-solid fa-circle-notch animate-spin text-2xl text-blue-500"></i><span class="text-xs font-medium">Cargando línea de tiempo...</span></div>`;
    document.getElementById('leadsModalBackdrop').classList.remove('hidden');
    document.getElementById('leadsModal').classList.remove('hidden');

    const q = query(collection(db, "leads"), where("clienteId", "==", clienteId));
    const snap = await getDocs(q);

    if (snap.empty) {
        listDiv.innerHTML = `<div class="text-center py-12 text-gray-400"><div class="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-3 border border-dashed"><i class="fa-solid fa-comment-slash text-xl text-gray-300"></i></div><p class="text-sm font-bold text-gray-700">Sin interacciones registradas</p></div>`;
        return;
    }

    listDiv.innerHTML = "";
    const timelineContainer = document.createElement('div');
    timelineContainer.className = "relative border-l-2 border-gray-100 pl-6 ml-3 space-y-6";

    let leadsArray = [];
    snap.forEach((docu) => leadsArray.push({ id: docu.id, data: docu.data() }));
    leadsArray.sort((a,b) => getValidDate(b.data.fecha) - getValidDate(a.data.fecha));

    leadsArray.forEach((item) => {
        const docuId = item.id;
        const l = item.data;
        let channelIcon = "fa-comment";
        let channelBg = "bg-blue-500 text-white";
        let channelLabel = l.canal ? l.canal.toUpperCase() : "CONTACTO";

        if (l.canal === "whatsapp") { channelIcon = "fa-brands fa-whatsapp"; channelBg = "bg-emerald-500 text-white"; } 
        else if (l.canal === "sms") { channelIcon = "fa-solid fa-message"; channelBg = "bg-amber-500 text-white"; } 
        else if (l.canal === "llamada") { channelIcon = "fa-solid fa-phone"; channelBg = "bg-blue-500 text-white"; }

        const dateStr = l.fecha ? new Date(l.fecha).toLocaleString('es-VE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Sin fecha';
        
        let comprobanteHTML = l.comprobanteUrl ? `
            <div class="mt-3 p-3 bg-gray-50 rounded-xl border border-gray-100 flex items-center gap-3 group">
                <a href="${l.comprobanteUrl}" target="_blank" class="flex-shrink-0 block"><img src="${l.comprobanteUrl}" alt="Comprobante" class="w-16 h-16 rounded-lg border border-emerald-100 object-cover hover:scale-105 transition cursor-pointer" style="background:#f8fafc;"></a>
                <div><div class="flex items-center gap-2"><p class="text-xs font-bold text-gray-700">Comprobante Adjunto</p><a href="${l.comprobanteUrl}" target="_blank" class="text-blue-500 text-xs hover:underline ml-1"><i class="fa-solid fa-eye"></i> Ver</a></div></div>
            </div>` : `<div class="mt-3"><label class="relative flex items-center justify-center gap-2 w-full p-3 bg-gray-50 hover:bg-gray-100/70 border border-dashed border-gray-200 rounded-xl cursor-pointer text-gray-500 hover:text-gray-700 transition-all text-xs font-semibold"><i class="fa-solid fa-cloud-arrow-up text-gray-400 text-sm"></i><span>Adjuntar Comprobante</span><input type="file" accept="image/*" class="hidden" onchange="uploadComprobanteLead('${docuId}', this)" /></label></div>`;

        timelineContainer.insertAdjacentHTML('beforeend', `
            <div class="relative group">
                <div class="absolute -left-[35px] top-1 w-6 h-6 rounded-full ${channelBg} border-4 border-white shadow-sm flex items-center justify-center text-[10px]"><i class="${channelIcon}"></i></div>
                <div class="bg-white p-4 rounded-2xl border border-gray-100 group-hover:border-gray-200 group-hover:shadow-sm transition-all duration-200">
                    <div class="flex flex-col sm:flex-row justify-between sm:items-center gap-1 mb-2">
                        <span class="px-2 py-0.5 rounded-md text-[10px] font-black tracking-wide inline-block w-fit ${l.canal === 'whatsapp' ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-600'}">${channelLabel}</span>
                        <span class="text-[11px] text-gray-400 font-medium flex items-center gap-1"><i class="fa-regular fa-clock text-[10px]"></i> ${dateStr}</span>
                    </div>
                    <p class="text-xs text-gray-600 leading-relaxed font-medium">El cliente fue contactado por el ejecutivo asignado <span class="font-bold text-gray-800">${l.vendedor || 'Sistema'}</span>.</p>
                    ${comprobanteHTML}
                </div>
            </div>
        `);
    });
    listDiv.appendChild(timelineContainer);
};

window.closeLeadsModal = function closeLeadsModal() {
    document.getElementById('leadsModalBackdrop').classList.add('hidden');
    document.getElementById('leadsModal').classList.add('hidden');
};

window.uploadComprobanteLead = async function uploadComprobanteLead(leadId, input) {
    if (!input.files.length) return;
    const auth = getAuth();
    if (!auth.currentUser) { showToast("Debes iniciar sesión para subir comprobantes."); return; }

    const label = input.closest("label");
    let loadingIndicator = label.querySelector(".crmh-spinner");
    if (!loadingIndicator) {
        loadingIndicator = document.createElement("span");
        loadingIndicator.className = "crmh-spinner ml-2";
        loadingIndicator.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin text-blue-500"></i> <span class="text-[10px] font-semibold text-blue-400 ml-1 align-middle">Subiendo...</span>`;
        label.appendChild(loadingIndicator);
    }
    input.disabled = true;

    try {
        const file = input.files[0];
        const ext = file.name.split('.').pop();
        const fileRef = storageRef(storage, `leads_comprobantes/${leadId}.${ext}`);
        await uploadBytes(fileRef, file);
        const url = await getDownloadURL(fileRef);
        await updateDoc(doc(db, "leads", leadId), { comprobanteUrl: url });

        loadingIndicator.innerHTML = `<i class="fa-solid fa-circle-check text-emerald-500"></i><span class="ml-2 text-emerald-700 font-bold text-xs">¡Subido!</span>`;
        showToast("Comprobante subido.");
        setTimeout(() => {
            if (loadingIndicator) loadingIndicator.remove();
            input.disabled = false;
            window.showLeadsModal(window.leadsModalState.clienteId, window.leadsModalState.clienteNombre);
        }, 700);
    } catch (err) {
        showToast("Error subiendo comprobante.");
        if (loadingIndicator) loadingIndicator.innerHTML = `<i class="fa-solid fa-circle-xmark text-red-500"></i> <span class="text-xs text-red-500 ml-1">Error</span>`;
        input.disabled = false;
        setTimeout(() => { if (loadingIndicator) loadingIndicator.remove(); }, 1400);
        console.error(err);
    }
};

window.currentPageComunicaciones = 1;
window.currentDataComunicacionesGroups = [];

window.cambiarPaginaComunicaciones = function(page) {
    window.currentPageComunicaciones = page;
    renderComunicacionesPaginadas(window.currentDataComunicacionesGroups, true);
};

window.renderComunicaciones = function renderComunicaciones() {
    const state = window.crmState || { clientes: [], leads: [] };
    const leads = state.leads || [];
    const searchInput = document.getElementById('crm-search-input');
    const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : "";

    const leadsFiltrados = leads.filter(lead => {
        const nombre = (lead.nombre || "").toLowerCase();
        const telefono = (lead.telefono || "").toLowerCase();
        const canal = (lead.canal || "").toLowerCase();
        const clienteId = (lead.clienteId || "").toLowerCase();
        const vendedor = (lead.vendedor || "").toLowerCase();
        return nombre.includes(searchTerm) || telefono.includes(searchTerm) || canal.includes(searchTerm) || vendedor.includes(searchTerm) || clienteId.includes(searchTerm);
    });

    const leadsAgrupados = leadsFiltrados.reduce((grupos, lead) => {
        if (!grupos[lead.clienteId]) {
            grupos[lead.clienteId] = { clienteId: lead.clienteId, nombreCliente: lead.nombre, telefonoCliente: lead.telefono, interacciones: [], ultimaInteraccion: 0 };
        }
        grupos[lead.clienteId].interacciones.push(lead);
        const leadDate = getValidDate(lead.fecha);
        if(leadDate > grupos[lead.clienteId].ultimaInteraccion) grupos[lead.clienteId].ultimaInteraccion = leadDate;
        return grupos;
    }, {});

    let gruposArray = Object.values(leadsAgrupados);
    gruposArray.sort((a,b) => b.ultimaInteraccion - a.ultimaInteraccion);
    gruposArray.forEach(g => g.interacciones.sort((a,b) => getValidDate(b.fecha) - getValidDate(a.fecha)));

    window.currentDataComunicacionesGroups = gruposArray;
    renderComunicacionesPaginadas(gruposArray, false);
};

function renderComunicacionesPaginadas(gruposArray, keepPage = false) {
    const container = document.getElementById('crm-comunicaciones-container');
    const paginationContainer = document.getElementById('crm-comunicaciones-pagination');
    const clientes = window.crmState?.clientes || [];
    if (!container) return;

    if (!keepPage) window.currentPageComunicaciones = 1;

    const ITEMS_PER_PAGE = 10;
    const totalPages = Math.ceil(gruposArray.length / ITEMS_PER_PAGE);
    if (window.currentPageComunicaciones > totalPages && totalPages > 0) window.currentPageComunicaciones = totalPages;

    if (gruposArray.length === 0) {
        container.innerHTML = `<div class="text-center py-12 text-gray-400"><div class="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-3 border border-dashed"><i class="fa-solid fa-magnifying-glass text-xl text-gray-300"></i></div><p class="text-sm font-bold text-gray-700">No se encontraron resultados</p></div>`;
        if (paginationContainer) paginationContainer.innerHTML = '';
        return;
    }

    const startIndex = (window.currentPageComunicaciones - 1) * ITEMS_PER_PAGE;
    const paginatedGroups = gruposArray.slice(startIndex, startIndex + ITEMS_PER_PAGE);

    let html = `<div class="space-y-4">`;
    paginatedGroups.forEach((grupo) => {
        const ordenAsociada = clientes.find(c => c.id === grupo.clienteId);
        const estatusActual = ordenAsociada ? ordenAsociada.status : "Finalizado/Inactivo";
        const montoOrden = ordenAsociada ? `$${ordenAsociada.montoTotal.toFixed(2)}` : "N/A";
        const badgeColor = estatusActual === 'Contactado' ? 'bg-green-50 text-green-600 border-green-200' : estatusActual === 'Pagado' ? 'bg-purple-50 text-purple-600 border-purple-200' : 'bg-blue-50 text-blue-600 border-blue-200';
        const collapseId = `collapse-cliente-${grupo.clienteId.replace(/\s+/g, '-')}`;

        html += `
            <div class="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden group/card transition-all duration-200">
                <div onclick="toggleClienteLeads('${collapseId}')" class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 p-4 sm:p-5 bg-gray-50/60 hover:bg-gray-50 cursor-pointer select-none transition-all duration-150">
                    <div class="flex items-center gap-4 w-full sm:w-auto">
                        <div id="icon-${collapseId}" class="w-8 h-8 rounded-xl bg-white border border-gray-100 shadow-sm flex items-center justify-center text-gray-400 transition-transform duration-200 transform rotate-0"><i class="fa-solid fa-chevron-down text-xs"></i></div>
                        <div>
                            <div class="flex items-center gap-2 flex-wrap">
                                <h3 class="text-sm font-black text-gray-800">${grupo.nombreCliente}</h3>
                                <span class="text-[9px] uppercase font-bold px-2 py-0.5 rounded-full border ${badgeColor}">${estatusActual}</span>
                            </div>
                            <p class="text-[11px] text-gray-500 mt-0.5"><i class="fa-solid fa-phone text-[10px] mr-1"></i> ${grupo.telefonoCliente} <span class="mx-1 text-gray-300">|</span> Orden: <span class="font-mono font-bold">${grupo.clienteId}</span></p>
                        </div>
                    </div>
                    <div class="flex items-center gap-3 self-end sm:self-auto">
                        <div class="text-right bg-white px-3 py-1 rounded-xl border border-gray-100 shadow-sm"><span class="text-[9px] uppercase block font-bold text-gray-400">Total Orden</span><span class="text-xs font-black text-gray-700">${montoOrden}</span></div>
                        <span class="bg-blue-50 text-blue-600 font-bold text-xs px-2.5 py-1 rounded-lg border border-blue-100">${grupo.interacciones.length} leads</span>
                    </div>
                </div>
                <div id="${collapseId}" class="hidden border-t border-gray-100 p-5 bg-white"><div class="relative border-l-2 border-blue-100 pl-6 ml-3 space-y-4">`;

        grupo.interacciones.forEach(lead => {
            let channelIcon = "fa-comment"; let channelBg = "bg-blue-500 text-white"; let channelLabel = lead.canal ? lead.canal.toUpperCase() : "INTERACCIÓN";
            if (lead.canal === "whatsapp") { channelIcon = "fa-brands fa-whatsapp"; channelBg = "bg-emerald-500 text-white"; } 
            else if (lead.canal === "sms") { channelIcon = "fa-solid fa-message"; channelBg = "bg-amber-500 text-white"; } 
            else if (lead.canal === "llamada") { channelIcon = "fa-solid fa-phone"; channelBg = "bg-blue-500 text-white"; }

            const dateStr = lead.fecha ? new Date(lead.fecha).toLocaleString('es-VE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Sin fecha';

            html += `
                <div class="relative group">
                    <div class="absolute -left-[33px] top-1 w-5 h-5 rounded-full ${channelBg} border-2 border-white shadow-sm flex items-center justify-center text-[9px]"><i class="${channelIcon}"></i></div>
                    <div class="bg-gray-50/50 p-3 rounded-xl border border-gray-100 hover:border-gray-200 transition-all duration-150">
                        <div class="flex justify-between items-center gap-2 mb-1"><span class="text-xs font-bold text-gray-700">Acción: <span class="text-blue-600 font-black">${channelLabel}</span></span><span class="text-[10px] text-gray-400"><i class="fa-regular fa-clock"></i> ${dateStr}</span></div>
                        <p class="text-xs text-gray-500">Atendido por: <span class="font-medium text-gray-700">${lead.vendedor || 'Sistema'}</span></p>
                        ${lead.comprobanteUrl ? `<div class="mt-2 p-1.5 bg-emerald-50/30 rounded-lg border border-emerald-100 inline-flex items-center gap-2"><img src="${lead.comprobanteUrl}" class="w-8 h-8 rounded object-cover border border-emerald-200 bg-white"><a href="${lead.comprobanteUrl}" target="_blank" class="text-blue-500 text-[10px] font-bold hover:underline">Ver Comprobante</a></div>` : ''}
                    </div>
                </div>`;
        });
        html += `</div></div></div>`;
    });
    html += `</div>`;
    container.innerHTML = html;

    renderPaginationControlsHTML(totalPages, window.currentPageComunicaciones, paginationContainer, 'cambiarPaginaComunicaciones');
}

window.toggleClienteLeads = function toggleClienteLeads(elementId) {
    const target = document.getElementById(elementId);
    const iconContainer = document.getElementById(`icon-${elementId}`);
    if (!target) return;
    if (target.classList.contains('hidden')) {
        target.classList.remove('hidden');
        if (iconContainer) { iconContainer.classList.add('rotate-180', 'border-blue-200', 'text-blue-500'); iconContainer.classList.remove('rotate-0', 'text-gray-400'); }
    } else {
        target.classList.add('hidden');
        if (iconContainer) { iconContainer.classList.add('rotate-0', 'text-gray-400'); iconContainer.classList.remove('rotate-180', 'border-blue-200', 'text-blue-500'); }
    }
};

window.renderPedidosGlobal = function renderPedidosGlobal() {
    window.applyCrmFilters();
};