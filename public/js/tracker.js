(function() {
    let startTime = Date.now();
    let maxScroll = 0;
    const sessionId = localStorage.getItem('dobro_session') || 'sd_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('dobro_session', sessionId);

    const getCategory = () => {
        const metaCat = document.querySelector('meta[name="project-category"]');
        if (metaCat) return metaCat.content;
        return window.location.pathname.includes('/projects/') ? 'Проекты' : 'Общее';
    };

    const send = (type, data = {}, isClosing = false) => {
        const payload = JSON.stringify({
            sessionId,
            userId: localStorage.getItem('userId'),
            eventType: type,
            eventData: {
                category: getCategory(),
                title: document.title,
                ...data
            },
            timeOnPage: Math.round((Date.now() - startTime) / 1000),
            scrollDepth: maxScroll,
            url: window.location.href
        });

        const url = '/api/v1/analytics/track';

        // Если страница закрывается, используем sendBeacon (он надежнее fetch в этот момент)
        if (isClosing && navigator.sendBeacon) {
            navigator.sendBeacon(url, payload);
        } else {
            fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: payload
            }).catch(() => {});
        }
    };

    // Трекаем скролл
    window.addEventListener('scroll', () => {
        const pct = Math.round((window.scrollY + window.innerHeight) / document.documentElement.scrollHeight * 100);
        if (pct > maxScroll) maxScroll = pct;
    }, { passive: true });

    // Отправка при входе
    window.addEventListener('load', () => send('page_view'));

    // Отправка при выходе (для точного времени и Bounce Rate)
    window.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            send('page_exit', {}, true);
        }
    });

    window.AppTracker = { send };
})();