import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import {
	normalizeProjectRoot,
	getProjectRootFromSession
} from '../../../../mcp-server/src/tools/utils.js';

const createMockLogger = () => ({
	info: jest.fn(),
	warn: jest.fn(),
	error: jest.fn(),
	debug: jest.fn()
});

describe('Project root normalization helpers', () => {
	afterEach(() => {
		jest.restoreAllMocks();
	});

	test('normalizes vscode remote WSL URIs to POSIX paths', () => {
		const logger = createMockLogger();
		const uri = 'vscode-remote://wsl+Ubuntu/home/user/project';
		const result = normalizeProjectRoot(uri, logger);
		expect(result).toBe('/home/user/project');
	});

	test('normalizes UNC WSL share paths', () => {
		const logger = createMockLogger();
		const uncPath = '\\\\wsl$\\\\Ubuntu\\\\home\\\\user\\\\workspace';
		const result = normalizeProjectRoot(uncPath, logger);
		expect(result).toBe('/mnt/wsl/Ubuntu/home/user/workspace');
	});

	test('translates Windows drive paths to WSL mount points when running on non-Windows', () => {
		const logger = createMockLogger();
		const windowsPath = 'C:/Users/dev/project';
		const result = normalizeProjectRoot(windowsPath, logger);
		if (process.platform === 'win32') {
			expect(result.toLowerCase()).toBe(
				path.win32.normalize('C:/Users/dev/project').toLowerCase()
			);
		} else {
			expect(result).toBe('/mnt/c/Users/dev/project');
		}
	});
});

describe('getProjectRootFromSession fallbacks', () => {
	const originalEnv = { ...process.env };

	afterEach(() => {
		// Restore environment variables to their original state
		for (const key of Object.keys(process.env)) {
			if (!(key in originalEnv)) {
				delete process.env[key];
			}
		}
		for (const [key, value] of Object.entries(originalEnv)) {
			process.env[key] = value;
		}

		jest.restoreAllMocks();
	});

	test('falls back to session environment PWD when roots are unavailable', () => {
		const logger = createMockLogger();
		const workspacePath = '/home/user/workspace';
		jest
			.spyOn(fs, 'existsSync')
			.mockImplementation((targetPath) =>
				targetPath === workspacePath || targetPath === path.join(workspacePath, '.taskmaster')
			);

		const session = {
			clientCapabilities: {},
			context: {},
			env: {
				PWD: workspacePath
			}
		};

		const result = getProjectRootFromSession(session, logger);
		expect(result).toBe(workspacePath);
	});

	test('derives project root from remote workspace folder URIs', () => {
		const logger = createMockLogger();
		const remotePath = '/home/user/remote-workspace';
		jest
			.spyOn(fs, 'existsSync')
			.mockImplementation((targetPath) =>
				targetPath === remotePath || targetPath === path.join(remotePath, '.taskmaster')
			);

		const session = {
			clientCapabilities: {},
			context: {
				workspaceFolders: [
					'vscode-remote://wsl+Ubuntu/home/user/remote-workspace'
				]
			}
		};

		const result = getProjectRootFromSession(session, logger);
		expect(result).toBe(remotePath);
	});
});
