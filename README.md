# gwt

`gwt` creates and removes Git worktrees from the current repository.

## Requirements

- `git`
- `bun`
- `fzf` for interactive branch and worktree selection
- `gh` for GitHub PR selection in `gwt add --pr`

## Usage

```bash
gwt
gwt add
gwt add <branch>
gwt add --new <branch>
gwt add --pr
gwt remove
gwt --help
```

- `gwt` is an alias for `gwt add`
- `gwt add` opens `fzf` and creates or reuses a worktree
- `gwt add <branch>` resolves the branch without opening `fzf`
- `gwt add --new <branch>` creates a new local branch and worktree
- `gwt add --pr` lists open same-repo PRs from `gh pr list`, shows whether a
  worktree already exists for each PR branch, and creates or reuses the
  selected branch's worktree
- `gwt remove` opens `fzf`, removes a linked worktree, and deletes its branch
- `gwt remove` asks for confirmation when the selected worktree has local changes
  or unpushed commits

Branch resolution order for `gwt add <branch>`:

1. exact local branch name
2. exact remote branch name such as `origin/feature/foo`
3. a unique remote branch whose short name matches

PR mode notes for `gwt add --pr`:

1. only open same-repo PRs are shown
2. `●` means a worktree already exists and `○` means it does not
3. branch resolution stays local-first
4. if the selected PR branch is missing, `origin/<headRefName>` is fetched once

`gwt add --new <branch>` notes:

1. `--new` is exclusive with `--pr`
2. if the local branch already exists, the command fails
3. if `<branch>` is an explicit remote name like `origin/feature/x`, that remote
   branch must exist and will be tracked as local `feature/x`
4. for short names, a unique remote match is tracked; ambiguous matches fail
5. if no matching remote branch exists, the new branch is created from current HEAD

## Development

```bash
bun install
bun run lint:type
bun test
```
