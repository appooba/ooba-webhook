#!/usr/bin/env python3
"""
Skill: Aprendizado Automático — Luana Vendas v3
COM AUDITORIA PRÉVIA: antes de salvar qualquer patch, audita conversas reais
pra verificar se os patches atuais tão funcionando. Só cria correção nova
pra problema que realmente ainda tá acontecendo e não tá coberto por patch existente.

Fluxo:
  0. AUDITORIA: checa patches ativos vs conversas reais — quais tão funcionando
  1. Busca conversas recentes
  2. Gera patches E insights (só pra problemas NÃO cobertos)
  3. Marca patches existentes como eficazes/ineficazes baseado na auditoria
  4. Salva snapshot
"""
import os, json, psycopg2, datetime, urllib.request

DB_URL = os.environ.get("DATABASE_URL", "")
OPENAI_KEY = os.environ.get("OPENAI_API_KEY", "")

if not DB_URL or not OPENAI_KEY:
    print("❌ DATABASE_URL ou OPENAI_API_KEY não configurados")
    exit(1)

conn = psycopg2.connect(DB_URL, sslmode="require")
cur = conn.cursor()

# ── ETAPA 0: AUDITORIA DE PATCHES EXISTENTES ──────────────────────────
# Pegar todos os patches ativos com suas datas de criação
cur.execute("""
    SELECT id, conteudo, problema, patch_type, etapa_alvo, eficacia_score, created_at
    FROM prompt_patches WHERE ativo = true
    ORDER BY created_at DESC
""")
patches_db = cur.fetchall()

# Buscar conversas recentes pra auditar (últimas 48h pra ter contexto suficiente)
cur.execute("""
    SELECT c.phone, c.messages, l.nome, l.etapa_funil, l.status, l.updated_at
    FROM conversations c
    LEFT JOIN leads l ON c.phone = l.phone
    WHERE c.updated_at > NOW() - INTERVAL '48 hours'
    ORDER BY c.updated_at DESC
    LIMIT 30
""")
conversas_auditoria = cur.fetchall()

# Preparar resumo das conversas pra auditoria
conversas_resumo = []
for c in conversas_auditoria:
    phone, messages, nome, etapa, status, updated = c
    try:
        msgs = json.loads(messages) if isinstance(messages, str) else messages
        if isinstance(msgs, list) and len(msgs) > 1:
            resumo = []
            for m in msgs[-20:]:
                role = "LEAD" if m.get("role") == "user" else "LUANA"
                content = m.get("content", "")[:200]
                resumo.append(f"[{role}] {content}")
            conversas_resumo.append({
                "nome": nome or "?",
                "etapa": etapa or "?",
                "mensagens": resumo[-10:]
            })
    except:
        continue

print(f"🔍 AUDITORIA: {len(patches_db)} patches ativos | {len(conversas_resumo)} conversas para validar")

# Se tem patches e conversas, fazer auditoria via GPT
patches_funcionando = []
patches_falhando = []

