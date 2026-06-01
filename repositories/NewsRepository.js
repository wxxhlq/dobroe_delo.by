const { getDB } = require('../db');
const { ObjectId } = require('mongodb');

class NewsRepository {
    async findAll() {
        return await getDB().collection('news')
            .find({ status: { $ne: 'DELETED' } })
            .sort({ createdAt: -1 })
            .toArray();
    }
    async create(doc) {
        const result = await getDB().collection('news').insertOne(doc);
        return await getDB().collection('news').findOne({ _id: result.insertedId });
    }
    async findById(id) {
        return await getDB().collection('news').findOne({ _id: new ObjectId(id) });
    }
    async delete(id) {
        await getDB().collection('news').deleteOne({ _id: new ObjectId(id) });
    }
}
module.exports = new NewsRepository();
