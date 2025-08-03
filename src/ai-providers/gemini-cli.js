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

		if (!isExpandTask) {
			return messages; // Not an expand task, return unchanged
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

			// For expand-task user messages, create a much simpler, more direct prompt
			const simplifiedPrompt = `Generate exactly ${subtaskCount} subtasks in the following JSON format.

CRITICAL INSTRUCTION: You must respond with ONLY valid JSON. No explanatory text, no "Here is", no "Of course", no markdown - just the JSON object.

Required JSON structure:
{
  "subtasks": [
    {
      "id": "1",
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

Generate ${subtaskCount} subtasks based on the original task context. Return ONLY the JSON object.`;

			log(
				'debug',
				`${this.name} simplified user prompt for better JSON compliance`
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

			// Build final messages - v5 requires all messages in array, system included
			const finalMessages = [];
			if (systemPrompt) {
				finalMessages.push({ role: 'system', content: systemPrompt });
			}
			finalMessages.push(...nonSystemMessages);

			const client = await this.getClient(params);
			const result = await generateText({
				model: client(params.modelId),
				messages: finalMessages,
				maxOutputTokens: params.maxOutputTokens,
				temperature: params.temperature
			});

			// If we detected a JSON request and gemini-cli returned conversational text,
			// attempt to extract JSON from the response
			let finalText = result.text;
			if (enforceJsonOutput && result.text && !this._isValidJson(result.text)) {
				log(
					'debug',
					`${this.name} response appears conversational, attempting JSON extraction`
				);

				const extractedJson = this.extractJson(result.text);
				if (this._isValidJson(extractedJson)) {
					log(
						'debug',
						`${this.name} successfully extracted JSON from conversational response`
					);
					finalText = extractedJson;
				} else {
					log(
						'debug',
						`${this.name} JSON extraction failed, returning original response`
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

			// Build final messages for v5
			const finalMessages = [];
			if (systemPrompt) {
				finalMessages.push({ role: 'system', content: systemPrompt });
			}
			finalMessages.push(...nonSystemMessages);

			const client = await this.getClient(params);
			const stream = await streamText({
				model: client(params.modelId),
				messages: finalMessages,
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
	 * Overrides base implementation to handle Gemini-specific JSON formatting issues
	 */
	async generateObject(params) {
		try {
			// First try the standard generateObject from base class
			return await super.generateObject(params);
		} catch (error) {
			// If it's a JSON parsing error, try manual extraction approach
			if (error.message?.includes('JSON') || error.message?.includes('parse') || error.message?.includes('object')) {
				log(
					'debug',
					`Gemini CLI generateObject failed with parsing error, attempting manual extraction`
				);

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

					// Use generateText with JSON enforcement
					const jsonEnforcement = this._getJsonEnforcementPrompt();
					
					// Extract system messages
					const systemMessages = params.messages.filter((msg) => msg.role === 'system');
					const nonSystemMessages = params.messages.filter((msg) => msg.role !== 'system');
					
					let systemPrompt = systemMessages.length > 0
						? systemMessages.map((msg) => msg.content).join('\n\n')
						: '';
					
					// Add JSON enforcement
					systemPrompt = systemPrompt
						? `${systemPrompt}\n\n${jsonEnforcement}`
						: jsonEnforcement;

					// Simplify if it's an expand-task
					let processedMessages = params.messages;
					if (this._detectJsonRequest(params.messages)) {
						processedMessages = this._simplifyJsonPrompts(params.messages);
					}

					// Build final messages
					const finalMessages = [
						{ role: 'system', content: systemPrompt },
						...processedMessages.filter(m => m.role !== 'system')
					];

					const client = await this.getClient(params);
					const result = await generateText({
						model: client(params.modelId),
						messages: finalMessages,
						maxOutputTokens: params.maxOutputTokens,
						temperature: params.temperature
					});
					
					// Check if we got a response
					if (!result.text || result.text.trim() === '') {
						log('error', 'Gemini CLI returned empty response in generateObject fallback');
						throw new Error('Gemini CLI returned empty response');
					}

					// Extract JSON from the response
					let extractedJson = result.text;
					if (result.text && !this._isValidJson(result.text)) {
						extractedJson = this.extractJson(result.text);
						// If extraction didn't produce valid JSON, try the raw text again
						if (!this._isValidJson(extractedJson)) {
							extractedJson = result.text;
						}
					}

					let parsedObject;
					try {
						parsedObject = JSON.parse(extractedJson);
					} catch (parseError) {
						log(
							'error',
							`Failed to parse extracted JSON: ${parseError.message}`
						);
						throw new Error(
							`Gemini CLI returned invalid JSON that could not be parsed: ${parseError.message}`
						);
					}

					// Normalize the response to fix common issues
					parsedObject = this._normalizeGeminiResponse(parsedObject);

					// Validate against schema
					const validatedObject = params.schema.parse(parsedObject);

					return {
						object: validatedObject,
						usage: {
							inputTokens: result.usage?.inputTokens,
							outputTokens: result.usage?.outputTokens,
							totalTokens: result.usage?.totalTokens
						}
					};
				} catch (retryError) {
					log(
						'error',
						`Gemini CLI manual JSON extraction failed: ${retryError.message}`
					);
					// Re-throw the original error with more context
					throw new Error(
						`${this.name} failed to generate valid JSON object: ${error.message}`
					);
				}
			}

			// For non-parsing errors, just re-throw
			throw error;
		}
	}

	getRequiredApiKeyName() {
		return 'GEMINI_API_KEY';
	}

	isRequiredApiKey() {
		return false;
	}
}