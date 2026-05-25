// Orquestador Principal del Módulo CRM
import { listenCrmOrders } from './crm-firebase.js';
import { renderClientes, switchTab, showToast, renderProductosCards } from './crm-render.js';
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
    getFirestore,
    collection,
    query,
    where,
    getDocs,
    doc,
    updateDoc,
    addDoc,
    Timestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";
import { firebaseConfig } from '../firebase-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";

// Inicializa Firebase (usa solo una instancia global)
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);


window.switchTab = switchTab;

document.addEventListener('DOMContentLoaded', () => {
    showToast("Conectando al CRM en tiempo real...");

    listenCrmOrders((clientesFiltrados) => {
        window.crmState = { clientes: clientesFiltrados };

        // El render sigue mostrando todos (Contactado, Postergado y Pagado)
        renderClientes(clientesFiltrados);

        // 📊 NUEVOS KPIs: Filtrar SOLO las órdenes finalizadas ("Pagado")
        const ordenesPagadas = clientesFiltrados.filter(c => c.status.toLowerCase() === 'pagado');

        const totalMonto = ordenesPagadas.reduce((acc, c) => acc + c.montoTotal, 0);
        const kpiQty = document.getElementById('crm-kpi-qty');
        const kpiAmount = document.getElementById('crm-kpi-amount');

        if (kpiQty) kpiQty.innerText = ordenesPagadas.length; // Cantidad de ventas realizadas
        if (kpiAmount) kpiAmount.innerText = `$${totalMonto.toFixed(2)}`; // Monto total de ventas
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
                map[pos.date].push({
                    ...order,
                    postponeHistory: order.postponeHistory,
                    postponeData: pos
                });
            });
        }
    });
    console.log("getAgendaMap:", map, state.clientes); // <-- Agrega este log
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
        html = `
        <div class="text-center py-12 text-gray-400">
            <div class="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-3 border border-dashed border-gray-200">
                <i class="fa-solid fa-calendar-xmark text-xl text-gray-300"></i>
            </div>
            <p class="text-sm font-bold text-gray-700">No hay pendientes</p>
            <p class="text-xs text-gray-400 max-w-xs mx-auto mt-1">No se encontraron órdenes postergadas para este día comercial.</p>
        </div>`;
    } else {
        orders.forEach(order => {
            const allPostpones = (order.postponeHistory || []).filter(pos => pos.date === date);
            html += `
            <div class="border border-gray-100 rounded-2xl p-5 bg-gradient-to-b from-white to-gray-50/50 shadow-sm mb-4 last:mb-0 hover:border-gray-200 transition-all">
                <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 pb-4 mb-4 border-b border-gray-100">
                    <div>
                        <span class="text-[10px] bg-gray-100 text-gray-600 font-bold px-2 py-0.5 rounded-md font-mono">ID: ${order.id}</span>
                        <h4 class="font-bold text-gray-800 text-base mt-1 flex items-center gap-1.5">
                            <i class="fa-solid fa-user text-xs text-gray-400"></i> ${order.nombre}
                        </h4>
                    </div>
                    <div class="flex flex-col sm:items-end gap-1">
                        <span class="text-[10px] uppercase font-black tracking-wider px-2.5 py-1 rounded-full border bg-blue-50 text-blue-600 border-blue-200 shadow-sm">
                            ${order.status}
                        </span>
                        <span class="text-xs text-gray-400 font-medium flex items-center gap-1">
                            <i class="fa-solid fa-phone text-[10px]"></i> ${order.telefono}
                        </span>
                    </div>
                </div>

                <div class="mb-4 bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                    <p class="text-[10px] font-extrabold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                        <i class="fa-regular fa-clock text-blue-500"></i> Gestión Programada para Hoy
                    </p>
                    <ul class="space-y-3">
                        ${allPostpones.map(h => `
                            <li class="text-xs bg-gray-50/70 p-3 rounded-xl border border-gray-100">
                                <div class="flex justify-between items-center mb-1.5">
                                    <span class="font-black text-gray-700 bg-white px-2 py-0.5 rounded border border-gray-200 shadow-sm flex items-center gap-1">
                                        <i class="fa-regular fa-clock text-[11px] text-gray-400"></i> ${h.time || 'Sin hora'}
                                    </span>
                                    ${h.timestamp ? `<span class="text-[10px] text-gray-400 font-medium" title="${h.timestamp}">Reg: ${(new Date(h.timestamp).toLocaleString('es-VE'))}</span>` : ""}
                                </div>
                                <p class="text-gray-600 italic font-medium">
                                    "${h.comment ? h.comment : '<span class="text-gray-300 not-italic">Sin comentario registrado</span>'}"
                                </p>
                            </li>
                        `).join('')}
                    </ul>
                </div>

                <div>
                    <details class="group border border-gray-100 rounded-xl bg-white overflow-hidden transition-all">
                        <summary class="list-none flex justify-between items-center p-3 text-xs font-bold text-gray-500 hover:text-gray-700 cursor-pointer bg-gray-50/30 select-none">
                            <span class="flex items-center gap-1.5"><i class="fa-solid fa-timeline text-gray-400"></i> Ver historial completo de postergaciones</span>
                            <i class="fa-solid fa-chevron-down transition-transform group-open:rotate-180 text-[10px] text-gray-400"></i>
                        </summary>
                        <div class="p-3 border-t border-gray-50 bg-gray-50/10 max-h-40 overflow-y-auto custom-scrollbar">
                            <ul class="relative border-l border-gray-200 pl-4 ml-2 space-y-3 my-2">
                                ${(order.postponeHistory || []).map(p => `
                                    <li class="relative text-[11px] text-gray-600">
                                        <span class="absolute -left-[21px] top-1 w-2 h-2 rounded-full bg-amber-400 border-2 border-white ring-1 ring-gray-200"></span>
                                        <div class="flex flex-wrap items-center gap-1.5 mb-0.5">
                                            <span class="font-bold text-gray-700">${p.date}</span>
                                            <span class="text-gray-400 font-medium">a las ${p.time || '--:--'}</span>
                                            ${p.timestamp ? `<span class="text-[9px] text-gray-400 italic" title="Registrado: ${p.timestamp}">(${(new Date(p.timestamp).toLocaleString('es-VE', { hour: '2-digit', minute: '2-digit' })).toLowerCase()})</span>` : ''}
                                        </div>
                                        ${p.comment ? `<p class="text-gray-500 font-medium bg-white border border-gray-100 rounded-lg px-2.5 py-1 mt-1 inline-block shadow-sm">"${p.comment}"</p>` : ''}
                                    </li>
                                `).join('')}
                            </ul>
                        </div>
                    </details>
                </div>
            </div>
            `;
        });
    }
    modalBody.innerHTML = html;
    document.getElementById('agendaModalBackdrop').classList.remove('hidden');
    document.getElementById('agendaModal').classList.remove('hidden');
};
// Reemplaza COMPLETO tu renderAgenda:
window.renderAgenda = function renderAgenda() {
    //console.log("Ejecutando renderAgenda");

    const agendaMap = window.getAgendaMap();
    //console.log("AGENDA MAP:", agendaMap);

    const container = document.getElementById('crm-agenda-container');
    if (!container) { console.log("No existe el container!"); return; }
    container.innerHTML = '';
    const fcDiv = document.createElement('div');
    fcDiv.id = 'fullcalendar';
    container.appendChild(fcDiv);

    const events = [];
    Object.keys(agendaMap).forEach(date => {
        const orders = agendaMap[date];
        events.push({
            title: orders.length === 1 ? '1 orden postergada' : `${orders.length} órdenes postergadas`,
            start: date,
            allDay: true,
            extendedProps: {
                orders
            }
        });
    });

    console.log("Eventos para calendario:", events);

    // Chequea que se cargó FullCalendar
    if (typeof FullCalendar === "undefined") {
        console.error("❌ FullCalendar no está definido. ¿El script está cargando después del JS CRM?");
        alert("No se cargó FullCalendar. Revisa su <script> en el HTML.");
        return;
    }

    // Instala el calendario
    const calendar = new FullCalendar.Calendar(fcDiv, {
        initialView: 'dayGridMonth',
        locale: 'es',
        height: 500,
        events,
        fixedWeekCount: false,
        selectable: false,
        editable: false,
        dayMaxEventRows: true,
        eventDisplay: 'block',
        headerToolbar: {
            left: 'prev,next today',
            center: 'title',
            right: ''
        },
        dayCellDidMount(info) {
            info.el.style.background = '#f8fafc';
        },
        eventDidMount(info) {
            info.el.style.backgroundColor = '#e0e7ff';
            info.el.style.borderColor = '#6366f1';
            info.el.style.color = '#1e293b';
            info.el.style.fontWeight = 'bold';
            info.el.style.cursor = 'pointer';
        },
        eventClick(info) {
            const orders = info.event.extendedProps.orders;
            if (orders && orders.length) {
                window.showAgendaFullCalendarDay(info.event.startStr, orders);
            }
        },
    });

    calendar.render();
    console.log("FullCalendar renderizado");
};

