#!/bin/bash
set -e

INSTALL_DIR="$HOME/.npm-global/bin"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Create bin directory if it doesn't exist
mkdir -p "$INSTALL_DIR"

# Create wrapper script
cat > "$INSTALL_DIR/claudeclone" << EOF
#!/bin/bash
cd "$REPO_DIR" && \$(which bun) run ./src/entrypoints/cli.tsx "\$@"
EOF
chmod +x "$INSTALL_DIR/claudeclone"

# Add to PATH if not already there
if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
    echo "export PATH=\"\$INSTALL_DIR:\$PATH\"" >> ~/.bashrc
    echo "Added \$INSTALL_DIR to PATH. Run 'source ~/.bashrc' or restart your shell."
fi
echo "ClaudeClone installed! Run 'claudeclone' from any directory."
