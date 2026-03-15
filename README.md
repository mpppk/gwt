# gwt

`gwt` fetches branches from the current Git repository and creates a matching
worktree under a sibling `.worktrees` directory.

## Requirements

- `git`
- `bun`
- `fzf` for interactive branch selection

## Usage

```bash
gwt
gwt add
gwt add <branch>
gwt --help
```

- `gwt` is an alias for `gwt add`
- `gwt add` fetches remotes, opens `fzf`, and creates or reuses a worktree
- `gwt add <branch>` resolves the branch without opening `fzf`

Branch resolution order for `gwt add <branch>`:

1. exact local branch name
2. exact remote branch name such as `origin/feature/foo`
3. a unique remote branch whose short name matches

## Development

```bash
bun install
bun run lint:type
bun test
```
