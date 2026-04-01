#!/bin/bash
# Quick setup verification script for Open Yojob

echo "======================================"
echo "  Open Yojob - Setup Verification"
echo "======================================"
echo ""

# Check Node.js version
echo "Checking Node.js version..."
NODE_VERSION=$(node -v 2>/dev/null)
if [ $? -eq 0 ]; then
    echo "✓ Node.js: $NODE_VERSION"
    MAJOR_VERSION=$(echo $NODE_VERSION | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$MAJOR_VERSION" -lt 20 ]; then
        echo "⚠ Warning: Node.js 20+ is recommended (you have $NODE_VERSION)"
    fi
else
    echo "✗ Node.js not found. Please install Node.js 20+"
    exit 1
fi

# Check npm version
echo "Checking npm version..."
NPM_VERSION=$(npm -v 2>/dev/null)
if [ $? -eq 0 ]; then
    echo "✓ npm: $NPM_VERSION"
else
    echo "✗ npm not found"
    exit 1
fi

echo ""
echo "Checking if dependencies are installed..."
if [ -d "node_modules" ]; then
    echo "✓ Dependencies installed"
else
    echo "✗ Dependencies not installed. Run: npm install"
    exit 1
fi

echo ""
echo "======================================"
echo "  Checking Servers"
echo "======================================"
echo ""

# Check backend server
echo "Checking backend server (port 8090)..."
if curl -s http://localhost:8090/api/health > /dev/null 2>&1; then
    echo "✓ Backend server is running at http://localhost:8090"
else
    echo "✗ Backend server is NOT running"
    echo "  Start it with: npm run dev:server"
fi

# Check frontend server
echo "Checking frontend server (port 3000)..."
if curl -s http://localhost:3000 > /dev/null 2>&1; then
    echo "✓ Frontend server is running at http://localhost:3000"
else
    echo "✗ Frontend server is NOT running"
    echo "  Start it with: npm run dev:web"
fi

echo ""
echo "======================================"
echo "  Quick Start Commands"
echo "======================================"
echo ""
echo "Desktop App (Electron):"
echo "  npm run dev"
echo ""
echo "Web App (Browser):"
echo "  npm run dev:fullstack"
echo ""
echo "Default Login:"
echo "  Email: admin@localhost"
echo "  Password: (generated on first run, check server console output)"
echo ""
echo "======================================"
