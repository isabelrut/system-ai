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

// // ------------------------------
// // Simple keyword scoring helper
// // ------------------------------
// function scoreChunkByQuery(chunkText, query) {
//   const words = query.toLowerCase().split(/\s+/);
//   const textLower = chunkText.toLowerCase();
//   // Count number of query words present in the chunk
//   let score = 0;
//   for (const word of words) {
//     if (textLower.includes(word)) score += 1;
//   }
//   return score;
// }

// // ------------------------------
// // Retrieve top chunks using hybrid keyword search
// // ------------------------------
// function retrieveContext(query, docType = null, topK = 4) {
//   if (!chunks.length) return { docs: [], metadata: [] };

//   // Step 1: filter by Doc_Type
//   let candidates = chunks.filter(c => !docType || c.metadata?.Doc_Type === docType);

//   // Step 2: score candidates by query keyword overlap
//   const scored = candidates.map(c => ({
//     text: c.text,
//     metadata: c.metadata,
//     score: scoreChunkByQuery(c.text, query),
//   }));

//   // Step 3: sort descending by score
//   scored.sort((a, b) => b.score - a.score);

//   // Step 4: fallback if all scores are zero
//   let topChunks = scored.filter(c => c.score > 0).slice(0, topK);
//   if (!topChunks.length) topChunks = scored.slice(0, topK);

