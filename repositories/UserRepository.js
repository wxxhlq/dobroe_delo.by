const { getDB } = require('../db');
const { ObjectId } = require('mongodb');

class UserRepository {
    async findByEmail(email) {
        return await getDB().collection('users').findOne({ email: email.toLowerCase() });
    }

    async findById(id) {
        return await getDB().collection('users').findOne({ _id: new ObjectId(id) });
    }

    async createUser(userData) {
        const result = await getDB().collection('users').insertOne(userData);
        return await this.findById(result.insertedId);
    }

    async updateLastLogin(id) {
        await getDB().collection('users').updateOne(
            { _id: new ObjectId(id) },
            { $set: { lastLogin: new Date() } }
        );
    }
}

module.exports = new UserRepository();
