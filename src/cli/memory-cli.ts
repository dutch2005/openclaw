import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Command } from "commander";
import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import { loadConfig } from "../config/config.js";
import { resolveStateDir } from "../config/paths.js";
import { resolveSessionTranscriptsDirForAgent } from "../config/sessions/paths.js";
import { setVerbose } from "../globals.js";
import { getMemorySearchManager, type MemorySearchManagerResult } from "../memory/index.js";
import { listMemoryFiles, normalizeExtraMemoryPaths } from "../memory/internal.js";
import { defaultRuntime } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import { colorize, isRich, theme } from "../terminal/theme.js";
import { shortenHomeInString, shortenHomePath } from "../utils.js";
import { formatErrorMessage, withManager } from "./cli-utils.js";
import { formatHelpExamples } from "./help-format.js";
import { withProgress, withProgressTotals } from "./progress.js";

type MemoryCommandOptions = {
  agent?: string;
  json?: boolean;
  deep?: boolean;
  index?: boolean;
  force?: boolean;
  verbose?: boolean;
};

type MemoryManager = NonNullable<MemorySearchManagerResult["manager"]>;

type MemorySourceName = "memory" | "sessions";

type SourceScan = {
  source: MemorySourceName;
  totalFiles: number | null;
  issues: string[];
};

type MemorySourceScan = {
  sources: SourceScan[];
  totalFiles: number | null;
  issues: string[];
};

function formatSourceLabel(source: string, workspaceDir: string, agentId: string): string {
  if (source === "memory") {
    return shortenHomeInString(
      `memory (MEMORY.md + ${path.join(workspaceDir, "memory")}${path.sep}*.md)`,
    );
  }
  if (source === "sessions") {
    const stateDir = resolveStateDir(process.env, os.homedir);
    return shortenHomeInString(
      `sessions (${path.join(stateDir, "agents", agentId, "sessions")}${path.sep}*.jsonl)`,
    );
  }
  return source;
}

function resolveAgent(cfg: ReturnType<typeof loadConfig>, agent?: string) {
  const trimmed = agent?.trim();
  if (trimmed) {
    return trimmed;
  }
  return resolveDefaultAgentId(cfg);
}

function resolveAgentIds(cfg: ReturnType<typeof loadConfig>, agent?: string): string[] {
  const trimmed = agent?.trim();
  if (trimmed) {
    return [trimmed];
  }
  const list = cfg.agents?.list ?? [];
  if (list.length > 0) {
    return list.map((entry) => entry.id).filter(Boolean);
  }
  return [resolveDefaultAgentId(cfg)];
}

function formatExtraPaths(workspaceDir: string, extraPaths: string[]): string[] {
  return normalizeExtraMemoryPaths(workspaceDir, extraPaths).map((entry) => shortenHomePath(entry));
}

async function checkReadableFile(pathname: string): Promise<{ exists: boolean; issue?: string }> {
  try {
    await fs.access(pathname, fsSync.constants.R_OK);
    return { exists: true };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { exists: false };
    }
    return {
      exists: true,
      issue: `${shortenHomePath(pathname)} not readable (${code ?? "error"})`,
    };
  }
}

async function scanSessionFiles(agentId: string): Promise<SourceScan> {
  const issues: string[] = [];
  const sessionsDir = resolveSessionTranscriptsDirForAgent(agentId);
  try {
    const entries = await fs.readdir(sessionsDir, { withFileTypes: true });
    const totalFiles = entries.filter(
      (entry) => entry.isFile() && entry.name.endsWith(".jsonl"),
    ).length;
    return { source: "sessions", totalFiles, issues };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      issues.push(`sessions directory missing (${shortenHomePath(sessionsDir)})`);
      return { source: "sessions", totalFiles: 0, issues };
    }
    issues.push(
      `sessions directory not accessible (${shortenHomePath(sessionsDir)}): ${code ?? "error"}`,
    );
    return { source: "sessions", totalFiles: null, issues };
  }
}

