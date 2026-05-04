import { initializeApp } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-app.js";
import { getFirestore, collection, query, orderBy, limit, onSnapshot } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let allVisits = []; 
let paginaActual = 1;
const registrosPorPagina = 5;

// --- Escucha de datos en tiempo real (Solo Hoy) ---
function listenGlobalVisits() {
    const q = query(collection(db, "visits"), orderBy("fecha_registro", "desc"));
    
    onSnapshot(q, (querySnapshot) => {
        // 1. Obtener la fecha de hoy en formato YYYY-MM-DD
        const hoy = new Date().toISOString().split('T')[0];
        
        allVisits = [];
        
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            // 2. Extraer solo la parte de la fecha del string ISO de la DB
            const fechaVisita = data.fecha_registro ? data.fecha_registro.split('T')[0] : "";
            
            // 3. Filtrar: solo si la fecha coincide con hoy
            if (fechaVisita === hoy) {
                allVisits.push({ id: doc.id, ...data });
            }
        });
        
        // Actualizar el número (KPI)
        const kpiElement = document.getElementById("kpi-visitas-carrito-value");
        if (kpiElement) kpiElement.textContent = allVisits.length;
        
        // --- ACTUALIZACIÓN DE LA BARRA ---
        const progressBar = document.getElementById("kpi-visitas-bar");
        if (progressBar) {
            // Meta diaria de visitas (ajusta este valor según tu tráfico)
            const metaDiaria = 500; 
            const porcentaje = Math.min((allVisits.length / metaDiaria) * 100, 100);
            progressBar.style.width = `${porcentaje}%`;
        }
        
        const modal = document.getElementById("modal-visitas-carrito");
        if (modal && !modal.classList.contains("hidden")) {
            renderizarEstructuraModal();
        }
    });
}

function abrirModalVisitasCarrito() {
    paginaActual = 1;
    renderizarEstructuraModal();
    document.getElementById("modal-visitas-carrito").classList.remove("hidden");
}

function renderizarEstructuraModal() {
    const totalRegistros = allVisits.length;
    const unicas = [...new Set(allVisits.map(v => v.ip).filter(Boolean))].length;
    const activas = allVisits.filter(v => v.online).length;
    const totalPaginas = Math.ceil(totalRegistros / registrosPorPagina) || 1;

    let html = `
    <div class="p-5 bg-slate-50 font-sans">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div class="bg-white p-4 rounded-xl border-l-4 border-emerald-500 shadow-sm">
                <p class="text-[10px] font-bold text-slate-400 uppercase">Total</p>
                <h3 class="text-2xl font-black text-slate-800">${totalRegistros}</h3>
            </div>
            <div class="bg-white p-4 rounded-xl border-l-4 border-blue-500 shadow-sm">
                <p class="text-[10px] font-bold text-slate-400 uppercase">Únicas</p>
                <h3 class="text-2xl font-black text-slate-800">${unicas}</h3>
            </div>
            <div class="bg-white p-4 rounded-xl border-l-4 border-amber-500 shadow-sm">
                <p class="text-[10px] font-bold text-slate-400 uppercase">Online</p>
                <h3 class="text-2xl font-black text-slate-800">${activas}</h3>
            </div>
            <div class="bg-white p-4 rounded-xl border-l-4 border-rose-500 shadow-sm">
                <p class="text-[10px] font-bold text-slate-400 uppercase">Páginas</p>
                <h3 class="text-2xl font-black text-slate-800">${totalPaginas}</h3>
            </div>
        </div>

        <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-6">
            <div id="tabla-dinamica-container">
                ${renderizarTablaPaginada()}
            </div>
        </div>

        <div class="flex flex-col sm:flex-row gap-3 border-t border-slate-200 pt-6">
            <button onclick="window.location.href='visits.html'" 
                    class="flex-1 bg-emerald-600 text-white py-2.5 rounded-lg font-bold text-sm hover:bg-emerald-700 transition-all flex items-center justify-center gap-2">
                <i class="fa-solid fa-chart-line"></i> Ver más detalles
            </button>
            <button onclick="cerrarModalVisitas()" 
                    class="flex-1 bg-slate-200 text-slate-700 py-2.5 rounded-lg font-bold text-sm hover:bg-slate-300 transition-all">
                Cerrar
            </button>
        </div>
    </div>
    `;

    document.getElementById("modalVisitasCarritoBody").innerHTML = html;
}

function renderizarTablaPaginada() {
    const inicio = (paginaActual - 1) * registrosPorPagina;
    const fin = inicio + registrosPorPagina;
    const visitasPaginadas = allVisits.slice(inicio, fin);
    const totalPaginas = Math.ceil(allVisits.length / registrosPorPagina) || 1;

    return `
        <table class="w-full text-left text-xs">
            <thead class="bg-slate-50 border-b border-slate-100 text-slate-600">
                <tr>
                    <th class="p-4 font-bold uppercase tracking-tighter">Usuario / IP</th>
                    <th class="p-4 font-bold uppercase tracking-tighter text-center">Estado</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
                ${visitasPaginadas.map(v => `
                    <tr class="hover:bg-slate-50">
                        <td class="p-4">
                            <div class="font-bold text-slate-700">${v.ip || '0.0.0.0'}</div>
                            <div class="text-[10px] text-slate-400 truncate max-w-[200px]">${v.url_pagina?.split('/').pop() || 'index.html'}</div>
                        </td>
                        <td class="p-4 text-center">
                            <span class="px-2.5 py-1 rounded-full text-[9px] font-black ${v.online ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}">
                                ${v.online ? 'ONLINE' : 'OFF'}
                            </span>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
        <div class="p-4 bg-slate-50 border-t border-slate-100 flex justify-between items-center">
            <div class="flex gap-2">
                <button onclick="cambiarPaginaModal(-1)" ${paginaActual === 1 ? 'disabled' : ''} 
                        class="px-3 py-1.5 bg-white border border-slate-200 rounded text-[10px] font-bold hover:bg-slate-100 disabled:opacity-30">
                    Anterior
                </button>
                <button onclick="cambiarPaginaModal(1)" ${paginaActual === totalPaginas ? 'disabled' : ''} 
                        class="px-3 py-1.5 bg-white border border-slate-200 rounded text-[10px] font-bold hover:bg-slate-100 disabled:opacity-30">
                    Siguiente
                </button>
            </div>
            <span class="text-[10px] font-bold text-slate-400 uppercase">Pág. ${paginaActual} / ${totalPaginas}</span>
        </div>
    `;
}

// --- Funciones Globales (Disponibles para onclick) ---
window.cambiarPaginaModal = (direccion) => {
    paginaActual += direccion;
    const container = document.getElementById("tabla-dinamica-container");
    if (container) container.innerHTML = renderizarTablaPaginada();
};

window.cerrarModalVisitas = () => {
    document.getElementById("modal-visitas-carrito").classList.add("hidden");
};

window.abrirModalVisitasCarrito = abrirModalVisitasCarrito;

// --- Inicialización ---
document.addEventListener("DOMContentLoaded", () => {
    listenGlobalVisits();
    
    // Vincular el botón de la X (arriba a la derecha)
    const btnX = document.getElementById("closeModalVisitasCarrito");
    if (btnX) btnX.onclick = window.cerrarModalVisitas;
});
