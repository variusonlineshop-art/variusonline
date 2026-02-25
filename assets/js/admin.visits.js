import { initializeApp } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-app.js";
import { getFirestore, collection, query, orderBy, limit, onSnapshot } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Detectar navegador amigable
function detectarNavegador(userAgent = '') {
    userAgent = userAgent.toLowerCase();
    if (userAgent.includes("edg")) return "Edge";
    if (userAgent.includes("chrome")) return "Chrome";
    if (userAgent.includes("firefox")) return "Firefox";
    if (userAgent.includes("safari")) return "Safari";
    if (userAgent.includes("opera") || userAgent.includes("opr")) return "Opera";
    return "Otro";
}

// Elegir fuente/fuente-icono entre utm y navegador amigable
function fuenteYIcono(visit) {
    const utm = (visit.utm_source || "").toLowerCase();
    if (utm) {
        if (utm === "instagram")
            return { fuente: 'Instagram', icono: 'fa-brands fa-instagram text-rose-500' };
        if (utm === "google")
            return { fuente: 'Google', icono: 'fa-brands fa-google text-blue-500' };
        if (utm === "facebook")
            return { fuente: 'Facebook', icono: 'fa-brands fa-facebook text-blue-600' };
        if (utm === "directo" || utm === "direct")
            return { fuente: 'Directo', icono: 'fa-solid fa-link text-slate-400' };
        return { fuente: visit.utm_source, icono: 'fa-solid fa-bullhorn text-slate-400' };
    }
    // Si no hay utm_source, mostrar navegador
    const navegador = detectarNavegador(visit.navegador || "");
    let icono = 'fa-solid fa-window-maximize text-slate-400';
    if (navegador === "Chrome") icono = 'fa-brands fa-chrome text-lime-600';
    else if (navegador === "Firefox") icono = 'fa-brands fa-firefox text-orange-400';
    else if (navegador === "Safari") icono = 'fa-brands fa-safari text-blue-400';
    else if (navegador === "Edge") icono = 'fa-brands fa-edge text-blue-700';
    else if (navegador === "Opera") icono = 'fa-brands fa-opera text-red-600';
    return { fuente: navegador, icono };
}

// Detectar dispositivo por userAgent
function getDispositivo(userAgent, width) {
    if (/mobile/i.test(userAgent)) return "Mobile";
    if (/tablet|ipad/i.test(userAgent)) return "Tablet";
    return width < 768 ? "Mobile" : "Desktop";
}

// Tiempo relativo simple
function tiempoTranscurrido(fechaISO) {
    const fecha = new Date(fechaISO);
    const ahora = new Date();
    const diffMs = ahora - fecha;
    const min = Math.floor(diffMs / 60000);
    if (min < 1) return "Ahora";
    if (min === 1) return "Hace 1 min";
    if (min < 60) return `Hace ${min} min`;
    const hrs = Math.floor(min / 60);
    if (hrs < 24) return `Hace ${hrs} h`;
    const dias = Math.floor(hrs / 24);
    return `Hace ${dias}d`;
}

// Renderizar tabla de visitas
function renderTable(visitsData) {
    const tbody = document.getElementById('visits-table-body');
    tbody.innerHTML = '';

    visitsData.forEach((visit, index) => {
        const ip = visit.ip || "N/A";
        const url = visit.url_pagina || "";
        const zona = visit.zona_horaria || "-";
        const { fuente, icono } = fuenteYIcono(visit);
        const dispositivo = getDispositivo(visit.navegador || '', visit?.screen?.width || 1024);
        const tiempo = tiempoTranscurrido(visit.fecha_registro);
        const statusClass = visit.online
            ? 'bg-emerald-50 text-emerald-600'
            : 'bg-slate-100 text-slate-400';

        const row = document.createElement('tr');
        row.className = "hover:bg-slate-50/80 transition-colors";
        row.innerHTML = `
            <td class="px-6 py-4">
                <div class="flex flex-col">
                    <span class="font-mono font-semibold text-slate-700">${ip}</span>
                    <span class="text-xs text-slate-400 break-words whitespace-normal" style="max-width:200px">${url}</span>
                </div>
            </td>
            <td class="px-6 py-4 text-sm text-slate-600">${zona}</td>
            <td class="px-6 py-4">
                <div class="flex items-center gap-2">
                    <i class="${icono}"></i>
                    <span class="text-sm">${fuente}</span>
                </div>
            </td>
            <td class="px-6 py-4 text-sm text-slate-600">${dispositivo}</td>
            <td class="px-6 py-4 text-sm text-slate-600">${visit.ubicacion || '-'}</td>
            <td class="px-6 py-4 text-sm text-slate-400">${tiempo}</td>
            <td class="px-6 py-4">
                <span class="px-2 py-1 rounded-md text-[10px] font-bold ${statusClass}">${visit.online ? 'ACTIVO':'INACTIVO'}</span>
            </td>
        `;
        tbody.appendChild(row);
    });
    document.getElementById('count-rows').innerText = visitsData.length;
    document.getElementById('total-rows').innerText = visitsData.length;
}

// Renderizar KPIs de tablero
function renderKpis(visitsData) {
    // Total visitas
    document.getElementById('total-visits').innerText = visitsData.length.toLocaleString();

    // Sesiones RRSS: visitas con utm_source Instagram o Facebook
    const rrss = visitsData.filter(v =>
        (v.utm_source || '').toLowerCase() === "instagram" ||
        (v.utm_source || '').toLowerCase() === "facebook"
    ).length;
    document.querySelectorAll('.fa-instagram').forEach(e =>
        e.closest('.bg-white').querySelector('h3').innerText = rrss.toLocaleString()
    );

    // Tiempo promedio (en minutos y segundos, desde el registro)
    let suma = 0, cuenta = 0;
    const ahora = new Date();
    for (let v of visitsData) {
        if (v.fecha_registro) {
            suma += (ahora - new Date(v.fecha_registro));
            cuenta++;
        }
    }
    const tiempoPromedioMin = cuenta ? (suma / cuenta / 60000) : 0;
    document.querySelectorAll('.fa-clock').forEach(e =>
        e.closest('.bg-white').querySelector('h3').innerText =
            `${Math.floor(tiempoPromedioMin)}m ${Math.floor((tiempoPromedioMin % 1) * 60)}s`
    );

    // Tasa de rebote: % de IPs únicas con solo una visita
    let uniqueIPs = new Set(visitsData.filter(v => v.ip).map(v => v.ip));
    let tasaRebote = 0;
    if (uniqueIPs.size) {
        const rebotadores = [...uniqueIPs].filter(ip =>
            visitsData.filter(v => v.ip === ip).length === 1
        ).length;
        tasaRebote = (rebotadores / uniqueIPs.size) * 100;
    }
    document.querySelectorAll('.fa-paper-plane').forEach(e =>
        e.closest('.bg-white').querySelector('h3').innerText = `${tasaRebote.toFixed(1)}%`
    );
}

// Escuchar y mostrar visitas en tiempo real desde Firestore
function listenVisits() {
    const q = query(collection(db, "visits"), orderBy("fecha_registro", "desc"), limit(100));
    onSnapshot(q, (querySnapshot) => {
        const visitsData = [];
        querySnapshot.forEach((doc) => visitsData.push(doc.data()));
        renderTable(visitsData);
        renderKpis(visitsData);
    });
}

document.addEventListener('DOMContentLoaded', listenVisits);