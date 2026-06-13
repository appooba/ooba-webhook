// ═══════════════════════════════════════════════════════
// OOBA — Sistema de Reativação de Leads
// POST /api/reativar
// Uso: chamado pela automação diária ou manualmente
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
  const res = await fetch(`https://graph.facebook.com/v19.0/${PID}/messages`, {
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

// Montar mensagem personalizada por perfil do lead
function montarMensagem(lead) {
  const nome = lead.nome ? lead.nome.split(" ")[0] : null;
  const saudacao = nome ? `Oi ${nome}! 👋` : `Oi! 👋`;

  // Ex-cliente que já anunciou
  if (lead.ja_anunciou && lead.telas_anunciadas) {
    const telas = lead.telas_anunciadas;
    return `${saudacao} Sou a Luana da OOBA Mídia Indoor! 😊

Você já anunciou conosco ${telas ? `na ${telas}` : "nas nossas telas"} — e queria saber se está no momento certo de retomar a divulgação da sua marca.

Temos novidades nas telas e já passamos de +97 mil pessoas/mês em Porto Feliz e Boituva! 🚀

Quer que eu te mostre as opções disponíveis hoje?`;
  }

  // Lead que entrou em contato mas não fechou
  if (lead.negocio) {
    return `${saudacao} Sou a Luana da OOBA Mídia Indoor! 😊

A gente já conversou antes sobre divulgar ${lead.negocio ? `a ${lead.negocio}` : "sua marca"} nas nossas telas.

Queria saber se hoje é um bom momento pra retomar — temos espaços disponíveis e já passamos de +97 mil pessoas/mês nos nossos pontos! 📍

Posso te mostrar as novidades?`;
  }

  // Lead frio da lista (nunca conversou)
  return `${saudacao} Sou a Luana, consultora da OOBA Mídia Indoor! 😊

A OOBA leva sua marca para +97 mil pessoas/mês em locais de alta permanência em Porto Feliz e Boituva — cafeterias, pizzarias, academias, restaurantes.

Seu anúncio em vídeo de 15 segundos aparece de 6 a 7 vezes pra mesma pessoa. 🎯

Posso te contar como funciona?`;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });

  let client;
  try {
    client = await getDB();

    // Buscar leads prontos para abordagem ativa
    // Critérios: abordagem_ativa=true E (nunca abordado OU último contato há mais de 30 dias)
    const r = await client.query(`
      SELECT * FROM leads
      WHERE abordagem_ativa = TRUE
        AND etapa_funil NOT IN ('fechado', 'reuniao')
        AND (
          data_ultima_abordagem IS NULL
          OR data_ultima_abordagem < NOW() - INTERVAL '30 days'
        )
        AND total_abordagens < 3
      ORDER BY 
        ja_anunciou DESC,
        potencial_retorno DESC,
        created_at ASC
      LIMIT 20
    `);

    const leads = r.rows;
    console.log(`Reativação: ${leads.length} leads elegíveis`);

    const resultados = [];

    for (const lead of leads) {
      const mensagem = montarMensagem(lead);

      // Enviar WhatsApp
      const ok = await sendMsg(lead.phone, mensagem);

      if (ok) {
        // Atualizar registro
        await client.query(`
          UPDATE leads SET
            data_ultima_abordagem = NOW(),
            total_abordagens = total_abordagens + 1,
            etapa_funil = CASE WHEN etapa_funil = 'perdido' THEN 'abertura' ELSE etapa_funil END,
            updated_at = NOW()
          WHERE phone = $1
        `, [lead.phone]);

        // Resetar histórico de conversa para começar do zero
        await client.query(`
          DELETE FROM conversations WHERE phone = $1
        `, [lead.phone]);

        resultados.push({ phone: lead.phone, nome: lead.nome, ok: true });
        console.log(`✅ Reativado: ${lead.phone} (${lead.nome || "sem nome"})`);
      } else {
        resultados.push({ phone: lead.phone, nome: lead.nome, ok: false });
      }

      // Aguardar 3 segundos entre mensagens (evitar bloqueio da API)
      await new Promise(r => setTimeout(r, 3000));
    }

    return res.json({
      success: true,
      total_processados: leads.length,
      enviados: resultados.filter(r => r.ok).length,
      falhos: resultados.filter(r => !r.ok).length,
      detalhes: resultados
    });

  } catch(e) {
    console.error("ERR reativar:", e.message);
    return res.status(500).json({ error: String(e) });
  } finally {
    if (client) await client.end().catch(() => {});
  }
};
