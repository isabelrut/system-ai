import { pipeline } from "@xenova/transformers";

// Load embedding model once
const extractor = await pipeline(
  "feature-extraction",
  "Xenova/all-MiniLM-L6-v2"
);

console.log("Embedding model loaded");

export async function embedText(text) {

  const output = await extractor(text, {
    pooling: "mean",
    normalize: true,
  });

  return Array.from(output.data);
}