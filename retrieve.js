import pool from "./db.js";
import pgvector from "pgvector/pg";

import { embedText } from "./embeddings.js";

export async function retrieveContext(
  query,
  docType = null,
  topK = 6
) {

  const enrichedQuery = query + 
  `
  Give sources that contain relevant information for Digital Product Passport implementation based on the following user input.
  Note that the user input is explained as follows:
  1.	The users' sector indicate to what specific set of regulations the user needs to adhere to (e.g. relevant information for the sector, low value data (fine with public data) vs high value data (gives competitive advantage, so keep private));
  2. The influence (company size) indicates the set of regulations that the user needs to adhere to (as per enterprise sizes set by the EU: micro, small, medium, large) and the resources at their availability; 
  3.	The role indicates the responsibility of the user, which can mean the difference between creating or maintaining a DPP; the possible roles are:
    -- Supplier: i.e. supply chain actor in ESPR, an entity that (predominantly) provides raw materials, components, or finished products to manufacturers or other entities within the supply chain, up to the point where the product reaches the customer
    -- Economic operator: any business or organization involved in the supply chain of a product, including manufacturers, authorized representatives, importers, distributors, dealers, and fulfilment service providers; plays a broad role in the production, distribution, or sale of products
    -- Retailer: i.e. "dealer"in ESPR, intermediary entity who sells and offers products for sale to customers using (online) channel(s), has legal responsibility to ensure DPPs are easily accessible to consumers
    -- Independent operator: entity independent of the manufacturer, involved in the repair, maintenance, waste management, or distribution of the products, e.g. small electronics repair shops, waste management organization
  4.	The digital maturity level indicates how complicated the ICT solution should be (the digital maturity model has the following options: a) incomplete (no digitalization in the company), b) performed (planning has been made), c) managed (ensuring existing business processes are digitized through technology), d) established (digital transformation has been done based on existing standard), e) predictable (seizes those benefits by applying quantitative techniques on real-time data), f) optimizing (innovation and continuous improvement));
  5.	The compliance interest indicates whether the company wants to comply at the absolute minimum (2), within an ecosystem that has accepted the DPP (3), in a way that improves their position (4), by getting ahead of their competition (5), or simply does not want to comply at all (1);
  6.  The perspective determines what details should be more extensive, choosing between business (cost-benefits, financial business case), ICT (implementation), and sustainability (how to leverage).
  `;

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