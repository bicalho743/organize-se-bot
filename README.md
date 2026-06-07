# Organize-se Bot 🛍️

Bot autônomo de promoções para X/Twitter e Telegram.

Caça as melhores promoções da Shopee automaticamente, gera posts com alma — sem parecer loja nem robô — e publica no X nos horários de maior engajamento.

---

## Stack

| Componente | Tecnologia |
|---|---|
| Runtime | Node.js >= 18 |
| IA — Geração | OpenAI GPT-4o |
| Fonte de promoções | Shopee Affiliate API |
| Publicação | twitter-api-v2 (OAuth 1.0a) |
| Cockpit | Telegram Bot |
| Agendamento | node-cron |
| Banco | SQLite (better-sqlite3) |
| Deploy | Railway |

---

## Arquitetura

```
src/
├── index.js              # Entry point
└── modules/
    ├── brainLoader.js    # Carrega /brain dinamicamente
    ├── db.js             # SQLite: fila, histórico, sessões
    ├── openai.js         # Quality pipeline: Escritor → Crítico → Editor
    ├── shopee.js         # Shopee Affiliate API
    ├── telegram.js       # Bot Telegram (cockpit)
    ├── twitter.js        # Postagem no X
    └── scheduler.js      # Cron jobs automáticos

brain/
├── personality/
│   ├── identity.md       # Quem é o Organize-se
│   └── writing_style.md  # Como escreve
├── behavior/
│   └── x_behavior.md     # Regras de comportamento no X
└── memory/
    └── memory.md         # Aprendizados acumulados
```

---

## Setup local

```bash
git clone https://github.com/SEU_USER/organize-se-bot
cd organize-se-bot
npm install
cp .env.example .env
# preencha o .env
node src/index.js
```

---

## Variáveis de Ambiente (Railway)

Configure em Settings > Variables:

| Variável | Onde obter |
|---|---|
| `OPENAI_API_KEY` | platform.openai.com |
| `TWITTER_API_KEY` | developer.twitter.com |
| `TWITTER_API_SECRET` | developer.twitter.com |
| `TWITTER_ACCESS_TOKEN` | developer.twitter.com |
| `TWITTER_ACCESS_SECRET` | developer.twitter.com |
| `TELEGRAM_BOT_TOKEN` | @BotFather no Telegram |
| `TELEGRAM_CHAT_ID` | seu chat ID pessoal |
| `SHOPEE_APP_ID` | affiliate.shopee.com.br/open-platform |
| `SHOPEE_SECRET_KEY` | affiliate.shopee.com.br/open-platform |
| `SHOPEE_ACCESS_TOKEN` | affiliate.shopee.com.br/open-platform |
| `MAX_DAILY_POSTS` | padrão: 6 |
| `PORT` | 8080 |

---

## Como obter credenciais Shopee

1. Acesse: https://affiliate.shopee.com.br
2. Cadastre-se como afiliado
3. Vá em: Ferramentas > Open Platform > Criar App
4. Copie: App ID, Secret Key
5. Gere um Access Token em: Ferramentas > Open Platform > Access Token

---

## Comandos Telegram

| Comando | Função |
|---|---|
| `/start` | Mostra todos os comandos |
| `/status` | Posts hoje, fila, últimos tweets |
| `/buscar` | Busca promoções Shopee agora |
| `/fila` | Lista fila de posts pendentes |
| `/postar` | Apresenta próximo da fila para aprovar |
| `/limite` | Ver limite diário atual |
| `/limite [n]` | Alterar limite diário |
| `/post [texto]` | Post manual direto no X |
| `/reply [id] [texto]` | Reply em tweet específico |
| `/limpar` | Limpa fila pendente |
| `REPLY: [id] [contexto]` | Gera reply com IA |
| Texto livre | Gera post a partir de dados brutos |

---

## Agendamento automático

**Posts no X:**
- 08h00, 12h00, 17h00, 20h00, 22h00 (Brasília)

**Busca Shopee:**
- 07h00, 11h30, 16h00 (abastece fila automaticamente)

---

## Deploy Railway

1. Fork este repositório
2. Crie projeto no Railway e conecte o GitHub
3. Configure todas as variáveis de ambiente
4. Push para `main` → Railway faz deploy automático

**ATENÇÃO:** Nunca rode local e Railway ao mesmo tempo (conflito Telegram polling 409).

---

## Fluxo de qualidade dos posts

```
Produto (Shopee)
    ↓
[Escritor GPT-4o] — gera post no estilo Organize-se
    ↓
[Crítico GPT-4o] — verifica: linguagem de loja? fake urgency? robótico?
    ↓
[Editor GPT-4o] — reescreve se rejeitado (até 2 tentativas)
    ↓
Post aprovado → fila SQLite → Telegram para revisão → X
```

---

## Personagem

**Organize-se** é o amigo que vasculha a internet o dia inteiro atrás de promoção real e manda no zap sem cerimônia. Não tem loja, não tem patrocinador, não fica gritando "IMPERDÍVEL!!". Só aparece quando vale a pena.

---

## Próximas evoluções

- [ ] Pelando API como segunda fonte
- [ ] Amazon Associates como terceira fonte
- [ ] Analytics de engajamento por categoria
- [ ] Imagem do produto no tweet
- [ ] Canal Telegram público (segunda audiência)
