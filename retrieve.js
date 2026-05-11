import pool from "./db.js";
import pgvector from "pgvector/pg";

import { embedText } from "./embeddings.js";

export async function retrieveContext(
  query,
  docType = null,
  topK = 6
) {

  const embedding =
    await embedText(query);

  let sql = `
    SELECT
      content,
      metadata,
      embedding <=> $1 AS distance
    FROM documents
  `;

  const params = [
    pgvector.toSql(embedding)
  ];

  if (docType) {

    sql += `
      WHERE metadata->>'Doc_Type' = $2
    `;

    params.push(docType);
  }

  sql += `
    ORDER BY distance
    LIMIT ${topK}
  `;

  const result =
    await pool.query(sql, params);

  console.log("Retrieved rows:",
    result.rows.length
  );

  return {
    docs:
      result.rows.map(r => r.content),

    metadata:
      result.rows.map(r => r.metadata),
  };
}