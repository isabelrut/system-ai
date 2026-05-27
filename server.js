import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";

import Groq from "groq-sdk";

import { retrieveContext }
  from "./retrieve.js";

const app = express();

const groq = new Groq({
  apiKey:
    process.env.GROQ_API_KEY,
});

app.use(cors({
  origin:
    "https://isabelrut.github.io",
}));

app.use(express.json());

function excelDateToJS(value) {
  if (!value || typeof value !== "number") return value;

  const utc_days = Math.floor(value - 25569);
  const utc_value = utc_days * 86400;

  return new Date(utc_value * 1000)
    .toISOString()
    .split("T")[0];
}

function buildContext(
  docs,
  metadata
) {

  return docs.map((doc, i) => {

    const m = metadata[i];

    return `
[Source ${i + 1}]

Title:
${m.Name || "Unknown"}

URL:
${m.URL || "Unknown"}

Date published:
${excelDateToJS(m.Date) || "Unknown"}

Date in force:
${excelDateToJS(m.Date_In_Force) || "Unknown"}

Content:
${doc}
`;
  }).join("\n\n");
}

// Helper: escape HTML entities to prevent injection
function escapeHTML(str) {
    return str.replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;");
}

// function buildHTML(docs, metadata) {
//   return docs.map((doc, i) => {
//     const m = metadata[i];

//     return `
// <div class="source-card">

//   <div class="source-header">
//     <strong class="source-title">
//       ${escapeHTML(m.Name || "Unknown")}
//     </strong>
//   </div>

//   <div class="source-meta">
//     <div>
//       <span class="label">URL:</span>
//       <a href="${m.URL || "#"}" target="_blank" rel="noopener noreferrer">
//         ${escapeHTML(m.URL || "Unknown")}
//       </a>
//     </div>

//     <div>
//       <span class="label">Date published:</span>
//       ${escapeHTML(String(excelDateToJS(m.Date) || "Unknown"))}
//     </div>

//     <div>
//       <span class="label">Date in force:</span>
//       ${escapeHTML(String(excelDateToJS(m.Date_In_Force) || "Unknown"))}
//     </div>
//   </div>

// </div>
//     `;
//   }).join("\n\n");
// }

function buildHTML(docs, metadata) {
  const seen = new Set();

  return docs
    .filter((doc, i) => {
      const m = metadata[i] || {};

      // Build a unique key from the fields that define a duplicate
      const key = JSON.stringify({
        Name: m.Name || "",
        URL: m.URL || "",
        Date: m.Date || "",
        Date_In_Force: m.Date_In_Force || ""
      });

      // Skip if already seen
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .map((doc, i) => {
      // IMPORTANT:
      // after filter(), indexes no longer match original metadata indexes,
      // so retrieve metadata differently
      const m = metadata[docs.indexOf(doc)];

      return `
<div class="source-card">

  <div class="source-header">
    <strong class="source-title">
      ${escapeHTML(m.Name || "Unknown")}
    </strong>
  </div>

  <div class="source-meta">
    <div>
      <span class="label">URL:</span>
      <a href="${m.URL || "#"}" target="_blank" rel="noopener noreferrer">
        ${escapeHTML(m.URL || "Unknown")}
      </a>
    </div>

    <div>
      <span class="label">Date published:</span>
      ${escapeHTML(String(excelDateToJS(m.Date) || "Unknown"))}
    </div>

    <div>
      <span class="label">Date in force:</span>
      ${escapeHTML(String(excelDateToJS(m.Date_In_Force) || "Unknown"))}
    </div>
  </div>

</div>
      `;
    })
    .join("\n\n");
}

// Return start date of legislation
function getLowestDateInForce(docs, metadata) {
  let lowestDate = null;

  docs.forEach((doc, i) => {
    const m = metadata[i] || {};

    // Ignore missing dates
    if (!m.Date_In_Force || m.Date_In_Force === "N.A.") {
      return;
    }

    // Convert Excel date
    const converted = excelDateToJS(m.Date_In_Force);

    if (!converted) {
      return;
    }

    const dateObj = new Date(converted);

    // Ignore invalid dates
    if (isNaN(dateObj.getTime())) {
      return;
    }

    // Keep earliest date
    if (lowestDate === null || dateObj < lowestDate) {
      lowestDate = dateObj;
    }
  });

  // Return formatted string
  return lowestDate
    ? lowestDate.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric"
      })
    : "N.A.";
}