window.closeAgendaModal = function closeAgendaModal() {
    document.getElementById('agendaModalBackdrop').classList.add('hidden');
    document.getElementById('agendaModal').classList.add('hidden');
}
//////////////////////////////////

// --- FUNCIÓN: Al activar el tab productos ---
window.loadProductosVendidos = async function loadProductosVendidos() {
    const state = window.crmState || { clientes: [] };
    const pagadas = state.clientes.filter(o => o.status && o.status.toLowerCase() === "pagado");

    const productosMap = {}; // productId -> info agregada

    pagadas.forEach(order => {
        // CUIDADO: La fecha REAL de pago viene de paymentUpdatedAt
        // Debe estar disponible en el documento de la orden (ajusta si viene con otro nombre/caso)
        const fechaPago = order.paymentUpdatedAt || order.fechaPago || order.paymentDate || "";
        const items = order.items;
        if (!items) return;
        items.forEach(item => {
            if (!item.productId) return;
            if (!productosMap[item.productId]) {
                productosMap[item.productId] = {
                    productId: item.productId,
                    nombre: item.name,
                    precioUnitario: item.price,
                    cantidadTotal: 0,
                    montoTotal: 0,
                    ultimaVenta: null // fecha más reciente de paymentUpdatedAt
                };
            }
            const cantidad = Number(item.quantity) || 1;
            productosMap[item.productId].cantidadTotal += cantidad;
            productosMap[item.productId].montoTotal += (item.subtotal || ((item.price || 0) * cantidad));

            // Fecha de pago más reciente
            if (
                fechaPago &&
                (
                    !productosMap[item.productId].ultimaVenta ||
                    new Date(fechaPago) > new Date(productosMap[item.productId].ultimaVenta)
                )
            ) {
                productosMap[item.productId].ultimaVenta = fechaPago;
            }
        });
    });

    const productosIds = Object.keys(productosMap);
    let productosDb = {};
    if (productosIds.length) {
        const productsSnaps = await getDocs(collection(db, "product"));
        productsSnaps.forEach(doc => {
            productosDb[doc.id] = doc.data();
        });
    }

    const productosArray = productosIds.map(pid => {
        const prod = productosMap[pid];
        const dbData = productosDb[pid];
        let imagen = "";
        if (prod.img) {
            imagen = prod.img;
        } else if (dbData) {
            if (Array.isArray(dbData.images) && dbData.images.length > 0) {
                imagen = dbData.images[0];
            } else if (Array.isArray(dbData.imageUrls) && dbData.imageUrls.length > 0) {
                imagen = dbData.imageUrls[0];
            }
        }
        return {
            ...prod,
            imagen,
        };
    });

    // Ordenar del más vendido al menos vendido
    productosArray.sort((a, b) => b.cantidadTotal - a.cantidadTotal);

    renderProductosCards(productosArray);
}
// Filtro avanzado
window.applyCrmFilters = function applyCrmFilters() {
    const state = window.crmState || { clientes: [] };

    const status = document.getElementById('crmFilterStatus').value;
    const date = document.getElementById('crmFilterDate').value;
    const channel = document.getElementById('crmFilterChannel').value;

    let filtrados = [...state.clientes];
    if (status !== "all") {
        filtrados = filtrados.filter(c => c.status.toLowerCase() === status.toLowerCase());
    }
    if (date) {
        filtrados = filtrados.filter(c => c.ultVenta && c.ultVenta.startsWith(date));
    }
    // Si implementas campo canal, añade aquí tu filtro por canal.

    renderClientes(filtrados);

    // KPIs
    const totalMonto = filtrados.reduce((acc, c) => acc + c.montoTotal, 0);
    const kpiQty = document.getElementById('crm-kpi-qty');
    const kpiAmount = document.getElementById('crm-kpi-amount');
    if (kpiQty) kpiQty.innerText = filtrados.length;
    if (kpiAmount) kpiAmount.innerText = `$${totalMonto.toFixed(2)}`;
};

