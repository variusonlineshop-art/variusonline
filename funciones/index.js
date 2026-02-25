const functions = require('firebase-functions');
const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');

admin.initializeApp();
const db = admin.firestore();
const auth = admin.auth();

const app = express();
// Parse JSON bodies
app.use(express.json());

// Build allowed origins from Firebase config (functions config) or fallback list.
// To set at deploy time use:
// firebase functions:config:set app.allowed_origins="http://localhost:5500,http://localhost:3000,https://admin.yourdomain.com"
const rawAllowed = (() => {
  try {
    const cfg = functions.config && functions.config().app && functions.config().app.allowed_origins;
    if (cfg && typeof cfg === 'string' && cfg.trim().length) {
      return cfg.split(',').map(s => s.trim()).filter(Boolean);
    }
  } catch (e) {
    console.warn('Could not read functions.config().app.allowed_origins', e);
  }
  // Fallback conservative defaults (add your production domains here)
  return [
    'http://localhost:5500',
    'http://localhost:3000',
    'http://127.0.0.1:5500',
    'https://variusonline.com',
    'https://www.variusonline.com',
    // include the bare hostname to cover cases like "http://localhost" seen in dev servers
    'http://localhost',
    'http://127.0.0.1'
  ];
})();

// CORS options with dynamic origin check
const corsOptions = {
  origin: function (origin, callback) {
    // When origin is undefined (e.g., server-to-server call, Postman), allow by returning true.
    if (!origin) {
      return callback(null, true);
    }
    // Allow wildcard if explicitly set
    if (rawAllowed.includes('*')) {
      return callback(null, true);
    }
    // Exact match check
    if (rawAllowed.indexOf(origin) !== -1) {
      return callback(null, true);
    }

    // Allow any localhost / 127.0.0.1 origin regardless of port (helpful for dev).
    try {
      const host = (new URL(origin)).hostname;
      if (host === 'localhost' || host === '127.0.0.1') {
        return callback(null, true);
      }
      // Allow for network dev URLs like "192.168.x.x" if you want:
      // if (/^192\.168\.\d+\.\d+$/.test(host)) return callback(null, true);
    } catch (e) {
      // ignore URL parse errors
    }

    return callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  credentials: true,
  optionsSuccessStatus: 204
};

// Apply CORS middleware globally so preflight is handled
app.use((req, res, next) => {
  cors(corsOptions)(req, res, (err) => {
    if (err) {
      // If CORS error, respond with 403 to let the browser know
      console.warn('CORS denied for origin:', req.get('Origin'), err.message || err);
      res.status(403).json({ error: 'Origin not allowed' });
      return;
    }
    next();
  });
});

// Ensure explicit OPTIONS handling (helps some environments / proxies)
app.options('*', (req, res) => {
  // cors middleware will set the appropriate headers
  cors(corsOptions)(req, res, () => res.sendStatus(corsOptions.optionsSuccessStatus));
});

// Health check / simple root
app.get('/', (req, res) => {
  res.json({ ok: true, service: 'createUser' });
});

app.post('/', async (req, res) => {
  try {
    // Extract token from Authorization header
    const authHeader = req.get('Authorization') || '';
    const match = authHeader.match(/^Bearer (.+)$/);
    if (!match) return res.status(401).json({ error: 'No autorizado: falta token' });

    const idToken = match[1];

    // Verify token
    let decoded;
    try {
      decoded = await admin.auth().verifyIdToken(idToken);
    } catch (err) {
      console.error('Token verification failed', err);
      return res.status(401).json({ error: 'Token inválido' });
    }
    const requesterUid = decoded.uid;

    // Verify requester's role in Firestore (defense in depth)
    const requesterDocSnap = await db.collection('users').doc(requesterUid).get();
    if (!requesterDocSnap.exists || requesterDocSnap.data().role !== 'administrador') {
      return res.status(403).json({ error: 'Acceso denegado: se requiere rol administrador' });
    }

    // Extract and basic-validate payload
    const { email, password, name = '', phone = '', role = 'vendedor', status = 'Activo' } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Faltan campos obligatorios (email/password)' });
    }

    // Server-side email format check (lightweight)
    const EMAIL_RE = /^[A-Za-z0-9]+(?:[._%+-][A-Za-z0-9]+)*@[A-Za-z0-9-]+(?:\.[A-Za-z]{2,})+$/;
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Formato de correo inválido' });
    }

    // Check Firestore duplicates (case-insensitive via emailLower if you use it)
    // First try exact match, then try lowercase match if you store emailLower as well
    const qExact = await db.collection('users').where('email', '==', email).get();
    if (!qExact.empty) {
      return res.status(409).json({ error: 'El correo ya existe en Firestore' });
    }
    // If your DB uses emailLower, check that too:
    try {
      const qLower = await db.collection('users').where('emailLower', '==', email.toLowerCase()).get();
      if (!qLower.empty) {
        return res.status(409).json({ error: 'El correo ya existe en Firestore' });
      }
    } catch (e) {
      // ignore if emailLower not indexed/used
    }

    if (phone && phone.replace(/\D/g, '').length > 0) {
      const q2 = await db.collection('users').where('phone', '==', phone).get();
      if (!q2.empty) {
        return res.status(409).json({ error: 'El teléfono ya existe en Firestore' });
      }
    }

    // Create user in Firebase Auth (does not affect admin session)
    let createdUser;
    try {
      createdUser = await auth.createUser({
        email,
        password,
        displayName: name || undefined,
        // If phone is E.164 format (starts with +) you can set phoneNumber.
        // Otherwise, skip to avoid Auth validation errors.
        phoneNumber: phone && phone.startsWith('+') ? phone : undefined
      });
    } catch (err) {
      console.error('Error creating auth user', err);
      if (err.code === 'auth/email-already-exists') {
        return res.status(409).json({ error: 'El correo ya existe en Auth' });
      }
      return res.status(500).json({ error: 'Error creando usuario en Auth' });
    }

    // Write Firestore doc
    try {
      await db.collection('users').doc(createdUser.uid).set({
        name,
        email,
        emailLower: String(email).toLowerCase(),
        phone,
        role,
        status,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: requesterUid
      });
    } catch (err) {
      console.error('Error writing user doc', err);
      // rollback: delete created user in Auth for consistency
      try {
        await auth.deleteUser(createdUser.uid);
      } catch (e) {
        console.error('Rollback failed deleting user', e);
      }
      return res.status(500).json({ error: 'Error escribiendo usuario en Firestore' });
    }

    // Successful creation -- CORS headers already handled by middleware
    return res.status(201).json({ ok: true, uid: createdUser.uid });
  } catch (err) {
    console.error('Unhandled error in createUser endpoint', err);
    return res.status(500).json({ error: 'Error interno' });
  }
});