//   return {
//     docs: topChunks.map(c => c.text),
//     metadata: topChunks.map(c => c.metadata),
//   };
// }

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

  // Include metadata in searchable text
  // const combinedText = (
  //   chunk.text + " " +
  //   (chunk.metadata?.Name || "") + " " +
  //   (chunk.metadata?.Tags || "") + " " +
  //   (chunk.metadata?.Summary || "")
  // ).toLowerCase();
  const text = chunk.text.toLowerCase();
  const name = (chunk.metadata?.Name || "").toLowerCase();
  const tags = (chunk.metadata?.Tags || "").toLowerCase();
  const summary = (chunk.metadata?.Summary || "").toLowerCase();

  const isGeneric =
    name.includes("ecodesign for sustainable products regulation");

  let score = 0;

  for (const word of words) {
    // if (combinedText.includes(word)) {
    //   // Weight longer / more meaningful words higher
    //   score += word.length > 4 ? 2 : 1;
    // }
    if (text.includes(word)) score += word.length > 4 ? 2 : 1;

    // Strong metadata boosts
    if (name.includes(word)) score += 3;
    if (tags.includes(word)) score += 4;
    if (summary.includes(word)) score += 2;

  }

  // Sector boost only for non-generic documents
  // if (sector && chunk.metadata?.Tags === sector) {
  //   score += 10; // was 5
  // }
  if (
    sector &&
    !isGeneric && // <-- key fix
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
  // let candidates = chunks.filter(c => {
  //   if (docType && c.metadata?.Doc_Type !== docType) return false;
  //   return true;
  // });

  let baseCandidates = chunks.filter(c => {
    if (docType && c.metadata?.Doc_Type !== docType) return false;
    return true;
  });

  // Step 2: filter between generic docs and not generic docs
  let genericPool = baseCandidates.filter(isGenericDoc);
  let sectorPool = baseCandidates.filter(c => !isGenericDoc(c));

  // Step 2a: try specific sector first
  // let sectorCandidates = baseCandidates; 
  let sectorCandidates = sectorPool; 
  // let usedSectorFilter = false;

  // if (sector) {
  //   const filtered = baseCandidates.filter(c =>
  //     (c.metadata?.Tags || "").toLowerCase().includes(sector.toLowerCase())
  //   );

  //   if (filtered.length > 0) {
  //     sectorCandidates = filtered;
  //     usedSectorFilter = true;
  //   }
  // }
  if (sector) {
    let filtered = sectorPool.filter(c =>
      (c.metadata?.Tags || "").toLowerCase().includes(sector.toLowerCase())
    );

    if (filtered.length > 0) {
      sectorCandidates = filtered;
    }
  }

  // Step 2b: include generic text
  // const GENERIC_KEYWORD = "Ecodesign for Sustainable Products Regulation";
  // const genericCandidates = baseCandidates.filter(c =>
  //     (c.metadata?.Name || "").toLowerCase().includes(GENERIC_KEYWORD)
  //   );
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
    // metadata: topChunks.map(c => c.metadata),
    metadata: topChunks.map(c => ({
      ...c.metadata,
      // _sectorFiltered: usedSectorFilter, 
      // _isGeneric: (c.metadata?.Name || "")
      //   .toLowerCase()
      //   .includes(GENERIC_KEYWORD),
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

    // function niceFormatContext(docs, metadata) {
    //   return docs
    //     .map((doc, i) => {
    //       const m = metadata[i];

    //       const title = m.Name || `Document ${i + 1}`;
    //       const type = m.Doc_Type || "unknown";
    //       const url = m.URL || "unknown";
    //       const section = m.section_title || "unknown";

    //       // single-line format per source
    //       return `<li> [Source ${i + 1}] Title: ${title} | Type: ${type} | URL: ${url} | Section: ${section} | Content: ${doc} </li>`;
    //     })
    //     .join("");
    // }

    function niceFormatContext(docs, metadata) {
      return `
        <ul>
          ${docs.map((doc, i) => {
            const m = metadata[i];

            const title = m.Name || `Document ${i + 1}`;
            const type = m.Doc_Type || "unknown";
            const url = m.URL || "unknown";
            const section = m.section_title || "unknown";

          return `<li> [Source ${i + 1}] Title: ${title} | Type: ${type} | URL: ${url} | Section: ${section} | Content: ${doc} </li>`;
          }).join("")}
        </ul>
      `;    
    }

    // ----------------
    // 1a. Get relevant published regulations documents
    // ----------------

    // const { docs_a, metadata_a } = retrieveContext(userInput, "commission", 6);
    const { docs: docs_a, metadata: metadata_a } =  retrieveContext(userInput, "commission", 6);

    // const context_a = docs_a.length ? docs_a.join("\n\n") : "No additional context available.";

    // const sourcesList_a = metadata_a
    //   .map((m, i) => {
    //     const title = m.Name || `Document ${i + 1}`;
    //     const type = m.Doc_Type || "unknown";
    //     const url = m.URL || "unknown";
    //     const section = m.section_title || "unknown";
    //     return `- ${title} (${type}) from ${url} in ${section}`;
    //   })
    //   .join("\n");

    const context_a = docs_a.length ? buildContext(docs_a, metadata_a) : "No relevant published regulations found.";

    const nice_context_a = docs_a.length ? niceFormatContext(docs_a, metadata_a) : "No nice format allowed for a.";

    // const context_a = docs_a
    //   .map((doc, i) => {
    //     const m = metadata_a[i];
    //     const title = m.Name || `Document ${i + 1}`;
    //     const type = m.Doc_Type || "unknown";
    //     const url = m.URL || "unknown";
    //     const section = m.section_title || "unknown";

    //     return `
    // [Source ${i + 1}]
    // Title: ${title}
    // Type: ${type}
    // URL: ${url}
    // Section: ${section}

    // Content:
    // ${doc}
    // `;
    //   })
    //   .join("\n\n");

    console.log("Published regulations used:", metadata_a.map(m => m.URL));

    // ----------------
    // 1b. Get all relevant documents
    // ----------------

    // const { docs_b, metadata_b } = retrieveContext(userInput, "", 6);
    const { docs: docs_b, metadata: metadata_b } =  retrieveContext(userInput, "", 6);

    // const context_b = docs_b.length ? docs_b.join("\n\n") : "No additional context available.";

    // const sourcesList_b = metadata_b
    //   .map((m, i) => {
    //     const title = m.Name || `Document ${i + 1}`;
    //     const type = m.Doc_Type || "unknown";
    //     const url = m.URL || "unknown";
    //     const section = m.section_title || "unknown";
    //     return `- ${title} (${type}) from ${url} in ${section}`;
    //   })
    //   .join("\n");

    const context_b = docs_b.length ? buildContext(docs_b, metadata_b) : "No relevant documents found.";

    const nice_context_b = docs_b.length ? niceFormatContext(docs_b, metadata_b) : "No nice format allowed for b.";

    // const context_b = docs_b
    //   .map((doc, i) => {
    //     const m = metadata_b[i];
    //     const title = m.Name || `Document ${i + 1}`;
    //     const type = m.Doc_Type || "unknown";
    //     const url = m.URL || "unknown";
    //     const section = m.section_title || "unknown";

    //     return `
    // [Source ${i + 1}]
    // Title: ${title}
    // Type: ${type}
    // URL: ${url}
    // Section: ${section}

    // Content:
    // ${doc}
    // `;
    //   })
    //   .join("\n\n");

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
            // "You are a Digital Product Passport (DPP) expert helping organizations implement the DPP. Based on the user input about the organization, provide a clear customized requirements overview. Make sure that the requirements fits with the (digital) capabilities, sector-specific needs, and personal interests of the stakeholder. Ensure that the requirements comply to the SMART framework, without explicitly stating them; i.e. the requirement itself should be SMART, not the detailed explanation. Repeat the userinput at the start of your response. Don't use tables in your response, not even for illustration. The current date is " + new Date() + ", which can be used in your planning if applicable. Use the provided context to answer questions accurately. Always include a 'Sources' section at the end of your answer listing the source documents."
            // "Give the requirements that the user needs to adhere to to comply to the Digital Product Passport regulations, in which you adapt to the users' sector, role, compliance interest, influence (company size) and digital maturity level. You must only use published documents from the EU as sources. Note that a good requirement includes the following:   -	ID; -	Statement (actual requirement): recommended structure is: [Condition] + [Subject] + “shall” + [Action] + [Constraint] (but not explicitly); -	Rationale; -	Source; -	Priority; -	Risk (of Implementation);  -	System Validation/Verification Success Criteria.  And a good requirement has the following characteristics:  Atomic; Necessary; Unambiguous; Complete; Consistent; Feasible; Verifiable; Traceable; Modifiable. Don't use tables in your response, not even for illustration. The current date is " + new Date() + ", which can be used when considering the regulations that are in-force. Use the provided context to answer questions accurately. Always include a 'Sources' section at the end of your answer listing the source documents."
          //   `
          //   You are an expert at requirements engineering, who is hired to adapt EU regulations to specific organizations. 
          //   Give a complete set of requirements that the user needs to adhere to comply to the Digital Product Passport regulations, in which you adapt to the users' sector, role, influence (company size), and digital maturity level. 
          //   When considering the MoSCow method (Must, Should, Could, Won't), only include the Must requirements. In other words, try to be as complete as possible on what an organization should do to be fully compliant with the Digital Product Passport regulations. 
          //   Else, the user can be harmed: they might think they comply when fulfilling the requirements, but if they are not a complete set they can have compliance problems.
          //   Here, clearly state if there are still some aspects unclear about a requirement, e.g. due to decisions that still need to be made by the EU. It is vital that you do not make claims about EU regulations without explaining your assumptions. If so, you can include this explanation in the rationale.
          //   Focus on what the organization of the user must do, not how other organizations in their supply chain can be controlled. Ensure that these requirements are solution-agnostic, as a requirement can have multiple solutions to ensure that an organization can comply to the DPP. 
          //   Note that the most important part of your role is adapting to this users' situation through the given user input, not the generalizability. For instance, consider what product information must be included for the mentioned sector. The user input is explained as follows:
          //   -	The users' sector indicate to what specific set of regulations the user needs to adhere to (so, for instance, do not use textile sources for the electronics and ICT sector; besides that, keep the differences in mind between low value data sectors (which would be more comfortable with making their data publicly available) and high value data sectors (in which data gives them a competitive advantage, so they do not want to share it with anyone besides for compliance); 
          //   -	The role indicates the responsibility of the user, which can mean the difference between creating or maintaining a DPP;
          //   -	The influence (company size) indicates the set of regulations that the user needs to adhere to (as per enterprise sizes set by the EU: micro, small, medium, large) and the resources at their availability; 
          //   -	The digital maturity level indicates how complicated the ICT solution should be, as those on the lowest level (incomplete) will have a harder time to get the relevant data than those at the highest level (optimizing); 
          //   -	The compliance interest indicates whether the company wants to comply at the absolute minimum (2: entity level compliance), only with their direct environment (3: ecosystem level compliance), in a way that improves their position (4: value adding), by getting ahead of their competition (5: competitive advantage), or simply does not want to comply at all (0: no compliance).
          //   Do not infer beyond what you know or what information the source documents give.  
          //   Note that a good requirement includes the following:   
          //   -	ID (this should be standardized with the following format: "DPP"-SECTOR-NUMBER, e.g. DPP-TEXTILE-001);
          //   -	Statement (actual requirement): recommended structure (but not explicitly) is: [Condition] + [Subject] + “must” + [Action] + [Constraint] (with the verb must being used based on the MoSCoW method, which should be used to show a distinction between requirements and recommendations);
          //   -	Rationale (compliance oriented); 
          //   -	Organization benefits (e.g. efficiency)
          //   -	Source (you must include the used document, the content that you used from the source and the section metadata); 
          //   -	Priority (including explanation); 
          //   -	Risk (of Implementation) (including explanation, also of what could happen if a user adheres to it expecting full compliance by adhering while specific areas of regulations are still to be determined or possible to be changed);  
          //   -	System Validation/Verification Success Criteria.  
          //   And a good requirement has the following characteristics:  Atomic; Necessary; Unambiguous; Complete; Consistent; Feasible; Verifiable; Traceable; Modifiable.
          //   Also, assume that the reader has a limited ICT or DPP background and that the information should be accessible and understandable to the user.
          //   Don't use tables in your response, not even for illustration. The current date is ` + new Date() + `, which can be used when considering the regulations that are in-force. 
          //   Do not end your response with any suggestions for other ways in which you can help, just end with the sources.
          //   Use the provided context to answer questions accurately. 
          //   Always include a 'Sources' section at the end of your answer listing the given source documents that consists of document names and their URLs. Do not cite any sources beside those given in the sources list.
          // `            
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
            Do not end your response with any suggestions for other ways in which you can help.
            Use the provided context to answer questions accurately. 
            Do not include a sources section, I will provide the overview to the user. 
            `
        },
        {
          role: "user",
          content:
            // `Context from EU documents:\n${context_a}\n\nUser information:\n${userInput}\n\nSources:\n${sourcesList_a}`,
            `Context from EU documents:\n${context_a}\n\nUser information:\n${userInput}`,
        },
      ],
      temperature : 0.3, 
      reasoning_effort : "none",
      max_tokens : 1700, 
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
            // "You are a Digital Product Passport (DPP) expert helping organizations implement the DPP. Based on the user input about the organization, provide a clear customized requirements overview. Make sure that the requirements fits with the (digital) capabilities, sector-specific needs, and personal interests of the stakeholder. Ensure that the requirements comply to the SMART framework, without explicitly stating them; i.e. the requirement itself should be SMART, not the detailed explanation. Repeat the userinput at the start of your response. Don't use tables in your response, not even for illustration. The current date is " + new Date() + ", which can be used in your planning if applicable. Use the provided context to answer questions accurately. Always include a 'Sources' section at the end of your answer listing the source documents."
            // "Give the requirements that the user needs to adhere to to comply to the Digital Product Passport regulations, in which you adapt to the users' sector, role, compliance interest, influence (company size) and digital maturity level. You must only use published documents from the EU as sources. Note that a good requirement includes the following:   -	ID; -	Statement (actual requirement): recommended structure is: [Condition] + [Subject] + “shall” + [Action] + [Constraint] (but not explicitly); -	Rationale; -	Source; -	Priority; -	Risk (of Implementation);  -	System Validation/Verification Success Criteria.  And a good requirement has the following characteristics:  Atomic; Necessary; Unambiguous; Complete; Consistent; Feasible; Verifiable; Traceable; Modifiable. Don't use tables in your response, not even for illustration. The current date is " + new Date() + ", which can be used when considering the regulations that are in-force. Use the provided context to answer questions accurately. Always include a 'Sources' section at the end of your answer listing the source documents."
            // `
            // You are an expert at requirements engineering, who is hired to adapt EU regulations to specific organizations. 
            // Give a set of requirements that the user should, could or won't have to do to comply to the Digital Product Passport regulations, in which you adapt to the users' sector, role, influence (company size), digital maturity level and compliance interest. 
            // For this, you are allowed to be creative and find sector-specific solutions. As a basis, you are provided with an existing set of must-have requirements.
            // When considering the MoSCow method (Must, Should, Could, Won't), only include the Should, Could, and Won't requirements. In other words, try to be as complete as possible on what an organization could do to be fully compliant with the Digital Product Passport regulations. Here, clearly state if there are still some aspects unclear about a requirement, e.g. due to decisions that still need to be made by the EU. It is vital that you do not make claims about EU regulations without explaining your assumptions. If so, you can include this explanation in the rationale.

            // Focus on what the organization of the user should do, not how other organizations in their supply chain can be controlled. Ensure that these requirements are solution-agnostic, as a requirement can have multiple solutions to ensure that an organization can comply to the DPP. 

            // These requirements should be ordered according to their priority (highest first) and the verb used from the MoSCoW method (should first, then could, then won't).

            // Note that the most important part of your role is adapting to this users' situation through the given user input, not the generalizability. For instance, consider what product information must be included for the mentioned sector. The user input is explained as follows:
            // -	The users' sector indicate to what specific set of regulations the user needs to adhere to (so, for instance, do not use textile sources for the electronics and ICT sector; besides that, keep the differences in mind between low value data sectors (which would be more comfortable with making their data publicly available) and high value data sectors (in which data gives them a competitive advantage, so they do not want to share it with anyone besides for compliance); 
            // -	The role indicates the responsibility of the user, which can mean the difference between creating or maintaining a DPP;
            // -	The influence (company size) indicates the set of regulations that the user needs to adhere to (as per enterprise sizes set by the EU: micro, small, medium, large) and the resources at their availability; 
            // -	The digital maturity level indicates how complicated the ICT solution should be, as those on the lowest level (incomplete) will have a harder time to get the relevant data than those at the highest level (optimizing); 
            // -	The compliance interest indicates whether the company wants to comply at the absolute minimum (2: entity level compliance), only with their direct environment (3: ecosystem level compliance), in a way that improves their position (4: value adding), by getting ahead of their competition (5: competitive advantage), or simply does not want to comply at all (0: no compliance) (this determines how extensive your list should be). 

            // Note that a good requirement includes the following:   
            // -	ID (this should be standardized with the following format: "DPP"-SECTOR-NUMBER, e.g. DPP-TEXTILE-001);
            // -	Statement (actual requirement): recommended structure (but not explicitly) is: [Condition] + [Subject] + “should/could/won't” + [Action] + [Constraint] (with the verb should/could/won't being chosen based on the MoSCoW method, which should be used to show a distinction between requirements and recommendations, but you do not have to use all verbs);
            // -	Rationale (compliance oriented); 
            // -	Organization benefits (e.g. efficiency)
            // -	Source (you must include the used document, the content that you used from the source and the section metadata); 
            // -	Priority (including explanation); 
            // -	Risk (of Implementation) (including explanation, also of what could happen if a user adheres to it expecting full compliance by adhering while specific areas of regulations are still to be determined or possible to be changed);  
            // -	System Validation/Verification Success Criteria.  

            // And a good requirement has the following characteristics:  Atomic; Necessary; Unambiguous; Complete; Consistent; Feasible; Verifiable; Traceable; Modifiable.
            // Also, assume that the reader has a limited ICT or DPP background and that the information should be accessible and understandable to the user.
            // Don't use tables in your response, not even for illustration. The current date is ` + new Date() + `, which can be used when considering the regulations that are in-force. 
            // Do not end your response with any suggestions for other ways in which you can help, just end with the sources.
            // Use the provided context to answer questions accurately. 
            // Always include a 'Sources' section at the end of your answer listing the given source documents that consists of document names and their URLs. Do not cite any sources beside those given in the sources list.
            
            // `

            `
            You are an expert at requirements engineering, who is hired to adapt EU regulations to specific organizations. 
            Give a set of requirements that the user should, could or won't have to do to comply to the Digital Product Passport regulations, in which you adapt to the users' sector, role, influence (company size), digital maturity level and compliance interest. 
            For this, you are allowed to be creative and find sector-specific solutions. As a basis, you are provided with an existing set of must-have requirements.
            When considering the MoSCow method (Must, Should, Could, Won't), only include the Should, Could, and Won't requirements. In other words, try to be as complete as possible on what an organization could do to be fully compliant with the Digital Product Passport regulations. Here, clearly state if there are still some aspects unclear about a requirement, e.g. due to decisions that still need to be made by the EU. It is vital that you do not make claims about EU regulations without explaining your assumptions. If so, you can include this explanation in the rationale.

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
            Do not end your response with any suggestions for other ways in which you can help.
            Use the provided context to answer questions accurately. 
            Do not include a sources section, I will provide the overview to the user. 
            
            `
        },
        {
          role: "user",
          content:
            // `Context from EU documents:\n${context_b}\n\nUser information:\n${userInput}\n\nSources:\n${sourcesList_b}`,
            `Context from DPP-related documents:\n${context_b}\n\nUser information:\n${userInput}\n\nMust-requirements:\n${completion1.choices[0].message.content}`,
        },
      ],
      temperature : 0.8, 
      reasoning_effort : "none",
      max_tokens : 1700, 
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

    // res.json({
    //   output: completion.choices[0].message.content,
    //   sources: metadata,
    // });

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

// OLD uses embeddings

// // server.js
// import express from "express";
// import Groq from "groq-sdk";
// import dotenv from "dotenv";
// import path from "path";
// import { fileURLToPath } from "url";
// import cors from "cors";
// import fs from "fs";

// dotenv.config();

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);

// const app = express();
// const groq = new Groq({
//   apiKey: process.env.GROQ_API_KEY,
// });

// // Enable CORS for frontend
// app.use(cors({
//   origin: "https://isabelrut.github.io",
// }));

// app.use(express.json());
// app.use(express.static(path.join(__dirname, "docs")));

// // ------------------------------
// // Load JSON data
// // ------------------------------
// const DATA_PATH = path.join(__dirname, "rag_chunks.json");
// let chunks = [];

// try {
//   const raw = fs.readFileSync(DATA_PATH, "utf-8");
//   chunks = JSON.parse(raw);
//   console.log(`Loaded ${chunks.length} chunks from JSON`);
// } catch (err) {
//   console.error("Failed to load chunks:", err);
// }

// // ------------------------------
// // Cosine similarity helper
// // ------------------------------
// function cosineSimilarity(a, b) {
//   let dot = 0.0, normA = 0.0, normB = 0.0;
//   for (let i = 0; i < a.length; i++) {
//     dot += a[i] * b[i];
//     normA += a[i] * a[i];
//     normB += b[i] * b[i];
//   }
//   return dot / (Math.sqrt(normA) * Math.sqrt(normB));
// }

// // ------------------------------
// // Retrieve top chunks safely
// // ------------------------------
// async function retrieveContext(query, docType = null, topK = 4) {
//   if (!chunks.length) return { docs: [], metadata: [] };

//   // Step 1: filter by Doc_Type
//   let candidates = chunks.filter(c => !docType || c.metadata?.Doc_Type === docType);

//   // Step 2: keyword filter
//   const qLower = query.toLowerCase();
//   let filtered = candidates.filter(c => c.text.toLowerCase().includes(qLower));

//   // fallback if keyword removed all
//   if (!filtered.length) filtered = candidates;

//   // Step 3: limit candidates to avoid 413
//   const MAX_CANDIDATES = 500;
//   const candidatesToEmbed = filtered.slice(0, MAX_CANDIDATES);
//   const textsToEmbed = candidatesToEmbed.map(c => c.text);

//   if (!textsToEmbed.length) return { docs: [], metadata: [] };

//   // Step 4: embed candidate texts
//   let candidateEmbeddings;
//   try {
//     const embeddingResponse = await groq.embeddings.create({
//       model: "text-embedding-3-small",
//       input: textsToEmbed,
//     });
//     candidateEmbeddings = embeddingResponse.data.map(e => e.embedding);
//   } catch (err) {
//     console.error("Embedding API error:", err);
//     return { docs: [], metadata: [] };
//   }

//   // Step 5: embed query
//   let queryEmbedding;
//   try {
//     const queryEmbeddingResp = await groq.embeddings.create({
//       model: "text-embedding-3-small",
//       input: query,
//     });
//     queryEmbedding = queryEmbeddingResp.data[0].embedding;
//   } catch (err) {
//     console.error("Query embedding error:", err);
//     return { docs: [], metadata: [] };
//   }

//   // Step 6: cosine similarity scoring
//   const scored = candidatesToEmbed.map((c, i) => ({
//     text: c.text,
//     metadata: c.metadata,
//     score: cosineSimilarity(queryEmbedding, candidateEmbeddings[i]),
//   }));

//   // Step 7: sort descending and pick topK
//   scored.sort((a, b) => b.score - a.score);
//   const topChunks = scored.slice(0, topK);

//   return {
//     docs: topChunks.map(c => c.text),
//     metadata: topChunks.map(c => c.metadata),
//   };
// }

// // ------------------------------
// // /generate endpoint
// // ------------------------------
// app.post("/generate", async (req, res) => {
//   try {
//     const { input: userInput, docType } = req.body;

//     const { docs, metadata } = await retrieveContext(userInput, docType, 4);

//     const context = docs.length ? docs.join("\n\n") : "No additional context available.";

//     const sourcesList = metadata
//       .map((m, i) => {
//         const title = m.Name || `Document ${i + 1}`;
//         const type = m.Doc_Type || "unknown";
//         return `- ${title} (${type})`;
//       })
//       .join("\n");

//     console.log(sourcesList);

//     const completion = await groq.chat.completions.create({
//       model: "openai/gpt-oss-120b",
//       messages: [
//         {
//           role: "system",
//           content:
//             "You are a Digital Product Passport (DPP) expert helping organizations implement the DPP. Based on the user input about the organization, provide a clear customized requirements overview. Make sure that the requirements fits with the (digital) capabilities, sector-specific needs, and personal interests of the stakeholder. Ensure that the requirements comply to the SMART framework, without explicitly stating them; i.e. the requirement itself should be SMART, not the detailed explanation. Repeat the userinput at the start of your response. Don't use tables in your response, not even for illustration. The current date is " + new Date() + ", which can be used in your planning if applicable. Use the provided context to answer questions accurately. Always include a 'Sources' section at the end of your answer listing the source documents."
//         },
//         {
//           role: "user",
//           content:
//             `Context from EU documents:\n${context}\n\nUser request:\n${userInput}\n\nSources:\n${sourcesList}`,
//         },
//       ],
//     });

//     res.json({
//       output: completion.choices[0].message.content,
//       sources: metadata,
//     });
//   } catch (error) {
//     console.error("ERROR in /generate:", error);
//     res.status(500).json({ error: "Something went wrong" });
//   }
// });

// // ------------------------------
// // Start server
// // ------------------------------
// const PORT = process.env.PORT || 3000;
// app.listen(PORT, () => {
//   console.log(`Server running on port ${PORT}`);
// });

// CHROMA DB VERSION

// // server.js
// import express from "express";
// import Groq from "groq-sdk";
// import dotenv from "dotenv";
// import path from "path";
// import { fileURLToPath } from "url";
// import cors from "cors";
// import { ChromaClient } from "chromadb";
// import { DefaultEmbeddingFunction } from "@chroma-core/default-embed";
// import fs from "fs";
// import { execSync } from "child_process";

// dotenv.config();

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);

