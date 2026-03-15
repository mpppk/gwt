import { printAddHelp, runAddCommand, type RunAddCommandOptions } from "./add.ts";
import { defaultIO, writeLine, type CliIO, type CliWriter } from "./io.ts";

type ParsedCliAction =
	| { type: "main-help" }
	| { type: "add-help" }
	| { type: "run-add"; branchArg?: string };

type HelpTarget = "main" | "add";

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
};

export async function runCli(
	argv: string[],
	{ io = defaultIO, runAdd = runAddCommand }: RunCliOptions = {},
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
			case "run-add":
				return await runAdd({ branchArg: action.branchArg, io });
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
			throw new UsageError("Unknown subcommand: remove", "main");
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

function isHelpFlag(value: string) {
	return value === "-h" || value === "--help";
}

function printHelpForTarget(target: HelpTarget, writer: CliWriter) {
	if (target === "add") {
		printAddHelp(writer);
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
	writeLine(writer, "  gwt --help");
	writeLine(writer);
	writeLine(writer, "Commands:");
	writeLine(writer, "  add     Create or reuse a worktree for a branch.");
	writeLine(writer);
	writeLine(writer, "Notes:");
	writeLine(writer, "  Running bare `gwt` is equivalent to `gwt add`.");
	writeLine(writer);
	writeLine(writer, "Requirements:");
	writeLine(writer, "  - git");
	writeLine(writer, "  - fzf (interactive add only)");
	writeLine(writer, "  - bun");
}

function formatError(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}
