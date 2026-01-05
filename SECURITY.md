# Security Policy

## 🛡️ Supported Versions
We only provide security updates for the latest stable version of BareJS.

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | ✅ Supported       |
| < 0.1.0 | ❌ Not Supported   |

## 🐛 Reporting a Vulnerability
We take the security of BareJS seriously. If you find a vulnerability, please do not open a public issue. Instead, follow this process:

1. **Email us**: Send a detailed report to `xarhang@protonmail.com`.
2. **Include Details**: Describe the attack vector, the potential impact, and a proof-of-concept if possible.
3. **Response Time**: We will acknowledge your report within 48 hours and provide a timeline for a fix.

## 🚀 Our Security Approach
* **Zero Dependencies**: We minimize supply-chain attacks by staying dependency-free.
* **Standard Web APIs**: We rely on vetted, native Bun and Web APIs.
* **JIT Sandboxing**: Our JIT compiler uses strictly controlled `new Function` generation to prevent injection attacks.

---

Thank you for helping keep BareJS safe for everyone!