// lib/local-storage.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to store the processed chunks
const CHUNKS_FILE = path.join(__dirname, '..', 'data', 'book-chunks.json');

// Ensure data directory exists
function ensureDataDirectory() {
  const dataDir = path.dirname(CHUNKS_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

// Save chunks to local file
export async function saveBookChunks(chunks) {
  ensureDataDirectory();
  
  try {
    fs.writeFileSync(CHUNKS_FILE, JSON.stringify(chunks, null, 2));
    console.log(`✅ Saved ${chunks.length} chunks to ${CHUNKS_FILE}`);
    return true;
  } catch (error) {
    console.error('Error saving chunks:', error);
    throw error;
  }
}

// Load chunks from local file
export async function loadBookChunks() {
  try {
    if (!fs.existsSync(CHUNKS_FILE)) {
      console.log('No chunks file found. Run ingestion first.');
      return [];
    }
    
    const data = fs.readFileSync(CHUNKS_FILE, 'utf-8');
    const chunks = JSON.parse(data);
    return chunks;
  } catch (error) {
    console.error('Error loading chunks:', error);
    return [];
  }
}

// Calculate cosine similarity between two vectors
function cosineSimilarity(vecA, vecB) {
  if (vecA.length !== vecB.length) {
    throw new Error('Vectors must have the same length');
  }
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  
  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);
  
  if (normA === 0 || normB === 0) {
    return 0;
  }
  
  return dotProduct / (normA * normB);
}

// Search for similar chunks using cosine similarity
export async function searchBookChunks(queryEmbedding, matchThreshold = 0.75, matchCount = 5) {
  try {
    const chunks = await loadBookChunks();
    
    if (chunks.length === 0) {
      return [];
    }
    
    // Calculate similarity for each chunk
    const similarities = chunks.map(chunk => {
      const similarity = cosineSimilarity(queryEmbedding, chunk.embedding);
      return {
        ...chunk,
        similarity
      };
    });
    
    // Filter by threshold and sort by similarity
    const filtered = similarities
      .filter(chunk => chunk.similarity >= matchThreshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, matchCount);
    
    return filtered;
  } catch (error) {
    console.error('Error searching chunks:', error);
    throw error;
  }
}

// Get statistics about stored chunks
export async function getBookStats() {
  try {
    const chunks = await loadBookChunks();
    
    if (chunks.length === 0) {
      return {
        totalChunks: 0,
        totalBooks: 0,
        bookBreakdown: {}
      };
    }
    
    // Group by book title
    const bookStats = {};
    chunks.forEach(chunk => {
      const title = chunk.metadata?.book_title || 'Unknown';
      if (!bookStats[title]) {
        bookStats[title] = {
          chunkCount: 0,
          totalTokens: 0
        };
      }
      bookStats[title].chunkCount += 1;
      bookStats[title].totalTokens += parseInt(chunk.metadata?.estimated_tokens) || 0;
    });
    
    return {
      totalChunks: chunks.length,
      totalBooks: Object.keys(bookStats).length,
      bookBreakdown: bookStats
    };
  } catch (error) {
    console.error('Error getting book stats:', error);
    throw error;
  }
}