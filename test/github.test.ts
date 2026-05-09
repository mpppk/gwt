import { describe, expect, test } from "bun:test";
import { formatPullRequestDisplay, parsePullRequests } from "../src/github.ts";

describe("parsePullRequests", () => {
	test("filters cross-repository pull requests", () => {
		const raw = JSON.stringify([
			{
				author: { login: "octocat" },
				headRefName: "feature/same-repo",
				isCrossRepository: false,
				number: 1,
				title: "Same repo PR",
				updatedAt: "2026-03-16T00:00:00Z",
			},
			{
				author: { login: "forker" },
				headRefName: "feature/fork",
				isCrossRepository: true,
				number: 2,
				title: "Fork PR",
				updatedAt: "2026-03-16T01:00:00Z",
			},
		]);

		expect(parsePullRequests(raw)).toEqual([
			{
				authorLogin: "octocat",
				headRefName: "feature/same-repo",
				number: 1,
				title: "Same repo PR",
				updatedAt: "2026-03-16T00:00:00Z",
			},
		]);
	});
});

describe("formatPullRequestDisplay", () => {
	test("includes worktree status in the formatted line", () => {
		const display = formatPullRequestDisplay(
			{
				authorLogin: "octocat",
				headRefName: "feature/pr-123",
				number: 123,
				title: "Add PR mode",
				updatedAt: "2026-03-16T00:00:00Z",
			},
			"●",
		);

		expect(display.startsWith("●  ")).toBe(true);
		expect(display).toContain("#123");
		expect(display).toContain("Add PR mode");
		expect(display).toContain("@octocat");
		expect(display).toContain("feature/pr-123");
		expect(display).toContain("2026-03-16T00:00:00Z");
		expect(display.indexOf("#123")).toBeLessThan(
			display.indexOf("Add PR mode"),
		);
		expect(display.indexOf("Add PR mode")).toBeLessThan(
			display.indexOf("@octocat"),
		);
		expect(display.indexOf("@octocat")).toBeLessThan(
			display.indexOf("feature/pr-123"),
		);
		expect(display.indexOf("feature/pr-123")).toBeLessThan(
			display.indexOf("2026-03-16T00:00:00Z"),
		);
	});
});
