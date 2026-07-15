#!/bin/bash
# QY-EXEC pre-commit Git Hook Installer
# Strictly enforces linter, build, and unit tests before allowing commits.

set -e

HOOK_DIR=".git/hooks"
HOOK_FILE="$HOOK_DIR/pre-commit"

# Ensure we are at the repository root
if [ ! -d ".git" ]; then
  echo "❌ Error: Please run this script from the repository root."
  exit 1
fi

echo "🚀 Setting up local pre-commit hook..."

mkdir -p "$HOOK_DIR"

# Write pre-commit script
cat << 'EOF' > "$HOOK_FILE"
#!/bin/bash
# QY-EXEC Local Consensus Pre-Commit Guard
# "文档负责表达共识，测试负责验证共识，代码负责强制共识。"

set -e

echo "=== 🛡️ Running QY-EXEC Pre-Commit Security & Consistency Checks ==="

# 1. Run Type Check / Linter
echo "🔍 Step 1/3: Running Linter (TypeScript compilation verify)..."
npm run lint

# 2. Run Production Compiler Bundle
echo "📦 Step 2/3: Checking Production Build compiles..."
npm run build

# 3. Run Unit Tests (Including Regression Tests for path traversals, SSRF, and command obfuscations)
echo "🧪 Step 3/3: Running Security and Regression Test Suites..."
npm test

echo "🟢 All local pre-commit guards passed! Commit allowed."
exit 0
EOF

# Make hook script executable
chmod +x "$HOOK_FILE"

echo "🎉 Pre-commit hook successfully installed at: $HOOK_FILE"
echo "   It will automatically run 'npm run lint && npm run build && npm test' on every local commit."
