import { execSync } from 'child_process';
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
	 * Tries to find the actual path to the claude executable
	 */
	findClaudePath() {
		// First, try to find npm global installation
		try {
			const npmPrefix = execSync('npm prefix -g', { encoding: 'utf8' }).trim();
			const npmClaudePath = `${npmPrefix}/bin/claude`;
			execSync(`test -x "${npmClaudePath}"`, { encoding: 'utf8' });
			log('debug', `Found claude at npm global: ${npmClaudePath}`);
			return npmClaudePath;
		} catch (error) {
			// npm global claude not found
		}
		
		try {
			// Try to find claude using 'which' command
			const path = execSync('which claude', { encoding: 'utf8' }).trim();
			if (path) {
				log('debug', `Found claude at: ${path}`);
				return path;
			}
		} catch (error) {
			// which command failed, claude not in PATH
		}
		
		// Check common installation locations
		const home = process.env.HOME || process.env.USERPROFILE;
		const commonPaths = [
			home + '/.claude/local/claude', // User's local claude installation
			home + '/.claude/local/node_modules/.bin/claude', // Direct path to claude binary
			'/usr/local/bin/claude',
			'/opt/homebrew/bin/claude',
			home + '/.nvm/versions/node/v22.14.0/bin/claude', // Specific nvm path
			home + '/.bun/bin/claude' // Lower priority for bun
		].filter(Boolean); // Remove any undefined paths
		
		for (const path of commonPaths) {
			try {
				execSync(`test -x "${path}"`, { encoding: 'utf8' });
				log('debug', `Found claude at: ${path}`);
				return path;
			} catch (error) {
				// Path doesn't exist or isn't executable
			}
		}
		
		return null;
	}

	/**
	 * Checks if Claude Code CLI is installed and accessible
	 */
	checkCLIInstallation() {
		try {
			const claudePath = this.findClaudePath();
			if (claudePath) {
				execSync(`"${claudePath}" --version`, { encoding: 'utf8' });
				return true;
			}
			execSync('claude --version', { encoding: 'utf8' });
			return true;
		} catch (error) {
			log(
				'warn',
				'Claude Code CLI not found. Install with: npm install -g @anthropic-ai/claude-code'
			);
			return false;
		}
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
		// Find the claude executable path
		const claudePath = params.cliPath || this.findClaudePath() || 'claude';
		log('debug', `Using Claude Code executable at: ${claudePath}`);
		
		// Map task-master params to ai-sdk-provider-claude-code settings
		const settings = {
			// Map cliPath to pathToClaudeCodeExecutable
			pathToClaudeCodeExecutable: claudePath,
			
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
		Object.keys(settings).forEach(key => {
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

	/**
	 * Override generateText to check CLI installation
	 */
	async generateText(params) {
		if (!this.checkCLIInstallation()) {
			throw new Error('Claude Code CLI is not installed');
		}
		return super.generateText(params);
	}

	/**
	 * Override streamText to check CLI installation
	 */
	async streamText(params) {
		if (!this.checkCLIInstallation()) {
			throw new Error('Claude Code CLI is not installed');
		}
		return super.streamText(params);
	}

	/**
	 * Override generateObject to check CLI installation
	 */
	async generateObject(params) {
		if (!this.checkCLIInstallation()) {
			throw new Error('Claude Code CLI is not installed');
		}
		return super.generateObject(params);
	}
}
