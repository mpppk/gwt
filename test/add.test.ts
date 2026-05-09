import { describe, expect, test } from "bun:test";
import { type PullRequestSelectionItem, runAddCommand } from "../src/add.ts";
import type { BranchItem, WorktreeInfo } from "../src/git.ts";
import type { PullRequestItem } from "../src/github.ts";
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
	const remoteName =
		overrides.remoteName ??
		(kind === "remote" ? name.split("/")[0] : undefined);

	return {
		display: name,
		fullName: name,
		kind,
		localName,
		remoteName,
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
		addNewWorktree: (
			targetPath: string,
			branchName: string,
		) => Promise<ReturnType<typeof result>>;
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
		addNewWorktree: async () => result(),
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

describe("runAddCommand --new mode", () => {
	test("does not require fzf when creating a new branch with a branch arg", async () => {
		const io = createBufferedIO();
		const commands: string[] = [];

		const exitCode = await runAddCommand({
			branchArg: "feature/new-local",
			createNewBranch: true,
			io,
			deps: createDeps({
				assertCommand: async (cmd) => {
					commands.push(cmd);
				},
				listBranches: async () => [],
			}),
		});

		expect(exitCode).toBe(0);
		expect(commands).toEqual(["git"]);
	});

	test("requires fzf when creating a new branch without a branch arg", async () => {
		const io = createBufferedIO();
		const commands: string[] = [];

		const exitCode = await runAddCommand({
			createNewBranch: true,
			io,
			deps: createDeps({
				assertCommand: async (cmd) => {
					commands.push(cmd);
				},
				listBranches: async () => [],
			}),
			inputBranchName: async () => "feature/new-interactive",
		});

		expect(exitCode).toBe(0);
		expect(commands).toContain("fzf");
	});

	test("creates a new local branch from current HEAD when no remote matches", async () => {
		const io = createBufferedIO();
		let addNewCall:
			| {
					branchName: string;
					targetPath: string;
			  }
			| undefined;

		const exitCode = await runAddCommand({
			branchArg: "feature/new-local",
			createNewBranch: true,
			io,
			deps: createDeps({
				addNewWorktree: async (targetPath, branchName) => {
					addNewCall = { branchName, targetPath };
					return result();
				},
				listBranches: async () => [],
			}),
		});

		expect(exitCode).toBe(0);
		expect(addNewCall).toEqual({
			branchName: "feature/new-local",
			targetPath: "/repo.worktrees/feature-new-local",
		});
		expect(io.readStdout().trim()).toBe("/repo.worktrees/feature-new-local");
	});

	test("tracks a unique remote branch for short names", async () => {
		const io = createBufferedIO();
		let addTrackedCall:
			| {
					localBranchName: string;
					remoteBranchName: string;
					targetPath: string;
			  }
			| undefined;

		const exitCode = await runAddCommand({
			branchArg: "feature/new-remote",
			createNewBranch: true,
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
				listBranches: async () => [
					makeBranch("remote", "origin/feature/new-remote"),
				],
			}),
		});

		expect(exitCode).toBe(0);
		expect(addTrackedCall).toEqual({
			localBranchName: "feature/new-remote",
			remoteBranchName: "origin/feature/new-remote",
			targetPath: "/repo.worktrees/feature-new-remote",
		});
	});

	test("fails when the local branch already exists", async () => {
		const io = createBufferedIO();

		try {
			await runAddCommand({
				branchArg: "feature/existing",
				createNewBranch: true,
				io,
				deps: createDeps({
					listBranches: async () => [makeBranch("local", "feature/existing")],
				}),
			});
			throw new Error("Expected runAddCommand to throw.");
		} catch (error) {
			expect(error instanceof Error ? error.message : String(error)).toBe(
				"Local branch already exists: feature/existing",
			);
		}
	});

	test("fails when short-name remote matches are ambiguous", async () => {
		const io = createBufferedIO();

		try {
			await runAddCommand({
				branchArg: "feature/topic",
				createNewBranch: true,
				io,
				deps: createDeps({
					listBranches: async () => [
						makeBranch("remote", "origin/feature/topic"),
						makeBranch("remote", "upstream/feature/topic"),
					],
				}),
			});
			throw new Error("Expected runAddCommand to throw.");
		} catch (error) {
			expect(error instanceof Error ? error.message : String(error)).toContain(
				"Ambiguous branch name: feature/topic",
			);
		}
	});

	test("tracks an explicitly specified remote branch", async () => {
		const io = createBufferedIO();
		let addTrackedCall:
			| {
					localBranchName: string;
					remoteBranchName: string;
					targetPath: string;
			  }
			| undefined;

		const exitCode = await runAddCommand({
			branchArg: "origin/feature/explicit",
			createNewBranch: true,
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
				listBranches: async () => [
					makeBranch("remote", "origin/main"),
					makeBranch("remote", "origin/feature/explicit"),
				],
			}),
		});

		expect(exitCode).toBe(0);
		expect(addTrackedCall).toEqual({
			localBranchName: "feature/explicit",
			remoteBranchName: "origin/feature/explicit",
			targetPath: "/repo.worktrees/feature-explicit",
		});
	});

	test("fails when the explicitly specified remote branch does not exist", async () => {
		const io = createBufferedIO();

		try {
			await runAddCommand({
				branchArg: "origin/feature/missing",
				createNewBranch: true,
				io,
				deps: createDeps({
					listBranches: async () => [makeBranch("remote", "origin/main")],
				}),
			});
			throw new Error("Expected runAddCommand to throw.");
		} catch (error) {
			expect(error instanceof Error ? error.message : String(error)).toBe(
				"Remote branch not found: origin/feature/missing",
			);
		}
	});

	test("interactively inputs branch name when no branchArg is given", async () => {
		const io = createBufferedIO();
		let addNewCall:
			| {
					branchName: string;
					targetPath: string;
			  }
			| undefined;

		const exitCode = await runAddCommand({
			createNewBranch: true,
			io,
			deps: createDeps({
				addNewWorktree: async (targetPath, branchName) => {
					addNewCall = { branchName, targetPath };
					return result();
				},
				listBranches: async () => [],
			}),
			inputBranchName: async () => "feature/interactive-new",
		});

		expect(exitCode).toBe(0);
		expect(addNewCall).toEqual({
			branchName: "feature/interactive-new",
			targetPath: "/repo.worktrees/feature-interactive-new",
		});
		expect(io.readStdout().trim()).toBe("/repo.worktrees/feature-interactive-new");
	});

	test("returns 130 when interactive branch name input is cancelled", async () => {
		const io = createBufferedIO();

		const exitCode = await runAddCommand({
			createNewBranch: true,
			io,
			deps: createDeps(),
			inputBranchName: async () => null,
		});

		expect(exitCode).toBe(130);
	});
});
