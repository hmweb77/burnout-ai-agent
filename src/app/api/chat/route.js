// app/api/chat/route.js
import { NextResponse } from 'next/server'
import { generateEmbedding, generateChatResponse } from '@/lib/openai'
import { searchBookChunks } from '@/lib/local-storage'

export async function POST(request) {
  try {
    // Parse the request body
    const { question } = await request.json()

    // Validate input
    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      return NextResponse.json(
        { error: 'Question is required and must be a non-empty string' },
        { status: 400 }
      )
    }

    if (question.length > 1000) {
      return NextResponse.json(
        { error: 'Question is too long. Please keep it under 1000 characters.' },
        { status: 400 }
      )
    }

    console.log('Processing question:', question.substring(0, 100) + '...')

    // Step 1: Generate embedding for the user's question
    const questionEmbedding = await generateEmbedding(question)

    // Step 2: Search for similar chunks in the local storage
    const relevantChunks = await searchBookChunks(
      questionEmbedding,
      0.75, // Similarity threshold (0.75 = 75% similar)
      5     // Number of chunks to retrieve
    )

    console.log(`Found ${relevantChunks.length} relevant chunks`)

    // Step 3: Check if we found any relevant content
    if (relevantChunks.length === 0) {
      return NextResponse.json({
        answer: "I cannot find any relevant information about that topic in the available books. Could you try rephrasing your question or asking about a different topic?",
        sources: [],
        confidence: 0
      })
    }

    // Step 4: Generate response using GPT-4o with the relevant chunks
    const answer = await generateChatResponse(question, relevantChunks)

    // Step 5: Prepare source information for the response
    const sources = relevantChunks.map((chunk, index) => ({
      id: chunk.id || `chunk-${index}`,
      bookTitle: chunk.metadata?.book_title || 'Unknown Book',
      chunkIndex: chunk.metadata?.chunk_index || index,
      similarity: Math.round(chunk.similarity * 100),
      preview: chunk.content.substring(0, 200) + '...'
    }))

    // Calculate average confidence based on similarity scores
    const averageConfidence = relevantChunks.length > 0 
      ? Math.round(relevantChunks.reduce((sum, chunk) => sum + chunk.similarity, 0) / relevantChunks.length * 100)
      : 0

    console.log('Response generated successfully')

    return NextResponse.json({
      answer,
      sources,
      confidence: averageConfidence,
      chunksFound: relevantChunks.length
    })

  } catch (error) {
    console.error('Error in chat API:', error)

    // Handle specific error types
    if (error.message.includes('embedding')) {
      return NextResponse.json(
        { error: 'Failed to process your question. Please try again.' },
        { status: 500 }
      )
    }

    if (error.message.includes('chunks') || error.message.includes('storage')) {
      return NextResponse.json(
        { error: 'Book data not available. Please run the ingestion script first.' },
        { status: 503 }
      )
    }

    if (error.message.includes('OpenAI') || error.message.includes('API')) {
      return NextResponse.json(
        { error: 'AI service temporarily unavailable. Please try again.' },
        { status: 503 }
      )
    }

    // Generic error
    return NextResponse.json(
      { error: 'An unexpected error occurred. Please try again.' },
      { status: 500 }
    )
  }
}

// Handle GET requests (for health check)
export async function GET() {
  try {
    const { loadBookChunks } = await import('@/lib/local-storage');
    const chunks = await loadBookChunks();
    
    return NextResponse.json({
      status: 'Chat API is running',
      timestamp: new Date().toISOString(),
      chunksLoaded: chunks.length
    })
  } catch (error) {
    return NextResponse.json({
      status: 'Chat API is running',
      timestamp: new Date().toISOString(),
      chunksLoaded: 0,
      warning: 'No book chunks found'
    })
  }
}