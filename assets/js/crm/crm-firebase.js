// Componente de Conexión y Consultas Firebase
import { firebaseConfig } from '../firebase-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
    getFirestore,
    collection,
    query,
    where,
    onSnapshot
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

/**
 * Escucha en tiempo real las órdenes con estado Contactado o Postergado
 * @param {Function} callback - Función que recibe el array de clientes filtrados
 */
export function listenCrmOrders(callback) {
    const ordersRef = collection(db, "orders");

    // Solo estados Contactado/Postergado, case-insensitive
    const q = query(
        ordersRef,
        where("status", "in", ["Contactado", "Postergado", "Pagado", "contactado", "postergado", "pagado"])
    );

    return onSnapshot(q, (querySnapshot) => {
        const uniqueCustomers = [];
        const seenPhones = new Set();

        if (querySnapshot.empty) {
            console.warn("⚠️ No se encontraron documentos con los estados requeridos.");
            callback([]);
            return;
        }

        querySnapshot.forEach((doc) => {
            const data = doc.data();

            // Extracción correcta desde customerData
            const phone = data.customerData?.phone || "";
            const name = data.customerData?.Customname || "Cliente sin Nombre";
            const email = data.customerData?.email || "";
            const date = data.orderDate || data.date || data.fecha || "Reciente";
            const total = typeof data.total === "number" ? data.total : (parseFloat(data.total) || data.monto || 0);
            // Vendedor
            const vendedor = data.assignedSellerName || "";

            if (phone) {
                const cleanPhone = String(phone).replace(/\s+/g, '');
                if (!seenPhones.has(cleanPhone)) {
                    seenPhones.add(cleanPhone);

                    const formattedPhone = String(phone).startsWith('+') ? phone : `+${phone}`;
                    const currentStatus = typeof data.status === "string"
                        ? data.status.charAt(0).toUpperCase() + data.status.slice(1).toLowerCase()
                        : "";

                    uniqueCustomers.push({
                        id: doc.id,
                        items: data.items || [],
                        paymentUpdatedAt: data.paymentUpdatedAt || "", // <--- sumar esto
                        nombre: name,
                        telefono: formattedPhone,
                        email: email,
                        altEmail: "",
                        ultVenta: date,
                        montoTotal: parseFloat(total),
                        status: currentStatus,
                        ultimaInteraccion: `Orden asociada: ${doc.id}`,
                        vendedor: vendedor
                    });
                }
            }
        });

        callback(uniqueCustomers);
    }, (error) => {
        console.error("🔴 Error en Firebase CRM:", error);
    });
}
