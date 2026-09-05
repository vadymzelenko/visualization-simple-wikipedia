import Database from 'better-sqlite3';

const dbPath = '/Users/vzbb/WebstormProjects/wiki-visual/data/wiki.sqlite';
const db = new Database(dbPath, { readonly: true });

// Подготавливаем быстрые запросы к БД
const getOutboundStmt = db.prepare('SELECT target_id FROM edges WHERE source_id = ?');
const getInboundStmt = db.prepare('SELECT source_id FROM edges WHERE target_id = ?');

function findPathLazy(startId, endId) {
    const headQueue = [startId];
    const tailQueue = [endId];

    const headVisited = new Map([[startId, null]]);
    const tailVisited = new Map([[endId, null]]);

    let intersectNode = null;
    let headIdx = 0;
    let tailIdx = 0;

    console.log(`🔍 Поиск пути: ${startId} -> ${endId}...`);
    const searchStart = performance.now();

    while (headIdx < headQueue.length && tailIdx < tailQueue.length) {
        // Шаг со стороны start (ищем куда можно перейти)
        const headCurrent = headQueue[headIdx++];
        const headNeighbors = getOutboundStmt.all(headCurrent);

        for (const row of headNeighbors) {
            const neighbor = row.target_id;
            if (!headVisited.has(neighbor)) {
                headVisited.set(neighbor, headCurrent);
                headQueue.push(neighbor);
                if (tailVisited.has(neighbor)) {
                    intersectNode = neighbor;
                    break;
                }
            }
        }
        if (intersectNode) break;

        // Шаг со стороны end (ищем откуда можно прийти)
        const tailCurrent = tailQueue[tailIdx++];
        const tailNeighbors = getInboundStmt.all(tailCurrent);

        for (const row of tailNeighbors) {
            const neighbor = row.source_id;
            if (!tailVisited.has(neighbor)) {
                tailVisited.set(neighbor, tailCurrent);
                tailQueue.push(neighbor);
                if (headVisited.has(neighbor)) {
                    intersectNode = neighbor;
                    break;
                }
            }
        }
        if (intersectNode) break;

        if (headQueue.length + tailQueue.length > 500000) break;
    }

    if (!intersectNode) {
        console.error('❌ Путь не найден.');
        return [];
    }

    const pathArr = [];
    let curr = intersectNode;
    while (curr !== null) {
        pathArr.unshift(curr);
        curr = headVisited.get(curr);
    }

    curr = tailVisited.get(intersectNode);
    // Пропускаем первый элемент, так как intersectNode уже добавлен
    curr = tailVisited.get(curr);
    while (curr !== null) {
        pathArr.push(curr);
        curr = tailVisited.get(curr);
    }

    console.log(`✅ Путь найден за ${(performance.now() - searchStart).toFixed(2)}ms (${pathArr.length - 1} шагов)`);
    return pathArr;
}

// Замени на реальные ID из твоей базы
const startNode = 12;
const endNode = 34;

console.log(findPathLazy(startNode, endNode));