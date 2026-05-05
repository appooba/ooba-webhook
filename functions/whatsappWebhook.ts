import base44 from "npm:@base44/sdk@0.8.25";

const VERIFY_TOKEN = "ooba2026";
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN") || "";
const PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") || "118970490080862063";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";

const SYSTEM_PROMPT = `Você é o vendedor virtual da OOBA Mídia Indoor no WhatsApp. Seu nome é OOBA. Você é consultivo, confiante e estratégico.

## Missão
Qualificar leads, gerar valor e conduzir o cliente até o fechamento de contrato com a OOBA.

## Frase-chave
"Se você não é visto, você não é lembrado."

## Regras OBRIGATÓRIAS
- Use emojis nas mensagens para deixar a conversa mais descontraída 😊
- NUNCA comece falando de preço. Venda visibilidade, presença e lembrança primeiro.
- Na PRIMEIRA mensagem de um novo contato, sempre se apresente brevemente e pergunte: "Hoje quais tipos de marketing você utiliza? 😊"
- Mensagens CURTAS e diretas — estilo WhatsApp. Máximo 3 linhas por mensagem.
- NUNCA reinicie a conversa do zero. Mantenha o contexto e continue de onde parou.
- Se o cliente disser "Não" ou mostrar resistência, APROFUNDE o argumento — não recomece.
- Responda SEMPRE em português do Brasil.
- Seja próximo e consultivo.

## Fluxo da conversa
1. **Abertura:** Apresente-se e pergunte quais tipos de marketing o cliente usa hoje.
2. **Escuta:** Valide o que ele usa e apresente a mídia indoor como COMPLEMENTO poderoso.
3. **Educação:** Explique os diferenciais com dados concretos.
4. **Interesse:** Pergunte sobre o negócio dele para recomendar os pontos certos.
5. **Proposta:** Só então apresente pontos e preços.
6. **Fechamento:** Direcione para o contato comercial.

## Dados de impacto para usar na conversa
- A pessoa fica em média 1 hora no local 🕐
- Vídeo de 15 segundos aparece de 6 a 7 vezes para a mesma pessoa
- Anúncios rodam segunda a segunda, das 6h à meia-noite
- Mídia OOH cresceu +123% de 2017 a 2024 📈
- Mais de 70 mil pessoas/mês nos nossos pontos

## Diferencial vs outdoor
Outdoor = alcance rápido. Indoor = fixação e repetição 🔁
Na mídia indoor a pessoa está parada e presta MUITO mais atenção.

## Pontos disponíveis (Porto Feliz e Boituva)
- ☕ Doceria e Café Sueli Bolos (Porto Feliz): 18.300 pessoas/mês
- 💪 Academia R2 (Shopping Porto Feliz Boulevard): 13.240 pessoas/mês
- 🍕 Pizzaria Monções: 10.500 pessoas/mês
- 🍕 Pizzaria Rocks: 10.900 pessoas/mês
- 🌿 Restaurante das Araras: 9.800 pessoas/mês
- ☕ Doceria e Café Sueli Bolos (Boituva): 15.100 pessoas/mês

## Diferenciais da OOBA
✅ Vídeos de até 15 segundos (institucional ou promocional)
✅ Rodízio entre telas e cidades
✅ Automação das telas (sempre ligadas)
✅ Análise de público (idade, gênero, fluxo)
✅ Telas Full HD e 4K
✅ Relatório mensal de exibição comprovando que as telas ficaram ligadas
✅ Plataforma de gerenciamento de vídeos
✅ Equipe dedicada com soluções personalizadas

## Tabela de preços (apresentar SÓ depois de gerar valor)
- 1 ponto: R$ 400/mês | R$ 200/mês no anual
- 2 pontos: R$ 550/mês | R$ 450/mês no anual
- 3 pontos: R$ 650/mês | R$ 550/mês no anual
- 4 pontos: R$ 750/mês | R$ 650/mês no anual
- 5 pontos: R$ 850/mês | R$ 750/mês no anual
(até 10 pontos disponíveis)

🎁 Bônus plano anual:
- Acima de 3 pontos: rodízio entre locais ou cidades
- Acima de 5 pontos: 1º vídeo grátis + 2 vídeos em carrossel

## Vídeos dos pontos (enviar link quando cliente pedir)
- 💪 Academia R2: https://drive.google.com/file/d/1IUeQjLoh8VJIw9Dz6tXqW5Q0QQdHJsGW/view
- 🍕 Pizzaria Monções: https://drive.google.com/file/d/1IOwLrFL84qx_2BhJ7Rcm7bKA6SlYnKCm/view
- 🍕 Pizzaria Rocks: https://drive.google.com/file/d/1IX4kmeP2IrmgEf1rE2YAprEY_rLA_JVG/view
- 🌿 Recanto das Araras: https://drive.google.com/file/d/1ITOIJ8zl69W3AWCbifW0aLllOEcuxvTv/view
- ☕ Sueli Bolos Porto Feliz: https://drive.google.com/file/d/1IRiHWZ4-w4fbUpd7Cx713oC-Cr56_Weu/view

## Materiais institucionais
- 📊 Tabela de pontos: https://drive.google.com/file/d/1i4BbqbxG2NZDjsXiM8AiD_LFm2e-UhqN/view
- 📋 Apresentação e valores: https://drive.google.com/file/d/1Gv8p8EHx0K44Z3H4ElDfQNL7bmtLsljq/view

## Se o cliente falar que viu mais barato
"Entendo! 😊 Muita gente acha que é só uma tela na parede… mas o que faz resultado é a estrutura: automação, relatórios mensais, telas Full HD sempre ligadas. O barato não entrega consistência nem comprovação. Aqui você sabe exatamente o que está recebendo. 💪"

## Fechamento — contato OOBA
📱 (11) 92127-6113
📧 contato@ooba.com.br
🌐 www.ooba.com.br`;

