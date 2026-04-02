import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export interface HotMapFileItem {
	workspaceName: string;
	relativePath: string;
	displayPath: string;
	uri: string;
	lineCount: number;
	commitCount: number;
}

export interface HotMapPayload {
	generatedAt: string;
	workspaceCount: number;
	fileCount: number;
	maxLineCount: number;
	maxCommitCount: number;
	items: HotMapFileItem[];
}

interface GitContext {
	repoRoot: string;
	scopePrefix: string;
}

export async function collectHotMapData(workspaceFolders: readonly vscode.WorkspaceFolder[]): Promise<HotMapPayload> {
	const items = (await Promise.all(workspaceFolders.map((workspaceFolder) => scanWorkspaceFolder(workspaceFolder, workspaceFolders.length > 1)))).flat();
	items.sort((left, right) => {
		if (right.lineCount !== left.lineCount) {
			return right.lineCount - left.lineCount;
		}
		if (right.commitCount !== left.commitCount) {
			return right.commitCount - left.commitCount;
		}
		return left.displayPath.localeCompare(right.displayPath);
	});

	return {
		generatedAt: new Date().toISOString(),
		workspaceCount: workspaceFolders.length,
		fileCount: items.length,
		maxLineCount: items.reduce((max, item) => Math.max(max, item.lineCount), 0),
		maxCommitCount: items.reduce((max, item) => Math.max(max, item.commitCount), 0),
		items,
	};
}

async function scanWorkspaceFolder(workspaceFolder: vscode.WorkspaceFolder, includeWorkspaceName: boolean): Promise<HotMapFileItem[]> {
	const folderPath = workspaceFolder.uri.fsPath;
	const gitContext = await getGitContext(folderPath);
	const filePaths = gitContext ? await getGitFilePaths(gitContext) : await getFilesystemFilePaths(folderPath);
	const uniqueFilePaths = Array.from(new Set(filePaths)).filter((filePath) => filePath.length > 0);
	const commitCounts = gitContext ? await getGitCommitCounts(gitContext) : new Map<string, number>();

	return mapWithConcurrency(uniqueFilePaths, 24, async (relativeFilePath) => {
		const absolutePath = gitContext
			? path.join(gitContext.repoRoot, ...relativeFilePath.split('/'))
			: path.join(folderPath, ...relativeFilePath.split('/'));
		const stat = await safeStat(absolutePath);
		if (!stat?.isFile()) {
			return undefined;
		}
		const workspaceRelativePath = gitContext
			? normalizePath(path.relative(folderPath, absolutePath))
			: relativeFilePath;
		if (workspaceRelativePath.length === 0) {
			return undefined;
		}
		const lineCount = await countFileLines(absolutePath);
		return {
			workspaceName: workspaceFolder.name,
			relativePath: workspaceRelativePath,
			displayPath: includeWorkspaceName ? `${workspaceFolder.name}/${workspaceRelativePath}` : workspaceRelativePath,
			uri: vscode.Uri.file(absolutePath).toString(),
			lineCount,
			commitCount: commitCounts.get(relativeFilePath) ?? 0,
		};
	}).then((items) => items.filter((item): item is HotMapFileItem => item !== undefined));
}

async function getGitContext(folderPath: string): Promise<GitContext | undefined> {
	try {
		const repoRoot = normalizePath((await runCommand('git', ['rev-parse', '--show-toplevel'], folderPath)).trim());
		if (repoRoot.length === 0) {
			return undefined;
		}
		const scopePrefix = normalizePath(path.relative(repoRoot, folderPath));
		return {
			repoRoot,
			scopePrefix: scopePrefix === '.' ? '' : scopePrefix,
		};
	} catch {
		return undefined;
	}
}

async function getGitFilePaths(gitContext: GitContext): Promise<string[]> {
	const args = ['ls-files', '--cached', '--others', '--exclude-standard', '-z'];
	if (gitContext.scopePrefix.length > 0) {
		args.push('--', gitContext.scopePrefix);
	}
	const output = await runCommand('git', args, gitContext.repoRoot);
	return parseNullSeparatedOutput(output);
}

async function getGitCommitCounts(gitContext: GitContext): Promise<Map<string, number>> {
	try {
		const args = ['log', '--name-only', '--pretty=format:', '--no-renames', '-z'];
		if (gitContext.scopePrefix.length > 0) {
			args.push('--', gitContext.scopePrefix);
		}
		const output = await runCommand('git', args, gitContext.repoRoot);
		const counts = new Map<string, number>();
		for (const filePath of parseNullSeparatedOutput(output)) {
			counts.set(filePath, (counts.get(filePath) ?? 0) + 1);
		}
		return counts;
	} catch {
		return new Map<string, number>();
	}
}

async function getFilesystemFilePaths(rootPath: string): Promise<string[]> {
	const results: string[] = [];
	const queue: string[] = [rootPath];

	while (queue.length > 0) {
		const currentPath = queue.shift();
		if (!currentPath) {
			continue;
		}
		const entries = await fs.readdir(currentPath, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.name === '.git') {
				continue;
			}
			const entryPath = path.join(currentPath, entry.name);
			if (entry.isDirectory()) {
				queue.push(entryPath);
				continue;
			}
			if (entry.isFile()) {
				results.push(normalizePath(path.relative(rootPath, entryPath)));
			}
		}
	}

	return results;
}

async function countFileLines(filePath: string): Promise<number> {
	try {
		const buffer = await fs.readFile(filePath);
		if (buffer.length === 0) {
			return 0;
		}
		if (buffer.includes(0)) {
			return 1;
		}
		let lineCount = 1;
		for (let index = 0; index < buffer.length; index += 1) {
			if (buffer[index] === 10) {
				lineCount += 1;
			}
		}
		return lineCount;
	} catch {
		return 1;
	}
}

async function safeStat(filePath: string): Promise<Awaited<ReturnType<typeof fs.stat>> | undefined> {
	try {
		return await fs.stat(filePath);
	} catch {
		return undefined;
	}
}

async function runCommand(command: string, args: string[], cwd: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });

		child.stdout.on('data', (chunk: Buffer | string) => {
			stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
		});

		child.stderr.on('data', (chunk: Buffer | string) => {
			stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
		});

		child.on('error', reject);
		child.on('close', (code) => {
			if (code === 0) {
				resolve(Buffer.concat(stdoutChunks).toString('utf8'));
				return;
			}
			const errorMessage = Buffer.concat(stderrChunks).toString('utf8').trim();
			reject(new Error(errorMessage.length > 0 ? errorMessage : `${command} exited with code ${code ?? 'unknown'}`));
		});
	});
}

function parseNullSeparatedOutput(output: string): string[] {
	return output
		.split('\0')
		.map((filePath) => normalizePath(filePath.trim()))
		.filter((filePath) => filePath.length > 0);
}

function normalizePath(filePath: string): string {
	return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

async function mapWithConcurrency<TInput, TOutput>(
	items: readonly TInput[],
	concurrency: number,
	mapper: (item: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
	if (items.length === 0) {
		return [];
	}
	const results = new Array<TOutput>(items.length);
	const workerCount = Math.max(1, Math.min(concurrency, items.length));
	let nextIndex = 0;

	await Promise.all(Array.from({ length: workerCount }, async () => {
		while (true) {
			const currentIndex = nextIndex;
			nextIndex += 1;
			if (currentIndex >= items.length) {
				return;
			}
			results[currentIndex] = await mapper(items[currentIndex], currentIndex);
		}
	}));

	return results;
}
