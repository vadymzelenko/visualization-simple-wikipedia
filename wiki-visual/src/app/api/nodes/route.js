import { NextResponse } from 'next/server';
import { Pool } from 'pg';

// Переиспользуем Pool между hot-reload'ами в dev через globalThis,
// иначе каждый Fast Refresh создаёт новый Pool и плодит соединения к Neon.
const globalForPool = globalThis;

const pool =
    globalForPool._pgPool ||
    new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
        max: 5, // не открываем больше 5 соединений
    });

if (process.env.NODE_ENV !== 'production') {
    globalForPool._pgPool = pool;
}

// Кэшируем сами узлы в памяти — тянем из Neon только один раз за жизнь процесса
let cachedNodes = globalForPool._cachedNodes || null;

export async function GET() {
    if (cachedNodes) {
        return NextResponse.json(cachedNodes);
    }

    try {
        console.log('🔄 Загрузка узлов из Neon в RAM...');
        const start = performance.now();

        const client = await pool.connect();
        let rows;
        try {
            const result = await client.query('SELECT id, title, cluster_id FROM wiki');
            rows = result.rows;
        } finally {
            client.release();
        }

        console.log(`⚡ Узлы загружены за ${(performance.now() - start).toFixed(2)}ms, count=${rows.length}`);

        cachedNodes = rows;
        if (process.env.NODE_ENV !== 'production') {
            globalForPool._cachedNodes = cachedNodes;
        }

        return NextResponse.json(cachedNodes);
    } catch (err) {
        console.error('Database error:', err);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}