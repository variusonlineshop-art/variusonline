import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

// Inicialización limpia compartida
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db = getFirestore(app);

// Extrae los parámetros UTM de la URL
function getUTMParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    utm_source: params.get("utm_source") || "directo",
    utm_medium: params.get("utm_medium") || "ninguno",
    utm_campaign: params.get("utm_campaign") || "organica",
    utm_term: params.get("utm_term") || "N/A",
    utm_content: params.get("utm_content") || "N/A"
  };
}

async function getIP() {
  try {
    const res = await fetch('https://api.ipify.org?format=json');
    const data = await res.json();
    return data.ip || "desconocida";
  } catch (e) {
    return "desconocida";
  }
}

function getUserInfo() {
  // 🌟 CONTROL DE SEGURIDAD INTERNO: Evaluamos explícitamente navigator.deviceMemory
  const deviceMemoryRaw = navigator.deviceMemory;
  const memorySanitizada = (deviceMemoryRaw !== undefined && deviceMemoryRaw !== null) ? deviceMemoryRaw : "N/A";

  let info = {
    nombre: "N/A",
    navegador: navigator.userAgent || "Desconocido",
    idioma: navigator.language || "es",
    idiomas_preferidos: navigator.languages ? navigator.languages.join(', ') : '',
    plataforma: navigator.platform || "Desconocida",
    cookies: navigator.cookieEnabled || false,
    memoria_dispositivo: memorySanitizada, // 🟩 100% libre de undefined
    online: navigator.onLine || false,
    referrer: document.referrer || '',
    url_pagina: location.href,
    zona_horaria: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    hora_local: new Date().toLocaleString(),
    screen: {
      width: window.screen.width || 0,
      height: window.screen.height || 0,
      colorDepth: window.screen.colorDepth || 0,
      pixelRatio: window.devicePixelRatio || 1
    },
    soporte_tactil: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
    fecha_registro: new Date().toISOString()
  };

  // Agregar parámetros UTM
  Object.assign(info, getUTMParams());

  return info;
}

async function registrarVisita() {
  try {
    const info = getUserInfo();
    info.ip = await getIP();

    // Enviamos el documento limpio de datos huérfanos
    await addDoc(collection(db, "visits"), info);
    console.log("Visita registrada con éxito:", info);
  } catch (err) {
    console.warn("⚠️ Aviso pasivo en registro de visita:", err);
  }
}

// Retraso pasivo de pits para no saturar el canal de arranque del sistema principal
setTimeout(() => {
  registrarVisita();
}, 200);
