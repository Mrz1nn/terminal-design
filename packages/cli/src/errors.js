// Exit codes shared by every `td` command:
//   0  success
//   1  the command ran and failed (problem found, download failed, user cancelled...)
//   2  usage error: unknown command or subcommand, missing or invalid argument
export const EXIT = Object.freeze({ OK: 0, FAIL: 1, USAGE: 2 });

/** Thrown by commands for usage errors. `td` prints the message plus a help hint and exits 2. */
export class UsageError extends Error {
  constructor(message, { command } = {}) {
    super(message);
    this.name = 'UsageError';
    this.command = command;
  }
}

export const unknownSubcommand = (command, sub) => new UsageError(`subcomando desconhecido: td ${command} ${sub}`, { command });
