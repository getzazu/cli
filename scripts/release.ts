// Release driver for @getzazu/cli. Mirrors zazu-ts's scripts/release.ts.
//
//   bun scripts/release.ts 0.1.1
//   bun scripts/release.ts 0.1.1 --force
//   bun scripts/release.ts pre              (re-tags the current version as a pre-release)
//
// Steps:
//   1. Working tree must be clean
//   2. (--force) delete existing remote release + tag
//   3. Bump version in package.json
//   4. Verify check:all passes (typecheck + lint + test). Cross-compile
//      is skipped locally — that's the workflow's job; running it on
//      every release would burn 30s on four targets we don't need yet.
//   5. Commit version bump (if changed)
//   6. Push main
//   7. Create signed tag + GitHub release (which fires release.yml)
//
// After step 7, the release workflow:
//   - re-runs tests + cross-compiles all four binaries
//   - publishes the five npm packages via OIDC trusted publishing
//   - uploads binaries to the GitHub release
//   - bumps the Homebrew tap if PUBLISH_HOMEBREW is set

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "../..");
const PKG_PATH = join(ROOT, "package.json");

const C = {
  blue: (s: string) => `\x1b[34m→\x1b[0m ${s}`,
  green: (s: string) => `\x1b[32m✓\x1b[0m ${s}`,
  yellow: (s: string) => `\x1b[33m⊘\x1b[0m ${s} \x1b[33m(skipped)\x1b[0m`,
  red: (s: string) => `\x1b[31m✗\x1b[0m ${s}`,
  header: (s: string) => `\n\x1b[1;36m${s}\x1b[0m\n${"─".repeat(s.length)}`,
};

function info(msg: string) {
  console.log(C.blue(msg));
}
function success(msg: string) {
  console.log(C.green(msg));
}
function skip(msg: string) {
  console.log(C.yellow(msg));
}
function header(msg: string) {
  console.log(C.header(msg));
}

function sh(cmd: string, args: string[]): string {
  const r = spawnSync(cmd, args, { stdio: ["inherit", "pipe", "inherit"], encoding: "utf8" });
  if (r.status !== 0) {
    console.error(C.red(`Command failed: ${cmd} ${args.join(" ")}`));
    process.exit(r.status ?? 1);
  }
  return r.stdout.trim();
}

function shTry(cmd: string, args: string[]): { ok: boolean; stdout: string } {
  const r = spawnSync(cmd, args, { stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" });
  return { ok: r.status === 0, stdout: r.stdout.trim() };
}

const args = process.argv.slice(2);
let requested = args[0];
const force = args.includes("--force") || args.includes("force");

if (!requested) {
  console.error(
    C.red("Usage: bun scripts/release.ts X.Y.Z [--force]   or   bun scripts/release.ts pre"),
  );
  process.exit(1);
}

// Strict-ish semver: X.Y.Z with optional -alpha.N / -beta.N / -rc.N / -pre.N.
// We don't need full semver coverage — we control the inputs and only ship
// clean numeric versions. The regex is permissive enough for pre-release
// suffixes but rejects anything that would silently corrupt package.json.
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc|pre)(?:\.\d+)?)?$/;

if (requested !== "pre" && !SEMVER_RE.test(requested)) {
  console.error(
    C.red(
      `Invalid version "${requested}". Expected X.Y.Z (optionally suffixed with -alpha.N / -beta.N / -rc.N / -pre.N), or the literal "pre".`,
    ),
  );
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(PKG_PATH, "utf8")) as { version: string };
const current = pkg.version;
let prerelease = /alpha|beta|rc|pre/.test(requested) || requested === "pre";
if (requested === "pre") {
  requested = current;
  prerelease = true;
}
const newVersion = requested;
const tag = `v${newVersion}`;

const dirty = sh("git", ["status", "--porcelain"]);
if (dirty) {
  console.error(C.red(`Aborting: working tree is not clean.\n${dirty}`));
  process.exit(1);
}

let title = `Release ${tag}`;
if (force) title += " (force)";
header(title);
info(`Current version: ${current}`);
info(`New version:     ${newVersion}`);
info(`Pre-release:     ${prerelease}`);

