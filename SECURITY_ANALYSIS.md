# Security Vulnerability Analysis Report

**Project:** Open Yojob  
**Date:** 2026-02-03  
**Analysis Type:** Comprehensive Security Review

## Executive Summary

This report documents security vulnerabilities identified in the Open Yojob POS system. The analysis covers dependency vulnerabilities, authentication/authorization issues, and application-specific security concerns.

### Severity Levels

- **CRITICAL** ⚠️ - Requires immediate attention
- **HIGH** 🔴 - Should be fixed soon
- **MEDIUM** 🟡 - Should be addressed in upcoming releases
- **LOW** 🔵 - Can be addressed as time permits

---

## 1. Dependency Vulnerabilities (HIGH 🔴)

### 1.1 React Router Open Redirect XSS (HIGH 🔴)

**Package:** `@remix-run/router` <= 1.23.1  
**Affected:** `react-router-dom@6.0.0 - 6.30.2`  
**CVE:** GHSA-2w69-qvjg-hvjx  
**Severity:** HIGH

**Description:**  
React Router is vulnerable to XSS via Open Redirects. An attacker could craft URLs that redirect users to malicious sites.

**Remediation:**

```bash
npm audit fix --force
# Will update to react-router-dom@6.30.3+
```

**Impact:** Could allow attackers to redirect users to phishing sites or malicious content.

---

### 1.2 DOMPurify XSS Vulnerability (MEDIUM 🟡)

**Package:** `dompurify` < 3.2.4  
**Affected:** `jspdf` dependencies  
**CVE:** GHSA-vhxf-7vqr-mrjg  
**Severity:** MEDIUM

**Description:**  
DOMPurify has a Cross-site Scripting (XSS) vulnerability that could allow malicious scripts to execute.

**Remediation:**

```bash
npm update dompurify@latest
# May require updating jspdf to version 4.1.0+
```

**Impact:** Potential XSS attacks when rendering PDF content.

---

### 1.3 esbuild Development Server Vulnerability (MEDIUM 🟡)

**Package:** `esbuild` <= 0.24.2  
**CVE:** GHSA-67mh-4wv8-2f99  
**Severity:** MEDIUM (Development only)

**Description:**  
esbuild enables any website to send requests to the development server and read responses.

**Remediation:**

```bash
npm update esbuild@latest
npm update vite@latest
npm update drizzle-kit@latest
```

**Impact:** Only affects development environment. Production builds are not affected.

---

### 1.4 node-tar Path Traversal Vulnerabilities (HIGH 🔴)

**Package:** `tar` <= 7.5.6  
**CVEs:**

- GHSA-8qq5-rm4j-mr97 (Arbitrary File Overwrite)
- GHSA-r6q2-hw4h-h46w (Race Condition)
- GHSA-34x7-hfp2-rc4v (Hardlink Path Traversal)  
  **Severity:** HIGH

**Description:**  
Multiple path traversal vulnerabilities in node-tar that could allow arbitrary file creation/overwrite.

**Remediation:**

```bash
npm update tar@latest
# May require updating @electron-forge packages
```

**Impact:** Could allow attackers to overwrite arbitrary files during package installation or extraction.

---

## 2. Authentication & Authorization Issues

### 2.1 Weak Default Credentials (CRITICAL ⚠️)

**Location:** `packages/server/src/db/seed.ts`

**Description:**  
The application uses weak, hardcoded default credentials that are documented in multiple places:

```typescript
export const DEFAULT_ADMIN = {
  email: 'admin@localhost',
  password: 'admin123', // ⚠️ WEAK PASSWORD
  name: 'Administrator',
};
```

These credentials are also documented in:

- `README.md` (line 133-135)
- Database seed logs (printed to console)

**Severity:** CRITICAL ⚠️

**Vulnerabilities:**

1. Weak password that can be easily guessed
2. Well-known credentials documented publicly
3. No forced password change on first login
4. Password is logged to console during seeding

**Remediation:**

