import { $ } from "bun";
import {
	type BranchItem,
	type GitCommandResult,
	type WorktreeInfo,
	addNewWorktree,
	addTrackedWorktree,
	addWorktree,
	assertCommand,
	assertGitRepo,
	buildWorktreePath,
	ensureParentDir,
	fetchRemoteBranch,
	findWorktreeByBranch,
	getMainWorktreeRoot,
	listBranches,
	listWorktrees,
	localBranchExists,
	resolveBranchArgument,
	writeCapturedOutputTo,
} from "./git.ts";
import {
	type PullRequestItem,
	formatPullRequestDisplay,
	listPullRequests,
} from "./github.ts";
import { type CliIO, type CliWriter, defaultIO, writeLine } from "./io.ts";

$.throws(true);

export type SelectBranch = (items: BranchItem[]) => Promise<BranchItem | null>;
export type PullRequestSelectionItem = PullRequestItem & {
	display: string;
	existingWorktreePath?: string;
};
export type SelectPullRequest = (
	items: PullRequestSelectionItem[],
) => Promise<PullRequestSelectionItem | null>;
export type InputBranchName = () => Promise<string | null>;

type RunAddCommandDependencies = {
	addNewWorktree: typeof addNewWorktree;
	addTrackedWorktree: typeof addTrackedWorktree;
	addWorktree: typeof addWorktree;
	assertCommand: typeof assertCommand;
	assertGitRepo: typeof assertGitRepo;
	ensureParentDir: typeof ensureParentDir;
	fetchRemoteBranch: typeof fetchRemoteBranch;
	getMainWorktreeRoot: typeof getMainWorktreeRoot;
	listBranches: typeof listBranches;
	listPullRequests: typeof listPullRequests;
	listWorktrees: typeof listWorktrees;
	localBranchExists: typeof localBranchExists;
};

export type RunAddCommandOptions = {
	branchArg?: string;
	createNewBranch?: boolean;
	deps?: Partial<RunAddCommandDependencies>;
	inputBranchName?: InputBranchName;
	io?: CliIO;
	selectBranch?: SelectBranch;
	selectPullRequest?: SelectPullRequest;
	usePullRequests?: boolean;
};

const defaultDeps: RunAddCommandDependencies = {
	addNewWorktree,
	addTrackedWorktree,
	addWorktree,
	assertCommand,
	assertGitRepo,
	ensureParentDir,
	fetchRemoteBranch,
	getMainWorktreeRoot,
	listBranches,
	listPullRequests,
	listWorktrees,
	localBranchExists,
};

export async function runAddCommand({
	branchArg,
	createNewBranch = false,
	deps = {},
	inputBranchName = inputBranchNameInteractive,
	io = defaultIO,
	selectBranch = selectBranchInteractive,
	selectPullRequest = selectPullRequestInteractive,
	usePullRequests = false,
}: RunAddCommandOptions = {}): Promise<number> {
	if (usePullRequests && branchArg) {
		throw new Error("`branchArg` cannot be used with `usePullRequests`.");
	}
	if (createNewBranch && usePullRequests) {
		throw new Error("`createNewBranch` cannot be used with `usePullRequests`.");
	}

	const resolvedDeps = { ...defaultDeps, ...deps };
	await resolvedDeps.assertCommand("git");
	if (usePullRequests) {
		await resolvedDeps.assertCommand("fzf");
		await resolvedDeps.assertCommand("gh");
	} else if (!branchArg) {
		await resolvedDeps.assertCommand("fzf");
	}
	await resolvedDeps.assertGitRepo();

	const mainWorktreeRoot = await resolvedDeps.getMainWorktreeRoot();
	const worktrees = await resolvedDeps.listWorktrees();

	const selected = createNewBranch
		? await selectBranchForNewMode({
				branchArg,
				inputBranchName,
				listBranches: resolvedDeps.listBranches,
			})
		: usePullRequests
			? await selectBranchFromPullRequests({
					io,
					listBranches: resolvedDeps.listBranches,
					listPullRequests: resolvedDeps.listPullRequests,
					selectPullRequest,
					worktrees,
					fetchRemoteBranch: resolvedDeps.fetchRemoteBranch,
				})
			: await selectBranchFromBranches({
					branchArg,
					listBranches: resolvedDeps.listBranches,
					selectBranch,
				});
	if (!selected) {
		return 130;
	}

	const existing = findWorktreeByBranch(worktrees, selected.localName);
	if (existing) {
		writeLine(io.stdout, existing.path);
		return 0;
	}

	return await createWorktreeForBranch({
		io,
		createNewBranch,
		addNewWorktree: resolvedDeps.addNewWorktree,
		localBranchExists: resolvedDeps.localBranchExists,
		mainWorktreeRoot,
		addTrackedWorktree: resolvedDeps.addTrackedWorktree,
		addWorktree: resolvedDeps.addWorktree,
		ensureParentDir: resolvedDeps.ensureParentDir,
		selected,
	});
}

