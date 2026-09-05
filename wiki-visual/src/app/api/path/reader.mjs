import Database from 'better-sqlite3';
import path from 'path';

// Жестко указываем путь к корню проекта, где лежит папка data
const dbPath = '/data/wiki.sqlite';
const db = new Database(dbPath, { readonly: true });

const command = process.argv[2];
const arg1 = process.argv[3];
const arg2 = process.argv[4];

if (!command) {
    console.log(`
📖 Использование консольной читалки wiki.sqlite:
  1. Поиск статьи:     node reader.mjs search "название"
  2. Просмотр связей:  node reader.mjs links <ID или точное название>
  3. Поиск пути:       node reader.mjs path "Статья 1" "Статья 2"
    `);
    process.exit(0);
}

// 1. ПОИСК СТАТЕЙ ПО ПОДСТРОКЕ
if (command === 'search') {
    if (!arg1) { console.log('❌ Укажите поисковый запрос'); process.exit(1); }
    const stmt = db.prepare('SELECT page_id, page_title FROM pages WHERE page_title LIKE ? LIMIT 20');
    const results = stmt.all(`%${arg1}%`);
    console.log(`🔍 Найдено страниц (${results.length}):`);
    results.forEach(r => console.log(`  [ID: ${r.page_id}] ${r.page_title}`));
}

// 2. ПРОСМОТР СВЯЗЕЙ СТАТЬИ (куда ссылается и кто ссылается)
else if (command === 'links') {
    if (!arg1) { console.log('❌ Укажите ID или название статьи'); process.exit(1); }

    let page = isNaN(arg1)
        ? db.prepare('SELECT * FROM pages WHERE page_title = ?').get(arg1)
        : db.prepare('SELECT * FROM pages WHERE page_id = ?').get(parseInt(arg1, 10));

    if (!page) { console.log('❌ Страница не найдена в базе'); process.exit(1); }

    console.log(`\n📄 Страница: [ID: ${page.page_id}] ${page.page_title}`);

    // Исходящие ссылки
    const out = db.prepare(`
        SELECT p.page_id, p.page_title 
        FROM edges e 
        JOIN pages p ON e.target_id = p.page_id 
        WHERE e.source_id = ? LIMIT 15
    `).all(page.page_id);

    console.log(`\n➡️ Ссылается на статьи (${out.length} показано):`);
    out.forEach(r => console.log(`    - [ID: ${r.page_id}] ${r.page_title}`));

    // Входящие ссылки
    const inc = db.prepare(`
        SELECT p.page_id, p.page_title 
        FROM edges e 
        JOIN pages p ON e.source_id = p.page_id 
        WHERE e.target_id = ? LIMIT 15
    `).all(page.page_id);

    console.log(`\n⬅️ Ссылаются сюда (${inc.length} показано):`);
    inc.forEach(r => console.log(`    - [ID: ${r.page_id}] ${r.page_title}`));
}

// 3. БЫСТРЫЙ ПОИСК ПУТИ МЕЖДУ СТАТЬЯМИ ПО НАЗВАНИЯМ
else if (command === 'path') {
    if (!arg1 || !arg2) { console.log('❌ Укажите начальную и конечную статью'); process.exit(1); }

    const startRow = db.prepare('SELECT page_id FROM pages WHERE page_title = ?').get(arg1);
    const endRow = db.prepare('SELECT page_id FROM pages WHERE page_title = ?').get(arg2);

    if (!startRow || !endRow) {
        console.error('❌ Одна или обе статьи не найдены в базе (проверьте точность названия, включая регистр).');
        process.exit(1);
    }

    const startId = startRow.page_id;
    const endId = endRow.page_id;

    console.log(`🔍 Ищем путь: "${arg1}" -> "${arg2}"...`);
    const searchStart = performance.now();

    const getOutbound = db.prepare('SELECT target_id FROM edges WHERE source_id = ?');
    const getInbound = db.prepare('SELECT source_id FROM edges WHERE target_id = ?');

    const headQueue = [startId];
    const tailQueue = [endId];
    const headVisited = new Map([[startId, null]]);
    const tailVisited = new Map([[endId, null]]);
    let intersectNode = null;
    let headIdx = 0, tailIdx = 0;

    while (headIdx < headQueue.length && tailIdx < tailQueue.length) {
        const headCurrent = headQueue[headIdx++];
        for (const row of getOutbound.all(headCurrent)) {
            const neighbor = row.target_id;
            if (!headVisited.has(neighbor)) {
                headVisited.set(neighbor, headCurrent);
                headQueue.push(neighbor);
                if (tailVisited.has(neighbor)) { intersectNode = neighbor; break; }
            }
        }
        if (intersectNode) break;

        const tailCurrent = tailQueue[tailIdx++];
        for (const row of getInbound.all(tailCurrent)) {
            const neighbor = row.source_id;
            if (!tailVisited.has(neighbor)) {
                tailVisited.set(neighbor, tailCurrent);
                tailQueue.push(neighbor);
                if (headVisited.has(neighbor)) { intersectNode = neighbor; break; }
            }
        }
        if (intersectNode) break;
        if (headQueue.length + tailQueue.length > 500000) break;
    }

    if (!intersectNode) {
        console.error('❌ Путь между этими статьями не найден.');
        process.exit(1);
    }

    const pathIds = [];
    let curr = intersectNode;
    while (curr !== null) { pathIds.unshift(curr); curr = headVisited.get(curr); }
    curr = tailVisited.get(intersectNode);
    curr = tailVisited.get(curr);
    while (curr !== null) { pathIds.push(curr); curr = tailVisited.get(curr); }

    const getTitle = db.prepare('SELECT page_title FROM pages WHERE page_id = ?');
    const pathTitles = pathIds.map(id => getTitle.get(id)?.page_title || `ID:${id}`);

    console.log(`\n✅ Путь найден за ${(performance.now() - searchStart).toFixed(2)}ms (${pathTitles.length - 1} шагов):\n`);
    console.log(pathTitles.join(' ➔ '));
}
else {
    console.log('❌ Неизвестная команда. Используйте: search, links или path');
}