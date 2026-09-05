const readline = require('readline');
const Database = require('better-sqlite3');

const DB_NAME = 'simplewiki.db';
const db = new Database(DB_NAME, { readonly: true });

const getById = db.prepare('SELECT * FROM wiki WHERE id = ?');
// COLLATE NOCASE позволяет искать без учета регистра (например, "earth" найдет "Earth")
const getByTitle = db.prepare('SELECT * FROM wiki WHERE title COLLATE NOCASE = ?');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'wiki> '
});

console.log("Интерактивный поиск. Введи ID статьи или её название (например, 'Earth' или '123'). Выход: Ctrl+C.");
rl.prompt();

rl.on('line', (line) => {
    const input = line.trim();
    if (!input) {
        rl.prompt();
        return;
    }

    let result;
    if (/^\d+$/.test(input)) {
        result = getById.get(parseInt(input, 10));
    } else {
        result = getByTitle.get(input);
    }

    if (result) {
        const neighbors = JSON.parse(result.neighbors);
        console.log(`\n📄 ID: ${result.id}`);
        console.log(`📌 Название: ${result.title}`);
        console.log(`🔗 Ссылок: ${neighbors.length}`);

        if (neighbors.length > 0) {
            const preview = neighbors.slice(0, 10).join(', ');
            const suffix = neighbors.length > 10 ? ' и еще ' + (neighbors.length - 10) + '...' : '';
            console.log(`📋 Примеры ссылок: ${preview}${suffix}`);
        }
    } else {
        console.log('\n❌ Статья не найдена.');
    }

    console.log('');
    rl.prompt();
}).on('close', () => {
    db.close();
    console.log('\nВыход.');
    process.exit(0);
});