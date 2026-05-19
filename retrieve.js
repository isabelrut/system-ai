import pool from "./db.js";
import pgvector from "pgvector/pg";

import { embedText } from "./embeddings.js";

const roleDescriptions = {
  Supplier:
    `Supplier: supply chain actor in ESPR, an entity that (predominantly) provides raw materials, components, or finished products to manufacturers or other entities within the supply chain, up to the point where the product reaches the customer`,

  "Economic operator":
    `Economic operator: any business or organization involved in the supply chain of a product, including manufacturers, authorized representatives, importers, distributors, dealers, and fulfilment service providers; plays a broad role in the production, distribution, or sale of products`,

  Retailer:
    `Retailer: intermediary entity who sells and offers products for sale to customers using (online) channel(s), and ensures DPPs are accessible to consumers`,

  "Independent operator":
    `Independent operator: entity independent of the manufacturer, involved in repair, maintenance, waste management, or distribution of products`
};

const maturityDescriptions = {
  incomplete:
    `incomplete: no digitalization in the company`,

  performed:
    `performed: planning for digitalization has been made`,

  managed:
    `managed: existing business processes are digitized through technology`,

  established:
    `established: digital transformation has been implemented based on standards`,

  predictable:
    `predictable: quantitative techniques are applied on real-time data`,

  optimizing:
    `optimizing: innovation and continuous improvement`
};

const implementationDescriptions = {
  one:
    `one: company does not want to comply at all`,

  two:
    `two: company wants to comply at the absolute minimum`,

  three:
    `three: company wants compliance within an accepted DPP ecosystem`,

  four:
    `four: company wants compliance that improves market position`,

  five:
    `five: company wants to get ahead of competitors`
};

const perspectiveDescriptions = {
  Business:
    `Business: focus on cost-benefits and financial business case`,

  ICT:
    `ICT: focus on implementation and systems integration`,

  Sustainability:
    `Sustainability: focus on leveraging DPP for sustainability goals`
};

export async function retrieveContext(
  query,
  docType = null,
  topK = 6
) {

  const enrichedQuery = query
    .replace(
        /3\. Role: (.*)/,
        (_, value) => `3. Role: ${roleDescriptions[value.trim()] || value}`
    )
    .replace(
        /4\. Digital maturity: (.*)/,
        (_, value) => `4. Digital maturity: ${maturityDescriptions[value.trim()] || value}`
    )
    .replace(
        /5\. Implementation level: (.*)/,
        (_, value) => `5. Implementation level: ${implementationDescriptions[value.trim()] || value}`
    )
    .replace(
        /6\. Perspective: (.*)/,
        (_, value) => `6. Perspective: ${perspectiveDescriptions[value.trim()] || value}`
    );

  enrichedQuery = `
  Based on the user input below, find relevant documents on the Digital Product Passport, as part of the Ecodesign Requirements for Sustainable Products. If you cannot find any relevant documents, then use the ESPR / di-07. 
  
  ` + enrichedQuery;

  console.log(enrichedQuery);

  const embedding =
    await embedText(enrichedQuery);

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
  ORDER BY embedding <=> $1 ASC NULLS LAST
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