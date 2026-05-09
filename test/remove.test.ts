import { describe, expect, test } from "bun:test";
import type { WorktreeInfo } from "../src/git.ts";
import { runRemoveCommand } from "../src/remove.ts";
import { createBufferedIO } from "./helpers.ts";

const encoder = new TextEncoder();

function result(exitCode = 0, stdout = "", stderr = "") {
	return {
		exitCode,
		stdout: encoder.encode(stdout),
		stderr: encoder.encode(stderr),
	};
}

function createDeps(
	overrides: Partial<{
		assertCommand: (cmd: string) => Promise<void>;
		assertGitRepo: () => Promise<void>;
		deleteLocalBranch: (
			branchName: string,
		) => Promise<ReturnType<typeof result>>;
		getAheadCount: (path: string) => Promise<number>;
		getCurrentWorktreeRoot: () => Promise<string>;
		getMainWorktreeRoot: () => Promise<string>;
		isWorktreeDirty: (path: string) => Promise<boolean>;
		listWorktrees: () => Promise<WorktreeInfo[]>;
		removeWorktree: (
			path: string,
			force?: boolean,
		) => Promise<ReturnType<typeof result>>;
	}> = {},
) {
	return {
		assertCommand: async () => {},
		assertGitRepo: async () => {},
		deleteLocalBranch: async () => result(),
		getAheadCount: async () => 0,
		getCurrentWorktreeRoot: async () => "/repo",
		getMainWorktreeRoot: async () => "/repo",
		isWorktreeDirty: async () => false,
		listWorktrees: async () =>
			[
				{ path: "/repo", branch: "refs/heads/main" },
				{
					path: "/repo.worktrees/feature-topic",
					branch: "refs/heads/feature/topic",
				},
			] satisfies WorktreeInfo[],
		removeWorktree: async () => result(),
		...overrides,
	};
}

describe("runRemoveCommand", () => {
	test("returns 130 when selection is cancelled", async () => {
		const io = createBufferedIO();

		const exitCode = await runRemoveCommand({
			io,
			deps: createDeps(),
			selectWorktree: async () => null,
		});

		expect(exitCode).toBe(130);
	});

	test("removes a clean worktree without confirmation", async () => {
		const io = createBufferedIO();
		let confirmCalls = 0;
		let removeCall: { force: boolean; path: string } | null = null;
		let deleteBranchName: string | null = null;

		const exitCode = await runRemoveCommand({
			io,
			confirmRemoval: async () => {
				confirmCalls += 1;
				return true;
			},
			deps: createDeps({
				deleteLocalBranch: async (branchName) => {
					deleteBranchName = branchName;
					return result();
				},
				removeWorktree: async (path, force = false) => {
					removeCall = { force, path };
					return result();
				},
			}),
			selectWorktree: async (items) => items[0] ?? null,
		});

		expect(exitCode).toBe(0);
		expect(confirmCalls).toBe(0);
		if (!removeCall) {
			throw new Error("Expected removeWorktree to be called.");
		}
		if (!deleteBranchName) {
			throw new Error("Expected deleteLocalBranch to be called.");
		}
		const recordedRemoveCall = removeCall as {
			force: boolean;
			path: string;
		};
		const recordedDeleteBranchName = deleteBranchName as string;
		expect(recordedRemoveCall.force).toBe(false);
		expect(recordedRemoveCall.path).toBe("/repo.worktrees/feature-topic");
		expect(recordedDeleteBranchName).toBe("feature/topic");
		expect(io.readStdout()).toContain("/repo.worktrees/feature-topic");
	});

	test("aborts when the selected dirty worktree is not confirmed", async () => {
		const io = createBufferedIO();
		let removeCalls = 0;

		const exitCode = await runRemoveCommand({
			io,
			confirmRemoval: async ({ risk }) => {
				expect(risk.isDirty).toBe(true);
				return false;
			},
			deps: createDeps({
				isWorktreeDirty: async () => true,
				removeWorktree: async () => {
					removeCalls += 1;
					return result();
				},
			}),
			selectWorktree: async (items) => items[0] ?? null,
		});

		expect(exitCode).toBe(1);
		expect(removeCalls).toBe(0);
		expect(io.readStderr()).toContain("Removal aborted.");
	});

	test("forces removal after confirming ahead worktrees", async () => {
		const io = createBufferedIO();
		let removeCall: { force: boolean; path: string } | null = null;

		const exitCode = await runRemoveCommand({
			io,
			confirmRemoval: async ({ risk }) => {
				expect(risk.aheadCount).toBe(2);
				return true;
			},
			deps: createDeps({
				getAheadCount: async () => 2,
				removeWorktree: async (path, force = false) => {
					removeCall = { force, path };
					return result();
				},
			}),
			selectWorktree: async (items) => items[0] ?? null,
		});

		expect(exitCode).toBe(0);
		if (!removeCall) {
			throw new Error("Expected removeWorktree to be called.");
		}
		const recordedRemoveCall = removeCall as {
			force: boolean;
			path: string;
		};
		expect(recordedRemoveCall.force).toBe(true);
		expect(recordedRemoveCall.path).toBe("/repo.worktrees/feature-topic");
	});

	test("returns 1 when branch deletion fails after removing the worktree", async () => {
		const io = createBufferedIO();

		const exitCode = await runRemoveCommand({
			io,
			deps: createDeps({
				deleteLocalBranch: async () =>
					result(1, "", "error: branch is not fully merged\n"),
			}),
			selectWorktree: async (items) => items[0] ?? null,
		});

		expect(exitCode).toBe(1);
		expect(io.readStdout()).toContain("/repo.worktrees/feature-topic");
		expect(io.readStderr()).toContain("kept branch feature/topic");
	});
});
