const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/auth_system';
const client = new MongoClient(uri);

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

            // Создаём индексы (только если их нет)
            try {
                const indexes = await db.collection('users').indexes();
                const hasEmailIndex = indexes.some(idx => idx.key.email);
                const hasUsernameIndex = indexes.some(idx => idx.key.username);

                if (!hasEmailIndex) {
                    await db.collection('users').createIndex({ email: 1 }, { unique: true });
                    console.log('  ✓ Индекс на email создан');
                }

                if (!hasUsernameIndex) {
                    await db.collection('users').createIndex({ username: 1 }, { unique: true });
                    console.log('  ✓ Индекс на username создан');
                }

                const hasPointsIndex = indexes.some(idx => idx.key.points);
                if (!hasPointsIndex) {
                    await db.collection('users').createIndex({ points: -1 });
                    console.log('  ✓ Индекс на points создан');
                }
            } catch (indexErr) {
                // Индексы уже существуют - это нормально
                console.log('  → Индексы уже существуют');
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
        throw new Error('База данных ещё не подключена. Убедитесь, что connectDB() был вызван и завершён.');
    }
    return db;
}

module.exports = { getDB, connectDB };
