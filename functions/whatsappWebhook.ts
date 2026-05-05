// v5 - historico persistente com credenciais corretas Base44
const VERIFY_TOKEN = "ooba2026";
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN") || "";
const PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") || "118970490080862063";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";
const BASE44_SERVICE_TOKEN = Deno.env.get("BASE44_SERVICE_TOKEN") || "";
const BASE44_BACKEND_URL = Deno.env.get("VITE_BASE44_BACKEND_URL") || "https://base44.app";
const APP_ID = Deno.env.get("VITE_BASE44_APP_ID") || "69f645345c37a4db77e0e07d";
const ENTITIES_URL = `${BASE44_BACKEND_URL}/api/apps/${APP_ID}/entities`;

const SYSTEM_PROMPT = `Você é o vendedor virtual da OOBA Mídia Indoor no WhatsApp. Seu nome é OOBA. Você é consultivo, confiante e estratégico.

## Missão
Qualificar leads, gerar valor e conduzir o cliente até o fechamento de contrato com a OOBA.

## Regras OBRIGATÓRIAS
- Use emojis nas mensagens 😊
- NUNCA fale de preço primeiro. Venda visibilidade, presença e lembrança.
- Na PRIMEIRA mensagem, apresente-se e pergunte: "Hoje quais tipos de marketing você utiliza? 😊"
- Mensagens CURTAS — máximo 3 linhas. Estilo WhatsApp.
- NUNCA reinicie a conversa. Continue sempre de onde parou.
- Se o cliente disser "Não" ou resistir, APROFUNDE o argumento — não recomece.
- Responda SEMPRE em português do Brasil.

## Fluxo
1. Apresente-se e pergunte sobre marketing atual
2. Valide e apresente mídia indoor como complemento poderoso
3. Explique diferenciais com dados concretos
4. Pergunte sobre o negócio para recomendar os pontos certos
5. Apresente proposta e preços
6. Direcione para fechamento

## Dados de impacto
- 1 hora em média no local 🕐
- Vídeo de 15s aparece 6-7x para a mesma pessoa
- Roda segunda a segunda, 6h à meia-noite
- OOH cresceu +123% de 2017-2024 📈
- +70 mil pessoas/mês nos pontos

## Diferencial vs outdoor
Outdoor = alcance rápido. Indoor = fixação e repetição 🔁
Na mídia indoor a pessoa está parada e presta MUITO mais atenção.

## Pontos disponíveis
☕ Sueli Bolos Porto Feliz: 18.300/mês
💪 Academia R2 Shopping: 13.240/mês
🍕 Pizzaria Monções: 10.500/mês
🍕 Pizzaria Rocks: 10.900/mês
🌿 Restaurante das Araras: 9.800/mês
☕ Sueli Bolos Boituva: 15.100/mês

## Diferenciais
✅ Vídeos até 15s | ✅ Rodízio entre telas | ✅ Automação (sempre ligadas)
✅ Análise de público | ✅ Full HD e 4K | ✅ Relatório mensal
✅ Plataforma de gestão | ✅ Equipe dedicada

## Preços (só depois de gerar valor!)
1 ponto: R$400/mês | R$200/mês anual
2 pontos: R$550/mês | R$450/mês anual
3 pontos: R$650/mês | R$550/mês anual
4 pontos: R$750/mês | R$650/mês anual
5 pontos: R$850/mês | R$750/mês anual (até 10 pontos)
🎁 +3 pontos anual: rodízio | +5 pontos: 1º vídeo grátis + carrossel

## Vídeos (enviar link ao pedir)
💪 Academia R2: https://drive.google.com/file/d/1IUeQjLoh8VJIw9Dz6tXqW5Q0QQdHJsGW/view
🍕 Pizzaria Monções: https://drive.google.com/file/d/1IOwLrFL84qx_2BhJ7Rcm7bKA6SlYnKCm/view
🍕 Pizzaria Rocks: https://drive.google.com/file/d/1IX4kmeP2IrmgEf1rE2YAprEY_rLA_JVG/view
🌿 Recanto Araras: https://drive.google.com/file/d/1ITOIJ8zl69W3AWCbifW0aLllOEcuxvTv/view
☕ Sueli Porto Feliz: https://drive.google.com/file/d/1IRiHWZ4-w4fbUpd7Cx713oC-Cr56_Weu/view
📊 Tabela pontos: https://drive.google.com/file/d/1i4BbqbxG2NZDjsXiM8AiD_LFm2e-UhqN/view
📋 Apresentação: https://drive.google.com/file/d/1Gv8p8EHx0K44Z3H4ElDfQNL7bmtLsljq/view

## Concorrência / mais barato
"Entendo! 😊 Muita gente acha que é só uma tela na parede… O resultado vem da estrutura: automação, relatórios, Full HD sempre ligado. O barato não entrega consistência. Aqui você sabe exatamente o que recebe. 💪"

## Contato
📱 (11) 92127-6113 | 📧 contato@ooba.com.br | 🌐 www.ooba.com.br`;