app.post('/updatePassword', async (req, res) => {
  try {
    const authHeader = req.get('Authorization') || '';
    const match = authHeader.match(/^Bearer (.+)$/);
    if (!match) return res.status(401).json({ error: 'No autorizado: falta token' });
    const idToken = match[1];
    let decoded;
    try {
      decoded = await auth.verifyIdToken(idToken);
    } catch (err) {
      console.warn('[updatePassword] Token inválido:', err);
      return res.status(401).json({ error: 'Token inválido' });
    }
    const requesterUid = decoded.uid;
    const requesterDocSnap = await db.collection('users').doc(requesterUid).get();
    if (!requesterDocSnap.exists || requesterDocSnap.data().role !== 'administrador') {
      console.warn('[updatePassword] Rol insuficiente:', requesterUid);
      return res.status(403).json({ error: 'Acceso denegado: se requiere rol administrador' });
    }
    const { uid, password } = req.body;
    if (!uid || !password) {
      console.warn('[updatePassword] Falta uid o password', req.body);
      return res.status(400).json({ error: 'Faltan parámetros (uid/password)' });
    }
    // Validación robusta de formato
    if (password.length < 6 || password.length > 8 ||
        !/[A-Z]/.test(password) ||
        !/[a-z]/.test(password) ||
        !/[0-9]/.test(password) ||
        !/[\W_]/.test(password)) {
      return res.status(400).json({ error: 'La contraseña debe tener 6-8 caracteres e incluir mayúscula, minúscula, número y carácter especial.' });
    }
    // NUEVO - LOG: Busca el usuario en Authentication
    try {
      const userRecord = await auth.getUser(uid);
      if (!userRecord) throw new Error('No existe usuario en Auth para UID: ' + uid);
      console.info('[updatePassword] Updating password for UID', uid, 'email:', userRecord.email);
    } catch (err) {
      console.error('[updatePassword] El usuario no existe en Firebase Auth:', uid, err.message);
      return res.status(404).json({ error: 'No existe un usuario con ese UID en Auth' });
    }
    // Actualizar password
    try {
      await auth.updateUser(uid, { password });
      console.info('[updatePassword] Password updated for UID', uid);
      return res.status(200).json({ ok: true, msg: 'Contraseña actualizada' });
    } catch (err) {
      console.error('[updatePassword] Error al actualizar contraseña:', err);
      return res.status(500).json({ error: 'Error actualizando contraseña: ' + (err.message || 'desconocido') });
    }
  } catch (err) {
    console.error('Error actualizando contraseña', err);
    return res.status(500).json({ error: 'Error interno actualizando contraseña' });
  }
});

// Export the Express app as a Cloud Function
exports.createUser = functions.https.onRequest(app);