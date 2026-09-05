const path = require('path');
const Database = require('better-sqlite3');

// Маппинг наших категорий по ID
const CATEGORIES = {
    0: 'Society',
    2: 'Biology',
    10: 'Europe',
    11: 'USA',
    4: 'Music',
    9: 'Sports',
    8: 'Asia',
    5: 'Technology'
};

function verifyClusters() {
    // Подключаемся к базе (только для чтения)
    const dbPath = path.join(__dirname, 'simplewiki.db');
    const db = new Database(dbPath, { readonly: true });

    console.log('📊 Анализ распределения статей по категориям...\n');

    // 1. Получаем общее количество статей в базе
    const totalRow = db.prepare('SELECT COUNT(id) as total FROM wiki').get();
    const totalInDb = totalRow.total;

    // 2. Считаем количество статей в каждом кластере
    const clusters = db.prepare(`
        SELECT cluster_id, COUNT(id) as count 
        FROM wiki 
        GROUP BY cluster_id 
        ORDER BY count DESC
    `).all();

    let sum = 0;

    // Выводим статистику по категориям
    for (const row of clusters) {
        sum += row.count;
        const categoryName = CATEGORIES[row.cluster_id] || 'Other (Мелкие кластеры)';

        // Форматируем вывод для читаемости
        const paddedId = String(row.cluster_id).padEnd(4, ' ');
        const paddedName = categoryName.padEnd(25, ' ');

        console.log(`Кластер ${paddedId} | ${paddedName} : ${row.count.toLocaleString('ru-RU')} статей`);
    }

    console.log('\n======================================');
    console.log(`Всего статей в таблице : ${totalInDb.toLocaleString('ru-RU')}`);
    console.log(`Сумма по всем кластерам: ${sum.toLocaleString('ru-RU')}`);
    console.log('======================================');

    // Сверяем значения
    if (totalInDb === sum) {
        console.log('\n✅ ПРОВЕРКА ПРОЙДЕНА: Ни одна статья не потерялась, сумма совпадает!');
    } else {
        console.log('\n❌ ОШИБКА: Сумма кластеров не совпадает с общим количеством статей.');
    }

    db.close();
}

verifyClusters();