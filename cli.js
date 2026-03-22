#!/usr/bin/env node
import { intro, outro, text, select, confirm, isCancel, cancel, spinner, log } from "@clack/prompts";
import { Command } from "commander";
import chalk from "chalk";
import { run_init } from "./init.js";

const program = new Command();

program
  .name("symphony-box")
  .description("Set up Symphony on an Upstash Box for a GitHub repo")
  .option("--upstash-box-api-key <key>", "Upstash Box API key")
  .option("--openai-api-key <key>", "OpenAI API key")
  .option("--linear-api-key <key>", "Linear API key")
  .option("--github-token <token>", "GitHub token")
  .option("--repo-url <url>", "GitHub repo URL (skip selection)")
  .option("--project-name <name>", "Linear project name (skip selection)")
  .parse(process.argv);

const opts = program.opts();

function checkCancel(result) {
  if (isCancel(result)) {
    cancel("Cancelled.");
    process.exit(0);
  }
  return result;
}

async function promptText(message, envKey, flagValue, placeholder) {
  const value = flagValue ?? process.env[envKey];
  if (value) return value;
  return checkCancel(
    await text({ message, placeholder, validate: (v) => (v ? undefined : "Required") })
  );
}

async function pickRepo(githubToken) {
  const fixed = opts.repoUrl ?? process.env.REPO_URL;
  if (fixed) return { repoUrl: fixed, repoName: fixed.split("/").pop().replace(/\.git$/, "") };

  const s = spinner();
  s.start("Fetching your GitHub repos...");
  const res = await fetch("https://api.github.com/user/repos?per_page=100&sort=updated", {
    headers: { Authorization: `Bearer ${githubToken}`, Accept: "application/vnd.github+json" },
  });
  const repos = await res.json();
  s.stop("Repos loaded");

  const selected = checkCancel(
    await select({
      message: "Select a GitHub repo",
      options: repos.map((r) => ({
        value: { repoUrl: r.clone_url, repoName: r.name },
        label: r.full_name,
        hint: r.private ? "private" : "public",
      })),
    })
  );
  return selected;
}

async function pickLinearProject(linearApiKey) {
  const fixed = opts.projectName ?? process.env.LINEAR_PROJECT_NAME;
  if (fixed) return fixed;

  const s = spinner();
  s.start("Fetching your Linear projects...");
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: linearApiKey },
    body: JSON.stringify({ query: "{ projects { nodes { name } } }" }),
  });
  const json = await res.json();
  s.stop("Projects loaded");

  return checkCancel(
    await select({
      message: "Select a Linear project",
      options: json.data.projects.nodes.map((p) => ({ value: p.name, label: p.name })),
    })
  );
}

async function main() {
  intro(chalk.cyan("Symphony Box Setup"));

  const upstashBoxApiKey = await promptText("Upstash Box API key", "UPSTASH_BOX_API_KEY", opts.upstashBoxApiKey);
  const openaiApiKey = await promptText("OpenAI API key", "OPENAI_API_KEY", opts.openaiApiKey, "sk-...");
  const linearApiKey = await promptText("Linear API key", "LINEAR_API_KEY", opts.linearApiKey, "lin_api_...");
  const githubToken = await promptText("GitHub token (requires read/write access for contents and pull requests)", "GITHUB_TOKEN", opts.githubToken, "ghp_...");

  const { repoUrl, repoName } = await pickRepo(githubToken);
  const linearProjectName = await pickLinearProject(linearApiKey);

  const s = spinner();
  s.start("Starting...");

  try {
    const { boxId, stream } = await run_init(
      { upstashBoxApiKey, openaiApiKey, linearApiKey, githubToken, repoUrl, repoName, linearProjectName },
      {
        onStep: (_step, message) => s.message(message),
        onMissingStates: async (missing) => {
          s.stop();
          const names = missing.map((s) => `  • ${s.name}`).join("\n");
          const ok = checkCancel(
            await confirm({
              message: `These workflow states are missing and required by Symphony:\n${names}\n  Create them?`,
            })
          );
          s.start();
          return ok;
        },
      }
    );

    s.stop("Done");

    // Stream Symphony output until disconnected
    try {
      for await (const chunk of stream) {
        if (chunk.type === "output") process.stdout.write(chunk.data);
      }
    } catch {
      // Stream disconnected — Symphony keeps running on the box
    }

    outro(chalk.green("Symphony is running!") + `\n\n  Box ID: ${chalk.bold(boxId)}`);
  } catch (err) {
    s.stop("Failed");
    log.error(chalk.red(err.message));
    process.exit(1);
  }
}

main();
