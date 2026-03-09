import { execFileSync } from "node:child_process";
import type { Plugin, ViteDevServer } from "vite";

/**
 * A command to run when a file changes.
 * Can be a static array of strings or a function that receives
 * the changed file path and returns an array of strings.
 *
 * @example
 * // Static command
 * run: ["php", "artisan", "ziggy:generate", "--types"]
 *
 * // Dynamic command with file path
 * run: (file) => ["php", "vendor/bin/pint", file]
 */
type RunCommand = string[] | ((file: string) => string[]);

/**
 * Configuration for a single runner.
 * A runner defines what command to execute and when to execute it.
 */
interface Runner {
  /** Unique identifier for this runner, used in log output */
  name: string;

  /**
   * The command to execute.
   * Can be a static string array or a function receiving the changed file path.
   */
  run: RunCommand;

  /**
   * Glob pattern(s) that a changed file must match to trigger this runner.
   * Supports negation with `!` prefix.
   * Either `pattern` or `condition` must be provided.
   *
   * @example
   * pattern: "routes/**\/*.php"
   * pattern: ["app/**\/*.php", "!app/Exceptions/**"]
   */
  pattern?: string | string[];

  /**
   * Custom condition function to determine whether the runner should execute.
   * Receives the normalized (forward-slash) file path.
   * Takes precedence over `pattern` if both are provided.
   * Either `pattern` or `condition` must be provided.
   *
   * @example
   * condition: (file) => file.endsWith(".php") && !file.includes("routes/")
   */
  condition?: (file: string) => boolean;

  /**
   * Whether to run the command when Vite starts.
   * @default true
   */
  startup?: boolean;

  /**
   * Whether to run the command when Vite builds.
   * @default false
   */
  build?: boolean;

  /**
   * Whether to suppress the command output in the console.
   * Overrides the global `silent` option for this runner.
   * @default false
   */
  silent?: boolean;

  /**
   * Message to display after the command finishes successfully.
   * Can be a static string or a function receiving the changed file path.
   *
   * @example
   * done: "Ziggy types updated!"
   * done: (file) => `Formatted ${file}`
   */
  done?: string | ((file: string) => string);
}

/**
 * Global options for the plugin.
 */
interface PluginOptions {
  /**
   * Whether to suppress all command output in the console.
   * Can be overridden per runner with the `silent` option.
   * @default false
   */
  silent?: boolean;
}

/**
 * Tests whether a file path matches one or more glob patterns.
 * Supports `**` (globstar) for matching across directories,
 * `*` for matching within a single directory segment,
 * and `!` prefix for negating a pattern.
 *
 * All paths are normalized to forward slashes before matching,
 * ensuring consistent behavior across Windows, Mac, and Linux.
 *
 * @param filePath - The file path to test (will be normalized internally)
 * @param pattern - A single glob pattern or an array of glob patterns
 * @returns `true` if the file path matches any of the patterns
 *
 * @example
 * matchesPattern("routes/web.php", "routes/**\/*.php")          // true
 * matchesPattern("routes/web.php", ["routes/**\/*.php", "!routes/api.php"]) // true
 * matchesPattern("routes/api.php", "!routes/api.php")           // false
 */
