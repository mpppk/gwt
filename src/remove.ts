import { createInterface } from "node:readline/promises";
import { $ } from "bun";
import {
	assertCommand,
	assertGitRepo,
	deleteLocalBranch,
	formatWorktreeDisplay,
	getAheadCount,
	getCurrentWorktreeRoot,
	getLocalBranchName,
	getMainWorktreeRoot,
	isWorktreeDirty,
	listWorktrees,
	removeWorktree,
	type WorktreeInfo,
	writeCapturedOutputTo,
} from "./git.ts";
import { type CliIO, type CliWriter, defaultIO, writeLine } from "./io.ts";

$.throws(true);

export type RemovableWorktree = {
	path: string;
	branchName: string;
	display: string;
};

export type RemovalRisk = {
	aheadCount: number;
	isDirty: boolean;
};

export type ConfirmRemovalContext = {
	risk: RemovalRisk;
	worktree: RemovableWorktree;
};

export type SelectWorktrees = (
	items: RemovableWorktree[],
) => Promise<RemovableWorktree[]>;

export type ConfirmRemoval = (
	context: ConfirmRemovalContext,
	io: CliIO,
) => Promise<boolean>;

type RunRemoveCommandDependencies = {
	assertCommand: typeof assertCommand;
	assertGitRepo: typeof assertGitRepo;
	deleteLocalBranch: typeof deleteLocalBranch;
	getAheadCount: typeof getAheadCount;
	getCurrentWorktreeRoot: typeof getCurrentWorktreeRoot;
	getMainWorktreeRoot: typeof getMainWorktreeRoot;
	isWorktreeDirty: typeof isWorktreeDirty;
	listWorktrees: typeof listWorktrees;
	removeWorktree: typeof removeWorktree;
};

export type RunRemoveCommandOptions = {
	confirmRemoval?: ConfirmRemoval;
	deps?: Partial<RunRemoveCommandDependencies>;
	io?: CliIO;
	selectWorktrees?: SelectWorktrees;
};

const defaultDeps: RunRemoveCommandDependencies = {
	assertCommand,
	assertGitRepo,
	deleteLocalBranch,
	getAheadCount,
	getCurrentWorktreeRoot,
	getMainWorktreeRoot,
	isWorktreeDirty,
	listWorktrees,
	removeWorktree,
};

export async function runRemoveCommand({
	confirmRemoval = confirmRemovalInteractive,
	deps = {},
	io = defaultIO,
	selectWorktrees = selectWorktreesInteractive,
}: RunRemoveCommandOptions = {}): Promise<number> {
	const resolvedDeps = { ...defaultDeps, ...deps };

	await resolvedDeps.assertCommand("git");
	await resolvedDeps.assertCommand("fzf");
	await resolvedDeps.assertGitRepo();

	const [worktrees, currentWorktreeRoot, mainWorktreeRoot] = await Promise.all([
		resolvedDeps.listWorktrees(),
		resolvedDeps.getCurrentWorktreeRoot(),
		resolvedDeps.getMainWorktreeRoot(),
	]);

	const candidates = buildRemovableWorktrees(
		worktrees,
		currentWorktreeRoot,
		mainWorktreeRoot,
	);
	if (candidates.length === 0) {
		throw new Error("No removable worktrees found.");
	}

	const selected = await selectWorktrees(candidates);
	if (selected.length === 0) {
		return 130;
	}

	let exitCode = 0;

	for (const worktree of selected) {
		const risk = await getRemovalRisk(
			worktree.path,
			resolvedDeps.isWorktreeDirty,
			resolvedDeps.getAheadCount,
		);
		const shouldForce = risk.isDirty || risk.aheadCount > 0;

		if (shouldForce) {
			const confirmed = await confirmRemoval({ risk, worktree }, io);
			if (!confirmed) {
				writeLine(io.stderr, "Removal aborted.");
				exitCode = 1;
				continue;
			}
		}

		writeLine(io.stderr, `Removing worktree ${worktree.path}...`);
		const removeResult = await resolvedDeps.removeWorktree(
			worktree.path,
			shouldForce,
		);
		if (removeResult.exitCode !== 0) {
			writeCapturedOutputTo(io.stderr, removeResult);
			throw new Error(`Failed to remove worktree: ${worktree.path}`);
		}
		writeCapturedOutputTo(io.stderr, removeResult);
		writeLine(io.stdout, worktree.path);

		writeLine(io.stderr, `Deleting branch ${worktree.branchName}...`);
		const deleteResult = await resolvedDeps.deleteLocalBranch(
			worktree.branchName,
		);
		if (deleteResult.exitCode !== 0) {
			writeCapturedOutputTo(io.stderr, deleteResult);
			writeLine(
				io.stderr,
				`Removed worktree ${worktree.path}, but kept branch ${worktree.branchName}.`,
			);
			exitCode = 1;
			continue;
		}
		writeCapturedOutputTo(io.stderr, deleteResult);
	}

	return exitCode;
}

