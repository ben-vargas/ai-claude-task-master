import { jest } from '@jest/globals';

// Mock dependencies
jest.unstable_mockModule('ai', () => ({
  generateObject: jest.fn(),
  generateText: jest.fn(),
  streamText: jest.fn()
}));

jest.unstable_mockModule('jsonc-parser', () => ({
  parse: jest.fn()
}));

jest.unstable_mockModule('../../../scripts/modules/utils.js', () => ({
  log: jest.fn()
}));

jest.unstable_mockModule('../../../src/ai-providers/base-provider.js', () => ({
  BaseAIProvider: class {
    constructor() {
      this.name = 'Base Provider';
    }
    handleError(context, error) {
      throw error;
    }
  }
}));

jest.unstable_mockModule('ai-sdk-provider-gemini-cli', () => ({
  createGeminiProvider: jest.fn()
}));

// Import after mocking
const { GeminiCliProvider } = await import('../../../src/ai-providers/gemini-cli.js');

describe('GeminiCliProvider', () => {
  let provider;

  beforeEach(() => {
    provider = new GeminiCliProvider();
  });

  describe('_simplifyJsonPrompts', () => {
    test('should preserve task context when simplifying expand-task prompts', () => {
      const messages = [
        {
          role: 'system',
          content: 'You are an AI assistant helping with task breakdown. Generate exactly 3 subtasks for the given task.'
        },
        {
          role: 'user',
          content: `Break down this task into exactly 3 specific subtasks:

Task ID: 42
Title: Implement user authentication system
Description: Build a secure authentication system with login, logout, and JWT token management
Current details: None

Return ONLY the JSON object containing the "subtasks" array...`
        }
      ];

      const result = provider._simplifyJsonPrompts(messages);

      // Check that system message is unchanged
      expect(result[0]).toEqual(messages[0]);

      // Check that user message has been simplified but preserves task context
      const simplifiedContent = result[1].content;
      expect(simplifiedContent).toContain('Implement user authentication system');
      expect(simplifiedContent).toContain('Build a secure authentication system with login, logout, and JWT token management');
      expect(simplifiedContent).toContain('generate exactly 3 subtasks');
      expect(simplifiedContent).toContain('CRITICAL INSTRUCTION: You must respond with ONLY valid JSON');
    });

    test('should handle research format prompts', () => {
      const messages = [
        {
          role: 'system',
          content: 'You are an AI assistant helping with task breakdown. Generate exactly 5 subtasks for the given task.'
        },
        {
          role: 'user',
          content: `Analyze the following task and break it down...

Parent Task:
ID: 99
Title: Create API documentation
Description: Document all REST API endpoints with examples
Current details: API is built with Express.js

CRITICAL: Respond ONLY with a valid JSON object...`
        }
      ];

      const result = provider._simplifyJsonPrompts(messages);
      const simplifiedContent = result[1].content;

      expect(simplifiedContent).toContain('Create API documentation');
      expect(simplifiedContent).toContain('Document all REST API endpoints with examples');
      expect(simplifiedContent).toContain('generate exactly 5 subtasks');
    });

    test('should use fallback extraction when primary patterns do not match', () => {
      const messages = [
        {
          role: 'system',
          content: 'You are an AI assistant helping with task breakdown. Generate exactly 2 subtasks for the given task.'
        },
        {
          role: 'user',
          content: `Some different format:
Title: Setup CI/CD pipeline
Description: Configure GitHub Actions for automated testing
Other info: Use Node.js`
        }
      ];

      const result = provider._simplifyJsonPrompts(messages);
      const simplifiedContent = result[1].content;

      expect(simplifiedContent).toContain('Setup CI/CD pipeline');
      expect(simplifiedContent).toContain('Configure GitHub Actions for automated testing');
      expect(simplifiedContent).toContain('generate exactly 2 subtasks');
    });

    test('should return messages unchanged if not an expand-task operation', () => {
      const messages = [
        {
          role: 'system',
          content: 'You are a helpful assistant.'
        },
        {
          role: 'user',
          content: 'Tell me about JavaScript.'
        }
      ];

      const result = provider._simplifyJsonPrompts(messages);
      expect(result).toEqual(messages);
    });

    test('should handle missing task information gracefully', () => {
      const messages = [
        {
          role: 'system',
          content: 'You are an AI assistant helping with task breakdown. Generate exactly 4 subtasks for the given task.'
        },
        {
          role: 'user',
          content: 'Some content without any task information'
        }
      ];

      const result = provider._simplifyJsonPrompts(messages);
      const simplifiedContent = result[1].content;

      // Should still generate a valid prompt with generic fallback
      expect(simplifiedContent).toContain('the given task');
      expect(simplifiedContent).toContain('generate exactly 4 subtasks');
      expect(simplifiedContent).toContain('CRITICAL INSTRUCTION: You must respond with ONLY valid JSON');
    });

    test('should extract subtask count from system message', () => {
      const testCases = [
        { count: '3', systemContent: 'Generate exactly 3 subtasks', shouldSimplify: true },
        { count: '10', systemContent: 'Generate exactly 10 subtasks', shouldSimplify: true },
        { count: '10', systemContent: 'Generate subtasks', shouldSimplify: false } // Won't match the detection pattern
      ];

      testCases.forEach(({ count, systemContent, shouldSimplify }) => {
        const messages = [
          {
            role: 'system',
            content: `You are an AI assistant helping with task breakdown. ${systemContent} for the given task.`
          },
          {
            role: 'user',
            content: 'Task ID: 1\nTitle: Example task\nDescription: A test task'
          }
        ];

        const result = provider._simplifyJsonPrompts(messages);
        
        if (shouldSimplify) {
          const simplifiedContent = result[1].content;
          expect(simplifiedContent).toContain(`generate exactly ${count} subtasks`);
          expect(simplifiedContent).toContain('CRITICAL INSTRUCTION');
        } else {
          // When system message doesn't match pattern, messages should be unchanged
          expect(result).toEqual(messages);
        }
      });
    });
  });
});