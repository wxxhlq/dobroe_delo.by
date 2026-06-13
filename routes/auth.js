const express = require('express');
const authController = require('../controllers/AuthController');
const authService = require('../services/AuthService');
const router = express.Router();

// === Красивые HTML-страницы для email и сброса пароля ===
function getBaseHtml(title, bodyContent) {
    return `
        <!DOCTYPE html>
        <html lang="ru">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Доброе_дело.by | ${title}</title>
            <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
            <style>
                :root {
                    --bg: #0f172a;
                    --surface: #1e293b;
                    --border: #334155;
                    --text: #f8fafc;
                    --muted: #94a3b8;
                    --blue: #6366f1;
                    --blue-hover: #4f46e5;
                    --success: #10b981;
                    --error: #ef4444;
                }
                body {
                    margin: 0;
                    padding: 20px;
                    font-family: 'Inter', sans-serif;
                    background: radial-gradient(circle at top, #1e1b4b 0%, #0f172a 100%);
                    color: var(--text);
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    min-height: 100vh;
                    box-sizing: border-box;
                }
                .container {
                    background: rgba(30, 41, 59, 0.7);
                    backdrop-filter: blur(16px);
                    border: 1px solid var(--border);
                    padding: 40px 30px;
                    border-radius: 24px;
                    width: 100%;
                    max-width: 440px;
                    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
                    text-align: center;
                    box-sizing: border-box;
                }
                .icon {
                    font-size: 64px;
                    margin-bottom: 24px;
                    display: inline-block;
                }
                h1 {
                    font-family: 'Outfit', sans-serif;
                    font-size: 26px;
                    font-weight: 800;
                    margin: 0 0 12px 0;
                    background: linear-gradient(to right, #a5b4fc, #6366f1);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                }
                p {
                    font-size: 15px;
                    line-height: 1.6;
                    color: var(--muted);
                    margin: 0 0 30px 0;
                }
                .btn {
                    display: inline-block;
                    background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
                    color: white;
                    text-decoration: none;
                    padding: 14px 28px;
                    border-radius: 14px;
                    font-weight: 700;
                    font-size: 15px;
                    transition: all 0.3s ease;
                    box-shadow: 0 10px 20px rgba(99, 102, 241, 0.2);
                    border: none;
                    cursor: pointer;
                    width: 100%;
                    box-sizing: border-box;
                }
                .btn:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 15px 25px rgba(99, 102, 241, 0.3);
                }
                .inp-modern {
                    background: #0f172a;
                    border: 1px solid var(--border);
                    color: var(--text);
                    padding: 14px;
                    border-radius: 12px;
                    font-size: 15px;
                    width: 100%;
                    box-sizing: border-box;
                    outline: none;
                    transition: 0.2s;
                    margin-bottom: 20px;
                }
                .inp-modern:focus {
                    border-color: var(--blue);
                    box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
                }
                label {
                    display: block;
                    text-align: left;
                    font-size: 13px;
                    font-weight: 600;
                    color: var(--muted);
                    margin-bottom: 8px;
                }
            </style>
        </head>
        <body>
            <div class="container">
                ${bodyContent}
            </div>
        </body>
        </html>
    `;
}

function renderSuccessHtml(title, text) {
    return getBaseHtml(title, `
        <div class="icon" style="color: #10b981">✅</div>
        <h1>${title}</h1>
        <p>${text}</p>
        <a href="http://localhost:3000/auth" class="btn">Перейти к авторизации</a>
    `);
}

function renderErrorHtml(text) {
    return getBaseHtml('Ошибка', `
        <div class="icon" style="color: #ef4444">❌</div>
        <h1>Произошла ошибка</h1>
        <p>${text}</p>
        <a href="http://localhost:3000/auth" class="btn">Вернуться на сайт</a>
    `);
}

function renderResetPasswordFormHtml(token) {
    return getBaseHtml('Восстановление пароля', `
        <div class="icon" style="color: #6366f1">🔑</div>
        <h1>Новый пароль</h1>
        <p>Пожалуйста, введите ваш новый пароль для доступа к аккаунту.</p>
        <form action="/reset-password" method="POST">
            <input type="hidden" name="token" value="${token}">
            
            <label>Новый пароль</label>
            <input type="password" name="password" class="inp-modern" placeholder="Минимум 6 символов" required minlength="6">
            
            <button type="submit" class="btn">Сохранить пароль</button>
        </form>
    `);
}

// Стандартные роуты авторизации
router.post('/register', authController.register.bind(authController));
router.post('/login', authController.login.bind(authController));
router.post('/register-phone', authController.registerPhone.bind(authController));
router.post('/verify-sms', authController.verifySms.bind(authController));
router.post('/forgot-password', authController.forgotPassword.bind(authController));
router.post('/resend-confirmation', authController.resendConfirmation.bind(authController));

