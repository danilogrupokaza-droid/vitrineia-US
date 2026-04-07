[README.md](https://github.com/user-attachments/files/26543045/README.md)
# VitrineIA CA

> Sistema de captura de leads, follow-up e booking para small businesses nos EUA.
> Stack: Node.js · Express · Supabase · Railway
> Nicho inicial: **Med Spa**

---

## Estrutura do projeto

```
vitrineia-ca/
├── config/
│   └── supabase.js          # Cliente Supabase (US only) com guard de REGION
├── src/
│   ├── index.js             # Entry point – Express app
│   ├── routes/
│   │   ├── health.js        # GET /health
│   │   └── leads.js         # POST/GET/PATCH /api/leads
│   └── utils/
│       └── suppression.js   # Cheque de opt-out antes de qualquer envio
├── supabase/
│   ├── migrations/
│   │   └── 001_initial_schema.sql   # Schema completo do banco US
│   └── seeds/
│       └── med-spa.js       # Seed: negócio + leads de teste
├── .env.example             # Variáveis de ambiente (nunca commitar .env)
├── railway.toml             # Config de deploy Railway
└── package.json
```

---

## Setup — Passo a Passo

### 1. Clone e instale

```bash
git clone https://github.com/SEU_ORG/vitrineia-ca.git
cd vitrineia-ca
npm install
```

### 2. Configure as variáveis de ambiente

```bash
cp .env.example .env
```

Edite `.env` com:
- `SUPABASE_URL` e `SUPABASE_SERVICE_KEY` do projeto US no Supabase
- Credenciais Twilio (A2P 10DLC já registrado)
- API key do Resend

> ⚠️ **Nunca** adicione variáveis do projeto BR neste repo.

### 3. Crie o banco Supabase US

1. Acesse [supabase.com](https://supabase.com) → New Project (separado do BR)
2. Vá em **SQL Editor**
3. Cole e execute o conteúdo de `supabase/migrations/001_initial_schema.sql`
4. Verifique que as 7 tabelas foram criadas: `businesses`, `leads`, `sequences`, `sequence_events`, `bookings`, `suppression_list`, `audit_log`

### 4. Rode o seed (Med Spa)

```bash
npm run seed
```

Isso cria:
- 1 negócio: **Luxe Med Spa** (Miami, FL)
- 3 leads de teste
- 1 exemplo na suppression list

Guarde o `Business ID` exibido no terminal — você vai precisar para testar a API.

### 5. Inicie o servidor local

```bash
npm run dev
```

Servidor disponível em `http://localhost:3000`

---

## API

### Health check

```
GET /health
```

Resposta esperada:
```json
{ "status": "ok", "region": "CA", "db": "connected" }
```

### Criar lead

```
POST /api/leads
Content-Type: application/json

{
  "full_name": "Amanda Torres",
  "email": "amanda@example.com",
  "phone": "+13055550101",
  "business_id": "UUID_DO_NEGOCIO",
  "source": "instagram",
  "sms_consent": true,
  "email_consent": true
}
```

> `sms_consent: true` é **obrigatório** para enviar SMS (compliance TCPA).

### Consultar lead

```
GET /api/leads/:id
```

### Atualizar status do lead

```
PATCH /api/leads/:id/status
Content-Type: application/json

{ "status": "contacted" }
```

Status válidos: `new` · `contacted` · `qualified` · `booked` · `lost` · `unsubscribed`

---

## Deploy no Railway

1. Crie um novo projeto em [railway.app](https://railway.app)
2. Conecte este repo
3. Adicione as variáveis de ambiente no painel do Railway (as mesmas do `.env`)
4. O `railway.toml` já configura o start command automaticamente

---

## Regras de separação BR/US

| Regra | Detalhe |
|---|---|
| Repos separados | BR e US em repos distintos, nunca misturar |
| Projetos Supabase separados | Um projeto por região |
| `REGION=CA` obrigatório | O servidor recusa iniciar sem essa variável |
| Sem variáveis BR aqui | Nenhuma chave `SUPABASE_BR_*` neste repo |
| RLS ativado | Todas as tabelas com Row Level Security habilitado |

---

## Próximos passos (Fases 2–6)

- **Fase 2** – Landing page em inglês (Med Spa) + formulário com consentimento
- **Fase 3** – Worker de SMS (Twilio A2P) + webhook de opt-out
- **Fase 4** – Sofia US + Yasmin US + automações n8n
- **Fase 5** – Templates por nicho + scripts de aquisição
- **Fase 6** – Piloto controlado com 1 cliente real
