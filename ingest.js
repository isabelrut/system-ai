import dotenv from "dotenv";
dotenv.config();

import fs from "fs";
import path from "path";

import xlsx from "xlsx";
import pdfParse from "pdf-parse";

import pool from "./db.js";
import pgvector from "pgvector/pg";

import { chunkText } from "./chunking.js";
import { embedText } from "./embeddings.js";

const DOCS_DIR = "./pdfs";

async function ingest() {

  console.log("Starting ingestion...");

  // Remove old chunks
  await pool.query(
    "DELETE FROM documents"
  );

  // Read metadata.xlsx
  const workbook =
    xlsx.readFile("metadata.xlsx");

  const sheet =
    workbook.Sheets[
      workbook.SheetNames[0]
    ];

  const metadataRows =
    xlsx.utils.sheet_to_json(sheet);

  // Read files
  const files =
    fs.readdirSync(DOCS_DIR);

  for (const file of files) {

    if (!file.endsWith(".pdf"))
      continue;

    console.log(`Processing ${file}`);

    const filePath =
      path.join(DOCS_DIR, file);

    const buffer =
      fs.readFileSync(filePath);

    const pdf =
      await pdfParse(buffer);

    const text = pdf.text;

    // Match metadata row
    const fileId =
      path.parse(file).name;

    const metadata =
      metadataRows.find(
          r => String(r.ID).trim() === fileId
      ) || {};

    // Create chunks
    const chunks =
      chunkText(text);

    for (const chunk of chunks) {

      const embedding =
        await embedText(chunk);

      await pool.query(
        `
        INSERT INTO documents
        (content, embedding, metadata)
        VALUES ($1, $2, $3)
        `,
        [
          chunk,
          pgvector.toSql(embedding),
          metadata,
        ]
      );
    }

    console.log(
      `Finished ${file}`
    );
  }

  console.log(
    "Ingestion complete"
  );

  process.exit();
}

ingest();