const express = require('express');
const authController = require('../controllers/AuthController');
const authService = require('../services/AuthService');
const router = express.Router();

router.post('/register', authController.register.bind(authController));
router.post('/login', authController.login.bind(authController));

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