// const app = express();
// const groq = new Groq({
//   apiKey: process.env.GROQ_API_KEY,
// });

// // Enable CORS so frontend can call API
// app.use(cors({
//   origin: "https://isabelrut.github.io", // replace with your GitHub Pages URL
// }));

// app.use(express.json());
// app.use(express.static(path.join(__dirname, "docs")));

// // ------------------------------
// // Step 1: Ensure Chroma DB exists
// // ------------------------------
// const DB_PATH = path.join(__dirname, "chroma_db");
// const ZIP_PATH = path.join(__dirname, "chroma_db.zip");

// if (!fs.existsSync(DB_PATH)) {
//   if (!fs.existsSync(ZIP_PATH)) {
//     console.error("Chroma DB zip not found at", ZIP_PATH);
//     process.exit(1);
//   }
//   console.log("Unzipping Chroma DB...");
//   execSync(`unzip -o "${ZIP_PATH}" -d "${DB_PATH}"`);
//   console.log("Chroma DB unzipped successfully.");
// } else {
//   console.log("Chroma DB folder exists, skipping unzip.");
// }

// // ------------------------------
// // Initialize Chroma
// // ------------------------------
// const chroma = new ChromaClient({
//   path: DB_PATH,
//   // persistDirectory: DB_PATH, // folder containing legacy DB
//   // embeddingFunction: new DefaultEmbeddingFunction(),
//   // chromaServer: false, 
// });

