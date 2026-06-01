const { getDB } = require('../db');
const { ObjectId } = require('mongodb');

class ApplicationRepository {
    async createApplication(applicationData) {
        const { task_id, volunteer_id, status } = applicationData;
        const result = await getDB().collection('applications').insertOne({
            task_id: new ObjectId(task_id),
            volunteer_id: new ObjectId(volunteer_id),
            status: status || 'registered',
            applied_at: new Date()
        });
        const app = await getDB().collection('applications').findOne({ _id: result.insertedId });
        app.id = app._id.toString();
        return app;
    }

    async findApplication(taskId, volunteerId) {
        const app = await getDB().collection('applications').findOne({
            task_id: new ObjectId(taskId),
            volunteer_id: new ObjectId(volunteerId),
            status: { $ne: 'cancelled' }
        });
        if (app) app.id = app._id.toString();
        return app;
    }
    
    async findByUserId(volunteerId) {
        const applications = await getDB().collection('applications').aggregate([
            { $match: { volunteer_id: new ObjectId(volunteerId), status: { $ne: 'cancelled' } } },
            {
                $lookup: {
                    from: 'tasks',
                    localField: 'task_id',
                    foreignField: '_id',
                    as: 'task'
                }
            },
            { $unwind: '$task' },
            { $sort: { applied_at: -1 } }
        ]).toArray();
        
        return applications.map(a => {
            a.id = a._id.toString();
            a.task_title = a.task.title;
            a.task_status = a.task.status;
            a.start_date = a.task.start_date;
            delete a.task;
            return a;
        });
    }

    async cancelApplication(id, volunteerId) {
        const filter = { _id: new ObjectId(id), volunteer_id: new ObjectId(volunteerId) };
        await getDB().collection('applications').updateOne(
            filter,
            { $set: { status: 'cancelled', cancelled_at: new Date() } }
        );
        const app = await getDB().collection('applications').findOne(filter);
        if (app) app.id = app._id.toString();
        return app;
    }
}

module.exports = new ApplicationRepository();
