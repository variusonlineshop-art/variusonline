import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, query, onSnapshot, orderBy } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db = getFirestore(app);

let ventasHoy = [];
let mapInstance = null; // Para guardar la instancia del mapa

function listenVentasDia() {
    const q = query(collection(db, "orders"), orderBy("timestamp", "desc"));

    onSnapshot(q, (querySnapshot) => {
        const hoy = new Date().toLocaleDateString('en-CA'); 
        ventasHoy = [];
        let totalMonto = 0;

        querySnapshot.forEach((doc) => {
            const data = doc.data();
            let fechaOrden = "";
            if (data.timestamp?.toDate) {
                fechaOrden = data.timestamp.toDate().toLocaleDateString('en-CA');
            }

            // --- FILTRO APLICADO: Fecha de hoy Y Estatus "Pagado" ---
            if (fechaOrden === hoy && data.status === "Pagado") {
                ventasHoy.push({ id: doc.id, ...data });
                totalMonto += parseFloat(data.total || 0);
            }
        });

        actualizarCardVentas(totalMonto);
        
        // Refrescar modal si está abierto
        const modal = document.getElementById("modal-ventas-dia");
        if (modal && !modal.classList.contains("hidden")) {
            renderizarContenidoVentas();
        }
    });
}

function actualizarCardVentas(total) {
    const kpiValue = document.getElementById("kpi-ventas-dia-value");
    if (kpiValue) kpiValue.textContent = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(total);
}

// --- FUNCIONES DE MODALES ---

window.abrirModalVentasDia = function () {
    document.getElementById("modal-ventas-dia").classList.remove("hidden");
    document.getElementById("modal-ventas-dia").classList.add("flex");
    renderizarContenidoVentas();
};

window.cerrarModalVentasDia = function () {
    document.getElementById("modal-ventas-dia").classList.add("hidden");
    document.getElementById("modal-ventas-dia").classList.remove("flex");
};

// --- LÓGICA DE LEAFLET MAP ---

window.verMapaOrden = function (lat, lng, cliente) {
    if (!lat || !lng) return alert("Ubicación no disponible");

    const modalMapa = document.getElementById("modal-mapa-orden");
    modalMapa.classList.remove("hidden");
    modalMapa.classList.add("flex");

    // Timeout para esperar que el DOM se dibuje antes de iniciar Leaflet
    setTimeout(() => {
        if (mapInstance) {
            mapInstance.remove(); // Limpiar mapa anterior si existe
        }

        mapInstance = L.map('map-container').setView([lat, lng], 15);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap'
        }).addTo(mapInstance);

        L.marker([lat, lng]).addTo(mapInstance)
            .bindPopup(`<b>${cliente}</b><br>Ubicación de entrega`)
            .openPopup();
    }, 300);
};

window.cerrarModalMapa = function () {
    document.getElementById("modal-mapa-orden").classList.add("hidden");
    document.getElementById("modal-mapa-orden").classList.remove("flex");
};

function renderizarContenidoVentas() {
    const container = document.getElementById("modalVentasDiaBody");
    if (!container) return;

    let tablaHTML = ventasHoy.length > 0 ? `
        <div class="overflow-x-auto">
            <table class="w-full text-left">
                <thead class="bg-slate-50 text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                    <tr>
                        <th class="p-4 border-b">Orden / Estado</th>
                        <th class="p-4 border-b">Cliente / Vendedor</th>
                        <th class="p-4 border-b text-right">Total</th>
                        <th class="p-4 border-b text-center">Mapa</th>
                    </tr>
                </thead>
                <tbody class="text-sm">
                    ${ventasHoy.map(v => `
                        <tr class="hover:bg-slate-50 border-b border-gray-50">
                            <td class="p-4 font-bold text-gray-700">#${v.id.slice(-5).toUpperCase()}<br><span class="text-[9px] text-blue-500 uppercase">${v.status || 'Recibido'}</span></td>
                            <td class="p-4">
                                <div class="font-medium text-gray-800">${v.customerData?.Customname || 'N/A'}</div>
                                <div class="text-[10px] text-gray-400">${v.assignedSellerName || 'Sin vendedor'}</div>
                            </td>
                            <td class="p-4 text-right font-black text-gray-900">$${parseFloat(v.total).toFixed(2)}</td>
                            <td class="p-4 text-center">
                                <button onclick="verMapaOrden(${v.customerData?.lat}, ${v.customerData?.lng}, '${v.customerData?.Customname}')" 
                                    class="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 hover:bg-indigo-600 hover:text-white transition-all">
                                    <i class="fa-solid fa-map-location-dot"></i>
                                </button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    ` : `<div class="p-20 text-center text-gray-400">No hay ventas registradas hoy</div>`;

    container.innerHTML = `
        <div class="p-6 border-b border-gray-100 flex justify-between items-center bg-white rounded-t-[2rem]">
            <h2 class="text-xl font-black text-gray-800">Ventas del Día</h2>
            <button onclick="cerrarModalVentasDia()" class="text-gray-400 hover:text-red-500"><i class="fa-solid fa-xmark text-xl"></i></button>
        </div>
        <div class="max-h-[60vh] overflow-y-auto bg-white rounded-b-[2rem]">${tablaHTML}</div>
    `;
}

listenVentasDia();