1. **Immediate Actions:**
   - Remove default credentials from README
   - Generate random password during seed
   - Force password change on first login
   - Add warning banner for default installations

2. **Code Changes:**

```typescript
// Generate secure random password
import { randomBytes } from 'crypto';

export async function seedDefaultData(db: DatabaseInstance): Promise<void> {
  // ... existing code ...

  // Generate a secure random password
  const randomPassword = randomBytes(16).toString('base64');

  // Hash the password
  const passwordHash = await argon2.hash(randomPassword);

  // Create admin user with requirePasswordChange flag
  await db.insert(users).values({
    id: userId,
    tenantId: tenantId,
    email: DEFAULT_ADMIN.email,
    name: DEFAULT_ADMIN.name,
    passwordHash: passwordHash,
    role: 'admin',
    isActive: true,
    requirePasswordChange: true, // Add this field to schema
    createdAt: now,
    updatedAt: now,
  });

  // Log the password securely (only during initial setup)
  console.log('[Database] ⚠️  IMPORTANT: Save these credentials!');
  console.log(`[Database] Email: ${DEFAULT_ADMIN.email}`);
  console.log(`[Database] Password: ${randomPassword}`);
  console.log('[Database] ⚠️  You MUST change this password on first login!');
}
```

**Impact:** Attackers can gain full administrative access using well-known credentials.

---

### 2.2 JWT Secret Generation Weakness (MEDIUM 🟡)

**Location:** `packages/server/src/index.ts:150-157`

**Description:**  
The JWT secret is generated using `Math.random()`, which is not cryptographically secure:

```typescript
function generateSecret(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 64; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length)); // ⚠️ NOT CRYPTOGRAPHICALLY SECURE
  }
  return result;
}
```

**Severity:** MEDIUM 🟡

**Remediation:**

```typescript
import { randomBytes } from 'crypto';

function generateSecret(): string {
  // Use cryptographically secure random bytes
  return randomBytes(32).toString('base64');
}
```

**Impact:** Predictable JWT secrets could allow attackers to forge authentication tokens.

---

### 2.3 No Rate Limiting on Authentication Endpoints (HIGH 🔴)

**Location:** `packages/server/src/routes/auth.ts`

**Description:**  
The login endpoint has no rate limiting, allowing unlimited login attempts:

```typescript
app.post<{ Body: LoginBody }>('/login', {
  schema: {
    /* ... */
  },
  handler: async (request, reply) => {
    // No rate limiting implemented
    const { email, password } = request.body;
    // ... authentication logic ...
  },
});
```

**Severity:** HIGH 🔴

**Vulnerabilities:**

1. Brute force attacks possible
2. Credential stuffing attacks possible
3. No account lockout mechanism
4. No failed login tracking

**Remediation:**

Install rate limiting package:

```bash
npm install @fastify/rate-limit
```

Implement rate limiting:

```typescript
import rateLimit from '@fastify/rate-limit';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Register rate limiter for auth routes
  await app.register(rateLimit, {
    max: 5, // 5 attempts
    timeWindow: '15 minutes',
    errorResponseBuilder: function (request, context) {
      return {
        error: 'Too Many Requests',
        message: `Too many login attempts. Please try again in ${Math.ceil(context.ttl / 1000 / 60)} minutes.`,
      };
    },
  });

  app.post<{ Body: LoginBody }>('/login', {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '15 minutes',
      },
    },
    // ... rest of handler
  });
}
```

**Impact:** Allows unlimited brute force and credential stuffing attacks.

---

### 2.4 Missing Password Strength Requirements (MEDIUM 🟡)

**Location:** `packages/server/src/routes/auth.ts:207-209`

**Description:**  
Password change endpoint only requires minimum length of 6 characters:

```typescript
newPassword: { type: 'string', minLength: 6 },  // ⚠️ Too weak
```

**Severity:** MEDIUM 🟡

**Remediation:**

Add password validation:

