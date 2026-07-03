// ═══════════════════════════════════════════════════════
// OOBA — Follow-up de funil abandonado
// POST /api/followup_funil
// Dispara para leads que pararam no meio da conversa
// (abertura, entendimento) sem ver as telas ainda
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
  const res = await fetch(`https://graph.facebook.com/v21.0/${PID}/messages`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${WAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body, preview_url: true } })
  });
  const d = await res.json();
  if (d?.error) { console.error("WA error:", JSON.stringify(d.error)); return false; }
  console.log("Follow-up funil enviado para", to);
  return true;
}

function montarMsg(lead, tentativa) {
  const negocio = lead.negocio || "seu negócio";
  const cidade = lead.cidade || "Porto Feliz";

  if (tentativa === 1) {
    // Retomada leve — mostra que estava esperando
    return `Oi! 😊 Sou a Luana da OOBA.

A gente estava conversando sobre divulgar *${negocio}* em ${cidade} — ficou alguma dúvida que te travou?

Posso te mostrar as telas aqui em 2 minutos. Qual o melhor momento pra você? 🎯`;
  }

  if (tentativa === 2) {
    // Oferta de reunião direta
    return `Oi! Luana aqui da OOBA 😊

Sei que o dia a dia é corrido — mas não queria deixar o *${negocio}* sem essa oportunidade.

Que tal 15 minutinhos essa semana com a gente? Sem compromisso, só pra você ver o que é possível em ${cidade}. Qual dia fica melhor — terça ou quarta? 📅`;
  }

  // tentativa 3 — última tentativa com urgência
  return `Oi, última mensagem da minha parte 😊

Se quiser saber como outras empresas de ${cidade} estão aparecendo na frente de *+97 mil pessoas por mês* com a OOBA, é só me chamar quando quiser.

Fico à disposição! 🙌`;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const secret = req.query.secret || req.body?.secret;
  if (secret !== "ooba2026") return res.status(403).json({ error: "Forbidden" });

  let client;
  try {
    client = await getDB();

    // Buscar intervalo de follow-up do banco (auto-ajustado pela analytics)
    let intervaloHoras = 24; // fallback
    try {
      const cfgR = await client.query("SELECT value FROM agent_config WHERE key='followup_intervalo_horas'");
      if (cfgR.rows.length > 0) intervaloHoras = parseInt(cfgR.rows[0].value) || 24;
      console.log(`Follow-up funil: intervalo do banco = ${intervaloHoras}h`);
    } catch(e) { console.log("Usando intervalo padrão 24h"); }

    // Leads que pararam antes de ver as telas
    // Etapas: abertura ou entendimento — com pelo menos 1 msg do usuário
    // Sem atualização há mais de 24h
    const r = await client.query(`
      SELECT l.*, c.updated_at as ultima_msg_at,
             jsonb_array_length(c.messages::jsonb) as total_msgs
      FROM leads l
      LEFT JOIN conversations c ON c.phone = l.phone
      WHERE l.etapa_funil IN ('abertura', 'entendimento')
        AND jsonb_array_length(c.messages::jsonb) >= 2
        AND c.updated_at < NOW() - ($1 || ' hours')::interval
        AND c.updated_at > NOW() - INTERVAL '30 days'
        AND (l.total_abordagens IS NULL OR l.total_abordagens < 3)
        AND (l.data_ultima_abordagem IS NULL OR l.data_ultima_abordagem < NOW() - ($1 || ' hours')::interval)
      ORDER BY c.updated_at ASC
      LIMIT 20
    `, [intervaloHoras]);

    const leads = r.rows;
    console.log(`Follow-up funil: ${leads.length} leads elegíveis`);

    const resultados = [];

    for (const lead of leads) {
      const tentativa = (lead.total_abordagens || 0) + 1;
      // A/B testing para msg de retomada 1
      let mensagem;
      try {
        const testR = await client.query(
          "SELECT id FROM ab_tests WHERE config_key='msg_followup_retomada_1' AND status='active' LIMIT 1"
        );
        if (testR.rows.length > 0 && tentativa === 1) {
          const testId = testR.rows[0].id;
          // Verificar se lead já tem variante
          const assignR = await client.query(
            "SELECT variant_id FROM ab_test_assignments WHERE test_id=$1 AND lead_phone=$2", [testId, lead.phone]
          );
          let variantId, variantContent;
          if (assignR.rows.length > 0) {
            variantId = assignR.rows[0].variant_id;
            const varR = await client.query("SELECT content FROM ab_test_variants WHERE id=$1", [variantId]);
            variantContent = varR.rows[0]?.content;
          } else {
            const variantsR = await client.query(
              "SELECT id, content FROM ab_test_variants WHERE test_id=$1 ORDER BY assigned_count ASC", [testId]
            );
            if (variantsR.rows.length > 0) {
              variantId = variantsR.rows[0].id;
              variantContent = variantsR.rows[0].content;
              await client.query("INSERT INTO ab_test_assignments (test_id, variant_id, lead_phone) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [testId, variantId, lead.phone]);
              await client.query("UPDATE ab_test_variants SET assigned_count = assigned_count + 1 WHERE id=$1", [variantId]);
            }
          }
          if (variantContent) {
            const nome = lead.nome ? lead.nome.split(" ")[0] : "";
            const negocio = lead.negocio || "seu negócio";
            const cidade = lead.cidade || "Porto Feliz";
            mensagem = variantContent.replace(/{{nome}}/g, nome).replace(/{{negocio}}/g, negocio).replace(/{{cidade}}/g, cidade);
          } else {
            mensagem = montarMsg(lead, tentativa);
          }
        } else {
          mensagem = montarMsg(lead, tentativa);
        }
      } catch(e) {
        console.error("A/B test followup:", e.message);
        mensagem = montarMsg(lead, tentativa);
      }

      const ok = await sendMsg(lead.phone, mensagem);

      if (ok) {
        await client.query(`
          UPDATE leads 
          SET data_ultima_abordagem = NOW(),
              total_abordagens = COALESCE(total_abordagens, 0) + 1,
              updated_at = NOW()
          WHERE phone = $1
        `, [lead.phone]);

        // Salvar no histórico para manter contexto
        const convR = await client.query("SELECT messages FROM conversations WHERE phone=$1", [lead.phone]);
        if (convR.rows.length > 0) {
          let msgs = convR.rows[0].messages || [];
          if (typeof msgs === "string") msgs = JSON.parse(msgs);
          msgs.push({ role: "assistant", content: mensagem });
          await client.query("UPDATE conversations SET messages=$1, updated_at=NOW() WHERE phone=$2",
            [JSON.stringify(msgs), lead.phone]);
        }

        resultados.push({ phone: lead.phone, tentativa, etapa: lead.etapa_funil, status: "enviado" });
      } else {
        resultados.push({ phone: lead.phone, tentativa, etapa: lead.etapa_funil, status: "falhou" });
      }

      await new Promise(r => setTimeout(r, 2000));
    }

    return res.json({ ok: true, total: resultados.length, resultados });

  } catch (e) {
    console.error("followup_funil error:", e.message);
    return res.status(500).json({ error: e.message });
  } finally {
    if (client) await client.end();
  }
};