// Ссылки подтверждения и сброса пароля (GET)
router.get('/confirm-email', async (req, res) => {
    const { token } = req.query;
    if (!token) {
        return res.status(400).send(renderErrorHtml('Не указан токен подтверждения.'));
    }
    try {
        const db = require('../db').getDB();
        const user = await db.collection('users').findOne({
            emailConfirmationToken: token,
            emailConfirmationExpires: { $gt: new Date() }
        });
        if (!user) {
            return res.status(400).send(renderErrorHtml('Токен подтверждения недействителен или его срок действия истек.'));
        }
        await db.collection('users').updateOne(
            { _id: user._id },
            { 
                $set: { isEmailConfirmed: true },
                $unset: { emailConfirmationToken: '', emailConfirmationExpires: '' }
            }
        );
        res.send(renderSuccessHtml('Email успешно подтвержден!', 'Ваш электронный адрес успешно верифицирован. Теперь вы можете войти в свой аккаунт.'));
    } catch (err) {
        console.error(err);
        res.status(500).send(renderErrorHtml('Внутренняя ошибка сервера при подтверждении почты.'));
    }
});

router.get('/reset-password', async (req, res) => {
    const { token } = req.query;
    if (!token) {
        return res.status(400).send(renderErrorHtml('Токен сброса пароля не указан.'));
    }
    try {
        const db = require('../db').getDB();
        const user = await db.collection('users').findOne({
            passwordResetToken: token,
            passwordResetExpires: { $gt: new Date() }
        });
        if (!user) {
            return res.status(400).send(renderErrorHtml('Ссылка на сброс пароля устарела или недействительна.'));
        }
        res.send(renderResetPasswordFormHtml(token));
    } catch (err) {
        console.error(err);
        res.status(500).send(renderErrorHtml('Внутренняя ошибка сервера.'));
    }
});

router.post('/reset-password', async (req, res) => {
    const { token, password } = req.body;
    try {
        await authService.resetPassword(token, password);
        // Если пришел JSON-запрос (например, AJAX)
        if (req.headers['content-type']?.includes('application/json')) {
            return res.json({ success: true, message: 'Пароль успешно сброшен' });
        }
        res.send(renderSuccessHtml('Пароль успешно изменен!', 'Ваш новый пароль установлен. Вы можете использовать его для входа.'));
    } catch (err) {
        console.error(err);
        if (req.headers['content-type']?.includes('application/json')) {
            return res.status(400).json({ success: false, error: err.message });
        }
        res.status(400).send(renderErrorHtml(err.message || 'Не удалось обновить пароль.'));
    }
});

// === VK OAuth 2.0 Mock Implementation ===
router.get('/auth/vk', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="ru">
        <head>
            <meta charset="UTF-8">
            <title>ВКонтакте | Авторизация</title>
            <style>
                body {
                    margin: 0;
                    font-family: -apple-system, system-ui, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    background: #ebedf0;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    height: 100vh;
                }
                .oauth-card {
                    background: #fff;
                    width: 380px;
                    border-radius: 12px;
                    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
                    overflow: hidden;
                    text-align: center;
                    padding: 32px 24px;
                }
                .vk-logo {
                    width: 48px;
                    height: 48px;
                    background: #0077ff;
                    color: white;
                    border-radius: 10px;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 26px;
                    font-weight: bold;
                    margin-bottom: 20px;
                }
                h2 {
                    font-size: 20px;
                    margin: 0 0 10px 0;
                    color: #000;
                }
                p {
                    font-size: 14px;
                    color: #818c99;
                    margin: 0 0 24px 0;
                    line-height: 1.4;
                }
                .app-info {
                    background: #f5f6f8;
                    border-radius: 8px;
                    padding: 12px;
                    font-size: 13px;
                    color: #2c3e50;
                    margin-bottom: 24px;
                    text-align: left;
                }
                .btn-allow {
                    background: #0077ff;
                    color: white;
                    border: none;
                    border-radius: 8px;
                    padding: 12px 24px;
                    font-size: 15px;
                    font-weight: 500;
                    cursor: pointer;
                    width: 100%;
                    margin-bottom: 12px;
                }
                .btn-allow:hover {
                    background: #0062d3;
                }
                .btn-cancel {
                    background: transparent;
                    color: #0077ff;
                    border: none;
                    font-size: 14px;
                    cursor: pointer;
                }
            </style>
        </head>
        <body>
            <div class="oauth-card">
                <div class="vk-logo">VK</div>
                <h2>Авторизация через VK</h2>
                <p>Приложение <strong>Доброе_дело.by</strong> запрашивает доступ к вашему имени, email и фотографии профиля.</p>
                <div class="app-info">
                    🔐 <b>Запрашиваемые права:</b><br>
                    • Доступ к общей информации профиля<br>
                    • Доступ к вашему Email (vk_volunteer@vk.com)
                </div>
                <button class="btn-allow" onclick="window.location.href='/auth/vk/callback?code=vk_mock_auth_code_123'">Разрешить доступ</button>
                <br>
                <button class="btn-cancel" onclick="window.location.href='/auth'">Отмена</button>
            </div>
        </body>
        </html>
    `);
});

router.get('/auth/vk/callback', async (req, res) => {
    try {
        const mockProfile = {
            email: 'vk_volunteer@vk.com',
            name: 'Алексей Смирнов (VK)',
            username: 'vk_volunteer',
            avatarUrl: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&q=80',
            phone: '+375291234567'
        };
        const result = await authService.socialLogin(mockProfile);

        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Авторизация...</title>
                <script>
                    localStorage.setItem('authToken', '${result.token}');
                    localStorage.setItem('token', '${result.token}');
                    localStorage.setItem('user', JSON.stringify(${JSON.stringify(result.user)}));
                    window.location.href = '/cabinet';
                </script>
            </head>
            <body>
                <p style="text-align:center; font-family:sans-serif; margin-top:50px;">Вы успешно авторизованы! Перенаправление...</p>
            </body>
            </html>
        `);
    } catch (err) {
        res.status(500).send(`Ошибка OAuth авторизации: ${err.message}`);
    }
});

