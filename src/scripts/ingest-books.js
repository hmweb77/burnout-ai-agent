// src/scripts/ingest-books.js
import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { fileURLToPath } from 'url';
import { saveBookChunks } from '../lib/local-storage.js';

// ES module compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const CHUNK_SIZE = 400; // Target tokens per chunk (roughly 300-500 words)
const CHUNK_OVERLAP = 50; // Overlap between chunks to maintain context
const BOOKS_DIRECTORY = path.join(__dirname, '..', 'books'); // Put your files here

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Simple tokenizer approximation (1 token ≈ 0.75 words)
function estimateTokens(text) {
  return Math.ceil(text.split(/\s+/).length / 0.75);
}

// Clean and normalize text
function cleanText(text) {
  return text
    .replace(/<[^>]*>/g, '') // Remove HTML tags
    .replace(/\s+/g, ' ') // Normalize whitespace
    .replace(/\n\s*\n/g, '\n') // Remove extra line breaks
    .trim();
}

// Split text into overlapping chunks
function splitTextIntoChunks(text, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const chunks = [];
  let currentChunk = '';
  let currentTokens = 0;

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i].trim() + '.';
    const sentenceTokens = estimateTokens(sentence);

    // If adding this sentence would exceed chunk size, finalize current chunk
    if (currentTokens + sentenceTokens > chunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());

      // Start new chunk with overlap
      const words = currentChunk.split(/\s+/);
      const overlapWords = words.slice(-overlap);
      currentChunk = overlapWords.join(' ') + ' ' + sentence;
      currentTokens = estimateTokens(currentChunk);
    } else {
      currentChunk += (currentChunk ? ' ' : '') + sentence;
      currentTokens += sentenceTokens;
    }
  }

  // Add the last chunk if it exists
  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  return chunks.filter(chunk => chunk.length > 50); // Filter out very short chunks
}

// Generate embedding for a text chunk
async function generateEmbedding(text) {
  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });
    return response.data[0].embedding;
  } catch (error) {
    console.error('Error generating embedding:', error);
    throw error;
  }
}

// Generate unique ID for chunks
function generateChunkId(bookTitle, chunkIndex) {
  return `${bookTitle.replace(/[^a-zA-Z0-9]/g, '_')}_chunk_${chunkIndex}`;
}

// Process a single book file
async function processBook(filePath, allChunks) {
  console.log(`\n📖 Processing: ${path.basename(filePath)}`);
  
  try {
    let content;
    const ext = path.extname(filePath).toLowerCase();
    const bookTitle = path.basename(filePath, ext);
    
    // Extract content based on file type
    if (ext === '.txt') {
      content = fs.readFileSync(filePath, 'utf-8');
    } else {
      console.log(`❌ Unsupported file format: ${ext} (only .txt supported without epub dependency)`);
      return 0;
    }
    
    console.log(`📄 Book length: ${content.length} characters`);
    
    if (content.length < 100) {
      console.log(`⚠️  Book content too short, skipping: ${bookTitle}`);
      return 0;
    }
    
    // Clean the content
    content = cleanText(content);
    
    // Split into chunks
    const chunks = splitTextIntoChunks(content);
    console.log(`✂️  Created ${chunks.length} chunks`);
    
    // Process chunks in batches to avoid rate limits
    const batchSize = 5;
    let processedCount = 0;
    
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      
      // Generate embeddings for this batch
      const embeddingPromises = batch.map(async (chunk, index) => {
        const globalIndex = i + index;
        
        try {
          const embedding = await generateEmbedding(chunk);
          
          return {
            id: generateChunkId(bookTitle, globalIndex),
            content: chunk,
            embedding,
            metadata: {
              book_title: bookTitle,
              chunk_index: globalIndex,
              chunk_length: chunk.length,
              estimated_tokens: estimateTokens(chunk),
              file_path: filePath,
              file_type: ext
            }
          };
        } catch (error) {
          console.error(`❌ Error processing chunk ${globalIndex}:`, error);
          return null;
        }
      });
      
      const embeddedChunks = (await Promise.all(embeddingPromises)).filter(Boolean);
      
      // Add to the main chunks array
      allChunks.push(...embeddedChunks);
      processedCount += embeddedChunks.length;
      
      console.log(`✅ Processed batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(chunks.length/batchSize)} (${processedCount}/${chunks.length} chunks)`);
      
      // Rate limiting: wait between batches
      if (i + batchSize < chunks.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    console.log(`✅ Completed ${bookTitle}: ${processedCount} chunks processed`);
    return processedCount;
    
  } catch (error) {
    console.error(`❌ Error processing ${filePath}:`, error);
    return 0;
  }
}

// Main ingestion function
async function ingestBooks() {
  console.log('🚀 Starting book ingestion process...\n');
  
  // Verify environment variables
  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY environment variable is required');
    console.log('Create a .env.local file with your OpenAI API key');
    process.exit(1);
  }
  
  // Check if books directory exists
  if (!fs.existsSync(BOOKS_DIRECTORY)) {
    console.log(`📁 Creating books directory: ${BOOKS_DIRECTORY}`);
    fs.mkdirSync(BOOKS_DIRECTORY, { recursive: true });
    console.log('📚 Please add your .txt book files to this directory and run the script again');
    return;
  }
  
  // Get all supported files in the books directory
  const supportedFiles = fs.readdirSync(BOOKS_DIRECTORY)
    .filter(file => {
      const ext = path.extname(file).toLowerCase();
      return ext === '.txt';
    })
    .map(file => path.join(BOOKS_DIRECTORY, file));
    
  if (supportedFiles.length === 0) {
    console.error('❌ No supported files (.txt) found in the books directory');
    console.log(`📁 Please add your book files to: ${BOOKS_DIRECTORY}`);
    return;
  }
  
  console.log(`📚 Found ${supportedFiles.length} book(s) to process:`);
  supportedFiles.forEach(file => console.log(`  - ${path.basename(file)}`));
  
  // Process each book and collect all chunks
  let allChunks = [];
  let totalProcessedChunks = 0;
  const startTime = Date.now();
  
  for (const filePath of supportedFiles) {
    const chunkCount = await processBook(filePath, allChunks);
    totalProcessedChunks += chunkCount;
  }
  
  // Save all chunks to local storage
  if (allChunks.length > 0) {
    console.log(`\n💾 Saving ${allChunks.length} chunks to local storage...`);
    await saveBookChunks(allChunks);
  }
  
  const endTime = Date.now();
  const duration = Math.round((endTime - startTime) / 1000);
  
  console.log(`\n🎉 Ingestion complete!`);
  console.log(`📊 Total chunks processed: ${totalProcessedChunks}`);
  console.log(`⏱️  Time taken: ${duration} seconds`);
  console.log(`💰 Estimated OpenAI cost: $${(totalProcessedChunks * 0.00001).toFixed(4)} USD`);
  
  if (totalProcessedChunks > 0) {
    console.log(`\n🚀 Ready to test! Run 'npm run dev' and visit http://localhost:3000`);
  }
}

// Run the ingestion if this script is called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  ingestBooks().catch(console.error);
}

export { ingestBooks, processBook, splitTextIntoChunks, generateEmbedding };