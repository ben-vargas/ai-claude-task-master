/**
 * openrouter.js
 * AI provider implementation for OpenRouter models using Vercel AI SDK.
 */

import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { BaseAIProvider } from './base-provider.js';
import { generateText } from 'ai';
import { log } from '../../scripts/modules/utils.js';

export class OpenRouterAIProvider extends BaseAIProvider {
	constructor() {
		super();
		this.name = 'OpenRouter';
		// List of models known to not support native tool calling
		this.noToolSupportModels = [
			'moonshotai/kimi-k2',
			// Add other models as discovered
		];
	}

	/**
	 * Returns the environment variable name required for this provider's API key.
	 * @returns {string} The environment variable name for the OpenRouter API key
	 */
	getRequiredApiKeyName() {
		return 'OPENROUTER_API_KEY';
	}

	/**
	 * Creates and returns an OpenRouter client instance.
	 * @param {object} params - Parameters for client initialization
	 * @param {string} params.apiKey - OpenRouter API key
	 * @param {string} [params.baseURL] - Optional custom API endpoint
	 * @returns {Function} OpenRouter client function
	 * @throws {Error} If API key is missing or initialization fails
	 */
	getClient(params) {
		try {
			const { apiKey, baseURL } = params;

			if (!apiKey) {
				throw new Error('OpenRouter API key is required.');
			}

			return createOpenRouter({
				apiKey,
				...(baseURL && { baseURL })
			});
		} catch (error) {
			this.handleError('client initialization', error);
		}
	}

	/**
	 * Override generateObject to handle models without native tool support
	 */
	async generateObject(params) {
		const { modelId, messages, schema } = params;
		
		// Check if this model needs the workaround
		if (this.noToolSupportModels.includes(modelId)) {
			log('debug', `Model ${modelId} doesn't support native tool calling, using JSON generation workaround`);
			
			try {
				// Modify the messages to request JSON output
				const modifiedMessages = [...messages];
				
				// Enhance the system message to ensure JSON output
				let hasEnhancedSystemMessage = false;
				for (let i = 0; i < modifiedMessages.length; i++) {
					if (modifiedMessages[i].role === 'system') {
						modifiedMessages[i].content = `${modifiedMessages[i].content}\n\nCRITICAL: You MUST respond with ONLY valid JSON that matches the required schema. Do not include markdown code blocks, explanations, or any other text. Just the raw JSON object.`;
						hasEnhancedSystemMessage = true;
						break;
					}
				}
				
				// If no system message, add one
				if (!hasEnhancedSystemMessage) {
					modifiedMessages.unshift({
						role: 'system',
						content: 'You MUST respond with ONLY valid JSON. No markdown code blocks, no explanations, just the raw JSON object.'
					});
				}

				// Use generateText instead of generateObject
				const result = await super.generateText({
					...params,
					messages: modifiedMessages
				});

				// Extract and parse JSON from the response
				let jsonText = result.text;
				
				// Remove markdown code blocks if present
				jsonText = jsonText.replace(/```(?:json)?\s*\n?/g, '');
				jsonText = jsonText.replace(/```\s*$/g, '');
				jsonText = jsonText.trim();

				// Find JSON object boundaries
				const jsonStart = jsonText.indexOf('{');
				const jsonEnd = jsonText.lastIndexOf('}');
				
				if (jsonStart === -1 || jsonEnd === -1) {
					throw new Error('No JSON object found in response');
				}
				
				jsonText = jsonText.substring(jsonStart, jsonEnd + 1);

				// Parse the JSON
				const object = JSON.parse(jsonText);

				log('debug', `Successfully parsed JSON from ${modelId} text response`);

				return {
					object,
					usage: result.usage
				};
			} catch (error) {
				log('error', `JSON parsing workaround failed for ${modelId}: ${error.message}`);
				log('debug', `Raw response that failed parsing: ${result?.text}`);
				// Re-throw with more context
				throw new Error(`Model ${modelId} doesn't support tool calling and JSON parsing failed: ${error.message}`);
			}
		}

		// For models that support tool calling, use the normal method
		return super.generateObject(params);
	}
}
