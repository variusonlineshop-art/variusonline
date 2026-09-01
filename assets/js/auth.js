// assets/js/auth.js
import { firebaseConfig } from './firebase-config.js';
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import {
    getAuth,
    onAuthStateChanged,
    signInWithEmailAndPassword,
    setPersistence,
    browserSessionPersistence,
    connectAuthEmulator,
    signOut
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";
import {
    getFirestore,
    doc,
    getDoc,
    connectFirestoreEmulator
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

export const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

setPersistence(auth, browserSessionPersistence).catch((e) => console.error(e));

export async function loginAdmin(email, password) {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    return userCredential.user;
}

// GUARDIÁN CENTRAL DE RUTAS
onAuthStateChanged(auth, async (user) => {
    const path = window.location.pathname.toLowerCase();
    
    if (user) {
        if (user.email === "moto3@gmail.com") {
            sessionStorage.setItem('user_role', 'motorizado');
            sessionStorage.setItem('motorizado_nombre', 'Luis Prada');
        }

        // Si está logueado y flota en páginas raíz o login, enviarlo a su dashboard legítimo
        if (path.includes('login.html') || path === '/' || path.endsWith('/') || path.includes('index.html') || path.includes('catalogo.html')) {
            const savedRole = sessionStorage.getItem('user_role') || 'administrador';
            console.log(`➡️ Usuario autenticado intentando ver raíz/login/catálogo. Redirigiendo a rol: ${savedRole}`);
            
            if (savedRole === 'motorizado' || savedRole === 'repartidor') {
                window.location.replace('/admin/motorizado.html');
            } else if (savedRole === 'vendedor') {
                window.location.replace('/admin/vendedor.html');
            } else {
                window.location.replace('/admin/administrador.html');
            }
            return;
        }

        // CONTROL DE INTRUSIÓN (Filtro estricto dentro de la carpeta /admin/)
        const currentRole = sessionStorage.getItem('user_role');
        if (currentRole === 'motorizado' || currentRole === 'repartidor') {
            if (!path.includes('motorizado.html') && path.includes('/admin/')) {
                console.warn("🚫 Acceso denegado. Un motorizado no puede ver paneles administrativos.");
                window.location.replace('/admin/motorizado.html');
            }
        } else if (currentRole === 'vendedor') {
            if (!path.includes('vendedor.html') && path.includes('/admin/')) {
                window.location.replace('/admin/vendedor.html');
            }
        }
    } else {
        // Si NO está autenticado y quiere forzar entrada a /admin/
        if (path.includes('/admin/')) {
            console.warn("🔒 Intento de acceso anónimo. Expulsando al login.");
            sessionStorage.clear();
            window.location.replace('/login.html');
        }
    }
});

export async function logout() {
    try {
        await signOut(auth);
        sessionStorage.clear();
        window.location.replace("/login.html");
    } catch (e) {
        console.error(e);
    }
}
