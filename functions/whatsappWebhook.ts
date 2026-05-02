import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const VERIFY_TOKEN = "ooba2026";
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN") || "";
const PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") || "";

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
      
      // Verificar se é uma mensagem válida
      const entry = body?.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;
      const message = value?.messages?.[0];

      if (!message) {
        return Response.json({ ok: true });
      }

      const from = message.from; // número do cliente
      const msgText = message?.text?.body || "";

      if (!msgText || !from) {
        return Response.json({ ok: true });
      }

      // Chamar o agente Base44 via API interna
      const agentResponse = await fetch("https://api.base44.com/api/apps/69f645345c37a4db77e0e07d/agent/message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: msgText,
          channel: "whatsapp",
          user_id: from,
          user_phone: from,
        }),
      });

      let replyText = "Olá! Sou o vendedor virtual da OOBA Mídia Indoor. Como posso te ajudar?";
      
      if (agentResponse.ok) {
        const agentData = await agentResponse.json();
        replyText = agentData?.reply || agentData?.message || replyText;
      }

      // Enviar resposta ao cliente
      await sendWhatsAppMessage(from, replyText);

      return Response.json({ ok: true });
    }

    return Response.json({ error: "Method not allowed" }, { status: 405 });
  } catch (error) {
    console.error("Webhook error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
