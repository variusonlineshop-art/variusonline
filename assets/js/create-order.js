/* create-order.js */
import { initializeApp, getApp, getApps } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDoc, doc, Timestamp, query, where, getDocs } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { firebaseConfig } from './firebase-config.js';

// Inicialización de Firebase
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app);
const auth = getAuth(app);

// Variables de estado
let newOrderProducts = []; 
let newOrderCart = {}; 

/* ==========================================
   1. GESTIÓN DEL MODAL
   ========================================== */

window.openCreateOrderModal = async function() {
    newOrderCart = {};
    document.getElementById('newOrderCustomerName').value = '';
    document.getElementById('newOrderPhoneNumber').value = '';
    document.getElementById('newOrderAddress').value = '';
    
    // UI a Paso 1
    document.getElementById('step1Container').classList.remove('hidden');
    document.getElementById('step2Container').classList.add('hidden');
    document.getElementById('createOrderTitle').innerText = 'Nueva Orden - Paso 1/2';
    document.getElementById('createOrderSubtitle').innerText = 'Selección de Productos';
    
    document.getElementById('createOrderModal').classList.remove('hidden');
    updateNewOrderTotal();

    const listContainer = document.getElementById('newOrderProductsList');
    listContainer.innerHTML = '<div class="flex flex-col items-center py-12"><i class="fa-solid fa-circle-notch animate-spin text-3xl text-blue-500 mb-3"></i></div>';

    try {
        const q = query(collection(db, "product"), where("status", "in", ["Activo", "ACTIVE"]));
        const snapshot = await getDocs(q);
        newOrderProducts = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        renderNewOrderProducts();
    } catch (e) {
        listContainer.innerHTML = '<p class="text-red-500 text-center">Error cargando productos.</p>';
    }
};

window.closeCreateOrderModal = () => document.getElementById('createOrderModal').classList.add('hidden');

function renderNewOrderProducts() {
    const container = document.getElementById('newOrderProductsList');
    container.innerHTML = newOrderProducts.map(p => {
        const qty = newOrderCart[p.id] || 0;
        const price = parseFloat(p.price || 0);
        return `
        <div class="flex items-center gap-4 p-3 rounded-2xl border ${qty > 0 ? 'bg-blue-50/50 border-blue-200' : 'bg-white border-gray-100'}">
            <img src="${(p.imageUrls && p.imageUrls[0]) || 'https://via.placeholder.com/50'}" class="w-12 h-12 rounded-lg object-cover">
            <div class="flex-1">
                <p class="text-sm font-bold text-gray-800">${p.name}</p>
                <p class="text-xs font-black text-blue-600">$${price.toFixed(2)}</p>
            </div>
            <div class="flex items-center gap-1 bg-gray-100 rounded-xl p-1">
                <button onclick="updateNewOrderQty('${p.id}', -1)" class="w-8 h-8 font-bold text-gray-500">-</button>
                <span class="w-7 text-center font-black">${qty}</span>
                <button onclick="updateNewOrderQty('${p.id}', 1)" class="w-8 h-8 font-bold text-gray-500">+</button>
            </div>
        </div>`;
    }).join('');
}

window.updateNewOrderQty = (productId, delta) => {
    const currentQty = newOrderCart[productId] || 0;
    const newQty = Math.max(0, currentQty + delta);
    if (newQty === 0) delete newOrderCart[productId];
    else newOrderCart[productId] = newQty;
    renderNewOrderProducts();
    updateNewOrderTotal();
};

function updateNewOrderTotal() {
    let total = 0, itemsCount = 0;
    for (const [id, qty] of Object.entries(newOrderCart)) {
        const prod = newOrderProducts.find(p => p.id === id);
        if (prod) { total += parseFloat(prod.price) * qty; itemsCount += qty; }
    }
    document.getElementById('newOrderTotal').innerText = `$${total.toFixed(2)}`;
    document.getElementById('btnNextStep').disabled = itemsCount === 0;
}