window.clearCrmFilters = function clearCrmFilters() {
    document.getElementById('crmFilterDate').value = '';
    document.getElementById('crmFilterStatus').value = 'all';
    document.getElementById('crmFilterChannel').value = 'all';
    window.applyCrmFilters();
};

// REGISTRA EL LEAD al hacer contacto (NO historial)
window.handleLead = async function handleLead(type, clienteId) {
    if (type === 'historial') return; // solo registra whatsapp, llamada y sms

    const clientes = window.crmState?.clientes || [];
    const cliente = clientes.find(c => c.id === clienteId);
    if (!cliente) return;

    const lead = {
        clienteId: cliente.id,
        nombre: cliente.nombre,
        telefono: cliente.telefono,
        email: cliente.email,
        vendedor: cliente.vendedor,
        canal: type, // 'whatsapp', 'llamada', 'sms'
        fecha: new Date().toISOString(),
        timestamp: Timestamp.now()
    };

    try {
        await addDoc(collection(db, "leads"), lead);
        // showToast(`Lead registrado por ${type}`);
    } catch (e) {
        console.error("Error registrando el lead:", e);
        // showToast("Error registrando el lead");
    }
};

// MODAL HISTORIAL DE LEADS

window.leadsModalState = { clienteId: null, clienteNombre: null };

