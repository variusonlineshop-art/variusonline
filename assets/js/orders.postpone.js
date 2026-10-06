import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import {
    getFirestore,
    collection,
    getDocs,
    getDoc,
    doc,
    query,
    where,
    onSnapshot,
    updateDoc
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

import { getAuth } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { openPaymentModal } from './payment-modal.js';

// IMPORTACIÓN DE FUNCIONES DESDE order-actions.js
import {
    handleSuspendOrder,
    handleReactivateOrder,
    openEditOrder,
    openPostponeOrder,
    handleMarkAsSent,
    handleSaveCurrentLocation,
    handleAcceptDelivery,
    openContactModal
} from './order-actions.js';

// Variables globales para la paginación e historial
let currentPage = 1;
const itemsPerPage = 20;

let currentHistoryPage = 1;
const ITEMS_PER_PAGE = 10;
let historyOrdersCache = [];
let currentRoleCache = '';

// Handler global para cobro desde modal
window.openPaymentModalFromOrderId = function (orderId) {
    const order = window.ordersCache[orderId];
    if (order) {
        openPaymentModal({ ...order, id: orderId });
    }
};

// Inicializa Firebase y Firestore
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Exportar acciones al scope global (window)
window.handleSuspendOrder = handleSuspendOrder;
window.handleReactivateOrder = handleReactivateOrder;
window.openEditOrder = openEditOrder;
window.openPostponeOrder = openPostponeOrder;
window.handleMarkAsSent = handleMarkAsSent;
window.handleSaveCurrentLocation = handleSaveCurrentLocation;
window.handleAcceptDelivery = handleAcceptDelivery;
window.openContactModal = openContactModal;

window.ordersCache = {};
let productImgCache = {};

/**
 * Busca la imagen en la colección 'product'
 */
async function fetchProductImg(productId) {
    const placeholder = 'https://via.placeholder.com/150';
    if (!productId) return placeholder;

    const cleanId = String(productId).trim();
    if (productImgCache[cleanId]) return productImgCache[cleanId];

    try {
        const productDoc = await getDoc(doc(db, "product", cleanId));
        if (productDoc.exists()) {
            const data = productDoc.data();
            if (data.imageUrls && Array.isArray(data.imageUrls) && data.imageUrls.length > 0) {
                const url = data.imageUrls[0];
                productImgCache[cleanId] = url;
                return url;
            }
        }
        productImgCache[cleanId] = placeholder;
    } catch (e) {
        console.error(`Error obteniendo imagen para producto ${cleanId}:`, e);
    }
    return placeholder;
}

// Variable global para almacenar las tasas del día
let currentRates = { usd: null, eur: null };

const API_SOURCES = [
    {
        name: 'DolarApi (Principal)',
        async fetcher() {
            const [resUsd, resEur] = await Promise.all([
                fetch('https://ve.dolarapi.com/v1/dolares'),
                fetch('https://ve.dolarapi.com/v1/euros')
            ]);
            if (!resUsd.ok || !resEur.ok) throw new Error("Error en respuesta de red");

            const dataUsd = await resUsd.json();
            const dataEur = await resEur.json();

            const findOficial = (arr) => arr.find(i =>
                (i.fuente && i.fuente.toLowerCase() === 'oficial') ||
                (i.casa && i.casa.toLowerCase() === 'bcv') ||
                (i.nombre && i.nombre.toLowerCase() === 'bcv')
            );

            const bcvUsd = findOficial(dataUsd);
            const bcvEur = findOficial(dataEur);

            if (!bcvUsd || !bcvEur) throw new Error("Tasas BCV no encontradas en el JSON");

            return {
                usd: bcvUsd.promedio,
                eur: bcvEur.promedio
            };
        }
    },
    {
        name: 'PyDolar (Respaldo)',
        url: 'https://pydolarve.org/api/v1/dollar?page=bcv',
        async fetcher() {
            const res = await fetch(this.url);
            if (!res.ok) throw new Error("Error en PyDolar");
            const data = await res.json();
            return {
                usd: data.monitors?.usd?.price,
                eur: data.monitors?.eur?.price
            };
        }
    }
];

// Cargar tasas al iniciar
async function loadExchangeRates() {
    for (const source of API_SOURCES) {
        try {
            const rates = await source.fetcher();
            if (rates.usd && rates.eur) {
                currentRates = rates;
                console.log(`Tasas cargadas exitosamente desde ${source.name}`);
                break;
            }
        } catch (e) {
            console.warn(`Omitiendo fuente ${source.name} por error:`, e.message);
        }
    }
}

/**
 * Llena un <select> con opciones únicas
 */
function fillFilterOptions(selectId, dataPairs) {
    const select = document.getElementById(selectId);
    if (!select) return;

    let labelTodos = "Todos";
    if (selectId === "filterSeller") labelTodos = "Todos los Vendedores";
    if (selectId === "filterMotorized") labelTodos = "Todos los Motorizados";
    if (selectId === "filterOrderStatus") labelTodos = "Todos los Estatus";

    const unique = {};
    dataPairs.forEach(pair => {
        if (Array.isArray(pair)) {
            const [id, name] = pair;
            if (id && id !== "undefined" && !unique[id]) unique[id] = name || id;
        }
    });

    let html = `<option value="all">${labelTodos}</option>`;
    for (const [id, name] of Object.entries(unique)) {
        html += `<option value="${id}">${name || id}</option>`;
    }
    select.innerHTML = html;
}

window.currentOrdersUnsubscribe = null;

function fetchAndRenderOrders(filters = {}) {
    const gridActive = document.getElementById('grid-active-postponed');
    const gridHistory = document.getElementById('grid-history-postponed');
    const countActive = document.getElementById('count-active-postponed');
    const countHistory = document.getElementById('count-history-postponed');

    if (!gridActive || !gridHistory) return;

    if (window.currentOrdersUnsubscribe) {
        window.currentOrdersUnsubscribe();
        window.currentOrdersUnsubscribe = null;
    }

    const auth = getAuth();
    let user = auth.currentUser;

    function continuarConUsuario(user) {
        if (!user) {
            gridActive.innerHTML = '<p class="col-span-full text-center py-10 text-red-500">Debes iniciar sesión para ver órdenes.</p>';
            return;
        }

        getDoc(doc(db, "users", user.uid)).then(userDocSnap => {
            let myData = userDocSnap.data() || {};
            let myRole = (myData.role || '').toLowerCase();
            currentRoleCache = myRole;

            let ordersQuery;
            if (myRole === "administrador" || myRole === "gerente") {
                ordersQuery = collection(db, "orders");
            } else if (myRole === "motorizado") {
                ordersQuery = query(collection(db, "orders"), where("assignedMotorizedId", "==", user.uid));
            } else if (myRole === "vendedor") {
                ordersQuery = query(collection(db, "orders"), where("assignedSeller", "==", user.uid));
            } else {
                gridActive.innerHTML = '<p class="col-span-full text-center py-10 text-gray-500">No tienes permisos para ver órdenes.</p>';
                return;
            }

            window.currentOrdersUnsubscribe = onSnapshot(ordersQuery, (querySnapshot) => {
                window.ordersCache = {};
                let ordersArr = [];

                querySnapshot.forEach((documento) => {
                    const order = documento.data();
                    const orderId = documento.id;
                    order._id = orderId;
                    window.ordersCache[orderId] = order;

                    const isCurrentlyPostponed = order.status === 'Postergado';
                    const hasPostponeHistory = Array.isArray(order.postponeHistory) && order.postponeHistory.length > 0;

                    if (isCurrentlyPostponed || hasPostponeHistory) {
                        ordersArr.push(order);
                    }
                });

                // Repoblar selects de filtros
                const currentSeller = document.getElementById("filterSeller")?.value || "all";
                const currentMotorized = document.getElementById("filterMotorized")?.value || "all";
                const currentStatus = document.getElementById("filterOrderStatus")?.value || "all";

                if (currentSeller === "all") fillFilterOptions("filterSeller", ordersArr.map(o => [o.assignedSeller, o.assignedSellerName]));
                if (currentMotorized === "all") fillFilterOptions("filterMotorized", ordersArr.map(o => [o.assignedMotorizedId, o.assignedMotorizedName]));
                if (currentStatus === "all") fillFilterOptions("filterOrderStatus", ordersArr.map(o => [o.status || "Pendiente", o.status || "Pendiente"]));

                // Filtros de búsqueda
                if (filters.seller && filters.seller !== "all") ordersArr = ordersArr.filter(o => o.assignedSeller === filters.seller);
                if (filters.motorized && filters.motorized !== "all") ordersArr = ordersArr.filter(o => o.assignedMotorizedId === filters.motorized);
                if (filters.status && filters.status !== "all") ordersArr = ordersArr.filter(o => (o.status || 'Pendiente') === filters.status);
                if (filters.search) {
                    const searchTerm = filters.search.toLowerCase();
                    ordersArr = ordersArr.filter(o => {
                        const customer = o.customerData?.Customname?.toLowerCase() || '';
                        const id = o.cartToken?.toLowerCase() || '';
                        const phone = o.customerData?.phone?.toLowerCase() || o.phone?.toLowerCase() || '';
                        return customer.includes(searchTerm) || id.includes(searchTerm) || phone.includes(searchTerm);
                    });
                }

                // Orden cronológico
                const sortOrder = filters.sort || 'newest';
                ordersArr.sort((a, b) => {
                    const timeA = a.timestamp?.toDate ? a.timestamp.toDate().getTime() : new Date(a.orderDate).getTime();
                    const timeB = b.timestamp?.toDate ? b.timestamp.toDate().getTime() : new Date(b.orderDate).getTime();
                    return sortOrder === 'oldest' ? timeA - timeB : timeB - timeA;
                });

                // Separar en Activas e Historial
                const activePostponedOrders = ordersArr.filter(o => o.status === 'Postergado');
                historyOrdersCache = ordersArr.filter(o => o.status !== 'Postergado' && Array.isArray(o.postponeHistory) && o.postponeHistory.length > 0);

                // Contadores
                if (countActive) countActive.innerText = activePostponedOrders.length;
                if (countHistory) countHistory.innerText = historyOrdersCache.length;

                // Renderizar Sección 1: Activas
                if (activePostponedOrders.length === 0) {
                    gridActive.innerHTML = '<p class="col-span-full text-center py-8 text-gray-400 bg-gray-50/50 rounded-2xl border border-dashed border-gray-200">No hay órdenes postergadas actualmente.</p>';
                } else {
                    gridActive.innerHTML = activePostponedOrders.map(order => generateOrderCardHTML(order, myRole)).join('');
                }

                // Renderizar Sección 2: Historial
                currentHistoryPage = 1;
                renderHistoryPage();

            }, (error) => {
                console.error("Error en tiempo real:", error);
                gridActive.innerHTML = '<p class="col-span-full text-center py-10 text-red-500">Error al conectar en tiempo real con Firestore.</p>';
            });
        });
    }

    if (user) continuarConUsuario(user);
    else {
        const unsubscribe = auth.onAuthStateChanged(u => {
            unsubscribe();
            continuarConUsuario(u);
        });
    }
}

// Renderizar la página del historial
function renderHistoryPage() {
    const gridHistory = document.getElementById('grid-history-postponed');
    const paginationContainer = document.getElementById('pagination-container');
    const paginationInfo = document.getElementById('pagination-info');
    const paginationNumbers = document.getElementById('pagination-numbers');

    if (!gridHistory) return;

    if (historyOrdersCache.length === 0) {
        gridHistory.innerHTML = '<p class="col-span-full text-center py-8 text-gray-400 bg-gray-50/50 rounded-2xl border border-dashed border-gray-200">No hay historial de órdenes postergadas.</p>';
        if (paginationContainer) paginationContainer.classList.add('hidden');
        return;
    }

    const totalPages = Math.ceil(historyOrdersCache.length / ITEMS_PER_PAGE);
    if (currentHistoryPage > totalPages) currentHistoryPage = totalPages;
    if (currentHistoryPage < 1) currentHistoryPage = 1;

    const startIdx = (currentHistoryPage - 1) * ITEMS_PER_PAGE;
    const endIdx = startIdx + ITEMS_PER_PAGE;
    const pageOrders = historyOrdersCache.slice(startIdx, endIdx);

    gridHistory.innerHTML = pageOrders.map(order => generateOrderCardHTML(order, currentRoleCache)).join('');

    // UI de Paginación
    if (paginationContainer && totalPages > 1) {
        paginationContainer.classList.remove('hidden');
        if (paginationInfo) {
            paginationInfo.innerText = `Mostrando ${startIdx + 1}-${Math.min(endIdx, historyOrdersCache.length)} de ${historyOrdersCache.length} órdenes en historial`;
        }

        if (paginationNumbers) {
            let btnsHTML = `
                <button onclick="changeHistoryPage(${currentHistoryPage - 1})" ${currentHistoryPage === 1 ? 'disabled' : ''} class="px-3 py-1.5 rounded-lg border text-xs font-semibold ${currentHistoryPage === 1 ? 'text-gray-300 border-gray-100' : 'text-gray-600 border-gray-200 hover:bg-gray-50'}">
                    <i class="fa-solid fa-chevron-left"></i>
                </button>
            `;

            for (let i = 1; i <= totalPages; i++) {
                btnsHTML += `
                    <button onclick="changeHistoryPage(${i})" class="px-3 py-1.5 rounded-lg text-xs font-semibold ${i === currentHistoryPage ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}">
                        ${i}
                    </button>
                `;
            }

            btnsHTML += `
                <button onclick="changeHistoryPage(${currentHistoryPage + 1})" ${currentHistoryPage === totalPages ? 'disabled' : ''} class="px-3 py-1.5 rounded-lg border text-xs font-semibold ${currentHistoryPage === totalPages ? 'text-gray-300 border-gray-100' : 'text-gray-600 border-gray-200 hover:bg-gray-50'}">
                    <i class="fa-solid fa-chevron-right"></i>
                </button>
            `;
            paginationNumbers.innerHTML = btnsHTML;
        }
    } else if (paginationContainer) {
        paginationContainer.classList.add('hidden');
    }
}

window.changeHistoryPage = function(page) {
    currentHistoryPage = page;
    renderHistoryPage();
};

/**
 * Genera el HTML de la tarjeta de orden con TODOS los botones disponibles según orders.admin.js
 */
function generateOrderCardHTML(order, myRole) {
    const orderId = order._id;
    const status = order.status || 'Pendiente';
    const isSuspended = status === 'Suspendido';
    const isPostponed = status === 'Postergado';
    const isSent = status === 'Enviado';
    const isAccepted = status === 'Envio Aceptado';
    const isPaid = status === 'Pagado';
    const isCall = status === 'Contactado';

    let statusClass = 'bg-orange-100 text-orange-600';
    if (isSuspended) statusClass = 'bg-red-100 text-red-600';
    if (isPostponed) statusClass = 'bg-blue-100 text-blue-600';
    if (isSent) statusClass = 'bg-emerald-100 text-emerald-600';
    if (isAccepted) statusClass = 'bg-yellow-200 text-yellow-600';
    if (isPaid) statusClass = 'bg-purple-200 text-purple-600';
    if (isCall) statusClass = 'bg-green-200 text-green-600';

    const lastPostpone = (order.postponeHistory && order.postponeHistory.length > 0)
        ? order.postponeHistory[order.postponeHistory.length - 1]
        : null;

    return `
    <div class="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex flex-col justify-between hover:shadow-md transition-shadow ${isSuspended ? 'opacity-80 grayscale-[0.5]' : ''}">
        <div>
            <div class="flex justify-between items-start mb-4">
                <div>
                    <p class="text-[10px] font-bold text-blue-600 uppercase tracking-wider">Order ID</p>
                    <h6 class="text-xs text-gray-400">${order.cartToken || '(sin ID)'}</h6>
                </div>
                <span class="px-3 py-1 rounded-full text-[11px] font-semibold flex items-center gap-1 ${statusClass}">
                    <span class="w-1.5 h-1.5 rounded-full bg-current"></span>
                    ${order.status || 'Sin estado'}
                </span>
            </div>
            
            <div class="flex items-center gap-3 mb-4">
                <div class="w-10 h-10 bg-gray-50 rounded-full flex items-center justify-center border border-gray-100">
                    <i class="fa-regular fa-user text-gray-400"></i>
                </div>
                <div class="overflow-hidden">
                    <p class="text-sm font-semibold text-gray-800 truncate">${order.customerData?.Customname || 'Sin nombre'}</p>
                    <p class="text-xs text-gray-400 truncate">${order.customerData?.phone || order.phone || 'Sin Teléfono'}</p>
                </div>
            </div>

            <div class="flex justify-between items-center mb-5">
                <div class="flex items-center gap-2 text-gray-400">
                    <i class="fa-regular fa-calendar text-sm"></i>
                    <span class="text-xs font-medium text-gray-500">${order.orderDate || ''}</span>
                </div>
                <div class="flex items-center gap-1">
                    <span class="text-gray-400 text-sm">$</span>
                    <span class="text-base font-bold text-gray-800">${Number(order.total || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
            </div>

            ${lastPostpone ? `
            <div class="mb-4 p-2.5 bg-blue-50/70 rounded-xl border border-blue-100">
                <div class="flex justify-between items-center mb-1">
                    <p class="text-[10px] text-blue-600 font-bold uppercase italic">${isPostponed ? 'Reprogramado para:' : 'Última Postergación:'}</p>
                    <span class="text-[9px] bg-blue-200 text-blue-800 font-bold px-1.5 py-0.5 rounded">${order.postponeHistory.length}x</span>
                </div>
                <p class="text-xs font-bold text-gray-700">
                    <i class="fa-regular fa-clock mr-1 text-blue-500"></i>${lastPostpone.date || ''}${lastPostpone.time || ''}
                </p>
                ${lastPostpone.comment ? `<p class="text-[11px] text-gray-500 italic mt-1 truncate">"${lastPostpone.comment}"</p>` : ''}
            </div>
            ` : ''}

            <div class="grid grid-cols-2 gap-2 border-t border-gray-50 pt-4 mb-4">
                <div>
                    <p class="text-[9px] uppercase font-bold text-gray-300 mb-1 italic">Vendedor</p>
                    <span class="text-[11px] font-medium text-gray-600">${order.assignedSellerName || 'Sistema'}</span>
                </div>
                <div>
                    <p class="text-[9px] uppercase font-bold text-gray-300 mb-1 italic">Motorizado</p>
                    <span class="text-[11px] font-medium text-gray-600">${order.assignedMotorizedName || 'Sin motorizado'}</span>
                </div>
            </div>
        </div>

        <!-- MANTENIMIENTO INTEGRAL DE TODOS LOS BOTONES DE ACCIÓN -->
        <div class="flex flex-col gap-2 pt-2 border-t border-gray-100">
            <div class="flex items-center justify-between gap-1 bg-gray-50/50 p-1.5 rounded-xl">
                <button onclick="showOrderDetails('${orderId}')" title="Visualizar Orden" class="bg-green-100 flex-1 py-2 rounded-lg hover:bg-green-600 hover:text-white text-green-700 transition-all text-xs">
                    <i class="fa-regular fa-eye"></i>
                </button>

                <button onclick="openEditOrder('${orderId}', '${myRole}')" title="Editar Orden" class="bg-blue-100 flex-1 py-2 rounded-lg hover:bg-blue-600 hover:text-white text-blue-700 transition-all text-xs">
                    <i class="fa-regular fa-pen-to-square"></i>
                </button>

                <button onclick="openPostponeOrder('${orderId}')" title="Postergar / Ajustar Fecha" class="bg-yellow-100 flex-1 py-2 rounded-lg hover:bg-yellow-500 hover:text-white text-yellow-700 transition-all text-xs">
                    <i class="fa-regular fa-clock"></i>
                </button>

                <button onclick="openContactModal('${orderId}')" title="Contactar Cliente" class="bg-indigo-100 flex-1 py-2 rounded-lg hover:bg-indigo-600 hover:text-white text-indigo-700 transition-all text-xs">
                    <i class="fa-solid fa-comments"></i>
                </button>
            </div>

            <!-- Botones condicionales adicionales según rol y estado -->
            <div class="grid grid-cols-2 gap-1.5">
                ${isSuspended ? `
                    <button onclick="handleReactivateOrder('${orderId}')" class="col-span-2 py-1.5 px-2 bg-emerald-500 text-white rounded-lg text-xs font-semibold hover:bg-emerald-600 transition-all">
                        <i class="fa-solid fa-play mr-1"></i> Reactivar
                    </button>
                ` : `
                    <button onclick="handleSuspendOrder('${orderId}')" class="py-1.5 px-2 bg-red-50 text-red-600 rounded-lg text-xs font-semibold hover:bg-red-100 transition-all">
                        <i class="fa-solid fa-pause mr-1"></i> Suspender
                    </button>
                `}

                ${(!isPaid && (myRole === 'administrador' || myRole === 'gerente' || myRole === 'motorizado')) ? `
                    <button onclick="openPaymentModalFromOrderId('${orderId}')" class="py-1.5 px-2 bg-purple-100 text-purple-700 rounded-lg text-xs font-semibold hover:bg-purple-600 hover:text-white transition-all">
                        <i class="fa-solid fa-dollar-sign mr-1"></i> Cobrar
                    </button>
                ` : ''}

                ${(myRole === 'motorizado' && !isAccepted) ? `
                    <button onclick="handleAcceptDelivery('${orderId}')" class="col-span-2 py-1.5 px-2 bg-amber-500 text-white rounded-lg text-xs font-semibold hover:bg-amber-600 transition-all">
                        <i class="fa-solid fa-truck-ramp-box mr-1"></i> Aceptar Envíos
                    </button>
                ` : ''}
            </div>
        </div>
    </div>`;
}

window.applyAllFilters = async function () {
    const search = document.getElementById("globalSearch")?.value?.trim().toLowerCase() || "";
    const seller = document.getElementById("filterSeller")?.value || "all";
    const motorized = document.getElementById("filterMotorized")?.value || "all";
    const sort = document.getElementById("filterSort")?.value || "newest";
    const status = document.getElementById("filterOrderStatus")?.value || "all";

    fetchAndRenderOrders({
        search,
        seller,
        motorized,
        sort,
        status
    });
};

function completeVenezuelaAddress(address, order) {
    let completed = address || "";
    completed = completed.trim();

    if (!/venezuela/i.test(completed)) {
        let state = "";
        let city = "";
        if (order.customerData && order.customerData.state) {
            state = order.customerData.state;
        } else if (order.state) {
            state = order.state;
        }
        if (order.customerData && order.customerData.city) {
            city = order.customerData.city;
        } else if (order.city) {
            city = order.city;
        }
        if (state && !new RegExp(state, 'i').test(completed)) {
            completed += ", " + state;
        } else if (city && !new RegExp(city, 'i').test(completed)) {
            completed += ", " + city;
        }
        completed += ", Venezuela";
    }
    return completed;
}

async function geocodeAddress(address) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`;
    try {
        const response = await fetch(url, {
            headers: {
                'Accept-Language': 'es'
            }
        });
        const data = await response.json();
        if (data && data.length > 0) {
            return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
        }
    } catch (e) {
        console.error("Error geocodificando dirección:", e);
    }
    return null;
}

window.showOrderDetails = async function (orderId) {
    const order = window.ordersCache[orderId];
    if (!order) return;

    const modal = document.getElementById('orderModal');
    const body = document.getElementById('modalBody');

    body.innerHTML = `
        <div class="flex flex-col items-center justify-center py-20">
            <i class="fa-solid fa-spinner animate-spin text-4xl text-blue-500 mb-4"></i>
            <p class="text-gray-500 text-sm animate-pulse">Cargando detalles y productos...</p>
        </div>
    `;
    modal.classList.remove('hidden');

    let modalEurHTML = "";
    if (currentRates.usd && currentRates.eur) {
        const totalUsd = parseFloat(order.total || 0);
        const totalEur = totalUsd * currentRates.eur;

        const totalEurFormateado = totalEur.toLocaleString('es-ES', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });

        modalEurHTML = `<span class="text-sm font-bold text-yellow-400 block mt-1 text-right">&euro; ${totalEurFormateado}</span>`;
    }

    const items = order.items || [];
    const itemsWithImages = await Promise.all(items.map(async (item) => {
        const img = await fetchProductImg(item.productId);
        return { ...item, img };
    }));

    const productsHTML = itemsWithImages.map(item => `
        <div class="flex items-center justify-between py-3 border-b border-gray-50 last:border-0">
            <div class="flex items-center gap-4">
                <img src="${item.img}" class="w-12 h-12 object-cover rounded-lg border border-gray-100 shadow-sm" onerror="this.src='https://via.placeholder.com/150'">
                <div>
                    <p class="text-sm font-bold text-gray-800">${item.name || 'Producto'}</p>
                    <p class="text-[11px] text-gray-400">Cantidad: ${item.quantity || 1}</p>
                </div>
            </div>
            <div class="text-right">
                <p class="text-xs text-gray-400">c/u $${item.price || '0.00'}</p>
                <p class="text-sm font-bold text-blue-600">$${item.subtotal || '0.00'}</p>
            </div>
        </div>
    `).join('');

    body.innerHTML = `
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div class="space-y-6">
                <div>
                    <h4 class="text-[10px] font-black uppercase text-blue-500 mb-3 tracking-widest border-l-4 border-blue-500 pl-2">Ficha del Cliente</h4>
                    <div class="bg-gray-50 rounded-2xl p-5 border border-gray-100">
                        <div class="flex items-center gap-4 mb-4">
                            <div class="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-sm text-blue-500">
                                <i class="fa-solid fa-user-tie text-xl"></i>
                            </div>
                            <div>
                                <p class="text-base font-bold text-gray-800">${order.customerData?.Customname || 'Cliente'}</p>
                                <p class="text-xs text-gray-400">${order.customerData?.phone || order.phone || 'Sin teléfono'}</p>
                            </div>
                        </div>
                        <p class="text-xs text-gray-500 leading-relaxed">
                            <i class="fa-solid fa-map-location-dot mr-2 text-blue-300"></i>
                            ${order.customerData?.address || order.readable_address || 'Sin dirección'}
                        </p>
                    </div>
                </div>
                <div>
                    <h4 class="text-[10px] font-black uppercase text-orange-500 mb-3 tracking-widest border-l-4 border-orange-500 pl-2">Ubicación GPS</h4>
                    <div id="map" class="h-[200px] shadow-inner bg-gray-100 rounded-2xl border border-gray-100 overflow-hidden"></div>
                </div>
            </div>
            <div class="flex flex-col h-full">
                <h4 class="text-[10px] font-black uppercase text-emerald-500 mb-3 tracking-widest border-l-4 border-emerald-500 pl-2">Listado de Productos</h4>
                <div class="flex-1 bg-white border border-gray-50 rounded-2xl p-4 overflow-y-auto max-h-[350px] mb-6 shadow-sm">
                    ${productsHTML || '<p class="text-gray-400 text-xs italic">No hay productos en esta orden.</p>'}
                </div>
                <div class="mt-auto bg-gray-900 text-white rounded-2xl p-5 shadow-lg">
                    <div class="grid grid-cols-2 gap-4 mb-4">
                        <div>
                            <p class="text-[9px] uppercase font-bold text-blue-300 mb-1 italic">Vendedor</p>
                            <p class="text-xs font-medium">${order.assignedSellerName || 'Venta Web'}</p>
                        </div>
                        <div>
                            <p class="text-[9px] uppercase font-bold text-emerald-300 mb-1 italic">Motorizado</p>
                            <p class="text-xs font-medium">${order.assignedMotorizedName || 'Por asignar'}</p>
                        </div>
                    </div>
                    <div class="border-t border-gray-700 pt-3 flex justify-between items-center">
                        <span class="text-xs font-bold uppercase tracking-widest text-gray-400">Total a Pagar</span>
                        <div class="flex flex-col items-end">
                            <span class="text-2xl font-black text-white leading-none">$${Number(order.total || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '00,00'}</span>
                            ${modalEurHTML}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    const lat = order.customerData?.lat || order.lat;
    const lng = order.customerData?.lng || order.lng;
    let rawAddress = order.customerData?.address || order.readable_address || "";
    const address = completeVenezuelaAddress(rawAddress, order) || "Caracas, Venezuela";

    const name = order.customerData?.Customname || 'Cliente';
    const phone = order.customerData?.phone || order.phone || '';

    function drawMap(lat, lng, name, phone) {
        setTimeout(() => {
            const mapContainer = L.DomUtil.get('map');
            if (mapContainer != null) { mapContainer._leaflet_id = null; }
            const map = L.map('map').setView([lat, lng], 16);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

            const popupContent = `
            <div style="min-width:140px;">
                <strong style="font-size:13px">${name || 'Cliente'}</strong><br>
                <span style="font-size:12px;color:#333;">&#128222; ${phone || ''}</span><br>
                <a href="https://www.google.com/maps?q=${lat},${lng}" 
                   target="_blank"
                   style="display:inline-block;margin-top:7px;background:#4285F4;color:white;padding:4px 10px;border-radius:6px;font-size:12px;text-align:center;text-decoration:none;">
                    Ver en Google Maps
                </a>
            </div>
            `;
            L.marker([lat, lng]).addTo(map).bindPopup(popupContent).openPopup();
        }, 300);
    }

    (async () => {
        if (lat && lng) {
            drawMap(parseFloat(lat), parseFloat(lng), name, phone);
        } else if (address) {
            const coords = await geocodeAddress(address);
            if (coords) {
                drawMap(coords.lat, coords.lng, name, phone);
            } else {
                drawMap(10.03717, -69.22458, name, phone);
            }
        } else {
            drawMap(10.03717, -69.22458);
        }
    })();
};

window.closeModal = function () {
    const modal = document.getElementById('orderModal');
    if (modal) modal.classList.add('hidden');
};

async function checkPostponedOrders() {
    const ahora = new Date();

    for (const id in window.ordersCache) {
        const order = window.ordersCache[id];

        if (order.status === "Postergado" && order.postponeHistory && order.postponeHistory.length > 0) {

            const lastPostpone = order.postponeHistory[order.postponeHistory.length - 1];
            const { date, time } = lastPostpone;

            if (date && time) {
                const scheduledTime = new Date(`${date}T${time}:00`);

                if (ahora >= scheduledTime) {
                    console.log(`Reactivando orden vencida desde historial: ${id}`);
                    try {
                        await updateDoc(doc(db, "orders", id), {
                            status: "Asignado",
                            lastUpdate: ahora.toISOString(),
                            autoReactivated: true
                        });
                    } catch (error) {
                        console.error("Error al reactivar desde historial:", error);
                    }
                }
            }
        }
    }
}

// Limpiar todos los filtros
window.clearAllFilters = async function () {
    const searchInput = document.getElementById("globalSearch");
    if (searchInput) searchInput.value = "";

    const sellerSelect = document.getElementById("filterSeller");
    if (sellerSelect) sellerSelect.value = "all";

    const motorizedSelect = document.getElementById("filterMotorized");
    if (motorizedSelect) motorizedSelect.value = "all";

    const statusSelect = document.getElementById("filterOrderStatus");
    if (statusSelect) statusSelect.value = "all";

    const sortSelect = document.getElementById("filterSort");
    if (sortSelect) sortSelect.value = "newest";

    currentPage = 1;
    await window.applyAllFilters();
};

// Inicialización
window.addEventListener('DOMContentLoaded', async () => {
    await loadExchangeRates();
    await window.applyAllFilters();

    setInterval(checkPostponedOrders, 30000);
});