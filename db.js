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

async function initDB() {
  try {
    console.log("Initializing DB...");

    // 1. Enable extension
    await pool.query(`
      CREATE EXTENSION IF NOT EXISTS vector;
    `);

    console.log("pgvector enabled (or already exists)");

    // 2. Register type AFTER extension exists
    await pgvector.registerType(pool);

    // 3. Create table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS documents (
        id SERIAL PRIMARY KEY,
        content TEXT,
        embedding vector(384),
        metadata JSONB
      );
    `);

    // 4. Create index
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

// import dotenv from "dotenv";
// dotenv.config();

// import pg from "pg";
// import pgvector from "pgvector/pg";

// const pool = new pg.Pool({
//   connectionString: process.env.DATABASE_URL,
//   ssl: {
//     rejectUnauthorized: false,
//   },
// });

// await pgvector.registerType(pool);

// console.log("Connected to PostgreSQL");

// // Initialize database
// async function initializeDatabase() {

//   try {

//     // Enable pgvector
//     await pool.query(`
//       CREATE EXTENSION IF NOT EXISTS vector;
//     `);

//     // Create documents table
//     await pool.query(`
//       CREATE TABLE IF NOT EXISTS documents (
//         id SERIAL PRIMARY KEY,
//         content TEXT,
//         embedding vector(384),
//         metadata JSONB
//       );
//     `);

//     // Create vector index
//     await pool.query(`
//       CREATE INDEX IF NOT EXISTS documents_embedding_idx
//       ON documents
//       USING hnsw (
//         embedding vector_cosine_ops
//       );
//     `);

//     console.log(
//       "Database initialized"
//     );

//   } catch (err) {

//     console.error(
//       "Database init error:",
//       err
//     );
//   }
// }

// await initializeDatabase();

// export default pool;