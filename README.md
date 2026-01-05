# 🚀 BareJS

BareJS is an ultra-high-performance web engine built on the Bun runtime, designed for minimalism and the lowest possible latency.

![Benchmark Status](https://github.com/xarhang/bareJS/actions/workflows/bench.yml/badge.svg)
[![Performance Dashboard](https://img.shields.io/badge/Performance-Dashboard-blueviolet?style=flat-square&logo=speedtest)](https://xarhang.github.io/bareJS/dev/benchmarks/)
[![Bun Version](https://img.shields.io/badge/Bun-%3E%3D1.0.0-black?style=flat-square&logo=bun)](https://bun.sh)

---

## 📊 Performance Benchmarks

Performance comparison between **BareJS**, **Elysia**, and **Hono** running on GitHub Actions (Ubuntu-latest) hardware.

### 🚀 Latest Benchmark Results
*Awaiting automated update...*

| Framework | Latency (Avg) | Speed Ratio |
| :--- | :--- | :--- |
| **BareJS (Your Engine)** | **-- ns/iter** | **Baseline (1.0x)** |
| Elysia | -- ns/iter | --x slower |
| Hono | -- ns/iter | --x slower |
> [!IMPORTANT]
> The table above is automatically updated via `scripts/update-readme.ts`. It only overwrites content between the `BENCHMARK_START` and `BENCHMARK_END` tags.

---

## ✨ Features

- **Ultra Low Latency:** Optimized to minimize processing overhead.
- **Zero Dependency:** Built natively for security and raw speed.
- **Optimized for Bun:** Leverages native Bun APIs for maximum performance.
- **Memory Efficient:** Minimal heap usage and clean garbage collection.

## 🛠 Getting Started

### Prerequisites
- [Bun](https://bun.sh) v1.0.0 or higher

### Installation
```bash
bun install
```

### Running Benchmarks Locally

```bash
bun run benchmarks/index.ts

```

---

## 🏗 Roadmap

* [x] Middleware Pattern Support (Chain Execution)
* [x] High-Speed Static Routing (O(1) Lookup Table)
* [ ] Schema Validation Integration
* [ ] Full Documentation

---

*Maintained by xarhang*