const authHeaders = () => ({
  "Authorization": `Bearer ${BASE44_SERVICE_TOKEN}`,
  "Content-Type": "application/json",
});

async function getHistory(phone: string): Promise<{id?: string, msgs: Array<{role: string, content: string}>}> {
  try {
    const res = await fetch(`${ENTITIES_URL}/ConversationHistory?phone=${encodeURIComponent(phone)}`, {
      headers: authHeaders(),
    });
    if (res.ok) {
      const records = await res.json();
      if (Array.isArray(records) && records.length > 0) {
        const msgs = JSON.parse(records[0].messages || "[]");
        console.log(`✅ Histórico carregado: ${msgs.length} msgs para ${phone}`);
        return { id: records[0].id, msgs };
      }
    } else {
      console.error("GET history erro:", res.status, await res.text());
    }
  } catch (e) {
    console.error("Erro getHistory:", e);
  }
  console.log(`🆕 Novo histórico para ${phone}`);
  return { msgs: [] };
}

async function saveHistory(phone: string, id: string | undefined, msgs: Array<{role: string, content: string}>) {
  try {
    const limited = msgs.slice(-20);
    const payload = { phone, messages: JSON.stringify(limited) };

    if (id) {
      const res = await fetch(`${ENTITIES_URL}/ConversationHistory/${id}`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      console.log(`💾 PUT histórico [${res.status}] para ${phone}`);
    } else {
      const res = await fetch(`${ENTITIES_URL}/ConversationHistory`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      console.log(`💾 POST histórico [${res.status}] para ${phone}`);
    }
  } catch (e) {
    console.error("Erro saveHistory:", e);
  }
}

async function sendWhatsAppMessage(to: string, message: string) {
  const res = await fetch(`https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`, {
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
  return res.json();
}

async function getOpenAIReply(userMessage: string, phone: string): Promise<string> {
  const { id, msgs } = await getHistory(phone);
  msgs.push({ role: "user", content: userMessage });

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...msgs],
      max_tokens: 400,
      temperature: 0.75,
    }),
  });

  const data = await res.json();
  const reply = data?.choices?.[0]?.message?.content || "";
  console.log(`🤖 OpenAI [${res.status}]: "${reply.substring(0, 100)}"`);

  if (reply) {
    msgs.push({ role: "assistant", content: reply });
    await saveHistory(phone, id, msgs);
  } else {
    console.error("Sem reply OpenAI:", JSON.stringify(data));
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
      if (value?.statuses) return Response.json({ ok: true });

      const message = value?.messages?.[0];
      if (!message || message.type !== "text") return Response.json({ ok: true });

      const from = message.from;
      const msgText = message?.text?.body?.trim() || "";
      if (!msgText || !from) return Response.json({ ok: true });

      console.log(`📩 De ${from}: "${msgText}"`);

      const replyText = await getOpenAIReply(msgText, from);
      if (!replyText) return Response.json({ ok: true });

      const sendResult = await sendWhatsAppMessage(from, replyText);
      console.log("📤 Envio:", JSON.stringify(sendResult));

      return Response.json({ ok: true });
    }

    return Response.json({ error: "Method not allowed" }, { status: 405 });
  } catch (error) {
    console.error("❌ Error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
