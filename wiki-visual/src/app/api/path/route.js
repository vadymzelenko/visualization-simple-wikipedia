import { NextResponse } from 'next/server';
import { Pool } from 'pg';

const globalForPool = globalThis;

const pool =
    globalForPool._pgPool ||
    new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
        max: 5,
    });

if (process.env.NODE_ENV !== 'production') {
    globalForPool._pgPool = pool;
}

const MAX_HOPS = 6;
const MAX_FRONTIER_SIZE = 20000;

// Достаёт ВСЕХ соседей (исходящие + входящие) для батча узлов -
// граф трактуется как неориентированный: если A ссылается на B,
// считаем что можно пройти и B -> A тоже.
// Возвращает Map<id, number[]> - для каждого id из ids его соседи.
async function getUndirectedNeighborsBatch(client, ids) {
    if (ids.length === 0) return new Map();

    const result = await client.query(
        `
        -- Исходящие: id -> его neighbor_ids
        SELECT id AS src, unnest(neighbor_ids) AS dst
        FROM wiki
        WHERE id = ANY($1::int[]) AND neighbor_ids IS NOT NULL

        UNION ALL

        -- Входящие: кто ссылается на id (те строки, где neighbor_ids содержит id)
        SELECT unnest(matched) AS src, w.id AS dst
        FROM wiki w
        CROSS JOIN LATERAL (
            SELECT array_agg(x) AS matched
            FROM unnest($1::int[]) AS x
            WHERE x = ANY(w.neighbor_ids)
        ) m
        WHERE w.neighbor_ids && $1::int[]
        `,
        [ids]
    );

    const map = new Map();
    for (const row of result.rows) {
        if (!map.has(row.src)) map.set(row.src, []);
        map.get(row.src).push(row.dst);
    }
    return map;
}

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const startId = parseInt(searchParams.get('start'), 10);
    const endId = parseInt(searchParams.get('end'), 10);

    if (!startId || !endId) {
        return NextResponse.json({ error: 'Missing IDs' }, { status: 400 });
    }

    if (startId === endId) {
        return NextResponse.json({ path: [startId] });
    }

    const client = await pool.connect();
    try {
        const headVisited = new Map([[startId, null]]);
        const tailVisited = new Map([[endId, null]]);

        let headFrontier = [startId];
        let tailFrontier = [endId];

        let intersectNode = null;

        for (let hop = 0; hop < MAX_HOPS; hop++) {
            if (headFrontier.length === 0 || tailFrontier.length === 0) break;

            // --- Растим фронтир от старта (в обе стороны) ---
            const headNeighborsMap = await getUndirectedNeighborsBatch(client, headFrontier);
            const nextHeadFrontier = [];
            for (const [src, neighbors] of headNeighborsMap) {
                for (const n of neighbors) {
                    if (!headVisited.has(n)) {
                        headVisited.set(n, src);
                        nextHeadFrontier.push(n);
                        if (tailVisited.has(n)) {
                            intersectNode = n;
                            break;
                        }
                    }
                }
                if (intersectNode) break;
            }
            if (intersectNode) break;

            if (nextHeadFrontier.length > MAX_FRONTIER_SIZE) {
                return NextResponse.json({ error: 'Граф слишком плотный для поиска' }, { status: 504 });
            }
            headFrontier = nextHeadFrontier;

            // --- Растим фронтир от конца (в обе стороны) ---
            const tailNeighborsMap = await getUndirectedNeighborsBatch(client, tailFrontier);
            const nextTailFrontier = [];
            for (const [src, neighbors] of tailNeighborsMap) {
                for (const n of neighbors) {
                    if (!tailVisited.has(n)) {
                        tailVisited.set(n, src);
                        nextTailFrontier.push(n);
                        if (headVisited.has(n)) {
                            intersectNode = n;
                            break;
                        }
                    }
                }
                if (intersectNode) break;
            }
            if (intersectNode) break;

            if (nextTailFrontier.length > MAX_FRONTIER_SIZE) {
                return NextResponse.json({ error: 'Граф слишком плотный для поиска' }, { status: 504 });
            }
            tailFrontier = nextTailFrontier;
        }

        if (!intersectNode) {
            return NextResponse.json({ error: 'Статьи не связаны между собой' }, { status: 404 });
        }

        const pathArr = [];
        let curr = intersectNode;
        while (curr !== null) {
            pathArr.unshift(curr);
            curr = headVisited.get(curr);
        }

        curr = tailVisited.get(intersectNode);
        while (curr !== null) {
            pathArr.push(curr);
            curr = tailVisited.get(curr);
        }

        return NextResponse.json({ path: pathArr });
    } catch (err) {
        console.error('Pathfinding error:', err);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    } finally {
        client.release();
    }
}