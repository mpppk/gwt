import { basename, dirname, resolve } from "node:path";
import { $ } from "bun";
import type { CliWriter } from "./io.ts";

$.throws(true);

export type BranchKind = "local" | "remote";

export type BranchItem = {
	kind: BranchKind;
	shortName: string;
	fullName: string;
	remoteName?: string;
	localName: string;
	display: string;
};

export type WorktreeInfo = {
	path: string;
	branch?: string;
	bare?: boolean;
	detached?: boolean;
};

const WINDOWS_RESERVED_BASENAME_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const INVALID_PATH_CHARS = new Set([
	"<",
	">",
	":",
	'"',
	"/",
	"\\",
	"|",
	"?",
	"*",
]);

export async function assertGitRepo() {
	try {
		const output = (await $`git rev-parse --is-inside-work-tree`.text()).trim();
		if (output !== "true") {
			throw new Error("Unexpected git rev-parse output.");
		}
	} catch {
		throw new Error("Current directory is not inside a git repository.");
	}
}

export async function assertCommand(cmd: string) {
	try {
		await $`command -v ${cmd}`.text();
	} catch {
		throw new Error(`Required command not found: ${cmd}`);
	}
}

export async function quietOk(promise: Promise<unknown>) {
	try {
		await promise;
		return true;
	} catch {
		return false;
	}
}

export async function getMainWorktreeRoot(): Promise<string> {
	const worktrees = await listWorktrees();
	const mainFromList = worktrees[0]?.path;
	if (mainFromList) {
		return mainFromList;
	}

	const commonGitDir = (
		await $`git rev-parse --path-format=absolute --git-common-dir`.text()
	).trim();

	if (!commonGitDir) {
		throw new Error("Failed to resolve git common dir.");
	}

	if (basename(commonGitDir) === ".git") {
		return dirname(commonGitDir);
	}

	throw new Error("Failed to resolve main worktree root from git metadata.");
}

export async function listBranches(): Promise<BranchItem[]> {
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

export function formatDisplay(
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

export async function localBranchExists(name: string): Promise<boolean> {
	return quietOk($`git show-ref --verify --quiet ${`refs/heads/${name}`}`);
}

export async function listWorktrees(): Promise<WorktreeInfo[]> {
	const raw = (await $`git worktree list --porcelain`.text()).trim();
	if (!raw) return [];

	const result: WorktreeInfo[] = [];

	for (const block of raw.split("\n\n")) {
		const info: WorktreeInfo = { path: "" };

		for (const line of block.split("\n")) {
			if (line.startsWith("worktree ")) {
				info.path = line.slice("worktree ".length);
			} else if (line.startsWith("branch ")) {
				info.branch = line.slice("branch ".length);
			} else if (line === "bare") {
				info.bare = true;
			} else if (line === "detached") {
				info.detached = true;
			}
		}

		if (info.path) result.push(info);
	}

	return result;
}

export function findWorktreeByBranch(
	worktrees: WorktreeInfo[],
	localBranchName: string,
) {
	return worktrees.find((w) => w.branch === `refs/heads/${localBranchName}`);
}

export function buildWorktreePath(repoRoot: string, branchName: string): string {
	const repoName = basename(repoRoot);
	const parent = dirname(repoRoot);
	const dirName = sanitizeWorktreeDirName(branchName);
	return resolve(parent, `${repoName}.worktrees`, dirName);
}

export function sanitizeWorktreeDirName(branchName: string): string {
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

export async function ensureParentDir(targetPath: string) {
	await $`mkdir -p ${dirname(targetPath)}`;
}

export function writeCapturedOutputTo(
	writer: CliWriter,
	result: { stdout: Uint8Array; stderr: Uint8Array },
) {
	if (result.stdout.byteLength > 0) {
		writer.write(result.stdout);
	}
	if (result.stderr.byteLength > 0) {
		writer.write(result.stderr);
	}
}

export function resolveBranchArgument(
	branchArg: string,
	branches: BranchItem[],
): BranchItem {
	const localMatch = branches.find(
		(branch) => branch.kind === "local" && branch.localName === branchArg,
	);
	if (localMatch) {
		return localMatch;
	}

	const remoteExactMatch = branches.find(
		(branch) => branch.kind === "remote" && branch.fullName === branchArg,
	);
	if (remoteExactMatch) {
		return remoteExactMatch;
	}

	const remoteShortMatches = branches.filter(
		(branch) => branch.kind === "remote" && branch.localName === branchArg,
	);
	if (remoteShortMatches.length === 1) {
		return remoteShortMatches[0]!;
	}
	if (remoteShortMatches.length > 1) {
		const candidates = remoteShortMatches
			.map((branch) => branch.fullName)
			.sort()
			.join(", ");
		throw new Error(
			`Ambiguous branch name: ${branchArg}. Use one of: ${candidates}`,
		);
	}

	throw new Error(`Branch not found: ${branchArg}`);
}
