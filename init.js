import { Box } from "@upstash/box";
import { buildWorkflow } from "./workflow.js";

const SYMPHONY_URL = "https://github.com/openai/symphony.git";
const MISE = "/home/boxuser/.local/bin/mise";

async function linearQuery(linearApiKey, query, variables) {
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: linearApiKey,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

const REQUIRED_STATES = [
  { name: "Rework", color: "#db6e1f" },
  { name: "Human Review", color: "#da8b0d" },
  { name: "Merging", color: "#0f783c" },
];

async function setupLinear(linearApiKey, projectName, onMissingStates) {
  const data = await linearQuery(
    linearApiKey,
    `{ projects { nodes { name slugId teams { nodes { id } } } } }`,
  );
  const project = data.projects.nodes.find((p) => p.name === projectName);
  if (!project) throw new Error(`Linear project "${projectName}" not found`);

  const teamId = project.teams.nodes[0].id;

  const statesData = await linearQuery(
    linearApiKey,
    `{ workflowStates { nodes { name team { id } } } }`,
  );
  const existing = statesData.workflowStates.nodes
    .filter((s) => s.team?.id === teamId)
    .map((s) => s.name);

  const missing = REQUIRED_STATES.filter((s) => !existing.includes(s.name));

  if (missing.length > 0) {
    const confirmed = await onMissingStates(missing);
    if (!confirmed)
      throw new Error("Aborted: required workflow states not created.");

    for (const state of missing) {
      await linearQuery(
        linearApiKey,
        `mutation($input: WorkflowStateCreateInput!) { workflowStateCreate(input: $input) { success } }`,
        {
          input: {
            teamId,
            name: state.name,
            type: "started",
            color: state.color,
          },
        },
      );
    }
  }

  return { slugId: project.slugId };
}

export async function run_init(
  {
    upstashBoxApiKey,
    openaiApiKey,
    linearApiKey,
    githubToken,
    repoUrl,
    repoName,
    linearProjectName,
  },
  { onStep = () => {}, onMissingStates = async () => true } = {},
) {
  onStep("linear", "Checking Linear project and workflow states...");
  const { slugId } = await setupLinear(
    linearApiKey,
    linearProjectName,
    onMissingStates,
  );

  onStep("workflow", `Building WORKFLOW.md (slug: ${slugId})...`);
  const workflow = buildWorkflow(slugId, repoUrl);

  onStep("box", "Creating Upstash Box...");
  const box = await Box.create({
    apiKey: upstashBoxApiKey,
    runtime: "node",
    git: { token: githubToken },
    env: { LINEAR_API_KEY: linearApiKey, OPENAI_API_KEY: openaiApiKey },
  });

  onStep("deps", `Box ${box.id} — installing system dependencies...`);
  await box.exec.command(
    "sudo apk add --no-cache git github-cli build-base perl bison ncurses-dev openssl-dev libssh-dev unixodbc-dev libxml2-dev",
  );

  onStep("codex", "Installing Codex...");
  await box.exec.command("sudo npm install -g @openai/codex");

  onStep("mise", "Installing mise...");
  await box.exec.command("curl https://mise.run | sh");

  onStep("auth", "Authenticating gh and Codex...");
  await box.exec.command("gh auth setup-git");
  await box.exec.command(`echo "${openaiApiKey}" | codex login --with-api-key`);

  onStep("repo", `Cloning ${repoName} and writing WORKFLOW.md...`);
  await box.exec.command(`git clone ${repoUrl}`);
  await box.files.write({
    path: `/workspace/home/${repoName}/WORKFLOW.md`,
    content: workflow,
  });

  onStep("build", "Cloning and building Symphony (~5 mins)...");
  await box.exec.command(`git clone ${SYMPHONY_URL}`);
  await box.exec.command(
    `cd symphony/elixir && ${MISE} trust && ${MISE} install`,
  );
  await box.exec.command(`cd symphony/elixir && ${MISE} exec -- mix setup`);
  await box.exec.command(`cd symphony/elixir && ${MISE} exec -- mix build`);

  onStep("run", "Starting Symphony...");
  const stream = await box.exec.stream(
    `cd symphony/elixir && ${MISE} exec -- ./bin/symphony /workspace/home/${repoName}/WORKFLOW.md --i-understand-that-this-will-be-running-without-the-usual-guardrails`,
  );

  // Ping the box to keep it alive
  await box.schedule.exec({
    cron: "0 */2 * * *",
    command: ["bash", "-c", "true"],
  });

  return { boxId: box.id, stream };
}