// console.log("DB PATH EXISTS:", fs.existsSync(DB_PATH));
// console.log("DB FILES:", fs.readdirSync(DB_PATH));

// let collection;

// async function initChroma() {
//   try {
//     collection = await chroma.getOrCreateCollection({
//       name: "dpp_documents",
//     });
//     console.log("Chroma collection ready");
//   } catch (err) {
//     console.error("Failed to initialize Chroma:", err);
//   }
// }

// (async () => {
//   await initChroma();
// })();

// // ------------------------------
// // Cosine similarity helper
// // ------------------------------
// function cosineSimilarity(a, b) {
//   let dot = 0.0, normA = 0.0, normB = 0.0;
//   for (let i = 0; i < a.length; i++) {
//     dot += a[i] * b[i];
//     normA += a[i] * a[i];
//     normB += b[i] * b[i];
//   }
//   return dot / (Math.sqrt(normA) * Math.sqrt(normB));
// }

// // ------------------------------
// // Retrieve top chunks from Chroma
// // ------------------------------
// async function retrieveContext(query, docType = null, topK = 4) {
//   if (!collection) return { docs: [], metadata: [] };

//   // Query Chroma using Groq embeddings
//   const embeddingResponse = await groq.embeddings.create({
//     model: "text-embedding-3-large",
//     input: query,
//   });

