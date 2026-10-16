const { MongoClient } = require('mongodb');

const HOSTS = [
    'ac-yenh9xv-shard-00-00.m2fonta.mongodb.net:27017',
    'ac-yenh9xv-shard-00-01.m2fonta.mongodb.net:27017',
    'ac-yenh9xv-shard-00-02.m2fonta.mongodb.net:27017'
].join(',');

const ATL = 'mongodb://dobroeapp:dobroe2026pass@' + HOSTS + '/?authSource=admin&replicaSet=atlas-9xwy93-shard-0&tls=true';

async function main() {
    const c = await MongoClient.connect(ATL);
    const db = c.db('auth_system');

    const projects = await db.collection('projects').find({}).sort({ createdAt: -1 }).toArray();
    console.log('=== projects (' + projects.length + ') ===');
    for (const p of projects) {
        console.log('');
        console.log('id: ' + p._id.toString());
        console.log('title: ' + JSON.stringify(p.title));
        console.log('status: ' + p.status + ' | image: ' + (p.imageUrl || '(нет)'));
        console.log('city: ' + JSON.stringify(p.city) + ' | region: ' + JSON.stringify(p.region));
        console.log('category: ' + JSON.stringify(p.categoryId) + ' | format: ' + JSON.stringify(p.format) + ' | capacity: ' + p.capacity);
        console.log('desc: ' + JSON.stringify((p.description || '').slice(0, 120)));
    }

    await c.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });