const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, 'simplewiki.db');
const db = new Database(dbPath, { readonly: true });

// Топ-10 крупных кластеров, которые пока без имени
const missingClusters = [27, 10, 14, 16, 39, 37, 3, 30, 0, 32];

console.log("=== СКОПИРУЙ ЭТО В ЧАТ ===");
for (const cid of missingClusters) {
    const rows = db.prepare(`
        SELECT title FROM wiki 
        WHERE cluster_id = ? 
        ORDER BY length(neighbors) DESC 
        LIMIT 25
    `).all(cid);

    console.log(`Кластер ${cid}: ${rows.map(r => r.title).join(', ')}`);
}
db.close();