import { afterEach, describe, expect, test } from "bun:test";
import { realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildWorktreePath } from "../src/git.ts";
import { makeTempDir, removeTempDir } from "./helpers.ts";

const tempDirs: string[] = [];

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

		run(["git", "init", "--bare", remote]);
		run(["git", "clone", remote, seed]);
		run(["git", "-C", seed, "config", "user.name", "Test User"]);
		run(["git", "-C", seed, "config", "user.email", "test@example.com"]);
		run(["git", "-C", seed, "switch", "-c", "main"]);
		writeFileSync(join(seed, "README.md"), "seed\n");
		run(["git", "-C", seed, "add", "README.md"]);
		run(["git", "-C", seed, "commit", "-m", "initial commit"]);
		run(["git", "-C", seed, "push", "-u", "origin", "main"]);
		run(["git", "-C", seed, "switch", "-c", "feature/remote-only"]);
		writeFileSync(join(seed, "feature.txt"), "remote branch\n");
		run(["git", "-C", seed, "add", "feature.txt"]);
		run(["git", "-C", seed, "commit", "-m", "add remote-only branch"]);
		run(["git", "-C", seed, "push", "-u", "origin", "feature/remote-only"]);

		run(["git", "clone", "-b", "main", remote, workspace]);

		const script = resolve(import.meta.dir, "..", "index.ts");
		const expectedPath = buildWorktreePath(
			realpathSync(workspace),
			"feature/remote-only",
		);

		const first = run(
			[process.execPath, "run", script, "add", "feature/remote-only"],
			workspace,
		);
		expect(first.exitCode).toBe(0);
		expect(first.stdout.trim()).toBe(expectedPath);
		expect(run(["git", "-C", expectedPath, "rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim()).toBe(
			"feature/remote-only",
		);

		const second = run(
			[process.execPath, "run", script, "add", "feature/remote-only"],
			workspace,
		);
		expect(second.exitCode).toBe(0);
		expect(second.stdout.trim()).toBe(expectedPath);
	});
});

function run(cmd: string[], cwd?: string) {
	const proc = Bun.spawnSync(cmd, {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});

	const stdout = new TextDecoder().decode(proc.stdout);
	const stderr = new TextDecoder().decode(proc.stderr);

	if (proc.exitCode !== 0) {
		throw new Error(
			[`Command failed: ${cmd.join(" ")}`, stdout, stderr].filter(Boolean).join("\n"),
		);
	}

	return {
		exitCode: proc.exitCode,
		stdout,
		stderr,
	};
}
