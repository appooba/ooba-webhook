# OOBA Webhook - Vendedor IA WhatsApp

Webhook para receber mensagens do WhatsApp via API oficial da Meta e responder automaticamente com o Vendedor OOBA (IA).

## Deploy na Vercel

1. Faça upload deste repositório no GitHub
2. Conecte na Vercel → Add New Project
3. Configure as variáveis de ambiente:
   - `WHATSAPP_TOKEN` — Token permanente da API do WhatsApp (Meta)
   - `OPENAI_API_KEY` — Chave da API da OpenAI
   - `BASE44_API_KEY` — Chave de API do Base44
4. Deploy!
5. URL do webhook: `https://SEU-PROJETO.vercel.app/webhook`

## Configurar no Meta
- URL de callback: `https://SEU-PROJETO.vercel.app/webhook`
- Token de verificação: `ooba2026`