```typescript
function validatePasswordStrength(password: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (password.length < 12) {
    errors.push('Password must be at least 12 characters');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// In the handler
const validation = validatePasswordStrength(newPassword);
if (!validation.valid) {
  return reply.status(400).send({
    error: 'Weak password',
    details: validation.errors,
  });
}
```

**Impact:** Users can set weak passwords that are easily compromised.

---

### 2.5 No Session Invalidation on Password Change (MEDIUM 🟡)

**Location:** `packages/server/src/routes/auth.ts:200-243`

**Description:**  
When a user changes their password, existing JWT tokens remain valid. There's no mechanism to invalidate old sessions.

**Severity:** MEDIUM 🟡

**Remediation:**

Option 1: Add token version to user record:

```typescript
// Update user schema to include tokenVersion
// Increment on password change
await app.db
  .update(users)
  .set({
    passwordHash: newPasswordHash,
    tokenVersion: (user.tokenVersion || 0) + 1, // Invalidate old tokens
    updatedAt: new Date().toISOString(),
  })
  .where(eq(users.id, payload.userId));
```

Option 2: Implement token blacklist with Redis or in-memory store.

**Impact:** Stolen tokens remain valid after password change, allowing continued unauthorized access.

---

## 3. Data Security Issues

### 3.1 SQL Injection Protection (LOW 🔵)

**Location:** `packages/server/src/routes/collections.ts`

**Status:** ✅ PROTECTED (using Drizzle ORM)

**Description:**  
The application uses Drizzle ORM which provides parameterized queries, protecting against SQL injection. However, there are areas with dynamic table access using `@ts-ignore` comments that should be monitored.

**Recommendation:**  
Continue using ORM for all database operations. Avoid raw SQL queries where possible.

---

### 3.2 Tenant Isolation Verification (MEDIUM 🟡)

**Location:** `packages/server/src/routes/collections.ts:106-109, 163-170`

**Description:**  
Tenant isolation relies on proper token validation and tenant ID filtering. Some edge cases might not be fully covered:

```typescript
// If tenantId is somehow null/undefined, isolation might be bypassed
if (TENANT_ISOLATED_COLLECTIONS.includes(collection) && request.tenantId) {
  query = query.where(eq(table.tenantId, request.tenantId));
}
```

**Severity:** MEDIUM 🟡

**Remediation:**

```typescript
// Make tenant isolation mandatory for protected collections
if (TENANT_ISOLATED_COLLECTIONS.includes(collection)) {
  if (!request.tenantId) {
    return reply.status(403).send({
      error: 'Forbidden',
      message: 'Tenant context required',
    });
  }
  query = query.where(eq(table.tenantId, request.tenantId));
}
```

**Impact:** Potential data leakage between tenants if tenant ID is not properly set.

---

### 3.3 Sensitive Data Exposure in Logs (LOW 🔵)

**Location:** `packages/server/src/db/seed.ts:82`

**Description:**  
Default admin password is logged to console:

```typescript
console.log(`[Database] Admin user: ${DEFAULT_ADMIN.email} / ${DEFAULT_ADMIN.password}`);
```

**Severity:** LOW 🔵

**Remediation:**  
Remove password from logs or only show password once during initial setup with clear warnings.

**Impact:** Passwords visible in application logs and terminal history.

---

## 4. Electron-Specific Security Issues

### 4.1 Context Isolation Enabled (GOOD ✅)

**Location:** `apps/desktop/src/main/index.ts:37-38`

**Status:** ✅ SECURE

```typescript
contextIsolation: true,
nodeIntegration: false,
```

The application correctly uses context isolation and disables node integration.

---

### 4.2 Sandbox Disabled (MEDIUM 🟡)

**Location:** `apps/desktop/src/main/index.ts:36`

**Description:**

```typescript
sandbox: false,  // ⚠️ Sandbox is disabled
```

**Severity:** MEDIUM 🟡

**Recommendation:**  
Enable sandbox mode if possible:

```typescript
sandbox: true,
```

Test all functionality to ensure it works with sandbox enabled. If specific features require sandbox to be disabled, document the security implications.

