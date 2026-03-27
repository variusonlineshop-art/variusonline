import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { 
    getFirestore, collection, getDocs, query, where, doc, getDoc 
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth();

let map;
let markersLayer;
let allOrders = []; // Cache local para filtrado rápido

function initMap() {
    map = L.map('delivery-map').setView([10.4806, -66.8983], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
    }).addTo(map);
    markersLayer = L.layerGroup().addTo(map);
}

// Función principal de renderizado (se usa para carga inicial y filtros)
function renderCustomerList(ordersToRender) {
    const listContainer = document.getElementById('customer-list');
    listContainer.innerHTML = "";
    markersLayer.clearLayers();
    const bounds = [];

    if (ordersToRender.length === 0) {
        listContainer.innerHTML = '<p class="text-xs text-center text-gray-400 py-10">No se encontraron clientes.</p>';
        return;
    }

    ordersToRender.forEach(order => {
        const lat = order.customerData?.lat || order.lat;
        const lng = order.customerData?.lng || order.lng;
        const name = order.customerData?.Customname || "Cliente Sin Nombre";
        const phone = order.customerData?.phone || order.phone || "Sin Teléfono";

        const card = document.createElement('div');
        card.className = "p-3 rounded-xl border border-gray-50 hover:border-blue-200 hover:bg-blue-50/50 cursor-pointer transition-all group animate-fade-in";
        card.innerHTML = `
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 group-hover:bg-blue-500 group-hover:text-white transition-colors">
                        <i class="fa-solid fa-user text-xs"></i>
                    </div>
                    <div class="overflow-hidden">
                        <p class="text-[11px] font-bold text-gray-800 truncate">${name}</p>
                        <p class="text-[10px] text-gray-500">${phone}</p>
                    </div>
                </div>
                <i class="fa-solid fa-chevron-right text-[10px] text-gray-300 group-hover:text-blue-500 pr-2"></i>
            </div>
        `;

        card.onclick = () => {
            if (lat && lng) {
                map.flyTo([lat, lng], 17);
                // En móviles, hacer scroll suave hacia el mapa al seleccionar
                if (window.innerWidth < 1024) {
                    document.getElementById('delivery-map').scrollIntoView({ behavior: 'smooth' });
                }
            }
        };

        listContainer.appendChild(card);

        if (lat && lng) {
            const marker = L.marker([lat, lng]).bindPopup(`
                <div class="p-1">
                    <p class="text-xs font-bold mb-1">${name}</p>
                    <p class="text-[10px] text-gray-600 mb-2"><i class="fa-solid fa-phone mr-1"></i>${phone}</p>
                    <a href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" 
                       class="block text-center bg-blue-500 text-white text-[9px] py-1 px-2 rounded-lg hover:bg-blue-600 transition-colors">
                       Ver en Google Maps
                    </a>
                </div>
            `);
            markersLayer.addLayer(marker);
            bounds.push([lat, lng]);
        }
    });

    if (bounds.length > 0) map.fitBounds(bounds, { padding: [30, 30] });
}

async function loadData() {
    let user = auth.currentUser;
    if (!user) await new Promise(res => auth.onAuthStateChanged(u => { user = u; res(); }));
    if (!user) return;

    const userDoc = await getDoc(doc(db, "users", user.uid));
    const role = (userDoc.data()?.role || '').toLowerCase();

    let q = collection(db, "orders");
    if (role === "motorizado") q = query(q, where("assignedMotorizedId", "==", user.uid));
    else if (role === "vendedor") q = query(q, where("assignedSeller", "==", user.uid));

    try {
        const snap = await getDocs(q);
        allOrders = [];
        snap.forEach(doc => allOrders.push({ id: doc.id, ...doc.data() }));
        renderCustomerList(allOrders);
    } catch (e) {
        console.error(e);
    }
}

// Lógica del Filtro de Búsqueda
document.getElementById('customer-search').addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    const filtered = allOrders.filter(order => {
        const name = (order.customerData?.Customname || "").toLowerCase();
        const phone = (order.customerData?.phone || order.phone || "").toLowerCase();
        return name.includes(term) || phone.includes(term);
    });
    renderCustomerList(filtered);
});

window.addEventListener('DOMContentLoaded', () => {
    initMap();
    loadData();
});
