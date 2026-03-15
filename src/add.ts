import { $ } from "bun";
import {
	assertCommand,
	assertGitRepo,
	buildWorktreePath,
	ensureParentDir,
	findWorktreeByBranch,
	getMainWorktreeRoot,
	listBranches,
	listWorktrees,
	localBranchExists,
	resolveBranchArgument,
	writeCapturedOutputTo,
	type BranchItem,
} from "./git.ts";
import { defaultIO, writeLine, type CliIO, type CliWriter } from "./io.ts";

$.throws(true);

export type SelectBranch = (items: BranchItem[]) => Promise<BranchItem | null>;

export type RunAddCommandOptions = {
	branchArg?: string;
	io?: CliIO;
	selectBranch?: SelectBranch;
};

export async function runAddCommand({
	branchArg,
	io = defaultIO,
	selectBranch = selectBranchInteractive,
}: RunAddCommandOptions = {}): Promise<number> {
	await assertCommand("git");
	if (!branchArg) {
		await assertCommand("fzf");
	}
	await assertGitRepo();

	const mainWorktreeRoot = await getMainWorktreeRoot();

	writeLine(io.stderr, "Fetching remote branches...");
	await $`git fetch --all --prune --quiet`;

	const branches = await listBranches();
	if (branches.length === 0) {
		throw new Error("No branches found.");
	}

	const selected = branchArg
		? resolveBranchArgument(branchArg, branches)
		: await selectBranch(branches);
	if (!selected) {
		return 130;
	}

	const worktrees = await listWorktrees();
	const existing = findWorktreeByBranch(worktrees, selected.localName);
	if (existing) {
		writeLine(io.stdout, existing.path);
		return 0;
	}

	const hasLocal = await localBranchExists(selected.localName);
	const targetPath = buildWorktreePath(mainWorktreeRoot, selected.localName);

	await ensureParentDir(targetPath);

	if (!hasLocal) {
		if (selected.kind !== "remote") {
			throw new Error(`Local branch not found: ${selected.localName}`);
		}

		writeLine(
			io.stderr,
			`Creating local branch ${selected.localName} tracking ${selected.fullName}...`,
		);
		const result =
			await $`git worktree add ${targetPath} --track -b ${selected.localName} ${selected.fullName}`.quiet();
		writeCapturedOutputTo(io.stderr, result);
	} else {
		writeLine(io.stderr, `Creating worktree for ${selected.localName}...`);
		const result =
			await $`git worktree add ${targetPath} ${selected.localName}`.quiet();
		writeCapturedOutputTo(io.stderr, result);
	}

	writeLine(io.stdout, targetPath);
	return 0;
}

export function printAddHelp(writer: CliWriter) {
	writeLine(writer, "gwt add");
	writeLine(writer);
	writeLine(
		writer,
		"Create a worktree for a branch selected interactively or passed as an argument.",
	);
	writeLine(writer);
	writeLine(writer, "Usage:");
	writeLine(writer, "  gwt add");
	writeLine(writer, "  gwt add <branch>");
	writeLine(writer);
	writeLine(writer, "Options:");
	writeLine(writer, "  -h, --help  Show help for the add command.");
	writeLine(writer);
	writeLine(writer, "Branch resolution order:");
	writeLine(writer, "  1. exact local branch name");
	writeLine(writer, "  2. exact remote branch name, e.g. origin/feature/foo");
	writeLine(writer, "  3. a unique remote branch whose short name matches");
	writeLine(writer);
	writeLine(writer, "Requirements:");
	writeLine(writer, "  - git");
	writeLine(writer, "  - fzf (interactive mode only)");
	writeLine(writer, "  - bun");
}

export async function selectBranchInteractive(
	items: BranchItem[],
): Promise<BranchItem | null> {
	const input = items.map((branch) => branch.display).join("\n");

	try {
		const selected = (
			await $`printf '%s\n' ${input} | fzf --layout=reverse --height=80% --prompt='branch> '`.text()
		).trim();
		return items.find((branch) => branch.display === selected) ?? null;
	} catch {
		return null;
	}
}
