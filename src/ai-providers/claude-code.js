import {
	createClaudeCode,
	isAuthenticationError,
	isTimeoutError,
	getErrorMetadata
} from 'ai-sdk-provider-claude-code';
import { log } from '../../scripts/modules/index.js';
import { BaseAIProvider } from './base-provider.js';

/**
 * Claude Code CLI provider implementation
 * Uses ai-sdk-provider-claude-code to integrate with Claude through the Claude Code CLI
 */
export class ClaudeCodeProvider extends BaseAIProvider {
	constructor() {
		super();
		this.name = 'ClaudeCode';
		this.supportedModels = ['opus', 'sonnet'];
	}

	/**
	 * Override to handle SDK authentication errors properly
	 */
	async handleError(operation, error) {
		const errorMessage = error.message?.toLowerCase() || '';

		// Use the new error checking functions from ai-sdk-provider-claude-code
		if (isAuthenticationError(error)) {
			throw new Error('Claude Code authentication required. Run: claude login');
		}

		// Check for timeout errors using the new function
		if (isTimeoutError(error)) {
			const metadata = getErrorMetadata(error);
			const timeoutMs = metadata?.timeoutMs || 120000;
			throw new Error(
				`Request timed out after ${timeoutMs}ms. Consider increasing timeout in config.json`
			);
		}

		// Check for CLI not found errors
		if (
			errorMessage.includes('command not found') ||
			errorMessage.includes('enoent') ||
			errorMessage.includes('spawn claude')
		) {
			throw new Error(
				'Claude Code CLI not found. Install with: npm install -g @anthropic-ai/claude-code'
			);
		}

		// Get additional error metadata if available
		const metadata = getErrorMetadata(error);
		if (metadata?.stderr) {
			log('error', `Claude Code stderr: ${metadata.stderr}`);
		}

		// For other errors, use base class handling
		super.handleError(operation, error);
	}

	/**
	 * Override validateAuth to skip API key requirement
	 * Claude Code uses CLI authentication instead
	 */
	validateAuth(params) {
		// No API key needed for Claude Code CLI
		log('debug', 'Claude Code provider uses CLI authentication');
	}

	/**
	 * Override validateParams to add model validation
	 */
	validateParams(params) {
		super.validateParams(params);

		if (!this.supportedModels.includes(params.modelId)) {
			throw new Error(
				`Model '${params.modelId}' is not supported. ` +
					`Supported models: ${this.supportedModels.join(', ')}`
			);
		}
	}

	/**
	 * Creates and returns a Claude Code client instance
	 */
	getClient(params) {
		// Map task-master params to ai-sdk-provider-claude-code settings
		const settings = {
			// Map cliPath to pathToClaudeCodeExecutable if provided
			pathToClaudeCodeExecutable: params.cliPath,

			// Map skipPermissions to permissionMode
			permissionMode: params.skipPermissions ? 'bypassPermissions' : 'default',

			// Include only valid ClaudeCodeSettings properties
			cwd: params.cwd,
			customSystemPrompt: params.customSystemPrompt,
			appendSystemPrompt: params.appendSystemPrompt,
			maxTurns: params.maxTurns,
			maxThinkingTokens: params.maxThinkingTokens
		};

		// Remove undefined values
		Object.keys(settings).forEach((key) => {
			if (settings[key] === undefined) {
				delete settings[key];
			}
		});

		try {
			// Create provider with settings directly (not wrapped in defaultSettings)
			const provider = createClaudeCode(settings);

			// Return the provider directly - it's already a function that accepts modelId
			return provider;
		} catch (error) {
			throw error;
		}
	}
}
