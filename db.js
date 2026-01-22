const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/auth_system';
const client = new MongoClient(uri);

let db;

async function connectDB() {
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
        } catch (indexErr) {
            // Индексы уже существуют - это нормально
            console.log('  → Индексы уже существуют');
        }

    } catch (err) {
        console.error('❌ Ошибка подключения к MongoDB:', err.message);
        process.exit(1);
    }
}

connectDB();

function getDB() {
    return db;
}

module.exports = { getDB };