window.showLeadsModal = async function showLeadsModal(clienteId, clienteNombre) {
    window.leadsModalState = { clienteId, clienteNombre };
    document.getElementById('leadsModalTitle').innerHTML = `
        <i class="fa-solid fa-clock-rotate-left text-blue-500"></i> Historial — ${clienteNombre}
    `;

    const listDiv = document.getElementById('leadsModalList');
    listDiv.innerHTML = `
        <div class="flex flex-col items-center justify-center py-8 text-gray-400 gap-2">
            <i class="fa-solid fa-circle-notch animate-spin text-2xl text-blue-500"></i>
            <span class="text-xs font-medium">Cargando línea de tiempo...</span>
        </div>
    `;

    document.getElementById('leadsModalBackdrop').classList.remove('hidden');
    document.getElementById('leadsModal').classList.remove('hidden');

    // Consulta por clienteId (¡aquí se arregla!)
    const q = query(collection(db, "leads"), where("clienteId", "==", clienteId));
    const snap = await getDocs(q);

    if (snap.empty) {
        listDiv.innerHTML = `
            <div class="text-center py-12 text-gray-400">
                <div class="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-3 border border-dashed">
                    <i class="fa-solid fa-comment-slash text-xl text-gray-300"></i>
                </div>
                <p class="text-sm font-bold text-gray-700">Sin interacciones registradas</p>
                <p class="text-xs text-gray-400 max-w-xs mx-auto mt-1">
                    Aún no se han iniciado comunicaciones digitales o llamadas con este cliente desde el CRM.
                </p>
            </div>
        `;
        return;
    }

    listDiv.innerHTML = "";

    // Contenedor principal de la línea de tiempo vertical
    const timelineContainer = document.createElement('div');
    timelineContainer.className = "relative border-l-2 border-gray-100 pl-6 ml-3 space-y-6";

    snap.forEach((docu) => {
        const l = docu.data();

        // Configuración visual del canal de contacto
        let channelIcon = "fa-comment";
        let channelBg = "bg-blue-500 text-white";
        let channelLabel = l.canal ? l.canal.toUpperCase() : "CONTACTO";

        if (l.canal === "whatsapp") {
            channelIcon = "fa-brands fa-whatsapp";
            channelBg = "bg-emerald-500 text-white";
        } else if (l.canal === "sms") {
            channelIcon = "fa-solid fa-message";
            channelBg = "bg-amber-500 text-white";
        } else if (l.canal === "llamada") {
            channelIcon = "fa-solid fa-phone";
            channelBg = "bg-blue-500 text-white";
        }

        const dateStr = l.fecha ? new Date(l.fecha).toLocaleString('es-VE', {
            day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
        }) : 'Sin fecha';

        let comprobanteHTML = "";
        if (l.comprobanteUrl) {
            comprobanteHTML = `
                <div class="mt-3 p-3 bg-gray-50 rounded-xl border border-gray-100 flex items-center gap-3 group">
                    <a href="${l.comprobanteUrl}" target="_blank" class="flex-shrink-0 block">
                        <img 
                            src="${l.comprobanteUrl}" 
                            alt="Comprobante" 
                            class="w-16 h-16 rounded-lg border border-emerald-100 object-cover hover:scale-105 transition cursor-pointer"
                            style="background:#f8fafc;"
                        >
                    </a>
                    <div>
                        <div class="flex items-center gap-2">
                            <p class="text-xs font-bold text-gray-700">Comprobante Adjunto</p>
                            <a href="${l.comprobanteUrl}" target="_blank" 
                            class="text-blue-500 text-xs hover:underline ml-1"><i class="fa-solid fa-eye"></i> Ver</a>
                        </div>
                        <p class="text-[10px] text-gray-400">Imagen de respaldo guardada</p>
                    </div>
                </div>
            `;
        } else {
            comprobanteHTML = `
                <div class="mt-3">
                    <label class="relative flex items-center justify-center gap-2 w-full p-3 bg-gray-50 hover:bg-gray-100/70 border border-dashed border-gray-200 rounded-xl cursor-pointer text-gray-500 hover:text-gray-700 transition-all text-xs font-semibold">
                        <i class="fa-solid fa-cloud-arrow-up text-gray-400 text-sm"></i>
                        <span>Adjuntar Comprobante</span>
                        <input type="file" accept="image/*" class="hidden" onchange="uploadComprobanteLead('${docu.id}', this)" />
                    </label>
                </div>
            `;
        }

        const itemHTML = `
            <div class="relative group">
                <div class="absolute -left-[35px] top-1 w-6 h-6 rounded-full ${channelBg} border-4 border-white shadow-sm flex items-center justify-center text-[10px]">
                    <i class="${channelIcon}"></i>
                </div>
                
                <div class="bg-white p-4 rounded-2xl border border-gray-100 group-hover:border-gray-200 group-hover:shadow-sm transition-all duration-200">
                    <div class="flex flex-col sm:flex-row justify-between sm:items-center gap-1 mb-2">
                        <span class="px-2 py-0.5 rounded-md text-[10px] font-black tracking-wide inline-block w-fit ${l.canal === 'whatsapp' ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-600'}">
                            ${channelLabel}
                        </span>
                        <span class="text-[11px] text-gray-400 font-medium flex items-center gap-1">
                            <i class="fa-regular fa-clock text-[10px]"></i> ${dateStr}
                        </span>
                    </div>
                    
                    <p class="text-xs text-gray-600 leading-relaxed font-medium">
                        El cliente fue contactado por el ejecutivo asignado <span class="font-bold text-gray-800">${l.vendedor || 'Sistema'}</span>.
                    </p>
                    
                    ${comprobanteHTML}
                </div>
            </div>
        `;

        timelineContainer.insertAdjacentHTML('beforeend', itemHTML);
    });

    listDiv.appendChild(timelineContainer);
};