window.goToStep2 = () => {
    document.getElementById('step1Container').classList.add('hidden');
    document.getElementById('step2Container').classList.remove('hidden');
    document.getElementById('createOrderTitle').innerText = 'Nueva Orden - Paso 2/2';
    document.getElementById('createOrderSubtitle').innerText = 'Información del Cliente';
};

window.goToStep1 = () => {
    document.getElementById('step2Container').classList.add('hidden');
    document.getElementById('step1Container').classList.remove('hidden');
    document.getElementById('createOrderTitle').innerText = 'Nueva Orden - Paso 1/2';
    document.getElementById('createOrderSubtitle').innerText = 'Selección de Productos';
};

/* ==========================================
   2. NOTIFICACIONES ESTÉTICAS
   ========================================== */

function showNotification(message) {
    const toast = document.createElement('div');
    toast.className = "fixed bottom-5 right-5 bg-emerald-500 text-white px-6 py-3 rounded-2xl shadow-xl z-[9999] flex items-center gap-3 transition-all";
    toast.innerHTML = `<i class="fa-solid fa-check-circle"></i> <span class="font-bold text-sm">${message}</span>`;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
}

/* ==========================================
   3. SUBMIT A FIREBASE (Lógica Corregida)
   ========================================== */

window.submitNewOrder = async () => {
    const name = document.getElementById('newOrderCustomerName').value.trim();
    const phoneCode = document.getElementById('newOrderPhoneCode').value;
    const phoneNumber = document.getElementById('newOrderPhoneNumber').value.trim();
    const address = document.getElementById('newOrderAddress').value.trim();

    if (!name || !phoneNumber || !address || phoneNumber.length !== 7) {
        alert("Por favor, completa todos los campos correctamente.");
        return;
    }

    const user = auth.currentUser;
    if (!user) { alert("Sesión expirada."); return; }

    const btnSubmit = document.getElementById('btnSubmitNewOrder');
    btnSubmit.disabled = true;
    btnSubmit.innerHTML = '<i class="fa-solid fa-spinner animate-spin"></i> Creando...';

    try {
        const userDoc = await getDoc(doc(db, "users", user.uid));
        const userData = userDoc.data() || {};

        let items = [];
        let finalTotal = 0;
        for (const [id, qty] of Object.entries(newOrderCart)) {
            const prod = newOrderProducts.find(p => p.id === id);
            const price = parseFloat(prod.price);
            const subtotal = parseFloat((price * qty).toFixed(2));
            
            items.push({
                productId: prod.id,
                name: prod.name,
                price: parseFloat(price.toFixed(2)),
                quantity: qty,
                subtotal: subtotal
            });
            finalTotal += subtotal;
        }

        // --- SOLUCIÓN: FECHA LOCAL EXACTA ---
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const localDateString = `${year}-${month}-${day}`; // Formato YYYY-MM-DD
        
        const fullPhone = `${phoneCode}${phoneNumber}`;
        
        const newOrderData = {
            assignedAt: Timestamp.fromDate(now),
            assignedSeller: user.uid,
            assignedSellerEmail: userData.email || "N/A",
            assignedSellerName: userData.name || userData.fullName || "Vendedor",
            assignmentSource: "oncreate-fs",
            cartToken: 'ORD-' + Math.floor(100000 + Math.random() * 900000),
            contactedAt: now.toISOString(),
            customerData: {
                Customname: name,
                address: address,
                lat: "",
                lng: "",
                phone: fullPhone,
                readable_address: address
            },
            items: items,
            orderDate: localDateString, // Usamos la fecha calculada localmente
            status: "asignado",
            timestamp: Timestamp.fromDate(now),
            total: parseFloat(finalTotal.toFixed(2)),
            notificationsSent: {
                customer: { error: "send_failed" },
                seller: { error: "send_failed" }
            }
        };

        await addDoc(collection(db, "orders"), newOrderData);
        closeCreateOrderModal();
        showNotification("Orden creada con éxito.");

    } catch (error) {
        console.error(error);
        alert("Error al guardar la orden.");
    } finally {
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = '<i class="fa-solid fa-check"></i> Crear Orden Ahora';
    }
};