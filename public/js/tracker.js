(function() {
    let startTime = Date.now();
    let maxScroll = 0;
    const sessionId = localStorage.getItem('dobro_session') || 'sd_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('dobro_session', sessionId);

    const send = (type, data = {}) => {
        const payload = {
            sessionId,
            userId: localStorage.getItem('userId'),
            eventType: type,
            eventData: data,
            timeOnPage: Math.round((Date.now() - startTime) / 1000),
            scrollDepth: maxScroll
        };

        // Используем fetch для надежности (v1 эндпоинт)
        fetch('/api/v1/analytics/track', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).catch(() => {});
    };

    window.addEventListener('scroll', () => {
        const pct = Math.round((window.scrollY + window.innerHeight) / document.documentElement.scrollHeight * 100);
        if (pct > maxScroll) maxScroll = pct;
    }, { passive: true });

    window.addEventListener('load', () => send('page_view', { title: document.title }));

    // Глобальный метод для ручного вызова (например, на кнопках)
    window.AppTracker = { send };
})();