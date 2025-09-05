// lib/supabase.js
import { createClient } from '@supabase/supabase-js'

// Load environment variables
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

// Get environment variables
const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY

if (!supabaseUrl) {
  throw new Error('Missing SUPABASE_URL environment variable')
}

if (!supabaseServiceKey) {
  throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY environment variable')
}

// Create Supabase admin client (for server-side operations)
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

// Create regular Supabase client (for client-side operations)
export const supabase = supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null

// Function to search for similar book chunks
export async function searchBookChunks(embedding, matchThreshold = 0.78, matchCount = 5) {
  try {
    const { data, error } = await supabaseAdmin.rpc('match_book_chunks', {
      query_embedding: embedding,
      match_threshold: matchThreshold,
      match_count: matchCount
    })

    if (error) {
      console.error('Error searching book chunks:', error)
      throw error
    }

    return data || []
  } catch (error) {
    console.error('Error in searchBookChunks:', error)
    throw error
  }
}

// Function to get book chunk statistics
export async function getBookStats() {
  try {
    const { data, error } = await supabaseAdmin
      .from('book_chunks')
      .select(`
        id,
        metadata->>book_title as book_title,
        metadata->>estimated_tokens as estimated_tokens
      `)

    if (error) {
      console.error('Error getting book stats:', error)
      throw error
    }

    // Group by book title and calculate stats
    const bookStats = {}
    data.forEach(chunk => {
      const title = chunk.book_title || 'Unknown'
      if (!bookStats[title]) {
        bookStats[title] = {
          chunkCount: 0,
          totalTokens: 0
        }
      }
      bookStats[title].chunkCount += 1
      bookStats[title].totalTokens += parseInt(chunk.estimated_tokens) || 0
    })

    return {
      totalChunks: data.length,
      totalBooks: Object.keys(bookStats).length,
      bookBreakdown: bookStats
    }
  } catch (error) {
    console.error('Error in getBookStats:', error)
    throw error
  }
}