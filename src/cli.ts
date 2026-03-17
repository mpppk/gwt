import { printAddHelp, runAddCommand, type RunAddCommandOptions } from "./add.ts";
import {
	printRemoveHelp,
	runRemoveCommand,
	type RunRemoveCommandOptions,
} from "./remove.ts";
import { defaultIO, writeLine, type CliIO, type CliWriter } from "./io.ts";

type ParsedCliAction =
	| { type: "main-help" }
	| { type: "add-help" }
	| { type: "remove-help" }
	| {
			type: "run-add";
			branchArg?: string;
			createNewBranch?: boolean;
			usePullRequests?: boolean;
	  }
	| { type: "run-remove" };

type HelpTarget = "main" | "add" | "remove";

class UsageError extends Error {
	constructor(
		message: string,
		readonly helpTarget: HelpTarget,
	) {
		super(message);
		this.name = "UsageError";
	}
}

export type RunCliOptions = {
	io?: CliIO;
	runAdd?: (options: RunAddCommandOptions) => Promise<number>;
	runRemove?: (options: RunRemoveCommandOptions) => Promise<number>;
};

export async function runCli(
	argv: string[],
	{
		io = defaultIO,
		runAdd = runAddCommand,
		runRemove = runRemoveCommand,
	}: RunCliOptions = {},
): Promise<number> {
	try {
		const action = parseCliArgs(argv);

		switch (action.type) {
			case "main-help":
				printMainHelp(io.stdout);
				return 0;
			case "add-help":
				printAddHelp(io.stdout);
				return 0;
			case "remove-help":
				printRemoveHelp(io.stdout);
				return 0;
			case "run-add":
				return await runAdd({
					branchArg: action.branchArg,
					createNewBranch: action.createNewBranch,
					io,
					usePullRequests: action.usePullRequests,
				});
			case "run-remove":
				return await runRemove({ io });
		}
	} catch (error) {
		if (error instanceof UsageError) {
			writeLine(io.stderr, error.message);
			writeLine(io.stderr);
			printHelpForTarget(error.helpTarget, io.stderr);
			return 1;
		}

		writeLine(io.stderr, formatError(error));
		return 1;
	}
}

export function parseCliArgs(argv: string[]): ParsedCliAction {
	const [first, ...rest] = argv;

	if (!first) {
		return { type: "run-add" };
	}

	if (isHelpFlag(first)) {
		if (rest.length > 0) {
			throw new UsageError(`Unexpected argument: ${rest[0]}`, "main");
		}
		return { type: "main-help" };
	}

	switch (first) {
		case "add":
			return parseAddArgs(rest);
		case "remove":
			return parseRemoveArgs(rest);
		default:
			if (first.startsWith("-")) {
				throw new UsageError(`Unknown option: ${first}`, "main");
			}
			throw new UsageError(`Unknown subcommand: ${first}`, "main");
	}
}

function parseAddArgs(args: string[]): ParsedCliAction {
	if (args.length === 0) {
		return { type: "run-add" };
	}

	const onlyArg = args[0];
	if (args.length === 1 && onlyArg && isHelpFlag(onlyArg)) {
		return { type: "add-help" };
	}

	if (args.includes("--new") && args.includes("--pr")) {
		throw new UsageError("Cannot combine --new with --pr.", "add");
	}

	if (args[0] === "--new") {
		const branchArg = args[1];
		const extraArg = args[2];

		if (!branchArg) {
			throw new UsageError("Missing branch name for gwt add --new.", "add");
		}
		if (branchArg.startsWith("-")) {
			throw new UsageError(`Unknown option: ${branchArg}`, "add");
		}
		if (extraArg) {
			if (extraArg.startsWith("-")) {
				throw new UsageError(`Unknown option: ${extraArg}`, "add");
			}
			throw new UsageError(`Too many arguments for gwt add: ${extraArg}`, "add");
		}

		return { type: "run-add", branchArg, createNewBranch: true };
	}

	if (args.includes("--new")) {
		throw new UsageError("Unknown option: --new", "add");
	}

	if (args.length === 1 && args[0] === "--pr") {
		return { type: "run-add", usePullRequests: true };
	}

	if (args.includes("--pr")) {
		const extraArg = args.find((arg) => arg !== "--pr");
		if (extraArg) {
			if (extraArg.startsWith("-")) {
				throw new UsageError(`Unknown option: ${extraArg}`, "add");
			}
			throw new UsageError(`Too many arguments for gwt add: ${extraArg}`, "add");
		}
		throw new UsageError("Unknown option: --pr", "add");
	}

	const [branchArg, extraArg] = args;
	if (!branchArg) {
		return { type: "run-add" };
	}

	if (branchArg.startsWith("-")) {
		throw new UsageError(`Unknown option: ${branchArg}`, "add");
	}

	if (extraArg) {
		throw new UsageError(`Too many arguments for gwt add: ${extraArg}`, "add");
	}

	return { type: "run-add", branchArg };
}

function parseRemoveArgs(args: string[]): ParsedCliAction {
	if (args.length === 0) {
		return { type: "run-remove" };
	}

	const onlyArg = args[0];
	if (args.length === 1 && onlyArg && isHelpFlag(onlyArg)) {
		return { type: "remove-help" };
	}

	if (!onlyArg) {
		return { type: "run-remove" };
	}

	if (onlyArg.startsWith("-")) {
		throw new UsageError(`Unknown option: ${onlyArg}`, "remove");
	}

	throw new UsageError(`Too many arguments for gwt remove: ${onlyArg}`, "remove");
}

function isHelpFlag(value: string) {
	return value === "-h" || value === "--help";
}

function printHelpForTarget(target: HelpTarget, writer: CliWriter) {
	if (target === "add") {
		printAddHelp(writer);
		return;
	}
	if (target === "remove") {
		printRemoveHelp(writer);
		return;
	}
	printMainHelp(writer);
}

export function printMainHelp(writer: CliWriter) {
	writeLine(writer, "gwt");
	writeLine(writer);
	writeLine(writer, "Manage Git worktrees from the current repository.");
	writeLine(writer);
	writeLine(writer, "Usage:");
	writeLine(writer, "  gwt");
	writeLine(writer, "  gwt add [branch]");
	writeLine(writer, "  gwt add --new <branch>");
	writeLine(writer, "  gwt add --pr");
	writeLine(writer, "  gwt remove");
	writeLine(writer, "  gwt --help");
	writeLine(writer);
	writeLine(writer, "Commands:");
	writeLine(writer, "  add     Create, reuse, or start a new branch worktree.");
	writeLine(writer, "  remove  Remove a linked worktree and delete its branch.");
	writeLine(writer);
	writeLine(writer, "Notes:");
	writeLine(writer, "  Running bare `gwt` is equivalent to `gwt add`.");
	writeLine(writer);
	writeLine(writer, "Requirements:");
	writeLine(writer, "  - git");
	writeLine(writer, "  - fzf (interactive add/remove)");
	writeLine(writer, "  - gh (PR mode only)");
	writeLine(writer, "  - bun");
}

function formatError(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}
