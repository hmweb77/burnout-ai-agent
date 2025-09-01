// lib/openai.js
import OpenAI from 'openai'

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

// Generate embedding for a given text
export async function generateEmbedding(text) {
  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text.trim(),
    })

    return response.data[0].embedding
  } catch (error) {
    console.error('Error generating embedding:', error)
    throw new Error(`Failed to generate embedding: ${error.message}`)
  }
}

// Generate chat response using GPT-4o
export async function generateChatResponse(question, relevantChunks) {
  try {
    // Prepare the context from relevant chunks
    const context = relevantChunks
      .map((chunk, index) => {
        const bookTitle = chunk.metadata?.book_title || 'Unknown Book'
        return `[Source ${index + 1} - ${bookTitle}]:\n${chunk.content}`
      })
      .join('\n\n---\n\n')

    // Create the system prompt
    const systemPrompt = `You are an AI assistant that answers questions based ONLY on the provided book excerpts. 

IMPORTANT RULES:
1. Only use information from the provided sources below
2. If the answer cannot be found in the sources, say "I cannot find information about that in the provided books"
3. Always cite which source(s) you're referencing (e.g., "According to Source 1...")
4. Be conversational and helpful in your tone
5. If multiple sources have relevant information, synthesize them coherently

Available Sources:
${context}`

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: question
        }
      ],
      temperature: 0.1, // Keep responses focused and consistent
      max_tokens: 1500,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0
    })

    return response.choices[0].message.content
  } catch (error) {
    console.error('Error generating chat response:', error)
    throw new Error(`Failed to generate response: ${error.message}`)
  }
}

// Function to validate OpenAI API key
export async function validateOpenAIKey() {
  try {
    await openai.models.list()
    return true
  } catch (error) {
    console.error('OpenAI API key validation failed:', error)
    return false
  }
}

// Estimate token count (rough approximation)
export function estimateTokens(text) {
  return Math.ceil(text.split(/\s+/).length / 0.75)
}