//   const queryEmbedding = embeddingResponse.data[0].embedding;

//   // Get all documents + embeddings
//   const results = await collection.get({ include: ["documents", "embeddings", "metadatas"] });

//   const docs = results.documents?.[0] || [];
//   const embeddings = results.embeddings?.[0] || [];
//   const metadatas = results.metadatas?.[0] || [];

//   // Filter by document_type if requested
//   const filtered = docs.map((doc, i) => ({
//     doc,
//     meta: metadatas[i],
//     embedding: embeddings[i],
//   })).filter(c => !docType || (c.meta?.document_type === docType));

//   // Compute cosine similarity
//   filtered.forEach(c => {
//     c.score = cosineSimilarity(queryEmbedding, c.embedding);
//   });

//   // Sort descending by score
//   filtered.sort((a, b) => b.score - a.score);

//   // Take top K
//   const topChunks = filtered.slice(0, topK);

//   return {
//     docs: topChunks.map(c => c.doc),
//     metadata: topChunks.map(c => c.meta),
//   };
// }

// // ------------------------------
// // API endpoint
// // ------------------------------
// app.post("/generate", async (req, res) => {
//   try {
//     const { input: userInput, docType } = req.body;

//     const { docs, metadata } = await retrieveContext(userInput, docType, 4); 