export function printAddHelp(writer: CliWriter) {
	writeLine(writer, "gwt add");
	writeLine(writer);
	writeLine(
		writer,
		"Create, reuse, or create-new a worktree for a selected or specified branch.",
	);
	writeLine(writer);
	writeLine(writer, "Usage:");
	writeLine(writer, "  gwt add");
	writeLine(writer, "  gwt add <branch>");
	writeLine(writer, "  gwt add --new [<branch>]");
	writeLine(writer, "  gwt add --pr");
	writeLine(writer);
	writeLine(writer, "Options:");
	writeLine(writer, "  -h, --help  Show help for the add command.");
	writeLine(
		writer,
		"  --new       Create a new branch and worktree for the given branch name.",
	);
	writeLine(
		writer,
		"  --pr        Select an open same-repo GitHub PR via fzf.",
	);
	writeLine(writer);
	writeLine(writer, "Branch resolution order:");
	writeLine(writer, "  1. exact local branch name");
	writeLine(writer, "  2. exact remote branch name, e.g. origin/feature/foo");
	writeLine(writer, "  3. a unique remote branch whose short name matches");
	writeLine(writer);
	writeLine(writer, "New mode (`--new [<branch>]`):");
	writeLine(
		writer,
		"  - If no branch name is given, prompts for one interactively via fzf.",
	);
	writeLine(writer, "  - Fails if the local branch already exists.");
	writeLine(
		writer,
		"  - Uses explicit remote names (e.g. origin/feature/foo) when provided.",
	);
	writeLine(
		writer,
		"  - For short names, tracks a unique remote match or creates from HEAD.",
	);
	writeLine(writer);
	writeLine(writer, "PR mode:");
	writeLine(writer, "  - Lists open same-repo PRs from `gh pr list`.");
	writeLine(
		writer,
		"  - Shows `●` for existing worktrees and `○` for new ones.",
	);
	writeLine(
		writer,
		"  - Fetches `origin/<headRefName>` only if the selected branch is missing.",
	);
	writeLine(writer);
	writeLine(writer, "Requirements:");
	writeLine(writer, "  - git");
	writeLine(writer, "  - fzf (interactive branch/PR mode)");
	writeLine(writer, "  - gh (PR mode only)");
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

export async function selectPullRequestInteractive(
	items: PullRequestSelectionItem[],
): Promise<PullRequestSelectionItem | null> {
	const input = items.map((pullRequest) => pullRequest.display).join("\n");

	try {
		const selected = (
			await $`printf '%s\n' ${input} | fzf --layout=reverse --height=80% --prompt='pr> '`.text()
		).trim();
		return (
			items.find((pullRequest) => pullRequest.display === selected) ?? null
		);
	} catch {
		return null;
	}
}

export async function inputBranchNameInteractive(): Promise<string | null> {
	try {
		return (
			(
				await $`fzf --layout=reverse --height=80% --prompt='new branch> ' --print-query < /dev/null`.text()
			).trim() || null
		);
	} catch (error: unknown) {
		// fzf is given no input items (< /dev/null) so it always exits with code 1
		// when the user types a query and presses Enter. --print-query makes the
		// typed text available in stdout even on a non-zero exit.
		if (
			error !== null &&
			typeof error === "object" &&
			"exitCode" in error &&
			(error as { exitCode: number }).exitCode === 1 &&
			"stdout" in error
		) {
			const text = new TextDecoder()
				.decode((error as { stdout: Uint8Array }).stdout)
				.trim();
			return text || null;
		}
		return null;
	}
}

async function selectBranchFromBranches({
	branchArg,
	listBranches,
	selectBranch,
}: {
	branchArg?: string;
	listBranches: () => Promise<BranchItem[]>;
	selectBranch: SelectBranch;
}): Promise<BranchItem | null> {
	const branches = await listBranches();
	if (branches.length === 0) {
		throw new Error("No branches found.");
	}

	if (branchArg) {
		return resolveBranchArgument(branchArg, branches);
	}

	return await selectBranch(branches);
}

async function selectBranchForNewMode({
	branchArg,
	inputBranchName,
	listBranches,
}: {
	branchArg?: string;
	inputBranchName: InputBranchName;
	listBranches: () => Promise<BranchItem[]>;
}): Promise<BranchItem | null> {
	const resolvedBranchArg = branchArg ?? (await inputBranchName());
	if (!resolvedBranchArg) {
		return null;
	}

	const branches = await listBranches();
	const explicitRemoteName = getExplicitRemoteName(resolvedBranchArg, branches);
	if (explicitRemoteName) {
		const remoteMatch = branches.find(
			(branch) =>
				branch.kind === "remote" && branch.fullName === resolvedBranchArg,
		);
		if (!remoteMatch) {
			throw new Error(`Remote branch not found: ${resolvedBranchArg}`);
		}
		if (hasLocalBranch(branches, remoteMatch.localName)) {
			throw new Error(`Local branch already exists: ${remoteMatch.localName}`);
		}
		return remoteMatch;
	}

	if (hasLocalBranch(branches, resolvedBranchArg)) {
		throw new Error(`Local branch already exists: ${resolvedBranchArg}`);
	}

	try {
		return resolveBranchArgument(resolvedBranchArg, branches);
	} catch (error) {
		if (!isBranchNotFoundError(error, resolvedBranchArg)) {
			throw error;
		}
	}

	return buildNewLocalBranchItem(resolvedBranchArg);
}

async function selectBranchFromPullRequests({
	fetchRemoteBranch,
	io,
	listBranches,
	listPullRequests,
	selectPullRequest,
	worktrees,
}: {
	fetchRemoteBranch: (
		remoteName: string,
		branchName: string,
	) => Promise<GitCommandResult>;
	io: CliIO;
	listBranches: () => Promise<BranchItem[]>;
	listPullRequests: () => Promise<PullRequestItem[]>;
	selectPullRequest: SelectPullRequest;
	worktrees: WorktreeInfo[];
}): Promise<BranchItem | null> {
	const pullRequests = await listPullRequests();
	if (pullRequests.length === 0) {
		throw new Error("No open pull requests found.");
	}

	const candidates = buildPullRequestSelectionItems(pullRequests, worktrees);
	const selectedPullRequest = await selectPullRequest(candidates);
	if (!selectedPullRequest) {
		return null;
	}

	if (selectedPullRequest.existingWorktreePath) {
		return {
			display: selectedPullRequest.display,
			fullName: selectedPullRequest.headRefName,
			kind: "local",
			localName: selectedPullRequest.headRefName,
			shortName: selectedPullRequest.headRefName,
		};
	}

	return await resolvePullRequestBranch(
		selectedPullRequest.headRefName,
		io,
		listBranches,
		fetchRemoteBranch,
	);
}

function buildPullRequestSelectionItems(
	pullRequests: PullRequestItem[],
	worktrees: WorktreeInfo[],
): PullRequestSelectionItem[] {
	return pullRequests.map((pullRequest) => {
		const existing = findWorktreeByBranch(worktrees, pullRequest.headRefName);
		const worktreeStatus = existing ? "●" : "○";

		return {
			...pullRequest,
			display: formatPullRequestDisplay(pullRequest, worktreeStatus),
			existingWorktreePath: existing?.path,
		};
	});
}

async function resolvePullRequestBranch(
	headRefName: string,
	io: CliIO,
	listBranches: () => Promise<BranchItem[]>,
	fetchRemoteBranch: (
		remoteName: string,
		branchName: string,
	) => Promise<GitCommandResult>,
): Promise<BranchItem> {
	let branches = await listBranches();

	try {
		return resolveBranchArgument(headRefName, branches);
	} catch (error) {
		if (!isBranchNotFoundError(error, headRefName)) {
			throw error;
		}
	}

	writeLine(io.stderr, `Fetching origin/${headRefName}...`);
	const fetchResult = await fetchRemoteBranch("origin", headRefName);
	if (fetchResult.exitCode !== 0) {
		writeCapturedOutputTo(io.stderr, fetchResult);
		throw new Error(
			`Failed to fetch selected PR branch: origin/${headRefName}`,
		);
	}
	writeCapturedOutputTo(io.stderr, fetchResult);

	branches = await listBranches();
	try {
		return resolveBranchArgument(headRefName, branches);
	} catch (error) {
		if (isBranchNotFoundError(error, headRefName)) {
			throw new Error(
				`Selected PR branch not found after fetch: ${headRefName}`,
			);
		}
		throw error;
	}
}

function hasLocalBranch(branches: BranchItem[], name: string): boolean {
	return branches.some(
		(branch) => branch.kind === "local" && branch.localName === name,
	);
}

function getExplicitRemoteName(
	branchArg: string,
	branches: BranchItem[],
): string | null {
	const slashIndex = branchArg.indexOf("/");
	if (slashIndex <= 0) {
		return null;
	}

	const remoteName = branchArg.slice(0, slashIndex);
	const hasRemote = branches.some(
		(branch) => branch.kind === "remote" && branch.remoteName === remoteName,
	);
	return hasRemote ? remoteName : null;
}

function buildNewLocalBranchItem(branchName: string): BranchItem {
	return {
		display: branchName,
		fullName: branchName,
		kind: "local",
		localName: branchName,
		shortName: branchName,
	};
}

async function createWorktreeForBranch({
	addNewWorktree,
	addTrackedWorktree,
	addWorktree,
	createNewBranch,
	ensureParentDir,
	io,
	localBranchExists,
	mainWorktreeRoot,
	selected,
}: {
	addNewWorktree: (
		targetPath: string,
		branchName: string,
	) => Promise<GitCommandResult>;
	addTrackedWorktree: (
		targetPath: string,
		localBranchName: string,
		remoteBranchName: string,
	) => Promise<GitCommandResult>;
	addWorktree: (
		targetPath: string,
		branchName: string,
	) => Promise<GitCommandResult>;
	createNewBranch: boolean;
	ensureParentDir: (targetPath: string) => Promise<void>;
	io: CliIO;
	localBranchExists: (name: string) => Promise<boolean>;
	mainWorktreeRoot: string;
	selected: BranchItem;
}): Promise<number> {
	const hasLocal = await localBranchExists(selected.localName);
	const targetPath = buildWorktreePath(mainWorktreeRoot, selected.localName);

	await ensureParentDir(targetPath);

	if (createNewBranch) {
		if (hasLocal) {
			throw new Error(`Local branch already exists: ${selected.localName}`);
		}

		if (selected.kind === "remote") {
			writeLine(
				io.stderr,
				`Creating local branch ${selected.localName} tracking ${selected.fullName}...`,
			);
			const result = await addTrackedWorktree(
				targetPath,
				selected.localName,
				selected.fullName,
			);
			if (result.exitCode !== 0) {
				writeCapturedOutputTo(io.stderr, result);
				throw new Error(`Failed to create worktree for ${selected.localName}`);
			}
			writeCapturedOutputTo(io.stderr, result);
		} else {
			writeLine(
				io.stderr,
				`Creating new branch ${selected.localName} from current HEAD...`,
			);
			const result = await addNewWorktree(targetPath, selected.localName);
			if (result.exitCode !== 0) {
				writeCapturedOutputTo(io.stderr, result);
				throw new Error(`Failed to create worktree for ${selected.localName}`);
			}
			writeCapturedOutputTo(io.stderr, result);
		}

		writeLine(io.stdout, targetPath);
		return 0;
	}

	if (!hasLocal) {
		if (selected.kind !== "remote") {
			throw new Error(`Local branch not found: ${selected.localName}`);
		}

		writeLine(
			io.stderr,
			`Creating local branch ${selected.localName} tracking ${selected.fullName}...`,
		);
		const result = await addTrackedWorktree(
			targetPath,
			selected.localName,
			selected.fullName,
		);
		if (result.exitCode !== 0) {
			writeCapturedOutputTo(io.stderr, result);
			throw new Error(`Failed to create worktree for ${selected.localName}`);
		}
		writeCapturedOutputTo(io.stderr, result);
	} else {
		writeLine(io.stderr, `Creating worktree for ${selected.localName}...`);
		const result = await addWorktree(targetPath, selected.localName);
		if (result.exitCode !== 0) {
			writeCapturedOutputTo(io.stderr, result);
			throw new Error(`Failed to create worktree for ${selected.localName}`);
		}
		writeCapturedOutputTo(io.stderr, result);
	}

	writeLine(io.stdout, targetPath);
	return 0;
}

function isBranchNotFoundError(error: unknown, branchName: string) {
	return (
		error instanceof Error &&
		error.message === `Branch not found: ${branchName}`
	);
}
