# gwt

`gwt` creates and removes Git worktrees from the current repository.

## Requirements

- `git`
- `bun`
- `fzf` for interactive branch and worktree selection

## Usage

```bash
gwt
gwt add
gwt add <branch>
gwt remove
gwt --help
```

- `gwt` is an alias for `gwt add`
- `gwt add` opens `fzf` and creates or reuses a worktree
- `gwt add <branch>` resolves the branch without opening `fzf`
- `gwt remove` opens `fzf`, removes a linked worktree, and deletes its branch
- `gwt remove` asks for confirmation when the selected worktree has local changes
  or unpushed commits

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
