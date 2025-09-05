// src/scripts/upload-to-supabase.js
import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { fileURLToPath } from 'url';
import { supabaseAdmin } from '../lib/supabase.js';

// Load environment variables
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BOOKS_DIRECTORY = path.join(__dirname, '..', 'books');
const CHUNK_SIZE = 400;
const CHUNK_OVERLAP = 50;

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Reuse existing utility functions
function estimateTokens(text) {
  return Math.ceil(text.split(/\s+/).length / 0.75);
}

function cleanText(text) {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim();
}

function splitTextIntoChunks(text, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const chunks = [];
  let currentChunk = '';
  let currentTokens = 0;

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i].trim() + '.';
    const sentenceTokens = estimateTokens(sentence);

    if (currentTokens + sentenceTokens > chunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      const words = currentChunk.split(/\s+/);
      const overlapWords = words.slice(-overlap);
      currentChunk = overlapWords.join(' ') + ' ' + sentence;
      currentTokens = estimateTokens(currentChunk);
    } else {
      currentChunk += (currentChunk ? ' ' : '') + sentence;
      currentTokens += sentenceTokens;
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  return chunks.filter(chunk => chunk.length > 50);
}

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

// Clear existing chunks for a book (useful for re-uploading)
async function clearBookChunks(bookTitle) {
  try {
    const { error } = await supabaseAdmin
      .from('book_chunks')
      .delete()
      .eq('metadata->>book_title', bookTitle);
    
    if (error) throw error;
    console.log(`✅ Cleared existing chunks for: ${bookTitle}`);
  } catch (error) {
    console.error(`❌ Error clearing chunks for ${bookTitle}:`, error);
    throw error;
  }
}

// Upload chunks to Supabase in batches
async function uploadChunksToSupabase(chunks, bookTitle) {
  const batchSize = 10; // Supabase handles larger batches well
  let uploadedCount = 0;

  console.log(`📤 Uploading ${chunks.length} chunks to Supabase...`);

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    
    try {
      const { error } = await supabaseAdmin
        .from('book_chunks')
        .insert(batch);

      if (error) throw error;
      
      uploadedCount += batch.length;
      console.log(`✅ Uploaded batch ${Math.ceil((i + 1) / batchSize)}/${Math.ceil(chunks.length / batchSize)} (${uploadedCount}/${chunks.length} chunks)`);
      
      // Small delay to avoid overwhelming Supabase
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error(`❌ Error uploading batch starting at index ${i}:`, error);
      throw error;
    }
  }

  return uploadedCount;
}

