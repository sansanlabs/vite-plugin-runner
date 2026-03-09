# @sansanlabs/vite-plugin-runner

A Vite plugin that runs shell commands when files change or when Vite starts. Built on top of Vite's internal file watcher (chokidar) for reliable, cross-platform behavior.

## Features

- ✅ Run commands on file change with glob pattern or custom condition
- ✅ Run commands on Vite startup and/or build
- ✅ Pass the changed file path directly to the command
- ✅ Cross-platform — works on Windows, macOS, and Linux
- ✅ Prevents duplicate runs with a built-in processing lock
- ✅ Customizable done message per runner
- ✅ Silent mode per runner or globally

## Installation

```bash
npm install -D @sansanlabs/vite-plugin-runner
```

## Basic Usage

```typescript
// vite.config.ts
import { run } from "@sansanlabs/vite-plugin-runner";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    run([
      {
        name: "ziggy generate",
        run: ["php", "artisan", "ziggy:generate", "--types"],
        pattern: ["routes/**/*.php"],
        done: "Ziggy types updated!",
      },
    ]),
  ],
});
```

## Examples

### Static command with glob pattern

Runs `php artisan ziggy:generate --types` whenever any `.php` file inside `routes/` changes.

```typescript
run({
  name: "ziggy generate",
  run: ["php", "artisan", "ziggy:generate", "--types"],
  pattern: ["routes/**/*.php"],
  done: "Ziggy types updated!",
})
```

### Dynamic command with file path

Passes the changed file path directly to the command. Useful for formatters like Laravel Pint.

```typescript
run({
  name: "pint format",
  run: (file) => ["php", "vendor/bin/pint", file],
  condition: (file) => file.endsWith(".php"),
  startup: false,
  done: (file) => `Formatted ${file}`,
})
```

### Exclude a folder using condition

Use a `condition` function for more complex logic, such as excluding specific folders.

```typescript
run({
  name: "pint format",
  run: (file) => ["php", "vendor/bin/pint", file],
  condition: (file) => file.endsWith(".php") && !file.includes("routes/"),
  startup: false,
  done: (file) => `Formatted ${file}`,
})
```

### Multiple runners

```typescript
run([
  {
    name: "ziggy generate",
    run: ["php", "artisan", "ziggy:generate", "--types"],
    pattern: ["routes/**/*.php"],
    done: "Ziggy types updated!",
  },
  {
    name: "pint format",
    run: (file) => ["php", "vendor/bin/pint", file],
    condition: (file) => file.endsWith(".php") && !file.includes("routes/"),
    startup: false,
    done: (file) => `Formatted ${file}`,
  },
])
```

### Run on build

```typescript
run({
  name: "generate types",
  run: ["php", "artisan", "ziggy:generate", "--types"],
  pattern: ["routes/**/*.php"],
  startup: true,
  build: true, // also runs during `vite build`
})
```

### Silent mode

Suppress all output for a specific runner or globally.

```typescript
// Silence a specific runner
run({
  name: "pint format",
  run: (file) => ["php", "vendor/bin/pint", file],
  condition: (file) => file.endsWith(".php"),
  silent: true,
})

// Silence all runners globally
run([...], { silent: true })
```

## Runner Options

| Option      | Type                                      | Default     | Description                                                                 |
| ----------- | ----------------------------------------- | ----------- | --------------------------------------------------------------------------- |
| `name`      | `string`                                  | —           | Identifier shown in log output                                              |
| `run`       | `string[]` \| `(file: string) => string[]` | —           | Command to execute. Use a function to receive the changed file path         |
| `pattern`   | `string` \| `string[]`                    | `undefined` | Glob pattern(s) the changed file must match. Supports `!` negation          |
| `condition` | `(file: string) => boolean`               | `undefined` | Custom function to determine whether to run. Takes precedence over `pattern` |
| `startup`   | `boolean`                                 | `true`      | Whether to run the command when Vite starts                                 |
| `build`     | `boolean`                                 | `false`     | Whether to run the command during `vite build`                              |
| `silent`    | `boolean`                                 | `false`     | Whether to suppress command output. Overrides global `silent`               |
| `done`      | `string` \| `(file: string) => string`     | `undefined` | Message to display after the command finishes successfully                  |

## Plugin Options

| Option   | Type      | Default | Description                                              |
| -------- | --------- | ------- | -------------------------------------------------------- |
| `silent` | `boolean` | `false` | Suppress all output for every runner (can be overridden per runner) |

## Pattern Syntax

Patterns use glob syntax:

| Pattern          | Description                                      |
| ---------------- | ------------------------------------------------ |
| `*.php`          | Matches any `.php` file in the root              |
| `**/*.php`       | Matches any `.php` file in any directory         |
| `routes/**/*.php`| Matches `.php` files inside `routes/` recursively|
| `!routes/**`     | Negation — excludes files matching this pattern  |

> **Note:** File paths are always normalized to forward slashes (`/`) before being matched or passed to `condition`/`run`, ensuring consistent behavior on Windows.

## License

MIT — [SanSanLabs](https://github.com/sansanlabs)