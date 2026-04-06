# Configuração da API Permanente do WhatsApp (Meta Cloud API)

Este guia explica como obter um **token de acesso permanente** para a WhatsApp Cloud API e conectá-lo ao LeadFlow Nexus Pro.

> **Token temporário vs. permanente**  
> O token que aparece no painel do Developer Meta expira em **24 horas**. Para envios em produção, você precisa de um **System User Token**, que nunca expira.

---

## Pré-requisitos

| Item | Descrição |
|------|-----------|
| Conta Meta Business | Verificada em [business.facebook.com](https://business.facebook.com) |
| WhatsApp Business Account (WABA) | Criada e ligada ao Business Manager |
| App Meta (tipo Business) | Criado em [developers.facebook.com](https://developers.facebook.com) com produto **WhatsApp** adicionado |
| Número de telefone | Registrado na WABA (pode ser um número real ou o sandbox de testes) |

---

## Passo 1 — Criar o App Meta e Adicionar WhatsApp

1. Acesse [developers.facebook.com/apps](https://developers.facebook.com/apps) → **Criar App**
2. Tipo: **Business** → avance
3. Vincule ao seu **Business Manager**
4. No Dashboard do app → **Adicionar produto** → escolha **WhatsApp** → **Configurar**
5. Em **Configuração** → **Início**, anote:
   - `Phone Number ID` (ex: `123456789012345`)
   - `WhatsApp Business Account ID`

---

## Passo 2 — Criar um Usuário do Sistema (System User) Permanente

Este é o passo mais importante para obter um token que **não expira**.

1. Acesse [business.facebook.com/settings](https://business.facebook.com/settings)
2. Menu lateral → **Usuários** → **Usuários do Sistema**
3. Clique em **Adicionar** → nomeie (ex: `leadflow-api`) → função: **Admin**
4. Clique em **Criar usuário do sistema**

---

## Passo 3 — Conceder Acesso ao App para o System User

1. Ainda em **Usuários do Sistema**, selecione o usuário criado
2. Clique em **Adicionar ativos** → selecione **Apps** → escolha seu app Meta
3. Função: **Admin** (ou no mínimo **Desenvolvedor**) → **Salvar**

---

## Passo 4 — Gerar o Token Permanente

1. Na página do System User, clique em **Gerar novo token**
2. Selecione o **app** que você criou
3. Escopos obrigatórios:
   - `whatsapp_business_messaging`
   - `whatsapp_business_management`
4. **Validade do token:** selecione **Nunca** (ou o maior prazo disponível)
5. Clique em **Gerar token**
6. **Copie o token agora** — ele só aparece uma vez!

> O token tem formato: `EAASeu...Token...Longo`

---

## Passo 5 — Configurar as Variáveis de Ambiente

### Em desenvolvimento local

Crie o arquivo `backend/.env` (baseado em `.env.example`):

```env
WHATSAPP_ACCESS_TOKEN=EAASeu...Token...Longo
WHATSAPP_PHONE_NUMBER_ID=123456789012345
WHATSAPP_GRAPH_API_VERSION=v20.0
WHATSAPP_SEND_DELAY_MS=1200
```

### Em produção (Render.com)

1. Acesse [render.com](https://render.com) → seu serviço `lfn-backend`
2. Aba **Environment**
3. Adicione / edite as variáveis:

| Variável | Valor |
|----------|-------|
| `WHATSAPP_ACCESS_TOKEN` | Token permanente gerado no Passo 4 |
| `WHATSAPP_PHONE_NUMBER_ID` | ID do número (Passo 1) |
| `WHATSAPP_GRAPH_API_VERSION` | `v20.0` |
| `WHATSAPP_SEND_DELAY_MS` | `1200` (padrão) |

4. Clique em **Save Changes** — o Render reiniciará o serviço automaticamente.

---

## Passo 6 — Verificar a Integração

Use o endpoint de status (autenticado como admin):

```bash
curl -H "Authorization: Bearer <seu_session_token>" \
     https://lfn-backend.onrender.com/api/admin/whatsapp/status
```

Resposta esperada quando configurado corretamente:
```json
{
  "configured": true,
  "phone_number_id": "1234****",
  "access_token_set": true,
  "api_version": "v20.0"
}
```

---

## Passo 7 — Enviar Mensagem de Teste

```bash
curl -X POST https://lfn-backend.onrender.com/api/admin/whatsapp/test \
  -H "Authorization: Bearer <seu_session_token>" \
  -H "Content-Type: application/json" \
  -d '{"phone": "+5511999999999", "message": "Teste da API permanente ✅"}'
```

Resposta de sucesso:
```json
{
  "success": true,
  "recipient": "5511999999999",
  "providerResponse": { "messages": [{"id": "wamid.xxx"}] }
}
```

---

## Limites da Meta & Configuração de Rate Limiting

| Tier | Limite diário | Condição |
|------|--------------|----------|
| **Tier 1** | 1.000 contatos únicos/dia | Padrão inicial |
| **Tier 2** | 10.000 | Após qualidade da conta |
| **Tier 3** | 100.000 | Após qualidade da conta |
| **Ilimitado** | Sem limite | Após aprovação Meta |

A variável `WHATSAPP_SEND_DELAY_MS` controla o intervalo entre envios:

| Valor | Velocidade aproximada |
|-------|-----------------------|
| `1200` (padrão) | ~50 mensagens/min |
| `600` | ~100 mensagens/min |
| `200` | ~300 mensagens/min (requer Tier 3+) |

> **Atenção:** Enviar acima do limite do seu Tier resulta em erro `131056` da Meta e pode rebaixar a qualidade da conta.

---

## Erros Comuns

| Código Meta | Causa | Solução |
|-------------|-------|---------|
| `190` | Token inválido ou expirado | Regere o token (Passo 4) |
| `131030` | Número de telefone não registrado na WABA | Verifique o `WHATSAPP_PHONE_NUMBER_ID` |
| `131048` | Conta de negócios restrita | Acesse Business Support no Meta |
| `131056` | Rate limit excedido | Aumente o `WHATSAPP_SEND_DELAY_MS` |
| `100` | Permissão faltando | Adicione `whatsapp_business_messaging` ao token |

---

## Cheklist Rápido

- [ ] App Meta criado com produto WhatsApp
- [ ] WABA vinculada ao Business Manager verificado
- [ ] Número de telefone registrado e ativo na WABA
- [ ] System User criado com função Admin
- [ ] System User tem acesso Admin ao app
- [ ] Token permanente gerado com os 2 escopos obrigatórios
- [ ] `WHATSAPP_ACCESS_TOKEN` e `WHATSAPP_PHONE_NUMBER_ID` definidos no Render
- [ ] Endpoint `/api/admin/whatsapp/status` retorna `"configured": true`
- [ ] Mensagem de teste enviada com sucesso via `/api/admin/whatsapp/test`