// Process a single book and upload to Supabase
async function processBookToSupabase(filePath, clearExisting = false) {
  console.log(`\n📖 Processing: ${path.basename(filePath)}`);
  
  try {
    const ext = path.extname(filePath).toLowerCase();
    const bookTitle = path.basename(filePath, ext);
    
    if (ext !== '.txt') {
      console.log(`❌ Unsupported file format: ${ext}`);
      return 0;
    }

    // Clear existing chunks if requested
    if (clearExisting) {
      await clearBookChunks(bookTitle);
    }

    // Read and process the book
    const content = fs.readFileSync(filePath, 'utf-8');
    console.log(`📄 Book length: ${content.length} characters`);
    
    if (content.length < 100) {
      console.log(`⚠️  Book content too short, skipping: ${bookTitle}`);
      return 0;
    }
    
    const cleanedContent = cleanText(content);
    const textChunks = splitTextIntoChunks(cleanedContent);
    console.log(`✂️  Created ${textChunks.length} chunks`);
    
    // Process chunks and generate embeddings
    const processedChunks = [];
    const embeddingBatchSize = 5;
    
    for (let i = 0; i < textChunks.length; i += embeddingBatchSize) {
      const batch = textChunks.slice(i, i + embeddingBatchSize);
      
      const embeddingPromises = batch.map(async (chunk, index) => {
        const globalIndex = i + index;
        
        try {
          const embedding = await generateEmbedding(chunk);
          
          return {
            content: chunk,
            embedding,
            metadata: {
              book_title: bookTitle,
              chunk_index: globalIndex,
              chunk_length: chunk.length,
              estimated_tokens: estimateTokens(chunk),
              file_path: filePath,
              file_type: ext,
              // Add page estimation (very rough)
              estimated_page: Math.floor(globalIndex / 3) + 1, // ~3 chunks per page
              uploaded_at: new Date().toISOString()
            }
          };
        } catch (error) {
          console.error(`❌ Error processing chunk ${globalIndex}:`, error);
          return null;
        }
      });
      
      const embeddedChunks = (await Promise.all(embeddingPromises)).filter(Boolean);
      processedChunks.push(...embeddedChunks);
      
      console.log(`✅ Processed embeddings ${Math.floor(i/embeddingBatchSize) + 1}/${Math.ceil(textChunks.length/embeddingBatchSize)} (${processedChunks.length}/${textChunks.length} chunks)`);
      
      // Rate limiting for OpenAI
      if (i + embeddingBatchSize < textChunks.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    // Upload to Supabase
    const uploadedCount = await uploadChunksToSupabase(processedChunks, bookTitle);
    
    console.log(`✅ Successfully uploaded ${uploadedCount} chunks for: ${bookTitle}`);
    return uploadedCount;
    
  } catch (error) {
    console.error(`❌ Error processing ${filePath}:`, error);
    return 0;
  }
}

// Main upload function
async function uploadBooksToSupabase() {
  console.log('🚀 Starting Supabase book upload process...\n');
  
  // Verify environment variables
  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY environment variable is required');
    process.exit(1);
  }
  
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required');
    process.exit(1);
  }

  // Test Supabase connection
  try {
    console.log('🧪 Testing Supabase connection...');
    const { data, error } = await supabaseAdmin.from('book_chunks').select('count', { count: 'exact', head: true });
    if (error) throw error;
    console.log('✅ Supabase connection successful\n');
  } catch (error) {
    console.error('❌ Supabase connection failed:', error.message);
    process.exit(1);
  }
  
  // Test OpenAI connection
  try {
    console.log('🧪 Testing OpenAI connection...');
    await openai.models.list();
    console.log('✅ OpenAI connection successful\n');
  } catch (error) {
    console.error('❌ OpenAI connection failed:', error.message);
    process.exit(1);
  }
  
  // Get book files
  if (!fs.existsSync(BOOKS_DIRECTORY)) {
    console.error(`❌ Books directory not found: ${BOOKS_DIRECTORY}`);
    process.exit(1);
  }
  
  const bookFiles = fs.readdirSync(BOOKS_DIRECTORY)
    .filter(file => file.endsWith('.txt'))
    .map(file => path.join(BOOKS_DIRECTORY, file));
    
  if (bookFiles.length === 0) {
    console.error('❌ No .txt files found in books directory');
    process.exit(1);
  }
  
  console.log(`📚 Found ${bookFiles.length} book(s) to upload:`);
  bookFiles.forEach(file => console.log(`  - ${path.basename(file)}`));
  
  // Process each book
  let totalChunks = 0;
  const startTime = Date.now();
  
  for (const filePath of bookFiles) {
    const chunkCount = await processBookToSupabase(filePath, true); // Clear existing
    totalChunks += chunkCount;
  }
  
  const endTime = Date.now();
  const duration = Math.round((endTime - startTime) / 1000);
  
  console.log(`\n🎉 Upload complete!`);
  console.log(`📊 Total chunks uploaded: ${totalChunks}`);
  console.log(`⏱️  Time taken: ${duration} seconds`);
  console.log(`💰 Estimated OpenAI cost: $${(totalChunks * 0.00001).toFixed(4)} USD`);
  
  if (totalChunks > 0) {
    console.log(`\n🚀 Ready to test! Your books are now in Supabase.`);
    console.log(`   Run 'npm run dev' and visit http://localhost:3000`);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  uploadBooksToSupabase().catch(console.error);
}

export { uploadBooksToSupabase, processBookToSupabase };