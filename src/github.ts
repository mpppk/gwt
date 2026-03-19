import { $ } from "bun";

$.throws(true);

type GitHubPullRequestAuthor = {
	login?: string;
} | null;

type GitHubPullRequestJson = {
	author?: GitHubPullRequestAuthor;
	headRefName: string;
	isCrossRepository: boolean;
	number: number;
	title: string;
	updatedAt: string;
};

export type PullRequestItem = {
	authorLogin: string;
	headRefName: string;
	number: number;
	title: string;
	updatedAt: string;
};

const GH_PR_JSON_FIELDS =
	"number,title,headRefName,author,updatedAt,isCrossRepository";
const GH_PR_LIST_LIMIT = 200;

export async function listPullRequests(): Promise<PullRequestItem[]> {
	const raw = (
		await $`gh pr list --state open --limit ${GH_PR_LIST_LIMIT} --json ${GH_PR_JSON_FIELDS}`.text()
	).trim();
	if (!raw) {
		return [];
	}

	return parsePullRequests(raw);
}

export function parsePullRequests(raw: string): PullRequestItem[] {
	const parsed = JSON.parse(raw) as GitHubPullRequestJson[];

	return parsed
		.filter((pullRequest) => !pullRequest.isCrossRepository)
		.map((pullRequest) => ({
			authorLogin: pullRequest.author?.login ?? "unknown",
			headRefName: pullRequest.headRefName,
			number: pullRequest.number,
			title: pullRequest.title,
			updatedAt: pullRequest.updatedAt,
		}));
}

export function formatPullRequestDisplay(
	pullRequest: PullRequestItem,
	worktreeStatus: string,
) {
	return [
		worktreeStatus,
		`#${String(pullRequest.number).padEnd(6)}`,
		pullRequest.title.padEnd(40),
		`@${pullRequest.authorLogin}`.padEnd(18),
		pullRequest.headRefName.padEnd(32),
		pullRequest.updatedAt,
	].join("  ");
}