function matchesPattern(filePath: string, pattern: string | string[]): boolean {
  const patterns = Array.isArray(pattern) ? pattern : [pattern];

  // Normalize path separators to forward slashes for cross-platform compatibility
  const normalized = filePath.replaceAll("\\", "/");

  return patterns.some((p) => {
    const isNegated = p.startsWith("!");
    const cleanPattern = isNegated ? p.slice(1) : p;

    // Convert glob pattern to a regex string:
    // 1. Normalize separators
    // 2. Escape all special regex characters except `*`
    // 3. Temporarily replace `**` with a placeholder to avoid conflict with `*`
    // 4. Replace single `*` with `[^/]*` (match anything except `/`)
    // 5. Replace `**/` placeholder with `(.*/)?` (match zero or more path segments)
    // 6. Replace remaining `**` placeholder with `.*` (match anything)
    const regexStr = cleanPattern
      .replaceAll("\\", "/")
      .replace(/[.+^${}()|[\]\\]/g, (c) => (c === "*" ? c : `\\${c}`))
      .replace(/\*\*/g, "{{GLOBSTAR}}")
      .replace(/\*/g, "[^/]*")
      .replace(/\{\{GLOBSTAR\}\}\//g, "(.*/)?")
      .replace(/\{\{GLOBSTAR\}\}/g, ".*");

    const matches = new RegExp(`^${regexStr}$`).test(normalized);

    // For negated patterns, invert the match result
    return isNegated ? !matches : matches;
  });
}

/**
 * Executes a runner's command using `execFileSync`.
 * Using `execFileSync` instead of `execSync` ensures arguments are passed
 * directly to the process without going through a shell, which avoids
 * issues with spaces in file paths on all operating systems.
 *
 * Logs the command before running (unless silent),
 * writes stdout output after running (unless silent),
 * and logs the `done` message on success (if defined).
 * Logs an error message if the command fails.
 *
 * @param runner - The runner configuration to execute
 * @param file - The normalized file path that triggered this runner (empty string on startup/build)
 * @param silent - The global silent setting (can be overridden by runner.silent)
 */
function executeRunner(runner: Runner, file: string, silent: boolean): void {
  // Resolve the command — call as function if dynamic, use as-is if static
  const command = typeof runner.run === "function" ? runner.run(file) : runner.run;
  const isSilent = runner.silent ?? silent;

  // Separate the executable from its arguments for execFileSync
  const [bin, ...args] = command;

  if (!isSilent) {
    console.log(`\x1b[36m[${runner.name}]\x1b[0m Running: ${command.join(" ")}`);
  }

  try {
    const output = execFileSync(bin, args, { encoding: "utf-8" });

    // Write raw stdout output from the command
    if (!isSilent && output) {
      process.stdout.write(output);
    }

    // Display the done message if defined
    if (runner.done) {
      const message = typeof runner.done === "function" ? runner.done(file) : runner.done;
      console.log(`\x1b[32m[${runner.name}]\x1b[0m ${message}`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\x1b[31m[${runner.name}] Failed:\x1b[0m ${message}`);
  }
}

/**
 * Determines whether a runner should be triggered for a given file path.
 * Checks `condition` first (takes precedence), then falls back to `pattern`.
 * Returns `false` if neither is defined.
 *
 * @param runner - The runner to check
 * @param filePath - The normalized file path that changed
 * @returns `true` if the runner should be executed for this file
 */
function shouldRun(runner: Runner, filePath: string): boolean {
  // condition takes precedence over pattern
  if (runner.condition) {
    return runner.condition(filePath);
  }

  if (runner.pattern) {
    return matchesPattern(filePath, runner.pattern);
  }

  // No condition or pattern defined — never run on file change
  return false;
}

/**
 * A Vite plugin that runs shell commands when files change or when Vite starts.
 * Uses Vite's built-in `server.watcher` (chokidar) for reliable file watching
 * across all operating systems, avoiding the pitfalls of Node's native `fs.watch`.
 *
 * A `processing` set is used to debounce repeated watcher events for the same file,
 * preventing commands from running multiple times for a single save and avoiding
 * infinite loops when a command modifies the file it was triggered by.
 *
 * @param runners - A single runner or an array of runners to register
 * @param options - Global plugin options
 * @returns A Vite plugin
 *
 * @example
 * run([
 *   {
 *     name: "ziggy generate",
 *     run: ["php", "artisan", "ziggy:generate", "--types"],
 *     pattern: ["routes/**\/*.php"],
 *     done: "Ziggy types updated!",
 *   },
 *   {
 *     name: "pint format",
 *     run: (file) => ["php", "vendor/bin/pint", file],
 *     condition: (file) => file.endsWith(".php") && !file.includes("routes/"),
 *     startup: false,
 *     done: (file) => `Formatted ${file}`,
 *   },
 * ])
 */
export function run(runners: Runner | Runner[], options: PluginOptions = {}): Plugin {
  // Normalize to array for uniform processing
  const list = Array.isArray(runners) ? runners : [runners];
  const silent = options.silent ?? false;

  return {
    name: "vite-plugin-runner",

    /**
     * Vite hook: called when the build starts (both dev and production).
     * Runs all runners that have `startup` enabled (default: true).
     */
    buildStart() {
      for (const runner of list) {
        if (runner.startup === false) continue;
        executeRunner(runner, "", silent);
      }
    },

    /**
     * Vite hook: called after the bundle is written (production build only).
     * Runs all runners that have `build` enabled (default: false).
     */
    closeBundle() {
      for (const runner of list) {
        if (!runner.build) continue;
        executeRunner(runner, "", silent);
      }
    },

    /**
     * Vite hook: called when the dev server is created.
     * Registers file patterns with the watcher and listens for file changes.
     */
    configureServer(server: ViteDevServer) {
      // Collect all non-negated patterns and add them to the watcher
      // so Vite tracks files outside the default `src` directory (e.g. PHP files)
      const allPatterns = list.flatMap((r) => {
        if (!r.pattern) return [];
        return Array.isArray(r.pattern) ? r.pattern : [r.pattern];
      });

      for (const pattern of allPatterns) {
        // Strip negation prefix before passing to watcher
        const clean = pattern.startsWith("!") ? pattern.slice(1) : pattern;
        server.watcher.add(clean);
      }

      // Track files currently being processed to prevent duplicate runs
      // and infinite loops caused by a command modifying the watched file
      const processing = new Set<string>();

      server.watcher.on("change", (filePath: string) => {
        // Normalize path separators once here so all runners receive
        // a consistent forward-slash path regardless of the OS
        const normalized = filePath.replaceAll("\\", "/");

        // Skip if this file is already being processed
        if (processing.has(normalized)) return;

        for (const runner of list) {
          if (!shouldRun(runner, normalized)) continue;

          // Mark file as processing and release after 500ms cooldown
          processing.add(normalized);
          executeRunner(runner, normalized, silent);
          setTimeout(() => processing.delete(normalized), 500);
        }
      });
    },
  };
}