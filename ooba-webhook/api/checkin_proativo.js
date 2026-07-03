// ═══════════════════════════════════════════════════════
// OOBA — Check-in Proativo
// POST /api/checkin_proativo
// Busca leads em etapas avançadas sem resposta há >4h
// e dispara mensagem ativa de retomada
// ═══════════════════════════════════════════════════════

const { Client } = require("pg");

const WAT = process.env.WHATSAPP_TOKEN || "";
const PID = "1189704930882063";
const DATABASE_URL = process.env.DATABASE_URL || "";

async function getDB() {
  const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  return client;
}

async function sendMsg(to, body) {
  const res = await fetch(`https://graph.facebook.com/v20.0/${PID}/messages`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${WAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } })
  });
  const d = await res.json();
  if (d?.error) {
    console.error("WA error:", JSON.stringify(d.error));
    return false;
  }
  console.log("WA sent para", to, ":", d?.messages?.[0]?.id);
  return true;
}

async function sendTemplate(to, templateName, params) {
  const res = await fetch(`https://graph.facebook.com/v20.0/${PID}/messages`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${WAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: "pt_BR" },
        components: [{
          type: "body",
          parameters: params.map(p => ({ type: "text", text: p }))
        }]
      }
    })
  });
  const d = await res.json();
  if (d?.error) {
    console.error("WA template error:", JSON.stringify(d.error));
    return false;
  }
  console.log("WA template sent para", to, ":", d?.messages?.[0]?.id);
  return true;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });

  let client;
  try {
    client = await getDB();

    // Buscar leads em etapas avançadas que receberam ultima msg ha mais de 4h
    // e nao tiveram resposta do lead (ultima msg no historico é do assistant)
    const r = await client.query(`
      SELECT l.phone, l.nome, l.etapa_funil, l.status, l.cidade, l.empresa,
             c.updated_at as ultima_msg
      FROM leads l
      LEFT JOIN conversations c ON l.phone = c.phone
      WHERE l.etapa_funil IN ('proposta', 'fechamento', 'recomendacao', 'materiais')
        AND l.status NOT IN ('fechado', 'reuniao', 'perdido', 'timing_capturado')
        AND c.updated_at < NOW() - INTERVAL '4 hours'
      ORDER BY c.updated_at ASC
      LIMIT 10
    `);

    const leads = r.rows;
    console.log(`Check-in proativo: ${leads.length} leads elegiveis`);

    const resultados = [];

    for (const lead of leads) {
      const nome = lead.nome ? lead.nome.split(" ")[0] : "tudo bem";
      
      // Mensagens de check-in por etapa
      let mensagem;
      if (lead.etapa_funil === 'fechamento') {
        mensagem = `${nome}, estou no seu aguardo 🙋 tudo bem? Conseguiu dar uma olhada na proposta?`;
      } else if (lead.etapa_funil === 'proposta') {
        mensagem = `${nome}, tudo bem? 🙋 Passando pra saber se você teve a oportunidade de avaliar nossa proposta de divulgação da sua marca. Posso te esclarecer alguma dúvida?`;
      } else if (lead.etapa_funil === 'materiais') {
        mensagem = `${nome}, tudo bem? 🙋 Conseguiu dar uma olhada nos materiais que te enviei? Alguma dúvida?`;
      } else {
        mensagem = `${nome}, tudo bem? 🙋 Estou aqui, qualquer dúvida é só me chamar!`;
      }

      // Tentar enviar como texto (se janela 24h aberta)
      let ok = await sendMsg(lead.phone, mensagem);
      
      // Se falhar (janela fechada), tentar template
      if (!ok) {
        console.log(`Tentando template para ${lead.phone}...`);
        ok = await sendTemplate(lead.phone, "ooba_reativacao_followup", [nome]);
      }

      if (ok) {
        // Salvar no historico
        try {
          const hist = await client.query("SELECT messages FROM conversations WHERE phone=$1", [lead.phone]);
          if (hist.rows.length > 0) {
            const msgs = JSON.parse(hist.rows[0].messages);
            msgs.push({ role: "assistant", content: `[CHECK-IN PROATIVO]: ${mensagem}` });
            await client.query("UPDATE conversations SET messages=$1, updated_at=NOW() WHERE phone=$2", [JSON.stringify(msgs), lead.phone]);
          }
        } catch(e) { console.error("Hist update:", e.message); }

        // Atualizar status
        await client.query("UPDATE leads SET status='checkin_proativo', updated_at=NOW() WHERE phone=$1", [lead.phone]);
        
        resultados.push({ phone: lead.phone, nome: lead.nome, etapa: lead.etapa_funil, ok: true });
        console.log(`✅ Check-in: ${lead.phone} (${lead.nome}) — etapa: ${lead.etapa_funil}`);
      } else {
        resultados.push({ phone: lead.phone, nome: lead.nome, etapa: lead.etapa_funil, ok: false });
      }

      // Aguardar 5s entre mensagens
      await new Promise(r => setTimeout(r, 5000));
    }

    return res.json({
      success: true,
      total_processados: leads.length,
      enviados: resultados.filter(r => r.ok).length,
      falhos: resultados.filter(r => !r.ok).length,
      detalhes: resultados
    });

  } catch(e) {
    console.error("ERR checkin_proativo:", e.message);
    return res.status(500).json({ error: String(e) });
  } finally {
    if (client) await client.end().catch(() => {});
  }
};
