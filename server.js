// server.js
import express from "express";
import Groq from "groq-sdk";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import fs from "fs";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY, // Only for LLM completions
});

// Enable CORS for frontend
app.use(cors({
  origin: "https://isabelrut.github.io",
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, "docs")));

// ------------------------------
// Load JSON data
// ------------------------------
const DATA_PATH = path.join(__dirname, "rag_chunks.json");
let chunks = [];

try {
  const raw = fs.readFileSync(DATA_PATH, "utf-8");
  chunks = JSON.parse(raw);
  console.log(`Loaded ${chunks.length} chunks from JSON`);
} catch (err) {
  console.error("Failed to load chunks:", err);
}

// ------------------------------
// Stopwords (basic)
// ------------------------------
const STOPWORDS = ["the", "and", "of", "in", "on", "for", "to", "a", "an", "with", "by", "is"];

// ------------------------------
// Detect sector from query
// ------------------------------
function detectSector(query) {
  const q = query.toLowerCase();

  if (q.includes("batteries")) return "Battery"; 
  if (q.includes("battery")) return "Battery"; 
  if (q.includes("textiles")) return "Textile"; 
  if (q.includes("textile")) return "Textile"; 
  if (q.includes("apparel")) return "Textile"; 
  if (q.includes("toys")) return "Toys"; 
  if (q.includes("toy")) return "Toys"; 
  if (q.includes("construction")) return "Construction"; 
  if (q.includes("iron")) return "Steel"; 
  if (q.includes("steel")) return "Steel"; 

  return null;
}

// ------------------------------
// Check if document is generic
// ------------------------------
function isGenericDoc(c) {
  const name = (c.metadata?.Name || "").toLowerCase();

  return (
    name.includes("ecodesign for sustainable products regulation") ||
    name.includes("espr") ||
    c.metadata?.Tags?.toLowerCase().includes("product")
  );
}

// ------------------------------
// Improved scoring function
// ------------------------------
function scoreChunk(chunk, query, sector) {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter(w => !STOPWORDS.includes(w));

  const text = chunk.text.toLowerCase();
  const name = (chunk.metadata?.Name || "").toLowerCase();
  const tags = (chunk.metadata?.Tags || "").toLowerCase();
  const summary = (chunk.metadata?.Summary || "").toLowerCase();

  const isGeneric =
    name.includes("ecodesign for sustainable products regulation");

  let score = 0;

  for (const word of words) {
    if (text.includes(word)) score += word.length > 4 ? 2 : 1;

    // Strong metadata boosts
    if (name.includes(word)) score += 3;
    if (tags.includes(word)) score += 4;
    if (summary.includes(word)) score += 2;

  }

  // Sector boost only for non-generic documents
  if (
    sector &&
    !isGeneric && 
    tags.includes(sector.toLowerCase())
  ) {
    score += 10;
  }  

  return score;
}

// ------------------------------
// Retrieve top chunks
// ------------------------------
function retrieveContext(query, docType = null, topK = 4) {
  if (!chunks.length) return { docs: [], metadata: [] };

  const sector = detectSector(query);

  // Step 1: filter by Doc_Type only (kept optional)
  let baseCandidates = chunks.filter(c => {
    if (docType && c.metadata?.Doc_Type !== docType) return false;
    return true;
  });

  // Step 2: filter between generic docs and not generic docs
  let genericPool = baseCandidates.filter(isGenericDoc);
  let sectorPool = baseCandidates.filter(c => !isGenericDoc(c));

  // Step 2a: try specific sector first
  let sectorCandidates = sectorPool; 
  if (sector) {
    let filtered = sectorPool.filter(c =>
      (c.metadata?.Tags || "").toLowerCase().includes(sector.toLowerCase())
    );

    if (filtered.length > 0) {
      sectorCandidates = filtered;
    }
  }

  // Step 2b: include generic text
  let genericCandidates = genericPool;

  // Step 3: score all candidates
  function scoreAndRank(candidates) {
    // score candidates
    const scored = candidates.map(c => ({
      text: c.text,
      metadata: c.metadata,
      score: scoreChunk(c, query, sector),
    }));

    // sort descending
    scored.sort((a, b) => b.score - a.score);

    return scored.filter(c => c.score > 0)
  }

  const scoredSector = scoreAndRank(sectorCandidates);
  const scoredGeneric = scoreAndRank(genericCandidates);

  // Step 4: take top from each 
  const kSector = Math.ceil(topK / 2);
  const kGeneric = Math.floor(topK / 2);

  let topChunks = [
    ...scoredSector.slice(0, kSector),
    ...scoredGeneric.slice(0, kGeneric),
  ];
  
  // Fallback if one side is empty
  if (!topChunks.length) {
    const allScored = scoreAndRank(baseCandidates);
    topChunks = allScored.slice(0, topK);
  }

  return {
    docs: topChunks.map(c => c.text),
    metadata: topChunks.map(c => ({
      ...c.metadata,
      _isGeneric: isGenericDoc(c),
    })),
  };
}

