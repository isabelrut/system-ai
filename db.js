import dotenv from "dotenv";
dotenv.config();

import pg from "pg";
import pgvector from "pgvector/pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

await pgvector.registerType(pool);

console.log("Connected to PostgreSQL");

// Initialize database
async function initializeDatabase() {

  try {

    // Enable pgvector
    await pool.query(`
      CREATE EXTENSION IF NOT EXISTS vector;
    `);

    // Create documents table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS documents (
        id SERIAL PRIMARY KEY,
        content TEXT,
        embedding vector(384),
        metadata JSONB
      );
    `);

    // Create vector index
    await pool.query(`
      CREATE INDEX IF NOT EXISTS documents_embedding_idx
      ON documents
      USING hnsw (
        embedding vector_cosine_ops
      );
    `);

    console.log(
      "Database initialized"
    );

  } catch (err) {

    console.error(
      "Database init error:",
      err
    );
  }
}

await initializeDatabase();

export default pool;