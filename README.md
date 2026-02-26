# LeadFlow Nexus Pro (LFN)

Plataforma profissional para gestão de leads **com consentimento (opt-in)**, criação de campanhas por nicho e geração de relatórios de desempenho.

## Marca e posicionamento

- **Nome do programa:** LeadFlow Nexus Pro
- **Sigla:** LFN
- **Proprietário:** Wander Pires Silva Coelho
- **Direitos:** Todos os direitos reservados ao proprietário.

## Domínio sugerido (SEO)

- `leadflownexuspro.com.br`
- `disparolegalwhatsapp.com.br`

> Observação: registre o domínio disponível no seu provedor preferido e valide a marca no INPI para proteção jurídica.

## Importante (legal e compliance)

Este projeto é estruturado para uso **legal**:

- Apenas leads com consentimento explícito.
- Registros de origem do consentimento (LGPD).
- Opt-out/cancelamento obrigatório.
- Sem coleta não autorizada de contatos em redes sociais ou sites.

## Stack inicial gratuita

- **Backend:** Node.js + Express
- **Database:** JSON local (`backend/data.json`)
- **Observabilidade:** logs no servidor
- **Deploy inicial:** Render/Railway/Servidor VPS básico

## MVP implementado (backend)

- Cadastro de leads com consentimento.
- Criação de campanhas por nicho.
- Simulação de disparo com status de entrega.
- Relatório consolidado de envios, recebimentos e atendimento.

## Como executar

1. Acesse a pasta do backend:
   - `cd lpl-leadflow-pro/backend`
2. Instale as dependências:
   - `npm install`
3. Rode em modo desenvolvimento:
   - `npm run dev`
4. API disponível em:
   - `http://localhost:3333`

## Dashboard Web (frontend)

1. Em outro terminal, acesse a pasta do frontend:
   - `cd lpl-leadflow-pro/frontend`
2. Inicie um servidor estático local (Python):
   - `python -m http.server 5500`
3. Acesse no navegador:
   - `http://localhost:5500`

## Build do Frontend

1. Acesse a pasta do frontend:
   - `cd lpl-leadflow-pro/frontend`
2. Gere build estático:
   - `npm run build`
3. Arquivos finais:
   - `frontend/dist`

## Deploy (Surge)

### Manual (rápido)

1. Instale o Surge globalmente:
   - `npm install -g surge`
2. Gere build:
   - `cd lpl-leadflow-pro/frontend`
   - `npm run build`
3. Configure a URL da API no build:
   - edite `frontend/dist/config.js` com a URL pública do backend
4. Publique:
   - `surge ./dist seu-dominio.surge.sh`

### Via GitHub Actions

Workflow já criado em:

- `.github/workflows/deploy-frontend-surge.yml`

Configure os secrets do repositório:

- `SURGE_TOKEN`
- `SURGE_DOMAIN`
- `FRONTEND_API_BASE`

Ao fazer push na branch `main`, o frontend será publicado no Surge automaticamente.

## Deploy do Backend (Render com Docker)

Arquivos prontos:

- `backend/Dockerfile`
- `render.yaml`

Passos:

1. Suba o projeto para GitHub.
2. No Render, crie serviço usando `render.yaml`.
3. Ajuste no `render.yaml` o campo `repo` com seu repositório.
4. Defina variáveis seguras no Render:
   - `ADMIN_EMAIL`
   - `ADMIN_PASSWORD`
5. O backend usará volume persistente com:
   - `DATA_FILE_PATH=/data/data.json`

### Auto deploy por GitHub (Render)

Workflow já criado em:

- `.github/workflows/deploy-backend-render.yml`

Configure no GitHub secret:

- `RENDER_DEPLOY_HOOK`

Como obter:

1. No Render, abra seu serviço backend.
2. Vá em **Settings > Deploy Hook**.
3. Gere o deploy hook e copie a URL.
4. Salve essa URL no secret `RENDER_DEPLOY_HOOK` do repositório GitHub.

Com isso, todo push na branch `main` que altere `backend/**` (ou `render.yaml`) dispara deploy automático.

Painel disponível com:

- Cadastro de leads com consentimento.
- Criação de campanhas por nicho/canal.
- Disparo de campanha (simulação de MVP).
- Métricas consolidadas de envio/entrega/atendimento.
- Login com sessão por token.
- Área de revenda para criação de clientes (multiempresa).
- Recuperação de senha por token.
- Troca obrigatória de senha no primeiro acesso.
- Cadastro comercial com checkout (Pix e cartão parcelado no MVP).
- Conta de teste grátis com limite reduzido de leads.
- Painel do criador/vendedor com clientes, licenças, planos e visão financeira.
- Gestão de planos no admin (criar/ativar/desativar).
- Botões de visualizar senha em todos os formulários.

## Acesso inicial

