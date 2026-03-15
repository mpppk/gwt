#!/usr/bin/env bun
import { basename, dirname, resolve } from "node:path";
import { $ } from "bun";

$.throws(true);

type BranchKind = "local" | "remote";

type BranchItem = {
	kind: BranchKind;
	shortName: string;
	fullName: string;
	remoteName?: string;
	localName: string;
	display: string;
};

type WorktreeInfo = {
	path: string;
	branch?: string;
	bare?: boolean;
	detached?: boolean;
};

async function main() {
	if (process.argv.includes("-h") || process.argv.includes("--help")) {
		printHelp();
		return;
	}

	await assertCommand("git");
	await assertCommand("fzf");
	await assertGitRepo();

	const repoRoot = await getRepoRoot();

	console.error("Fetching remote branches...");
	await $`git fetch --all --prune --quiet`;

	const branches = await listBranches();
	if (branches.length === 0) {
		throw new Error("No branches found.");
	}

	const selected = await selectBranch(branches);
	if (!selected) {
		process.exit(130);
	}

	const worktrees = await listWorktrees();
	const existing = findWorktreeByBranch(worktrees, selected.localName);
	if (existing) {
		console.log(existing.path);
		return;
	}

	const hasLocal = await localBranchExists(selected.localName);
	const targetPath = buildVscodeLikeWorktreePath(repoRoot, selected.localName);

	await ensureParentDir(targetPath);

	if (!hasLocal) {
		if (selected.kind !== "remote") {
			throw new Error(`Local branch not found: ${selected.localName}`);
		}
		console.error(
			`Creating local branch ${selected.localName} tracking ${selected.fullName}...`,
		);
		const result =
			await $`git worktree add ${targetPath} --track -b ${selected.localName} ${selected.fullName}`.quiet();
		writeCapturedOutputToStderr(result);
	} else {
		console.error(`Creating worktree for ${selected.localName}...`);
		const result = await $`git worktree add ${targetPath} ${selected.localName}`.quiet();
		writeCapturedOutputToStderr(result);
	}

	console.log(targetPath);
}

function printHelp() {
	console.log(`
git-worktree-pick

Fetch remote branches, fuzzy-select a branch, and create a matching worktree.

Requirements:
  - git
  - fzf
  - bun

Usage:
  git-worktree-pick
`);
}

async function assertGitRepo() {
	try {
		const output = (await $`git rev-parse --is-inside-work-tree`.text()).trim();
		if (output !== "true") {
			throw new Error("Unexpected git rev-parse output.");
		}
	} catch {
		throw new Error("Current directory is not inside a git repository.");
	}
}

async function assertCommand(cmd: string) {
	try {
		await $`command -v ${cmd}`.text();
	} catch {
		throw new Error(`Required command not found: ${cmd}`);
	}
}

async function quietOk(p: Promise<unknown>) {
	try {
		await p;
		return true;
	} catch {
		return false;
	}
}

async function getRepoRoot(): Promise<string> {
	return (await $`git rev-parse --show-toplevel`.text()).trim();
}

async function listBranches(): Promise<BranchItem[]> {
	const format = [
		"%(refname)",
		"%(refname:short)",
		"%(committerdate:relative)",
		"%(subject)",
	].join("\t");

	const raw = (
		await $`git for-each-ref --sort=-committerdate --format=${format} refs/heads refs/remotes`.text()
	).trim();
	if (!raw) return [];

	const items: BranchItem[] = [];
	const seen = new Set<string>();

	for (const line of raw.split("\n")) {
		const cols = line.split("\t");
		const refname = cols[0];
		const shortName = cols[1];
		const relativeDate = cols[2] ?? "";
		const subject = cols[3] ?? "";

		if (!refname || !shortName) continue;

		if (refname.endsWith("/HEAD")) continue;

		if (refname.startsWith("refs/heads/")) {
			const localName = shortName;
			const key = `local:${localName}`;
			if (seen.has(key)) continue;
			seen.add(key);

			items.push({
				kind: "local",
				shortName: localName,
				fullName: localName,
				localName,
				display: formatDisplay("local", localName, "", relativeDate, subject),
			});
			continue;
		}

		if (refname.startsWith("refs/remotes/")) {
			const remoteFull = shortName;
			const [remoteName, ...rest] = remoteFull.split("/");
			const localName = rest.join("/");
			if (!remoteName || !localName) continue;

			const key = `remote:${remoteFull}`;
			if (seen.has(key)) continue;
			seen.add(key);

			items.push({
				kind: "remote",
				shortName: localName,
				fullName: remoteFull,
				remoteName,
				localName,
				display: formatDisplay(
					"remote",
					remoteFull,
					`-> ${localName}`,
					relativeDate,
					subject,
				),
			});
		}
	}

	return items;
}

