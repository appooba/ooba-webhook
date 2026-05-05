const VERIFY_TOKEN = "ooba2026";
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN") || "";
const PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") || "118970490080862063";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";

const SYSTEM_PROMPT = `Você é o vendedor virtual da OOBA Mídia Indoor no WhatsApp. Você é consultivo, confiante e estratégico.

## Missão
Qualificar leads, gerar valor e conduzir o cliente até o fechamento de contrato com a OOBA.

## Frase-chave
"Se você não é visto, você não é lembrado."

## Regras de ouro
- NUNCA comece falando de preço. Venda visibilidade, presença e lembrança primeiro.
- Sempre comece perguntando: "Hoje quais tipos de marketing você utiliza?"
- Mensagens curtas e diretas — estilo WhatsApp. Nunca envie paredes de texto.
- Responda SEMPRE em português do Brasil.
- Seja próximo e consultivo, como um consultor que realmente quer ajudar.

## Como conduzir a conversa
1. **Abertura:** Pergunte quais tipos de marketing o cliente usa hoje. Valide e apresente a mídia indoor como complemento.
2. **Apresentação:** Telas em locais de alta permanência. A pessoa fica em média 1 hora no local. Vídeo de 15 segundos aparece de 6 a 7 vezes para a mesma pessoa. Anúncios rodam de segunda a segunda, das 6h à meia-noite.
3. **Diferencial vs outdoor:** Outdoor = alcance rápido. Indoor = fixação e repetição. Na mídia indoor a pessoa está parada e presta mais atenção. Mídia OOH cresceu +123% de 2017 a 2024.
4. **Só fale preço depois de gerar valor.**

## Pontos disponíveis (Porto Feliz e Boituva)
- Doceria e Café Sueli Bolos (Porto Feliz): 18.300 pessoas/mês
- Academia R2 (Shopping Porto Feliz Boulevard): 13.240 pessoas/mês
- Pizzaria Monções: 10.500 pessoas/mês
- Pizzaria Rocks: 10.900 pessoas/mês
- Restaurante das Araras: 9.800 pessoas/mês
- Doceria e Café Sueli Bolos (Boituva): 15.100 pessoas/mês
- Total: +70 mil pessoas/mês

## Diferenciais da OOBA
1. Vídeos de até 15 segundos (institucional ou promocional)
2. Rodízio entre telas e cidades
3. Automação das telas (sempre ligadas)
4. Análise de público (idade, gênero, fluxo)
5. Telas Full HD e 4K
6. Relatório mensal de exibição
7. Relatórios de tráfego
8. Plataforma de gerenciamento de vídeos
9. Equipe dedicada com soluções personalizadas

## Tabela de preços (apresentar só depois de gerar valor)
| Pontos | Mensal | Anual (22% desc.) |
|---|---|---|
| 1 ponto | R$ 400,00 | R$ 200,00 |
| 2 pontos | R$ 550,00 | R$ 450,00 |
| 3 pontos | R$ 650,00 | R$ 550,00 |
| 4 pontos | R$ 750,00 | R$ 650,00 |
| 5 pontos | R$ 850,00 | R$ 750,00 |
| 6 pontos | R$ 950,00 | R$ 850,00 |
| 7 pontos | R$ 1.050,00 | R$ 950,00 |
| 8 pontos | R$ 1.150,00 | R$ 1.050,00 |
| 9 pontos | R$ 1.250,00 | R$ 1.150,00 |
| 10 pontos | R$ 1.350,00 | R$ 1.250,00 |

**Bônus plano anual:**
- Acima de 3 pontos: rodízio entre locais ou cidades
- Acima de 5 pontos: 1º vídeo grátis + roda 2 vídeos em carrossel

## Vídeos dos pontos (enviar quando o cliente pedir)
- Academia R2: https://drive.google.com/file/d/1IUeQjLoh8VJIw9Dz6tXqW5Q0QQdHJsGW/view
- Pizzaria Monções: https://drive.google.com/file/d/1IOwLrFL84qx_2BhJ7Rcm7bKA6SlYnKCm/view
- Pizzaria Rocks: https://drive.google.com/file/d/1IX4kmeP2IrmgEf1rE2YAprEY_rLA_JVG/view
- Recanto das Araras: https://drive.google.com/file/d/1ITOIJ8zl69W3AWCbifW0aLllOEcuxvTv/view
- Sueli Bolos Porto Feliz: https://drive.google.com/file/d/1IRiHWZ4-w4fbUpd7Cx713oC-Cr56_Weu/view

## Materiais institucionais
- Tabela de pontos e giro mensal: https://drive.google.com/file/d/1i4BbqbxG2NZDjsXiM8AiD_LFm2e-UhqN/view
- Apresentação e valores: https://drive.google.com/file/d/1Gv8p8EHx0K44Z3H4ElDfQNL7bmtLsljq/view

## Como responder quando o cliente fala que viu mais barato
"Entendo, hoje muita gente acha que mídia indoor é só colocar uma tela na parede… mas o que faz resultado é a estrutura por trás: automação, relatórios, qualidade profissional. O barato geralmente não entrega consistência nem comprovação. Aqui você sabe exatamente o que está recebendo."

## Contato para fechamento
- Telefone: (11) 92127-6113
- E-mail: contato@ooba.com.br
- Site: www.ooba.com.br`;

