import { firebaseConfig } from './firebase-config.js';
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import {
    getAuth,
    onAuthStateChanged,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    GoogleAuthProvider,
    signInWithPopup,
    sendPasswordResetEmail,
    signOut
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import {
    getFirestore,
    doc,
    getDoc,
    setDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

// Inicializa Firebase (solo si no está inicializado)
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

//console.log('Firebase app options:', app.options);

// Rutas por rol
const ROLE_ROUTES = {
    vendedor: 'admin/vendedor.html',
    motorizado: 'admin/motorizado.html',
    administrador: 'admin/administrador.html',
    gerente: 'admin/gerente.html'
};
function redirectByRole(role) {
    const route = ROLE_ROUTES[role] || ROLE_ROUTES['vendedor'];
    window.location.href = route;
}

/* --- Modal global (reemplaza alert) --- */
function getModalElements() {
    const modal = document.getElementById('app-modal');
    if (!modal) return null;
    return {
        modal,
        titleEl: document.getElementById('modal-title'),
        bodyEl: document.getElementById('modal-body'),
        okBtn: document.getElementById('modal-ok'),
        closeBtn: document.getElementById('modal-close')
    };
}

function showModal(message, title = 'Aviso') {
    const els = getModalElements();
    if (!els) {
        alert((title ? title + '\n\n' : '') + message);
        return;
    }

    els.titleEl.textContent = title;
    if (typeof message === 'string') {
        els.bodyEl.textContent = message;
    } else {
        els.bodyEl.innerHTML = '';
        els.bodyEl.appendChild(message);
    }

    // Quita clases que lo ocultan
    els.modal.setAttribute('aria-hidden', 'false');
    els.modal.classList.add('open');
    els.modal.classList.remove('opacity-0', 'pointer-events-none');

    function close() {
        els.modal.setAttribute('aria-hidden', 'true');
        els.modal.classList.remove('open');
        els.modal.classList.add('opacity-0', 'pointer-events-none');
        els.okBtn.removeEventListener('click', okHandler);
        els.closeBtn.removeEventListener('click', closeHandler);
        document.removeEventListener('keydown', escHandler);
    }
    function okHandler() { close(); }
    function closeHandler() { close(); }
    function escHandler(e) { if (e.key === 'Escape') close(); }

    els.okBtn.addEventListener('click', okHandler);
    els.closeBtn.addEventListener('click', closeHandler);
    document.addEventListener('keydown', escHandler);

    els.okBtn.focus();
}

/* --- Helper para logging de errores de Auth --- */
function handleAuthError(err, contextMessage = '') {
    // Mantener detalles en consola para debugging
    console.error('Auth error (full):', err);
    console.error('Auth error code:', err && err.code);
    console.error('Auth error message:', err && err.message);

    // Mensaje genérico para el usuario (no mostrar el texto crudo de Firebase)
    let userMessage = 'Ocurrió un error de autenticación.';

    if (err && err.code) {
        switch (err.code) {
            case 'auth/operation-not-allowed':
                userMessage = 'El método Email/Password no está permitido. Habilítalo en la consola de Firebase.';
                break;
            case 'auth/invalid-email':
                userMessage = 'El correo ingresado no tiene un formato válido.';
                break;
            case 'auth/email-already-in-use':
                userMessage = 'El correo ya está registrado.';
                break;
            case 'auth/weak-password':
                userMessage = 'La contraseña es muy débil. Usa al menos 8 caracteres.';
                break;
            case 'auth/popup-closed-by-user':
                userMessage = 'El inicio con Google fue cancelado por el usuario.';
                break;
            case 'auth/unauthorized-domain':
                userMessage = 'Dominio no autorizado para autenticación. Añade el dominio en la consola de Firebase.';
                break;
            case 'auth/wrong-password':
                userMessage = 'Contraseña incorrecta.';
                break;
            case 'auth/user-not-found':
                userMessage = 'No existe una cuenta con ese correo.';
                break;
            case 'auth/too-many-requests':
                userMessage = 'Se han detectado muchos intentos fallidos. Intenta más tarde.';
                break;
            default:
                userMessage = 'No se pudo completar la autenticación. Intenta de nuevo más tarde.';
                break;
        }
    }

    if (contextMessage) {
        userMessage = contextMessage + '\n\n' + userMessage;
    }

    showModal(userMessage, 'Error de autenticación');
}

/* --- Utilidades UI: toggles y validaciones inline --- */
function setupPasswordToggle(inputId, toggleBtnId) {
    const input = document.getElementById(inputId);
    const btn = document.getElementById(toggleBtnId);
    if (!input || !btn) return;
    btn.addEventListener('click', () => {
        const isPwd = input.type === 'password';
        input.type = isPwd ? 'text' : 'password';
        btn.textContent = isPwd ? '🙈' : '👁️';
        btn.setAttribute('aria-pressed', String(!isPwd));
    });
}

function setInputAlert(elId, message) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.textContent = message || '';
}

/* --- Validación en registro: requisitos de contraseña --- */
function setupRegisterPasswordRequirements() {
    const pwd = document.getElementById('reg-password');
    if (!pwd) return;

    const reqs = {
        length: document.getElementById('req-length'),
        upper: document.getElementById('req-upper'),
        lower: document.getElementById('req-lower'),
        number: document.getElementById('req-number')
    };

    function updateRequirements(value) {
        const okLength = value.length >= 8;
        const okUpper = /[A-Z]/.test(value);
        const okLower = /[a-z]/.test(value);
        const okNumber = /[0-9]/.test(value);

        reqs.length.classList.toggle('met', okLength);
        reqs.upper.classList.toggle('met', okUpper);
        reqs.lower.classList.toggle('met', okLower);
        reqs.number.classList.toggle('met', okNumber);

        // Mensaje general corto de ayuda si falta algo
        const missing = [];
        if (!okLength) missing.push('8 caracteres');
        if (!okUpper) missing.push('mayúscula');
        if (!okLower) missing.push('minúscula');
        if (!okNumber) missing.push('número');

        setInputAlert('reg-password-alert', missing.length ? `Faltan: ${missing.join(', ')}` : '');
        return okLength && okUpper && okLower && okNumber;
    }

    pwd.addEventListener('input', (e) => updateRequirements(e.target.value));
}

/* --- manejo de formularios --- */
const loginForm = document.getElementById('login-form');
if (loginForm) {
    // Setup UI helpers for login page
    setupPasswordToggle('login-password', 'login-toggle-password');

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const emailEl = document.getElementById('login-email');
        const pwdEl = document.getElementById('login-password');
        const email = emailEl ? emailEl.value.trim() : '';
        const password = pwdEl ? pwdEl.value : '';

        setInputAlert('login-email-alert', '');
        setInputAlert('login-password-alert', '');

        // Validaciones previas
        if (!email) {
            setInputAlert('login-email-alert', 'Ingresa tu correo.');
            showModal('Por favor ingresa tu correo para continuar.', 'Campo Requerido');
            return;
        }
        if (!password) {
            setInputAlert('login-password-alert', 'Ingresa tu contraseña.');
            showModal('Por favor ingresa tu contraseña.', 'Campo Requerido');
            return;
        }

        try {
            const cred = await signInWithEmailAndPassword(auth, email, password);
            const uid = cred.user.uid;
            try {
                const userDoc = await getDoc(doc(db, 'users', uid));
                const userRole = (userDoc.exists() && userDoc.data().role) || 'vendedor';
                showModal('¡Bienvenido! Sesión iniciada correctamente.', 'Éxito');
                setTimeout(() => redirectByRole(userRole), 950);
            } catch (errInner) {
                console.error('Error obteniendo/creando user doc tras login:', errInner);
                showModal('¡Bienvenido! Sesión iniciada correctamente.', 'Éxito');
                setTimeout(() => redirectByRole('vendedor'), 950);
            }
        } catch (err) {
            // Mostramos SIEMPRE modal de error
            if (err && err.code) {
                switch (err.code) {
                    case 'auth/wrong-password':
                        setInputAlert('login-password-alert', 'Contraseña incorrecta.');
                        showModal('La contraseña es incorrecta. Vuelve a intentarlo.', 'Error de autenticación');
                        return;
                    case 'auth/user-not-found':
                        setInputAlert('login-email-alert', 'No existe una cuenta con ese correo.');
                        showModal('El correo electrónico no está registrado.', 'Error de autenticación');
                        return;
                    case 'auth/invalid-email':
                        setInputAlert('login-email-alert', 'El correo ingresado no tiene un formato válido.');
                        showModal('El correo ingresado no tiene un formato válido.', 'Error de autenticación');
                        return;
                    case 'auth/too-many-requests':
                        showModal('Se han realizado demasiados intentos fallidos. Intenta más tarde.', 'Cuenta Bloqueada');
                        return;
                    default:
                        handleAuthError(err, 'No se pudo iniciar sesión.');
                        return;
                }
            } else {
                handleAuthError(err, 'No se pudo iniciar sesión.');
            }
        }
    });
}

