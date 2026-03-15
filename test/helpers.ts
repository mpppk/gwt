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

function readChunks(chunks: Array<string | Uint8Array>) {
	return chunks
		.map((chunk) =>
			typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
		)
		.join("");
}
