import { $ } from "bun";
import { createInterface } from "node:readline/promises";
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
	writeCapturedOutputTo,
	type WorktreeInfo,
} from "./git.ts";
import { defaultIO, writeLine, type CliIO, type CliWriter } from "./io.ts";

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

export type SelectWorktree = (
	items: RemovableWorktree[],
) => Promise<RemovableWorktree | null>;

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
	selectWorktree?: SelectWorktree;
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
	selectWorktree = selectWorktreeInteractive,
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

	const selected = await selectWorktree(candidates);
	if (!selected) {
		return 130;
	}

	const risk = await getRemovalRisk(
		selected.path,
		resolvedDeps.isWorktreeDirty,
		resolvedDeps.getAheadCount,
	);
	const shouldForce = risk.isDirty || risk.aheadCount > 0;

	if (shouldForce) {
		const confirmed = await confirmRemoval({ risk, worktree: selected }, io);
		if (!confirmed) {
			writeLine(io.stderr, "Removal aborted.");
			return 1;
		}
	}

	writeLine(io.stderr, `Removing worktree ${selected.path}...`);
	const removeResult = await resolvedDeps.removeWorktree(
		selected.path,
		shouldForce,
	);
	if (removeResult.exitCode !== 0) {
		writeCapturedOutputTo(io.stderr, removeResult);
		throw new Error(`Failed to remove worktree: ${selected.path}`);
	}
	writeCapturedOutputTo(io.stderr, removeResult);
	writeLine(io.stdout, selected.path);

	writeLine(io.stderr, `Deleting branch ${selected.branchName}...`);
	const deleteResult = await resolvedDeps.deleteLocalBranch(selected.branchName);
	if (deleteResult.exitCode !== 0) {
		writeCapturedOutputTo(io.stderr, deleteResult);
		writeLine(
			io.stderr,
			`Removed worktree ${selected.path}, but kept branch ${selected.branchName}.`,
		);
		return 1;
	}
	writeCapturedOutputTo(io.stderr, deleteResult);

	return 0;
}

export function printRemoveHelp(writer: CliWriter) {
	writeLine(writer, "gwt remove");
	writeLine(writer);
	writeLine(
		writer,
		"Select a linked worktree, remove it, and delete its local branch.",
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
		"  - Asks for confirmation if the selected worktree has local changes or unpushed commits.",
	);
	writeLine(
		writer,
		"  - Deletes the local branch with `git branch -d` after removing the worktree.",
	);
	writeLine(writer);
	writeLine(writer, "Requirements:");
	writeLine(writer, "  - git");
	writeLine(writer, "  - fzf");
	writeLine(writer, "  - bun");
}

export async function selectWorktreeInteractive(
	items: RemovableWorktree[],
): Promise<RemovableWorktree | null> {
	const input = items.map((worktree) => worktree.display).join("\n");

	try {
		const selected = (
			await $`printf '%s\n' ${input} | fzf --layout=reverse --height=80% --prompt='worktree> '`.text()
		).trim();
		return items.find((worktree) => worktree.display === selected) ?? null;
	} catch {
		return null;
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
		if (worktree.path === currentWorktreeRoot || worktree.path === mainWorktreeRoot) {
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
