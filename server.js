import express from "express";
import Groq from "groq-sdk";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// Enable CORS so frontend on GitHub Pages can call API
app.use(cors({
  origin: "https://isabelrut.github.io", // replace with your GitHub Pages URL
}));

// Parse JSON bodies
app.use(express.json());

// Serve static files if needed (optional)
app.use(express.static(path.join(__dirname, "docs")));

// API endpoint for LLM
app.post("/generate", async (req, res) => {
  try {
    const userInput = req.body.input;

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: "You are an expert AI assistant helping organizations implement the Digital Product Passport (DPP). Based on the user input about the organization, provide a clear customized action plan with concrete steps." },
        { role: "user", content: userInput }
      ],
    });

    res.json({ output: completion.choices[0].message.content });

  } catch (error) {
    console.error("ERROR:", error);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// Start server
const PORT = process.env.PORT || 3000; // Use environment port for hosting
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
