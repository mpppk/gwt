import { afterEach, describe, expect, test } from "bun:test";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	realpathSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { buildWorktreePath } from "../src/git.ts";
import { makeTempDir, removeTempDir, runCommand } from "./helpers.ts";

const tempDirs: string[] = [];
const script = resolve(import.meta.dir, "..", "index.ts");

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		removeTempDir(dir);
	}
});

describe("gwt add integration", () => {
	test("creates and reuses a worktree for a remote-only branch", () => {
		const sandbox = makeTempDir("gwt-add-integration-");
		tempDirs.push(sandbox);

		const remote = join(sandbox, "remote.git");
		const seed = join(sandbox, "seed");
		const workspace = join(sandbox, "workspace");

		runCommand(["git", "init", "--bare", remote]);
		runCommand(["git", "clone", remote, seed]);
		runCommand(["git", "-C", seed, "config", "user.name", "Test User"]);
		runCommand(["git", "-C", seed, "config", "user.email", "test@example.com"]);
		runCommand(["git", "-C", seed, "switch", "-c", "main"]);
		writeFileSync(join(seed, "README.md"), "seed\n");
		runCommand(["git", "-C", seed, "add", "README.md"]);
		runCommand(["git", "-C", seed, "commit", "-m", "initial commit"]);
		runCommand(["git", "-C", seed, "push", "-u", "origin", "main"]);
		runCommand(["git", "-C", seed, "switch", "-c", "feature/remote-only"]);
		writeFileSync(join(seed, "feature.txt"), "remote branch\n");
		runCommand(["git", "-C", seed, "add", "feature.txt"]);
		runCommand(["git", "-C", seed, "commit", "-m", "add remote-only branch"]);
		runCommand(["git", "-C", seed, "push", "-u", "origin", "feature/remote-only"]);

		runCommand(["git", "clone", "-b", "main", remote, workspace]);

		const expectedPath = buildWorktreePath(
			realpathSync(workspace),
			"feature/remote-only",
		);

		const first = runCommand(
			[process.execPath, "run", script, "add", "feature/remote-only"],
			{ cwd: workspace },
		);
		expect(first.exitCode).toBe(0);
		expect(first.stdout.trim()).toBe(expectedPath);
		expect(
			runCommand([
				"git",
				"-C",
				expectedPath,
				"rev-parse",
				"--abbrev-ref",
				"HEAD",
			]).stdout.trim(),
		).toBe("feature/remote-only");

		const second = runCommand(
			[process.execPath, "run", script, "add", "feature/remote-only"],
			{ cwd: workspace },
		);
		expect(second.exitCode).toBe(0);
		expect(second.stdout.trim()).toBe(expectedPath);
	});

	test("creates a worktree for a local branch without contacting remotes", () => {
		const sandbox = makeTempDir("gwt-add-local-integration-");
		tempDirs.push(sandbox);

		const workspace = join(sandbox, "workspace");
		runCommand(["git", "init", workspace]);
		runCommand(["git", "-C", workspace, "config", "user.name", "Test User"]);
		runCommand(["git", "-C", workspace, "config", "user.email", "test@example.com"]);
		writeFileSync(join(workspace, "README.md"), "workspace\n");
		runCommand(["git", "-C", workspace, "add", "README.md"]);
		runCommand(["git", "-C", workspace, "commit", "-m", "initial commit"]);
		runCommand(["git", "-C", workspace, "branch", "-M", "main"]);
		runCommand(["git", "-C", workspace, "branch", "feature/local-only"]);
		runCommand([
			"git",
			"-C",
			workspace,
			"remote",
			"add",
			"origin",
			"https://example.invalid/repo.git",
		]);

		const expectedPath = buildWorktreePath(
			realpathSync(workspace),
			"feature/local-only",
		);

		const result = runCommand(
			[process.execPath, "run", script, "add", "feature/local-only"],
			{ cwd: workspace },
		);
		expect(result.exitCode).toBe(0);
		expect(result.stdout.trim()).toBe(expectedPath);
		expect(
			runCommand([
				"git",
				"-C",
				expectedPath,
				"rev-parse",
				"--abbrev-ref",
				"HEAD",
			]).stdout.trim(),
		).toBe("feature/local-only");
	});

	test("creates a new branch and worktree from current HEAD with --new", () => {
		const sandbox = makeTempDir("gwt-add-new-local-integration-");
		tempDirs.push(sandbox);

		const workspace = join(sandbox, "workspace");
		runCommand(["git", "init", workspace]);
		runCommand(["git", "-C", workspace, "config", "user.name", "Test User"]);
		runCommand(["git", "-C", workspace, "config", "user.email", "test@example.com"]);
		writeFileSync(join(workspace, "README.md"), "workspace\n");
		runCommand(["git", "-C", workspace, "add", "README.md"]);
		runCommand(["git", "-C", workspace, "commit", "-m", "initial commit"]);
		runCommand(["git", "-C", workspace, "branch", "-M", "main"]);

		const currentHead = runCommand([
			"git",
			"-C",
			workspace,
			"rev-parse",
			"HEAD",
		]).stdout.trim();
		const expectedPath = buildWorktreePath(
			realpathSync(workspace),
			"feature/new-local",
		);

		const result = runCommand(
			[process.execPath, "run", script, "add", "--new", "feature/new-local"],
			{ cwd: workspace },
		);
		expect(result.exitCode).toBe(0);
		expect(result.stdout.trim()).toBe(expectedPath);
		expect(
			runCommand([
				"git",
				"-C",
				expectedPath,
				"rev-parse",
				"--abbrev-ref",
				"HEAD",
			]).stdout.trim(),
		).toBe("feature/new-local");
		expect(
			runCommand(["git", "-C", expectedPath, "rev-parse", "HEAD"]).stdout.trim(),
		).toBe(currentHead);
	});

	test("tracks a unique remote branch when creating with --new", () => {
		const sandbox = makeTempDir("gwt-add-new-remote-integration-");
		tempDirs.push(sandbox);

		const remote = join(sandbox, "remote.git");
		const seed = join(sandbox, "seed");
		const workspace = join(sandbox, "workspace");

		runCommand(["git", "init", "--bare", remote]);
		runCommand(["git", "clone", remote, seed]);
		runCommand(["git", "-C", seed, "config", "user.name", "Test User"]);
		runCommand(["git", "-C", seed, "config", "user.email", "test@example.com"]);
		runCommand(["git", "-C", seed, "switch", "-c", "main"]);
		writeFileSync(join(seed, "README.md"), "seed\n");
		runCommand(["git", "-C", seed, "add", "README.md"]);
		runCommand(["git", "-C", seed, "commit", "-m", "initial commit"]);
		runCommand(["git", "-C", seed, "push", "-u", "origin", "main"]);
		runCommand(["git", "-C", seed, "switch", "-c", "feature/new-remote"]);
		writeFileSync(join(seed, "feature.txt"), "remote branch\n");
		runCommand(["git", "-C", seed, "add", "feature.txt"]);
		runCommand(["git", "-C", seed, "commit", "-m", "add remote branch"]);
		runCommand(["git", "-C", seed, "push", "-u", "origin", "feature/new-remote"]);
		const remoteBranchHead = runCommand([
			"git",
			"-C",
			seed,
			"rev-parse",
			"feature/new-remote",
		]).stdout.trim();

		runCommand(["git", "clone", "-b", "main", remote, workspace]);

		const expectedPath = buildWorktreePath(
			realpathSync(workspace),
			"feature/new-remote",
		);

		const result = runCommand(
			[process.execPath, "run", script, "add", "--new", "feature/new-remote"],
			{ cwd: workspace },
		);
		expect(result.exitCode).toBe(0);
		expect(result.stdout.trim()).toBe(expectedPath);
		expect(
			runCommand([
				"git",
				"-C",
				expectedPath,
				"rev-parse",
				"--abbrev-ref",
				"HEAD",
			]).stdout.trim(),
		).toBe("feature/new-remote");
		expect(
			runCommand(["git", "-C", expectedPath, "rev-parse", "HEAD"]).stdout.trim(),
		).toBe(remoteBranchHead);
		expect(
			runCommand([
				"git",
				"-C",
				expectedPath,
				"rev-parse",
				"--abbrev-ref",
				"--symbolic-full-name",
				"@{upstream}",
			]).stdout.trim(),
		).toBe("origin/feature/new-remote");
	});

	test("fails when --new receives an existing local branch name", () => {
		const sandbox = makeTempDir("gwt-add-new-existing-integration-");
		tempDirs.push(sandbox);

		const workspace = join(sandbox, "workspace");
		runCommand(["git", "init", workspace]);
		runCommand(["git", "-C", workspace, "config", "user.name", "Test User"]);
		runCommand(["git", "-C", workspace, "config", "user.email", "test@example.com"]);
		writeFileSync(join(workspace, "README.md"), "workspace\n");
		runCommand(["git", "-C", workspace, "add", "README.md"]);
		runCommand(["git", "-C", workspace, "commit", "-m", "initial commit"]);
		runCommand(["git", "-C", workspace, "branch", "-M", "main"]);
		runCommand(["git", "-C", workspace, "branch", "feature/existing"]);

		const expectedPath = buildWorktreePath(
			realpathSync(workspace),
			"feature/existing",
		);
		const result = runCommand(
			[process.execPath, "run", script, "add", "--new", "feature/existing"],
			{ check: false, cwd: workspace },
		);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("Local branch already exists: feature/existing");
		expect(existsSync(expectedPath)).toBe(false);
	});

	test("creates a worktree from a same-repo PR and filters out cross-repo PRs", () => {
		const sandbox = makeTempDir("gwt-add-pr-integration-");
		tempDirs.push(sandbox);

		const remote = join(sandbox, "remote.git");
		const seed = join(sandbox, "seed");
		const workspace = join(sandbox, "workspace");
		const capturePath = join(sandbox, "fzf-input.txt");

		runCommand(["git", "init", "--bare", remote]);
		runCommand(["git", "clone", remote, seed]);
		runCommand(["git", "-C", seed, "config", "user.name", "Test User"]);
		runCommand(["git", "-C", seed, "config", "user.email", "test@example.com"]);
		runCommand(["git", "-C", seed, "switch", "-c", "main"]);
		writeFileSync(join(seed, "README.md"), "seed\n");
		runCommand(["git", "-C", seed, "add", "README.md"]);
		runCommand(["git", "-C", seed, "commit", "-m", "initial commit"]);
		runCommand(["git", "-C", seed, "push", "-u", "origin", "main"]);
		runCommand(["git", "clone", "-b", "main", remote, workspace]);
		runCommand(["git", "-C", workspace, "config", "user.name", "Test User"]);
		runCommand(["git", "-C", workspace, "config", "user.email", "test@example.com"]);

		runCommand(["git", "-C", seed, "switch", "-c", "feature/pr-remote"]);
		writeFileSync(join(seed, "pr.txt"), "pr branch\n");
		runCommand(["git", "-C", seed, "add", "pr.txt"]);
		runCommand(["git", "-C", seed, "commit", "-m", "add PR branch"]);
		runCommand(["git", "-C", seed, "push", "-u", "origin", "feature/pr-remote"]);

		writePullRequestJson(join(sandbox, "prs.json"), [
			makePullRequestJson(1, "feature/pr-remote", "Same repo PR", false),
			makePullRequestJson(2, "feature/fork", "Cross repo PR", true),
		]);

		const expectedPath = buildWorktreePath(
			realpathSync(workspace),
			"feature/pr-remote",
		);
		const result = runCommand([process.execPath, "run", script, "add", "--pr"], {
			check: false,
			cwd: workspace,
			env: createPrModeEnv(sandbox, "Same repo PR", capturePath),
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout.trim()).toBe(expectedPath);
		expect(
			runCommand([
				"git",
				"-C",
				expectedPath,
				"rev-parse",
				"--abbrev-ref",
				"HEAD",
			]).stdout.trim(),
		).toBe("feature/pr-remote");

		const fzfInput = readFileSync(capturePath, "utf8");
		expect(fzfInput).toContain("Same repo PR");
		expect(fzfInput).toContain("○  #1");
		expect(fzfInput).not.toContain("Cross repo PR");
	});

	test("returns the existing worktree path for a PR branch and shows it in fzf", () => {
		const sandbox = makeTempDir("gwt-add-pr-existing-");
		tempDirs.push(sandbox);

		const workspace = join(sandbox, "workspace");
		const capturePath = join(sandbox, "fzf-input.txt");

		runCommand(["git", "init", workspace]);
		runCommand(["git", "-C", workspace, "config", "user.name", "Test User"]);
		runCommand(["git", "-C", workspace, "config", "user.email", "test@example.com"]);
		writeFileSync(join(workspace, "README.md"), "workspace\n");
		runCommand(["git", "-C", workspace, "add", "README.md"]);
		runCommand(["git", "-C", workspace, "commit", "-m", "initial commit"]);
		runCommand(["git", "-C", workspace, "branch", "-M", "main"]);
		runCommand(["git", "-C", workspace, "branch", "feature/pr-existing"]);

		const existingPath = join(sandbox, "feature-pr-existing");
		runCommand([
			"git",
			"-C",
			workspace,
			"worktree",
			"add",
			existingPath,
			"feature/pr-existing",
		]);

		writePullRequestJson(join(sandbox, "prs.json"), [
			makePullRequestJson(10, "feature/pr-existing", "Existing worktree PR", false),
		]);

		const result = runCommand([process.execPath, "run", script, "add", "--pr"], {
			check: false,
			cwd: workspace,
			env: createPrModeEnv(sandbox, "Existing worktree PR", capturePath),
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout.trim()).toBe(realpathSync(existingPath));

		const fzfInput = readFileSync(capturePath, "utf8");
		expect(fzfInput).toContain("●  #10");
	});
});

function createPrModeEnv(
	sandbox: string,
	query: string,
	capturePath: string,
) {
	const binDir = join(sandbox, "bin");
	mkdirSync(binDir, { recursive: true });

	const fzfPath = join(binDir, "fzf");
	writeFileSync(
		fzfPath,
		[
			"#!/bin/sh",
			'capture="${GWT_FZF_CAPTURE:-/dev/null}"',
			'cat | tee "$capture" | {',
			'  if [ -n "$GWT_FZF_QUERY" ]; then',
			'    grep -F "$GWT_FZF_QUERY" | head -n 1',
			"  else",
			"    head -n 1",
			"  fi",
			"}",
			"",
		].join("\n"),
	);
	chmodSync(fzfPath, 0o755);

	const ghPath = join(binDir, "gh");
	writeFileSync(
		ghPath,
		[
			"#!/bin/sh",
			'if [ "$1" = "pr" ] && [ "$2" = "list" ]; then',
			'  cat "$GWT_GH_OUTPUT"',
			"  exit 0",
			"fi",
			'echo "unexpected gh args: $@" >&2',
			"exit 1",
			"",
		].join("\n"),
	);
	chmodSync(ghPath, 0o755);

	return {
		...process.env,
		GWT_FZF_CAPTURE: capturePath,
		GWT_FZF_QUERY: query,
		GWT_GH_OUTPUT: join(sandbox, "prs.json"),
		PATH: `${binDir}:${process.env.PATH ?? ""}`,
	};
}

function writePullRequestJson(
	path: string,
	pullRequests: Array<{
		author: { login: string };
		headRefName: string;
		isCrossRepository: boolean;
		number: number;
		title: string;
		updatedAt: string;
	}>,
) {
	writeFileSync(path, JSON.stringify(pullRequests));
}

function makePullRequestJson(
	number: number,
	headRefName: string,
	title: string,
	isCrossRepository: boolean,
) {
	return {
		author: { login: "octocat" },
		headRefName,
		isCrossRepository,
		number,
		title,
		updatedAt: "2026-03-16T00:00:00Z",
	};
}
