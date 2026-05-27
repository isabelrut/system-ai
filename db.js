import dotenv from "dotenv";
dotenv.config();

import pg from "pg";
import pgvector from "pgvector/pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function initDB() {
  try {
    console.log("Initializing DB...");

    await pool.query(`CREATE EXTENSION IF NOT EXISTS vector;`);
    console.log("pgvector enabled");

    // IMPORTANT FIX: use a real client
    const client = await pool.connect();
    await pgvector.registerType(client);
    client.release();

    await pool.query(`
      CREATE TABLE IF NOT EXISTS documents (
        id SERIAL PRIMARY KEY,
        content TEXT,
        embedding vector(384),
        metadata JSONB
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS documents_embedding_idx
      ON documents
      USING hnsw (embedding vector_cosine_ops);
    `);

    console.log("DB ready");
  } catch (err) {
    console.error("DB init error:", err);
  }
}

await initDB();

export default pool;