export function printRemoveHelp(writer: CliWriter) {
	writeLine(writer, "gwt remove");
	writeLine(writer);
	writeLine(
		writer,
		"Select linked worktrees, remove them, and delete their local branches.",
	);
	writeLine(writer);
	writeLine(writer, "Usage:");
	writeLine(writer, "  gwt remove");
	writeLine(writer);
	writeLine(writer, "Options:");
	writeLine(writer, "  -h, --help  Show help for the remove command.");
	writeLine(writer);
	writeLine(writer, "Behavior:");
	writeLine(
		writer,
		"  - Lists linked worktrees except the current worktree and the main worktree.",
	);
	writeLine(
		writer,
		"  - Use TAB to select multiple worktrees for batch removal.",
	);
	writeLine(
		writer,
		"  - Asks for confirmation if a selected worktree has local changes or unpushed commits.",
	);
	writeLine(
		writer,
		"  - Deletes the local branch with `git branch -d` after removing each worktree.",
	);
	writeLine(writer);
	writeLine(writer, "Requirements:");
	writeLine(writer, "  - git");
	writeLine(writer, "  - fzf");
	writeLine(writer, "  - bun");
}

export async function selectWorktreesInteractive(
	items: RemovableWorktree[],
): Promise<RemovableWorktree[]> {
	const input = items.map((worktree) => worktree.display).join("\n");

	try {
		const output = (
			await $`printf '%s\n' ${input} | fzf --layout=reverse --height=80% --multi --prompt='worktree> '`.text()
		).trim();
		if (!output) return [];
		const selectedDisplays = new Set(output.split("\n"));
		return items.filter((worktree) => selectedDisplays.has(worktree.display));
	} catch {
		return [];
	}
}

export async function confirmRemovalInteractive(
	{ risk, worktree }: ConfirmRemovalContext,
	_io: CliIO,
): Promise<boolean> {
	const reasons: string[] = [];
	if (risk.isDirty) {
		reasons.push("local changes");
	}
	if (risk.aheadCount > 0) {
		const suffix = risk.aheadCount === 1 ? "" : "s";
		reasons.push(`${risk.aheadCount} unpushed commit${suffix}`);
	}

	const summary = reasons.join(" and ");
	const prompt = `Worktree ${worktree.path} (${worktree.branchName}) has ${summary}. Remove it anyway? [y/N] `;
	const readline = createInterface({
		input: process.stdin,
		output: process.stderr,
	});

	try {
		const answer = await readline.question(prompt);
		const normalized = answer.trim().toLowerCase();
		return normalized === "y" || normalized === "yes";
	} finally {
		readline.close();
	}
}

async function getRemovalRisk(
	path: string,
	isDirtyFn: (path: string) => Promise<boolean>,
	getAheadCountFn: (path: string) => Promise<number>,
): Promise<RemovalRisk> {
	const [isDirty, aheadCount] = await Promise.all([
		isDirtyFn(path),
		getAheadCountFn(path),
	]);

	return {
		aheadCount,
		isDirty,
	};
}

function buildRemovableWorktrees(
	worktrees: WorktreeInfo[],
	currentWorktreeRoot: string,
	mainWorktreeRoot: string,
): RemovableWorktree[] {
	const result: RemovableWorktree[] = [];

	for (const worktree of worktrees) {
		if (
			worktree.path === currentWorktreeRoot ||
			worktree.path === mainWorktreeRoot
		) {
			continue;
		}
		if (worktree.bare || worktree.detached) {
			continue;
		}

		const branchName = getLocalBranchName(worktree.branch);
		if (!branchName) {
			continue;
		}

		result.push({
			path: worktree.path,
			branchName,
			display: formatWorktreeDisplay(branchName, worktree.path),
		});
	}

	return result;
}
