// test-openai.js - Simple test to verify OpenAI works
import dotenv from 'dotenv';
import OpenAI from 'openai';

// Load environment variables
console.log('Loading .env.local file...');
const result = dotenv.config({ path: '.env.local' });

if (result.error) {
  console.error('❌ Error loading .env.local:', result.error.message);
  process.exit(1);
}

console.log(`✅ Environment loaded from: ${result.parsed ? '.env.local' : 'system'}`);
console.log(`🔑 API Key found: ${process.env.OPENAI_API_KEY ? 'Yes' : 'No'}`);

if (process.env.OPENAI_API_KEY) {
  console.log(`🔍 Key preview: ${process.env.OPENAI_API_KEY.substring(0, 20)}...`);
} else {
  console.error('❌ No API key found');
  process.exit(1);
}

// Test OpenAI connection
try {
  console.log('\n🧪 Testing OpenAI connection...');
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const response = await openai.models.list();
  console.log('✅ OpenAI connection successful!');
  console.log(`📋 Available models: ${response.data.length}`);

  // Test embedding generation
  console.log('\n🧪 Testing embedding generation...');
  const embedding = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: 'Hello, this is a test.',
  });
  
  console.log('✅ Embedding generation successful!');
  console.log(`📐 Embedding dimensions: ${embedding.data[0].embedding.length}`);
  console.log('\n🎉 All tests passed! Your setup is working correctly.');
  
} catch (error) {
  console.error('❌ OpenAI test failed:', error.message);
  
  if (error.message.includes('401')) {
    console.log('💡 Error 401 usually means your API key is invalid or expired');
    console.log('💡 Please check your API key at: https://platform.openai.com/api-keys');
  } else if (error.message.includes('429')) {
    console.log('💡 Error 429 means you hit rate limits or ran out of credits');
    console.log('💡 Please check your billing at: https://platform.openai.com/account/billing');
  }
  
  process.exit(1);
}