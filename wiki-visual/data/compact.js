const Database = require('better-sqlite3');
const db = new Database('simplewiki.db');

console.log("Сжатие базы и перенумерация ID...");

// Создаем новую таблицу, переносим отсортированные данные и подменяем оригинал
db.exec(`
    CREATE TABLE wiki_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        neighbors TEXT
    );

    INSERT INTO wiki_new (title, neighbors)
    SELECT title, neighbors FROM wiki ORDER BY id;

    DROP TABLE wiki;
    ALTER TABLE wiki_new RENAME TO wiki;
    
    CREATE INDEX idx_title ON wiki(title);
    VACUUM; -- Физически сжимает файл базы, удаляя пустоты на диске
`);

console.log("Готово! Пропуски удалены, ID идут строго по порядку.");
db.close();