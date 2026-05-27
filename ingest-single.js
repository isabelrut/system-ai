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

// filename passed via terminal
const file = process.argv[2];

if (!file) {
  console.log("Usage: node ingest-single.js <filename.pdf>");
  process.exit(1);
}

async function ingestSingle() {

  console.log(`Processing ${file}`);

  // Read metadata.xlsx
  const workbook =
    xlsx.readFile("metadata.xlsx");

  const sheet =
    workbook.Sheets[
      workbook.SheetNames[0]
    ];

  const metadataRows =
    xlsx.utils.sheet_to_json(sheet);

  const filePath =
    path.join("./pdfs", file);

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

  console.log(`Finished ${file}`);

  process.exit();
}

ingestSingle();