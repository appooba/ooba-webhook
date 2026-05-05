import base44 from 'npm:@base44/sdk@0.8.25';

const VERIFY_TOKEN = "ooba2026";
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN") || "";
const PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") || "118970490080862063";

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

async function getAgentReply(userMessage: string, userId: string): Promise<string> {
  try {
    const response = await base44.agent.sendMessage({
      message: userMessage,
      channel: "whatsapp",
      user_id: userId,
    });
    return response?.reply || response?.message || response?.text || "";
  } catch (e) {
    console.error("Erro no agente Base44:", e);
    return "";
  }
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
      
      console.log("Webhook recebido:", JSON.stringify(body));

      const entry = body?.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;
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

      // Tentar obter resposta do agente
      let replyText = await getAgentReply(msgText, from);

      // Fallback se o agente não responder
      if (!replyText) {
        replyText = "Olá! Sou o vendedor virtual da OOBA Mídia Indoor. Como posso te ajudar? 😊";
      }

      // Enviar resposta
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
