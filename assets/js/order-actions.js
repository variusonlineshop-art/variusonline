import { initializeApp, getApp, getApps } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import {
    getFirestore,
    doc,
    updateDoc,
    collection,
    getDocs,
    query,
    where,
    arrayUnion
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";
import { firebaseConfig } from './firebase-config.js';

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app);

let currentEditingOrder = null;
let editingItems = [];
let allActiveProducts = [];

/* ==========================================
   1. GESTIÓN DE MODALES
   ========================================== */

window.closeConfirmModal = () => document.getElementById('confirmModal').classList.add('hidden');
window.closePostponeModal = () => document.getElementById('postponeModal').classList.add('hidden');

function openConfirmCustom({ title, message, iconClass, iconBg, btnClass, actionFn }) {
    const modal = document.getElementById('confirmModal');
    const iconContainer = document.getElementById('confirmIcon');
    const btnAction = document.getElementById('confirmBtnAction');

    document.getElementById('confirmTitle').innerText = title;
    document.getElementById('confirmMessage').innerText = message;
    iconContainer.className = `w-20 h-20 rounded-full mx-auto mb-6 flex items-center justify-center text-3xl ${iconBg}`;
    iconContainer.innerHTML = `<i class="${iconClass}"></i>`;
    btnAction.className = `flex-1 py-3 rounded-xl font-bold text-white shadow-lg transform active:scale-95 transition-all ${btnClass}`;

    btnAction.onclick = async () => {
        btnAction.disabled = true;
        btnAction.innerHTML = '<i class="fa-solid fa-spinner animate-spin"></i>';
        await actionFn();
        closeConfirmModal();
    };
    modal.classList.remove('hidden');
}

/* ==========================================
   2. ACCIONES DE ESTADO (SUSPENDER, REACTIVAR, POSTERGAR)
   ========================================== */

export async function handleSuspendOrder(orderId) {
    openConfirmCustom({
        title: "Suspender Orden",
        message: "¿Estás seguro de pausar esta orden? Los botones de gestión se ocultarán.",
        iconClass: "fa-regular fa-circle-pause",
        iconBg: "bg-red-100 text-red-500",
        btnClass: "bg-red-500 hover:bg-red-600",
        actionFn: async () => {
            await updateDoc(doc(db, "orders", orderId), { status: "Suspendido" });
            location.reload();
        }
    });
}

export async function handleReactivateOrder(orderId) {
    openConfirmCustom({
        title: "Reactivar Orden",
        message: "La orden volverá al estado 'Asignado' y será visible nuevamente.",
        iconClass: "fa-solid fa-play",
        iconBg: "bg-emerald-100 text-emerald-500",
        btnClass: "bg-emerald-500 hover:bg-emerald-600",
        actionFn: async () => {
            await updateDoc(doc(db, "orders", orderId), { status: "Asignado" });
            location.reload();
        }
    });
}
/* ==========================================
   NUEVA ACCIÓN: MARCAR COMO ENVIADO
   ========================================== */
export async function handleMarkAsSent(orderId) {
    openConfirmCustom({
        title: "Confirmar Envío",
        message: "¿Deseas marcar esta orden como 'Enviado'? El motorizado será notificado.",
        iconClass: "fa-solid fa-truck-fast",
        iconBg: "bg-blue-100 text-blue-500",
        btnClass: "bg-blue-600 hover:bg-blue-700",
        actionFn: async () => {
            try {
                await updateDoc(doc(db, "orders", orderId), {
                    status: "Enviado",
                    sentAt: new Date().toISOString()
                });
                location.reload();
            } catch (error) {
                console.error("Error al actualizar a enviado:", error);
                alert("No se pudo actualizar el estado.");
            }
        }
    });
}

window.handleMarkAsSent = handleMarkAsSent;

/* ==========================================
   NUEVAS ACCIONES: UBICACIÓN Y ACEPTACIÓN
   ========================================== */

export async function handleSaveCurrentLocation(orderId) {
    if (!navigator.geolocation) {
        alert("Tu navegador no soporta geolocalización.");
        return;
    }

    // Opcional: Mostrar un indicador de carga en el botón si lo deseas
    
    navigator.geolocation.getCurrentPosition(async (position) => {
        const { latitude, longitude } = position.coords;
        
        try {
            await updateDoc(doc(db, "orders", orderId), {
                deliveryLocation: {
                    lat: latitude,
                    lng: longitude,
                    savedAt: new Date().toISOString()
                }
            });
            location.reload(); // Recargamos para que cambie el botón
        } catch (error) {
            console.error("Error al guardar ubicación:", error);
            alert("No se pudo guardar la ubicación.");
        }
    }, (error) => {
        alert("Error al obtener ubicación: " + error.message);
    });
}

