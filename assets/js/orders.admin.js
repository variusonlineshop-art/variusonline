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
    onSnapshot
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

import { getAuth } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { openPaymentModal } from './payment-modal.js';

// Permitirlo como handler global:
window.openPaymentModalFromOrderId = function (orderId) {
    const order = window.ordersCache[orderId];
    if (order) {
        // Necesario: el modal espera un campo .id para identificar la orden
        openPaymentModal({ ...order, id: orderId });
    }
};
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

// Inicializa Firebase y Firestore SOLO una vez
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

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

/**
 * Renderiza el grid de órdenes con lógica condicional para órdenes suspendidas y filtro de rol
 * Ahora acepta un objeto filters: {search, seller, motorized, sort}
 */

// Variable global para limpiar el listener en caso de recarga de filtros o sesión

// Variable global para limpiar el listener en caso de recarga
window.currentOrdersUnsubscribe = null;

/**
 * Renderiza el grid de órdenes en TIEMPO REAL y siempre ordena del más nuevo al más viejo.
 */
function fetchAndRenderOrders(filters = {}) {
    const container = document.getElementById('grid-container');
    if (!container) return;

    // Limpia el listener anterior si existe
    if (window.currentOrdersUnsubscribe) {
        window.currentOrdersUnsubscribe();
        window.currentOrdersUnsubscribe = null;
    }

    const auth = getAuth();
    let user = auth.currentUser;

    // Esto permite Wait por el login si aún no se ha hecho
    function continuarConUsuario(user) {
        if (!user) {
            container.innerHTML = '<p class="text-center py-10 text-red-500">Debes iniciar sesión para ver órdenes.</p>';
            return;
        }
        getDoc(doc(db, "users", user.uid)).then(userDocSnap => {
            let myData = userDocSnap.data() || {};
            let myRole = (myData.role || '').toLowerCase();

            let ordersQuery;
            if (myRole === "administrador") {
                ordersQuery = collection(db, "orders");
            } else if (myRole === "motorizado") {
                ordersQuery = query(
                    collection(db, "orders"),
                    where("assignedMotorizedId", "==", user.uid)
                );
            } else if (myRole === "vendedor") {
                ordersQuery = query(
                    collection(db, "orders"),
                    where("assignedSeller", "==", user.uid)
                );
            } else {
                container.innerHTML = '<p class="text-center py-10 text-gray-500">No tienes permisos para ver órdenes.</p>';
                return;
            }

            // Listener en tiempo real
            window.currentOrdersUnsubscribe = onSnapshot(ordersQuery, (querySnapshot) => {
                window.ordersCache = {};
                let ordersArr = [];
                querySnapshot.forEach((documento) => {
                    const order = documento.data();
                    const orderId = documento.id;
                    order._id = orderId;
                    window.ordersCache[orderId] = order;
                    ordersArr.push(order);
                });

                // Popula selects de vendedores y motorizados usando todas las órdenes
                fillFilterOptions("filterSeller", ordersArr.map(o => [o.assignedSeller, o.assignedSellerName]));
                fillFilterOptions("filterMotorized", ordersArr.map(o => [o.assignedMotorizedId, o.assignedMotorizedName]));

                // === Filtros ===
                if (filters.seller && filters.seller !== "all") {
                    ordersArr = ordersArr.filter(o => o.assignedSeller === filters.seller);
                }
                if (filters.motorized && filters.motorized !== "all") {
                    ordersArr = ordersArr.filter(o => o.assignedMotorizedId === filters.motorized);
                }
                if (filters.search) {
                    const searchTerm = filters.search.toLowerCase();
                    ordersArr = ordersArr.filter(o => {
                        const customer = o.customerData?.Customname?.toLowerCase() || '';
                        const id = o.cartToken?.toLowerCase() || '';
                        const phone = o.customerData?.phone?.toLowerCase() || o.phone?.toLowerCase() || '';
                        return (
                            customer.includes(searchTerm) ||
                            id.includes(searchTerm) ||
                            phone.includes(searchTerm)
                        );
                    });
                }

                // Ordena SIEMPRE del más nuevo al más viejo
                ordersArr.sort((a, b) => new Date(b.orderDate) - new Date(a.orderDate));

                // Renderizado
                let allCardsHTML = "";
                if (ordersArr.length === 0) {
                    allCardsHTML = '<p class="text-center py-10 text-gray-500">No hay órdenes que coincidan con los filtros.</p>';
                } else {
                    ordersArr.forEach((order) => {
                        const orderId = order._id;
                        const status = order.status || 'Pendiente';
                        const isSuspended = status === 'Suspendido';
                        const isPostponed = status === 'Postergado';
                        const isSent = status === 'Enviado';
                        const isAccepted = status === 'Envio Aceptado';
                        const isPaid = status === 'Pagado';
                        const isCall = status === 'Contactado';

                        const suspendComment = order.suspendComment || "";
                        const suspendDate = order.suspendDate || "";

                        let statusClass = 'bg-orange-100 text-orange-600';
                        if (isSuspended) statusClass = 'bg-red-100 text-red-600';
                        if (isPostponed) statusClass = 'bg-blue-100 text-blue-600';
                        if (isSent) statusClass = 'bg-emerald-100 text-emerald-600';
                        if (isAccepted) statusClass = 'bg-yellow-200 text-yellow-600';
                        if (isPaid) statusClass = 'bg-purple-200 text-purple-600';
                        if (isCall) statusClass = 'bg-green-200 text-green-600';

                        const hasMotorized = order.assignedMotorizedId && order.assignedMotorizedId !== "";
                        const hasLocation = order.deliveryLocation?.lat && order.deliveryLocation?.lng;
                        const showCobranzaBtn = myRole === "administrador" || myRole === "motorizado";

                        allCardsHTML += `
                        <div class="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex flex-col justify-between hover:shadow-md transition-shadow ${isSuspended ? 'opacity-80 grayscale-[0.5]' : ''}">
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
                                    <p class="text-xs text-gray-400 truncate">${order.customerData?.phone || order.phone || 'Sin Telefono'}</p>
                                </div>
                            </div>
                            <div class="flex justify-between items-center mb-5">
                                <div class="flex items-center gap-2 text-gray-400">
                                    <i class="fa-regular fa-calendar text-sm"></i>
                                    <span class="text-xs font-medium text-gray-500">${order.orderDate}</span>
                                </div>
                                <div class="flex items-center gap-1">
                                    <span class="text-gray-400 text-sm">$</span>
                                    <span class="text-base font-bold text-gray-800">${Number(order.total || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '00,00'}</span>
                                </div>
                            </div>
                            ${isPostponed ? `
                            <div class="mb-4 p-2 bg-blue-50 rounded-lg border border-blue-100">
                                <p class="text-[10px] text-blue-600 font-bold uppercase italic">Reprogramado para:</p>
                                <p class="text-xs font-bold text-gray-700">${order.nextSchedule || 'No definida'}</p>
                            </div>
                            ` : ''}
                            <div class="grid grid-cols-2 gap-2 border-t border-gray-50 pt-4 mb-6">
                                <div>
                                    <p class="text-[9px] uppercase font-bold text-gray-300 mb-1 italic">Vendedor</p>
                                    <div class="flex items-center gap-1.5">
                                        <i class="fa-regular fa-user text-blue-400 text-[10px]"></i>
                                        <span class="text-[11px] font-medium text-gray-600">${order.assignedSellerName || 'Sistema'}</span>
                                    </div>
                                </div>
                                <div>
                                    <p class="text-[9px] uppercase font-bold text-gray-300 mb-1 italic">Motorizado</p>
                                    <div class="flex items-center gap-1.5">
                                        <i class="fa-solid fa-motorcycle text-emerald-400 text-[10px]"></i>
                                        <span class="text-[11px] font-medium text-gray-600">${order.assignedMotorizedName || 'Sin motorizado'}</span>
                                    </div>
                                </div>
                            </div>
                            ${isSuspended ? `
                                <div class="mb-2">
                                    ${(suspendComment || suspendDate) ? `
                                        <span class="inline-block bg-red-100 text-red-500 text-xs rounded-full px-3 py-1 mb-2 font-semibold border border-red-200">
                                            <i class="fa-regular fa-message-dots mr-1"></i>
                                            ${suspendComment ? `<span>${suspendComment}</span>` : ``}
                                            ${suspendDate ? `<span class="ml-2"><i class="fa-regular fa-clock"></i> ${new Date(suspendDate).toLocaleString('es-ES')}</span>` : ``}
                                        </span>
                                    ` : ''}
                                </div>
                            ` : ''}
                            <div class="flex items-center justify-between gap-1 bg-gray-50/50 p-1.5 rounded-xl">
                                ${isPaid ? `
                                    <div class="w-full py-2.5 rounded-lg bg-purple-200 text-purple-500 flex items-center justify-center gap-2 cursor-default">
                                        <i class="fa-solid fa-check-circle text-xs"></i>
                                        <span class="text-[10px] font-bold tracking-wider uppercase">Orden Completada</span>
                                    </div>
                                ` : isSuspended ? `
                                    <button onclick="handleReactivateOrder('${orderId}')" class="w-full py-2.5 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 shadow-sm transition-all flex items-center justify-center gap-2">
                                        <i class="fa-solid fa-play text-xs"></i>
                                        <span class="text-[10px] font-bold tracking-wider">REACTIVAR ORDEN</span>
                                    </button>
                                `  : isSent ? `
                                    ${!hasLocation ? `
                                        <button onclick="handleSaveCurrentLocation('${orderId}')" title="Guardar Mi Ubicación" class="w-full py-2.5 rounded-lg bg-blue-500 text-white hover:bg-blue-600 shadow-sm transition-all flex items-center justify-center gap-2">
                                            <i class="fa-solid fa-location-dot text-xs"></i>
                                            <span class="text-[10px] font-bold tracking-wider">MI UBICACIÓN</span>
                                        </button>
                                    ` : `
                                        <button onclick="handleAcceptDelivery('${orderId}')" title="Aceptar Envío" class="w-full py-2.5 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 shadow-sm transition-all flex items-center justify-center gap-2">
                                            <i class="fa-solid fa-check-double text-xs"></i>
                                            <span class="text-[10px] font-bold tracking-wider">ACEPTAR ENVÍO</span>
                                        </button>
                                    `}
                                ` : isPostponed ? `
                                    <button onclick="handleSuspendOrder('${orderId}')" title="Suspender Orden" class="w-full py-2.5 flex-1 rounded-lg bg-red-200 text-red-500 flex items-center justify-center hover:bg-red-700 gap-2 cursor-default">
                                        <i class="fa-regular fa-circle-pause text-xs"></i>
                                    </button>
                                    <button onclick="openPostponeOrder('${orderId}')" title="Reprogramar" class="w-full py-2.5  flex-[3] rounded-lg bg-blue-200 text-blue-500 flex items-center justify-center hover:bg-blue-700 gap-2 cursor-default">
                                        <i class="fa-regular fa-clock text-xs"></i> 
                                        <span class="text-[10px] font-bold tracking-wider uppercase">Ajustar Fecha</span>
                                    </button>
                                ` : `
                                    <button onclick="showOrderDetails('${orderId}')" title="Visualizar Orden" class="bg-green-200 flex-1 py-2 rounded-lg hover:bg-green-600 hover:shadow-sm hover:text-white text-green-700 transition-all">
                                        <i class="fa-regular fa-eye text-xs"></i>
                                    </button>
                                    <button onclick="openEditOrder('${orderId}')" title="Editar Orden" class="bg-blue-200 flex-1 py-2 rounded-lg hover:bg-blue-600 hover:shadow-sm hover:text-white text-blue-700 transition-all">
                                        <i class="fa-regular fa-pen-to-square text-xs"></i>
                                    </button>
                                   ${(hasMotorized && !isSent && !isAccepted) ? `
                                        <button onclick="handleMarkAsSent('${orderId}')" title="Marcar como Enviado" class="bg-emerald-200 flex-1 py-2 rounded-lg text-emerald-600 hover:text-white hover:bg-emerald-600 shadow-md transition-all">
                                            <i class="fa-solid fa-paper-plane text-xs"></i>
                                        </button>
                                    ` : ''}
                                    <button onclick="openPostponeOrder('${orderId}')" title="Postergar" class="bg-yellow-200 flex-1 py-2 rounded-lg hover:bg-yellow-500 hover:text-white text-yellow-700 transition-all">
                                        <i class="fa-regular fa-clock text-xs"></i>
                                    </button>
                                    <button title="Historial del Cliente" class="flex-1 py-2 rounded-lg bg-blue-100 hover:bg-blue-300 text-blue-600 hover:text-white shadow-sm"><i class="fa-regular fa-calendar text-xs"></i></button>
                                    
                                    ${showCobranzaBtn ? `
                                        <button onclick="openPaymentModalFromOrderId('${orderId}')" title="Gestionar Cobranza" class="flex-1 py-2 rounded-lg bg-blue-100 hover:bg-blue-300 text-blue-600 hover:text-white shadow-sm">
                                            <i class="fa-regular fa-dollar text-xs"></i>
                                        </button>
                                    ` : ''}
                                    <button onclick="handleSuspendOrder('${orderId}')" title="Suspender Orden" class="bg-red-200 flex-1 py-2 rounded-lg hover:bg-red-500 hover:text-white text-red-700 transition-all">
                                        <i class="fa-regular fa-circle-pause text-xs"></i>
                                    </button>
                                    <button onclick="openContactModal('${orderId}')" title="Contactar Cliente" class="bg-indigo-100 flex-1 py-2 rounded-lg hover:bg-indigo-600 hover:text-white text-indigo-700 transition-all">
                                        <i class="fa-solid fa-address-book text-xs"></i>
                                    </button>
                                `}
                            </div>
                        </div>
                        `;
                    });
                }

                container.innerHTML = allCardsHTML;
            }, (error) => {
                console.error("Error en tiempo real:", error);
                container.innerHTML = '<p class="text-center py-10 text-red-500">Error al conectar en tiempo real con Firestore.</p>';
            });
        });
    }

    // Autenticación dinámica
    if (user) {
        continuarConUsuario(user);
    } else {
        const unsubscribe = auth.onAuthStateChanged(u => {
            unsubscribe();
            continuarConUsuario(u);
        });
    }
}