// Bail out before any repo mutation if the release already exists
// and we're not in --force mode. Without this guard, a re-run on an
// already-shipped version would still rewrite package.json, run
// check:all, commit the version bump, and push origin/main — ending
// in a noise commit on main with no release dispatched.
if (!force && shTry("gh", ["release", "view", tag]).ok) {
  header("Release");
  skip(`Release ${tag} already exists (use --force to re-create)`);
  console.log("");
  console.log(
    `Release ${tag} was not dispatched. To re-cut, run with --force or pick a higher version.`,
  );
  process.exit(0);
}

if (force) {
  header("Force cleanup");
  if (shTry("gh", ["release", "view", tag]).ok) {
    sh("gh", ["release", "delete", tag, "--yes", "--cleanup-tag"]);
    success(`Deleted release and remote tag ${tag}`);
  } else {
    skip(`No release ${tag} to delete`);
  }
  // Even when no release existed, a stray remote tag may still be
  // there (e.g. from a previous half-finished release attempt).
  // gh release delete --cleanup-tag only runs when the release object
  // existed, so we have to handle the orphaned-tag case ourselves —
  // otherwise gh release create --target main below fails with
  // "tag already exists" and the user can't recover without manual
  // git push --delete.
  const remoteTagRef = `refs/tags/${tag}`;
  if (shTry("git", ["ls-remote", "--exit-code", "origin", remoteTagRef]).ok) {
    sh("git", ["push", "origin", "--delete", tag]);
    success(`Deleted remote tag ${tag}`);
  } else {
    skip(`No remote tag ${tag} to delete`);
  }
  if (shTry("git", ["rev-parse", tag]).ok) {
    sh("git", ["tag", "-d", tag]);
    success(`Deleted local tag ${tag}`);
  } else {
    skip(`No local tag ${tag} to delete`);
  }
}

header("Version");
if (newVersion === current) {
  skip(`Version already ${newVersion}`);
} else {
  const content = readFileSync(PKG_PATH, "utf8").replace(
    /"version":\s*"[^"]*"/,
    `"version": "${newVersion}"`,
  );
  writeFileSync(PKG_PATH, content);
  success("Updated package.json");
}

header("Build verification");
sh("bun", ["install", "--frozen-lockfile"]);
sh("bun", ["run", "check:all"]);
success("check:all passed (typecheck + lint + test)");

header("Git commit");
const diff = sh("git", ["diff", "--name-only"]);
if (diff.includes("package.json")) {
  sh("git", ["add", "package.json"]);
  sh("git", ["commit", "-m", `chore: bump version to ${newVersion}`]);
  success("Committed version bump");
} else {
  skip("No version change to commit");
}

header("Git push");
// Refuse to push from anywhere other than main — the workflow's
// release.yml triggers on pushes to main and tags off main, so a
// release driven from a feature branch would land tags pointing at
// the wrong commit.
const branch = sh("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
if (branch !== "main") {
  console.error(C.red(`Aborting: must release from main, currently on ${branch}.`));
  process.exit(1);
}
// Refresh origin/main so the local-vs-remote comparison below is
// meaningful — without this fetch, an out-of-date tracking ref will
// either skip a needed push or trigger a redundant one.
sh("git", ["fetch", "origin", "main"]);
const local = sh("git", ["rev-parse", "HEAD"]);
const remote = shTry("git", ["rev-parse", "origin/main"]).stdout;
if (local === remote) {
  skip(`origin/main already at ${local.slice(0, 7)}`);
} else {
  sh("git", ["push", "origin", "main"]);
  success("Pushed to origin/main");
}

header("Release");
const tagExists = shTry("git", ["rev-parse", tag]).ok;

const flags = ["release", "create", tag, "--generate-notes"];
if (!tagExists) flags.push("--target", "main");
if (prerelease) flags.push("--prerelease");
sh("gh", flags);
success(`Release ${tag} created`);

console.log("");
success(`\x1b[1mRelease ${tag} dispatched.\x1b[0m CI will:`);
console.log("    • Run tests + smoke-test the host binary");
console.log("    • Cross-compile all four binaries");
console.log("    • Upload binaries to the GitHub release");
console.log("    • Publish the five npm packages via OIDC trusted publishing");
console.log("    • Bump the Homebrew tap (if PUBLISH_HOMEBREW=true)");