// ------------------------------
// /generate endpoint
// ------------------------------
app.post("/generate", async (req, res) => {
  try {

    const { input: userInput, docType } = req.body;

    function buildContext(docs, metadata) {
      return docs.map((doc, i) => {
        const m = metadata[i];
        return `
    [Source ${i + 1}]
    Title: ${m.Name || `Document ${i + 1}`}
    Type: ${m.Doc_Type || "unknown"}
    URL: ${m.URL || "unknown"}
    Section: ${m.section_title || "unknown"}

    Content:
    ${doc}
    `;
      }).join("\n\n");
    }

    function niceFormatContext(docs, metadata) {
      return `
        <ul>
          ${docs.map((doc, i) => {
            const m = metadata[i];

            const title = m.Name || `Document ${i + 1}`;
            const type = m.Doc_Type || "unknown";
            const url = m.URL || "unknown";
            const section = m.section_title || "unknown";

          return `<li> <b>[Source ${i + 1}] Title: ${title}</b> | <i>Type:</i> ${type} | <i>URL:</i> <a href="${url}">${url}</a> | <i>Section:</i> ${section} | <i>Content:</i> ${doc} </li>`;
          }).join("")}
        </ul>
      `;    
    }

    // ----------------
    // 1a. Get relevant published regulations documents
    // ----------------

    const { docs: docs_a, metadata: metadata_a } =  retrieveContext(userInput, "commission", 6);

    const context_a = docs_a.length ? buildContext(docs_a, metadata_a) : "No relevant published regulations found.";

    const nice_context_a = docs_a.length ? niceFormatContext(docs_a, metadata_a) : "No nice format allowed for a.";

    console.log("Published regulations used:", metadata_a.map(m => m.URL));

    // ----------------
    // 1b. Get all relevant documents
    // ----------------

    const { docs: docs_b, metadata: metadata_b } =  retrieveContext(userInput, "", 6);

    const context_b = docs_b.length ? buildContext(docs_b, metadata_b) : "No relevant documents found.";

    const nice_context_b = docs_b.length ? niceFormatContext(docs_b, metadata_b) : "No nice format allowed for b.";

    console.log("Documents used:", metadata_b.map(m => m.URL));

    // Some delay due to token space
    await new Promise(resolve => setTimeout(resolve, 60000));

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
            You are an expert at requirements engineering, who is hired to adapt EU regulations to specific organizations. 
            Give a complete set of requirements that the user needs to adhere to comply to the Digital Product Passport regulations, in which you adapt to the users' sector, role, influence (company size), and digital maturity level. 
            When considering the MoSCow method (Must, Should, Could, Won't), only include the Must requirements. In other words, try to be as complete as possible on what an organization should do to be fully compliant with the Digital Product Passport regulations. 
            Else, the user can be harmed: they might think they comply when fulfilling the requirements, but if they are not a complete set they can have compliance problems.
            Here, clearly state if there are still some aspects unclear about a requirement, e.g. due to decisions that still need to be made by the EU. It is vital that you do not make claims about EU regulations without explaining your assumptions. If so, you can include this explanation in the rationale.
            Focus on what the organization of the user must do, not how other organizations in their supply chain can be controlled. Ensure that these requirements are solution-agnostic, as a requirement can have multiple solutions to ensure that an organization can comply to the DPP. 
            Note that the most important part of your role is adapting to this users' situation through the given user input, not the generalizability. For instance, consider what product information must be included for the mentioned sector. The user input is explained as follows:
            -	The users' sector indicate to what specific set of regulations the user needs to adhere to (so, for instance, do not use textile sources for the electronics and ICT sector; besides that, keep the differences in mind between low value data sectors (which would be more comfortable with making their data publicly available) and high value data sectors (in which data gives them a competitive advantage, so they do not want to share it with anyone besides for compliance); 
            -	The role indicates the responsibility of the user, which can mean the difference between creating or maintaining a DPP;
            -	The influence (company size) indicates the set of regulations that the user needs to adhere to (as per enterprise sizes set by the EU: micro, small, medium, large) and the resources at their availability; 
            -	The digital maturity level indicates how complicated the ICT solution should be, as those on the lowest level (incomplete) will have a harder time to get the relevant data than those at the highest level (optimizing); 
            -	The compliance interest indicates whether the company wants to comply at the absolute minimum (2: entity level compliance), only with their direct environment (3: ecosystem level compliance), in a way that improves their position (4: value adding), by getting ahead of their competition (5: competitive advantage), or simply does not want to comply at all (0: no compliance).
            Do not infer beyond what you know or what information the source documents give.  
            Note that a good requirement includes the following:   
            -	ID (this should be standardized with the following format: "DPP"-SECTOR-NUMBER, e.g. DPP-TEXTILE-001);
            -	Statement (actual requirement): recommended structure (but not explicitly) is: [Condition] + [Subject] + “must” + [Action] + [Constraint] (with the verb must being used based on the MoSCoW method, which should be used to show a distinction between requirements and recommendations);
            -	Rationale (compliance oriented); 
            -	Organization benefits (e.g. efficiency)
            -	Source (you must include the used document, the content that you used from the source and the section metadata); 
            -	Priority (including explanation); 
            -	Risk (of Implementation) (including explanation, also of what could happen if a user adheres to it expecting full compliance by adhering while specific areas of regulations are still to be determined or possible to be changed);  
            -	System Validation/Verification Success Criteria.  
            And a good requirement has the following characteristics:  Atomic; Necessary; Unambiguous; Complete; Consistent; Feasible; Verifiable; Traceable; Modifiable.
            Also, assume that the reader has a limited ICT or DPP background and that the information should be accessible and understandable to the user.
            Don't use tables in your response, not even for illustration. The current date is ` + new Date() + `, which can be used when considering the regulations that are in-force. 
            Do not start your response with any prefacing text, immediately start with your first requirement. Do not include any headers between the requirements. Do not end your response with any suggestions for other ways in which you can help.
            Use the provided context to answer questions accurately. 
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
      max_tokens : 1775, 
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
            You are an expert at requirements engineering, who is hired to adapt EU regulations to specific organizations. 
            Give a set of requirements that the user should, could or won't have to do to comply to the Digital Product Passport regulations, in which you adapt to the users' sector, role, influence (company size), digital maturity level and compliance interest. 
            For this, you are allowed to be creative and find sector-specific solutions. As a basis, you are provided with an existing set of must-have requirements.
            When considering the MoSCow method (Must, Should, Could, Won't), only include the Should, Could, and Won't requirements. In other words, try to be as complete as possible on what an organization could do to be fully compliant with the Digital Product Passport regulations. Here, clearly state if there are still some aspects unclear about a requirement, e.g. due to decisions that still need to be made by the EU. It is vital that you do not make claims about EU regulations without explaining your assumptions. If so, you can include this explanation in the rationale.
            Note that you do not have to have at least 1 Should, 1 Could, and 1 Won't requirement, just use the verbs where appropriate. For instance, "won't" might not be applicable for any value-adding requirement. 
            Focus on what the organization of the user should do, not how other organizations in their supply chain can be controlled. Ensure that these requirements are solution-agnostic, as a requirement can have multiple solutions to ensure that an organization can comply to the DPP. 

            These requirements should be ordered according to their priority (highest first) and the verb used from the MoSCoW method (should first, then could, then won't).

            Note that the most important part of your role is adapting to this users' situation through the given user input, not the generalizability. For instance, consider what product information must be included for the mentioned sector. The user input is explained as follows:
            -	The users' sector indicate to what specific set of regulations the user needs to adhere to (so, for instance, do not use textile sources for the electronics and ICT sector; besides that, keep the differences in mind between low value data sectors (which would be more comfortable with making their data publicly available) and high value data sectors (in which data gives them a competitive advantage, so they do not want to share it with anyone besides for compliance); 
            -	The role indicates the responsibility of the user, which can mean the difference between creating or maintaining a DPP;
            -	The influence (company size) indicates the set of regulations that the user needs to adhere to (as per enterprise sizes set by the EU: micro, small, medium, large) and the resources at their availability; 
            -	The digital maturity level indicates how complicated the ICT solution should be, as those on the lowest level (incomplete) will have a harder time to get the relevant data than those at the highest level (optimizing); 
            -	The compliance interest indicates whether the company wants to comply at the absolute minimum (2: entity level compliance), only with their direct environment (3: ecosystem level compliance), in a way that improves their position (4: value adding), by getting ahead of their competition (5: competitive advantage), or simply does not want to comply at all (0: no compliance) (this determines how extensive your list should be). 

            Note that a good requirement includes the following:   
            -	ID (this should be standardized with the following format: "DPP"-SECTOR-NUMBER, e.g. DPP-TEXTILE-001);
            -	Statement (actual requirement): recommended structure (but not explicitly) is: [Condition] + [Subject] + “should/could/won't” + [Action] + [Constraint] (with the verb should/could/won't being chosen based on the MoSCoW method, which should be used to show a distinction between requirements and recommendations, but you do not have to use all verbs);
            -	Rationale (compliance oriented); 
            -	Organization benefits (e.g. efficiency)
            -	Source (you must include the used document, the content that you used from the source and the section metadata); 
            -	Priority (including explanation); 
            -	Risk (of Implementation) (including explanation, also of what could happen if a user adheres to it expecting full compliance by adhering while specific areas of regulations are still to be determined or possible to be changed);  
            -	System Validation/Verification Success Criteria.  

            And a good requirement has the following characteristics:  Atomic; Necessary; Unambiguous; Complete; Consistent; Feasible; Verifiable; Traceable; Modifiable.
            Also, assume that the reader has a limited ICT or DPP background and that the information should be accessible and understandable to the user.
            Don't use tables in your response, not even for illustration. The current date is ` + new Date() + `, which can be used when considering the regulations that are in-force. 
            Do not start your response with any prefacing text, immediately start with your first requirement. Do not include any headers between the requirements, like "Should requirements". Do not end your response with any suggestions for other ways in which you can help.
            Use the provided context to answer questions accurately. 
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
      max_tokens : 1775, 
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
