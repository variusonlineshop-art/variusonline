// order-notifications.js

function formatTimeDiff(diffMs) {
    const min = 60 * 1000, hour = 60 * min, day = 24 * hour;
    if (diffMs >= day) {
        const days = Math.floor(diffMs / day);
        return `Le quedan <b>${days}</b> día${days === 1 ? '' : 's'}`;
    }
    if (diffMs >= hour) {
        const hours = Math.floor(diffMs / hour);
        return `Le quedan <b>${hours}</b> hora${hours === 1 ? '' : 's'}`;
    }
    if (diffMs >= min) {
        const mins = Math.floor(diffMs / min);
        return `Le quedan <b>${mins}</b> minuto${mins === 1 ? '' : 's'}`;
    }
    return "Está por activarse.";
}

function parseNextSchedule(nextSchedule) {
    // Espera nextSchedule = "YYYY-MM-DD HH:MM"
    if (!nextSchedule) return null;
    const [date, time] = nextSchedule.split(' ');
    if (!date || !time) return null;
    return new Date(`${date}T${time}:00`);
}

function showOrderSideAlert(message, type = "info") {
    let panel = document.getElementById("sideAlertsPanel");
    if (!panel) {
        panel = document.createElement("div");
        panel.id = "sideAlertsPanel";
        panel.style.position = "fixed";
        panel.style.right = "35px";
        panel.style.bottom = "35px";
        panel.style.zIndex = 2000;
        panel.style.maxWidth = "320px";
        panel.style.display = "flex";
        panel.style.flexDirection = "column";
        document.body.appendChild(panel);
    }
    const toast = document.createElement("div");
    toast.className = `mb-2 px-5 py-3 rounded-2xl shadow-lg border ${
        type === "success" ? "bg-emerald-100 text-emerald-800 border-emerald-300"
        : type === "danger" ? "bg-red-100 text-red-700 border-red-200"
        : "bg-yellow-100 text-yellow-800 border-yellow-300"
    }`;
    toast.style.fontSize = "14px";
    toast.style.opacity = "0";
    toast.style.transition = "all 0.5s";
    toast.innerHTML = message;
    panel.appendChild(toast);
    setTimeout(() => toast.style.opacity = "1", 10);
    setTimeout(() => {
        toast.style.opacity = "0";
        setTimeout(() => toast.remove(), 600);
    }, 8000);
}

// Guardar ids alertadas para no notificar doble en la sesión
const alertedOrderIds = {
    soon: new Set(),
    reactivate: new Set()
};

function checkPostponedOrdersNotifications() {
    const now = new Date();
    for (const [orderId, order] of Object.entries(window.ordersCache || {})) {
        if (order.status === "Postergado" && order.nextSchedule) {
            const schedDate = parseNextSchedule(order.nextSchedule);
            if (!schedDate) continue;
            const diff = schedDate - now;

            // Notificar "le quedan..." si faltan menos de 3 días y no fue alertada ya
            if (diff > 0 && diff <= (3 * 24 * 3600 * 1000) && !alertedOrderIds.soon.has(orderId)) {
                showOrderSideAlert(
                    `<b>Orden ${order.cartToken || orderId }</b>: ${formatTimeDiff(diff)} para reactivarse.`,
                    "warning"
                );
                alertedOrderIds.soon.add(orderId);
            }
            // Notificar cuando ya debería estar activa
            if (diff <= 0 && !alertedOrderIds.reactivate.has(orderId)) {
                showOrderSideAlert(
                    `<b>Orden ${order.cartToken || orderId}</b> ha sido <b>reactivada automáticamente</b>.`,
                    "success"
                );
                alertedOrderIds.reactivate.add(orderId);
            }
        }
    }
}

function startOrderNotificationsTimer() {
    checkPostponedOrdersNotifications();
    if (!window.orderNotifyTimer) {
        window.orderNotifyTimer = setInterval(checkPostponedOrdersNotifications, 60000); // Cada minuto
    }
}

window.startOrderNotificationsTimer = startOrderNotificationsTimer;