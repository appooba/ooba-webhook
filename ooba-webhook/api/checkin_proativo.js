// ═══════════════════════════════════════════════════════
// OOBA — Check-in Proativo (TODAS as etapas do funil)
// POST /api/checkin_proativo
// Busca leads em QUALQUER etapa do funil sem resposta há >4h
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

// Mensagens de check-in por etapa do funil
function montarCheckin(lead) {
  const nome = lead.nome ? lead.nome.split(" ")[0] : "tudo bem";
  const etapa = lead.etapa_funil;
  const cidade = lead.cidade || "";
  const empresa = lead.empresa || "";

  switch (etapa) {
    case 'abertura':
      return `${nome}, tudo bem? 🙋 Conforme nossa conversa sobre divulgação da sua marca, queria continuar te explicando como funciona. Tem uns 2 minutinhos?`;

    case 'entendimento':
      return `${nome}, tudo bem? 🙋 Lembrei da nossa conversa! ${cidade ? `Para continuar te mostrando as opções em ${cidade}` : 'Pra te mostrar as telas que temos'}, só preciso de mais uma informação rápida. Posso?`;

    case 'educacao':
      return `${nome}, tudo bem? 🙋 Fiquei de te explicar melhor como nossos pontos funcionam. Quer que eu continue? Leva só 1 minutinho 😊`;

    case 'recomendacao':
      return `${nome}, tudo bem? 🙋 Você já viu as telas disponíveis ${cidade ? `em ${cidade}` : ''}? Qual delas faz mais sentido pra ${empresa || 'sua marca'}?`;

    case 'materiais':
      return `${nome}, tudo bem? 🙋 Conseguiu dar uma olhada nos materiais que te enviei? Alguma dúvida?`;

    case 'proposta':
      return `${nome}, tudo bem? 🙋 Passando pra saber se você teve a oportunidade de avaliar nossa proposta de divulgação da sua marca. Posso te esclarecer alguma dúvida?`;

    case 'fechamento':
      return `${nome}, estou no seu aguardo 🙋 tudo bem? Conseguiu dar uma olhada na proposta?`;

    default:
      return `${nome}, tudo bem? 🙋 Estou aqui, qualquer dúvida é só me chamar!`;
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });

  let client;
  try {
    client = await getDB();

    // Buscar TODOS os leads em qualquer etapa do funil sem resposta há >4h
    // Excluir: fechados, reunião marcada, perdidos, timing capturado (vai ser reativado depois)
    const r = await client.query(`
      SELECT l.phone, l.nome, l.etapa_funil, l.status, l.cidade, l.empresa,
             c.updated_at as ultima_msg
      FROM leads l
      LEFT JOIN conversations c ON l.phone = c.phone
      WHERE l.etapa_funil IN ('abertura', 'entendimento', 'educacao', 'recomendacao', 'materiais', 'proposta', 'fechamento')
        AND l.status NOT IN ('fechado', 'reuniao', 'perdido', 'timing_capturado')
        AND c.updated_at < NOW() - INTERVAL '4 hours'
        AND l.phone IS NOT NULL
      ORDER BY c.updated_at ASC
      LIMIT 15
    `);

    const leads = r.rows;
    console.log(`Check-in proativo: ${leads.length} leads elegiveis`);

    const resultados = [];

    for (const lead of leads) {
      const mensagem = montarCheckin(lead);

      // Tentar enviar como texto (se janela 24h aberta)
      let ok = await sendMsg(lead.phone, mensagem);

      // Se falhar (janela fechada), tentar template
      if (!ok) {
        console.log(`Janela fechada pra ${lead.phone}, tentando template...`);
        const nome = lead.nome ? lead.nome.split(" ")[0] : "tudo bem";
        ok = await sendTemplate(lead.phone, "ooba_reativacao_followup", [nome]);
      }

      if (ok) {
        // Salvar no historico
        try {
          const hist = await client.query("SELECT messages FROM conversations WHERE phone=$1", [lead.phone]);
          if (hist.rows.length > 0) {
            const msgs = JSON.parse(hist.rows[0].messages);
            msgs.push({ role: "assistant", content: `[CHECK-IN PROATIVO - ${lead.etapa_funil}]: ${mensagem}` });
            await client.query("UPDATE conversations SET messages=$1, updated_at=NOW() WHERE phone=$2", [JSON.stringify(msgs), lead.phone]);
          }
        } catch(e) { console.error("Hist update:", e.message); }

        // Atualizar status
        await client.query("UPDATE leads SET status='checkin_proativo', updated_at=NOW() WHERE phone=$1", [lead.phone]);

        resultados.push({ phone: lead.phone, nome: lead.nome, etapa: lead.etapa_funil, ok: true });
        console.log(`✅ Check-in: ${lead.phone} (${lead.nome}) — etapa: ${lead.etapa_funil}`);
      } else {
        resultados.push({ phone: lead.phone, nome: lead.nome, etapa: lead.etapa_funil, ok: false });
        console.log(`❌ Check-in falhou: ${lead.phone} (${lead.nome}) — etapa: ${lead.etapa_funil}`);
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
