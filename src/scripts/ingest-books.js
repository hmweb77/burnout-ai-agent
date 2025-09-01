// src/scripts/ingest-books.js
import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'url';
import EPub from 'epub';
import { promisify } from 'util';

// ES module compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const CHUNK_SIZE = 400; // Target tokens per chunk (roughly 300-500 words)
const CHUNK_OVERLAP = 50; // Overlap between chunks to maintain context
const BOOKS_DIRECTORY = path.join(__dirname, '..', 'books'); // Put your files here

// Initialize clients
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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

// Extract text from EPUB file
async function extractEpubText(filePath) {
  return new Promise((resolve, reject) => {
    const epub = new EPub(filePath);
    
    epub.on('error', reject);
    
    epub.on('end', async () => {
      try {
        const chapters = epub.flow;
        let fullText = '';
        
        for (const chapter of chapters) {
          const getChapterText = promisify(epub.getChapter.bind(epub));
          const chapterData = await getChapterText(chapter.id);
          const cleanChapterText = cleanText(chapterData);
          fullText += cleanChapterText + '\n\n';
        }
        
        resolve(fullText);
      } catch (error) {
        reject(error);
      }
    });
    
    epub.parse();
  });
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

// Process a single book file
async function processBook(filePath) {
  console.log(`\n📖 Processing: ${path.basename(filePath)}`);
  
  try {
    let content;
    const ext = path.extname(filePath).toLowerCase();
    const bookTitle = path.basename(filePath, ext);
    
    // Extract content based on file type
    if (ext === '.epub') {
      console.log('📚 Extracting EPUB content...');
      content = await extractEpubText(filePath);
    } else if (ext === '.txt') {
      content = fs.readFileSync(filePath, 'utf-8');
    } else {
      console.log(`❌ Unsupported file format: ${ext}`);
      return 0;
    }
    
    console.log(`📄 Book length: ${content.length} characters`);
    
    if (content.length < 100) {
      console.log(`⚠️  Book content too short, skipping: ${bookTitle}`);
      return 0;
    }
    
    // Split into chunks
    const chunks = splitTextIntoChunks(content);
    console.log(`✂️  Created ${chunks.length} chunks`);
    
    // Process chunks in batches to avoid rate limits
    const batchSize = 3; // Reduced for EPUB processing
    let processedCount = 0;
    
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      
      // Generate embeddings for this batch
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
              file_type: ext
            }
          };
        } catch (error) {
          console.error(`❌ Error processing chunk ${globalIndex}:`, error);
          return null;
        }
      });
      
      const embeddedChunks = (await Promise.all(embeddingPromises)).filter(Boolean);
      
      // Insert batch into Supabase
      if (embeddedChunks.length > 0) {
        const { error } = await supabase
          .from('book_chunks')
          .insert(embeddedChunks);
          
        if (error) {
          console.error('❌ Supabase insert error:', error);
        } else {
          processedCount += embeddedChunks.length;
          console.log(`✅ Inserted batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(chunks.length/batchSize)} (${processedCount}/${chunks.length} chunks)`);
        }
      }
      
      // Rate limiting: wait between batches
      if (i + batchSize < chunks.length) {
        await new Promise(resolve => setTimeout(resolve, 1500));
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
    process.exit(1);
  }
  
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required');
    process.exit(1);
  }
  
  // Check if books directory exists
  if (!fs.existsSync(BOOKS_DIRECTORY)) {
    console.log(`📁 Creating books directory: ${BOOKS_DIRECTORY}`);
    fs.mkdirSync(BOOKS_DIRECTORY, { recursive: true });
  }
  
  // Get all supported files in the books directory
  const supportedFiles = fs.readdirSync(BOOKS_DIRECTORY)
    .filter(file => {
      const ext = path.extname(file).toLowerCase();
      return ext === '.txt' || ext === '.epub';
    })
    .map(file => path.join(BOOKS_DIRECTORY, file));
    
  if (supportedFiles.length === 0) {
    console.error('❌ No supported files (.txt, .epub) found in the books directory');
    console.log(`📁 Please add your book files to: ${BOOKS_DIRECTORY}`);
    return;
  }
  
  console.log(`📚 Found ${supportedFiles.length} book(s) to process:`);
  supportedFiles.forEach(file => console.log(`  - ${path.basename(file)}`));
  
  // Test database connection
  console.log('\n🔍 Testing database connection...');
  const { data: testData, error: testError } = await supabase
    .from('book_chunks')
    .select('count(*)')
    .limit(1);
    
  if (testError) {
    console.error('❌ Database connection failed:', testError);
    return;
  }
  console.log('✅ Database connection successful');
  
  // Clear existing chunks (optional)
  console.log('\n🗑️  Clearing existing book chunks...');
  const { error: deleteError } = await supabase
    .from('book_chunks')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');
    
  if (deleteError) {
    console.error('❌ Error clearing existing chunks:', deleteError);
  } else {
    console.log('✅ Existing chunks cleared');
  }
  
  // Process each book
  let totalChunks = 0;
  const startTime = Date.now();
  
  for (const filePath of supportedFiles) {
    const chunkCount = await processBook(filePath);
    totalChunks += chunkCount;
  }
  
  const endTime = Date.now();
  const duration = Math.round((endTime - startTime) / 1000);
  
  console.log(`\n🎉 Ingestion complete!`);
  console.log(`📊 Total chunks processed: ${totalChunks}`);
  console.log(`⏱️  Time taken: ${duration} seconds`);
  console.log(`💰 Estimated OpenAI cost: $${(totalChunks * 0.00001).toFixed(4)} USD`);
  
  if (totalChunks > 0) {
    console.log(`\n🚀 Ready to test! Run 'npm run dev' and visit http://localhost:3000`);
  }
}

// Run the ingestion if this script is called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  ingestBooks().catch(console.error);
}

export { ingestBooks, processBook, splitTextIntoChunks, generateEmbedding };