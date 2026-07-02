#!/usr/bin/env python3
"""
Skill: Aprendizado Automático da Luana
Analisa conversas recentes, identifica padrões, gera patches de melhoria
e salva no banco Neon Postgres. Os patches são lidos pelo webhook em tempo real.
"""
import os, json, re, psycopg2, urllib.request, datetime

DB_URL = os.environ.get("DATABASE_URL", "")
OAI_KEY = os.environ.get("OPENAI_API_KEY", "")

if not DB_URL or not OAI_KEY:
    print("❌ DATABASE_URL ou OPENAI_API_KEY não configurados")
    exit(1)

conn = psycopg2.connect(DB_URL, sslmode="require")
cur = conn.cursor()

# 1. Buscar conversas dos últimos 7 dias
cur.execute("""
    SELECT c.phone, c.messages, l.nome, l.empresa, l.etapa_funil, l.status, l.negocio, l.cidade, l.origem
    FROM conversations c
    LEFT JOIN leads l ON c.phone = l.phone
    WHERE c.updated_at > NOW() - INTERVAL '7 days'
    ORDER BY c.updated_at DESC
""")
rows = cur.fetchall()

if not rows:
    print("ℹ️ Sem conversas recentes para analisar")
    cur.close()
    conn.close()
    exit(0)

# 2. Patches existentes
cur.execute("SELECT problema FROM prompt_patches WHERE ativo = true")
existing = [r[0] for r in cur.fetchall() if r[0]]

# 3. Montar texto das conversas
conversas = ""
for row in rows:
    phone, msgs_str, nome, empresa, etapa, status, negocio, cidade, origem = row
    try:
        msgs = json.loads(msgs_str)
    except:
        continue
    nome = nome or "(sem nome)"
    etapa = etapa or "?"
    status = status or "?"
    origem = origem or "inbound"
    conversas += f"\n== CONVERSA: {nome} ({phone}) ==\n"
    conversas += f"Etapa: {etapa} | Status: {status} | Origem: {origem}\n"
    conversas += f"Negócio: {negocio or '?'} | Cidade: {cidade or '?'}\n\n"
    for m in msgs:
        role = "LUANA" if m.get("role") == "assistant" else "LEAD"
        conversas += f"[{role}] {m.get('content','')[:500]}\n"
    conversas += "\n---\n"

patches_existentes = "\nPatches já existentes (NÃO duplique):\n" + "\n".join(f"- {p}" for p in existing) + "\n" if existing else "\nSem patches existentes ainda.\n"

prompt = f"""Você é um analista de vendas especializado em mídia indoor. Analise as conversas abaixo entre a Luana (consultora de vendas OOBA) e leads no WhatsApp.

CONVERSAS RECENTES:
{conversas}

{patches_existentes}

Analise cada conversa e identifique:

1. ERROS da Luana — onde ela errou, perdeu o lead, foi genérica, não aproveitou um gancho, repetiu informação, desistiu cedo demais, ou soou robótica.

2. ACERTOS da Luana — argumentos que funcionaram bem, respostas que geraram engajamento, momentos onde o lead avançou no funil.

3. PADRÕES — objeções comuns dos leads, perguntas frequentes, momentos onde conversas travam.

4. RESPOSTAS IDEAIS — como a Luana deveria ter respondido em momentos-chave.

Gere de 1 a 5 PATCHES de melhoria no formato JSON abaixo. Cada patch deve ser específico, acionável e diretamente aplicável ao script de vendas.

Formato de cada patch:
{{
  "problema": "descrição curta do problema identificado (1 linha)",
  "sugestao": "o que a Luana deveria fazer diferente (1-2 linhas)",
  "conteudo": "instrução específica pra adicionar ao prompt da Luana (2-4 linhas, em segunda pessoa 'você')",
  "patch_type": "objection_handling | argument | flow_fix | tone | discovery",
  "fonte": "nome do lead onde o problema foi identificado"
}}

Regras:
- Seja específico, não genérico ("seja mais natural" não ajuda)
- Foque em coisas que vão melhorar a taxa de conversão
- Priorize ERROS sobre acertos
- Se não houver problemas novos para corrigir, retorne um array vazio []
- Não duplique problemas que já estão nos patches existentes

Retorne APENAS um array JSON válido, sem texto adicional."""

# 4. GPT
data = json.dumps({
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": prompt}],
    "temperature": 0.7,
    "max_tokens": 2000
}).encode()

req = urllib.request.Request(
    "https://api.openai.com/v1/chat/completions",
    data=data,
    headers={"Authorization": f"Bearer {OAI_KEY}", "Content-Type": "application/json"},
    method="POST"
)

with urllib.request.urlopen(req) as resp:
    gpt_data = json.loads(resp.read())

raw_output = gpt_data["choices"][0]["message"]["content"]

# 5. Parsear patches
json_match = re.search(r'\[[\s\S]*\]', raw_output)
patches = json.loads(json_match.group(0) if json_match else raw_output)

print(f"📊 {len(rows)} conversas analisadas, {len(patches)} patches gerados")

# 6. Salvar no banco
today = datetime.date.today().isoformat()
saved = 0

for patch in patches:
    if not patch.get("problema") or not patch.get("conteudo"):
        continue
    
    cur.execute("SELECT id FROM prompt_patches WHERE ativo=true AND problema ILIKE %s LIMIT 1",
                (f"%{patch['problema'][:50]}%",))
    if cur.fetchone():
        continue
    
    cur.execute("""
        INSERT INTO prompt_patches (semana, patch_type, trigger, conteudo, ativo, eficacia_score, fonte, problema, sugestao, aplicado, created_at)
        VALUES (%s, %s, %s, %s, true, 0, %s, %s, %s, true, NOW())
    """, [
        today,
        patch.get("patch_type", "general"),
        "auto",
        patch["conteudo"],
        patch.get("fonte", "auto"),
        patch["problema"],
        patch.get("sugestao", ""),
    ])
    saved += 1
    print(f"  ✅ {patch['problema']}")
    print(f"     → {patch['conteudo'][:120]}...")

conn.commit()

# 7. Status final
cur.execute("SELECT count(*) FROM prompt_patches WHERE ativo=true")
total = cur.fetchone()[0]
print(f"\n📈 Total de patches ativos: {total}")
print(f"🆕 Novos patches: {saved}")

cur.close()
conn.close()
