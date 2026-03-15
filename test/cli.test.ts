import { describe, expect, test } from "bun:test";
import { parseCliArgs, runCli } from "../src/cli.ts";
import { createBufferedIO } from "./helpers.ts";

describe("parseCliArgs", () => {
	test("bare gwt aliases to add", () => {
		expect(parseCliArgs([])).toEqual({ type: "run-add" });
	});

	test("gwt add branch keeps the branch argument", () => {
		expect(parseCliArgs(["add", "feature/topic"])).toEqual({
			type: "run-add",
			branchArg: "feature/topic",
		});
	});

	test("gwt add --help resolves to add help", () => {
		expect(parseCliArgs(["add", "--help"])).toEqual({ type: "add-help" });
	});

	test("gwt add --pr resolves to PR mode", () => {
		expect(parseCliArgs(["add", "--pr"])).toEqual({
			type: "run-add",
			usePullRequests: true,
		});
	});

	test("gwt remove resolves to the remove command", () => {
		expect(parseCliArgs(["remove"])).toEqual({ type: "run-remove" });
	});

	test("gwt remove --help resolves to remove help", () => {
		expect(parseCliArgs(["remove", "--help"])).toEqual({
			type: "remove-help",
		});
	});
});

describe("runCli", () => {
	test("dispatches bare gwt to add", async () => {
		const io = createBufferedIO();
		const calls: Array<string | undefined> = [];

		const exitCode = await runCli([], {
			io,
			runAdd: async ({ branchArg }) => {
				calls.push(branchArg);
				return 0;
			},
		});

		expect(exitCode).toBe(0);
		expect(calls).toEqual([undefined]);
	});

	test("prints add help without running the command", async () => {
		const io = createBufferedIO();
		let called = false;

		const exitCode = await runCli(["add", "--help"], {
			io,
			runAdd: async () => {
				called = true;
				return 0;
			},
		});

		expect(exitCode).toBe(0);
		expect(called).toBe(false);
		expect(io.readStdout()).toContain("gwt add <branch>");
		expect(io.readStdout()).toContain("gwt add --pr");
	});

	test("dispatches gwt add --pr to PR mode", async () => {
		const io = createBufferedIO();
		const calls: Array<boolean | undefined> = [];

		const exitCode = await runCli(["add", "--pr"], {
			io,
			runAdd: async ({ usePullRequests }) => {
				calls.push(usePullRequests);
				return 0;
			},
		});

		expect(exitCode).toBe(0);
		expect(calls).toEqual([true]);
	});

	test("dispatches gwt remove to the remove command", async () => {
		const io = createBufferedIO();
		let called = false;

		const exitCode = await runCli(["remove"], {
			io,
			runRemove: async () => {
				called = true;
				return 0;
			},
		});

		expect(exitCode).toBe(0);
		expect(called).toBe(true);
	});

	test("fails on unknown subcommands", async () => {
		const io = createBufferedIO();

		const exitCode = await runCli(["wat"], { io });

		expect(exitCode).toBe(1);
		expect(io.readStderr()).toContain("Unknown subcommand: wat");
		expect(io.readStderr()).toContain("Usage:");
	});

	test("fails when add receives extra arguments", async () => {
		const io = createBufferedIO();

		const exitCode = await runCli(["add", "topic", "extra"], { io });

		expect(exitCode).toBe(1);
		expect(io.readStderr()).toContain("Too many arguments for gwt add");
		expect(io.readStderr()).toContain("gwt add <branch>");
	});

	test("fails when add receives --pr and a branch argument", async () => {
		const io = createBufferedIO();

		const exitCode = await runCli(["add", "--pr", "topic"], { io });

		expect(exitCode).toBe(1);
		expect(io.readStderr()).toContain("Too many arguments for gwt add");
		expect(io.readStderr()).toContain("gwt add --pr");
	});

	test("fails when remove receives extra arguments", async () => {
		const io = createBufferedIO();

		const exitCode = await runCli(["remove", "topic"], { io });

		expect(exitCode).toBe(1);
		expect(io.readStderr()).toContain("Too many arguments for gwt remove");
		expect(io.readStderr()).toContain("gwt remove");
	});
});
