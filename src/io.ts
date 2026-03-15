export type CliWriter = {
	write(chunk: string | Uint8Array): void;
};

export type CliIO = {
	stdout: CliWriter;
	stderr: CliWriter;
};

export const defaultIO: CliIO = {
	stdout: process.stdout,
	stderr: process.stderr,
};

export function writeLine(writer: CliWriter, line = "") {
	writer.write(`${line}\n`);
}
