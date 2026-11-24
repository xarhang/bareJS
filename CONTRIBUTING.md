# Contributing to BareJS

First off, thank you for considering contributing to BareJS! It's people like you who make BareJS a world-class web engine.

## 🏎️ Performance First
BareJS is built for speed. When submitting a pull request, please ensure that:
1. Your changes do not increase the latency of the core routing engine.
2. You avoid unnecessary object allocations in the "hot path" (request/response flow).
3. If you add a feature, please include a benchmark comparison if applicable.

## 🛠️ How Can I Contribute?

### Reporting Bugs
* Use the GitHub Issue Tracker.
* Describe the steps to reproduce the bug.
* Include your Bun version and OS details.

### Suggesting Enhancements
* Open an issue to discuss the idea before implementation.
* Explain why this enhancement would be useful for the "minimalist" goal of BareJS.

### Pull Requests
1. **Fork** the repository and create your branch from `main`.
2. **Install** dependencies: `bun install`.
3. **Write tests** for your new functionality.
4. **Ensure linting passes**: `bun run lint` (if applicable).
5. **Update Documentation**: If you change an API, update the `README.md`.

## 🏗️ Development Setup
```bash
# Clone your fork
git clone https://github.com/xarhang/bareJS.git
cd bareJS

# Install Bun dependencies
bun install

# Run tests
bun test

# Run benchmarks to ensure no performance regression
bun run bench
```

## 🚀 Release & Publish Workflow
1. Run `bun test` and `bun run build`.
2. Update `package.json` version, `CHANGELOG.md`, `README.md`, and `llms.txt`.
3. Commit and push to `main` (use `git pull --rebase origin main` if `bench.yml` pushed a benchmark update).
4. Tag and create a GitHub Release:
   ```bash
   git tag v<version> && git push origin v<version>
   gh release create v<version> --title "BareJS v<version>" --notes "..."
   ```
5. Publish to npm using `bun publish --access public` (if not logged in, run `npm login` first to authenticate via `npmjs.com/login/cli/...`). Note: `bun publish` handles web-based 2FA cleanly without `npm publish`'s non-TTY `EOTP` exit.

