# Simple Wikipedia Graph

An interactive 3D map of Simple English Wikipedia. Every article is a node, every internal link is an edge, and articles are grouped into topic clusters. The app finds and draws the shortest chain of links between any two articles.

Live: https://visualization-simple-wikipedia.vercel.app/

## Features

- 3D force-directed graph of the article network, coloured by cluster
- Article search with suggestions for the start and end points
- Shortest path between two articles: breadth-first search over the link graph (treated as undirected), up to 6 hops
- Topic clusters computed with the Louvain community detection algorithm
- Node list loaded once and cached in server memory; path queries batched against PostgreSQL

## Stack

Next.js 16 (App Router), React 19, react-force-graph-3d (Three.js), PostgreSQL (Neon), better-sqlite3 and graphology for offline data processing.

## Data pipeline

The graph is built offline from the official Wikipedia SQL dumps and then loaded into PostgreSQL. Scripts live in `wiki-visual/data/` and run from that directory.

1. Download `simplewiki-latest-page.sql`, `simplewiki-latest-linktarget.sql` and `simplewiki-latest-pagelinks.sql` from https://dumps.wikimedia.org/simplewiki/latest/.
2. `node createdb.js` parses the dumps into a SQLite database (`simplewiki.db`): one row per article with its title and neighbour ids.
3. `node compact.js` renumbers article ids into a dense range.
4. `node clusters.js` runs Louvain community detection and stores a `cluster_id` for each article.
5. `node migrate.js` copies the table into PostgreSQL (`DATABASE_URL` from `.env`).

## Running locally

```bash
cd wiki-visual
cp .env.example .env.local     # DATABASE_URL of the PostgreSQL database
npm install
npm run dev                    # http://localhost:3000
```

## API

| Endpoint | Description |
|---|---|
| `GET /api/nodes` | All articles with id, title and cluster |
| `GET /api/path?start=<id>&end=<id>` | Shortest link path between two articles |

## License

[MIT](LICENSE) © Vadym Zelenko. Wikipedia content is available under CC BY-SA 4.0.
