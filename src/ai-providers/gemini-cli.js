/**
 * src/ai-providers/gemini-cli.js
 *
 * Implementation for interacting with Gemini models via Gemini CLI
 * using the ai-sdk-provider-gemini-cli package.
 * 
 * This implementation includes v4 compatibility features that made it reliable:
 * - System message extraction and separate handling
 * - JSON detection and enforcement
 * - Prompt simplification for specific operations
 * - Robust JSON extraction from responses
 */

import { generateObject, generateText, streamText } from 'ai';
import { parse } from 'jsonc-parser';
import { BaseAIProvider } from './base-provider.js';
import { log } from '../../scripts/modules/utils.js';

let createGeminiProvider;

async function loadGeminiCliModule() {
	if (!createGeminiProvider) {
		try {
			const mod = await import('ai-sdk-provider-gemini-cli');
			createGeminiProvider = mod.createGeminiProvider;
		} catch (err) {
			throw new Error(
				"Gemini CLI SDK is not installed. Please install 'ai-sdk-provider-gemini-cli' to use the gemini-cli provider."
			);
		}
	}
}

export class GeminiCliProvider extends BaseAIProvider {
	constructor() {
		super();
		this.name = 'Gemini CLI';
	}

	/**
	 * Override validateAuth to handle Gemini CLI authentication options
	 * @param {object} params - Parameters to validate
	 */
	validateAuth(params) {
		// Gemini CLI is designed to use pre-configured OAuth authentication
		// No validation needed - the SDK will handle auth internally
	}

	/**
	 * Creates and returns a Gemini CLI client instance.
	 * @param {object} params - Parameters for client initialization
	 * @param {string} [params.apiKey] - Optional Gemini API key (rarely used with gemini-cli)
	 * @param {string} [params.baseURL] - Optional custom API endpoint
	 * @returns {Promise<Function>} Gemini CLI client function
	 * @throws {Error} If initialization fails
	 */
	async getClient(params) {
		try {
			// Load the Gemini CLI module dynamically
			await loadGeminiCliModule();
			let authOptions = {};

			if (params.apiKey && params.apiKey !== 'gemini-cli-no-key-required') {
				// API key provided - use it for compatibility
				authOptions = {
					authType: 'api-key',
					apiKey: params.apiKey
				};
			} else {
				// Expected case: Use gemini CLI authentication via OAuth
				authOptions = {
					authType: 'oauth-personal'
				};
			}

			// Add baseURL if provided (for custom endpoints)
			if (params.baseURL) {
				authOptions.baseURL = params.baseURL;
			}

			// Create and return the provider
			return createGeminiProvider(authOptions);
		} catch (error) {
			this.handleError('client initialization', error);
		}
	}

	/**
	 * Extracts system messages from the messages array and returns them separately.
	 * This is needed because ai-sdk-provider-gemini-cli expects system prompts as a separate parameter.
	 * @param {Array} messages - Array of message objects
	 * @param {Object} options - Options for system prompt enhancement
	 * @param {boolean} options.enforceJsonOutput - Whether to add JSON enforcement to system prompt
	 * @returns {Object} - {systemPrompt: string|undefined, messages: Array}
	 */
	_extractSystemMessage(messages, options = {}) {
		if (!messages || !Array.isArray(messages)) {
			return { systemPrompt: undefined, messages: messages || [] };
		}

		const systemMessages = messages.filter((msg) => msg.role === 'system');
		const nonSystemMessages = messages.filter((msg) => msg.role !== 'system');

		// Combine multiple system messages if present
		let systemPrompt =
			systemMessages.length > 0
				? systemMessages.map((msg) => msg.content).join('\n\n')
				: undefined;

		// Add Gemini CLI specific JSON enforcement if requested
		if (options.enforceJsonOutput) {
			const jsonEnforcement = this._getJsonEnforcementPrompt();
			systemPrompt = systemPrompt
				? `${systemPrompt}\n\n${jsonEnforcement}`
				: jsonEnforcement;
		}

		return { systemPrompt, messages: nonSystemMessages };
	}

	/**
	 * Gets a Gemini CLI specific system prompt to enforce strict JSON output
	 * @returns {string} JSON enforcement system prompt
	 */
	_getJsonEnforcementPrompt() {
		return `CRITICAL: You MUST respond with ONLY valid JSON. Do not include any explanatory text, markdown formatting, code block markers, or conversational phrases like "Here is" or "Of course". Your entire response must be parseable JSON that starts with { or [ and ends with } or ]. No exceptions.`;
	}

