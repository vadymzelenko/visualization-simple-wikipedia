// merge-clusters.js
// Замена clusters.js. Логика:
// 1. Гоняем Louvain с довольно высоким resolution — получаем МНОГО мелких
//    "сырых" сообществ (это сырьё для мерджа, а не финальный результат).
// 2. Строим граф сообществ: вес ребра между двумя сообществами = кол-во
//    реальных wiki-ссылок, которые их соединяют.
// 3. Пока сообществ больше TARGET_CLUSTERS — берём самое маленькое живое
//    сообщество и приклеиваем его к тому соседнему сообществу, с которым
//    у него больше всего перекрёстных связей (а не просто в "Other").
// 4. Изолированные сообщества без исходящих связей (редкость) приклеиваются
//    к самому крупному кластеру как fallback.
//
// Результат: ровно TARGET_CLUSTERS кластеров, Other практически = 0%,
// потому что каждый мелкий кусок графа "прилип" туда, куда у него
// реально больше всего ссылок, а не был выброшен.

const Database = require('better-sqlite3');
const Graph = require('graphology');
const louvain = require('graphology-communities-louvain');

// ---- НАСТРОЙКИ ----
const TARGET_CLUSTERS = 16;      // сколько кластеров хотим на выходе (15-17)
const BASE_RESOLUTION = 3.0;     // resolution для "сырой" нарезки перед мерджем
const TOP_TITLES_PER_CLUSTER = 25;

class DSU {
    constructor() { this.parent = new Map(); }
    find(x) {
        if (!this.parent.has(x)) this.parent.set(x, x);
        let root = x;
        while (this.parent.get(root) !== root) root = this.parent.get(root);
        let cur = x;
        while (this.parent.get(cur) !== root) {
            const next = this.parent.get(cur);
            this.parent.set(cur, root);
            cur = next;
        }
        return root;
    }
}