**Impact:** Reduced security boundaries between renderer and main process.

---

### 4.3 IPC Database Operations Not Implemented (MEDIUM 🟡)

**Location:** `apps/desktop/src/preload/index.ts:34-51`

**Description:**  
The preload script exposes database and sync APIs but the corresponding IPC handlers are not implemented in the main process:

```typescript
const dbAPI: DatabaseAPI = {
  getAll: (table: string, tenantId: string) => ipcRenderer.invoke('db:getAll', table, tenantId),
  // ... other methods
};
```

**Severity:** MEDIUM 🟡

**Issue:**  
These handlers are declared but never implemented, which could lead to:

1. Runtime errors when called
2. Security bypass if hastily implemented without proper validation

**Remediation:**  
Either:

1. Remove unused IPC handlers from preload script
2. Implement handlers with proper input validation and tenant isolation

**Impact:** Could lead to unexpected behavior or security issues if implemented without proper validation.

---

## 5. CORS Configuration

### 5.1 Development CORS Origins (LOW 🔵)

**Location:** `packages/server/src/index.ts:57-62`

**Description:**  
CORS is configured to allow development origins by default:

```typescript
corsOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
],
```

**Severity:** LOW 🔵 (Development only)

**Recommendation:**  
Ensure these are not used in production builds. Add environment-based CORS configuration:

```typescript
corsOrigins = isDevelopment ? [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
] : [],  // No CORS needed for Electron
```

**Impact:** Minimal in Electron context, but should be reviewed for web deployment.

---

## 6. Recommendations Summary

### Immediate Actions (CRITICAL/HIGH)

1. **Replace default credentials** with secure random generation
2. **Update vulnerable dependencies** (React Router, node-tar)
3. **Implement rate limiting** on authentication endpoints
4. **Fix JWT secret generation** to use cryptographically secure random
5. **Add mandatory tenant isolation checks**

### Short-term Actions (MEDIUM)

1. **Implement password strength requirements**
2. **Add session invalidation** on password change
3. **Review and fix/remove** unused IPC handlers
4. **Enable sandbox mode** in Electron if possible
5. **Update DOMPurify** and jspdf dependencies

### Long-term Improvements (LOW)

1. **Add security headers** (CSP, HSTS, etc.)
2. **Implement audit logging** for sensitive operations
3. **Add two-factor authentication** support
4. **Regular dependency audits** and updates
5. **Security testing** (penetration testing, code review)

---

## 7. Testing Recommendations

### Security Testing Checklist

- [ ] Penetration testing of authentication system
- [ ] SQL injection testing (though ORM provides protection)
- [ ] XSS testing in all user input fields
- [ ] CSRF token implementation review
- [ ] Session management testing
- [ ] Authorization boundary testing
- [ ] Tenant isolation testing
- [ ] Rate limiting effectiveness testing
- [ ] Password policy enforcement testing

---

## 8. Compliance Considerations

### Data Protection

- **PCI DSS**: If processing payments, ensure PCI compliance
- **GDPR**: If serving EU users, implement GDPR requirements
- **Data Encryption**: Consider encrypting sensitive data at rest
- **Audit Trails**: Implement comprehensive audit logging

---

## 9. References

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Electron Security Best Practices](https://www.electronjs.org/docs/latest/tutorial/security)
- [Fastify Security](https://fastify.dev/docs/latest/Guides/Security/)
- [NPM Audit Documentation](https://docs.npmjs.com/cli/v8/commands/npm-audit)

---

## Appendix: Automated Scan Results

### npm audit (2026-02-03)

```
High severity vulnerabilities: 4
- @remix-run/router (XSS)
- node-tar (Path Traversal - 3 CVEs)

Moderate severity vulnerabilities: 2
- dompurify (XSS)
- esbuild (Development Server)

Total known vulnerabilities: 6
```

### Manual Code Review

- Files reviewed: 15+
- Security-sensitive endpoints: 8
- Authentication flows: 1
- Authorization checks: Multiple

---

**End of Report**
