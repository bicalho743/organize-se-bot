#!/bin/bash
# =============================================
# Script de inicialização do repositório Git
# Execute UMA VEZ para criar e subir o projeto
# =============================================

set -e

REPO_NAME="organize-se-bot"
GITHUB_USER="bicalho743"  # <- ajuste se necessário

echo "🚀 Inicializando repositório Git..."

cd /home/claude/organize-se-bot

git init
git add .
git commit -m "feat: initial commit — Organize-se Bot

- Shopee Affiliate API integration (top products + flash deals)
- Quality pipeline: Writer → Critic → Editor (GPT-4o)
- Modular brain system (/brain)
- Telegram cockpit with full queue management
- Auto-scheduler: 5 posts/day + 3 Shopee fetches/day
- SQLite queue with deduplication
- Railway deploy ready"

echo ""
echo "✅ Commit criado!"
echo ""
echo "Agora execute os comandos abaixo para subir no GitHub:"
echo ""
echo "  gh repo create ${GITHUB_USER}/${REPO_NAME} --private --source=. --remote=origin --push"
echo ""
echo "  OU, se já criou o repo no GitHub:"
echo "  git remote add origin https://github.com/${GITHUB_USER}/${REPO_NAME}.git"
echo "  git branch -M main"
echo "  git push -u origin main"
echo ""
echo "Depois configure as variáveis no Railway e conecte o repositório."