/**
 * Llena un <select> con opciones únicas usando un array de arrays [id, nombre]
 */
function fillFilterOptions(selectId, dataPairs) {
    const select = document.getElementById(selectId);
    if (!select) return;
    // Mantener opción "Todos ..." original
    let labelTodos = "Todos";
    if (selectId === "filterSeller") labelTodos = "Todos los Vendedores";
    if (selectId === "filterMotorized") labelTodos = "Todos los Motorizados";
    const unique = {};
    dataPairs.forEach(([id, name]) => {
        if (id && id !== "undefined" && !unique[id]) unique[id] = name || id;
    });
    let html = `<option value="all">${labelTodos}</option>`;
    for (const [id, name] of Object.entries(unique)) {
        html += `<option value="${id}">${name || id}</option>`;
    }
    select.innerHTML = html;
}

/**
 * Nueva función global: Lee todos los filtros y recarga el grid de órdenes con ellos
 */
window.applyAllFilters = async function () {
    const search = document.getElementById("globalSearch").value?.trim().toLowerCase() || "";
    const seller = document.getElementById("filterSeller").value || "all";
    const motorized = document.getElementById("filterMotorized").value || "all";
    const sort = document.getElementById("filterSort").value || "newest"; // Asegura el default
    await fetchAndRenderOrders({
        search,
        seller,
        motorized,
        sort
    });
};

