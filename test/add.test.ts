import { describe, expect, test } from "bun:test";
import type { PullRequestItem } from "../src/github.ts";
import type { BranchItem, WorktreeInfo } from "../src/git.ts";
import { runAddCommand, type PullRequestSelectionItem } from "../src/add.ts";
import { createBufferedIO } from "./helpers.ts";

const encoder = new TextEncoder();

function result(exitCode = 0, stdout = "", stderr = "") {
	return {
		exitCode,
		stdout: encoder.encode(stdout),
		stderr: encoder.encode(stderr),
	};
}

function makeBranch(
	kind: BranchItem["kind"],
	name: string,
	overrides: Partial<BranchItem> = {},
): BranchItem {
	const localName =
		overrides.localName ??
		(kind === "remote" ? name.split("/").slice(1).join("/") : name);

	return {
		display: name,
		fullName: name,
		kind,
		localName,
		shortName: kind === "remote" ? localName : name,
		...overrides,
	};
}

function makePullRequest(
	headRefName: string,
	overrides: Partial<PullRequestItem> = {},
): PullRequestItem {
	return {
		authorLogin: "octocat",
		headRefName,
		number: 123,
		title: "PR title",
		updatedAt: "2026-03-16T00:00:00Z",
		...overrides,
	};
}

function createDeps(
	overrides: Partial<{
		addTrackedWorktree: (
			targetPath: string,
			localBranchName: string,
			remoteBranchName: string,
		) => Promise<ReturnType<typeof result>>;
		addWorktree: (
			targetPath: string,
			branchName: string,
		) => Promise<ReturnType<typeof result>>;
		assertCommand: (cmd: string) => Promise<void>;
		assertGitRepo: () => Promise<void>;
		ensureParentDir: (targetPath: string) => Promise<void>;
		fetchRemoteBranch: (
			remoteName: string,
			branchName: string,
		) => Promise<ReturnType<typeof result>>;
		getMainWorktreeRoot: () => Promise<string>;
		listBranches: () => Promise<BranchItem[]>;
		listPullRequests: () => Promise<PullRequestItem[]>;
		listWorktrees: () => Promise<WorktreeInfo[]>;
		localBranchExists: (name: string) => Promise<boolean>;
	}> = {},
) {
	return {
		addTrackedWorktree: async () => result(),
		addWorktree: async () => result(),
		assertCommand: async () => {},
		assertGitRepo: async () => {},
		ensureParentDir: async () => {},
		fetchRemoteBranch: async () => result(),
		getMainWorktreeRoot: async () => "/repo",
		listBranches: async () => [makeBranch("remote", "origin/feature/pr-123")],
		listPullRequests: async () => [makePullRequest("feature/pr-123")],
		listWorktrees: async () => [],
		localBranchExists: async () => false,
		...overrides,
	};
}

describe("runAddCommand PR mode", () => {
	test("requires gh and fzf in PR mode", async () => {
		const io = createBufferedIO();
		const commands: string[] = [];

		const exitCode = await runAddCommand({
			io,
			deps: createDeps({
				assertCommand: async (cmd) => {
					commands.push(cmd);
				},
				localBranchExists: async () => true,
			}),
			selectPullRequest: async (items) => items[0] ?? null,
			usePullRequests: true,
		});

		expect(exitCode).toBe(0);
		expect(commands).toEqual(["git", "fzf", "gh"]);
	});

	test("shows existing and new worktree status in PR display", async () => {
		const io = createBufferedIO();
		let capturedItems: PullRequestSelectionItem[] = [];

		const exitCode = await runAddCommand({
			io,
			deps: createDeps({
				listPullRequests: async () => [
					makePullRequest("feature/pr-existing", { number: 1 }),
					makePullRequest("feature/pr-new", { number: 2 }),
				],
				listWorktrees: async () => [
					{
						branch: "refs/heads/feature/pr-existing",
						path: "/repo.worktrees/feature-pr-existing",
					},
				],
			}),
			selectPullRequest: async (items) => {
				capturedItems = items;
				return null;
			},
			usePullRequests: true,
		});

		expect(exitCode).toBe(130);
		expect(capturedItems[0]?.display.startsWith("●  ")).toBe(true);
		expect(capturedItems[1]?.display.startsWith("○  ")).toBe(true);
	});

	test("reuses local branches first in PR mode", async () => {
		const io = createBufferedIO();
		let addWorktreeCall:
			| {
					branchName: string;
					targetPath: string;
			  }
			| undefined;
		let fetchCalls = 0;

		const exitCode = await runAddCommand({
			io,
			deps: createDeps({
				addWorktree: async (targetPath, branchName) => {
					addWorktreeCall = { branchName, targetPath };
					return result();
				},
				fetchRemoteBranch: async () => {
					fetchCalls += 1;
					return result();
				},
				listBranches: async () => [
					makeBranch("remote", "origin/feature/pr-123"),
					makeBranch("local", "feature/pr-123"),
				],
				localBranchExists: async () => true,
			}),
			selectPullRequest: async (items) => items[0] ?? null,
			usePullRequests: true,
		});

		expect(exitCode).toBe(0);
		expect(fetchCalls).toBe(0);
		expect(addWorktreeCall?.branchName).toBe("feature/pr-123");
	});

	test("fetches the selected PR branch when it is missing locally", async () => {
		const io = createBufferedIO();
		let fetchCall:
			| {
					branchName: string;
					remoteName: string;
			  }
			| undefined;
		let addTrackedCall:
			| {
					localBranchName: string;
					remoteBranchName: string;
					targetPath: string;
			  }
			| undefined;
		let branchListCalls = 0;

		const exitCode = await runAddCommand({
			io,
			deps: createDeps({
				addTrackedWorktree: async (
					targetPath,
					localBranchName,
					remoteBranchName,
				) => {
					addTrackedCall = {
						localBranchName,
						remoteBranchName,
						targetPath,
					};
					return result();
				},
				fetchRemoteBranch: async (remoteName, branchName) => {
					fetchCall = { branchName, remoteName };
					return result();
				},
				listBranches: async () => {
					branchListCalls += 1;
					return branchListCalls === 1
						? []
						: [makeBranch("remote", "origin/feature/pr-123")];
				},
			}),
			selectPullRequest: async (items) => items[0] ?? null,
			usePullRequests: true,
		});

		expect(exitCode).toBe(0);
		expect(fetchCall).toEqual({
			branchName: "feature/pr-123",
			remoteName: "origin",
		});
		expect(addTrackedCall?.localBranchName).toBe("feature/pr-123");
		expect(addTrackedCall?.remoteBranchName).toBe("origin/feature/pr-123");
	});

	test("fails when the selected PR branch is still missing after fetch", async () => {
		const io = createBufferedIO();

		try {
			await runAddCommand({
				io,
				deps: createDeps({
					listBranches: async () => [],
				}),
				selectPullRequest: async (items) => items[0] ?? null,
				usePullRequests: true,
			});
			throw new Error("Expected runAddCommand to throw.");
		} catch (error) {
			expect(error instanceof Error ? error.message : String(error)).toBe(
				"Selected PR branch not found after fetch: feature/pr-123",
			);
		}
	});
});