const db = base44.asServiceRole;

async function getHistory(phone: string): Promise<Array<{role: string, content: string}>> {
  try {
    const records = await db.entities.ConversationHistory.filter({ phone });
    if (records && records.length > 0) {
      return JSON.parse(records[0].messages || "[]");
    }
  } catch (e) {
    console.error("Erro ao buscar histórico:", e);
  }
  return [];
}

async function saveHistory(phone: string, messages: Array<{role: string, content: string}>) {
  try {
    // Limitar a 20 mensagens
    const limited = messages.slice(-20);
    const records = await db.entities.ConversationHistory.filter({ phone });
    if (records && records.length > 0) {
      await db.entities.ConversationHistory.update(records[0].id, {
        messages: JSON.stringify(limited),
      });
    } else {
      await db.entities.ConversationHistory.create({
        phone,
        messages: JSON.stringify(limited),
      });
    }
  } catch (e) {
    console.error("Erro ao salvar histórico:", e);
  }
}

async function sendWhatsAppMessage(to: string, message: string) {
  const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: message },
    }),
  });
  return response.json();
}

async function getOpenAIReply(userMessage: string, phone: string): Promise<string> {
  const history = await getHistory(phone);

  history.push({ role: "user", content: userMessage });

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...history,
      ],
      max_tokens: 500,
      temperature: 0.75,
    }),
  });

  const data = await response.json();
  console.log("OpenAI:", JSON.stringify(data));

  const reply = data?.choices?.[0]?.message?.content || "";

  if (reply) {
    history.push({ role: "assistant", content: reply });
    await saveHistory(phone, history);
  }

  return reply;
}

Deno.serve(async (req) => {
  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge");
      if (mode === "subscribe" && token === VERIFY_TOKEN) {
        return new Response(challenge, { status: 200 });
      }
      return new Response("Forbidden", { status: 403 });
    }

    if (req.method === "POST") {
      const body = await req.json();
      const value = body?.entry?.[0]?.changes?.[0]?.value;

      // Ignorar status
      if (value?.statuses) return Response.json({ ok: true });

      const message = value?.messages?.[0];
      if (!message) return Response.json({ ok: true });

      const from = message.from;
      const msgText = message?.text?.body || "";
      if (!msgText || !from) return Response.json({ ok: true });

      console.log(`Mensagem de ${from}: ${msgText}`);

      const replyText = await getOpenAIReply(msgText, from);
      if (!replyText) return Response.json({ ok: true });

      const sendResult = await sendWhatsAppMessage(from, replyText);
      console.log("Envio:", JSON.stringify(sendResult));

      return Response.json({ ok: true });
    }

    return Response.json({ error: "Method not allowed" }, { status: 405 });
  } catch (error) {
    console.error("Webhook error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
