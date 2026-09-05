const fs = require('fs');
const readline = require('readline');
const Database = require('better-sqlite3');

const DB_NAME = 'simplewiki.db';

// Построчное чтение файла и поиск совпадений по регулярному выражению
async function processFile(filePath, regex, onMatch) {
    const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    for await (const line of rl) {
        if (line.startsWith('INSERT INTO')) {
            for (const match of line.matchAll(regex)) {
                onMatch(match);
            }
        }
    }
}

async function buildWikiDb() {
    const db = new Database(DB_NAME);

    db.exec(`
        CREATE TABLE IF NOT EXISTS wiki (
            id INTEGER PRIMARY KEY,
            title TEXT,
            neighbors TEXT
        );
    `);

    const pages = new Map();
    const targets = new Map();
    const links = new Map();
    const validTitles = new Set(); // Храним реальные названия для быстрой проверки

    let deadLinksCount = 0;
    let validLinksCount = 0;

    console.log("1/4 Чтение страниц (page.sql)...");
    await processFile('simplewiki-latest-page.sql', /\((\d+),0,'((?:[^']|\\')*)'/g, (m) => {
        const id = parseInt(m[1], 10);
        const title = m[2].replace(/\\'/g, "'");
        pages.set(id, title);
        validTitles.add(title);
    });

    console.log("2/4 Чтение целей ссылок (linktarget.sql)...");
    await processFile('simplewiki-latest-linktarget.sql', /\((\d+),0,'((?:[^']|\\')*)'/g, (m) => {
        targets.set(parseInt(m[1], 10), m[2].replace(/\\'/g, "'"));
    });

    console.log("3/4 Чтение связей (pagelinks.sql)...");
    await processFile('simplewiki-latest-pagelinks.sql', /\((\d+),0,(\d+)\)/g, (m) => {
        const fromId = parseInt(m[1], 10);
        const targetId = parseInt(m[2], 10);

        if (pages.has(fromId) && targets.has(targetId)) {
            const targetTitle = targets.get(targetId);

            // Если статья с таким названием реально существует в базе
            if (validTitles.has(targetTitle)) {
                if (!links.has(fromId)) {
                    links.set(fromId, []);
                }
                links.get(fromId).push(targetTitle);
                validLinksCount++;
            } else {
                deadLinksCount++;
            }
        }
    });

    console.log("4/4 Сохранение в SQLite...");
    const insertStmt = db.prepare('INSERT OR REPLACE INTO wiki (id, title, neighbors) VALUES (?, ?, ?)');

    const insertMany = db.transaction(() => {
        for (const [id, title] of pages.entries()) {
            const neighbors = links.get(id) || [];
            insertStmt.run(id, title, JSON.stringify(neighbors));
        }
    });

    insertMany();

    db.exec('CREATE INDEX IF NOT EXISTS idx_title ON wiki(title);');
    db.close();

    // Вывод статистики
    console.log(`\n📊 Статистика сборки:`);
    console.log(`✅ Всего реальных статей: ${pages.size}`);
    console.log(`🔗 Валидных ссылок между статьями: ${validLinksCount}`);
    console.log(`🗑️ Удалено "мертвых" ссылок: ${deadLinksCount}`);
    console.log(`💾 База сохранена в ${DB_NAME}`);
}

buildWikiDb().catch(console.error);