- **Admin padrão:** `admin@leadflownexuspro.com`
- **Senha padrão:** `Admin@123`
- **Demo de teste:** `demo@leadflownexuspro.com`
- **Senha demo:** `Demo@123`

> Recomenda-se alterar essas credenciais no primeiro acesso.

## Segurança de senha

- No primeiro login com senha inicial/padrão, o sistema exige troca imediata.
- Fluxo de recuperação: gerar token em "Esqueci minha senha" e redefinir senha.
- Política de senha: mínimo 8 caracteres, com letra maiúscula, minúscula e número.

## Segurança de sessão e login

- Sessão com expiração automática (padrão: 120 minutos).
- Bloqueio temporário após tentativas de login inválidas (padrão: 5 tentativas em 15 minutos, bloqueio por 15 minutos).
- O frontend remove sessão expirada e retorna para tela de login automaticamente.

Variáveis opcionais de ambiente no backend:

- `SESSION_TTL_MINUTES`
- `LOGIN_ATTEMPT_WINDOW_MINUTES`
- `MAX_LOGIN_ATTEMPTS`
- `LOGIN_LOCK_MINUTES`

## Auditoria de segurança (admin)

- Endpoint: `GET /api/admin/security-audit`
- Acesso: somente usuário `admin` autenticado.
- Filtros opcionais:
   - `limit` (1 a 500, padrão 100)
   - `event` (ex.: `login_failed`, `login_success`, `session_expired`)
   - `email` (e-mail do ator)

Eventos auditados automaticamente incluem:

- `login_success`, `login_failed`, `login_blocked`
- `login_first_access_required`, `first_access_password_changed`, `first_access_change_failed`
- `forgot_password_requested`, `forgot_password_requested_unknown`
- `reset_password_success`, `reset_password_failed`
- `logout_success`, `session_invalid_token`, `session_expired`

## Estrutura multiempresa

- Cada usuário cliente acessa somente os dados da própria empresa.
- Admin pode criar empresas/clientes e acompanhar operações por conta.
- Leads, campanhas e relatórios são isolados por `company_id`.

## Comercial, licença e pagamento

- Endpoints públicos:
   - `GET /api/public/plans`
   - `POST /api/public/trial/register`
   - `POST /api/public/register-checkout`
   - `POST /api/public/checkout/:saleId/confirm`
- Endpoints internos:
   - `GET /api/client/license`
   - `GET /api/admin/commercial/overview`
   - `GET /api/admin/customers`

Observação: neste MVP o pagamento é simulado (confirmação manual via endpoint). Em produção, integre um gateway real para Pix/cartão.

## Referência de modelos de planos

- Veja o estudo base em `docs/PRICING_REFERENCE.md`.

## Sobre erro "Failed to fetch"

- O frontend agora possui fallback de API e mensagem mais clara de conexão.
- Se estiver usando túnel público temporário, atualize `frontend/config.js` com a URL ativa da API e republique o frontend.

## Deploy definitivo (sem túnel temporário)

Para eliminar instabilidade de URLs `.loca.lt`, use backend fixo no Render + frontend no Surge.

1. Inicializar Git e subir para GitHub (caso ainda não exista repositório):
   - `cd lpl-leadflow-pro`
   - `git init`
   - `git add .`
   - `git commit -m "chore: setup leadflow nexus pro"`
   - `git branch -M main`
   - `git remote add origin https://github.com/SEU-USUARIO/SEU-REPO.git`
   - `git push -u origin main`

2. Backend no Render (URL permanente):
   - No Render, crie um serviço `Blueprint` apontando para seu repositório.
   - O Render lerá o arquivo `render.yaml` automaticamente.
   - Ajuste no `render.yaml` o campo `repo` para seu repositório real.
   - Configure no Render as variáveis seguras:
     - `ADMIN_EMAIL`
     - `ADMIN_PASSWORD`
   - Após deploy, copie a URL final do backend (ex.: `https://lfn-backend.onrender.com`).

3. Frontend no Surge com a URL fixa do backend:
   - `cd lpl-leadflow-pro/frontend`
   - `npm run build`
   - `echo "window.LFN_API_BASES = ['https://SEU-BACKEND.onrender.com'];" > dist/config.js`
   - `echo "window.LFN_API_BASE = window.LFN_API_BASES[0];" >> dist/config.js`
   - `surge ./dist lfn-leadflow-pro.surge.sh`

4. Deploy automático opcional (GitHub Actions):
   - Secrets do GitHub para frontend:
     - `SURGE_TOKEN`
     - `SURGE_DOMAIN`
     - `FRONTEND_API_BASE`
   - Secret do GitHub para backend:
     - `RENDER_DEPLOY_HOOK`

## Próximos passos recomendados

1. Integrar provedores oficiais (WhatsApp Business API / Meta APIs).
2. Adicionar autenticação com perfis de cliente/revenda.
3. Incluir front-end administrativo (pipeline, templates e dashboards).
4. Implementar cobrança/licenciamento para revenda.
