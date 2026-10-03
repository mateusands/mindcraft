import { createHash } from 'crypto';
import { readFileSync, mkdirSync } from 'fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import * as sqliteVec from 'sqlite-vec';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_KNOWLEDGE_PATH = path.join(__dirname, '../../../knowledge/minecraft_basics.json');

function tokens(value) {
    return new Set(String(value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .match(/[a-z0-9_]+/g) || []);
}

function vectorBlob(vector) {
    return Buffer.from(new Float32Array(vector).buffer);
}

function contentHash(entry) {
    return createHash('sha256').update([
        entry.id,
        entry.category || 'general',
        entry.version_scope || 'java-modern',
        entry.source_url || '',
        entry.keywords,
        entry.text
    ].join('\n')).digest('hex');
}

export class MinecraftKnowledge {
    constructor(embeddingModel = null, options = {}) {
        this.embeddingModel = embeddingModel;
        this.embeddingModelName = options.embeddingModel || 'none';
        this.databasePath = options.databasePath || './bots/shared/minecraft_knowledge.sqlite';
        this.dimensions = options.dimensions || 2048;
        this.knowledgePath = options.knowledgePath || DEFAULT_KNOWLEDGE_PATH;
        this.entries = [];
        this.db = null;
        this.vectorReady = false;
        this.vectorSchemaReset = false;
    }

    async init() {
        this.entries = JSON.parse(readFileSync(this.knowledgePath, 'utf8'));
        mkdirSync(path.dirname(this.databasePath), { recursive: true });
        this.db = new DatabaseSync(this.databasePath, { allowExtension: true });
        sqliteVec.load(this.db);
        this.db.exec(`
            PRAGMA journal_mode = WAL;
            CREATE TABLE IF NOT EXISTS knowledge (
                id INTEGER PRIMARY KEY,
                knowledge_key TEXT NOT NULL UNIQUE,
                keywords TEXT NOT NULL,
                content TEXT NOT NULL,
                content_hash TEXT NOT NULL,
                embedding_model TEXT,
                category TEXT NOT NULL DEFAULT 'general',
                version_scope TEXT NOT NULL DEFAULT 'java-modern',
                source_url TEXT
            );
            CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
                knowledge_key UNINDEXED,
                keywords,
                content
            );
            CREATE TABLE IF NOT EXISTS knowledge_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        `);

        this._migrateKnowledgeSchema();

        this._ensureVectorSchema();
        let nextRowId = Number(this.db.prepare('SELECT COALESCE(MAX(id), 0) AS max_id FROM knowledge').get().max_id) + 1;
        const activeIds = [];
        for (const entry of this.entries) {
            const existing = this.db.prepare('SELECT id FROM knowledge WHERE knowledge_key = ?').get(entry.id);
            const rowId = existing ? Number(existing.id) : nextRowId++;
            activeIds.push(rowId);
            await this._upsertEntry(rowId, entry);
        }
        this._removeStaleEntries(activeIds);
        console.log(`Minecraft knowledge indexed: ${this.entries.length} chunks in ${this.databasePath}`);
    }

    _migrateKnowledgeSchema() {
        const columns = new Set(this.db.prepare('PRAGMA table_info(knowledge)').all().map(column => column.name));
        if (!columns.has('category')) {
            this.db.exec("ALTER TABLE knowledge ADD COLUMN category TEXT NOT NULL DEFAULT 'general';");
        }
        if (!columns.has('version_scope')) {
            this.db.exec("ALTER TABLE knowledge ADD COLUMN version_scope TEXT NOT NULL DEFAULT 'java-modern';");
        }
        if (!columns.has('source_url')) {
            this.db.exec('ALTER TABLE knowledge ADD COLUMN source_url TEXT;');
        }
    }

    _removeStaleEntries(activeIds) {
        const active = new Set(activeIds);
        const staleIds = this.db.prepare('SELECT id FROM knowledge').all()
            .map(row => Number(row.id))
            .filter(id => !active.has(id));
        for (const id of staleIds) {
            this.db.prepare('DELETE FROM knowledge_vec WHERE rowid = ?').run(BigInt(id));
            this.db.prepare('DELETE FROM knowledge_fts WHERE rowid = ?').run(id);
            this.db.prepare('DELETE FROM knowledge WHERE id = ?').run(id);
        }
    }

    _ensureVectorSchema() {
        const dimensionRow = this.db.prepare("SELECT value FROM knowledge_meta WHERE key = 'dimensions'").get();
        const storedDimensions = dimensionRow ? Number(dimensionRow.value) : null;
        if (storedDimensions && storedDimensions !== this.dimensions) {
            this.db.exec('DROP TABLE IF EXISTS knowledge_vec;');
            this.vectorSchemaReset = true;
        }
        this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_vec USING vec0(embedding float[${this.dimensions}]);`);
        this.db.prepare("INSERT OR REPLACE INTO knowledge_meta(key, value) VALUES ('dimensions', ?)").run(String(this.dimensions));
        this.vectorReady = Boolean(this.embeddingModel);
    }

    async _upsertEntry(rowId, entry) {
        const hash = contentHash(entry);
        const category = entry.category || 'general';
        const versionScope = entry.version_scope || 'java-modern';
        const sourceUrl = entry.source_url || null;
        const existing = this.db.prepare('SELECT content_hash, embedding_model FROM knowledge WHERE id = ?').get(rowId);
        const vectorExists = !this.embeddingModel || Boolean(
            this.db.prepare('SELECT rowid FROM knowledge_vec WHERE rowid = ?').get(BigInt(rowId))
        );
        const unchanged = !this.vectorSchemaReset && vectorExists &&
            existing?.content_hash === hash && existing?.embedding_model === this.embeddingModelName;

        this.db.prepare(`
            INSERT INTO knowledge(
                id, knowledge_key, keywords, content, content_hash, embedding_model,
                category, version_scope, source_url
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                knowledge_key = excluded.knowledge_key,
                keywords = excluded.keywords,
                content = excluded.content,
                content_hash = excluded.content_hash,
                embedding_model = excluded.embedding_model,
                category = excluded.category,
                version_scope = excluded.version_scope,
                source_url = excluded.source_url
        `).run(
            rowId, entry.id, entry.keywords, entry.text, hash,
            unchanged ? this.embeddingModelName : null,
            category, versionScope, sourceUrl
        );

        this.db.prepare('DELETE FROM knowledge_fts WHERE rowid = ?').run(rowId);
        this.db.prepare('INSERT INTO knowledge_fts(rowid, knowledge_key, keywords, content) VALUES (?, ?, ?, ?)')
            .run(rowId, entry.id, entry.keywords, entry.text);

        if (!this.embeddingModel || unchanged) return;
        try {
            const embedding = await this.embeddingModel.embed(
                `${category}\n${entry.keywords}\n${entry.text}`,
                'passage'
            );
            if (!Array.isArray(embedding) || embedding.length !== this.dimensions) {
                throw new Error(`expected ${this.dimensions} dimensions, received ${embedding?.length || 0}`);
            }
            this.db.prepare('DELETE FROM knowledge_vec WHERE rowid = ?').run(BigInt(rowId));
            this.db.prepare('INSERT INTO knowledge_vec(rowid, embedding) VALUES (?, ?)')
                .run(BigInt(rowId), vectorBlob(embedding));
            this.db.prepare('UPDATE knowledge SET embedding_model = ? WHERE id = ?')
                .run(this.embeddingModelName, rowId);
        } catch (error) {
            this.vectorReady = false;
            console.warn(`Could not embed Minecraft knowledge '${entry.id}': ${error.message}`);
        }
    }

    _lexicalResults(query, count) {
        const queryTokens = [...tokens(query)];
        if (queryTokens.length === 0) return [];
        const match = queryTokens.map(token => `"${token.replaceAll('"', '""')}"`).join(' OR ');
        try {
            return this.db.prepare(`
                SELECT rowid AS id, bm25(knowledge_fts) AS score
                FROM knowledge_fts
                WHERE knowledge_fts MATCH ?
                ORDER BY score
                LIMIT ?
            `).all(match, count).map(row => Number(row.id));
        } catch {
            return [];
        }
    }

    async _vectorResults(query, count) {
        if (!this.vectorReady) return [];
        try {
            const embedding = await this.embeddingModel.embed(query, 'query');
            if (!Array.isArray(embedding) || embedding.length !== this.dimensions) return [];
            return this.db.prepare(`
                SELECT rowid AS id, distance
                FROM knowledge_vec
                WHERE embedding MATCH ? AND k = ?
                ORDER BY distance
            `).all(vectorBlob(embedding), BigInt(count)).map(row => Number(row.id));
        } catch (error) {
            console.warn(`Vector knowledge lookup failed; using text search: ${error.message}`);
            return [];
        }
    }

    async getRelevant(query, count = 3) {
        if (!this.db) await this.init();
        const requested = Math.max(1, Number(count) || 3);
        const candidateCount = Math.max(requested * 3, 6);
        const [lexical, vector] = await Promise.all([
            Promise.resolve(this._lexicalResults(query, candidateCount)),
            this._vectorResults(query, candidateCount)
        ]);

        const scores = new Map();
        const addRanking = (ranking, weight) => ranking.forEach((id, rank) => {
            scores.set(id, (scores.get(id) || 0) + weight / (60 + rank + 1));
        });
        // Exact Minecraft names (spruce, stick, diamond, etc.) are strong
        // signals. Give lexical matches a little more weight while vectors
        // still recover paraphrases and related concepts.
        addRanking(vector, 1);
        addRanking(lexical, 1.5);

        let ids = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, requested).map(([id]) => id);
        if (ids.length === 0) {
            const fallback = this.entries.findIndex(entry => entry.id === 'planning-prerequisites');
            ids = [fallback >= 0 ? fallback + 1 : 1];
        }
        const rows = ids.map(id => this.db.prepare('SELECT content FROM knowledge WHERE id = ?').get(id)).filter(Boolean);
        return '### CONHECIMENTO RECUPERADO DO MINECRAFT\n' + rows.map(row => `- ${row.content}`).join('\n');
    }

    close() {
        this.db?.close();
        this.db = null;
    }
}
