// analyze-resolution.js
// Прогоняет Louvain на разных resolution и смотрит, сколько узлов
// покрывают топ-15/16/17 самых крупных кластеров при каждом значении.
// Помогает понять, можно ли просто подобрать resolution так, чтобы
// "Other" естественным образом стал маленьким, без ручного мерджа.

const Database = require('better-sqlite3');
const Graph = require('graphology');
const louvain = require('graphology-communities-louvain');

const RESOLUTIONS_TO_TEST = [0.3, 0.5, 0.8, 1.0, 1.5, 2.0, 2.5, 3.0];
const TOP_N_LIST = [15, 16, 17];

function buildGraph(rows) {
    const titleToId = new Map();
    for (const row of rows) titleToId.set(row.title, row.id);

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
    return graph;
}

function analyze() {
    const db = new Database('simplewiki.db', { readonly: true });

    console.log('Чтение базы...');
    const rows = db.prepare('SELECT id, title, neighbors FROM wiki').all();
    console.log(`Всего узлов: ${rows.length}`);

    console.log('Сборка графа...');
    const graph = buildGraph(rows);
    console.log(`Граф: ${graph.order} узлов, ${graph.size} связей.\n`);

    const totalNodes = rows.length;

    console.log('resolution | кол-во кластеров | top15 % | top16 % | top17 %');
    console.log('-----------|------------------|---------|---------|--------');

    for (const resolution of RESOLUTIONS_TO_TEST) {
        const t0 = Date.now();
        const communities = louvain(graph, { resolution });
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

        const sizes = new Map();
        for (const commId of Object.values(communities)) {
            sizes.set(commId, (sizes.get(commId) || 0) + 1);
        }
        const sorted = [...sizes.values()].sort((a, b) => b - a);

        const coverage = {};
        for (const n of TOP_N_LIST) {
            const covered = sorted.slice(0, n).reduce((a, b) => a + b, 0);
            coverage[n] = ((covered / totalNodes) * 100).toFixed(1);
        }

        console.log(
            `${resolution.toString().padEnd(10)} | ${sizes.size.toString().padEnd(16)} | ` +
            `${coverage[15].padEnd(7)} | ${coverage[16].padEnd(7)} | ${coverage[17].padEnd(6)} ` +
            `(${elapsed}s)`
        );
    }

    db.close();
}

analyze();