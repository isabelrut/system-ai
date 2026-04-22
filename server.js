import express from "express";
import Groq from "groq-sdk";
import dotenv from "dotenv";
import cors from "cors";
// import chromadb from "chromadb";
import { ChromaClient } from "chromadb";
// import { ChromaClient } from "@chroma-core/chromadb-client";

dotenv.config();

const app = express();

// ------------------------------
// Middleware
// ------------------------------
app.use(cors({ origin: "https://isabelrut.github.io" }));
app.use(express.json());

// ------------------------------
// LLM Client
// ------------------------------
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// ------------------------------
// Chroma Client
// ------------------------------
let client;
let collection;

// ------------------------------
// Chroma Client (REMOTE)
// ------------------------------
function initChromaClient() {
  const CHROMA_URL = process.env.CHROMA_URL;

  if (!CHROMA_URL) {
    throw new Error("CHROMA_URL is not defined in environment variables");
  }

  return new ChromaClient({
    path: CHROMA_URL, // IMPORTANT: use Render URL
  });
}

// Initialize Chroma
async function initChroma() {
  try {
    client = initChromaClient();

    // optional lightweight check
    await client.heartbeat?.();

    collection = await client.getOrCreateCollection({
      name: "ec_documents",
    });

    console.log("📦 Connected to Chroma:", process.env.CHROMA_URL);
    console.log("📦 Collection loaded: ec_documents");

  } catch (err) {
    console.error("❌ Failed to connect to Chroma:", err);
    throw err;
  }
}

// Start immediately
await initChroma();


// ------------------------------
// RETRIEVAL (EMBEDDING-BASED)
// ------------------------------
async function retrieveContext(query, docType = null, topK = 6) {
  if (!collection) {
    throw new Error("Chroma collection not initialized");
  }

  try {
    const results = await collection.query({
      queryTexts: [query],
      nResults: topK,
      where: docType ? { Doc_Type: docType } : undefined,
      include: ["documents", "metadatas", "distances"]
    });

    return {
      docs: results.documents?.[0] || [],
      metadata: results.metadatas?.[0] || [],
      distances: results.distances?.[0] || []
    };

  } catch (err) {
    console.error("Retrieval error:", err);
    return { docs: [], metadata: [], distances: [] };
  }
}

// ------------------------------
// SOURCE BUILDER
// ------------------------------
function buildSources(docs, metadata, category = "must") {
  const prefix = category === "other" ? "O" : "M";

  return docs.map((doc, i) => {
    const m = metadata[i] || {};

    return {
      id: `${prefix}${i + 1}`,
      title: m.Name || `Document ${i + 1}`,
      type: m.Doc_Type || "unknown",
      url: m.URL || "unknown",
      section: m.section_title || "unknown",
      content: doc
    };
  });
}

// ------------------------------
// FORMAT FOR LLM
// ------------------------------
function formatContextForLLM(sources, label = "M") {
  if (!sources.length) {
    return `No ${label === "M" ? "must" : "other"} context available.`;
  }

  return sources.map(src => `
[Source ${src.id}]
Title: ${src.title}
Type: ${src.type}
URL: ${src.url}
Section: ${src.section}

Content:
${src.content}
`).join("\n\n");
}

// ------------------------------
// OPTIONAL: HTML FORMAT (frontend/debug)
// ------------------------------
function formatContextHTML(sources, label = "M") {
  if (!sources.length) return `<p>No ${label} context available.</p>`;

  return `
  <ul>
    ${sources.map(src => `
      <li>
        <b>[${src.id}] ${src.title}</b><br/>
        <i>Type:</i> ${src.type} |
        <i>Section:</i> ${src.section} |
        <i>URL:</i> <a href="${src.url}">${src.url}</a>
        <br/><br/>
        ${src.content}
      </li>
    `).join("")}
  </ul>
  `;
}

