const { MongoClient } = require('mongodb');

const HOSTS = [
    'ac-yenh9xv-shard-00-00.m2fonta.mongodb.net:27017',
    'ac-yenh9xv-shard-00-01.m2fonta.mongodb.net:27017',
    'ac-yenh9xv-shard-00-02.m2fonta.mongodb.net:27017'
].join(',');

const ATL = 'mongodb://dobroeapp:dobroe2026pass@' + HOSTS + '/?authSource=admin&replicaSet=atlas-9xwy93-shard-0&tls=true';

const IMG = '/uploads/projects/';

// id -> новые данные проекта
const UPDATES = {
    '6ad1ff5867b7c11b2e884288': {
        title: 'Доставка продуктов и помощь по хозяйству',
        description:
            'Ищем волонтёров, чтобы помочь пожилым соседям с Центрального района. Кому нужно купить продукты и лекарства в аптеке, записаться к врачу или просто навестить и поговорить — оставляйте отклик. Опыт и медицинское образование не нужны, достаточно желания и пары свободных часов в неделю.',
        categoryId: 'elderly',
        city: 'Центральный',
        region: 'Минск',
        address: 'Центральный район, рядом с парком Горького',
        format: 'Регулярное',
        capacity: 5,
        imageUrl: IMG + 'elderly-care.webp'
    },
    '6ad1ff5867b7c11b2e88428f': {
        title: 'Субботник в приюте для животных',
        description:
            'Приют набирает волонтёров на генеральную уборку. Поможете вычистить вольеры, вымыть миски, вынести старые подстилки и просто провести пару часов с собаками, которым не повезло. Приходите в старой рабочей одежде — организаторы выдадут перчатки и мешки. Кормить животных без разрешения волонтёров нельзя, об этом расскажут на месте.',
        categoryId: 'animals',
        city: 'Пинск',
        region: 'Брестская',
        address: 'ул. Парковая, 14',
        format: 'Разовое',
        capacity: 10,
        imageUrl: IMG + 'animal-shelter.webp'
    },
    '6ad1ff5867b7c11b2e88428e': {
        title: 'Раздельный сбор отходов во дворе',
        description:
            'Собираем команду на акцию по раздельному сбору: пластик, стекло, батарейки и электроника будут разбирать по контейнерам. Нужны 20 человек на четыре часа. Возьмите перчатки, вода и хорошее настроение — остальное дадут организаторы. После сбора покажем, сколько килограммов удалось увести из обычного мусора.',
        categoryId: 'eco',
        city: 'Пинск',
        region: 'Брестская',
        address: 'Городской парк, у главного входа',
        format: 'Разовое',
        capacity: 20,
        imageUrl: IMG + 'eco-recycle.webp'
    },
    '6ad1ff5867b7c11b2e884287': {
        title: 'Выгул собак из приюта',
        description:
            'Ищем тех, кто готов гулять с собаками, которые ждут дом. Одна смена — это час на прогулке вместе с куратором, спокойный маршрут по району и десять минут на общение с животным. Если у вас нет своей собаки — это даже лучше: так вы поможете именно тем, кому она нужна.',
        categoryId: 'animals',
        city: 'Центральный',
        region: 'Минск',
        address: 'Центральный район, приют (адрес пришлют в отклике)',
        format: 'Регулярное',
        capacity: 5,
        imageUrl: ''
    },
    '6ad1ff5867b7c11b2e884286': {
        title: 'Навещаем пожилых соседей',
        description:
            'Регулярная нагрузка в Бресте: зайти к пожилым соседям, помочь по хозяйству, сходить в аптеку или просто побеседовать за чаем. Несколько человек уже ждут визита. Отклик подойдёт и тем, кому самому не хватает общения — можно приходить в паре.',
        categoryId: 'elderly',
        city: 'Брест',
        region: 'Брестская',
        address: 'Центральная часть города',
        format: 'Регулярное',
        capacity: 3,
        imageUrl: ''
    },
    '6ad1ff5867b7c11b2e884285': {
        title: 'Помощь с хозяйственными работами',
        description:
            'Нужны крепкие руки на несколько дней: поднести дрова, помочь с покраской забора, вынести вещи. Работа физическая, зато результат видно сразу. Приходите группой или поодиночке — организаторы распределят задачи. Инструмент и расходные материалы предоставим.',
        categoryId: 'elderly',
        city: 'Витебск',
        region: 'Витебская',
        address: 'Пригород Витебска',
        format: 'Разовое',
        capacity: 4,
        imageUrl: ''
    },
    '6ad1ff5867b7c11b2e884284': {
        title: 'Уборка листьев в сквере',
        description:
            'Каждую осенью сквер зарастает опавшей листвой, а разгребать его некому. Соберёмся группой, пройдёмся граблями и мешками, вынесем всё к контейнерам. Справимся за два-три часа — нужно 5 человек. Инструмент дадут на месте, перчатки приносите свои.',
        categoryId: 'eco',
        city: 'Советский',
        region: 'Минск',
        address: 'Сквер между ул. Ленина и пр. Победителей',
        format: 'Разовое',
        capacity: 5,
        imageUrl: IMG + '697b302fcfb567edd0555ffe-1769697435974.webp'
    },
    '6ad1ff5867b7c11b2e884290': {
        title: 'Раздача рекламных буклетов',
        description:
            'Организатор предлагает разнести рекламные буклеты коммерческого характера по району. Заявка отклонена: распространение рекламы в рамках платформы не поддерживается, а модератор не смог подтвердить, что акция не преследует коммерческие цели.',
        categoryId: 'events',
        city: 'Пинск',
        region: 'Брестская',
        address: 'Центр города',
        format: 'Разовое',
        capacity: 2,
        imageUrl: '',
        status: 'REJECTED',
        rejectionReason: 'Коммерческая реклама не допускается на платформе'
    }
};

// Проекты на удаление: 4 дубля "123" и "123123"
const DELETE = [
    '6ad1ff5867b7c11b2e88428c',
    '6ad1ff5867b7c11b2e88428b',
    '6ad1ff5867b7c11b2e88428a',
    '6ad1ff5867b7c11b2e884289',
    '6ad1ff5867b7c11b2e88428d'
];

async function main() {
    const c = await MongoClient.connect(ATL);
    const db = c.db('auth_system');

    for (const [id, data] of Object.entries(UPDATES)) {
        const oid = new (require('mongodb').ObjectId)(id);
        const res = await db.collection('projects').findOneAndUpdate(
            { _id: oid },
            { $set: data },
            { returnDocument: 'after' }
        );
        console.log((res ? 'обновлён  ' : 'не найден ') + data.title);
    }

    if (DELETE.length) {
        const oids = DELETE.map((id) => new (require('mongodb').ObjectId)(id));
        const r = await db.collection('projects').deleteMany({ _id: { $in: oids } });
        console.log('');
        console.log('удалено мусорных проектов: ' + r.deletedCount);

        // Подчищаем отклики к удалённым проектам
        const ra = await db.collection('project_applications').deleteMany({ projectId: { $in: oids } });
        console.log('удалено откликов к ним: ' + ra.deletedCount);
    }

    const all = await db.collection('projects').find({}).sort({ createdAt: -1 }).toArray();
    console.log('');
    console.log('=== итог: ' + all.length + ' проектов ===');
    for (const p of all) {
        console.log('  [' + p.status + '] ' + p.title + '  — фото: ' + (p.imageUrl ? 'есть' : 'по категории'));
    }

    await c.close();
}

main().catch((e) => { console.error('ОШИБКА:', e.message); process.exit(1); });