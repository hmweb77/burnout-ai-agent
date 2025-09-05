// src/scripts/check-setup.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import { loadBookChunks, getBookStats } from '../lib/local-storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BOOKS_DIRECTORY = path.join(__dirname, '..', 'books');

async function checkSetup() {
  console.log('🔍 AI Book Assistant - Setup Diagnostic\n');

  // 1. Check environment variables
  console.log('1️⃣ Checking Environment Variables...');
  const hasOpenAIKey = !!process.env.OPENAI_API_KEY;
  console.log(`   OpenAI API Key: ${hasOpenAIKey ? '✅ Present' : '❌ Missing'}`);
  
  if (!hasOpenAIKey) {
    console.log('   ⚠️  Create a .env.local file with OPENAI_API_KEY=your_key_here');
  }

  // 2. Test OpenAI connection
  console.log('\n2️⃣ Testing OpenAI Connection...');
  if (hasOpenAIKey) {
    try {
      const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
      await openai.models.list();
      console.log('   ✅ OpenAI API connection successful');
    } catch (error) {
      console.log('   ❌ OpenAI API connection failed:', error.message);
    }
  } else {
    console.log('   ⏭️  Skipped (no API key)');
  }

  // 3. Check books directory
  console.log('\n3️⃣ Checking Books Directory...');
  console.log(`   Directory: ${BOOKS_DIRECTORY}`);
  
  if (!fs.existsSync(BOOKS_DIRECTORY)) {
    console.log('   ❌ Books directory does not exist');
    console.log('   💡 Creating directory...');
    fs.mkdirSync(BOOKS_DIRECTORY, { recursive: true });
    console.log('   ✅ Directory created');
  } else {
    console.log('   ✅ Directory exists');
  }

  // 4. Check for book files
  console.log('\n4️⃣ Checking Book Files...');
  const files = fs.readdirSync(BOOKS_DIRECTORY);
  const txtFiles = files.filter(file => file.endsWith('.txt'));
  
  console.log(`   Total files: ${files.length}`);
  console.log(`   .txt files: ${txtFiles.length}`);
  
  if (txtFiles.length === 0) {
    console.log('   ⚠️  No .txt files found');
    console.log('   💡 Add your book files (.txt format) to this directory');
  } else {
    console.log('   ✅ Book files found:');
    txtFiles.forEach(file => {
      const filePath = path.join(BOOKS_DIRECTORY, file);
      const stats = fs.statSync(filePath);
      console.log(`      - ${file} (${Math.round(stats.size / 1024)}KB)`);
    });
  }

  // 5. Check processed chunks
  console.log('\n5️⃣ Checking Processed Book Data...');
  try {
    const chunks = await loadBookChunks();
    console.log(`   Total chunks: ${chunks.length}`);
    
    if (chunks.length === 0) {
      console.log('   ⚠️  No processed chunks found');
      console.log('   💡 Run: node src/scripts/ingest-books.js');
    } else {
      console.log('   ✅ Processed data found');
      
      // Get detailed stats
      const stats = await getBookStats();
      console.log(`   Books processed: ${stats.totalBooks}`);
      console.log('   Book breakdown:');
      Object.entries(stats.bookBreakdown).forEach(([title, data]) => {
        console.log(`      - ${title}: ${data.chunkCount} chunks`);
      });
    }
  } catch (error) {
    console.log('   ❌ Error loading chunks:', error.message);
  }

  // 6. Test embedding generation
  console.log('\n6️⃣ Testing Embedding Generation...');
  if (hasOpenAIKey) {
    try {
      const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
      
      const response = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: 'test embedding',
      });
      
      console.log('   ✅ Embedding generation successful');
      console.log(`   Embedding dimensions: ${response.data[0].embedding.length}`);
    } catch (error) {
      console.log('   ❌ Embedding generation failed:', error.message);
    }
  } else {
    console.log('   ⏭️  Skipped (no API key)');
  }

  // 7. Summary and next steps
  console.log('\n📋 Summary & Next Steps:');
  
  if (!hasOpenAIKey) {
    console.log('❌ Add OpenAI API key to .env.local file');
  }
  
  if (txtFiles.length === 0) {
    console.log('❌ Add .txt book files to src/books/ directory');
  }
  
  try {
    const chunks = await loadBookChunks();
    if (chunks.length === 0 && txtFiles.length > 0) {
      console.log('❌ Run ingestion: node src/scripts/ingest-books.js');
    }
    
    if (hasOpenAIKey && txtFiles.length > 0 && chunks.length > 0) {
      console.log('✅ Setup complete! Your AI Book Assistant should work.');
      console.log('🚀 Run: npm run dev');
    }
  } catch (error) {
    console.log('❌ Check your setup and try again');
  }
}

checkSetup().catch(console.error);