# system-ai: DPP Compliance Retrieval Tool (Web-Based LLM Assistant)

As part of a thesis research, this project is a web-based tool designed to support **Digital Product Passport (DPP) compliance** by enabling structured ingestion, semantic retrieval, and LLM-assisted querying of compliance-relevant documentation.

It builds a searchable knowledge base from regulatory and product documentation and exposes it through a lightweight web interface that allows users to insert user input and receive context-aware, LLM-generated answers grounded in retrieved data.

---

## Overview

The system follows a retrieval-augmented generation (RAG) architecture:

1. **Documents are ingested and processed**
2. **Text is chunked and embedded**
3. **A vector database is created and queried**
4. **Relevant context is retrieved for user questions**
5. **An LLM generates responses grounded in retrieved data**

User interaction happens through a simple browser-based interface, while the backend handles ingestion, retrieval, and prompt orchestration.

---

## Project Structure

### Data ingestion & preprocessing

* `ingest.js`
  Bulk ingestion pipeline that processes all documents from the `pdfs/` directory and metadata from `metadata.xlsx`.

* `ingest-single.js`
  Utility script for adding or updating a single document in the database without reprocessing the full dataset.

* `chunking.js`
  Splits extracted text into semantically meaningful chunks to improve retrieval quality.

* `embeddings.js`
  Generates vector embeddings for text chunks, enabling semantic similarity search.

---

### Database layer

* `db.js`
  Handles database initialization and storage of:

  * Document chunks
  * Embeddings
  * Metadata
    Supports efficient similarity search for retrieval.

---

### Retrieval system

* `retrieve.js`
  Queries the vector database using user input, returning the most relevant document chunks for context enrichment.

---

### LLM interaction layer

* `server.js`
  Backend server that:

  * Receives user queries from the frontend
  * Calls the retrieval system
  * Builds prompts with retrieved context
  * Sends enriched prompts to the LLM
  * Returns generated responses to the client

---

### Frontend interface

* `docs/index.html`
  Web-based UI where users can:

  * Submit compliance-related questions
  * View generated responses
  * Interact with the system without needing technical knowledge of the backend

---

### Data sources

* `pdfs/`
  Folder containing source documents used for ingestion.

* `metadata.xlsx`
  Spreadsheet containing structured metadata associated with each document, used to enrich indexing and retrieval.

---

## Key Features

* Semantic search over compliance documentation
* RAG-based LLM responses grounded in real data
* Modular ingestion pipeline (bulk + single-document updates)
* Lightweight web interface for non-technical users
* Designed specifically for **DPP compliance workflows**

---

## Typical Workflow

1. Place source PDFs into the `pdfs/` directory
2. Ensure `metadata.xlsx` is updated with document descriptors
3. Run `ingest.js` to build or refresh the database
4. Optionally use `ingest-single.js` for incremental updates
5. Start the backend server (`server.js`)
6. Open `docs/index.html` in a browser
7. Ask compliance-related questions and receive grounded answers

---

## Purpose

The goal of this system is to reduce the complexity of navigating Digital Product Passport requirements by providing:

* Fast access to relevant regulatory information
* Consistent interpretation of compliance documents
* A natural-language interface for non-technical users
* Traceable, context-aware LLM outputs grounded in source material

---

## Notes

* The quality of responses depends heavily on the quality of ingested documents and metadata.
* Proper chunking and embedding configuration is critical for retrieval accuracy.
* This system is designed to be extensible for additional regulatory frameworks beyond DPP.