/**
 * Muestra el modal con detalles. 
 */


function completeVenezuelaAddress(address, order) {
    // Siempre fuerza "Venezuela" al final
    let completed = address || "";
    completed = completed.trim();

    // Si falta el país, lo agrega
    if (!/venezuela/i.test(completed)) {
        // Intenta agregar estado: busca en datos del cliente o fallback
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
        // Si la dirección ya NO tiene el estado ni la ciudad, lo agrega antes de "Venezuela"
        if (state && !new RegExp(state, 'i').test(completed)) {
            completed += ", " + state;
        } else if (city && !new RegExp(city, 'i').test(completed)) {
            completed += ", " + city;
        }
        completed += ", Venezuela";
    }
    return completed;
}

// Utilidad: Geocodifica una dirección en lat/lng usando Nominatim
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
                        <span class="text-2xl font-black text-white">$${Number(order.total || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '00,00'}</span>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Obtén lat/lng y dirección
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

    // El mapa SIEMPRE se dibuja: con coordenadas, con dirección, o valor por defecto
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
}

window.closeModal = function () {
    const modal = document.getElementById('orderModal');
    if (modal) modal.classList.add('hidden');
}

// === Inicialización automática ===
window.addEventListener('DOMContentLoaded', () => {
    window.applyAllFilters();
});

window.clearAllFilters = async function () {
    // 1. Limpiar el input de búsqueda
    const searchInput = document.getElementById("globalSearch");
    if (searchInput) searchInput.value = "";

    // 2. Regresar los selects a sus valores iniciales
    const sellerSelect = document.getElementById("filterSeller");
    if (sellerSelect) sellerSelect.value = "all";

    const motorizedSelect = document.getElementById("filterMotorized");
    if (motorizedSelect) motorizedSelect.value = "all";

    const sortSelect = document.getElementById("filterSort");
    if (sortSelect) sortSelect.value = "newest";

    // 3. Ejecutar la recarga con los valores ya limpios
    await window.applyAllFilters();
};