// === Telegram OAuth 2.0 Mock Implementation ===
router.get('/auth/telegram', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="ru">
        <head>
            <meta charset="UTF-8">
            <title>Telegram | Авторизация</title>
            <style>
                body {
                    margin: 0;
                    font-family: -apple-system, system-ui, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    background: #e7ebd0;
                    background: radial-gradient(circle, #eef2f3 0%, #8e9eab 100%);
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    height: 100vh;
                }
                .oauth-card {
                    background: #fff;
                    width: 380px;
                    border-radius: 12px;
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
                    overflow: hidden;
                    text-align: center;
                    padding: 32px 24px;
                }
                .tg-logo {
                    width: 52px;
                    height: 52px;
                    background: #229ed9;
                    color: white;
                    border-radius: 50%;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 26px;
                    font-weight: bold;
                    margin-bottom: 20px;
                }
                h2 {
                    font-size: 20px;
                    margin: 0 0 10px 0;
                    color: #229ed9;
                }
                p {
                    font-size: 14px;
                    color: #616e7c;
                    margin: 0 0 24px 0;
                    line-height: 1.4;
                }
                .app-info {
                    background: #f0f7fa;
                    border-radius: 8px;
                    padding: 12px;
                    font-size: 13px;
                    color: #2c3e50;
                    margin-bottom: 24px;
                    text-align: left;
                    border-left: 4px solid #229ed9;
                }
                .btn-allow {
                    background: #229ed9;
                    color: white;
                    border: none;
                    border-radius: 8px;
                    padding: 12px 24px;
                    font-size: 15px;
                    font-weight: 500;
                    cursor: pointer;
                    width: 100%;
                    margin-bottom: 12px;
                    box-shadow: 0 2px 8px rgba(34, 158, 217, 0.3);
                }
                .btn-allow:hover {
                    background: #1b85b8;
                }
                .btn-cancel {
                    background: transparent;
                    color: #707b8b;
                    border: none;
                    font-size: 14px;
                    cursor: pointer;
                }
            </style>
        </head>
        <body>
            <div class="oauth-card">
                <div class="tg-logo">TG</div>
                <h2>Войти с помощью Telegram</h2>
                <p>Приложение <strong>Доброе_дело.by</strong> получит ваше имя, @username и публичную фотографию.</p>
                <div class="app-info">
                    🌐 <b>Идентификация:</b><br>
                    Вы будете зарегистрированы как представитель Telegram-аккаунта (tg_volunteer@telegram.org).
                </div>
                <button class="btn-allow" onclick="window.location.href='/auth/telegram/callback?code=tg_mock_auth_code_123'">Подтвердить профиль</button>
                <br>
                <button class="btn-cancel" onclick="window.location.href='/auth'">Вернуться</button>
            </div>
        </body>
        </html>
    `);
});

router.get('/auth/telegram/callback', async (req, res) => {
    try {
        const mockProfile = {
            email: 'tg_volunteer@telegram.org',
            name: 'Мария Козлова (Telegram)',
            username: 'tg_volunteer',
            avatarUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=150&q=80',
            phone: '+375338887766'
        };
        const result = await authService.socialLogin(mockProfile);

        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Авторизация...</title>
                <script>
                    localStorage.setItem('authToken', '${result.token}');
                    localStorage.setItem('token', '${result.token}');
                    localStorage.setItem('user', JSON.stringify(${JSON.stringify(result.user)}));
                    window.location.href = '/cabinet';
                </script>
            </head>
            <body>
                <p style="text-align:center; font-family:sans-serif; margin-top:50px;">Вы успешно авторизованы! Перенаправление...</p>
            </body>
            </html>
        `);
    } catch (err) {
        res.status(500).send(`Ошибка OAuth авторизации: ${err.message}`);
    }
});

module.exports = router;
