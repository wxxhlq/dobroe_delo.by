const { getDB } = require('../db');
const { ObjectId } = require('mongodb');

class TaskRepository {
    async findAllPublished() {
        const tasks = await getDB().collection('tasks').aggregate([
            { $match: { status: 'published' } },
            {
                $lookup: {
                    from: 'users',
                    localField: 'organizer_id',
                    foreignField: '_id',
                    as: 'organizer'
                }
            },
            { $unwind: '$organizer' },
            { $sort: { created_at: -1 } }
        ]).toArray();
        
        return tasks.map(t => {
            t.id = t._id.toString();
            t.organizer_email = t.organizer.email;
            t.first_name = t.organizer.first_name;
            t.last_name = t.organizer.last_name;
            delete t.organizer;
            return t;
        });
    }

    async findById(id) {
        const task = await getDB().collection('tasks').findOne({ _id: new ObjectId(id) });
        if (task) task.id = task._id.toString();
        return task;
    }

    async createTask(taskData) {
        const result = await getDB().collection('tasks').insertOne({
            ...taskData,
            organizer_id: new ObjectId(taskData.organizer_id),
            slots_filled: 0,
            created_at: new Date()
        });
        const task = await getDB().collection('tasks').findOne({ _id: result.insertedId });
        task.id = task._id.toString();
        return task;
    }

    async incrementResponses(id) {
        await getDB().collection('tasks').updateOne(
            { _id: new ObjectId(id) },
            { $inc: { slots_filled: 1 } }
        );
        return this.findById(id);
    }

    async decrementResponses(id) {
        const task = await this.findById(id);
        if (task && task.slots_filled > 0) {
            await getDB().collection('tasks').updateOne(
                { _id: new ObjectId(id) },
                { $inc: { slots_filled: -1 } }
            );
        }
        return this.findById(id);
    }
}

module.exports = new TaskRepository();
