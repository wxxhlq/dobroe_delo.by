const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/auth_system';

// Пользователи Atlas живут в базе admin, а не в базе из URI.
// Без явного authSource драйвер берёт имя базы из пути и получает "bad auth".
const authSource = process.env.MONGODB_AUTH_SOURCE || (/mongodb\+srv:\/\//.test(uri) ? 'admin' : undefined);
const client = new MongoClient(uri, authSource ? { authSource } : {});

let db;
let dbConnectionPromise = null;

async function connectDB() {
    if (dbConnectionPromise) {
        return dbConnectionPromise;
    }

    dbConnectionPromise = (async () => {
        try {
            await client.connect();
            db = client.db();
            console.log('✓ Подключение к MongoDB успешно');
            console.log('База:', db.databaseName);

            // Создаем уникальные индексы
            try {
                await db.collection('users').createIndex({ email: 1 }, { unique: true });
            } catch (err) {
                // Игнорируем ошибки при создании индексов, если они уже существуют
            }

            return db;
        } catch (err) {
            console.error('❌ Ошибка подключения к MongoDB:', err.message);
            process.exit(1);
        }
    })();

    return dbConnectionPromise;
}

function getDB() {
    if (!db) {
        throw new Error('База данных ещё не подключена. Убедитесь, что connectDB() был вызван.');
    }
    return db;
}

module.exports = { getDB, connectDB };