const registerForm = document.getElementById('register-form');
if (registerForm) {
    // Setup UI helpers for register page
    setupPasswordToggle('reg-password', 'reg-toggle-password');
    setupRegisterPasswordRequirements();

    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const emailEl = document.getElementById('reg-email');
        const pwdEl = document.getElementById('reg-password');
        const roleEl = document.getElementById('reg-role');

        const email = emailEl ? emailEl.value.trim() : '';
        const password = pwdEl ? pwdEl.value : '';
        const role = roleEl ? roleEl.value || 'vendedor' : 'vendedor';

        setInputAlert('reg-email-alert', '');
        setInputAlert('reg-password-alert', '');

        if (!email) {
            setInputAlert('reg-email-alert', 'Por favor completa el correo.');
            return;
        }
        if (!password) {
            setInputAlert('reg-password-alert', 'Por favor completa la contraseña.');
            return;
        }
        if (password.length < 8) {
            setInputAlert('reg-password-alert', 'La contraseña debe tener al menos 8 caracteres.');
            return;
        }
        // Requisitos (misma lógica que en UI)
        const hasUpper = /[A-Z]/.test(password);
        const hasLower = /[a-z]/.test(password);
        const hasNumber = /[0-9]/.test(password);
        if (!(hasUpper && hasLower && hasNumber)) {
            setInputAlert('reg-password-alert', 'La contraseña debe contener mayúsculas, minúsculas y números.');
            return;
        }

        try {
            const cred = await createUserWithEmailAndPassword(auth, email, password);
            const uid = cred.user.uid;
            await setDoc(doc(db, 'users', uid), {
                email: cred.user.email,
                role,
                createdAt: serverTimestamp()
            });
            showModal('Cuenta creada correctamente. Redirigiendo...', 'Éxito');
            setTimeout(() => redirectByRole(role), 900);
        } catch (err) {
            handleAuthError(err, 'No se pudo crear la cuenta.');
        }
    });
}