async function scanMemoryFiles(
  workspaceDir: string,
  extraPaths: string[] = [],
): Promise<SourceScan> {
  const issues: string[] = [];
  const memoryFile = path.join(workspaceDir, "MEMORY.md");
  const altMemoryFile = path.join(workspaceDir, "memory.md");
  const memoryDir = path.join(workspaceDir, "memory");

  const primary = await checkReadableFile(memoryFile);
  const alt = await checkReadableFile(altMemoryFile);
  if (primary.issue) {
    issues.push(primary.issue);
  }
  if (alt.issue) {
    issues.push(alt.issue);
  }

  const resolvedExtraPaths = normalizeExtraMemoryPaths(workspaceDir, extraPaths);
  for (const extraPath of resolvedExtraPaths) {
    try {
      const stat = await fs.lstat(extraPath);
      if (stat.isSymbolicLink()) {
        continue;
      }
      const extraCheck = await checkReadableFile(extraPath);
      if (extraCheck.issue) {
        issues.push(extraCheck.issue);
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        issues.push(`additional memory path missing (${shortenHomePath(extraPath)})`);
      } else {
        issues.push(
          `additional memory path not accessible (${shortenHomePath(extraPath)}): ${code ?? "error"}`,
        );
      }
    }
  }

  let dirReadable: boolean | null = null;
  try {
    await fs.access(memoryDir, fsSync.constants.R_OK);
    dirReadable = true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      issues.push(`memory directory missing (${shortenHomePath(memoryDir)})`);
      dirReadable = false;
    } else {
      issues.push(
        `memory directory not accessible (${shortenHomePath(memoryDir)}): ${code ?? "error"}`,
      );
      dirReadable = null;
    }
  }

  let listed: string[] = [];
  let listedOk = false;
  try {
    listed = await listMemoryFiles(workspaceDir, resolvedExtraPaths);
    listedOk = true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (dirReadable !== null) {
      issues.push(
        `memory directory scan failed (${shortenHomePath(memoryDir)}): ${code ?? "error"}`,
      );
      dirReadable = null;
    }
  }

  let totalFiles: number | null = 0;
  if (dirReadable === null) {
    totalFiles = null;
  } else {
    const files = new Set<string>(listedOk ? listed : []);
    if (!listedOk) {
      if (primary.exists) {
        files.add(memoryFile);
      }
      if (alt.exists) {
        files.add(altMemoryFile);
      }
    }
    totalFiles = files.size;
  }

  if ((totalFiles ?? 0) === 0 && issues.length === 0) {
    issues.push(`no memory files found in ${shortenHomePath(workspaceDir)}`);
  }

  return { source: "memory", totalFiles, issues };
}

async function summarizeQmdIndexArtifact(manager: MemoryManager): Promise<string | null> {
  const status = manager.status?.();
  if (!status || status.backend !== "qmd") {
    return null;
  }
  const dbPath = status.dbPath?.trim();
  if (!dbPath) {
    return null;
  }
  let stat: fsSync.Stats;
  try {
    stat = await fs.stat(dbPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new Error(`QMD index file not found: ${shortenHomePath(dbPath)}`, { cause: err });
    }
    throw new Error(
      `QMD index file check failed: ${shortenHomePath(dbPath)} (${code ?? "error"})`,
      { cause: err },
    );
  }
  if (!stat.isFile() || stat.size <= 0) {
    throw new Error(`QMD index file is empty: ${shortenHomePath(dbPath)}`);
  }
  return `QMD index: ${shortenHomePath(dbPath)} (${stat.size} bytes)`;
}

async function scanMemorySources(params: {
  workspaceDir: string;
  agentId: string;
  sources: MemorySourceName[];
  extraPaths?: string[];
}): Promise<MemorySourceScan> {
  const scans: SourceScan[] = [];
  const extraPaths = params.extraPaths ?? [];
  for (const source of params.sources) {
    if (source === "memory") {
      scans.push(await scanMemoryFiles(params.workspaceDir, extraPaths));
    }
    if (source === "sessions") {
      scans.push(await scanSessionFiles(params.agentId));
    }
  }
  const issues = scans.flatMap((scan) => scan.issues);
  const totals = scans.map((scan) => scan.totalFiles);
  const numericTotals = totals.filter((total): total is number => total !== null);
  const totalFiles = totals.some((total) => total === null)
    ? null
    : numericTotals.reduce((sum, total) => sum + total, 0);
  return { sources: scans, totalFiles, issues };
}

