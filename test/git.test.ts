import { describe, expect, test } from "bun:test";
import {
	type BranchItem,
	buildWorktreePath,
	resolveBranchArgument,
	sanitizeWorktreeDirName,
} from "../src/git.ts";

function makeBranch(
	kind: BranchItem["kind"],
	name: string,
	overrides: Partial<BranchItem> = {},
): BranchItem {
	const localName =
		overrides.localName ??
		(kind === "remote" ? name.split("/").slice(1).join("/") : name);

	return {
		kind,
		shortName: kind === "remote" ? localName : name,
		fullName: name,
		localName,
		display: name,
		...overrides,
	};
}

describe("resolveBranchArgument", () => {
	test("prefers an exact local branch match", () => {
		const local = makeBranch("local", "feature/topic");
		const remote = makeBranch("remote", "origin/feature/topic");

		expect(resolveBranchArgument("feature/topic", [remote, local])).toBe(local);
	});

	test("accepts an exact remote branch match", () => {
		const remote = makeBranch("remote", "origin/feature/topic");

		expect(resolveBranchArgument("origin/feature/topic", [remote])).toBe(
			remote,
		);
	});

	test("accepts a unique remote short-name match", () => {
		const remote = makeBranch("remote", "origin/feature/topic");

		expect(resolveBranchArgument("feature/topic", [remote])).toBe(remote);
	});

	test("rejects ambiguous remote short-name matches", () => {
		const origin = makeBranch("remote", "origin/feature/topic");
		const upstream = makeBranch("remote", "upstream/feature/topic");

		expect(() =>
			resolveBranchArgument("feature/topic", [origin, upstream]),
		).toThrow("Ambiguous branch name: feature/topic");
	});

	test("rejects unknown branch names", () => {
		expect(() => resolveBranchArgument("missing", [])).toThrow(
			"Branch not found: missing",
		);
	});
});

describe("worktree path helpers", () => {
	test("sanitizes invalid branch characters", () => {
		expect(sanitizeWorktreeDirName("feature:topic/question*mark")).toBe(
			"feature-topic-question-mark",
		);
	});

	test("protects reserved Windows basenames", () => {
		expect(sanitizeWorktreeDirName("con")).toBe("_con");
	});

	test("builds the .worktrees path next to the repo", () => {
		expect(buildWorktreePath("/tmp/example-repo", "feature/topic")).toBe(
			"/tmp/example-repo.worktrees/feature-topic",
		);
	});
});