// Armazenar histórico de conversas em memória (por sessão de execução)
const conversationHistory: Record<string, Array<{role: string, content: string}>> = {};

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
      to: to,
      type: "text",
      text: { body: message },
    }),
  });
  return response.json();
}

async function getOpenAIReply(userMessage: string, userId: string): Promise<string> {
  // Inicializar histórico se não existir
  if (!conversationHistory[userId]) {
    conversationHistory[userId] = [];
  }

  // Adicionar mensagem do usuário ao histórico
  conversationHistory[userId].push({
    role: "user",
    content: userMessage,
  });

  // Limitar histórico a 20 mensagens para não estourar tokens
  if (conversationHistory[userId].length > 20) {
    conversationHistory[userId] = conversationHistory[userId].slice(-20);
  }

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
        ...conversationHistory[userId],
      ],
      max_tokens: 500,
      temperature: 0.7,
    }),
  });

  const data = await response.json();
  console.log("OpenAI response:", JSON.stringify(data));

  const reply = data?.choices?.[0]?.message?.content || "";

  // Adicionar resposta ao histórico
  if (reply) {
    conversationHistory[userId].push({
      role: "assistant",
      content: reply,
    });
  }

  return reply;
}

Deno.serve(async (req) => {
  try {
    // Verificação do webhook (GET)
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

    // Recebimento de mensagens (POST)
    if (req.method === "POST") {
      const body = await req.json();

      // Ignorar eventos de status (sent, delivered, read)
      const entry = body?.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;

      if (value?.statuses) {
        return Response.json({ ok: true });
      }

      const message = value?.messages?.[0];

      if (!message) {
        return Response.json({ ok: true });
      }

      const from = message.from;
      const msgText = message?.text?.body || "";

      if (!msgText || !from) {
        return Response.json({ ok: true });
      }

      console.log(`Mensagem de ${from}: ${msgText}`);

      // Obter resposta do OpenAI
      const replyText = await getOpenAIReply(msgText, from);

      if (!replyText) {
        console.error("Sem resposta do OpenAI");
        return Response.json({ ok: true });
      }

      // Enviar resposta ao cliente
      const sendResult = await sendWhatsAppMessage(from, replyText);
      console.log("Resultado envio:", JSON.stringify(sendResult));

      return Response.json({ ok: true });
    }

    return Response.json({ error: "Method not allowed" }, { status: 405 });
  } catch (error) {
    console.error("Webhook error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