window.closeLeadsModal = function closeLeadsModal() {
    document.getElementById('leadsModalBackdrop').classList.add('hidden');
    document.getElementById('leadsModal').classList.add('hidden');
};

// SUBIR COMPROBANTE por lead a Firebase Storage y registrar URL en Firestore
window.uploadComprobanteLead = async function uploadComprobanteLead(leadId, input) {
    if (!input.files.length) return;

    const auth = getAuth();
    if (!auth.currentUser) {
        showToast("Debes iniciar sesión para subir comprobantes.");
        return;
    }

    // --- Indicador de carga UI ---
    const label = input.closest("label");
    let loadingIndicator = label.querySelector(".crmh-spinner");
    if (!loadingIndicator) {
        loadingIndicator = document.createElement("span");
        loadingIndicator.className = "crmh-spinner ml-2";
        loadingIndicator.innerHTML = `
            <i class="fa-solid fa-circle-notch fa-spin text-blue-500"></i> 
            <span class="text-[10px] font-semibold text-blue-400 ml-1 align-middle">Subiendo...</span>`;
        label.appendChild(loadingIndicator);
    }
    input.disabled = true; // bloquea input

    try {
        const file = input.files[0];
        const ext = file.name.split('.').pop();
        const storage_path = `leads_comprobantes/${leadId}.${ext}`;
        const fileRef = storageRef(storage, storage_path);
        await uploadBytes(fileRef, file);
        const url = await getDownloadURL(fileRef);
        const leadRef = doc(db, "leads", leadId);
        await updateDoc(leadRef, { comprobanteUrl: url });

        // --- Mostrar éxito visual ---
        loadingIndicator.innerHTML = `<i class="fa-solid fa-circle-check text-emerald-500"></i><span class="ml-2 text-emerald-700 font-bold text-xs">¡Subido!</span>`;
        showToast("Comprobante subido.");

        setTimeout(() => {
            // Quita spinner y desbloquea input
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