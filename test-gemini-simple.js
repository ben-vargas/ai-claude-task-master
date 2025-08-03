#!/usr/bin/env node

/**
 * Simple test for Gemini CLI text generation
 */

import { GeminiCliProvider } from './src/ai-providers/gemini-cli.js';

async function testSimpleGeneration() {
  console.log('Testing simple Gemini CLI text generation...\n');
  
  const provider = new GeminiCliProvider();
  
  const params = {
    apiKey: process.env.GEMINI_API_KEY || 'gemini-cli-no-key-required',
    modelId: 'gemini-2.5-pro',
    messages: [
      {
        role: 'user',
        content: 'Say hello and tell me a short fact about JavaScript.'
      }
    ],
    maxOutputTokens: 100,
    temperature: 0.7
  };
  
  try {
    console.log('Calling generateText...');
    const result = await provider.generateText(params);
    
    console.log('\n✅ Success! Response:');
    console.log(result.text);
    
    if (result.usage) {
      console.log('\nToken usage:');
      console.log(`  Input tokens: ${result.usage.inputTokens}`);
      console.log(`  Output tokens: ${result.usage.outputTokens}`);
      console.log(`  Total tokens: ${result.usage.totalTokens}`);
    }
  } catch (error) {
    console.error('\n❌ Error:', error.message);
  }
}

// Run the test
testSimpleGeneration().catch(console.error);