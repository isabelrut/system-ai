// server.js
import express from "express";
import Groq from "groq-sdk";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import { ChromaClient } from "chromadb";
import { DefaultEmbed } from "@chroma-core/default-embed";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// Enable CORS so frontend can call API
app.use(cors({
  origin: "https://isabelrut.github.io", // replace with your GitHub Pages URL
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, "docs")));

// ------------------------------
// Initialize Chroma
// ------------------------------
const chroma = new ChromaClient({
  persistDirectory: "./chroma_db", // folder containing legacy DB
  embeddingFunction: new DefaultEmbed()
});

let collection;

async function initChroma() {
  try {
    collection = await chroma.getOrCreateCollection({
      name: "dpp_documents",
    });
    console.log("Chroma collection ready");
  } catch (err) {
    console.error("Failed to initialize Chroma:", err);
  }
}

await initChroma();

// ------------------------------
// Cosine similarity helper
// ------------------------------
function cosineSimilarity(a, b) {
  let dot = 0.0, normA = 0.0, normB = 0.0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ------------------------------
// Retrieve top chunks from Chroma
// ------------------------------
async function retrieveContext(query, docType = null, topK = 4) {
  if (!collection) return { docs: [], metadata: [] };

  // Query Chroma using Groq embeddings
  const embeddingResponse = await groq.embeddings.create({
    model: "text-embedding-3-large",
    input: query,
  });

  const queryEmbedding = embeddingResponse.data[0].embedding;

  // Get all documents + embeddings
  const results = await collection.get({ include: ["documents", "embeddings", "metadatas"] });

  const docs = results.documents?.[0] || [];
  const embeddings = results.embeddings?.[0] || [];
  const metadatas = results.metadatas?.[0] || [];

  // Filter by document_type if requested
  const filtered = docs.map((doc, i) => ({
    doc,
    meta: metadatas[i],
    embedding: embeddings[i],
  })).filter(c => !docType || (c.meta?.document_type === docType));

  // Compute cosine similarity
  filtered.forEach(c => {
    c.score = cosineSimilarity(queryEmbedding, c.embedding);
  });

  // Sort descending by score
  filtered.sort((a, b) => b.score - a.score);

  // Take top K
  const topChunks = filtered.slice(0, topK);

  return {
    docs: topChunks.map(c => c.doc),
    metadata: topChunks.map(c => c.meta),
  };
}

// ------------------------------
// API endpoint
// ------------------------------
app.post("/generate", async (req, res) => {
  try {
    const { input: userInput, docType } = req.body;

    const { docs, metadata } = await retrieveContext(userInput, docType, 4);

    const context = docs.length ? docs.join("\n\n") : "No additional context available.";

    // Build a simple sources list
    const sourcesList = metadata
      .map((m, i) => {
        const title = m.title || `Document ${i + 1}`;
        const type = m.document_type || "unknown";
        return `- ${title} (${type})`;
      })
      .join("\n");

    const completion = await groq.chat.completions.create({
      model: "openai/gpt-oss-120b",
      messages: [
        {
          role: "system",
          content:
            "You are a Digital Product Passport (DPP) expert helping organizations implement the DPP. Based on the user input about the organization, provide a clear customized requirements overview. Make sure that the requirements fits with the (digital) capabilities, sector-specific needs, and personal interests of the stakeholder. Ensure that the requirements comply to the SMART framework, without explicitly stating them; i.e. the requirement itself should be SMART, not the detailed explanation. Repeat the userinput at the start of your response. Don't use tables in your response, not even for illustration. The current date is " + new Date() + ", which can be used in your planning if applicable. Use the provided context to answer questions accurately. Always include a 'Sources' section at the end of your answer listing the source documents." },
        {
          role: "user",
          content:
            `Context from EU documents:\n${context}\n\nUser request:\n${userInput}\n\nSources:\n${sourcesList}`,
        },
      ],
    });

    res.json({
      output: completion.choices[0].message.content,
      sources: metadata,
    });
  } catch (error) {
    console.error("ERROR:", error);
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

// import express from "express";
// import Groq from "groq-sdk";
// import dotenv from "dotenv";
// import path from "path";
// import { fileURLToPath } from "url";
// import cors from "cors";
// import { ChromaClient } from "chromadb";

// dotenv.config();

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);

// const app = express();
// const groq = new Groq({
//   apiKey: process.env.GROQ_API_KEY,
// });

// // Enable CORS so frontend on GitHub Pages can call API
// app.use(cors({
//   origin: "https://isabelrut.github.io", // replace with your GitHub Pages URL
// }));

// // Parse JSON bodies
// app.use(express.json());

// // Serve static files if needed (optional)
// app.use(express.static(path.join(__dirname, "docs")));


// // ------------------------------
// // Step 5: Initialize Chroma
// // ------------------------------
// const chroma = new ChromaClient({
//   persistDirectory: "./rag/vectordb"
// });

// let collection;

// async function initChroma() {
//   try {
//     collection = await chroma.getOrCreateCollection({
//       name: "dpp_documents"
//     });
//     console.log("Chroma collection ready");
//   } catch (err) {
//     console.error("Failed to initialize Chroma:", err);
//   }
// }

// // initialize database on startup
// await initChroma();


// // ------------------------------
// // Step 6: Retrieval function
// // ------------------------------
// async function retrieveContext(query) {

//   if (!collection) {
//     return { docs: [], metadata: [] };
//   }

//   const results = await collection.query({
//     queryTexts: [query],
//     nResults: 4
//   });

//   const docs = results.documents?.[0] || [];
//   const metadata = results.metadatas?.[0] || [];

//   return { docs, metadata };
// }


// // ------------------------------
// // Step 7: Updated API endpoint
// // ------------------------------
// app.post("/generate", async (req, res) => {
//   try {
//     const userInput = req.body.input;

//     // Retrieve context from vector DB
//     const { docs, metadata } = await retrieveContext(userInput);

//     const context = docs.length
//       ? docs.join("\n\n")
//       : "No additional context available.";

//     const completion = await groq.chat.completions.create({
//       model: "openai/gpt-oss-120b",
//       messages: [
//         {
//           role: "system",
//           content:
//             "You are a Digital Product Passport (DPP) expert helping organizations implement the DPP. Based on the user input about the organization, provide a clear customized requirements overview. Make sure that the requirements fits with the (digital) capabilities, sector-specific needs, and personal interests of the stakeholder. Ensure that the requirements comply to the SMART framework, without explicitly stating them; i.e. the requirement itself should be SMART, not the detailed explanation. Repeat the userinput at the start of your response. Don't use tables in your response, not even for illustration. The current date is " + new Date() + ", which can be used in your planning if applicable."
//         },
//         {
//           role: "user",
//           content:
//             `Context from EU documents:\n${context}\n\nUser request:\n${userInput}`
//         }
//       ],
//     });

//     res.json({
//       output: completion.choices[0].message.content,
//       sources: metadata
//     });

//   } catch (error) {
//     console.error("ERROR:", error);
//     res.status(500).json({ error: "Something went wrong" });
//   }
// });


// // Start server
// const PORT = process.env.PORT || 3000; // Use environment port for hosting
// app.listen(PORT, () => {
//   console.log(`Server running on port ${PORT}`);
// });