// ------------------------------
// /generate endpoint
// ------------------------------
app.post("/generate", async (req, res) => {
  try {

    const { input: userInput, docType } = req.body;

    // =========================
    // 1. MUST CONTEXT (authority layer)
    // =========================
    const mustResult = await retrieveContext(userInput, "commission", 6);

    const mustSources = buildSources(
      mustResult.docs,
      mustResult.metadata,
      "must"
    );

    const context_a = formatContextForLLM(mustSources, "M");
    const nice_context_a = formatContextHTML(mustSources, "M");

    console.log("MUST sources:", mustSources.map(s => s.url));

    // =========================
    // 2. OTHER CONTEXT (supporting layer)
    // =========================
    const otherResult = await retrieveContext(userInput, docType || null, 6);

    const otherSources = buildSources(
      otherResult.docs,
      otherResult.metadata,
      "other"
    );

    const context_b = formatContextForLLM(otherSources, "O");
    const nice_context_b = formatContextHTML(otherSources, "O");

    console.log("OTHER sources:", otherSources.map(s => s.url));

    // Some delay due to token space
    // await new Promise(resolve => setTimeout(resolve, 60000));

    // ----------------
    // 2a. Do first prompt to get must-haves only using published regulations documents
    // ----------------

    const completion1 = await groq.chat.completions.create({
      // model: "openai/gpt-oss-120b",
      // model="meta-llama/llama-4-scout-17b-16e-instruct",
      model: "qwen/qwen3-32b",
      messages: [
        {
          role: "system",
          content:
          `
            You are an expert at requirements engineering, who is hired to adapt EU regulations to specific organizations. Assume that the user has a limited ICT or DPP background and that the information should be accessible and understandable to the user.
            Give a complete set of requirements that the user needs to adhere to comply to the Digital Product Passport regulations, in which you adapt to the users' sector, role, influence (company size), and digital maturity level, in which the customization to the user input is your most important goal
            Only include the Must requirements from the MoSCow method (Must, Should, Could, Won't), only include the Must requirements, the rest will be created later. Note that a good requirement has the following characteristics: Atomic; Necessary; Unambiguous; Complete; Consistent; Feasible; Verifiable; Traceable; Modifiable.
            To ensure that the user does not get legal problems, the set of requirements must be as complete as possible to guarantee compliance and the requirements should clearly state if there are unclear aspects (e.g. to be determined details like product information).
            Use the provided context to make the requirements accurately and do not make unfounded claims or infer beyond your knowledge or the provided context without an explanation.
            Focus on what the organization of the user must do, not how other organizations in their supply chain can be controlled. Ensure that these requirements are solution-agnostic, as a requirement can have multiple solutions to ensure that an organization can comply to the DPP. 
            The user input is explained as follows:
            -	The users' sector indicate to what specific set of regulations the user needs to adhere to (e.g. relevant information for the sector, low value data (fine with public data) vs high value data (gives competitive advantage, so keep private));
            -	The role indicates the responsibility of the user, which can mean the difference between creating or maintaining a DPP; the possible roles are:
              -- Supplier: i.e. supply chain actor in ESPR, an entity that (predominantly) provides raw materials, components, or finished products to manufacturers or other entities within the supply chain, up to the point where the product reaches the customer
              -- Economic operator: any business or organization involved in the supply chain of a product, including manufacturers, authorized representatives, importers, distributors, dealers, and fulfilment service providers; plays a broad role in the production, distribution, or sale of products
              -- (Online) retailer: i.e. "dealer"in ESPR, intermediary entity who sells and offers products for sale to customers using (online) channel(s), has legal responsibility to ensure DPPs are easily accessible to consumers
              -- Independent operator: entity independent of the manufacturer, involved in the repair, maintenance, waste management, or distribution of the products, e.g. small electronics repair shops, waste management organization
            -	The influence (company size) indicates the set of regulations that the user needs to adhere to (as per enterprise sizes set by the EU: micro, small, medium, large) and the resources at their availability; 
            -	The digital maturity level indicates how complicated the ICT solution should be (e.g. incomplete means not complicated);
            -	The compliance interest indicates whether the company wants to comply at the absolute minimum (2), only with their direct environment (3), in a way that improves their position (4), by getting ahead of their competition (5), or simply does not want to comply at all (1).
            Note that a good requirement includes the following:   
            -	ID (should be "ID X" with X as a number and first is X=1, allows for quick references);
            -	Statement (actual requirement): not explicit structure: [Condition] + [Subject] + “must” + [Action] + [Constraint] (with must from the MoSCoW method, that shows difference between requirements and recommendations);
            -	Rationale (compliance oriented); 
            -	Organization benefits (e.g. efficiency)
            -	Source (state source number); 
            -	Priority (including explanation); 
            -	Risk (of Implementation) (including explanation, also if the user complies while regulations can change);  
            -	System Verification Success Criteria.  
            Don't use tables in your response, not even for illustration. The current date is ` + new Date() + `, which can be used when considering the regulations that are in-force. 
            Do not start your response with any prefacing text, immediately start with your first requirement. Do not include any headers between the requirements. Do not end your response with any suggestions for other ways in which you can help.
            Do not include a sources section, I will provide the overview to the user. 
            `
        },
        {
          role: "user",
          content:
            `Context from EU documents:\n${context_a}\n\nUser information:\n${userInput}`,
        },
      ],
      temperature : 0.3, 
      reasoning_effort : "none",
      max_tokens : 1750, 
    });

    // Some delay due to token space
    await new Promise(resolve => setTimeout(resolve, 60000));

    // ----------------
    // 2b. Do second prompt to get should/could/won't-haves using all documents
    // ----------------

    const completion2 = await groq.chat.completions.create({
      // model: "openai/gpt-oss-120b",
      // model="meta-llama/llama-4-scout-17b-16e-instruct",
      model: "qwen/qwen3-32b",
      messages: [
        {
          role: "system",
          content:

            `
            You are an expert at requirements engineering, who is hired to adapt EU regulations to specific organizations. Assume that the user has a limited ICT or DPP background and that the information should be accessible and understandable to the user.
            Give a set of requirements that the user should, could or won't have to do to comply to the Digital Product Passport regulations, in which you adapt to the users' sector, role, influence (company size), digital maturity level and compliance interest, in which the customization to the user input is your most important goal. 
            For this, you are allowed to be creative and find sector-specific solutions. As a basis, you are provided with an existing set of must-have requirements.
            Only include the Should, Could, and Won't requirements from the MoSCow method (Must, Should, Could, Won’t). Note that you do not have to have at least 1 of each type (e.g. won't might not be relevant). 
            These requirements should be ordered according to their priority (highest first) and the verb used from the MoSCoW method (should first, then could, then won't).
            Note that a good requirement has the following characteristics: Atomic; Necessary; Unambiguous; Complete; Consistent; Feasible; Verifiable; Traceable; Modifiable.
            To ensure that the user does not get legal problems, the set of requirements must be as complete as possible to guarantee compliance and the requirements should clearly state if there are unclear aspects (e.g. to be determined details like product information).
            Use the provided context to make the requirements accurately and do not make unfounded claims or infer beyond your knowledge or the provided context without an explanation.
            Focus on what the organization of the user should do, not how other organizations in their supply chain can be controlled. Ensure that these requirements are solution-agnostic, as a requirement can have multiple solutions to ensure that an organization can comply to the DPP. 
            The user input is explained as follows:
            -	The users' sector indicate to what specific set of regulations the user needs to adhere to (e.g. relevant information for the sector, low value data (fine with public data) vs high value data (gives competitive advantage, so keep private));
            -	The role indicates the responsibility of the user, which can mean the difference between creating or maintaining a DPP; the possible roles are:
              -- Supplier: i.e. supply chain actor in ESPR, an entity that (predominantly) provides raw materials, components, or finished products to manufacturers or other entities within the supply chain, up to the point where the product reaches the customer
              -- Economic operator: any business or organization involved in the supply chain of a product, including manufacturers, authorized representatives, importers, distributors, dealers, and fulfilment service providers; plays a broad role in the production, distribution, or sale of products
              -- (Online) retailer: i.e. "dealer"in ESPR, intermediary entity who sells and offers products for sale to customers using (online) channel(s), has legal responsibility to ensure DPPs are easily accessible to consumers
              -- Independent operator: entity independent of the manufacturer, involved in the repair, maintenance, waste management, or distribution of the products, e.g. small electronics repair shops, waste management organization
            -	The influence (company size) indicates the set of regulations that the user needs to adhere to (as per enterprise sizes set by the EU: micro, small, medium, large) and the resources at their availability; 
            -	The digital maturity level indicates how complicated the ICT solution should be (e.g. incomplete means not complicated);
            -	The compliance interest indicates whether the company wants to comply at the absolute minimum (2), only with their direct environment (3), in a way that improves their position (4), by getting ahead of their competition (5), or simply does not want to comply at all (1) (this determines how extensive your list should be).
            Note that a good requirement includes the following:   
            -	ID (should be "ID X" with X as a number and numbering continues from the must requirements, allows for quick references);
            -	Statement (actual requirement): not explicit structure: [Condition] + [Subject] + “should/could/won't” + [Action] + [Constraint] (with should/could/won't from the MoSCoW method, that shows difference between requirements and recommendations, but you do not have to use all verbs);
            -	Rationale (compliance oriented); 
            -	Organization benefits (e.g. efficiency)
            -	Source (state source number); 
            -	Priority (including explanation); 
            -	Risk (of Implementation) (including explanation, also if the user complies while regulations can change);  
            -	System Verification Success Criteria.  

            Don't use tables in your response, not even for illustration. The current date is ` + new Date() + `, which can be used when considering the regulations that are in-force. 
            Do not start your response with any prefacing text, immediately start with your first requirement. Do not include any headers between the requirements, like "Should requirements". Do not end your response with any suggestions for other ways in which you can help.
            Do not include a sources section, I will provide the overview to the user. 
            
            `
        },
        {
          role: "user",
          content:
            `Context from DPP-related documents:\n${context_b}\n\nUser information:\n${userInput}\n\nMust-requirements:\n${completion1.choices[0].message.content}`,
        },
      ],
      temperature : 0.8, 
      reasoning_effort : "none",
      max_tokens : 1750, 
    });

    // 3. Output the first and second prompt together
    res.json({
      commission_only_output: completion1.choices[0].message.content,
      full_context_output: completion2.choices[0].message.content,
      sources: {
        commission: nice_context_a,
        full: nice_context_b
      }
    });

  } catch (error) {
    console.error("ERROR in /generate:", error);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// ------------------------------
// Start server
// ------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