//     const context = docs.length ? docs.join("\n\n") : "No additional context available.";

//     // Build a simple sources list
//     const sourcesList = metadata
//       .map((m, i) => {
//         const title = m.title || `Document ${i + 1}`;
//         const type = m.document_type || "unknown";
//         return `- ${title} (${type})`;
//       })
//       .join("\n");

//     console.log(sourcesList);

//     const completion = await groq.chat.completions.create({
//       model: "openai/gpt-oss-120b",
//       messages: [
//         {
//           role: "system",
//           content:
//             "You are a Digital Product Passport (DPP) expert helping organizations implement the DPP. Based on the user input about the organization, provide a clear customized requirements overview. Make sure that the requirements fits with the (digital) capabilities, sector-specific needs, and personal interests of the stakeholder. Ensure that the requirements comply to the SMART framework, without explicitly stating them; i.e. the requirement itself should be SMART, not the detailed explanation. Repeat the userinput at the start of your response. Don't use tables in your response, not even for illustration. The current date is " + new Date() + ", which can be used in your planning if applicable. Use the provided context to answer questions accurately. Always include a 'Sources' section at the end of your answer listing the source documents." },
//         {
//           role: "user",
//           content:
//             `Context from EU documents:\n${context}\n\nUser request:\n${userInput}\n\nSources:\n${sourcesList}`,
//         },
//       ],
//     });

//     res.json({
//       output: completion.choices[0].message.content,
//       sources: metadata,
//     });
//   } catch (error) {
//     console.error("ERROR:", error);
//     res.status(500).json({ error: "Something went wrong" });
//   }
// });

// // ------------------------------
// // Start server
// // ------------------------------
// const PORT = process.env.PORT || 3000;
// app.listen(PORT, () => {
//   console.log(`Server running on port ${PORT}`);
// });

// OLD VERSION

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
