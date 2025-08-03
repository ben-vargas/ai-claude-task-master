#!/usr/bin/env node

/**
 * Test script for Gemini CLI provider with v5 structured output
 */

import { z } from 'zod';
import { GeminiCliProvider } from './src/ai-providers/gemini-cli.js';

// Test schema - simple structure
const testSchema = z.object({
  name: z.string().describe('A person name'),
  age: z.number().describe('Age in years'),
  city: z.string().describe('City of residence')
});

async function testGeminiCli() {
  console.log('Testing Gemini CLI provider with AI SDK v5...\n');
  
  const provider = new GeminiCliProvider();
  
  const params = {
    apiKey: process.env.GEMINI_API_KEY || 'gemini-cli-no-key-required',
    modelId: 'gemini-2.5-pro',
    messages: [
      {
        role: 'system',
        content: 'You are a helpful assistant that generates structured data.'
      },
      {
        role: 'user',
        content: 'Generate a person profile for John who is 30 years old and lives in New York.'
      }
    ],
    schema: testSchema,
    objectName: 'person_profile',
    maxOutputTokens: 500,
    temperature: 0.3
  };
  
  try {
    console.log('Calling generateObject...');
    const result = await provider.generateObject(params);
    
    console.log('\n✅ Success! Generated object:');
    console.log(JSON.stringify(result.object, null, 2));
    
    if (result.usage) {
      console.log('\nToken usage:');
      console.log(`  Input tokens: ${result.usage.inputTokens}`);
      console.log(`  Output tokens: ${result.usage.outputTokens}`);
      console.log(`  Total tokens: ${result.usage.totalTokens}`);
    }
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
  }
}

// Run the test
testGeminiCli().catch(console.error);