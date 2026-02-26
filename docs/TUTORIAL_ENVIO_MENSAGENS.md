# Tutorial de preenchimento para envio de mensagens (LFN)

Este guia mostra o preenchimento completo para operar o sistema e executar envios de mensagens no fluxo atual do MVP.

## 1) Acessar o sistema

- Abra o painel: `https://lfn-leadflow-pro.surge.sh`
- Faça login com um usuário administrador ou cliente.

Observação importante:

- No MVP atual, o disparo é **simulado** para validação de operação e métricas.
- A integração real com WhatsApp/Meta deve ser feita depois (provedores oficiais).

## 2) Fluxo recomendado (visão geral)

1. Admin cria empresa cliente.
2. Cliente entra na própria conta.
3. Cliente cadastra leads com consentimento.
4. Cliente cria campanha por nicho e canal.
5. Cliente dispara campanha.
6. Cliente acompanha métricas no relatório.

## 3) Passo a passo de preenchimento

### Passo A — Criar cliente (admin)

No painel admin, vá na área de criação de empresa e preencha:

- **Nome da empresa:** ex. `Clínica Alpha`
- **Nome do responsável:** ex. `Maria Silva`
- **Slug:** ex. `clinica-alpha`
- **E-mail do admin cliente:** ex. `admin@clinicaalpha.com`
- **Senha inicial do cliente:** ex. `Cliente@123`

Clique em **Criar**.

### Passo B — Primeiro acesso do cliente

Entre com o e-mail/senha criados.

- Se o sistema solicitar troca obrigatória, defina a nova senha.
- Após login, valide se o cliente vê apenas dados da própria empresa.

### Passo C — Cadastrar leads

Na seção de leads, preencha para cada contato:

- **Nome completo:** ex. `João Souza`
- **E-mail** (opcional, mas recomendado)
- **Telefone:** ex. `+5511999999999`
- **Nicho:** ex. `saude`
- **Origem:** ex. `formulario`
- **Consentimento (opt-in):** marcar como verdadeiro

Repita o cadastro para vários leads do mesmo nicho da campanha que será criada.

### Passo D — Criar campanha

Na seção de campanhas, preencha:

- **Nome da campanha:** ex. `Campanha Check-up Março`
- **Nicho:** ex. `saude` (deve combinar com os leads)
- **Canal:** `whatsapp`, `facebook` ou `instagram`
- **Template da mensagem:** texto base da oferta/convite

Clique em **Criar campanha**.

### Passo E — Disparar campanha

Na lista de campanhas, clique em **Disparar** na campanha desejada.

Resultado esperado:

- O sistema processa os leads do nicho da campanha.
- Mostra feedback de quantidade processada.
- Atualiza métricas de envio/entrega/resposta no dashboard.

### Passo F — Conferir relatório

Na área de métricas/relatório, valide:

- Total de mensagens
- Total enviadas
- Total entregues
- Total respondidas
- Taxa de resposta

## 4) Checklist rápido (antes de disparar)

- Cliente logado corretamente (empresa certa)
- Leads com **consentimento marcado**
- Nicho dos leads igual ao nicho da campanha
- Sessão ativa (sem expiração)
- Licença/plano com limite disponível

## 5) Erros comuns e correção

### "Failed to fetch"

- Verifique se frontend e backend estão online.
- URL atual da API: `https://lfn-backend.onrender.com`
- Atualize e republique frontend se mudar backend.

### "Sem leads processados"

- Normalmente é nicho diferente entre lead e campanha.
- Confirme também se há consentimento.

### "Sessão expirada"

- Faça login novamente.
- Se necessário, ajuste TTL de sessão no backend.

## 6) Fluxo comercial (como você definiu)

- Admin/super admin acessa o painel principal.
- Novos clientes entram pelo fluxo de compra/cadastro.
- As credenciais dos clientes são geradas no processo de aquisição/ativação.
