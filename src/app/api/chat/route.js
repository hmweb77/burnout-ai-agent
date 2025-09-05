// app/api/chat/route.js
import { NextResponse } from 'next/server'
import { generateEmbedding, generateChatResponse } from '@/lib/openai'
import { searchBookChunks, getBookStats } from '@/lib/supabase'

export async function POST(request) {
  try {
    const { question } = await request.json()

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

    // Generate embedding for the user's question
    const questionEmbedding = await generateEmbedding(question)

    // Search for similar chunks in Supabase with progressive thresholds
    let relevantChunks = await searchBookChunks(
      questionEmbedding,
      0.3, // Start with 30% similarity
      10
    )

    console.log(`Found ${relevantChunks.length} chunks with 30% threshold`)

    if (relevantChunks.length === 0) {
      relevantChunks = await searchBookChunks(
        questionEmbedding,
        0.2, // Try 20%
        15
      )
      console.log(`Found ${relevantChunks.length} chunks with 20% threshold`)
    }

    if (relevantChunks.length === 0) {
      relevantChunks = await searchBookChunks(
        questionEmbedding,
        0.1, // Try 10%
        20
      )
      console.log(`Found ${relevantChunks.length} chunks with 10% threshold`)
    }

    if (relevantChunks.length === 0) {
      return NextResponse.json({
        answer: "I cannot find any relevant information about that topic in the available books. Could you try rephrasing your question or asking about a different topic?",
        sources: [],
        confidence: 0,
        chunksFound: 0
      })
    }

    // Take top 5 chunks for response
    const topChunks = relevantChunks.slice(0, 5)

    // Generate response using GPT-4o with the relevant chunks
    const answer = await generateChatResponse(question, topChunks)

    // Prepare source information with book titles and references
    const sources = topChunks.map((chunk, index) => ({
      id: chunk.id,
      bookTitle: chunk.metadata?.book_title || 'Unknown Book',
      chunkIndex: chunk.metadata?.chunk_index || index,
      pageNumber: chunk.metadata?.page_number || null,
      chapter: chunk.metadata?.chapter || null,
      similarity: Math.round(chunk.similarity * 100),
      preview: chunk.content.substring(0, 200) + '...'
    }))

    const averageConfidence = topChunks.length > 0 
      ? Math.round(topChunks.reduce((sum, chunk) => sum + chunk.similarity, 0) / topChunks.length * 100)
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
    return NextResponse.json(
      { error: `An unexpected error occurred: ${error.message}` },
      { status: 500 }
    )
  }
}

// Health check endpoint
export async function GET() {
  try {
    const stats = await getBookStats();
    
    return NextResponse.json({
      status: 'Chat API is running',
      timestamp: new Date().toISOString(),
      chunksLoaded: stats.totalChunks,
      booksLoaded: stats.totalBooks,
      message: stats.totalChunks > 0 ? 'Ready to answer questions' : 'No book data found - upload books first'
    })
  } catch (error) {
    return NextResponse.json({
      status: 'Chat API is running',
      timestamp: new Date().toISOString(),
      chunksLoaded: 0,
      error: error.message
    })
  }
}