const UAParser = require('ua-parser-js');
const requestIp = require('request-ip');

const analyticsMiddleware = (req, res, next) => {
    // 1. Извлекаем IP пользователя
    const clientIp = requestIp.getClientIp(req);

    // 2. Парсим User-Agent (устройство, ОС, браузер)
    const parser = new UAParser(req.headers['user-agent']);
    const uaResult = parser.getResult();

    // 3. Перехватываем UTM-метки из URL
    const { utm_source, utm_medium, utm_campaign, utm_content, utm_term } = req.query;

    // Сохраняем данные в объект запроса, чтобы использовать их в контроллерах
    req.analytics = {
        deviceData: {
            browser: uaResult.browser.name,
            os: uaResult.os.name,
            deviceType: uaResult.device.type || 'desktop', // mobile, tablet, desktop
            isMobile: uaResult.device.type === 'mobile'
        },
        sourceData: {
            utm_source: utm_source || null,
            utm_medium: utm_medium || null,
            utm_campaign: utm_campaign || null,
            referrer: req.headers.referrer || req.headers.referer || 'direct'
        },
        ip: clientIp
    };

    next();
};

module.exports = analyticsMiddleware;