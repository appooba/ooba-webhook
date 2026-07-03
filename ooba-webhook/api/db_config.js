// ══════════════════════════════════════════════════════════════
// OOBA — Camada de configuração vinda do banco (NÃO hardcoded)
// Tudo que antes era constante no código agora vive no Neon Postgres
// Mudou preço? UPDATE no banco. Nova tela? INSERT. Zero deploy.
// ══════════════════════════════════════════════════════════════

const { Client } = require("pg");

// Aceita client opcional (para reusar conexão do webhook) ou cria nova
async function getConfig(clientOrKey, keyOrNull) {
  let client, key, shouldClose = false;
  
  if (keyOrNull !== undefined && keyOrNull !== null) {
    // Chamada com client existente: getConfig(client, "key")
    client = clientOrKey;
    key = keyOrNull;
  } else {
    // Chamada sem client: getConfig("key")
    key = clientOrKey;
    client = new Client({ 
      connectionString: process.env.DATABASE_URL, 
      ssl: { rejectUnauthorized: false } 
    });
    shouldClose = true;
  }
  
  try {
    if (shouldClose) await client.connect();
    const r = await client.query("SELECT value FROM agent_config WHERE key = $1", [key]);
    return r.rows.length > 0 ? r.rows[0].value : null;
  } catch(e) {
    console.error("getConfig error:", key, e.message);
    return null;
  } finally {
    if (shouldClose) { try { await client.end(); } catch(_) {} }
  }
}

async function getAllConfig() {
  const client = new Client({ 
    connectionString: process.env.DATABASE_URL, 
    ssl: { rejectUnauthorized: false } 
  });
  try {
    await client.connect();
    const r = await client.query("SELECT key, value FROM agent_config");
    const config = {};
    for (const row of r.rows) {
      config[row.key] = row.value;
    }
    return config;
  } catch(e) {
    console.error("getAllConfig error:", e.message);
    return {};
  } finally {
    try { await client.end(); } catch(_) {}
  }
}

async function getTelas(cidade = null) {
  const client = new Client({ 
    connectionString: process.env.DATABASE_URL, 
    ssl: { rejectUnauthorized: false } 
  });
  try {
    await client.connect();
    const r = await client.query(
      "SELECT * FROM telas_config WHERE ativa = true ORDER BY ordem ASC"
    );
    let telas = r.rows;
    if (cidade) {
      const cid = cidade.toLowerCase();
      if (cid.includes("boituva") && !cid.includes("porto feliz")) {
        telas = telas.filter(t => t.cidade === "boituva");
      } else if (cid.includes("porto feliz") && !cid.includes("boituva")) {
        telas = telas.filter(t => t.cidade === "porto feliz");
      }
    }
    return telas;
  } catch(e) {
    console.error("getTelas error:", e.message);
    return [];
  } finally {
    try { await client.end(); } catch(_) {}
  }
}

async function getConflictRules() {
  const client = new Client({ 
    connectionString: process.env.DATABASE_URL, 
    ssl: { rejectUnauthorized: false } 
  });
  try {
    await client.connect();
    const r = await client.query("SELECT palavras, telas_bloqueadas FROM screen_conflicts");
    return r.rows;
  } catch(e) {
    console.error("getConflictRules error:", e.message);
    return [];
  } finally {
    try { await client.end(); } catch(_) {}
  }
}

async function getTelasFiltradas(negocio, cidade) {
  const telas = await getTelas(cidade);
  const regras = await getConflictRules();
  const neg = (negocio || "").toLowerCase();
  
  const bloqueadas = new Set();
  for (const regra of regras) {
    for (const palavra of regra.palavras) {
      if (neg.includes(palavra.toLowerCase())) {
        regra.telas_bloqueadas.forEach(t => bloqueadas.add(t));
        break;
      }
    }
  }
  
  return telas
    .filter(t => !bloqueadas.has(t.nome))
    .map(t => ({
      nome: t.nome,
      fluxo: t.fluxo,
      horario: t.horario,
      video: t.video_url,
      descricao: t.descricao,
      cidade: t.cidade
    }));
}

module.exports = { getConfig, getAllConfig, getTelas, getConflictRules, getTelasFiltradas };
