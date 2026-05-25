// Orquestador Principal del Módulo CRM
import { listenCrmOrders } from './crm-firebase.js';
import { renderClientes, switchTab, showToast, renderProductosCards } from './crm-render.js';

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
                <div class="mt-3 p-3 bg-gray-50 rounded-xl border border-gray-100 flex items-center justify-between gap-3 group">
                    <div class="flex items-center gap-2.5 overflow-hidden">
                        <div class="w-9 h-9 rounded-lg bg-emerald-50 border border-emerald-100 text-emerald-600 flex items-center justify-center text-sm flex-shrink-0">
                            <i class="fa-solid fa-file-image"></i>
                        </div>
                        <div class="truncate">
                            <p class="text-xs font-bold text-gray-700 truncate">Comprobante Adjunto</p>
                            <p class="text-[10px] text-gray-400">Imagen de respaldo guardada</p>
                        </div>
                    </div>
                    <a href="${l.comprobanteUrl}" target="_blank" class="px-3 py-1.5 bg-white hover:bg-blue-600 hover:text-white text-gray-600 border border-gray-200 rounded-lg text-[11px] font-bold transition-all shadow-sm flex items-center gap-1">
                        <i class="fa-solid fa-eye"></i> Ver
                    </a>
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
    const file = input.files[0];
    const ext = file.name.split('.').pop();
    const storage_path = `leads_comprobantes/${leadId}.${ext}`;
    const fileRef = storageRef(storage, storage_path);
    await uploadBytes(fileRef, file);
    const url = await getDownloadURL(fileRef);
    const leadRef = doc(db, "leads", leadId);
    await updateDoc(leadRef, { comprobanteUrl: url });
    showToast("Comprobante subido.");
    setTimeout(() => {
        window.showLeadsModal(window.leadsModalState.clienteId, window.leadsModalState.clienteNombre);
    }, 700);
};