if patches_db and conversas_resumo:
    # Prompt de auditoria: pra cada patch, checar se o problema ainda ocorre
    patches_info = []
    for p in patches_db[:10]:  # máx 10 patches por rodada de auditoria
        patches_info.append({
            "id": p[0],
            "conteudo": (p[1] or "")[:100],
            "problema": (p[2] or "")[:80],
            "etapa": p[4] or "all"
        })

    auditoria_prompt = """Você é um auditor de qualidade de vendas no WhatsApp. Sua tarefa é verificar se os patches de correção existentes estão funcionando nas conversas reais.

Para cada patch, analise as conversas e determine:
- "funcionando": o problema que o patch corrige NÃO está ocorrendo nas conversas recentes → o patch está funcionando
- "falhando": o problema AINDA está ocorrendo apesar do patch → o patch não está funcionando
- "sem_dados": não há conversas suficientes pra validar

Seja CONSERVADOR: se não tem evidência clara de que o patch falhou, marque como "funcionando". Só marque "falhando" se você ver o problema acontecendo explicitamente nas conversas.

NUNCA sugira remover um patch que está funcionando. O objetivo é NÃO mexer no que já está OK.

Responda APENAS em JSON:
{
  "auditoria": [
    {
      "patch_id": <número>,
      "status": "funcionando|falhando|sem_dados",
      "evidencia": "o que você viu nas conversas que justifica"
    }
  ]
}
"""

    auditoria_contexto = f"""
PATCHES PARA AUDITAR:
{chr(10).join(f"- ID {p['id']} | etapa={p['etapa']} | problema: {p['problema']} | correção: {p['conteudo']}" for p in patches_info)}

CONVERSAS RECENTES:
"""
    for c in conversas_resumo[:6]:
        auditoria_contexto += f"\n--- {c['nome']} (etapa: {c['etapa']}) ---\n"
        for m in c['mensagens']:
            auditoria_contexto += f"{m}\n"

    try:
        data_audit = json.dumps({
            "model": "gpt-4o-mini",
            "messages": [
                {"role": "system", "content": auditoria_prompt},
                {"role": "user", "content": auditoria_contexto}
            ],
            "temperature": 0.2,
            "max_tokens": 1500
        }).encode()

        req_audit = urllib.request.Request(
            "https://api.openai.com/v1/chat/completions",
            data=data_audit,
            headers={"Authorization": f"Bearer {OPENAI_KEY}", "Content-Type": "application/json"}
        )

        with urllib.request.urlopen(req_audit, timeout=30) as resp:
            result_audit = json.loads(resp.read())
            resp_audit = result_audit["choices"][0]["message"]["content"]

            try:
                audit_result = json.loads(resp_audit)
            except:
                import re
                match = re.search(r'\{.*\}', resp_audit, re.DOTALL)
                audit_result = json.loads(match.group()) if match else {"auditoria": []}

            audit_items = audit_result.get("auditoria", [])

            for item in audit_items:
                pid = item.get("patch_id")
                status_a = item.get("status", "sem_dados")
                evidencia = (item.get("evidencia") or "")[:200]

                if status_a == "funcionando":
                    patches_funcionando.append(pid)
                    # Aumentar score de eficácia (o patch tá funcionando, não mexer)
                    cur.execute("""
                        UPDATE prompt_patches
                        SET eficacia_score = LEAST(eficacia_score + 1, 10)
                        WHERE id = %s
                    """, [pid])
                    print(f"  ✅ PATCH #{pid} funcionando — score elevado")
                elif status_a == "falhando":
                    patches_falhando.append(pid)
                    print(f"  ⚠️ PATCH #{pid} ainda falhando: {evidencia[:80]}")
                else:
                    # sem_dados — não mexer, conservador
                    print(f"  ⏸️ PATCH #{pid} sem dados suficientes — mantido como está")

            print(f"\n🔍 Auditoria: {len(patches_funcionando)} funcionando | {len(patches_falhando)} falhando | {len(audit_items) - len(patches_funcionando) - len(patches_falhando)} sem dados")

    except Exception as e:
        print(f"⚠️ Auditoria falhou (não bloqueia resto): {e}")

# ── ETAPA 1: BUSCAR CONVERSAS RECENTES (últimas 24h) ──────────────────
cur.execute("""
    SELECT c.phone, c.messages, l.nome, l.etapa_funil, l.status, l.origem,
           l.empresa, l.negocio, l.cidade, l.updated_at
    FROM conversations c
    LEFT JOIN leads l ON c.phone = l.phone
    WHERE c.updated_at > NOW() - INTERVAL '24 hours'
    ORDER BY c.updated_at DESC
    LIMIT 30
""")
conversas = cur.fetchall()

if not conversas:
    print("📊 Nenhuma conversa nova para análise.")
    conn.commit()
    cur.close()
    conn.close()
    exit(0)

print(f"\n📊 {len(conversas)} conversas encontradas para análise")

# ── ETAPA 2: PATCHES E INSIGHTS EXISTENTES ────────────────────────────
cur.execute("SELECT conteudo, problema FROM prompt_patches WHERE ativo = true")
patches_existentes = [(r[0] or "", r[1] or "") for r in cur.fetchall()]

cur.execute("SELECT trigger_padrao, resposta_ideal FROM aprendizado_insights WHERE ativo = true")
insights_existentes = [(r[0] or "", r[1] or "") for r in cur.fetchall()]

print(f"🧠 {len(patches_existentes)} patches ativos | {len(insights_existentes)} insights ativos")

# ── ETAPA 3: MÉTRICAS DO FUNIL ────────────────────────────────────────
cur.execute("""
    SELECT etapa_funil, COUNT(*) as total
    FROM leads WHERE etapa_funil IS NOT NULL
    GROUP BY etapa_funil
""")
distribuicao = cur.fetchall()