	/**
	 * Checks if a string is valid JSON
	 * @param {string} text - Text to validate
	 * @returns {boolean} True if valid JSON
	 */
	_isValidJson(text) {
		if (!text || typeof text !== 'string') {
			return false;
		}

		try {
			JSON.parse(text.trim());
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Detects if the user prompt is requesting JSON output
	 * @param {Array} messages - Array of message objects
	 * @returns {boolean} True if JSON output is likely expected
	 */
	_detectJsonRequest(messages) {
		const userMessages = messages.filter((msg) => msg.role === 'user');
		const combinedText = userMessages
			.map((msg) => msg.content)
			.join(' ')
			.toLowerCase();

		// Look for indicators that JSON output is expected
		const jsonIndicators = [
			'json',
			'respond only with',
			'return only',
			'output only',
			'format:',
			'structure:',
			'schema:',
			'{"',
			'[{',
			'subtasks',
			'array',
			'object'
		];

		return jsonIndicators.some((indicator) => combinedText.includes(indicator));
	}

	/**
	 * Simplifies complex prompts for gemini-cli to improve JSON output compliance
	 * @param {Array} messages - Array of message objects
	 * @returns {Array} Simplified messages array
	 */
	_simplifyJsonPrompts(messages) {
		// First, check if this is an expand-task operation by looking at the system message
		const systemMsg = messages.find((m) => m.role === 'system');
		const isExpandTask =
			systemMsg &&
			systemMsg.content.includes(
				'You are an AI assistant helping with task breakdown. Generate exactly'
			);
		
		// Check if this is a parse-prd operation
		const isParsePRD = 
			systemMsg && 
			(systemMsg.content.includes('Product Requirements Document') ||
			 systemMsg.content.includes('PRD') ||
			 systemMsg.content.includes('generate tasks from'));

		if (!isExpandTask && !isParsePRD) {
			return messages; // Not a special operation, return unchanged
		}
		
		if (isParsePRD) {
			// For parse-prd, we DON'T want to replace the entire user prompt
			// because it contains the actual PRD content
			// We just want to add JSON formatting instructions
			log(
				'debug',
				`${this.name} detected parse-prd operation, adding JSON format instructions`
			);
			
			return messages.map((msg) => {
				if (msg.role !== 'user') {
					return msg;
				}
				
				// Get the original PRD content
				const originalContent = msg.content;
				
				// Extract task count from system message
				const taskCountMatch = systemMsg.content.match(/(\d+)\s+tasks/);
				const taskCount = taskCountMatch ? taskCountMatch[1] : '25';
				
				// Prepend JSON formatting instructions while keeping PRD content
				const enhancedPrompt = `CRITICAL: You must respond with ONLY valid JSON. No markdown code blocks, no explanations, no text before or after - just the JSON object.

Required JSON structure:
{
  "tasks": [
    {
      "id": 1,
      "title": "Task title",
      "description": "Task description",
      "status": "pending",
      "dependencies": [],
      "priority": "high",
      "details": "Implementation details as a plain string",
      "testStrategy": "Testing approach"
    }
  ],
  "metadata": {
    "projectName": "Project name from PRD",
    "totalTasks": ${taskCount},
    "sourceFile": "prd.txt",
    "generatedAt": "2024-01-01"
  }
}

IMPORTANT: The details field must be a plain string, not an object or array.
Generate exactly ${taskCount} tasks. Return ONLY the JSON object.

Now, here is the PRD to parse:

${originalContent}`;
				
				log(
					'debug',
					`${this.name} added JSON format instructions while preserving PRD content`
				);
				return { ...msg, content: enhancedPrompt };
			});
		}

		// Extract subtask count from system message
		const subtaskCountMatch = systemMsg.content.match(
			/Generate exactly (\d+) subtasks/
		);
		const subtaskCount = subtaskCountMatch ? subtaskCountMatch[1] : '10';

		log(
			'debug',
			`${this.name} detected expand-task operation, simplifying for ${subtaskCount} subtasks`
		);

		return messages.map((msg) => {
			if (msg.role !== 'user') {
				return msg;
			}

			// Extract the original task context from the user message
			const originalContent = msg.content;
			
			// For expand-task user messages, PREPEND format instructions while KEEPING the task context
			const simplifiedPrompt = `CRITICAL INSTRUCTION: You must respond with ONLY valid JSON. No explanatory text, no "Here is", no "Of course", no markdown - just the JSON object.

Required JSON structure:
{
  "subtasks": [
    {
      "id": 1,
      "title": "Specific actionable task title",
      "description": "Clear task description",
      "dependencies": [],
      "details": "Implementation details and guidance as a plain string",
      "status": "pending",
      "testStrategy": "Testing approach"
    }
  ]
}

IMPORTANT: The "details" field must be a plain string, not an object or array.
Generate exactly ${subtaskCount} subtasks. Return ONLY the JSON object.

Now, here is the task to expand:

${originalContent}`;

			log(
				'debug',
				`${this.name} added JSON format instructions while preserving task context`
			);
			return { ...msg, content: simplifiedPrompt };
		});
	}

	/**
	 * Extract JSON from Gemini's response using a tolerant parser.
	 * Simplified version adapted from v4 that worked reliably.
	 * @param {string} text - Raw text which may contain JSON
	 * @returns {string} A valid JSON string if extraction succeeds, otherwise the original text
	 */
	extractJson(text) {
		if (!text || typeof text !== 'string') {
			return text;
		}

		let content = text.trim();

		// Early exit for very short content
		if (content.length < 2) {
			return text;
		}

		// Strip common wrappers in a single pass
		content = content
			// Remove markdown fences
			.replace(/^.*?```(?:json)?\s*([\s\S]*?)\s*```.*$/i, '$1')
			// Remove variable declarations
			.replace(/^\s*(?:const|let|var)\s+\w+\s*=\s*([\s\S]*?)(?:;|\s*)$/i, '$1')
			// Remove common prefixes
			.replace(/^(?:Here's|The)\s+(?:the\s+)?JSON.*?[:]\s*/i, '')
			.trim();

		// Find the first JSON-like structure
		const firstObj = content.indexOf('{');
		const firstArr = content.indexOf('[');

		if (firstObj === -1 && firstArr === -1) {
			return text;
		}

		const start =
			firstArr === -1
				? firstObj
				: firstObj === -1
					? firstArr
					: Math.min(firstObj, firstArr);
		content = content.slice(start);

		// Try parsing with jsonc-parser for tolerance
		const errors = [];
		try {
			const result = parse(content, errors, {
				allowTrailingComma: true,
				allowEmptyContent: false
			});
			if (errors.length === 0 && result !== undefined) {
				return JSON.stringify(result, null, 2);
			}
		} catch {
			// Parsing failed, return original
		}

		return text;
	}

	/**
	 * Normalizes Gemini responses to fix common issues
	 * Specifically handles cases where Gemini returns objects instead of strings
	 */
	_normalizeGeminiResponse(obj) {
		if (!obj || typeof obj !== 'object') {
			return obj;
		}
		
		// Handle arrays
		if (Array.isArray(obj)) {
			return obj.map(item => this._normalizeGeminiResponse(item));
		}
		
		// Handle objects
		const normalized = {};
		for (const [key, value] of Object.entries(obj)) {
			// Fields that should be strings but Gemini sometimes returns as objects
			const stringFields = ['details', 'description', 'testStrategy', 'title', 'content'];
			
			if (stringFields.includes(key) && value && typeof value === 'object') {
				// Convert object to string representation
				if (Array.isArray(value)) {
					// If it's an array, join with newlines
					normalized[key] = value.map(v => 
						typeof v === 'string' ? v : JSON.stringify(v)
					).join('\n');
				} else if (value.text) {
					// If it has a 'text' property, use that
					normalized[key] = value.text;
				} else if (value.content) {
					// If it has a 'content' property, use that
					normalized[key] = value.content;
				} else {
					// Otherwise stringify it
					normalized[key] = JSON.stringify(value, null, 2);
				}
				log(
					'debug',
					`Normalized field '${key}' from object to string`
				);
			} else if (typeof value === 'object' && value !== null) {
				// Recursively normalize nested objects
				normalized[key] = this._normalizeGeminiResponse(value);
			} else {
				// Keep the value as-is
				normalized[key] = value;
			}
		}
		
		return normalized;
	}

	/**
	 * Adds missing metadata for parse-prd operations
	 * Gemini sometimes omits the metadata field even when explicitly requested
	 */
	_addMissingMetadata(obj, messages) {
		// Check if this is a parse-prd operation by looking for tasks array
		if (obj && obj.tasks && Array.isArray(obj.tasks) && !obj.metadata) {
			// Extract task count from messages if possible
			const systemMsg = messages?.find(m => m.role === 'system');
			const taskCountMatch = systemMsg?.content?.match(/(\d+)\s+tasks/);
			const taskCount = obj.tasks.length;
			
			log(
				'debug',
				`Adding missing metadata field for parse-prd operation with ${taskCount} tasks`
			);
			
			// Add default metadata
			obj.metadata = {
				projectName: "Project",
				totalTasks: taskCount,
				sourceFile: "prd.txt",
				generatedAt: new Date().toISOString()
			};
		}
		
		return obj;
	}

	/**
	 * Generates text using Gemini CLI model
	 * Overrides base implementation to properly handle system messages and enforce JSON output when needed
	 */
	async generateText(params) {
		try {
			this.validateParams(params);
			this.validateMessages(params.messages);

			log(
				'debug',
				`Generating ${this.name} text with model: ${params.modelId}`
			);

			// Detect if JSON output is expected and enforce it for better gemini-cli compatibility
			const enforceJsonOutput = this._detectJsonRequest(params.messages);

			if (enforceJsonOutput) {
				log(
					'debug',
					`${this.name} detected JSON request - applying strict JSON enforcement`
				);
			}

			// For gemini-cli, simplify complex prompts before processing
			let processedMessages = params.messages;
			if (enforceJsonOutput) {
				processedMessages = this._simplifyJsonPrompts(params.messages);
			}

			// Extract system messages and combine them
			const systemMessages = processedMessages.filter((msg) => msg.role === 'system');
			const nonSystemMessages = processedMessages.filter((msg) => msg.role !== 'system');
			
			let systemPrompt = systemMessages.length > 0
				? systemMessages.map((msg) => msg.content).join('\n\n')
				: undefined;

			// Add JSON enforcement if needed
			if (enforceJsonOutput) {
				const jsonEnforcement = this._getJsonEnforcementPrompt();
				systemPrompt = systemPrompt
					? `${systemPrompt}\n\n${jsonEnforcement}`
					: jsonEnforcement;
			}

			// Use v4 approach: pass system as separate parameter, not in messages
			const client = await this.getClient(params);
			const result = await generateText({
				model: client(params.modelId),
				system: systemPrompt,  // v4 style: separate system parameter
				messages: nonSystemMessages,  // Only non-system messages
				maxOutputTokens: params.maxOutputTokens,
				temperature: params.temperature
			});

			// Always attempt JSON extraction for Gemini CLI (it often wraps in markdown)
			let finalText = result.text;
			if (enforceJsonOutput && result.text) {
				// First try extraction (handles markdown wrappers, etc.)
				const extractedJson = this.extractJson(result.text);
				
				if (this._isValidJson(extractedJson)) {
					log(
						'debug',
						`${this.name} successfully extracted clean JSON`
					);
					finalText = extractedJson;
				} else if (this._isValidJson(result.text)) {
					// Original was already valid JSON
					finalText = result.text;
				} else {
					log(
						'debug',
						`${this.name} could not extract valid JSON`
					);
				}
			}

			log(
				'debug',
				`${this.name} generateText completed successfully for model: ${params.modelId}`
			);

			return {
				text: finalText,
				usage: {
					inputTokens: result.usage?.inputTokens,
					outputTokens: result.usage?.outputTokens,
					totalTokens: result.usage?.totalTokens
				}
			};
		} catch (error) {
			this.handleError('text generation', error);
		}
	}

	/**
	 * Streams text using Gemini CLI model
	 * Overrides base implementation to properly handle system messages
	 */
	async streamText(params) {
		try {
			this.validateParams(params);
			this.validateMessages(params.messages);

			log('debug', `Streaming ${this.name} text with model: ${params.modelId}`);

			// Extract system messages and combine them
			const systemMessages = params.messages.filter((msg) => msg.role === 'system');
			const nonSystemMessages = params.messages.filter((msg) => msg.role !== 'system');
			
			let systemPrompt = systemMessages.length > 0
				? systemMessages.map((msg) => msg.content).join('\n\n')
				: undefined;

			// Use v4 approach: pass system as separate parameter
			const client = await this.getClient(params);
			const stream = await streamText({
				model: client(params.modelId),
				system: systemPrompt,  // v4 style: separate system parameter
				messages: nonSystemMessages,  // Only non-system messages
				maxOutputTokens: params.maxOutputTokens,
				temperature: params.temperature
			});

			log(
				'debug',
				`${this.name} streamText initiated successfully for model: ${params.modelId}`
			);

			return stream;
		} catch (error) {
			this.handleError('text streaming', error);
		}
	}

	/**
	 * Generates a structured object using Gemini CLI model
	 * Completely overrides base implementation to avoid error logging on expected Gemini quirks
	 */
	async generateObject(params) {
		try {
			// Validate params first
			this.validateParams(params);
			this.validateMessages(params.messages);

			if (!params.schema) {
				throw new Error('Schema is required for object generation');
			}
			if (!params.objectName) {
				throw new Error('Object name is required for object generation');
			}

			log(
				'debug',
				`Generating ${this.name} object ('${params.objectName}') with model: ${params.modelId}`
			);

			// For Gemini, we know it often has issues with structured output,
			// so we'll use generateText with JSON enforcement right away
			// This avoids the error logging from trying generateObject first
			
			// Extract system messages for separate handling with JSON enforcement
			const { systemPrompt: baseSystemPrompt, messages } = this._extractSystemMessage(
				params.messages,
				{ enforceJsonOutput: false }
			);
			
			// Add strong JSON enforcement
			const jsonEnforcement = this._getJsonEnforcementPrompt();
			const systemPrompt = baseSystemPrompt
				? `${baseSystemPrompt}\n\n${jsonEnforcement}`
				: jsonEnforcement;

			// Simplify prompts if needed (for expand-task, parse-prd, etc.)
			let processedMessages = messages;
			if (this._detectJsonRequest(params.messages)) {
				processedMessages = this._simplifyJsonPrompts(params.messages);
				// After simplification, filter out any system messages
				processedMessages = processedMessages.filter(m => m.role !== 'system');
			}

			// Use v4 approach: generateText with separate system parameter
			const client = await this.getClient(params);
			const result = await generateText({
				model: client(params.modelId),
				system: systemPrompt,  // v4 style: separate system parameter
				messages: processedMessages,
				maxOutputTokens: params.maxOutputTokens,
				temperature: params.temperature || 0.3  // Lower temp for structured output
			});
			
			// Check if we got a response
			if (!result.text || result.text.trim() === '') {
				throw new Error('Gemini CLI returned empty response');
			}

			// Always try to extract JSON from the response (Gemini often wraps in markdown)
			let extractedJson = this.extractJson(result.text);
			
			// If extraction failed, use original text
			if (!this._isValidJson(extractedJson)) {
				extractedJson = result.text;
			}

			let parsedObject;
			try {
				parsedObject = JSON.parse(extractedJson);
			} catch (parseError) {
				log(
					'error',
					`Failed to parse Gemini response as JSON: ${parseError.message}`
				);
				throw new Error(
					`Gemini CLI returned invalid JSON that could not be parsed: ${parseError.message}`
				);
			}

			// Normalize the response to fix common issues (e.g., object fields that should be strings)
			parsedObject = this._normalizeGeminiResponse(parsedObject);
			
			// Add missing metadata if this is a parse-prd operation
			// Gemini sometimes omits the metadata field even when explicitly requested
			parsedObject = this._addMissingMetadata(parsedObject, params.messages);

			// Validate against schema
			let validatedObject;
			try {
				validatedObject = params.schema.parse(parsedObject);
			} catch (validationError) {
				// Log what we got vs what was expected for debugging
				log(
					'debug',
					`Gemini response validation failed. Response keys: ${Object.keys(parsedObject).join(', ')}`
				);
				throw validationError;
			}

			log(
				'debug',
				`${this.name} generateObject completed successfully for model: ${params.modelId}`
			);

			return {
				object: validatedObject,
				usage: {
					inputTokens: result.usage?.inputTokens,
					outputTokens: result.usage?.outputTokens,
					totalTokens: result.usage?.totalTokens
				}
			};
		} catch (error) {
			this.handleError('object generation', error);
		}
	}

	getRequiredApiKeyName() {
		return 'GEMINI_API_KEY';
	}

	isRequiredApiKey() {
		return false;
	}
}