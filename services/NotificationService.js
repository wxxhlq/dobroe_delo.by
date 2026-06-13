const { getDB } = require('../db');
const { ObjectId } = require('mongodb');

// Helper to calculate distance in km using Haversine formula
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius of the earth in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

class NotificationService {
    async sendUrgentTaskNotifications(task) {
        try {
            const db = getDB();
            if (!db) {
                console.error('❌ NotificationService: DB not ready');
                return;
            }

            console.log(`⏳ NotificationService: Запуск рассылки для SOS-задачи "${task.title}" (ID: ${task._id})`);

            // Step 3: Find all users with role VOLUNTEER who are active (not blocked)
            const activeVolunteers = await db.collection('users').find({
                role: 'VOLUNTEER',
                isBlocked: { $ne: true }
            }).toArray();

            console.log(`🔍 Найдено активных волонтеров: ${activeVolunteers.length}`);

            // Filter by interests (category matches user's interests, or fallback to all active if no match)
            let targetUsers = activeVolunteers.filter(u => u.interests && u.interests.includes(task.categoryId));
            console.log(`🔍 Волонтеров с подходящими интересами (${task.categoryId}): ${targetUsers.length}`);

            if (targetUsers.length === 0) {
                console.log('ℹ️ Специфических волонтеров не найдено. Выборка всех активных волонтеров.');
                targetUsers = activeVolunteers;
            }

            // Filter by geo location (10 km radius if coordinates are available, otherwise by city)
            const matchedUsers = targetUsers.filter(user => {
                const uLat = user.lat || (user.coordinates && user.coordinates.lat);
                const uLng = user.lng || (user.coordinates && user.coordinates.lng);
                const tLat = task.lat || (task.coordinates && task.coordinates.lat);
                const tLng = task.lng || (task.coordinates && task.coordinates.lng);

                if (uLat && uLng && tLat && tLng) {
                    const distance = getDistance(Number(uLat), Number(uLng), Number(tLat), Number(tLng));
                    return distance <= 10.0;
                }

                // Fallback to city matching
                if (user.city && task.city) {
                    return user.city.trim().toLowerCase() === task.city.trim().toLowerCase();
                }
                return false;
            });

            console.log(`🎯 Целевая аудитория (до 10км / совпадение городов): ${matchedUsers.length} пользователей`);

            if (matchedUsers.length === 0) {
                console.log('ℹ️ Нет подходящих пользователей для оповещения.');
                return;
            }

            // Create notification campaign
            const campaign = {
                taskId: task._id,
                taskTitle: task.title,
                sentCount: matchedUsers.length,
                pushSentCount: 0,
                openedCount: 0,
                clickedCount: 0,
                createdAt: new Date()
            };

            const campResult = await db.collection('urgent_notification_campaigns').insertOne(campaign);
            const campaignId = campResult.insertedId;

            let pushCount = 0;
            const notificationDocs = matchedUsers.map(user => {
                const pushEnabled = !user.notifications || (user.notifications.push !== false && user.notifications.sosTasks !== false);
                if (pushEnabled) {
                    pushCount++;
                    console.log(`📱 [PUSH NOTIFICATION MOCK] Отправка SOS Push для ${user.name} (${user.email}): "${task.title}"`);
                }
                return {
                    userId: user._id,
                    type: 'sos_task',
                    title: `Срочная задача: ${task.title}`,
                    message: `Срочно требуется помощь: ${task.description}`,
                    taskData: {
                        id: task._id.toString(),
                        title: task.title,
                        description: task.description,
                        city: task.city,
                        address: task.address,
                        coordinates: task.coordinates || (task.lat && task.lng ? { lat: task.lat, lng: task.lng } : null)
                    },
                    campaignId: campaignId,
                    status: pushEnabled ? 'push_sent' : 'sent',
                    isOpened: false,
                    isClicked: false,
                    createdAt: new Date()
                };
            });

            // Update campaign's push count
            await db.collection('urgent_notification_campaigns').updateOne(
                { _id: campaignId },
                { $set: { pushSentCount: pushCount } }
            );

            await db.collection('notifications').insertMany(notificationDocs);
            console.log(`✅ Успешно разослано и записано в БД: ${notificationDocs.length} уведомлений`);

        } catch (err) {
            console.error('❌ Ошибка в NotificationService.sendUrgentTaskNotifications:', err);
        }
    }
}

module.exports = new NotificationService();
