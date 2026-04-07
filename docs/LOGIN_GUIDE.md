# Login System Guide

## Overview

Open Yojob uses a JWT-based authentication system with secure password hashing (Argon2) and role-based access control (RBAC).

## Default Credentials

When you first run the application, a default admin account is automatically created:

- **Email**: `admin@localhost`
- **Password**: A cryptographically random password is generated on first run and displayed **once** in the server console output. Copy it immediately.

⚠️ **Important**: The generated password is only shown once in the console. If you miss it, delete the database file and restart to re-seed.

## How Login Works

### Architecture

1. **Frontend** (React): Login page with form validation
2. **API Client**: Handles tRPC requests and JWT token storage
3. **Backend** (Fastify): Validates credentials and generates JWT tokens
4. **Database** (SQLite): Stores user accounts with hashed passwords

### Authentication Flow

```
User enters credentials
    ↓
Frontend validates email/password format
    ↓
API calls `auth.login` on `/api/trpc`
    ↓
Backend validates credentials against database
    ↓
Backend generates JWT token (valid for 7 days)
    ↓
Frontend stores token in localStorage
    ↓
User is redirected to /dashboard
```

## Running the Application

### Option 1: Desktop App (Recommended for End Users)

The desktop app includes an embedded backend server:

```bash
npm run dev
```

**What it does**:

- Starts Electron app
- Automatically starts embedded Fastify server
- Opens the login screen
- Everything is self-contained

### Option 2: Web App (Recommended for Development)

The web app requires both backend and frontend servers:

```bash
# Run both servers together (easiest way)
npm run dev:fullstack
```

This starts:

- Backend server on http://localhost:8090
- Frontend server on http://localhost:3000

Then open http://localhost:3000 in your browser.

**Alternative** (run servers separately):

```bash
# Terminal 1 - Backend
npm run dev:server

# Terminal 2 - Frontend
npm run dev:web
```

## Troubleshooting Login Issues

### Issue 1: "Cannot connect to server" Error

**Symptoms**: Login button shows error message about server connection

**Cause**: Backend server is not running

**Solution**:

```bash
# For web app, run both servers:
npm run dev:fullstack

# Or verify backend is running:
curl http://localhost:8090/api/health
# Should return: {"status":"ok","timestamp":"..."}
```

### Issue 2: "Invalid credentials" Error

**Symptoms**: Login form shows "Email or password is incorrect"

**Possible causes**:

1. Incorrect email or password
2. User account is disabled
3. Database is not seeded

**Solutions**:

1. **Use the correct default credentials**:
   - Email: `admin@localhost` (not `admin@localhost.com`)
   - Password: the random password printed in the server console on first run

2. **Verify database is seeded**:

   ```bash
   # Check server logs when it starts
   # You should see: "[Database] Default data seeded successfully"
   ```

3. **Reset database** (if needed):

   ```bash
   # For desktop app:
   # Delete the database file and restart
   # - macOS: ~/Library/Application Support/open-yojob/data/local.db
   # - Windows: %APPDATA%\open-yojob\data\local.db
   # - Linux: ~/.config/open-yojob/data/local.db

   # For web/standalone server:
   rm packages/server/data/local.db
   npm run dev:server  # Will recreate with default admin
   ```

### Issue 3: Desktop App Won't Start

**Symptoms**: Electron app crashes or shows errors

**Cause**: Native modules (like better-sqlite3) not compiled for Electron

**Solution**:

```bash
# Rebuild native modules for Electron
npx electron-rebuild -m apps/desktop

# Then try again
npm run dev
```

### Issue 4: Email Validation Error

**Symptoms**: "Invalid email address" shown for `admin@localhost`

**Status**: This should NOT happen - the email validation regex accepts addresses without TLDs.

**If it does happen**:

1. Check browser console for JavaScript errors
2. Verify you're using the latest code
3. Try a different email format: `admin@example.com` (you'll need to create this user in the database)

## Verification Script

Use the built-in verification script to check your setup:

```bash
./scripts/check-setup.sh
```

This checks:

- Node.js and npm versions
- Dependencies installation
- Backend server status (port 8090)
- Frontend server status (port 3000)
- Provides quick start commands

## Auth Procedures

Canonical auth transport is tRPC on `/api/trpc`.

### Login

```
Mutation: auth.login
Input: { email: "admin@localhost", password: "<your-generated-password>" }
Output: { token: "...", user: {...}, tenant: {...} }
```

### Get Current User

```
Query: auth.me
Auth: Bearer token
Output: { user: {...}, tenant: {...} }
```

### Logout

```
Mutation: auth.logout
Output: { success: true }
Note: Token is still cleared client-side in localStorage
```

### Change Password

```
Mutation: auth.changePassword
Auth: Bearer token
Input: { currentPassword: "...", newPassword: "..." }
Output: { success: true }
```

## Security Features

1. **Password Hashing**: Argon2 (memory-hard, resistant to GPU attacks)
2. **JWT Tokens**: Signed with server secret, 7-day expiration
3. **Token Storage**: localStorage (cleared on logout)
4. **Role-Based Access**: Admin, Manager, Cashier, Viewer roles
5. **Account Status**: Can disable user accounts
6. **Tenant Isolation**: Multi-tenant architecture with data separation

## Testing Login Programmatically

### Using curl

```bash
# Login via tRPC
curl -X POST "http://localhost:8090/api/trpc/auth.login?batch=1" \
  -H "Content-Type: application/json" \
  -d '{"0":{"json":{"email":"admin@localhost","password":"<your-generated-password>"}}}'

# Get user info (replace TOKEN with actual token from login response)
curl "http://localhost:8090/api/trpc/auth.me?batch=1&input=%7B%220%22%3A%7B%22json%22%3Anull%7D%7D" \
  -H "Authorization: Bearer TOKEN"
```

### Using JavaScript (browser console)

```javascript
import { createTRPCClient, httpBatchLink } from '@trpc/client';

const client = createTRPCClient({
  links: [
    httpBatchLink({
      url: 'http://localhost:8090/api/trpc',
    }),
  ],
});

const data = await client.auth.login.mutate({
  email: 'admin@localhost',
  password: '<your-generated-password>',
});

console.log('Token:', data.token);
```

## FAQ

**Q: Can I use a custom email domain?**
A: Yes, but you need to manually create users in the database or implement a registration feature.

**Q: How do I change the admin password?**
A: Login and use the Settings page, or call the `auth.changePassword` tRPC procedure.

**Q: How long do JWT tokens last?**
A: 7 days by default. After expiration, users must login again.

**Q: Can I use OAuth/SSO?**
A: Not currently implemented. You'd need to add OAuth providers to the backend.

**Q: Is the login secure?**
A: Yes, for local/internal use:

- Passwords hashed with Argon2
- JWT tokens for sessions
- HTTPS recommended for production
- However, this is designed for desktop/local use, not public internet

## Getting Help

If you're still having issues:

1. Check the [README.md](../README.md) troubleshooting section
2. Review server logs for error messages
3. Open an issue on GitHub with:
   - Error messages
   - Server logs
   - Steps to reproduce
   - Your environment (OS, Node version)