function formatDisplay(
	kind: BranchKind,
	name: string,
	mapped: string,
	relativeDate: string,
	subject: string,
) {
	return [
		kind.padEnd(6),
		name.padEnd(40),
		mapped.padEnd(22),
		relativeDate.padEnd(16),
		subject,
	].join("  ");
}

async function selectBranch(items: BranchItem[]): Promise<BranchItem | null> {
	const input = items.map((b) => b.display).join("\n");

	try {
		const selected = (
			await $`printf '%s\n' ${input} | fzf --layout=reverse --height=80% --prompt='branch> '`.text()
		).trim();
		return items.find((b) => b.display === selected) ?? null;
	} catch {
		return null;
	}
}

async function localBranchExists(name: string): Promise<boolean> {
	return quietOk($`git show-ref --verify --quiet ${`refs/heads/${name}`}`);
}

async function listWorktrees(): Promise<WorktreeInfo[]> {
	const raw = (await $`git worktree list --porcelain`.text()).trim();
	if (!raw) return [];

	const result: WorktreeInfo[] = [];

	for (const block of raw.split("\n\n")) {
		const info: WorktreeInfo = { path: "" };

		for (const line of block.split("\n")) {
			if (line.startsWith("worktree "))
				info.path = line.slice("worktree ".length);
			else if (line.startsWith("branch "))
				info.branch = line.slice("branch ".length);
			else if (line === "bare") info.bare = true;
			else if (line === "detached") info.detached = true;
		}

		if (info.path) result.push(info);
	}

	return result;
}

function findWorktreeByBranch(
	worktrees: WorktreeInfo[],
	localBranchName: string,
) {
	return worktrees.find((w) => w.branch === `refs/heads/${localBranchName}`);
}

function buildVscodeLikeWorktreePath(
	repoRoot: string,
	branchName: string,
): string {
	const repoName = basename(repoRoot);
	const parent = dirname(repoRoot);
	const dirName = sanitizeWorktreeDirName(branchName);
	return resolve(parent, `${repoName}.worktrees`, dirName);
}

const WINDOWS_RESERVED_BASENAME_RE =
	/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const INVALID_PATH_CHARS = new Set(["<", ">", ":", '"', "/", "\\", "|", "?", "*"]);

function sanitizeWorktreeDirName(branchName: string): string {
	let sanitized = "";
	for (const ch of branchName) {
		const code = ch.charCodeAt(0);
		sanitized += code <= 0x1f || INVALID_PATH_CHARS.has(ch) ? "-" : ch;
	}

	let name = sanitized
		.replace(/-+/g, "-")
		.replace(/[. ]+$/g, "")
		.replace(/^-+|-+$/g, "");

	if (!name) {
		name = "_";
	}

	if (WINDOWS_RESERVED_BASENAME_RE.test(name)) {
		name = `_${name}`;
	}

	return name;
}

async function ensureParentDir(targetPath: string) {
	await $`mkdir -p ${dirname(targetPath)}`;
}

function writeCapturedOutputToStderr(result: {
	stdout: Uint8Array;
	stderr: Uint8Array;
}) {
	if (result.stdout.byteLength > 0) {
		process.stderr.write(result.stdout);
	}
	if (result.stderr.byteLength > 0) {
		process.stderr.write(result.stderr);
	}
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : String(err));
	process.exit(1);
});
