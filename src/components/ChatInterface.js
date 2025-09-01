'use client'

import { useState, useRef, useEffect } from 'react'
import { Send, Bot, User, BookOpen, Loader2 } from 'lucide-react'

export default function ChatInterface() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef(null)

  // Auto-scroll to bottom when new messages are added
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = async (e) => {
    e.preventDefault()
    
    if (!input.trim() || isLoading) return

    const userMessage = input.trim()
    setInput('')
    setIsLoading(true)

    // Add user message to chat
    setMessages(prev => [...prev, {
      id: Date.now(),
      type: 'user',
      content: userMessage,
      timestamp: new Date()
    }])

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ question: userMessage }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to get response')
      }

      // Add AI response to chat
      setMessages(prev => [...prev, {
        id: Date.now() + 1,
        type: 'assistant',
        content: data.answer,
        sources: data.sources || [],
        confidence: data.confidence || 0,
        chunksFound: data.chunksFound || 0,
        timestamp: new Date()
      }])

    } catch (error) {
      console.error('Error:', error)
      
      // Add error message to chat
      setMessages(prev => [...prev, {
        id: Date.now() + 1,
        type: 'error',
        content: 'Sorry, I encountered an error while processing your question. Please try again.',
        timestamp: new Date()
      }])
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-gray-200 p-4">
        <div className="max-w-4xl mx-auto flex items-center gap-3">
          <BookOpen className="w-6 h-6 text-blue-600" />
          <div>
            <h1 className="text-xl font-semibold text-gray-900">AI Book Assistant</h1>
            <p className="text-sm text-gray-600">Ask questions about your books</p>
          </div>
        </div>
      </div>

      {/* Messages Container */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-4xl mx-auto space-y-6">
          {messages.length === 0 && (
            <div className="text-center py-12">
              <BookOpen className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">Welcome to your AI Book Assistant</h3>
              <p className="text-gray-600 mb-4">Ask me anything about your books and I'll find the relevant information for you.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-2xl mx-auto">
                <button
                  onClick={() => setInput("What are the main themes discussed in the books?")}
                  className="p-3 text-left bg-white rounded-lg border border-gray-200 hover:border-gray-300 transition-colors"
                >
                  <div className="font-medium text-sm">Main themes</div>
                  <div className="text-xs text-gray-600">Explore key topics</div>
                </button>
                <button
                  onClick={() => setInput("Can you summarize the key insights?")}
                  className="p-3 text-left bg-white rounded-lg border border-gray-200 hover:border-gray-300 transition-colors"
                >
                  <div className="font-medium text-sm">Key insights</div>
                  <div className="text-xs text-gray-600">Get important takeaways</div>
                </button>
              </div>
            </div>
          )}

          {messages.map((message) => (
            <div key={message.id} className={`flex gap-4 ${message.type === 'user' ? 'justify-end' : ''}`}>
              {message.type !== 'user' && (
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  message.type === 'error' ? 'bg-red-100' : 'bg-blue-100'
                }`}>
                  <Bot className={`w-4 h-4 ${message.type === 'error' ? 'text-red-600' : 'text-blue-600'}`} />
                </div>
              )}
              
              <div className={`flex-1 max-w-3xl ${message.type === 'user' ? 'flex justify-end' : ''}`}>
                <div className={`p-4 rounded-lg ${
                  message.type === 'user' 
                    ? 'bg-blue-600 text-white' 
                    : message.type === 'error'
                    ? 'bg-red-50 border border-red-200'
                    : 'bg-white border border-gray-200'
                }`}>
                  <div className="whitespace-pre-wrap">{message.content}</div>
                  
                  {/* Show sources for assistant messages */}
                  {message.type === 'assistant' && message.sources && message.sources.length > 0 && (
                    <div className="mt-4 pt-3 border-t border-gray-100">
                      <div className="flex items-center gap-2 mb-2">
                        <BookOpen className="w-4 h-4 text-gray-500" />
                        <span className="text-sm font-medium text-gray-700">
                          Sources ({message.confidence}% confidence)
                        </span>
                      </div>
                      <div className="space-y-2">
                        {message.sources.map((source, index) => (
                          <div key={source.id} className="text-xs bg-gray-50 p-2 rounded border">
                            <div className="font-medium text-gray-700">
                              {source.bookTitle} ({source.similarity}% match)
                            </div>
                            <div className="text-gray-600 mt-1">{source.preview}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {message.type === 'user' && (
                <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                  <User className="w-4 h-4 text-gray-600" />
                </div>
              )}
            </div>
          ))}

          {isLoading && (
            <div className="flex gap-4">
              <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                <Bot className="w-4 h-4 text-blue-600" />
              </div>
              <div className="flex-1 max-w-3xl">
                <div className="bg-white border border-gray-200 p-4 rounded-lg">
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                    <span className="text-gray-600">Searching through your books...</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Form */}
      <div className="bg-white border-t border-gray-200 p-4">
        <div className="max-w-4xl mx-auto">
          <form onSubmit={sendMessage} className="flex gap-3">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a question about your books..."
              disabled={isLoading}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100"
              maxLength={1000}
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              <Send className="w-4 h-4" />
              {isLoading ? 'Searching...' : 'Send'}
            </button>
          </form>
          
          <div className="text-xs text-gray-500 mt-2 text-center">
            Ask questions about your books • Powered by AI embeddings
          </div>
        </div>
      </div>
    </div>
  )
}