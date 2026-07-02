// Endpoint de aprendizado automático
// Analisa conversas recentes, identifica padrões e gera patches de melhoria
// que são lidos pelo webhook em tempo real

const { Client } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SECRET = "ooba2026";

module.exports = async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const body = req.body || {};
  const query = req.query || {};
  const secret = body.secret || query.secret;

  if (secret !== SECRET) {
    return res.status(403).json({ error: "forbidden" });
  }

  if (!DATABASE_URL || !OPENAI_API_KEY) {
    return res.status(500).json({ error: "Missing env vars" });
  }

  const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    // 1. Buscar conversas dos últimos 7 dias
    const convs = await client.query(`
      SELECT c.phone, c.messages, l.nome, l.empresa, l.etapa_funil, l.status, l.negocio, l.cidade, l.origem
      FROM conversations c
      LEFT JOIN leads l ON c.phone = l.phone
      WHERE c.updated_at > NOW() - INTERVAL '7 days'
      ORDER BY c.updated_at DESC
    `);

    if (convs.rows.length === 0) {
      await client.end();
      return res.json({ ok: true, message: "Sem conversas recentes para analisar" });
    }

    // 2. Buscar patches ativos existentes (pra não duplicar)
    const existing = await client.query(`
      SELECT conteudo, problema FROM prompt_patches WHERE ativo = true
    `);
    const existingProblems = existing.rows.map(r => r.problema || "").filter(Boolean);

    // 3. Montar resumo das conversas pra enviar ao GPT
    let conversasTexto = "";
    for (const row of convs.rows) {
      try {
        const msgs = JSON.parse(row.messages);
        const nome = row.nome || "(sem nome)";
        const etapa = row.etapa_funil || "?";
        const status = row.status || "?";
        const origem = row.origem || "inbound";

        conversasTexto += `\n{'== CONVERSA: ${nome} (${row.phone}) =='}\n`;
        conversasTexto += `Etapa: ${etapa} | Status: ${status} | Origem: ${origem}\n`;
        conversasTexto += `Negócio: ${row.negocio || "?"} | Cidade: ${row.cidade || "?"}\n\n`;

        for (const m of msgs) {
          const role = m.role === "assistant" ? "LUANA" : "LEAD";
          conversasTexto += `[${role}] ${m.content}\n`;
        }
        conversasTexto += "\n---\n";
      } catch(e) {}
    }

    // 4. Patches existentes pra evitar duplicação
    let patchesExistentes = existingProblems.length > 0
      ? `\nPatches já existentes (NÃO duplique):\n${existingProblems.map(p => `- ${p}`).join("\n")}\n`
      : "\nSem patches existentes ainda.\n";

    // 5. Enviar pro GPT analisar e gerar patches
    const prompt = `Você é um analista de vendas especializado em mídia indoor. Analise as conversas abaixo entre a Luana (consultora de vendas OOBA) e leads no WhatsApp.

CONVERSAS RECENTES:
${conversasTexto}

${patchesExistentes}

Analise cada conversa e identifique:

1. ERROS da Luana — onde ela errou, perdeu o lead, foi genérica, não aproveitou um gancho, repetiu informação, desistiu cedo demais, ou soou robótica.

2. ACERTOS da Luana — argumentos que funcionaram bem, respostas que geraram engajamento, momentos onde o lead avançou no funil.

3. PADRÕES — objeções comuns dos leads, perguntas frequentes, momentos onde conversas travam.

4. RESPOSTAS IDEAIS — como a Luana deveria ter respondido em momentos-chave.

Gere de 1 a 5 PATCHES de melhoria no formato JSON abaixo. Cada patch deve ser específico, acionável e diretamente aplicável ao script de vendas.

Formato de cada patch:
{
  "problema": "descrição curta do problema identificado (1 linha)",
  "sugestao": "o que a Luana deveria fazer diferente (1-2 linhas)",
  "conteudo": "instrução específica pra adicionar ao prompt da Luana (2-4 linhas, em segunda pessoa 'você')",
  "patch_type": "objection_handling | argument | flow_fix | tone | discovery",
  "fonte": "nome do lead onde o problema foi identificado"
}

Regras:
- Seja específico, não genérico ("seja mais natural" não ajuda)
- Foque em coisas que vão melhorar a taxa de conversão
- Priorize ERROS sobre acertos (acertos só viram patch se for um padrão forte)
- Se não houver problemas novos para corrigir, retorne um array vazio []
- Não duplique problemas que já estão nos patches existentes

Retorne APENAS um array JSON válido, sem texto adicional antes ou depois.`;

    const gptResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "user", content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 2000
      })
    });

    const gptData = await gptResponse.json();
    const rawOutput = gptData.choices?.[0]?.message?.content || "[]";

    // 6. Parsear os patches
    let patches = [];
    try {
      // Tentar extrair JSON mesmo se tiver markdown
      const jsonMatch = rawOutput.match(/\[[\s\S]*\]/);
      patches = JSON.parse(jsonMatch ? jsonMatch[0] : rawOutput);
    } catch(e) {
      console.error("Erro ao parsear patches:", e.message);
      console.error("Output:", rawOutput);
      await client.end();
      return res.json({ ok: true, patches: [], error: "Falha ao parsear resposta do GPT" });
    }

    // 7. Salvar patches no banco
    const today = new Date().toISOString().split("T")[0];
    let saved = 0;
    const savedPatches = [];

    for (const patch of patches) {
      if (!patch.problema || !patch.conteudo) continue;

      // Verificar se já existe um patch parecido
      const similar = await client.query(`
        SELECT id FROM prompt_patches 
        WHERE ativo = true AND problema ILIKE '%' || $1 || '%'
        LIMIT 1
      `, [patch.problema.substring(0, 50)]);

      if (similar.rows.length > 0) {
        // Pular — já existe algo similar
        continue;
      }

      await client.query(`
        INSERT INTO prompt_patches (semana, patch_type, trigger, conteudo, ativo, eficacia_score, fonte, problema, sugestao, aplicado, created_at)
        VALUES ($1, $2, $3, $4, true, 0, $5, $6, $7, true, NOW())
      `, [
        today,
        patch.patch_type || "general",
        "auto",
        patch.conteudo,
        patch.fonte || "auto",
        patch.problema,
        patch.sugestao || "",
      ]);

      saved++;
      savedPatches.push({
        problema: patch.problema,
        sugestao: patch.sugestao,
        tipo: patch.patch_type
      });
    }

    // 8. Buscar patches ativos pra retornar
    const activePatches = await client.query(`
      SELECT id, problema, conteudo, patch_type, fonte, created_at
      FROM prompt_patches WHERE ativo = true
      ORDER BY created_at DESC
    `);

    await client.end();

    return res.json({
      ok: true,
      conversas_analisadas: convs.rows.length,
      patches_gerados: patches.length,
      patches_salvos: saved,
      novos_patches: savedPatches,
      patches_ativos: activePatches.rows.length,
      detalhe: savedPatches
    });

  } catch (err) {
    console.error("Erro em /api/aprender:", err);
    try { await client.end(); } catch(e) {}
    return res.status(500).json({ error: err.message });
  }
};