/* --- Google sign-in (funciona tanto en login como en register si existe el botón) --- */
const googleBtn = document.getElementById('google-signin');
if (googleBtn) {
    googleBtn.addEventListener('click', async () => {
        const provider = new GoogleAuthProvider();
        try {
            const result = await signInWithPopup(auth, provider);
            const user = result.user;
            const userRef = doc(db, 'users', user.uid);
            const userSnap = await getDoc(userRef);
            if (!userSnap.exists()) {
                await setDoc(userRef, {
                    email: user.email,
                    role: 'vendedor',
                    createdAt: serverTimestamp()
                });
                showModal('Inicio con Google correcto. Redirigiendo...', 'Éxito');
                setTimeout(() => redirectByRole('vendedor'), 900);
            } else {
                showModal('Inicio con Google correcto. Redirigiendo...', 'Éxito');
                setTimeout(() => redirectByRole(userSnap.data().role), 900);
            }
        } catch (err) {
            // No mostrar modal intrusivo si el usuario cerró el popup intencionalmente
            if (err && err.code === 'auth/popup-closed-by-user') {
                console.log('Usuario cerró el popup de Google.');
                return;
            }
            handleAuthError(err, 'Error al iniciar con Google.');
        }
    });
}

/* --- Reset password --- */
const resetLink = document.getElementById('reset-password');
if (resetLink) {
    resetLink.addEventListener('click', async (e) => {
        e.preventDefault();
        const emailEl = document.getElementById('login-email') || document.getElementById('reg-email');
        const email = emailEl ? emailEl.value.trim() : '';
        if (!email) {
            showModal('Ingresa tu correo en el campo correo para recibir el enlace.', 'Atención');
            return;
        }
        try {
            await sendPasswordResetEmail(auth, email);
            showModal('Se ha enviado un correo para restablecer la contraseña.', 'Revisa tu correo');
        } catch (err) {
            handleAuthError(err, 'No se pudo solicitar restablecimiento de contraseña.');
        }
    });
}

/* --- Link a registro (por si se usa desde UI diferente) --- */
const goRegisterBtn = document.getElementById('go-register');
if (goRegisterBtn) {
    goRegisterBtn.addEventListener('click', () => {
        window.location.href = 'register.html';
    });
}

/* --- Observador de estado de autenticación --- */
onAuthStateChanged(auth, async (user) => {
    const onAuthPages = ['/index.html', '/', '/index.html', '/login.html'];
    if (!user) {
        if (window.location.pathname.startsWith('/admin')) {
            window.location.href = '/index.html';
        }
        return;
    }
    if (onAuthPages.includes(window.location.pathname)) {
        try {
            const userDoc = await getDoc(doc(db, 'users', user.uid));
            if (userDoc.exists()) {
                redirectByRole(userDoc.data().role);
            } else {
                await setDoc(doc(db, 'users', user.uid), {
                    email: user.email,
                    role: 'vendedor',
                    createdAt: serverTimestamp()
                });
                redirectByRole('vendedor');
            }
        } catch (err) {
            console.error('Error revisando documento de usuario en onAuthStateChanged:', err);
        }
    }
});

/* --- Export logout para usar desde páginas admin --- */
export async function logout() {
    await signOut(auth);
    window.location.href = '../index.html';
}