cur.execute("""
    SELECT etapa_anterior, etapa_nova, COUNT(*) as total
    FROM funil_transicoes
    WHERE created_at > NOW() - INTERVAL '7 days'
    GROUP BY etapa_anterior, etapa_nova
    ORDER BY COUNT(*) DESC
""")
transicoes = cur.fetchall()

cur.execute("SELECT COUNT(*) FROM leads")
total_leads = cur.fetchone()[0]
cur.execute("SELECT COUNT(*) FROM leads WHERE status = 'fechado' OR etapa_funil = 'fechamento'")
leads_avancados = cur.fetchone()[0]
cur.execute("SELECT COUNT(*) FROM leads WHERE reuniao_data IS NOT NULL")
reunioes = cur.fetchone()[0]

# ── ETAPA 4: PREPARAR CONTEXTO ────────────────────────────────────────
contexto_conversas = []
for c in conversas:
    phone, messages, nome, etapa, status, origem, empresa, negocio, cidade, updated = c
    try:
        msgs = json.loads(messages) if isinstance(messages, str) else messages
        if isinstance(msgs, list) and len(msgs) > 1:
            resumo = []
            for m in msgs[-25:]:
                role = "LEAD" if m.get("role") == "user" else "LUANA"
                content = m.get("content", "")[:300]
                resumo.append(f"[{role}] {content}")
            contexto_conversas.append({
                "phone": phone,
                "nome": nome or "?",
                "etapa": etapa or "?",
                "status": status,
                "origem": origem,
                "negocio": negocio,
                "cidade": cidade,
                "mensagens": resumo[-15:]
            })
    except:
        continue

if not contexto_conversas:
    print("📊 Conversas sem conteúdo suficiente.")
    conn.commit()
    cur.close()
    conn.close()
    exit(0)

# ── ETAPA 5: PROMPT DO GPT (com consciência da auditoria) ─────────────
# Lista de patches que a auditoria confirmou que tão funcionando
# → GPT NÃO deve sugerir correção pra esses problemas
patches_ok_info = ""
if patches_funcionando:
    cur.execute("SELECT conteudo, problema FROM prompt_patches WHERE id = ANY(%s)", [patches_funcionando])
    ok_patches = cur.fetchall()
    patches_ok_info = chr(10).join(f"✅ JÁ FUNCIONANDO (não mexer): {r[1][:60]}" for r in ok_patches)

prompt_sistema = f"""Você é um analista de vendas sênior especializado em WhatsApp. Analise conversas entre a Luana (consultora da OOBA Mídia Indoor) e leads.

REGRA CRÍTICA — NÃO MEXER NO QUE ESTÁ FUNCIONANDO:
Os patches abaixo foram auditados e estão funcionando nas conversas reais.
NÃO gere patches novos para problemas que JÁ estão corrigidos por eles.
Só gere patches para problemas NOVOS que não estão cobertos.

{patches_ok_info}

Sua tarefa é gerar DOIS tipos de aprendizado:

TIPO 1 — PATCHES DE CORREÇÃO (só para problemas NOVOS não cobertos):
- Identifique erros de condução que AINDA não têm correção
- Se um problema similar já tem patch ativo, NÃO duplique
- Cada patch = UMA instrução clara e acionável (máx 3 linhas)
- Não contradiga regras existentes (nunca fale preço cedo, sempre seja consultiva)
- Máximo 3 patches por rodada
- Se não houver problemas novos, retorne array vazio []

TIPO 2 — INSIGHTS ESTRUTURADOS:
- Padrões de objeção: o que o lead disse → qual seria a resposta ideal
- Argumentos que funcionam: frases que avançaram a conversa
- Momentos de churn: onde os leads param de responder
- Cada insight tem: trigger, resposta_ideal, etapa do funil
- Máximo 5 insights por rodada

CATEGORIAS: objecao, argumento, fluxo, discovery, churn, conversao

Responda APENAS em JSON:
{{
  "patches": [
    {{
      "conteudo": "instrução clara",
      "problema": "o que aconteceu de errado (DEVE ser um problema NOVO)",
      "patch_type": "objection_handling|argument|flow_fix|tone|discovery",
      "etapa_alvo": "abertura|entendimento|recomendacao|fechamento|all",
      "fonte": "telefone do lead"
    }}
  ],
  "insights": [...],
  "gargalo_principal": "etapa com maior problema",
  "sugestao_estrutural": "sugestão de melhoria"
}}
"""

