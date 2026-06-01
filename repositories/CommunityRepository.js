const { getDB } = require('../db');
const { ObjectId } = require('mongodb');

class CommunityRepository {
    async findAllPosts() {
        return await getDB().collection('community_posts')
            .find({})
            .sort({ createdAt: -1 })
            .toArray();
    }
    
    async createPost(doc) {
        const result = await getDB().collection('community_posts').insertOne(doc);
        return await getDB().collection('community_posts').findOne({ _id: result.insertedId });
    }
    
    async findPostById(id) {
        return await getDB().collection('community_posts').findOne({ _id: new ObjectId(id) });
    }
    
    async deletePost(id) {
        await getDB().collection('community_posts').deleteOne({ _id: new ObjectId(id) });
    }
    
    async countUserPosts(userId) {
        return await getDB().collection('community_posts').countDocuments({ userId: new ObjectId(userId) });
    }
    
    async toggleLike(postId, userId, hasLike) {
        await getDB().collection('community_posts').updateOne(
            { _id: new ObjectId(postId) },
            hasLike
                ? { $pull: { likes: new ObjectId(userId) } }
                : { $addToSet: { likes: new ObjectId(userId) } }
        );
        return await this.findPostById(postId);
    }
    
    async addComment(postId, comment) {
        await getDB().collection('community_posts').updateOne(
            { _id: new ObjectId(postId) },
            { $push: { comments: comment } }
        );
        return await this.findPostById(postId);
    }
}
module.exports = new CommunityRepository();
