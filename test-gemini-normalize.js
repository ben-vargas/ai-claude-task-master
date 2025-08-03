#!/usr/bin/env node

/**
 * Test script for Gemini CLI normalization of nested objects
 */

import { z } from 'zod';
import { GeminiCliProvider } from './src/ai-providers/gemini-cli.js';

// Test schema similar to the subtask schema that was failing
const subtaskSchema = z.object({
  id: z.string().describe('Subtask ID'),
  title: z.string().describe('Title of the subtask'),
  description: z.string().describe('Detailed description'),
  details: z.string().describe('Implementation details as a string'), // This should be a string
  testStrategy: z.string().nullable().describe('Testing approach')
});

async function testGeminiNormalization() {
  console.log('Testing Gemini CLI normalization with structured output...\n');
  
  const provider = new GeminiCliProvider();
  
  const params = {
    apiKey: process.env.GEMINI_API_KEY || 'gemini-cli-no-key-required',
    modelId: 'gemini-2.5-pro',
    messages: [
      {
        role: 'system',
        content: 'You are a task planner that generates structured subtasks.'
      },
      {
        role: 'user',
        content: 'Generate a subtask for implementing user authentication with the following: ID should be "5.1", title should be about creating a login form, description should explain what needs to be done, details should contain implementation guidance (as a string, not an object), and test strategy should describe how to test it.'
      }
    ],
    schema: subtaskSchema,
    objectName: 'subtask',
    maxOutputTokens: 500,
    temperature: 0.3
  };
  
  try {
    console.log('Calling generateObject...');
    const result = await provider.generateObject(params);
    
    console.log('\n✅ Success! Generated object:');
    console.log(JSON.stringify(result.object, null, 2));
    
    // Verify the types
    console.log('\nType verification:');
    console.log(`  details type: ${typeof result.object.details}`);
    console.log(`  details value preview: ${result.object.details?.substring(0, 100)}...`);
    
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
testGeminiNormalization().catch(console.error);