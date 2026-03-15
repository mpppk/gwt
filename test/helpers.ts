import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import type { CliIO } from "../src/io.ts";

type BufferedIO = CliIO & {
	readStdout(): string;
	readStderr(): string;
};

export function createBufferedIO(): BufferedIO {
	const stdout: Array<string | Uint8Array> = [];
	const stderr: Array<string | Uint8Array> = [];

	return {
		stdout: {
			write(chunk) {
				stdout.push(chunk);
			},
		},
		stderr: {
			write(chunk) {
				stderr.push(chunk);
			},
		},
		readStdout() {
			return readChunks(stdout);
		},
		readStderr() {
			return readChunks(stderr);
		},
	};
}

export function makeTempDir(prefix: string) {
	return mkdtempSync(join(tmpdir(), prefix));
}

export function removeTempDir(path: string) {
	rmSync(path, { recursive: true, force: true });
}

export type RunCommandResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

export function runCommand(
	cmd: string[],
	options: {
		check?: boolean;
		cwd?: string;
		env?: Record<string, string | undefined>;
		stdin?: string;
	} = {},
): RunCommandResult {
	const { check = true, cwd, env, stdin } = options;
	const [command, ...args] = cmd;
	if (!command) {
		throw new Error("Command is required.");
	}

	const proc = spawnSync(command, args, {
		cwd,
		env,
		input: stdin,
		encoding: "utf8",
	});

	const stdout = proc.stdout ?? "";
	const stderr = proc.stderr ?? "";
	const exitCode = proc.status ?? 1;

	if (check && exitCode !== 0) {
		throw new Error(
			[`Command failed: ${cmd.join(" ")}`, stdout, stderr]
				.filter(Boolean)
				.join("\n"),
		);
	}

	return {
		exitCode,
		stdout,
		stderr,
	};
}

function readChunks(chunks: Array<string | Uint8Array>) {
	return chunks
		.map((chunk) =>
			typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
		)
		.join("");
}
