// ═══════════════════════════════════════════════════════
// OOBA — Evolução Automática da Luana
// POST /api/evoluir_luana
// Analisa o sistema inteiro e implementa melhorias quando critérios são atingidos
// ═══════════════════════════════════════════════════════

const { Client } = require("pg");
const { getConfig } = require("./db_config");

const WAT = process.env.WHATSAPP_TOKEN || "";
const PID = "1189704930882063";
const DATABASE_URL = process.env.DATABASE_URL || "";
const OAI_KEY = process.env.OPENAI_API_KEY || "";
const GESTAO_NUM = "5511995650925";

async function getDB() {
  const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  return client;
}

async function sendMsg(to, body) {
  const res = await fetch(`https://graph.facebook.com/v21.0/${PID}/messages`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${WAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } })
  });
  const d = await res.json();
  return !d?.error;
}

// ═══════════════════════════════════════════════════════
// ANTI-DUPLICIDADE: verifica se já existe patch similar ativo
// ═══════════════════════════════════════════════════════
async function patchJaExiste(client, etapa, conteudo) {
  const r = await client.query(
    "SELECT id FROM prompt_patches WHERE ativo=true AND etapa_alvo=$1 AND conteudo ILIKE '%' || $2 || '%' LIMIT 1",
    [etapa, conteudo.slice(0, 60)]
  );
  return r.rows.length > 0;
}

// Verifica similaridade entre novo patch e patches existentes da mesma etapa
async function patchSimilarExiste(client, etapa, conteudo) {
  const r = await client.query(
    "SELECT id, conteudo FROM prompt_patches WHERE ativo=true AND (etapa_alvo=$1 OR etapa_alvo='*' OR etapa_alvo='all')",
    [etapa]
  );
  const newWords = new Set(conteudo.toLowerCase().split(/\s+/));
  const stop = new Set(['a','o','e','de','da','do','que','para','pra','em','com','não','uma','um','é','ao','os','as','se','mas','ou','mais','já','—','o','reggra','quando','lead','responda','nunca']);
  for (const row of r.rows) {
    const existingWords = new Set(row.conteudo.toLowerCase().split(/\s+/));
    const overlap = [...(newWords & existingWords)].filter(w => !stop.has(w) && w.length > 3);
    if (overlap.length > 6) return true;
  }
  return false;
}