app.post(
  "/generate",
  async (req, res) => {

  try {

    const {
      input: userInput
    } = req.body;

    // Published regulations
    const {
      docs: docsA,
      metadata: metadataA
    } = await retrieveContext(
      userInput,
      "regulation",
      4
    );

    // Full context
    const {
      docs: docsB,
      metadata: metadataB
    } = await retrieveContext(
      userInput,
      null,
      4
    );

    const contextA =
      buildContext(
        docsA,
        metadataA
      );

    const contextB =
      buildContext(
        docsB,
        metadataB
      );

    // console.log("Context A to output:", contextA);

    // console.log("Context B to output:", contextB);

    // Prompt 1
    const completion1 =
      await groq.chat.completions.create({

      model:
        "qwen/qwen3-32b",

      messages: [
        {
          role: "system",
          content:
          `
            You are an expert at requirements engineering, who is hired to adapt EU regulations to specific organizations. Assume that the user has a limited ICT or DPP background and that the information should be accessible and understandable to the user.
            Give a complete set of requirements that the user needs to adhere to comply to the Digital Product Passport regulations, in which you adapt to the users' sector, role, influence (company size), and digital maturity level, in which the customization to the user input is your most important goal.
            Only include the Must requirements from the MoSCow method (Must, Should, Could, Won't), only include the Must requirements, the rest will be created later. Note that a good requirement has the following characteristics: Atomic; Necessary; Unambiguous; Complete; Consistent; Feasible; Verifiable; Traceable; Modifiable.
            To ensure that the user does not get legal problems, the set of requirements must be as complete as possible to guarantee compliance and the requirements should clearly state if there are unclear aspects (e.g. to be determined details like product information).
            Use the provided context to make the requirements accurately and do not make unfounded claims or infer beyond your knowledge or the provided context without an explanation.
            Focus on what the organization of the user must do, not how other organizations in their supply chain can be controlled. Ensure that these requirements are solution-agnostic, as a requirement can have multiple solutions to ensure that an organization can comply to the DPP. 
            The user input is explained as follows:
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
            Note that a good requirement includes the following:   
            -	ID (should be "ID X" with X as a number and first is X=1, allows for quick references);
            -	Title (short description, should be formatted with previous as "ID X: Title");
            -	Statement (actual requirement): not explicit structure: [Condition] + [Subject] + “must” + [Action] + [Constraint] (with must from the MoSCoW method, that shows difference between requirements and recommendations);
            -	Risk (those existing up to the point of taking action);  
            -	Source (fully include source, link, and quote); 
            -	Details (should contain relevant information based on the perspective, e.g. financial details and business benefits for business, or technology implementation and validation criteria for ICT).
            Don't use tables in your response, not even for illustration. The current date is ` + new Date() + `, which can be used when considering the regulations that are in-force. 
            Very important: do not start your response with any prefacing text, immediately start with your first requirement. Do not include any headers between the requirements. Do not end your response with any suggestions for other ways in which you can help.
            REMEMBER: The most important goal of this request is to customize to all user input!
            `
        },
        {
          role: "user",
          content:
`
Context:
${contextA}

User:
${userInput}
`
        }
      ],

      temperature: 0.3,
      max_tokens: 1600,
      reasoning_effort: "none",
    });

    // Prompt 2
    const completion2 =
      await groq.chat.completions.create({

      model:
        "qwen/qwen3-32b",

      messages: [
        {
          role: "system",
          content:
            `
            You are an expert at requirements engineering, who is hired to adapt EU regulations to specific organizations. Assume that the user has a limited ICT or DPP background and that the information should be accessible and understandable to the user.
            Give a set of requirements that the user should or could do to comply to the Digital Product Passport regulations, in which you adapt to the users' sector, role, influence (company size), digital maturity level and compliance interest, in which the customization to the user input is your most important goal. 
            For this, you are allowed to be creative and find sector-specific solutions. As a basis, you are provided with an existing set of must-have requirements.
            Only include the Should and Could requirements from the MoSCow method (Must, Should, Could, Won’t). 
            These requirements should be ordered according to their priority (highest first) and the verb used from the MoSCoW method (should first, then could).
            Note that a good requirement has the following characteristics: Atomic; Necessary; Unambiguous; Complete; Consistent; Feasible; Verifiable; Traceable; Modifiable.
            To ensure that the user does not get legal problems, the set of requirements must be as complete as possible to guarantee compliance and the requirements should clearly state if there are unclear aspects (e.g. to be determined details like product information).
            Use the provided context to make the requirements accurately and do not make unfounded claims or infer beyond your knowledge or the provided context without an explanation.
            Focus on what the organization of the user should do, not how other organizations in their supply chain can be controlled. Ensure that these requirements are solution-agnostic, as a requirement can have multiple solutions to ensure that an organization can comply to the DPP. 
            The user input is explained as follows:
            1.	The users' sector indicate to what specific set of regulations the user needs to adhere to (e.g. relevant information for the sector, low value data (fine with public data) vs high value data (gives competitive advantage, so keep private));
            2.	The influence (company size) indicates the set of regulations that the user needs to adhere to (as per enterprise sizes set by the EU: micro, small, medium, large) and the resources at their availability; 
            3.	The DPP role indicates the responsibility of the user, which can mean the difference between creating or maintaining a DPP; the possible roles are:
              -- Supplier: i.e. supply chain actor in ESPR, an entity that (predominantly) provides raw materials, components, or finished products to manufacturers or other entities within the supply chain, up to the point where the product reaches the customer
              -- Economic operator: any business or organization involved in the supply chain of a product, including manufacturers, authorized representatives, importers, distributors, dealers, and fulfilment service providers; plays a broad role in the production, distribution, or sale of products
              -- Retailer: i.e. "dealer"in ESPR, intermediary entity who sells and offers products for sale to customers using (online) channel(s), has legal responsibility to ensure DPPs are easily accessible to consumers
              -- Independent operator: entity independent of the manufacturer, involved in the repair, maintenance, waste management, or distribution of the products, e.g. small electronics repair shops, waste management organization
            4.	The digital maturity level indicates how complicated the ICT solution should be (the digital maturity model has the following options: a) incomplete (no digitalization in the company), b) performed (planning has been made), c) managed (ensuring existing business processes are digitized through technology), d) established (digital transformation has been done based on existing standard), e) predictable (seizes those benefits by applying quantitative techniques on real-time data), f) optimizing (innovation and continuous improvement));
            5.	The compliance interest indicates whether the company wants to comply at the absolute minimum (2), within an ecosystem that has accepted the DPP (3), in a way that improves their position (4), by getting ahead of their competition (5), or simply does not want to comply at all (1) (this determines how extensive your list should be);
            6.  The perspective determines what details should be more extensive, choosing between business (cost-benefits, financial business case), ICT (implementation), and sustainability (how to leverage).
            Note that a good requirement includes the following:   
            -	ID (should be "ID X" with X as a number and numbering continues from the must requirements, allows for quick references);
            -	Title (short description, should be formatted with previous as "ID: Title");
            -	Statement (actual requirement): not explicit structure: [Condition] + [Subject] + “should/could” + [Action] + [Constraint] (with should/could from the MoSCoW method, that shows difference between requirements and recommendations, but you do not have to use all verbs);
            -	Risk (those existing up to the point of taking action);  
            -	Source (fully include source, link, and quote); 
            -	Details (should contain relevant information based on the perspective, e.g. financial details and business benefits for business, or technology implementation and validation criteria for ICT).
            Don't use tables in your response, not even for illustration. The current date is ` + new Date() + `, which can be used when considering the regulations that are in-force. 
            Very important: do not start your response with any prefacing text, immediately start with your first requirement. Do not include any headers between the requirements, like "Should requirements". Do not end your response with any suggestions for other ways in which you can help.
            REMEMBER: The most important goal of this request is to customize to all user input!
            `
        },
        {
          role: "user",
          content:
`
Context:
${contextB}

User:
${userInput}

Must requirements:
${completion1.choices[0].message.content}
`
        }
      ],

      temperature: 0.7,
      max_tokens: 1600,
      reasoning_effort: "none",
    });

    const htmlA =
      buildHTML(
        docsA,
        metadataA
      );

    const htmlB =
      buildHTML(
        docsB,
        metadataB
      );

    const htmlDate = 
      getLowestDateInForce(
        docsA,
        metadataA
      );

    res.json({

      commission_only_output:
        completion1
          .choices[0]
          .message.content,

      full_context_output:
        completion2
          .choices[0]
          .message.content,

      sources: {
        commission: htmlA,
        full: htmlB,
        date: htmlDate,
      }
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: "Server error"
    });
  }
});

const PORT =
  process.env.PORT || 3000;

app.listen(PORT, () => {

  console.log(
    `Server running on ${PORT}`
  );
});