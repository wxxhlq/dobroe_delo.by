// Функция обновления статуса (вызывается при загрузке и пингах)
async function sendActivityPing(endpoint = '/api/user/ping') {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
        await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
    } catch (e) {
        console.warn('Статус не обновлен:', e.message);
    }
}

// Главный инициализатор
document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('token');

    if (token) {
        // 1. Сразу отмечаем, что зашли на страницу
        sendActivityPing('/api/user/update-activity');

        // 2. Запускаем "пульс" каждые 2 минуты, чтобы не пропадал онлайн
        setInterval(() => {
            sendActivityPing('/api/user/ping');
        }, 120000);
    }
});

// 3. МГНОВЕННЫЙ ОФФЛАЙН ПРИ ЗАКРЫТИИ (как в ВК)
window.addEventListener('beforeunload', () => {
    const token = localStorage.getItem('token');
    if (!token) return;

    // Используем Beacon API — он гарантированно дойдет до сервера,
    // даже если вкладка уже закрылась
    const blob = new Blob([JSON.stringify({ logout: true })], { type: 'application/json' });
    navigator.sendBeacon('/api/user/logout-ping', blob);
});