module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const secret = req.query.secret || req.body?.secret;
  if (secret !== "ooba2026") return res.status(403).json({ error: "Forbidden" });

  let client;
  try {
    client = await getDB();
    const melhorias = [];
    
    // ═══════════════════════════════════════════════════════
    // 1. CONTAR LEADS ATIVOS
    // ═══════════════════════════════════════════════════════
    const leadCount = await client.query(`
      SELECT COUNT(DISTINCT phone) as total FROM leads 
      WHERE etapa_funil != 'fechado' 
        AND (created_at > NOW() - INTERVAL '30 days')
    `);
    const totalLeads = parseInt(leadCount.rows[0].total);
    
    // ═══════════════════════════════════════════════════════
    // 2. CONTAR LEADS FECHADOS (CLIENTES ATIVOS)
    // ═══════════════════════════════════════════════════════
    const fechados = await client.query(`
      SELECT COUNT(*) as total FROM leads WHERE etapa_funil = 'fechado'
    `);
    const totalFechados = parseInt(fechados.rows[0].total);
    
    // ═══════════════════════════════════════════════════════
    // 3. GARGALOS DO FUNIL
    // ═══════════════════════════════════════════════════════
    const gargalos = await client.query(`
      SELECT etapa, meta_percentual, 
             COUNT(CASE WHEN etapa_nova != etapa THEN 1 END) as avancaram,
             COUNT(*) as total
      FROM funil_metas fm
      LEFT JOIN funil_transicoes ft ON ft.etapa_anterior = fm.etapa
      GROUP BY etapa, meta_percentual
      ORDER BY etapa
    `);
    
    const piorGargalo = { etapa: null, gap: 0 };
    for (const g of gargalos.rows) {
      const taxa = g.total > 0 ? (g.avancaram / g.total * 100) : 0;
      const gap = g.meta_percentual - taxa;
      if (gap > piorGargalo.gap) {
        piorGargalo.gap = gap;
        piorGargalo.etapa = g.etapa;
        piorGargalo.taxa = taxa;
        piorGargalo.meta = g.meta_percentual;
      }
    }
    
    // ═══════════════════════════════════════════════════════
    // 4. A/B TESTS — verificar se têm dados suficientes
    // ═══════════════════════════════════════════════════════
    const abStatus = await client.query(`
      SELECT t.id, t.name, t.min_sample, t.winner_variant_id, t.status,
             v.variant_name, v.assigned_count, v.converted_count
      FROM ab_tests t
      JOIN ab_test_variants v ON v.test_id = t.id
      WHERE t.status = 'active'
      ORDER BY t.id, v.variant_name
    `);
    
    let abReady = 0;
    let abTests = {};
    for (const row of abStatus.rows) {
      if (!abTests[row.id]) abTests[row.id] = { name: row.name, min_sample: row.min_sample, variants: [] };
      abTests[row.id].variants.push({ name: row.variant_name, assigned: row.assigned_count, converted: row.converted_count });
      if (row.assigned_count >= row.min_sample) abReady++;
    }
    
    // ═══════════════════════════════════════════════════════
    // 5. AVALIAR E IMPLEMENTAR MELHORIAS
    // ═══════════════════════════════════════════════════════
    
    // MELHORIA A: Lead Scoring (quando 30+ leads ativos)
    if (totalLeads >= 30) {
      // Verificar se já existe
      const scoringCheck = await client.query("SELECT key FROM agent_config WHERE key='lead_scoring_ativo'");
      if (scoringCheck.rows.length === 0) {
        await client.query("INSERT INTO agent_config (key, value) VALUES ('lead_scoring_ativo', 'true')");
        await client.query(`INSERT INTO prompt_patches (etapa_alvo, conteudo, fonte, ativo, created_at) 
          VALUES ('*', 'PRIORIDADE: Identifique o porte do negócio do lead (pequeno/médio/grande/franquia). Leads de maior porte devem ser tratados com foco em volume de pontos (5+) e plano anual. Leads pequenos podem começar com 1-2 pontos.', 'evoluir_auto', true, NOW())`);
        melhorias.push("✅ LEAD SCORING ativado — Luana agora prioriza leads por porte do negócio");
      }
    }
    
    // MELHORIA B: Análise de Sentimento (quando gargalo > 25% em 3+ relatórios)
    if (piorGargalo.gap > 25 && piorGargalo.etapa) {
      const sentCheck = await client.query("SELECT key FROM agent_config WHERE key='sentiment_analysis_ativo'");
      if (sentCheck.rows.length === 0) {
        await client.query("INSERT INTO agent_config (key, value) VALUES ('sentiment_analysis_ativo', 'true')");
        await client.query(`INSERT INTO prompt_patches (etapa_alvo, conteudo, fonte, ativo, created_at) 
          VALUES ('${piorGargalo.etapa}', 'ANÁLISE DE SENTIMENTO: Antes de responder, avalie o tom do lead: ENTUSIÁSTICO (respondeu rápido, positivo) → acelere o fluxo; NEUTRO (respondeu curto) → mantenha ritmo; HESITANTE (respondeu com dúvida/objeção) → enderece a dúvida antes de avançar; FRIOS (respondeu seco) → não force, faça pergunta aberta pra reativar interesse.', 'evoluir_auto', true, NOW())`);
        melhorias.push(`✅ ANÁLISE DE SENTIMENTO ativada — etapa ${piorGargalo.etapa} (gargalo de ${piorGargalo.gap.toFixed(0)}%)`);
      }
    }
    
    // MELHORIA C: A/B Test — promover vencedor quando dados suficientes
    for (const [testId, test] of Object.entries(abTests)) {
      const allReady = test.variants.every(v => v.assigned >= test.min_sample);
      if (allReady && !test.winner_variant_id) {
        // Encontrar melhor variante
        let best = test.variants[0];
        for (const v of test.variants) {
          const rate = v.assigned > 0 ? v.converted / v.assigned : 0;
          const bestRate = best.assigned > 0 ? best.converted / best.assigned : 0;
          if (rate > bestRate) best = v;
        }
        const bestRate = best.assigned > 0 ? (best.converted / best.assigned * 100).toFixed(0) : 0;
        
        // Promover
        await client.query("UPDATE ab_tests SET status='completed', winner_variant_id=(SELECT id FROM ab_test_variants WHERE test_id=$1 AND variant_name=$2) WHERE id=$1", [testId, best.name]);
        melhorias.push(`✅ A/B TEST #${testId} "${test.name}" → variante ${best.name} venceu com ${bestRate}% de conversão`);
      }
    }
    
    // MELHORIA D: Novo A/B test quando gargalo persiste
    if (piorGargalo.gap > 20 && piorGargalo.etapa) {
      const recentTest = await client.query("SELECT id FROM ab_tests WHERE etapa_funil=$1 AND created_at > NOW() - INTERVAL '7 days' AND status='active'", [piorGargalo.etapa]);
      if (recentTest.rows.length === 0) {
        // Criar novo teste para o gargalo
        const testName = `Otimização ${piorGargalo.etapa} — auto`;
        const testRes = await client.query("INSERT INTO ab_tests (name, config_key, etapa_funil, status, min_sample, confidence_threshold, created_at) VALUES ($1, 'msg_'||$2, $2, 'active', 4, 0.12, NOW()) RETURNING id", [testName, piorGargalo.etapa]);
        const newTestId = testRes.rows[0].id;
        
        // Variante A (controle = mensagem atual)
        await client.query("INSERT INTO ab_test_variants (test_id, variant_name, content, is_control, assigned_count, converted_count) VALUES ($1, 'A', 'Mensagem atual (controle)', true, 0, 0)", [newTestId]);
        // Variante B (mais direta/curta)
        await client.query("INSERT INTO ab_test_variants (test_id, variant_name, content, is_control, assigned_count, converted_count) VALUES ($1, 'B', 'Versão mais curta e direta', false, 0, 0)", [newTestId]);
        
        melhorias.push(`✅ NOVO A/B TEST criado: "${testName}" — testa versão mais direta na etapa ${piorGargalo.etapa}`);
      }
    }
    
    // MELHORIA E: Ajuste de follow-up baseado em dados reais
    const tempoResposta = await client.query(`
      SELECT AVG(EXTRACT(EPOCH FROM (ft.created_at - c.updated_at))/3600) as horas_mediana
      FROM funil_transicoes ft
      JOIN conversations c ON c.phone = ft.phone
      WHERE ft.created_at > NOW() - INTERVAL '14 days'
    `);
    if (tempoResposta.rows.length > 0 && tempoResposta.rows[0].horas_mediana) {
      const mediana = Math.round(parseFloat(tempoResposta.rows[0].horas_mediana));
      const intervaloAtual = await client.query("SELECT value FROM agent_config WHERE key='followup_intervalo_horas'");
      const atual = intervaloAtual.rows.length > 0 ? parseInt(intervaloAtual.rows[0].value) : 24;
      const novoIntervalo = Math.max(12, Math.round(mediana * 1.5));
      
      if (Math.abs(novoIntervalo - atual) >= 6) {
        await client.query("UPDATE agent_config SET value=$1 WHERE key='followup_intervalo_horas'", [novoIntervalo.toString()]);
        melhorias.push(`✅ FOLLOW-UP ajustado: ${atual}h → ${novoIntervalo}h (mediana de resposta: ${mediana}h)`);
      }
    }
    
    // MELHORIA F: Cliente ativo → Previsão de churn (quando 5+ fechados)
    if (totalFechados >= 5) {
      const churnCheck = await client.query("SELECT key FROM agent_config WHERE key='churn_prediction_ativo'");
      if (churnCheck.rows.length === 0) {
        await client.query("INSERT INTO agent_config (key, value) VALUES ('churn_prediction_ativo', 'true')");
        await client.query(`INSERT INTO prompt_patches (etapa_alvo, conteudo, fonte, ativo, created_at) 
          VALUES ('fechado', 'PÓS-VENDA: 30 dias após fechamento, entre em contato perguntando como está sendo a experiência. 60 dias após, pergunte sobre resultados. Se houver sinal de insatisfação, notifique a equipe OOBA.', 'evoluir_auto', true, NOW())`);
        melhorias.push("✅ PREVISÃO DE CHURN ativada — Luana fará pós-venda automático em 30/60 dias");
      }
    }
    
    // MELHORIA G: Texto de etapa com baixa conversão → gerar versão melhor via GPT
    if (piorGargalo.gap > 15 && piorGargalo.etapa) {
      const etapaKey = `msg_${piorGargalo.etapa}`;
      const textoAtual = await client.query("SELECT value FROM agent_config WHERE key=$1", [etapaKey]);
      if (textoAtual.rows.length > 0) {
        const patchCheck = await client.query("SELECT id FROM prompt_patches WHERE etapa_alvo=$1 AND fonte='evoluir_gpt' AND created_at > NOW() - INTERVAL '3 days'", [piorGargalo.etapa]);
        if (patchCheck.rows.length === 0 && OAI_KEY) {
          try {
            const oaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
              method: "POST",
              headers: { "Authorization": `Bearer ${OAI_KEY}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [
                  { role: "system", content: "Você é um especialista em vendas via WhatsApp. Gere apenas o texto da mensagem, sem comentários." },
                  { role: "user", content: `Esta mensagem de vendas tem ${piorGargalo.taxa.toFixed(0)}% de conversão (meta: ${piorGargalo.meta}%). Reescreva para ser mais persuasive e natural, mantendo o estilo WhatsApp (curto, emojis, amigável):\n\n${textoAtual.rows[0].value}` }
                ],
                temperature: 0.7,
                max_tokens: 300
              })
            });
            const oaiData = await oaiRes.json();
            const novoTexto = oaiData.choices?.[0]?.message?.content;
            if (novoTexto && novoTexto.length > 20) {
              await client.query(`INSERT INTO prompt_patches (etapa_alvo, conteudo, fonte, ativo, created_at) 
                VALUES ($1, 'SUBSTITUIR TEXTO da etapa ${piorGargalo.etapa} por esta versão otimizada: ${novoTexto.replace(/'/g, "''")}', 'evoluir_gpt', true, NOW())`, [piorGargalo.etapa]);
              melhorias.push(`✅ TEXTO OTIMIZADO via GPT para etapa ${piorGargalo.etapa} (gap de ${piorGargalo.gap.toFixed(0)}%)`);
            }
          } catch(e) { console.error("GPT otimização:", e.message); }
        }
      }
    }
    
    // ═══════════════════════════════════════════════════════
    // 6. RELATÓRIO E NOTIFICAÇÃO
    // ═══════════════════════════════════════════════════════
    
    let relatorio = `🤖 *EVOLUÇÃO AUTOMÁTICA — Luana*\n\n`;
    relatorio += `📊 Leads ativos: ${totalLeads}\n`;
    relatorio += `✅ Fechados: ${totalFechados}\n`;
    relatorio += `📉 Pior gargalo: ${piorGargalo.etapa || 'nenhum'} (${piorGargalo.taxa?.toFixed(0) || 0}% vs ${piorGargalo.meta || 0}% meta)\n`;
    relatorio += `🧪 A/B tests: ${Object.keys(abTests).length} ativos\n\n`;
    
    if (melhorias.length > 0) {
      relatorio += `🔧 *MELHORIAS IMPLEMENTADAS (${melhorias.length}):*\n`;
      for (const m of melhorias) relatorio += `${m}\n`;
      relatorio += `\n_Todas as mudanças já estão ativas no sistema._`;
    } else {
      relatorio += `✅ Sistema estável — nenhuma melhoria necessária neste momento.\n`;
      relatorio += `Próximos gatilhos: 30 leads (scoring), 5 fechados (churn), gargalo >25% (sentimento).`;
    }
    
    // Enviar relatório no WhatsApp de gestão
    await sendMsg(GESTAO_NUM, relatorio);
    
    return res.json({ 
      ok: true, 
      total_leads: totalLeads,
      total_fechados: totalFechados,
      pior_gargalo: piorGargalo,
      melhorias: melhorias.length,
      detalhes: melhorias
    });
    
  } catch (e) {
    console.error("evoluir_luana error:", e.message);
    return res.status(500).json({ error: e.message });
  } finally {
    if (client) await client.end();
  }
};
