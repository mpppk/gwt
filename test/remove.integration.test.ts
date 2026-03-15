import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { makeTempDir, removeTempDir, runCommand } from "./helpers.ts";

const tempDirs: string[] = [];
const script = resolve(import.meta.dir, "..", "index.ts");

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		removeTempDir(dir);
	}
});

describe("gwt remove integration", () => {
	test("removes a clean linked worktree and deletes its branch", () => {
		const sandbox = makeTempDir("gwt-remove-clean-");
		tempDirs.push(sandbox);

		const workspace = join(sandbox, "workspace");
		const worktreePath = join(sandbox, "feature-clean");

		setupLocalRepo(workspace);
		runCommand(["git", "-C", workspace, "branch", "feature/clean"]);
		runCommand(["git", "-C", workspace, "worktree", "add", worktreePath, "feature/clean"]);
		const expectedPath = realpathSync(worktreePath);

		const result = runCommand([process.execPath, "run", script, "remove"], {
			check: false,
			cwd: workspace,
			env: createFzfEnv(sandbox, "feature/clean"),
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout.trim()).toBe(expectedPath);
		expect(existsSync(worktreePath)).toBe(false);
		expect(branchExists(workspace, "feature/clean")).toBe(false);
	});

	test("keeps the worktree when dirty removal is rejected", () => {
		const sandbox = makeTempDir("gwt-remove-dirty-");
		tempDirs.push(sandbox);

		const workspace = join(sandbox, "workspace");
		const worktreePath = join(sandbox, "feature-dirty");

		setupLocalRepo(workspace);
		runCommand(["git", "-C", workspace, "branch", "feature/dirty"]);
		runCommand(["git", "-C", workspace, "worktree", "add", worktreePath, "feature/dirty"]);
		writeFileSync(join(worktreePath, "notes.txt"), "dirty\n");

		const result = runCommand([process.execPath, "run", script, "remove"], {
			check: false,
			cwd: workspace,
			env: createFzfEnv(sandbox, "feature/dirty"),
			stdin: "n\n",
		});

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("Remove it anyway?");
		expect(result.stderr).toContain("Removal aborted.");
		expect(existsSync(worktreePath)).toBe(true);
		expect(branchExists(workspace, "feature/dirty")).toBe(true);
	});

	test("prompts before removing a worktree with unpushed commits", () => {
		const sandbox = makeTempDir("gwt-remove-ahead-");
		tempDirs.push(sandbox);

		const remote = join(sandbox, "remote.git");
		const seed = join(sandbox, "seed");
		const workspace = join(sandbox, "workspace");
		const worktreePath = join(sandbox, "feature-ahead");

		runCommand(["git", "init", "--bare", remote]);
		runCommand(["git", "clone", remote, seed]);
		runCommand(["git", "-C", seed, "config", "user.name", "Test User"]);
		runCommand(["git", "-C", seed, "config", "user.email", "test@example.com"]);
		runCommand(["git", "-C", seed, "switch", "-c", "main"]);
		writeFileSync(join(seed, "README.md"), "seed\n");
		runCommand(["git", "-C", seed, "add", "README.md"]);
		runCommand(["git", "-C", seed, "commit", "-m", "initial commit"]);
		runCommand(["git", "-C", seed, "push", "-u", "origin", "main"]);
		runCommand(["git", "-C", seed, "switch", "-c", "feature/ahead"]);
		writeFileSync(join(seed, "feature.txt"), "remote branch\n");
		runCommand(["git", "-C", seed, "add", "feature.txt"]);
		runCommand(["git", "-C", seed, "commit", "-m", "add feature branch"]);
		runCommand(["git", "-C", seed, "push", "-u", "origin", "feature/ahead"]);

		runCommand(["git", "clone", "-b", "main", remote, workspace]);
		runCommand(["git", "-C", workspace, "config", "user.name", "Test User"]);
		runCommand(["git", "-C", workspace, "config", "user.email", "test@example.com"]);
		runCommand([
			"git",
			"-C",
			workspace,
			"worktree",
			"add",
			"--track",
			"-b",
			"feature/ahead",
			worktreePath,
			"origin/feature/ahead",
		]);
		writeFileSync(join(worktreePath, "ahead.txt"), "ahead\n");
		runCommand(["git", "-C", worktreePath, "add", "ahead.txt"]);
		runCommand(["git", "-C", worktreePath, "commit", "-m", "ahead commit"]);

		const result = runCommand([process.execPath, "run", script, "remove"], {
			check: false,
			cwd: workspace,
			env: createFzfEnv(sandbox, "feature/ahead"),
			stdin: "n\n",
		});

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("unpushed commit");
		expect(existsSync(worktreePath)).toBe(true);
		expect(branchExists(workspace, "feature/ahead")).toBe(true);
	});

	test("keeps the branch when safe branch deletion fails", () => {
		const sandbox = makeTempDir("gwt-remove-unmerged-");
		tempDirs.push(sandbox);

		const workspace = join(sandbox, "workspace");
		const worktreePath = join(sandbox, "feature-unmerged");

		setupLocalRepo(workspace);
		runCommand(["git", "-C", workspace, "branch", "feature/unmerged"]);
		runCommand([
			"git",
			"-C",
			workspace,
			"worktree",
			"add",
			worktreePath,
			"feature/unmerged",
		]);
		writeFileSync(join(worktreePath, "unmerged.txt"), "branch commit\n");
		runCommand(["git", "-C", worktreePath, "add", "unmerged.txt"]);
		runCommand(["git", "-C", worktreePath, "commit", "-m", "unmerged work"]);
		const expectedPath = realpathSync(worktreePath);

		const result = runCommand([process.execPath, "run", script, "remove"], {
			check: false,
			cwd: workspace,
			env: createFzfEnv(sandbox, "feature/unmerged"),
		});

		expect(result.exitCode).toBe(1);
		expect(result.stdout.trim()).toBe(expectedPath);
		expect(result.stderr).toContain("kept branch feature/unmerged");
		expect(existsSync(worktreePath)).toBe(false);
		expect(branchExists(workspace, "feature/unmerged")).toBe(true);
	});
});

function setupLocalRepo(workspace: string) {
	runCommand(["git", "init", workspace]);
	runCommand(["git", "-C", workspace, "config", "user.name", "Test User"]);
	runCommand(["git", "-C", workspace, "config", "user.email", "test@example.com"]);
	writeFileSync(join(workspace, "README.md"), "workspace\n");
	runCommand(["git", "-C", workspace, "add", "README.md"]);
	runCommand(["git", "-C", workspace, "commit", "-m", "initial commit"]);
	runCommand(["git", "-C", workspace, "branch", "-M", "main"]);
}

function branchExists(repoPath: string, branchName: string) {
	return (
		runCommand(
			[
				"git",
				"-C",
				repoPath,
				"show-ref",
				"--verify",
				"--quiet",
				`refs/heads/${branchName}`,
			],
			{ check: false },
		).exitCode === 0
	);
}

function createFzfEnv(sandbox: string, query: string) {
	const binDir = join(sandbox, "bin");
	mkdirSync(binDir, { recursive: true });

	const fzfPath = join(binDir, "fzf");
	writeFileSync(
		fzfPath,
		[
			"#!/bin/sh",
			'if [ -n "$GWT_FZF_QUERY" ]; then',
			'  grep -F "$GWT_FZF_QUERY" | head -n 1',
			"else",
			"  head -n 1",
			"fi",
			"",
		].join("\n"),
	);
	chmodSync(fzfPath, 0o755);

	return {
		...process.env,
		GWT_FZF_QUERY: query,
		PATH: `${binDir}:${process.env.PATH ?? ""}`,
	};
}