prompt_usuario = f"""
PATCHES JÁ ATIVOS (não duplicar):
{chr(10).join(f"- [{r[1][:40]}] {r[0][:80]}" for r in patches_existentes[:8])}

INSIGHTS JÁ ATIVOS (não duplicar):
{chr(10).join(f"- trigger: {r[0][:40]} → {r[1][:60]}" for r in insights_existentes[:5])}

MÉTRICAS DO FUNIL:
- Total de leads: {total_leads}
- Leads em etapa avançada: {leads_avancados}
- Reuniões agendadas: {reunioes}

DISTRIBUIÇÃO POR ETAPA:
{chr(10).join(f"- {d[0]}: {d[1]} leads" for d in distribuicao)}

TRANSIÇÕES (7 dias):
{chr(10).join(f"- {t[0]} → {t[1]}: {t[2]}x" for t in transicoes) if transicoes else "Nenhuma"}

CONVERSAS RECENTES ({len(contexto_conversas[:8])} de {len(contexto_conversas)}):
"""

for c in contexto_conversas[:8]:
    prompt_usuario += f"\n{'='*60}\n"
    prompt_usuario += f"Lead: {c['nome']} | Etapa: {c['etapa']} | Status: {c['status']} | Origem: {c['origem']} | Negócio: {c['negocio']} | Cidade: {c['cidade']}\n"
    prompt_usuario += f"{'='*60}\n"
    for m in c['mensagens']:
        prompt_usuario += f"{m}\n"

# ── ETAPA 6: CHAMAR GPT ───────────────────────────────────────────────
data = json.dumps({
    "model": "gpt-4o-mini",
    "messages": [
        {"role": "system", "content": prompt_sistema},
        {"role": "user", "content": prompt_usuario}
    ],
    "temperature": 0.3,
    "max_tokens": 2500
}).encode()

req = urllib.request.Request(
    "https://api.openai.com/v1/chat/completions",
    data=data,
    headers={"Authorization": f"Bearer {OPENAI_KEY}", "Content-Type": "application/json"}
)

