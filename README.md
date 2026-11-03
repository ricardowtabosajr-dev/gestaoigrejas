# Sistema de Gestão para Igrejas

API REST (Node.js + Express + Prisma) com painel web, multiusuário, permissões por cargo e escopo por igreja/filial.

## Executar

```bash
npm install
cp .env.example .env          # defina JWT_SECRET e as conexões do Supabase
npm run db:deploy             # cria as tabelas no Postgres/Supabase
node prisma/seed.js --demo    # cargos, sede, admin e dados de exemplo (omita --demo em produção)
npm start                     # http://localhost:3000
npm test                      # testes de integração: gravam dados de teste e exigem `node prisma/seed.js --demo`; NÃO rode no banco de produção
```

Login inicial: `admin@igreja.local` / `Mudar@123` (troca de senha solicitada). Inscrição pública: `/inscricao.html`.

Banco: PostgreSQL (Supabase). Preencha `DATABASE_URL` e `DIRECT_URL` no `.env` (veja `.env.example`) e use `npm run db:deploy` em vez de `db:push`.

## Deploy: Supabase + Vercel

1. **Supabase:** crie o projeto e copie as duas strings de conexão (Settings → Database): *Transaction pooler* (6543) → `DATABASE_URL` e *Session/direct* (5432) → `DIRECT_URL`.
2. **Tabelas:** na sua máquina, com o `.env` preenchido, rode `npm run db:deploy` (aplica `prisma/migrations`, que também ativa RLS em todas as tabelas) e `node prisma/seed.js` (sem `--demo`).
3. **Vercel:** importe o repositório e cadastre as variáveis: `DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET` (≥32 caracteres), `NODE_ENV=production`, `PUBLIC_URL` (https://seu-dominio), `CRON_SECRET` (aleatório longo), `WHATSAPP_*`, `PAYMENT_PROVIDER` e tokens do gateway.
4. O `vercel.json` já roteia `/api/*` para `api/index.js`, serve `public/` como site e agenda o cron diário dos aniversariantes (11:00 UTC = 08:00 Brasília).
5. Webhook do Mercado Pago: `https://seu-dominio/api/webhooks/mercadopago`.

Pontos de atenção na Vercel: não há processo contínuo (por isso o cron é da Vercel e as inscrições atualizam por *polling* de 5 s); o limite de requisições (`express-rate-limit`) é por instância; envio de aniversários tem teto de ~45 s por execução (o restante sai ao reexecutar `POST /api/messages/birthdays/run?dryRun=false`). Nunca exponha a `service_role` do Supabase no front-end: o painel só fala com `/api`.

## Módulos

| Módulo | Onde | Destaques |
|---|---|---|
| Igrejas/filiais | `src/modules/churches.js` | árvore matriz→filiais, status de expansão (planejada, em implantação, ativa), previsão de abertura |
| Cultos e agenda | `events.js` | cultos, retiros, seminários, congressos e agenda externa (evangelismo, ação social, missões); geração de cultos semanais; chamada (frequência) |
| Membros e discipulado | `members.js` | perfil completo, jornada de fé (conversão, batismo, Escola de Líderes), árvore de discipulado (com bloqueio de ciclos), histórico e conquistas |
| Células | `cells.js` | participantes, reuniões com presença, visitantes, conversões, estatísticas de crescimento e frequência |
| Financeiro | `finance.js` | caixas, dízimos, ofertas, doações, mantenedores, oferta alçada, construção, entradas de eventos, saídas; extrato por membro; exclusões auditadas |
| Inscrições | `registrations.js`, `services/payments.js` | página pública, gateway (Mercado Pago ou simulado), webhook idempotente, lista pago/pendente atualizada a cada 5 s, lança entrada no caixa ao pagar |
| Aniversariantes | `services/birthdays.js`, `jobs/scheduler.js` | cron diário, mensagem editável (`{nome}`, `{igreja}`), idempotente por membro/ano, respeita consentimento, log de envios |
| Visitantes (QR code) | `visits.js`, `public/visitante.html` | QR por igreja (rotacionável), formulário público com consentimento LGPD, reconhecimento de retorno por telefone, presença no culto em andamento, boas-vindas por WhatsApp (modelo `welcome_template`, uma vez por pessoa), painel de acompanhamento |
| Relatórios | `reports.js` | painel, frequência por culto, presentes/ausentes por membro, crescimento, finanças, desempenho por departamento |

## Segurança e permissões

- Login com bcrypt, JWT, bloqueio após 5 falhas (15 min), rate limit, Helmet/CSP, validação Zod em toda entrada.
- Permissões `recurso:ação` (ex.: `finance:write`) por cargo, recarregadas do banco a cada requisição (desativar usuário ou mudar cargo vale na hora).
- Cargos padrão: Apóstolo (tudo, todas as igrejas), Pastor, Missionário, Diácono, Obreiro, Tesoureiro, Secretário, Líder de Célula, Membro. Cargos novos: `POST /api/users/roles`.
- Escopo: quem não tem “todas as igrejas” só vê a própria igreja e filiais diretas. Ninguém atribui cargo acima do seu.
- Auditoria (`AuditLog`) de criações, alterações, exclusões e logins.

## Integrações (configure no `.env`)

- **WhatsApp** (`WHATSAPP_PROVIDER`): `log` (só console), `evolution` (Evolution API) ou `cloud` (API oficial da Meta). Na API oficial, mensagens ativas fora da janela de 24h exigem *template* aprovado; ajuste `src/services/whatsapp.js` para enviar template. Mensagens automáticas dependem do consentimento do membro (campo `receiveBirthdayMsg`) — respeite a LGPD.
- **Pagamentos** (`PAYMENT_PROVIDER`): `mock` (dev) ou `mercadopago` (`MERCADOPAGO_ACCESS_TOKEN`; `PUBLIC_URL` precisa ser público para o webhook `/api/webhooks/mercadopago`). O webhook consulta o pagamento na API do gateway e confere o valor antes de confirmar. Para outro gateway, implemente `createCheckout` em `services/payments.js`.

## Limitações conhecidas

- A lista de inscrições atualiza por polling (5 s), não por push.
- Valida-se o formato do CPF (11 dígitos), não os dígitos verificadores.
- O painel cobre os fluxos principais; edição/exclusão de alguns registros (células, lançamentos) é feita pela API.
- Não há recuperação de senha por e-mail nem upload de fotos (campo `photoUrl` aceita URL).
