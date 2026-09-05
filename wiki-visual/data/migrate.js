// ---------- КОНФИГУРАЦИЯ ----------
const SQLITE_DB = 'simplewiki.db';
const PG_CONNECTION =
    'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';



const Database = require('better-sqlite3');
const { Client } = require('pg');

const BATCH_SIZE = 5000;

const sqlite = new Database(SQLITE_DB, { readonly: true });

async function migrate() {
    const client = new Client({
        connectionString: PG_CONNECTION,
        ssl: { rejectUnauthorized: false }
    });
    await client.connect();

    await client.query('SET synchronous_commit = OFF');
    await client.query('SET work_mem = "256MB"');
    await client.query('SET maintenance_work_mem = "1GB"');

    try {
        const tables = sqlite.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name != 'sqlite_sequence'"
        ).all();

        for (const { name: tableName } of tables) {
            console.log(`\n> Миграция таблицы: ${tableName}`);

            const existsRes = await client.query(
                `SELECT EXISTS (SELECT 1 FROM information_schema.tables 
         WHERE table_name = $1 AND table_schema = 'public')`,
                [tableName]
            );
            if (!existsRes.rows[0].exists) {
                console.log(`⚠️ Таблица ${tableName} отсутствует в Postgres – пропускаем.`);
                continue;
            }

            const rows = sqlite.prepare(`SELECT * FROM "${tableName}"`).all();
            if (rows.length === 0) {
                console.log(`Таблица ${tableName} пуста, пропуск.`);
                continue;
            }

            const columns = Object.keys(rows[0]);
            const colsFormatted = columns.map(c => `"${c}"`).join(', ');

            // Сохраняем индексы (кроме PK) и дропаем
            const idxRes = await client.query(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE tablename = $1 AND schemaname = 'public'
          AND indexname NOT LIKE '%_pkey'
      `, [tableName]);

            const indexes = idxRes.rows;
            if (indexes.length > 0) {
                console.log(`  🗑️ Дропаем индексы: ${indexes.map(i => i.indexname).join(', ')}`);
                for (const idx of indexes) {
                    await client.query(`DROP INDEX IF EXISTS "${idx.indexname}"`);
                }
            }

            // Если хотите очистить таблицу перед загрузкой – раскомментируйте:
            // await client.query(`TRUNCATE TABLE "${tableName}" RESTART IDENTITY CASCADE`);

            await client.query('BEGIN');

            try {
                for (let i = 0; i < rows.length; i += BATCH_SIZE) {
                    const batch = rows.slice(i, i + BATCH_SIZE);
                    let paramIndex = 1;
                    const valueClauses = [];
                    const allValues = [];

                    for (const row of batch) {
                        const placeholders = columns.map(() => `$${paramIndex++}`).join(', ');
                        valueClauses.push(`(${placeholders})`);
                        for (const col of columns) {
                            allValues.push(row[col]);
                        }
                    }

                    const query = `
            INSERT INTO "${tableName}" (${colsFormatted})
            VALUES ${valueClauses.join(', ')}
            ON CONFLICT DO NOTHING
          `;

                    await client.query(query, allValues);
                }

                await client.query('COMMIT');
                console.log(`✔ Таблица ${tableName} загружена (${rows.length} строк).`);

                if (indexes.length > 0) {
                    console.log(`  🔄 Восстанавливаем индексы...`);
                    for (const idx of indexes) {
                        await client.query(idx.indexdef);
                    }
                }

            } catch (err) {
                await client.query('ROLLBACK');
                console.error(`❌ Ошибка в таблице ${tableName}: ${err.message}`);
            }
        }

        console.log('\n✨ Миграция завершена!');

    } finally {
        await client.end();
        sqlite.close();
    }
}

migrate().catch(console.error);