export async function runMemoryStatus(opts: MemoryCommandOptions) {
  setVerbose(Boolean(opts.verbose));
  const cfg = loadConfig();
  const agentIds = resolveAgentIds(cfg, opts.agent);
  const allResults: Array<{
    agentId: string;
    status: ReturnType<MemoryManager["status"]>;
    embeddingProbe?: Awaited<ReturnType<MemoryManager["probeEmbeddingAvailability"]>>;
    indexError?: string;
    scan?: MemorySourceScan;
  }> = [];

  for (const agentId of agentIds) {
    const managerPurpose = opts.index ? "default" : "status";
    await withManager<MemoryManager>({
      getManager: () => getMemorySearchManager({ cfg, agentId, purpose: managerPurpose }),
      onMissing: (error) => defaultRuntime.log(error ?? "Memory search disabled."),
      onCloseError: (err) =>
        defaultRuntime.error(`Memory manager close failed: ${formatErrorMessage(err)}`),
      close: async (manager) => {
        await manager.close?.();
      },
      run: async (manager) => {
        const deep = Boolean(opts.deep || opts.index);
        let embeddingProbe:
          | Awaited<ReturnType<typeof manager.probeEmbeddingAvailability>>
          | undefined;
        let indexError: string | undefined;
        const syncFn = manager.sync ? manager.sync.bind(manager) : undefined;
        if (deep) {
          await withProgress({ label: "Checking memory…", total: 2 }, async (progress) => {
            progress.setLabel("Probing vector…");
            await manager.probeVectorAvailability();
            progress.tick();
            progress.setLabel("Probing embeddings…");
            embeddingProbe = await manager.probeEmbeddingAvailability();
            progress.tick();
          });
          if (opts.index && syncFn) {
            await withProgressTotals(
              {
                label: "Indexing memory…",
                total: 0,
                fallback: opts.verbose ? "line" : undefined,
              },
              async (update, progress) => {
                try {
                  await syncFn({
                    reason: "cli",
                    force: Boolean(opts.force),
                    progress: (syncUpdate) => {
                      update({
                        completed: syncUpdate.completed,
                        total: syncUpdate.total,
                        label: syncUpdate.label,
                      });
                      if (syncUpdate.label) {
                        progress.setLabel(syncUpdate.label);
                      }
                    },
                  });
                } catch (err) {
                  indexError = formatErrorMessage(err);
                  defaultRuntime.error(`Memory index failed: ${indexError}`);
                  process.exitCode = 1;
                }
              },
            );
          } else if (opts.index && !syncFn) {
            defaultRuntime.log("Memory backend does not support manual reindex.");
          }
        } else {
          await manager.probeVectorAvailability();
        }
        const status = manager.status();
        const sources = (
          status.sources?.length ? status.sources : ["memory"]
        ) as MemorySourceName[];
        const workspaceDir = status.workspaceDir;
        const scan = workspaceDir
          ? await scanMemorySources({
              workspaceDir,
              agentId,
              sources,
              extraPaths: status.extraPaths,
            })
          : undefined;
        allResults.push({ agentId, status, embeddingProbe, indexError, scan });
      },
    });
  }

  if (opts.json) {
    defaultRuntime.log(JSON.stringify(allResults, null, 2));
    return;
  }

  const rich = isRich();
  const heading = (text: string) => colorize(rich, theme.heading, text);
  const muted = (text: string) => colorize(rich, theme.muted, text);
  const info = (text: string) => colorize(rich, theme.info, text);
  const success = (text: string) => colorize(rich, theme.success, text);
  const warn = (text: string) => colorize(rich, theme.warn, text);
  const accent = (text: string) => colorize(rich, theme.accent, text);
  const label = (text: string) => muted(`${text}:`);

  for (const result of allResults) {
    const { agentId, status, embeddingProbe, indexError, scan } = result;
    const filesIndexed = status.files ?? 0;
    const chunksIndexed = status.chunks ?? 0;
    const totalFiles = scan?.totalFiles ?? null;
    const indexedLabel =
      totalFiles === null
        ? `${filesIndexed}/? files · ${chunksIndexed} chunks`
        : `${filesIndexed}/${totalFiles} files · ${chunksIndexed} chunks`;
    if (opts.index) {
      const line = indexError ? `Memory index failed: ${indexError}` : "Memory index complete.";
      defaultRuntime.log(line);
    }
    const requestedProvider = status.requestedProvider ?? status.provider;
    const modelLabel = status.model ?? status.provider;
    const storePath = status.dbPath ? shortenHomePath(status.dbPath) : "<unknown>";
    const workspacePath = status.workspaceDir ? shortenHomePath(status.workspaceDir) : "<unknown>";
    const sourceList = status.sources?.length ? status.sources.join(", ") : null;
    const extraPaths = status.workspaceDir
      ? formatExtraPaths(status.workspaceDir, status.extraPaths ?? [])
      : [];
    const lines = [
      `${heading("Memory Search")} ${muted(`(${agentId})`)}`,
      `${label("Provider")} ${info(status.provider)} ${muted(`(requested: ${requestedProvider})`)}`,
      `${label("Model")} ${info(modelLabel)}`,
      sourceList ? `${label("Sources")} ${info(sourceList)}` : null,
      extraPaths.length ? `${label("Extra paths")} ${info(extraPaths.join(", "))}` : null,
      `${label("Indexed")} ${success(indexedLabel)}`,
      `${label("Dirty")} ${status.dirty ? warn("yes") : muted("no")}`,
      `${label("Store")} ${info(storePath)}`,
      `${label("Workspace")} ${info(workspacePath)}`,
    ].filter(Boolean) as string[];
    if (embeddingProbe) {
      const state = embeddingProbe.ok ? "ready" : "unavailable";
      const stateColor = embeddingProbe.ok ? theme.success : theme.warn;
      lines.push(`${label("Embeddings")} ${colorize(rich, stateColor, state)}`);
      if (embeddingProbe.error) {
        lines.push(`${label("Embeddings error")} ${warn(embeddingProbe.error)}`);
      }
    }
    if (status.sourceCounts?.length) {
      lines.push(label("By source"));
      for (const entry of status.sourceCounts) {
        const total = scan?.sources?.find(
          (scanEntry) => scanEntry.source === entry.source,
        )?.totalFiles;
        const counts =
          total === null
            ? `${entry.files}/? files · ${entry.chunks} chunks`
            : `${entry.files}/${total} files · ${entry.chunks} chunks`;
        lines.push(`  ${accent(entry.source)} ${muted("·")} ${muted(counts)}`);
      }
    }
    if (status.fallback) {
      lines.push(`${label("Fallback")} ${warn(status.fallback.from)}`);
    }
    if (status.vector) {
      const vectorState = status.vector.enabled
        ? status.vector.available === undefined
          ? "unknown"
          : status.vector.available
            ? "ready"
            : "unavailable"
        : "disabled";
      const vectorColor =
        vectorState === "ready"
          ? theme.success
          : vectorState === "unavailable"
            ? theme.warn
            : theme.muted;
      lines.push(`${label("Vector")} ${colorize(rich, vectorColor, vectorState)}`);
      if (status.vector.dims) {
        lines.push(`${label("Vector dims")} ${info(String(status.vector.dims))}`);
      }
      if (status.vector.extensionPath) {
        lines.push(`${label("Vector path")} ${info(shortenHomePath(status.vector.extensionPath))}`);
      }
      if (status.vector.loadError) {
        lines.push(`${label("Vector error")} ${warn(status.vector.loadError)}`);
      }
    }
    if (status.fts) {
      const ftsState = status.fts.enabled
        ? status.fts.available
          ? "ready"
          : "unavailable"
        : "disabled";
      const ftsColor =
        ftsState === "ready"
          ? theme.success
          : ftsState === "unavailable"
            ? theme.warn
            : theme.muted;
      lines.push(`${label("FTS")} ${colorize(rich, ftsColor, ftsState)}`);
      if (status.fts.error) {
        lines.push(`${label("FTS error")} ${warn(status.fts.error)}`);
      }
    }
    if (status.cache) {
      const cacheState = status.cache.enabled ? "enabled" : "disabled";
      const cacheColor = status.cache.enabled ? theme.success : theme.muted;
      const suffix =
        status.cache.enabled && typeof status.cache.entries === "number"
          ? ` (${status.cache.entries} entries)`
          : "";
      lines.push(`${label("Embedding cache")} ${colorize(rich, cacheColor, cacheState)}${suffix}`);
      if (status.cache.enabled && typeof status.cache.maxEntries === "number") {
        lines.push(`${label("Cache cap")} ${info(String(status.cache.maxEntries))}`);
      }
    }
    if (status.batch) {
      const batchState = status.batch.enabled ? "enabled" : "disabled";
      const batchColor = status.batch.enabled ? theme.success : theme.warn;
      const batchSuffix = ` (failures ${status.batch.failures}/${status.batch.limit})`;
      lines.push(
        `${label("Batch")} ${colorize(rich, batchColor, batchState)}${muted(batchSuffix)}`,
      );
      if (status.batch.lastError) {
        lines.push(`${label("Batch error")} ${warn(status.batch.lastError)}`);
      }
    }
    if (status.fallback?.reason) {
      lines.push(muted(status.fallback.reason));
    }
    if (indexError) {
      lines.push(`${label("Index error")} ${warn(indexError)}`);
    }
    if (scan?.issues.length) {
      lines.push(label("Issues"));
      for (const issue of scan.issues) {
        lines.push(`  ${warn(issue)}`);
      }
    }
    defaultRuntime.log(lines.join("\n"));
    defaultRuntime.log("");
  }
}