try:
    with urllib.request.urlopen(req, timeout=45) as resp:
        result = json.loads(resp.read())
        resposta = result["choices"][0]["message"]["content"]

        try:
            analise = json.loads(resposta)
        except:
            import re
            match = re.search(r'\{.*\}', resposta, re.DOTALL)
            if match:
                analise = json.loads(match.group())
            else:
                print(f"⚠️ Resposta não-JSON: {resposta[:200]}")
                analise = {"patches": [], "insights": []}

        patches_novos = analise.get("patches", [])
        insights_novos = analise.get("insights", [])
        gargalo = analise.get("gargalo_principal", "")
        sugestao_estrutural = analise.get("sugestao_estrutural", "")

        today = datetime.date.today().isoformat()

        # ── ETAPA 7: SALVAR PATCHES (com verificação extra) ─────────────
        novos_patches = 0
        patches_rejeitados = 0
        for p in patches_novos:
            conteudo = (p.get("conteudo") or "").strip()
            if not conteudo:
                continue

            # Verificação 1: já existe patch similar?
            ja_existe = any(conteudo[:50] in (e[0] or "")[:50] for e in patches_existentes)
            if ja_existe:
                patches_rejeitados += 1
                continue

            # Verificação 2: o problema que este patch corrige já tá coberto
            # por um patch que a auditoria disse que tá funcionando?
            problema_novo = (p.get("problema") or "").lower()[:60]
            if patches_funcionando:
                cur.execute("SELECT problema FROM prompt_patches WHERE id = ANY(%s)", [patches_funcionando])
                problemas_cobertos = [(r[0] or "").lower()[:60] for r in cur.fetchall()]
                # Se o problema novo é muito similar a um já coberto, rejeitar
                problema_ja_coberto = any(
                    problema_novo[:30] in pc or pc[:30] in problema_novo
                    for pc in problemas_cobertos if pc
                )
                if problema_ja_coberto:
                    patches_rejeitados += 1
                    print(f"  🚫 PATCH rejeitado (problema já coberto por patch funcionando): {conteudo[:60]}")
                    continue

            cur.execute("""
                INSERT INTO prompt_patches
                (semana, patch_type, trigger, conteudo, ativo, eficacia_score,
                 fonte, problema, sugestao, aplicado, etapa_alvo, created_at)
                VALUES (%s, %s, 'auto', %s, true, 0, %s, %s, %s, true, %s, NOW())
            """, [today, p.get("patch_type", "general"), conteudo,
                  p.get("fonte", "auto"), (p.get("problema") or "")[:300],
                  (p.get("sugestao") or "")[:300], p.get("etapa_alvo", "all")])
            novos_patches += 1
            print(f"  📝 PATCH [{p.get('patch_type','?')}] etapa={p.get('etapa_alvo','?')} → {conteudo[:70]}")
            patches_existentes.append((conteudo, p.get("problema", "")))

        # ── ETAPA 8: SALVAR INSIGHTS ────────────────────────────────────
        novos_insights = 0
        for ins in insights_novos:
            trigger = (ins.get("trigger_padrao") or "").strip()
            resposta_ideal = (ins.get("resposta_ideal") or "").strip()
            if not trigger or not resposta_ideal:
                continue
            ja_existe = any(trigger[:40] in (e[0] or "")[:40] for e in insights_existentes)
            if ja_existe:
                continue

            score = int(ins.get("score", 5))
            score = max(1, min(10, score))

            cur.execute("""
                INSERT INTO aprendizado_insights
                (semana, categoria, etapa_funil, trigger_padrao, resposta_ideal,
                 contexto, score, fonte_lead, ativo)
                VALUES (CURRENT_DATE, %s, %s, %s, %s, %s, %s, %s, true)
            """, [ins.get("categoria", "fluxo"), ins.get("etapa_funil", "all"),
                  trigger, resposta_ideal, (ins.get("contexto") or "")[:300],
                  score, (ins.get("fonte_lead") or "auto")])
            novos_insights += 1
            print(f"  💡 INSIGHT [{ins.get('categoria','?')}] etapa={ins.get('etapa_funil','?')} score={score} → trigger: {trigger[:40]}")
            insights_existentes.append((trigger, resposta_ideal))

        # ── ETAPA 9: SNAPSHOT ───────────────────────────────────────────
        principais_objecoes = "; ".join(set(
            ins.get("trigger_padrao", "")[:30]
            for ins in insights_novos
            if ins.get("categoria") == "objecao"
        ))[:500] or "Nenhuma objeção nova identificada"

        argumentos = "; ".join(set(
            ins.get("resposta_ideal", "")[:50]
            for ins in insights_novos
            if ins.get("categoria") in ("argumento", "conversao")
        ))[:500] or "Nenhum argumento novo"

        cur.execute("""
            INSERT INTO aprendizado_luana
            (semana, total_conversas, total_leads, reunioes_agendadas, taxa_conversao,
             principais_objecoes, argumentos_que_converteram, etapa_maior_abandono,
             insights, prompt_patches, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
        """, [
            today,
            len(contexto_conversas),
            total_leads,
            reunioes,
            round((leads_avancados / total_leads * 100) if total_leads > 0 else 0, 2),
            principais_objecoes,
            argumentos,
            gargalo[:100] if gargalo else "",
            json.dumps({"novos_insights": novos_insights, "novos_patches": novos_patches,
                        "patches_rejeitados": patches_rejeitados,
                        "auditoria": {"funcionando": len(patches_funcionando), "falhando": len(patches_falhando)}},
                       ensure_ascii=False),
            json.dumps({"sugestao": sugestao_estrutural[:500]}, ensure_ascii=False)
        ])

        conn.commit()

        print(f"\n{'='*50}")
        print(f"🔍 AUDITORIA: {len(patches_funcionando)} patches funcionando | {len(patches_falhando)} falhando")
        print(f"🆕 Patches salvos: {novos_patches}")
        print(f"🚫 Patches rejeitados (já cobertos): {patches_rejeitados}")
        print(f"💡 Insights salvos: {novos_insights}")
        if gargalo:
            print(f"📊 Gargalo: {gargalo[:100]}")
        if sugestao_estrutural:
            print(f"💡 Sugestão: {sugestao_estrutural[:150]}")

except Exception as e:
    print(f"❌ Erro GPT: {e}")
    conn.commit()

# ── ETAPA 10: ESTATÍSTICAS FINAIS ─────────────────────────────────────
cur.execute("SELECT count(*) FROM prompt_patches WHERE ativo = true")
total_patches = cur.fetchone()[0]
cur.execute("SELECT count(*) FROM aprendizado_insights WHERE ativo = true")
total_insights = cur.fetchone()[0]
cur.execute("SELECT count(*) FROM aprendizado_luana")
total_snapshots = cur.fetchone()[0]

print(f"\n📈 Total: {total_patches} patches | {total_insights} insights | {total_snapshots} snapshots")
cur.close()
conn.close()