export async function handleAcceptDelivery(orderId) {
    openConfirmCustom({
        title: "Confirmar Entrega",
        message: "¿Confirmas que el envío ha sido Aceptado?",
        iconClass: "fa-solid fa-box-open",
        iconBg: "bg-emerald-100 text-emerald-500",
        btnClass: "bg-emerald-600 hover:bg-emerald-700",
        actionFn: async () => {
            try {
                await updateDoc(doc(db, "orders", orderId), {
                    status: "Envio Aceptado", // Nuevo estado solicitado
                    acceptedAt: new Date().toISOString()
                });
                location.reload();
            } catch (error) {
                console.error("Error al aceptar envío:", error);
                alert("Error al actualizar el estado.");
            }
        }
    });
}

// Hacerlas disponibles globalmente
window.handleSaveCurrentLocation = handleSaveCurrentLocation;
window.handleAcceptDelivery = handleAcceptDelivery;

// Nueva función para abrir modal de postergar
export function openPostponeOrder(orderId) {
    currentEditingOrder = { id: orderId };
    document.getElementById('postponeModal').classList.remove('hidden');
}

window.savePostpone = async function () {
    const date = document.getElementById('postponeDate').value;
    const time = document.getElementById('postponeTime').value;
    const comment = document.getElementById('postponeComment').value;
    const btn = document.getElementById('savePostponeBtn');

    if (!date || !time) {
        alert("Por favor selecciona fecha y hora.");
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner animate-spin mr-2"></i>Guardando...';

    const postponeEntry = {
        date,
        time,
        comment,
        timestamp: new Date().toISOString()
    };

    try {
        await updateDoc(doc(db, "orders", currentEditingOrder.id), {
            status: "Postergado",
            postponedAt: postponeEntry.timestamp,
            nextSchedule: `${date} ${time}`,
            postponeHistory: arrayUnion(postponeEntry)
        });
        location.reload();
    } catch (error) {
        console.error("Error al postergar:", error);
        alert("Error al guardar la postergación.");
        btn.disabled = false;
        btn.innerHTML = 'Confirmar Postergación';
    }
};

/* ==========================================
   3. SISTEMA DE EDICIÓN DINÁMICA (Sin cambios mayores)
   ========================================== */
window.closeEditModal = () => document.getElementById('editOrderModal').classList.add('hidden');

export async function openEditOrder(orderId) {
    const order = window.ordersCache[orderId];
    if (!order) return;

    currentEditingOrder = { id: orderId, ...order };
    editingItems = JSON.parse(JSON.stringify(order.items || []));

    document.getElementById('editOrderToken').innerText = `Referencia: ${order.cartToken || orderId}`;
    document.getElementById('editOrderModal').classList.remove('hidden');

    await loadActiveMotorized(order.assignedMotorizedId);
    await loadActiveProducts();
    renderEditingItems();
}

async function loadActiveMotorized(currentId) {
    const q = query(collection(db, "users"), where("role", "==", "motorizado"));
    const snapshot = await getDocs(q);
    const select = document.getElementById('motorizedSelect');

    select.innerHTML = '<option value="">Sin motorizado asignado</option>';
    snapshot.forEach(docSnap => {
        const user = docSnap.data();
        if (user.status === "Activo" || user.status === "ACTIVE") {
            const option = document.createElement('option');
            option.value = docSnap.id;
            option.text = user.name || user.fullName || "Motorizado sin nombre";
            if (docSnap.id === currentId) option.selected = true;
            select.appendChild(option);
        }
    });
}

async function loadActiveProducts() {
    const q = collection(db, "product");
    const snapshot = await getDocs(q);
    allActiveProducts = [];
    snapshot.forEach(docSnap => {
        const p = docSnap.data();
        if (p.status === "Activo" || p.status === "ACTIVE") {
            allActiveProducts.push({ id: docSnap.id, ...p });
        }
    });
}

/* ==========================================
   NUEVA ACCIÓN: CONTACTO
   ========================================== */
export function openContactModal(orderId) {
    const order = window.ordersCache[orderId];
    if (!order) return;

    const phone = order.customerData?.phone || order.phone || "";
    const modal = document.getElementById('contactModal');
    
    // Configurar el botón de llamada
    const callBtn = document.getElementById('contactCallBtn');
    if(phone) {
        callBtn.href = `tel:${phone}`;
        callBtn.classList.remove('opacity-50', 'pointer-events-none');
    } else {
        callBtn.href = "#";
        callBtn.classList.add('opacity-50', 'pointer-events-none');
    }

    // El botón de chat redirige a chats.html (puedes añadir parámetros si tu sistema lo soporta)
    const chatBtn = document.getElementById('contactChatBtn');
    chatBtn.onclick = () => {
        window.location.href = `chats.html?orderId=${orderId}&phone=${phone}`;
    };

    modal.classList.remove('hidden');
}

// Hacerla disponible globalmente
window.openContactModal = openContactModal;
window.closeContactModal = () => document.getElementById('contactModal').classList.add('hidden');

function renderEditingItems() {
    const container = document.getElementById('editItemsContainer');
    let total = 0;

    container.innerHTML = editingItems.map((item, index) => {
        const subtotal = (parseFloat(item.price) || 0) * (parseInt(item.quantity) || 1);
        total += subtotal;
        return `
        <div class="flex items-center gap-4 bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
            <img src="${item.img || 'https://via.placeholder.com/150'}" class="w-12 h-12 rounded-lg object-cover border">
            <div class="flex-1">
                <p class="text-sm font-bold text-gray-800">${item.name}</p>
                <p class="text-xs text-blue-600 font-bold">$${item.price}</p>
            </div>
            <div class="flex items-center gap-2 bg-gray-50 border rounded-xl p-1">
                <button onclick="updateQty(${index}, -1)" class="w-8 h-8 hover:bg-white hover:shadow-sm rounded-lg transition-all">-</button>
                <span class="w-8 text-center font-bold text-sm">${item.quantity}</span>
                <button onclick="updateQty(${index}, 1)" class="w-8 h-8 hover:bg-white hover:shadow-sm rounded-lg transition-all">+</button>
            </div>
            <button onclick="removeItem(${index})" class="text-red-300 hover:text-red-500 transition-colors p-2">
                <i class="fa-solid fa-trash-can"></i>
            </button>
        </div>`;
    }).join('');

    document.getElementById('editTotal').innerText = `$${total.toFixed(2)}`;
    document.getElementById('editSubtotal').innerText = `$${total.toFixed(2)}`;
}

window.updateQty = (index, delta) => {
    editingItems[index].quantity = Math.max(1, (editingItems[index].quantity || 1) + delta);
    editingItems[index].subtotal = (editingItems[index].quantity * editingItems[index].price).toFixed(2);
    renderEditingItems();
};

window.removeItem = (index) => {
    editingItems.splice(index, 1);
    renderEditingItems();
};

window.handleMotorizedChange = () => {
    const select = document.getElementById('motorizedSelect');
    const container = document.getElementById('motorizedCommentContainer');
    if (select.value !== currentEditingOrder.assignedMotorizedId) {
        container.classList.remove('hidden');
    } else {
        container.classList.add('hidden');
    }
};

window.showProductSelector = () => {
    const modal = document.getElementById('productSelectorModal');
    const list = document.getElementById('productList');
    list.innerHTML = allActiveProducts.map(p => `
        <div onclick="addProductToOrder('${p.id}')" class="flex items-center gap-3 p-3 hover:bg-blue-50 cursor-pointer rounded-xl transition-all border-b border-gray-50">
            <img src="${p.imageUrls ? p.imageUrls[0] : 'https://via.placeholder.com/50'}" class="w-10 h-10 rounded-md object-cover">
            <div class="flex-1">
                <p class="text-xs font-bold text-gray-700">${p.name}</p>
                <p class="text-[10px] text-blue-500">$${p.price}</p>
            </div>
            <i class="fa-solid fa-plus text-gray-300 text-xs"></i>
        </div>
    `).join('');
    modal.classList.remove('hidden');
};

window.closeProductSelector = () => document.getElementById('productSelectorModal').classList.add('hidden');

window.addProductToOrder = (productId) => {
    const prod = allActiveProducts.find(p => p.id === productId);
    if (prod) {
        editingItems.push({
            productId: prod.id,
            name: prod.name,
            price: prod.price,
            quantity: 1,
            subtotal: prod.price,
            img: prod.imageUrls ? prod.imageUrls[0] : ''
        });
        renderEditingItems();
        closeProductSelector();
    }
};

window.saveOrderChanges = async function () {
    const motorizedSelect = document.getElementById('motorizedSelect');
    const motorizedId = motorizedSelect.value;
    const motorizedName = motorizedSelect.options[motorizedSelect.selectedIndex].text;
    const comment = document.getElementById('motorizedComment').value;

    const finalTotal = editingItems.reduce((acc, item) => acc + (parseFloat(item.price) * item.quantity), 0);

    const updateData = {
        items: editingItems,
        total: finalTotal.toFixed(2),
        assignedMotorizedId: motorizedId,
        assignedMotorizedName: motorizedId ? motorizedName : "Sin asignar",
        lastUpdate: new Date().toISOString()
    };

    if (comment && motorizedId !== currentEditingOrder.assignedMotorizedId) {
        updateData.motorizedChangeReason = comment;
    }

    try {
        await updateDoc(doc(db, "orders", currentEditingOrder.id), updateData);
        location.reload();
    } catch (error) {
        console.error("Error al guardar:", error);
        alert("Hubo un error al guardar los cambios.");
    }
};