export function registerMemoryCli(program: Command) {
  const memory = program
    .command("memory")
    .description("Search, inspect, and reindex memory files")
    .addHelpText(
      "after",
      () =>
        `\n${theme.heading("Examples:")}\n${formatHelpExamples([
          ["openclaw memory status", "Show index and provider status."],
          ["openclaw memory index --force", "Force a full reindex."],
          ['openclaw memory search --query "deployment notes"', "Search indexed memory entries."],
          ["openclaw memory status --json", "Output machine-readable JSON."],
        ])}\n\n${theme.muted("Docs:")} ${formatDocsLink("/cli/memory", "docs.openclaw.ai/cli/memory")}\n`,
    );

  memory
    .command("status")
    .description("Show memory search index status")
    .option("--agent <id>", "Agent id (default: default agent)")
    .option("--json", "Print JSON")
    .option("--deep", "Probe embedding provider availability")
    .option("--index", "Reindex if dirty (implies --deep)")
    .option("--verbose", "Verbose logging", false)
    .action(async (opts: MemoryCommandOptions & { force?: boolean }) => {
      await runMemoryStatus(opts);
    });

  memory
    .command("index")
    .description("Reindex memory files")
    .option("--agent <id>", "Agent id (default: default agent)")
    .option("--force", "Force full reindex", false)
    .option("--verbose", "Verbose logging", false)
    .action(async (opts: MemoryCommandOptions) => {
      setVerbose(Boolean(opts.verbose));
      const cfg = loadConfig();
      const agentIds = resolveAgentIds(cfg, opts.agent);
      for (const agentId of agentIds) {
        await withManager<MemoryManager>({
          getManager: () => getMemorySearchManager({ cfg, agentId }),
          onMissing: (error) => defaultRuntime.log(error ?? "Memory search disabled."),
          onCloseError: (err) =>
            defaultRuntime.error(`Memory manager close failed: ${formatErrorMessage(err)}`),
          close: async (manager) => {
            await manager.close?.();
          },
          run: async (manager) => {
            try {
              const syncFn = manager.sync ? manager.sync.bind(manager) : undefined;
              if (opts.verbose) {
                const status = manager.status();
                const rich = isRich();
                const heading = (text: string) => colorize(rich, theme.heading, text);
                const muted = (text: string) => colorize(rich, theme.muted, text);
                const info = (text: string) => colorize(rich, theme.info, text);
                const warn = (text: string) => colorize(rich, theme.warn, text);
                const label = (text: string) => muted(`${text}:`);
                const sourceLabels = (status.sources ?? []).map((source) =>
                  formatSourceLabel(source, status.workspaceDir ?? "", agentId),
                );
                const extraPaths = status.workspaceDir
                  ? formatExtraPaths(status.workspaceDir, status.extraPaths ?? [])
                  : [];
                const requestedProvider = status.requestedProvider ?? status.provider;
                const modelLabel = status.model ?? status.provider;
                const lines = [
                  `${heading("Memory Index")} ${muted(`(${agentId})`)}`,
                  `${label("Provider")} ${info(status.provider)} ${muted(
                    `(requested: ${requestedProvider})`,
                  )}`,
                  `${label("Model")} ${info(modelLabel)}`,
                  sourceLabels.length
                    ? `${label("Sources")} ${info(sourceLabels.join(", "))}`
                    : null,
                  extraPaths.length
                    ? `${label("Extra paths")} ${info(extraPaths.join(", "))}`
                    : null,
                ].filter(Boolean) as string[];
                if (status.fallback) {
                  lines.push(`${label("Fallback")} ${warn(status.fallback.from)}`);
                }
                defaultRuntime.log(lines.join("\n"));
                defaultRuntime.log("");
              }
              const startedAt = Date.now();
              let lastLabel = "Indexing memory…";
              let lastCompleted = 0;
              let lastTotal = 0;
              const formatElapsed = () => {
                const elapsedMs = Math.max(0, Date.now() - startedAt);
                const seconds = Math.floor(elapsedMs / 1000);
                const minutes = Math.floor(seconds / 60);
                const remainingSeconds = seconds % 60;
                return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
              };
              const formatEta = () => {
                if (lastTotal <= 0 || lastCompleted <= 0) {
                  return null;
                }
                const elapsedMs = Math.max(1, Date.now() - startedAt);
                const rate = lastCompleted / elapsedMs;
                if (!Number.isFinite(rate) || rate <= 0) {
                  return null;
                }
                const remainingMs = Math.max(0, (lastTotal - lastCompleted) / rate);
                const seconds = Math.floor(remainingMs / 1000);
                const minutes = Math.floor(seconds / 60);
                const remainingSeconds = seconds % 60;
                return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
              };
              const buildLabel = () => {
                const elapsed = formatElapsed();
                const eta = formatEta();
                return eta
                  ? `${lastLabel} · elapsed ${elapsed} · eta ${eta}`
                  : `${lastLabel} · elapsed ${elapsed}`;
              };
              if (!syncFn) {
                defaultRuntime.log("Memory backend does not support manual reindex.");
                return;
              }
              await withProgressTotals(
                {
                  label: "Indexing memory…",
                  total: 0,
                  fallback: opts.verbose ? "line" : undefined,
                },
                async (update, progress) => {
                  const interval = setInterval(() => {
                    progress.setLabel(buildLabel());
                  }, 1000);
                  try {
                    await syncFn({
                      reason: "cli",
                      force: Boolean(opts.force),
                      progress: (syncUpdate) => {
                        if (syncUpdate.label) {
                          lastLabel = syncUpdate.label;
                        }
                        lastCompleted = syncUpdate.completed;
                        lastTotal = syncUpdate.total;
                        update({
                          completed: syncUpdate.completed,
                          total: syncUpdate.total,
                          label: buildLabel(),
                        });
                        progress.setLabel(buildLabel());
                      },
                    });
                  } finally {
                    clearInterval(interval);
                  }
                },
              );
              const qmdIndexSummary = await summarizeQmdIndexArtifact(manager);
              if (qmdIndexSummary) {
                defaultRuntime.log(qmdIndexSummary);
              }
              defaultRuntime.log(`Memory index updated (${agentId}).`);
            } catch (err) {
              const message = formatErrorMessage(err);
              defaultRuntime.error(`Memory index failed (${agentId}): ${message}`);
              process.exitCode = 1;
            }
          },
        });
      }
    });

  memory
    .command("search")
    .description("Search memory files")
    .argument("<query>", "Search query")
    .option("--agent <id>", "Agent id (default: default agent)")
    .option("--max-results <n>", "Max results", (value: string) => Number(value))
    .option("--min-score <n>", "Minimum score", (value: string) => Number(value))
    .option("--json", "Print JSON")
    .action(
      async (
        query: string,
        opts: MemoryCommandOptions & {
          maxResults?: number;
          minScore?: number;
        },
      ) => {
        const cfg = loadConfig();
        const agentId = resolveAgent(cfg, opts.agent);
        await withManager<MemoryManager>({
          getManager: () => getMemorySearchManager({ cfg, agentId }),
          onMissing: (error) => defaultRuntime.log(error ?? "Memory search disabled."),
          onCloseError: (err) =>
            defaultRuntime.error(`Memory manager close failed: ${formatErrorMessage(err)}`),
          close: async (manager) => {
            await manager.close?.();
          },
          run: async (manager) => {
            let results: Awaited<ReturnType<typeof manager.search>>;
            try {
              results = await manager.search(query, {
                maxResults: opts.maxResults,
                minScore: opts.minScore,
              });
            } catch (err) {
              const message = formatErrorMessage(err);
              defaultRuntime.error(`Memory search failed: ${message}`);
              process.exitCode = 1;
              return;
            }
            if (opts.json) {
              defaultRuntime.log(JSON.stringify({ results }, null, 2));
              return;
            }
            if (results.length === 0) {
              defaultRuntime.log("No matches.");
              return;
            }
            const rich = isRich();
            const lines: string[] = [];
            for (const result of results) {
              lines.push(
                `${colorize(rich, theme.success, result.score.toFixed(3))} ${colorize(
                  rich,
                  theme.accent,
                  `${shortenHomePath(result.path)}:${result.startLine}-${result.endLine}`,
                )}`,
              );
              lines.push(colorize(rich, theme.muted, result.snippet));
              lines.push("");
            }
            defaultRuntime.log(lines.join("\n").trim());
          },
        });
      },
    );

  memory
    .command("migrate")
    .description("Migrate memory databases from SQLite to PostgreSQL")
    .requiredOption("--to <driver>", "Target database driver (currently only 'postgresql')")
    .requiredOption("--host <host>", "PostgreSQL host")
    .requiredOption("--database <database>", "PostgreSQL database name")
    .requiredOption("--user <user>", "PostgreSQL username")
    .option("--port <port>", "PostgreSQL port", "5432")
    .option("--password <password>", "PostgreSQL password (or set POSTGRES_PASSWORD env var)")
    .option(
      "--schema <schema>",
      "Schema name pattern (default: agent_{agentId})",
      "agent_{agentId}",
    )
    .option("--agent <id>", "Agent id to migrate (default: all agents)")
    .option("--dry-run", "Preview migration without making changes", false)
    .option("--verbose", "Verbose logging", false)
    .addHelpText(
      "after",
      () =>
        `\n${theme.heading("Examples:")}\n${formatHelpExamples([
          [
            "openclaw memory migrate --to postgresql --host localhost --database openclaw --user openclaw",
            "Migrate all agents to PostgreSQL",
          ],
          [
            "openclaw memory migrate --to postgresql --host 192.168.1.160 --database openclaw_router --user openclaw_router --agent codex",
            "Migrate specific agent",
          ],
          [
            "openclaw memory migrate --to postgresql --host localhost --database openclaw --user openclaw --dry-run",
            "Preview migration",
          ],
        ])}\n\n${theme.muted("Note:")} PostgreSQL password can be set via POSTGRES_PASSWORD environment variable or --password flag.\n\n${theme.muted("Docs:")} ${formatDocsLink("/cli/memory/migrate", "docs.openclaw.ai/cli/memory/migrate")}\n`,
    )
    .action(
      async (opts: {
        to: string;
        host: string;
        port: string;
        database: string;
        user: string;
        password?: string;
        schema: string;
        agent?: string;
        dryRun?: boolean;
        verbose?: boolean;
      }) => {
        setVerbose(Boolean(opts.verbose));

        // Validate target driver
        if (opts.to !== "postgresql") {
          defaultRuntime.error(`Unsupported target driver: ${opts.to}`);
          defaultRuntime.error("Currently only 'postgresql' is supported.");
          process.exitCode = 1;
          return;
        }

        // Get password from env or option
        const password = opts.password || process.env.POSTGRES_PASSWORD;
        if (!password) {
          defaultRuntime.error("PostgreSQL password required.");
          defaultRuntime.error(
            "Set via --password flag or POSTGRES_PASSWORD environment variable.",
          );
          process.exitCode = 1;
          return;
        }

        const cfg = loadConfig();
        const agentIds = resolveAgentIds(cfg, opts.agent);

        if (agentIds.length === 0) {
          defaultRuntime.error("No agents found to migrate.");
          process.exitCode = 1;
          return;
        }

        // Check if better-sqlite3 is available
        let Database: typeof import("better-sqlite3").default;
        try {
          const sqlite = await import("better-sqlite3");
          Database = sqlite.default;
        } catch {
          defaultRuntime.error(
            "better-sqlite3 not available. Install with: npm install better-sqlite3",
          );
          process.exitCode = 1;
          return;
        }

        // Check if pg is available
        let Pool: typeof import("pg").Pool;
        try {
          const pg = await import("pg");
          Pool = pg.Pool;
        } catch {
          defaultRuntime.error("pg not available. Install with: npm install pg");
          process.exitCode = 1;
          return;
        }

        // Create PostgreSQL connection
        const connectionString = `postgresql://${opts.user}:${password}@${opts.host}:${opts.port}/${opts.database}`;
        const pgPool = new Pool({ connectionString });

        try {
          // Test PostgreSQL connection
          defaultRuntime.log("Testing PostgreSQL connection...");
          const testClient = await pgPool.connect();
          const versionResult = await testClient.query("SELECT version()");
          const version = versionResult.rows[0].version.split(" ").slice(0, 2).join(" ");
          defaultRuntime.log(`✅ Connected to ${version}`);

          // Check pgvector extension
          const extResult = await testClient.query(
            "SELECT * FROM pg_extension WHERE extname = 'vector'",
          );
          if (extResult.rows.length === 0) {
            defaultRuntime.error("❌ pgvector extension not found");
            defaultRuntime.error("   Install with: CREATE EXTENSION vector;");
            testClient.release();
            process.exitCode = 1;
            return;
          }
          defaultRuntime.log("✅ pgvector extension available");
          testClient.release();

          if (opts.dryRun) {
            defaultRuntime.log("\n🔍 DRY RUN MODE - No changes will be made\n");
          }

          // Migrate each agent
          for (const agentId of agentIds) {
            const schema = opts.schema.replace("{agentId}", agentId);
            const sqlitePath = path.join(
              resolveStateDir(process.env, os.homedir),
              "memory",
              `${agentId}.sqlite`,
            );

            if (!fsSync.existsSync(sqlitePath)) {
              defaultRuntime.log(`\n⚠️  No SQLite database found for agent: ${agentId}`);
              defaultRuntime.log(`   Expected: ${shortenHomePath(sqlitePath)}`);
              continue;
            }

            defaultRuntime.log(`\n📦 Migrating agent: ${agentId}`);
            defaultRuntime.log(`   Source: ${shortenHomePath(sqlitePath)}`);
            defaultRuntime.log(`   Target schema: ${schema}`);

            if (opts.dryRun) {
              const sqlite = new Database(sqlitePath, { readonly: true });
              const metaCount = sqlite.prepare("SELECT COUNT(*) as count FROM meta").get() as {
                count: number;
              };
              const filesCount = sqlite.prepare("SELECT COUNT(*) as count FROM files").get() as {
                count: number;
              };
              const chunksCount = sqlite.prepare("SELECT COUNT(*) as count FROM chunks").get() as {
                count: number;
              };
              const cacheCount = sqlite
                .prepare("SELECT COUNT(*) as count FROM embedding_cache")
                .get() as { count: number };
              sqlite.close();

              defaultRuntime.log(`   Rows to migrate:`);
              defaultRuntime.log(`      - meta: ${metaCount.count}`);
              defaultRuntime.log(`      - files: ${filesCount.count}`);
              defaultRuntime.log(`      - chunks: ${chunksCount.count}`);
              defaultRuntime.log(`      - embedding_cache: ${cacheCount.count}`);
              continue;
            }

            // Perform migration
            await withProgress(
              { label: "Creating schema...", fallback: opts.verbose ? "line" : undefined },
              async () => {
                const client = await pgPool.connect();
                try {
                  await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
                  await client.query(`CREATE EXTENSION IF NOT EXISTS vector`);

                  // Create tables
                  await client.query(`
                    CREATE TABLE IF NOT EXISTS ${schema}.meta (
                      key TEXT PRIMARY KEY,
                      value TEXT NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS ${schema}.files (
                      path TEXT PRIMARY KEY,
                      source TEXT NOT NULL DEFAULT 'memory',
                      hash TEXT NOT NULL,
                      mtime BIGINT NOT NULL,
                      size BIGINT NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS ${schema}.chunks (
                      id TEXT PRIMARY KEY,
                      path TEXT NOT NULL,
                      source TEXT NOT NULL DEFAULT 'memory',
                      start_line INTEGER NOT NULL,
                      end_line INTEGER NOT NULL,
                      hash TEXT NOT NULL,
                      model TEXT NOT NULL,
                      text TEXT NOT NULL,
                      embedding vector(1536),
                      updated_at BIGINT NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS ${schema}.embedding_cache (
                      provider TEXT NOT NULL,
                      model TEXT NOT NULL,
                      provider_key TEXT NOT NULL,
                      hash TEXT NOT NULL,
                      embedding vector(1536),
                      dims INTEGER,
                      updated_at BIGINT NOT NULL,
                      PRIMARY KEY (provider, model, provider_key, hash)
                    );
                  `);
                } finally {
                  client.release();
                }
              },
            );

            // Open SQLite database
            const sqlite = new Database(sqlitePath, { readonly: true });

            try {
              // Migrate meta
              await withProgress(
                { label: "Migrating meta table...", fallback: opts.verbose ? "line" : undefined },
                async () => {
                  const metaRows = sqlite.prepare("SELECT * FROM meta").all();
                  const client = await pgPool.connect();
                  try {
                    for (const row of metaRows as { key: string; value: string }[]) {
                      await client.query(
                        `INSERT INTO ${schema}.meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
                        [row.key, row.value],
                      );
                    }
                  } finally {
                    client.release();
                  }
                  defaultRuntime.log(`   ✅ Migrated ${metaRows.length} meta rows`);
                },
              );

              // Migrate files
              await withProgress(
                { label: "Migrating files table...", fallback: opts.verbose ? "line" : undefined },
                async () => {
                  const fileRows = sqlite.prepare("SELECT * FROM files").all();
                  const client = await pgPool.connect();
                  try {
                    for (const row of fileRows as {
                      path: string;
                      source: string;
                      hash: string;
                      mtime: number;
                      size: number;
                    }[]) {
                      await client.query(
                        `INSERT INTO ${schema}.files (path, source, hash, mtime, size) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (path) DO NOTHING`,
                        [row.path, row.source, row.hash, row.mtime, row.size],
                      );
                    }
                  } finally {
                    client.release();
                  }
                  defaultRuntime.log(`   ✅ Migrated ${fileRows.length} file rows`);
                },
              );

              // Migrate chunks
              const chunksCount = (
                sqlite.prepare("SELECT COUNT(*) as count FROM chunks").get() as { count: number }
              ).count;
              let migratedChunks = 0;

              await withProgressTotals(
                {
                  label: "Migrating chunks table...",
                  total: chunksCount,
                  fallback: opts.verbose ? "line" : undefined,
                },
                async (update) => {
                  const chunkRows = sqlite.prepare("SELECT * FROM chunks").all();
                  const client = await pgPool.connect();
                  try {
                    for (const row of chunkRows as {
                      id: string;
                      path: string;
                      source: string;
                      start_line: number;
                      end_line: number;
                      hash: string;
                      model: string;
                      text: string;
                      embedding: Buffer | null;
                      updated_at: number;
                    }[]) {
                      // Convert embedding
                      let embeddingArray: number[] | null = null;
                      if (row.embedding) {
                        const float32Array = new Float32Array(
                          row.embedding.buffer,
                          row.embedding.byteOffset,
                          row.embedding.byteLength / 4,
                        );
                        embeddingArray = Array.from(float32Array);
                      }

                      await client.query(
                        `INSERT INTO ${schema}.chunks (id, path, source, start_line, end_line, hash, model, text, embedding, updated_at)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector, $10)
                         ON CONFLICT (id) DO NOTHING`,
                        [
                          row.id,
                          row.path,
                          row.source,
                          row.start_line,
                          row.end_line,
                          row.hash,
                          row.model,
                          row.text,
                          embeddingArray ? JSON.stringify(embeddingArray) : null,
                          row.updated_at,
                        ],
                      );

                      migratedChunks++;
                      update({ completed: migratedChunks, total: chunksCount });
                    }
                  } finally {
                    client.release();
                  }
                  defaultRuntime.log(`   ✅ Migrated ${migratedChunks} chunk rows`);
                },
              );

              // Migrate embedding_cache
              const cacheCount = (
                sqlite.prepare("SELECT COUNT(*) as count FROM embedding_cache").get() as {
                  count: number;
                }
              ).count;
              let migratedCache = 0;

              await withProgressTotals(
                {
                  label: "Migrating embedding_cache table...",
                  total: cacheCount,
                  fallback: opts.verbose ? "line" : undefined,
                },
                async (update) => {
                  const cacheRows = sqlite.prepare("SELECT * FROM embedding_cache").all();
                  const client = await pgPool.connect();
                  try {
                    for (const row of cacheRows as {
                      provider: string;
                      model: string;
                      provider_key: string;
                      hash: string;
                      embedding: Buffer | null;
                      dims: number | null;
                      updated_at: number;
                    }[]) {
                      // Convert embedding
                      let embeddingArray: number[] | null = null;
                      if (row.embedding) {
                        const float32Array = new Float32Array(
                          row.embedding.buffer,
                          row.embedding.byteOffset,
                          row.embedding.byteLength / 4,
                        );
                        embeddingArray = Array.from(float32Array);
                      }

                      await client.query(
                        `INSERT INTO ${schema}.embedding_cache (provider, model, provider_key, hash, embedding, dims, updated_at)
                         VALUES ($1, $2, $3, $4, $5::vector, $6, $7)
                         ON CONFLICT (provider, model, provider_key, hash) DO NOTHING`,
                        [
                          row.provider,
                          row.model,
                          row.provider_key,
                          row.hash,
                          embeddingArray ? JSON.stringify(embeddingArray) : null,
                          row.dims,
                          row.updated_at,
                        ],
                      );

                      migratedCache++;
                      update({ completed: migratedCache, total: cacheCount });
                    }
                  } finally {
                    client.release();
                  }
                  defaultRuntime.log(`   ✅ Migrated ${migratedCache} cache rows`);
                },
              );

              // Create indexes
              await withProgress(
                { label: "Creating indexes...", fallback: opts.verbose ? "line" : undefined },
                async () => {
                  const client = await pgPool.connect();
                  try {
                    await client.query(`
                      CREATE INDEX IF NOT EXISTS idx_chunks_path ON ${schema}.chunks(path);
                      CREATE INDEX IF NOT EXISTS idx_chunks_source ON ${schema}.chunks(source);
                      CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON ${schema}.chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
                      CREATE INDEX IF NOT EXISTS idx_embedding_cache_updated_at ON ${schema}.embedding_cache(updated_at);
                    `);
                  } finally {
                    client.release();
                  }
                  defaultRuntime.log("   ✅ Indexes created");
                },
              );

              defaultRuntime.log(`\n✅ Migration complete for ${agentId}`);
            } finally {
              sqlite.close();
            }
          }

          if (!opts.dryRun) {
            defaultRuntime.log("\n🎉 All agents migrated successfully!");
            defaultRuntime.log("\nNext steps:");
            defaultRuntime.log(
              `1. Update your configuration to use PostgreSQL (see docs/gateway/database-configuration.md)`,
            );
            defaultRuntime.log(
              `2. Verify with: openclaw memory status --agent ${agentIds[0] ?? "main"}`,
            );
            defaultRuntime.log(`3. (Optional) Backup SQLite files before deleting`);
          } else {
            defaultRuntime.log("\n✅ Dry run complete - no changes made");
          }
        } catch (err) {
          const message = formatErrorMessage(err);
          defaultRuntime.error(`Migration failed: ${message}`);
          process.exitCode = 1;
        } finally {
          await pgPool.end();
        }
      },
    );
}
