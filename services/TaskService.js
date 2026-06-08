const taskRepository = require('../repositories/TaskRepository');
const applicationRepository = require('../repositories/ApplicationRepository');
const userRepository = require('../repositories/UserRepository');

class TaskService {
    async getAllTasks() {
        return await taskRepository.findAllPublished();
    }

    async createTask(taskData, user) {
        if (user.role !== 'ORGANIZER' && user.role !== 'ADMIN') {
            throw new Error('Доступ только для организаторов');
        }

        const newTaskData = {
            ...taskData,
            organizer_id: user.userId,
            status: 'published' // В идеале должна быть модерация 'moderation'
        };

        const task = await taskRepository.createTask(newTaskData);
        
        // Начисляем XP организатору за создание задачи
        await userRepository.updatePoints(user.userId, 25);
        
        return task;
    }

    async applyForTask(taskId, user) {
        const task = await taskRepository.findById(taskId);
        
        if (!task) {
            throw new Error('Проект не найден');
        }

        if (task.status === 'completed' || task.status === 'cancelled') {
            throw new Error('Набор по этому проекту завершён');
        }

        if (task.slots_total > 0 && task.slots_filled >= task.slots_total) {
            throw new Error('Набор закрыт, мест больше нет');
        }

        const existing = await applicationRepository.findApplication(taskId, user.userId);
        if (existing) {
            throw new Error('Вы уже откликались на этот проект');
        }

        const application = await applicationRepository.createApplication({
            task_id: taskId,
            volunteer_id: user.userId,
            status: 'registered'
        });

        await taskRepository.incrementResponses(taskId);
        
        // XP за отклик
        const xpDelta = user.role === 'ORGANIZER' ? 15 : 10;
        await userRepository.updatePoints(user.userId, xpDelta);

        return application;
    }
    
    async getMyApplications(userId) {
        return await applicationRepository.findByUserId(userId);
    }
    
    async cancelApplication(applicationId, userId) {
        const app = await applicationRepository.cancelApplication(applicationId, userId);
        if (app) {
            await taskRepository.decrementResponses(app.task_id);
        }
        return app;
    }
}

module.exports = new TaskService();
