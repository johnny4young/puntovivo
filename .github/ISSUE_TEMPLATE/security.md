---
name: Security Vulnerability Report
about: Report a security vulnerability in Puntovivo
title: '[SECURITY] '
labels: security, high-priority, vulnerability
assignees: ''
---

## Summary

A comprehensive security analysis has identified multiple vulnerabilities in the Puntovivo POS system. This issue tracks the remediation of these security concerns.

**Full Report:** See `docs/SECURITY.md` for complete details.

---

## Critical Issues

### 1. Weak Default Credentials

- **Location:** `packages/server/src/db/seed.ts`
- **Issue:** ~~Hardcoded default password `admin123` for `admin@localhost`~~ **FIXED**
- **Risk:** ~~Anyone can gain admin access using publicly documented credentials~~
- **Priority:** CRITICAL - Fix immediately

**Action Items:**

- [x] Generate random password during database seed
- [x] Remove default credentials from README.md
- [ ] Force password change on first login
- [x] Stop logging passwords to console (password is shown once during seed only)

---

## High Severity Issues

### 2. No Rate Limiting on Authentication

- **Location:** `packages/server/src/routes/auth.ts`
- **Issue:** ~~Login endpoint allows unlimited attempts~~ **FIXED**
- **Risk:** ~~Brute force and credential stuffing attacks~~
- **Priority:** HIGH

**Action Items:**

- [x] Install `@fastify/rate-limit`
- [x] Implement 5 attempts per 15 minutes limit
- [ ] Add account lockout after repeated failures

### 3. React Router XSS Vulnerability

- **Package:** `@remix-run/router` <= 1.23.1
- **CVE:** GHSA-2w69-qvjg-hvjx
- **Risk:** Open redirect XSS attacks
- **Priority:** HIGH

**Action Items:**

- [ ] Run `npm audit fix` to update react-router-dom
- [ ] Test application after update

### 4. node-tar Path Traversal Vulnerabilities

- **Package:** `tar` <= 7.5.6
- **CVEs:** Multiple (GHSA-8qq5-rm4j-mr97, GHSA-r6q2-hw4h-h46w, GHSA-34x7-hfp2-rc4v)
- **Risk:** Arbitrary file overwrite during package operations
- **Priority:** HIGH

**Action Items:**

- [ ] Update tar package to latest version
- [ ] Update @electron-forge dependencies

---

## Medium Severity Issues

### 5. Weak JWT Secret Generation

- **Location:** `packages/server/src/index.ts:150-157`
- **Issue:** Using `Math.random()` instead of cryptographically secure random
- **Risk:** Predictable tokens could be forged

**Action Items:**

- [ ] Replace `Math.random()` with `crypto.randomBytes()`

### 6. Weak Password Requirements

- **Location:** `packages/server/src/routes/auth.ts`
- **Issue:** ~~Minimum length only 6 characters, no complexity requirements~~ **FIXED**

**Action Items:**

- [x] Require minimum 12 characters
- [x] Require uppercase, lowercase, numbers, special characters

### 7. No Session Invalidation on Password Change

- **Location:** `packages/server/src/routes/auth.ts:200-243`
- **Issue:** Old JWT tokens remain valid after password change

**Action Items:**

- [ ] Add token version to user schema
- [ ] Increment version on password change
- [ ] Validate token version in authentication

### 8. Tenant Isolation Edge Cases

- **Location:** `packages/server/src/routes/collections.ts`
- **Issue:** Tenant isolation might be bypassed if tenantId is null

**Action Items:**

- [ ] Add mandatory tenant ID check for isolated collections
- [ ] Return 403 error if tenant context missing

### 9. DOMPurify XSS Vulnerability

- **Package:** `dompurify` < 3.2.4
- **CVE:** GHSA-vhxf-7vqr-mrjg

**Action Items:**

- [ ] Update dompurify to 3.2.4+
- [ ] May require updating jspdf

### 10. Electron Sandbox Disabled

- **Location:** `apps/desktop/src/main/index.ts:36`

**Action Items:**

- [ ] Enable sandbox mode if possible
- [ ] Test all functionality with sandbox enabled

### 11. Unused IPC Handlers

- **Location:** `apps/desktop/src/preload/index.ts`

**Action Items:**

- [ ] Remove unused IPC APIs from preload script
- [ ] OR implement with proper validation and tenant isolation

---

## Low Severity Issues

### 12. Sensitive Data in Logs

- **Location:** `packages/server/src/db/seed.ts:82`
- [ ] Remove password from production logs

### 13. Development CORS Origins in Production

- **Location:** `packages/server/src/index.ts:57-62`
- [ ] Add environment-based CORS configuration

---

## Testing Requirements

Before closing this issue, ensure:

- [ ] All critical and high severity issues resolved
- [ ] Security test suite created and passing
- [ ] Code review completed
- [ ] Documentation updated

---

## References

- Full analysis report: `docs/SECURITY.md`
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Electron Security Checklist](https://www.electronjs.org/docs/latest/tutorial/security)
