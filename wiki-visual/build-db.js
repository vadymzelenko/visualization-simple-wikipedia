const fs = require('fs');
const path = require('path');
const readline = require('readline');
const Database = require('better-sqlite3');

// Настраиваем пути к файлам и базе данных
const dataDir = path.join(__dirname, 'data');
const pageSqlPath = path.join(dataDir, 'simplewiki-latest-page.sql');
const pagelinksSqlPath = path.join(dataDir, 'simplewiki-latest-pagelinks.sql');
const dbPath = path.join(dataDir, 'wiki.sqlite');

async function buildDatabase() {
    console.log('🚀 Начинаем сборку базы данных...');

    // Удаляем старую базу, если она существует, чтобы начать с чистого листа
    if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
    }

    const db = new Database(dbPath);

    // Отключаем синхронизацию с диском для максимальной скорости записи
    db.pragma('journal_mode = OFF');
    db.pragma('synchronous = 0');

    // Создаем таблицы
    db.exec(`
    CREATE TABLE pages (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL
    );
    CREATE TABLE edges (
      source_id INTEGER,
      target_id INTEGER
    );
  `);

    const insertPage = db.prepare('INSERT INTO pages (id, title) VALUES (?, ?)');
    const insertEdge = db.prepare('INSERT INTO edges (source_id, target_id) VALUES (?, ?)');

    // Хэш-таблица для быстрого маппинга "Название -> ID"
    const titleToIdMap = new Map();
    let pagesCount = 0;
    let edgesCount = 0;

    // --- ШАГ 1: Парсим узлы (pages) ---
    console.log('\n📄 Читаем page.sql...');
    const pageStream = readline.createInterface({
        input: fs.createReadStream(pageSqlPath),
        crlfDelay: Infinity
    });

    // Оборачиваем в транзакцию для ускорения в 1000 раз
    const processPages = db.transaction((lines) => {
        for (const line of lines) {
            if (!line.startsWith('INSERT INTO `page`')) continue;

            // Регулярка ищет паттерн: (ID, 0, 'Название'
            // 0 означает, что это обычная статья (namespace 0)
            const regex = /\((\d+),0,'((?:[^']|\\')*)'/g;
            let match;

            while ((match = regex.exec(line)) !== null) {
                const id = parseInt(match[1], 10);
                const title = match[2].replace(/\\'/g, "'"); // Восстанавливаем экранированные кавычки

                insertPage.run(id, title);
                titleToIdMap.set(title, id);
                pagesCount++;
            }
        }
    });

    const pageLines = [];
    for await (const line of pageStream) {
        pageLines.push(line);
    }
    processPages(pageLines);
    console.log(`✅ Найдено статей: ${pagesCount}`);


    // --- ШАГ 2: Парсим связи (pagelinks) ---
    console.log('\n🔗 Читаем pagelinks.sql...');
    const linkStream = readline.createInterface({
        input: fs.createReadStream(pagelinksSqlPath),
        crlfDelay: Infinity
    });

    const processEdges = db.transaction((lines) => {
        for (const line of lines) {
            if (!line.startsWith('INSERT INTO `pagelinks`')) continue;

            // Регулярка ищет паттерн: (source_id, 0, 'Target_Title' ИЛИ target_id
            // В новых дампах вместо текста может быть ID
            const regex = /\((\d+),0,('((?:[^']|\\')*)'|\d+)/g;
            let match;

            while ((match = regex.exec(line)) !== null) {
                const sourceId = parseInt(match[1], 10);
                const targetRaw = match[2];

                let targetId = null;

                if (targetRaw.startsWith("'")) {
                    // Если цель — строка, ищем ее ID в нашей хэш-таблице
                    const targetTitle = match[3].replace(/\\'/g, "'");
                    targetId = titleToIdMap.get(targetTitle);
                } else {
                    // Если цель — уже ID (число)
                    targetId = parseInt(targetRaw, 10);
                }

                // Записываем связь, только если обе статьи существуют
                if (targetId && titleToIdMap.has(targetRaw.startsWith("'") ? match[3].replace(/\\'/g, "'") : null) || targetId) {
                    insertEdge.run(sourceId, targetId);
                    edgesCount++;
                }
            }
        }
    });

    const linkLines = [];
    for await (const line of linkStream) {
        linkLines.push(line);
    }
    processEdges(linkLines);
    console.log(`✅ Создано связей: ${edgesCount}`);


    // --- ШАГ 3: Создаем индексы для мгновенного поиска ---
    console.log('\n⚡ Строим индексы...');
    db.exec(`
    CREATE INDEX idx_title ON pages(title);
    CREATE INDEX idx_source ON edges(source_id);
    CREATE INDEX idx_target ON edges(target_id);
  `);

    db.close();
    console.log('\n🎉 Готово! База wiki.sqlite собрана и готова к работе.');
}

buildDatabase().catch(console.error);