function mergeCommunities() {
    const db = new Database('simplewiki.db');

    console.log('1/5 Чтение базы...');
    const rows = db.prepare('SELECT id, title, neighbors FROM wiki').all();

    const titleToId = new Map();
    const idToTitle = new Map();
    for (const row of rows) {
        titleToId.set(row.title, row.id);
        idToTitle.set(row.id, row.title);
    }

    console.log('2/5 Сборка графа...');
    const graph = new Graph({ multi: false, type: 'undirected' });
    for (const row of rows) graph.addNode(row.id);

    for (const row of rows) {
        let neighbors = [];
        try { neighbors = JSON.parse(row.neighbors || '[]'); } catch (e) {}
        for (const nbTitle of neighbors) {
            const targetId = titleToId.get(nbTitle);
            if (targetId && targetId !== row.id && !graph.hasEdge(row.id, targetId)) {
                graph.addEdge(row.id, targetId);
            }
        }
    }
    console.log(`   Граф: ${graph.order} узлов, ${graph.size} связей.`);

    console.log(`3/5 Базовая кластеризация Louvain (resolution=${BASE_RESOLUTION})...`);
    const t0 = Date.now();
    const baseCommunities = louvain(graph, { resolution: BASE_RESOLUTION });
    console.log(`   Готово за ${((Date.now() - t0) / 1000).toFixed(1)} сек.`);

    // Префиксуем id сообществ, чтобы не путать их с node id в DSU
    const nodeComm = new Map(); // nodeId(number) -> commKey(string)
    for (const [nodeIdStr, commId] of Object.entries(baseCommunities)) {
        nodeComm.set(parseInt(nodeIdStr, 10), 'c_' + commId);
    }

    const baseCommIds = new Set(nodeComm.values());
    console.log(`   Базовых сообществ: ${baseCommIds.size}`);

    if (baseCommIds.size < TARGET_CLUSTERS) {
        console.log(`   ВНИМАНИЕ: базовых сообществ (${baseCommIds.size}) меньше, чем TARGET_CLUSTERS (${TARGET_CLUSTERS}).`);
        console.log('   Подними BASE_RESOLUTION, чтобы получить больше сырых кластеров для мерджа.');
        db.close();
        return;
    }

    console.log('4/5 Построение графа сообществ и мердж...');

    const dsu = new DSU();
    for (const c of baseCommIds) dsu.find(c);

    const size = new Map();
    for (const c of baseCommIds) size.set(c, 0);
    for (const c of nodeComm.values()) size.set(c, size.get(c) + 1);

    // adjacency[root] = Map(neighborRoot -> вес = кол-во ссылок между кластерами)
    const adjacency = new Map();
    for (const c of baseCommIds) adjacency.set(c, new Map());

    graph.forEachEdge((edge, attr, source, target) => {
        const cs = nodeComm.get(parseInt(source, 10));
        const ct = nodeComm.get(parseInt(target, 10));
        if (cs === ct) return;
        adjacency.get(cs).set(ct, (adjacency.get(cs).get(ct) || 0) + 1);
        adjacency.get(ct).set(cs, (adjacency.get(ct).get(cs) || 0) + 1);
    });

    const liveRoots = new Set(baseCommIds);

    function mergeInto(smallRoot, bigRoot) {
        dsu.parent.set(smallRoot, bigRoot);
        size.set(bigRoot, size.get(bigRoot) + size.get(smallRoot));

        const mapSmall = adjacency.get(smallRoot);
        const mapBig = adjacency.get(bigRoot);
        for (const [nb, w] of mapSmall) {
            if (nb === bigRoot) continue;
            mapBig.set(nb, (mapBig.get(nb) || 0) + w);
            const nbMap = adjacency.get(nb);
            if (nbMap) {
                nbMap.delete(smallRoot);
                nbMap.set(bigRoot, (nbMap.get(bigRoot) || 0) + w);
            }
        }
        mapBig.delete(smallRoot);
        adjacency.delete(smallRoot);
        liveRoots.delete(smallRoot);
    }

    while (liveRoots.size > TARGET_CLUSTERS) {
        let minRoot = null, minSize = Infinity;
        for (const r of liveRoots) {
            const s = size.get(r);
            if (s < minSize) { minSize = s; minRoot = r; }
        }

        const neighbors = adjacency.get(minRoot);
        let bestNb = null, bestW = -1;
        for (const [nb, w] of neighbors) {
            if (w > bestW) { bestW = w; bestNb = nb; }
        }

        if (bestNb === null) {
            // изолированный кусок без исходящих связей — крепим к самому крупному
            let maxRoot = null, maxSize = -1;
            for (const r of liveRoots) {
                if (r === minRoot) continue;
                if (size.get(r) > maxSize) { maxSize = size.get(r); maxRoot = r; }
            }
            bestNb = maxRoot;
        }

        mergeInto(minRoot, bestNb);
    }

    console.log(`   Итог: ${liveRoots.size} кластеров.`);

    const finalRoots = [...liveRoots].sort((a, b) => size.get(b) - size.get(a));
    const rootToFinalId = new Map();
    finalRoots.forEach((r, i) => rootToFinalId.set(r, i));

    console.log('5/5 Запись cluster_id в базу...');
    try { db.exec('ALTER TABLE wiki ADD COLUMN cluster_id INTEGER DEFAULT 0'); } catch (e) {}

    const updateStmt = db.prepare('UPDATE wiki SET cluster_id = ? WHERE id = ?');
    const updateMany = db.transaction(() => {
        for (const row of rows) {
            const baseC = nodeComm.get(row.id);
            const root = dsu.find(baseC);
            updateStmt.run(rootToFinalId.get(root), row.id);
        }
    });
    updateMany();

    const totalNodes = rows.length;
    console.log('\n=== ИТОГОВЫЕ КЛАСТЕРЫ (размер, % от базы) ===');
    finalRoots.forEach((r, i) => {
        const pct = ((size.get(r) / totalNodes) * 100).toFixed(1);
        console.log(`Кластер ${i}: ${size.get(r)} узлов (${pct}%)`);
    });

    console.log('\n=== СКОПИРУЙ ЭТО В ЧАТ ДЛЯ ИМЕНОВАНИЯ КЛАСТЕРОВ ===');
    const clusterNodes = new Map();
    for (const row of rows) {
        const finalId = rootToFinalId.get(dsu.find(nodeComm.get(row.id)));
        if (!clusterNodes.has(finalId)) clusterNodes.set(finalId, []);
        clusterNodes.get(finalId).push(row.id);
    }

    for (let i = 0; i < finalRoots.length; i++) {
        const nodeIds = clusterNodes.get(i) || [];
        const topTitles = nodeIds
            .map(id => ({ id, degree: graph.degree(id) }))
            .sort((a, b) => b.degree - a.degree)
            .slice(0, TOP_TITLES_PER_CLUSTER)
            .map(o => idToTitle.get(o.id));
        console.log(`Кластер ${i} (${size.get(finalRoots[i])} узлов): ${topTitles.join(', ')}`);
    }

    db.close();
}

mergeCommunities();