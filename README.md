# symphony-box

CLI to set up [Symphony](https://github.com/openai/symphony) (OpenAI Codex orchestrator) on an [Upstash Box](https://upstash.com/docs/box/overall/getstarted) for a GitHub repo connected to a Linear project.

## What it does

1. Checks your Linear project for required workflow states and creates any that are missing
2. Creates an Upstash Box with your credentials
3. Installs system dependencies, Codex, and mise on the box
4. Clones your repo and writes a `WORKFLOW.md` config for Symphony
5. Clones and builds Symphony on the box
6. Starts Symphony

Once running, Symphony polls your Linear project and autonomously works on tickets using Codex.

## Usage

```bash
npx symphony-box
```

You will be prompted for:

- **Upstash Box API key** — from [console.upstash.com](https://console.upstash.com)
- **OpenAI API key** — used by Codex to work on tickets
- **Linear API key** — to poll and update tickets
- **GitHub token** — requires read/write access for contents and pull requests

Then select a GitHub repo and a Linear project from the list.

## Flags

All prompts can be skipped via flags or environment variables:

| Flag                    | Env var               | Description                          |
| ----------------------- | --------------------- | ------------------------------------ |
| `--upstash-box-api-key` | `UPSTASH_BOX_API_KEY` | Upstash Box API key                  |
| `--openai-api-key`      | `OPENAI_API_KEY`      | OpenAI API key                       |
| `--linear-api-key`      | `LINEAR_API_KEY`      | Linear API key                       |
| `--github-token`        | `GITHUB_TOKEN`        | GitHub token                         |
| `--repo-url`            | `REPO_URL`            | GitHub repo URL (skip selection)     |
| `--project-name`        | `LINEAR_PROJECT_NAME` | Linear project name (skip selection) |

## Required Linear workflow states

Symphony requires these states to exist in your Linear team:

- **Rework** — reviewer requested changes
- **Human Review** — PR is ready for human approval
- **Merging** — approved; Symphony will merge the PR

The CLI will detect missing states and offer to create them.

## License

MIT
