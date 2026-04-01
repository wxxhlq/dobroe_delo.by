const nodemailer = require('nodemailer');

let transporter = null;

async function getTransporter() {
    if (transporter) return transporter;

    // Проверяем, что настройки SMTP заданы
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
        console.warn('⚠️ SMTP не настроен. Письма будут только логироваться.');
        transporter = {
            sendMail: async (mail) => {
                console.log('📧 [LOG] Письмо:', {
                    to: mail.to,
                    subject: mail.subject,
                    html: mail.html?.substring(0, 200)
                });
                return { messageId: 'log-' + Date.now() };
            }
        };
        return transporter;
    }

    const config = {
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT) || 465,
        secure: process.env.SMTP_PORT === '465', // true для 465 порта
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    };

    // Для Яндекса дополнительные настройки не нужны, но оставляем стандартную конфигурацию
    transporter = nodemailer.createTransport(config);

    try {
        await transporter.verify();
        console.log('✅ SMTP соединение с Яндекс.Почтой установлено');
    } catch (err) {
        console.error('❌ Ошибка подключения к SMTP:', err.message);
    }

    return transporter;
}

// Отправка одного письма
async function sendEmail({ to, subject, html, from = process.env.SMTP_FROM }) {
    try {
        const transporter = await getTransporter();
        const info = await transporter.sendMail({
            from: from || `"Доброе_дело.by" <${process.env.SMTP_USER}>`,
            to,
            subject,
            html
        });
        console.log(`✅ Письмо отправлено на ${to}`);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error(`❌ Ошибка отправки на ${to}:`, error.message);
        return { success: false, error: error.message };
    }
}

// Массовая отправка
async function sendBulkEmails(users, subject, html, onProgress) {
    const results = { sent: 0, failed: 0, total: users.length, details: [] };

    for (let i = 0; i < users.length; i++) {
        const user = users[i];
        const email = user.email;
        if (!email) {
            results.failed++;
            results.details.push({ userId: user._id, email: null, success: false, error: 'Нет email' });
            if (onProgress) onProgress(i + 1, users.length);
            continue;
        }

        const personalizedHtml = html
            .replace(/{{name}}/g, user.name || user.username || 'Участник')
            .replace(/{{city}}/g, user.city || 'вашем городе')
            .replace(/{{points}}/g, user.points || 0);

        const personalizedSubject = subject.replace(/{{name}}/g, user.name || user.username || 'Участник');

        const result = await sendEmail({ to: email, subject: personalizedSubject, html: personalizedHtml });

        if (result.success) {
            results.sent++;
            results.details.push({ userId: user._id, email, success: true });
        } else {
            results.failed++;
            results.details.push({ userId: user._id, email, success: false, error: result.error });
        }

        if (onProgress) onProgress(i + 1, users.length);
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    return results;
}

module.exports = { sendEmail, sendBulkEmails };