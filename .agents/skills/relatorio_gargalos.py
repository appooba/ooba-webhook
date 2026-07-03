#!/usr/bin/env python3
"""
Skill: Relatório de Gargalos + Auto-ajuste — Luana Vendas v2
Fase 3: Analytics do funil, compara com metas, identifica gargalos,
ajusta follow-up baseado em tempo histórico de resposta, e manda
relatório estruturado no WhatsApp de gestão (11) 99565-0925.
"""
import os, json, psycopg2, datetime, urllib.request

DB_URL = os.environ.get("DATABASE_URL", "")
OPENAI_KEY = os.environ.get("OPENAI_API_KEY", "")
WAT_TOKEN = os.environ.get("WHATSAPP_TOKEN", "")
PHONE_ID = "1189704930882063"
GESTAO_PHONE = "5511995650925"

if not DB_URL:
    print("❌ DATABASE_URL não configurado")
    exit(1)

conn = psycopg2.connect(DB_URL, sslmode="require")
cur = conn.cursor()

# ═══════════════════════════════════════════════════════════
# 1. ANALYTICS DO FUNIL — comparar transições com metas
# ═══════════════════════════════════════════════════════════

# Contar leads por etapa
cur.execute("""
  SELECT etapa_funil, COUNT(*) as total
  FROM leads WHERE etapa_funil IS NOT NULL
  GROUP BY etapa_funil
""")
distribuicao = {r[0]: r[1] for r in cur.fetchall()}

# Contar transições por etapa (quantos avançaram de cada etapa)
cur.execute("""
  SELECT etapa_anterior, etapa_nova, COUNT(*) as total
  FROM funil_transicoes
  GROUP BY etapa_anterior, etapa_nova
  ORDER BY etapa_anterior
""")
transicoes_raw = cur.fetchall()

# Organizar: para cada etapa, quantos entraram e quantos saíram (avançaram)
entrada_por_etapa = {}
saida_por_etapa = {}
for ant, nova, total in transicoes_raw:
    saida_por_etapa[ant] = saida_por_etapa.get(ant, 0) + total
    entrada_por_etapa[nova] = entrada_por_etapa.get(nova, 0) + total

# Buscar metas
cur.execute("SELECT etapa, meta_percentual, benchmark_mercado, observacao FROM funil_metas WHERE ativa = true")
metas = {r[0]: {"meta": float(r[1]), "benchmark": float(r[2]), "obs": r[3]} for r in cur.fetchall()}

# Calcular taxa de conversão real por etapa
etapas_ordem = ["abertura", "entendimento", "recomendacao", "materiais", "fechamento"]
analytics = []
gargalos = []

for i, etapa in enumerate(etapas_ordem):
    total_na_etapa = distribuicao.get(etapa, 0)
    avancaram = saida_por_etapa.get(etapa, 0)
    # Taxa = avançaram / (total_na_etapa + avançaram) — porque os que avançaram já não estão na etapa
    base = total_na_etapa + avancaram
    taxa_real = (avancaram / base * 100) if base > 0 else 0
    
    meta = metas.get(etapa, {}).get("meta", 0)
    benchmark = metas.get(etapa, {}).get("benchmark", 0)
    
    gap = taxa_real - meta
    status = "✅" if gap >= 0 else "🔴" if gap < -10 else "🟡"
    
    analytics.append({
        "etapa": etapa,
        "leads_atuais": total_na_etapa,
        "avancaram": avancaram,
        "taxa_real": round(taxa_real, 1),
        "meta": meta,
        "benchmark": benchmark,
        "gap": round(gap, 1),
        "status": status
    })
    
    if gap < -10:
        gargalos.append({
            "etapa": etapa,
            "taxa_real": round(taxa_real, 1),
            "meta": meta,
            "gap": round(gap, 1),
            "severidade": "alta" if gap < -20 else "media"
        })

print("📊 Analytics do funil:")
for a in analytics:
    print(f"  {a['status']} {a['etapa']:15s} | taxa={a['taxa_real']}% | meta={a['meta']}% | gap={a['gap']}% | {a['leads_atuais']} leads atuais")

# ═══════════════════════════════════════════════════════════
# 2. AUTO-AJUSTE DE FOLLOW-UP — tempo histórico de resposta
# ═══════════════════════════════════════════════════════════

# Analisar tempo médio de resposta dos leads
cur.execute("""
  SELECT phone, 
    COUNT(*) FILTER (WHERE direction = 'inbound') as msgs_recebidas,
    COUNT(*) FILTER (WHERE direction = 'outbound') as msgs_enviadas,
    MIN(created_at) as primeira_msg,
    MAX(created_at) as ultima_msg
  FROM message_log
  WHERE created_at > NOW() - INTERVAL '30 days'
  GROUP BY phone
  HAVING COUNT(*) FILTER (WHERE direction = 'inbound') > 0
""")
tempo_resposta = cur.fetchall()

# Calcular intervalo ideal de follow-up baseado em quando leads costumam responder
cur.execute("""
  WITH resp AS (
    SELECT 
      m1.phone,
      EXTRACT(EPOCH FROM (m1.created_at - LAG(m1.created_at) OVER (PARTITION BY m1.phone ORDER BY m1.created_at))) / 3600 as horas_gap
    FROM message_log m1
    WHERE m1.created_at > NOW() - INTERVAL '30 days'
      AND m1.direction = 'inbound'
  )
  SELECT 
    AVG(horas_gap) as media_horas,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY horas_gap) as mediana_horas,
    PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY horas_gap) as p75_horas
  FROM resp
  WHERE horas_gap > 0 AND horas_gap < 168
""")
r = cur.fetchone()
media_resp_horas = float(r[0]) if r and r[0] else 24
mediana_resp_horas = float(r[1]) if r and r[1] else 24
p75_resp_horas = float(r[2]) if r and r[2] else 48

# Intervalo ideal de follow-up = mediana de resposta + 50% (dá tempo pro lead responder naturalmente)
intervalo_followup_horas = int(mediana_resp_horas * 1.5)
intervalo_followup_horas = max(12, min(72, intervalo_followup_horas))  # entre 12h e 72h

print(f"\n⏱️ Tempo de resposta dos leads:")
print(f"  Média: {media_resp_horas:.1f}h | Mediana: {mediana_resp_horas:.1f}h | P75: {p75_resp_horas:.1f}h")
print(f"  → Intervalo ideal de follow-up: {intervalo_followup_horas}h")

# Salvar configuração de follow-up no agent_config
cur.execute("""
  INSERT INTO agent_config (key, value, updated_at)
  VALUES ('followup_intervalo_horas', %s, NOW())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
""", [str(intervalo_followup_horas)])
conn.commit()
print("  ✅ Salvo no agent_config")

# ═══════════════════════════════════════════════════════════
# 3. AUTO-PATCH PARA GARGALOS — gerar correção direcionada
# ═══════════════════════════════════════════════════════════

patches_gerados = 0
if gargalos:
    # Para cada gargalo, criar um insight direcionado via GPT
    prompt_gargalo = f"""Você é um consultor de vendas. A Luana é uma vendedora de mídia indoor (OOBA).
    
O funil de vendas tem um GARGALO na etapa '{gargalos[0]['etapa']}':
- Taxa de conversão real: {gargalos[0]['taxa_real']}%
- Meta: {gargalos[0]['meta']}%
- Gap: {gargalos[0]['gap']}%

Gere UMA correção específica para esta etapa. Responda em JSON:
{{
  "insight": {{
    "categoria": "fluxo|discovery|objecao|churn",
    "trigger_padrao": "situação típica que trava o lead nesta etapa",
    "resposta_ideal": "a melhor forma da Luana conduzir esta situação",
    "score": 1-10
  }},
  "patch": "instrução curta (máx 2 linhas) para o prompt da Luana melhorar nesta etapa"
}}
"""
    try:
        data = json.dumps({
            "model": "gpt-4o-mini",
            "messages": [{"role": "user", "content": prompt_gargalo}],
            "temperature": 0.4,
            "max_tokens": 800
        }).encode()
        
        req = urllib.request.Request(
            "https://api.openai.com/v1/chat/completions",
            data=data,
            headers={"Authorization": f"Bearer {OPENAI_KEY}", "Content-Type": "application/json"}
        )
        
        with urllib.request.urlopen(req, timeout=30) as resp_gpt:
            result = json.loads(resp_gpt.read())
            resposta = result["choices"][0]["message"]["content"]
            try:
                analise = json.loads(resposta)
            except:
                import re
                match = re.search(r'\{.*\}', resposta, re.DOTALL)
                analise = json.loads(match.group()) if match else {}
            
            ins = analise.get("insight", {})
            patch_text = analise.get("patch", "")
            
            if ins:
                cur.execute("""
                    INSERT INTO aprendizado_insights
                    (semana, categoria, etapa_funil, trigger_padrao, resposta_ideal,
                     contexto, score, fonte_lead, ativo)
                    VALUES (CURRENT_DATE, %s, %s, %s, %s, %s, %s, 'auto_gargalo', true)
                """, [ins.get("categoria", "fluxo"), gargalos[0]["etapa"],
                      ins.get("trigger_padrao", ""), ins.get("resposta_ideal", ""),
                      f"Auto-gerado por gargalo: {gargalos[0]['gap']}% abaixo da meta",
                      int(ins.get("score", 7))])
                patches_gerados += 1
                print(f"\n🔧 Auto-patch para gargalo '{gargalos[0]['etapa']}': {ins.get('resposta_ideal', '')[:80]}")
            
            if patch_text:
                cur.execute("""
                    INSERT INTO prompt_patches
                    (semana, patch_type, trigger, conteudo, ativo, fonte, problema, etapa_alvo, aplicado, created_at)
                    VALUES (CURRENT_DATE, 'auto_gargalo', 'auto', %s, true, 'sistema',
                    %s, %s, true, NOW())
                """, [patch_text, f"Gargalo: {gargalos[0]['etapa']} com {gargalos[0]['gap']}% abaixo da meta",
                      gargalos[0]["etapa"]])
                patches_gerados += 1
                print(f"  📝 Patch: {patch_text[:80]}")
            
            conn.commit()
    except Exception as e:
        print(f"⚠️ Erro ao gerar auto-patch: {e}")


# ═══════════════════════════════════════════════════════════
# 5. A/B TESTING — avaliar e promover vencedores
# ═══════════════════════════════════════════════════════════

cur.execute("""
  SELECT t.id, t.name, t.config_key, t.etapa_funil, t.min_sample, t.confidence_threshold,
         t.winner_variant_id
  FROM ab_tests t WHERE t.status = 'active'
""")
active_tests = cur.fetchall()

ab_results = []
ab_promotions = []

for test in active_tests:
    test_id, test_name, config_key, etapa, min_sample, conf_thresh, winner_id = test
    
    cur.execute("""
      SELECT v.id, v.variant_name, v.content, v.assigned_count, v.converted_count,
             v.is_control
      FROM ab_test_variants v WHERE v.test_id = %s ORDER BY v.variant_name
    """, [test_id])
    variants = cur.fetchall()
    
    test_info = {"name": test_name, "config_key": config_key, "variants": []}
    
    # Verificar se todas as variantes têm amostra suficiente
    all_have_sample = all(v[3] >= min_sample for v in variants)
    
    best_variant = None
    best_rate = -1
    
    for v in variants:
        vid, vname, vcontent, assigned, converted, is_ctrl = v
        rate = (converted / assigned * 100) if assigned > 0 else 0
        test_info["variants"].append({
            "name": vname, "assigned": assigned, "converted": converted,
            "rate": round(rate, 1), "is_control": is_ctrl
        })
        if rate > best_rate:
            best_rate = rate
            best_variant = v
    
    ab_results.append(test_info)
    
    # Se todas as variantes têm amostra suficiente e há um vencedor claro
    if all_have_sample and best_variant and len(variants) >= 2:
        ctrl_rate = next((v[4] / v[3] * 100 for v in variants if v[5] and v[3] > 0), 0)
        diff = best_rate - ctrl_rate
        
        if diff >= conf_thresh * 100:
            # Promover vencedor: atualizar agent_config com o texto da variante vencedora
            winner_content = best_variant[2]
            cur.execute("""
              UPDATE agent_config SET value = %s, updated_at = NOW() WHERE key = %s
            """, [winner_content, config_key])
            
            # Marcar teste como concluído
            cur.execute("""
              UPDATE ab_tests SET status = 'completed', winner_variant_id = %s, completed_at = NOW()
              WHERE id = %s
            """, [best_variant[0], test_id])
            
            ab_promotions.append({
                "test": test_name,
                "winner": best_variant[1],
                "winner_rate": round(best_rate, 1),
                "control_rate": round(ctrl_rate, 1),
                "improvement": round(diff, 1),
                "config_key": config_key
            })
            print(f"  🏆 A/B PROMOTED: {test_name} → variante {best_variant[1]} ({best_rate:.1f}% vs {ctrl_rate:.1f}%)")

conn.commit()

if ab_results:
    print(f"\n🧪 A/B Tests ativos: {len(ab_results)}")
    for t in ab_results:
        print(f"  {t['name'][:40]}:")
        for v in t['variants']:
            ctrl = " (controle)" if v['is_control'] else ""
            print(f"    {v['name']}{ctrl}: {v['assigned']} leads, {v['converted']} convertidos, {v['rate']}%")


# ═══════════════════════════════════════════════════════════
# 4. RELATÓRIO ESTRUTURADO NO WHATSAPP
# ═══════════════════════════════════════════════════════════

# Métricas gerais
cur.execute("SELECT COUNT(*) FROM leads")
total_leads = cur.fetchone()[0]
cur.execute("SELECT COUNT(*) FROM leads WHERE status = 'fechado'")
fechados = cur.fetchone()[0]
cur.execute("SELECT COUNT(*) FROM leads WHERE reuniao_data IS NOT NULL")
reunioes = cur.fetchone()[0]
cur.execute("SELECT COUNT(*) FROM leads WHERE created_at > NOW() - INTERVAL '7 days'")
novos_7d = cur.fetchone()[0]
cur.execute("SELECT COUNT(*) FROM leads WHERE status = 'frio'")
frios = cur.fetchone()[0]
cur.execute("SELECT COUNT(*) FROM prompt_patches WHERE ativo = true")
patches_ativos = cur.fetchone()[0]
cur.execute("SELECT COUNT(*) FROM aprendizado_insights WHERE ativo = true")
insights_ativos = cur.fetchone()[0]

# Leads estagnados
cur.execute("""
  SELECT nome, phone, etapa_funil, 
    EXTRACT(EPOCH FROM (NOW() - updated_at))/86400 as dias_parado
  FROM leads 
  WHERE status NOT IN ('fechado', 'perdido', 'frio')
    AND updated_at < NOW() - INTERVAL '3 days'
  ORDER BY updated_at ASC
  LIMIT 5
""")
estagnados = cur.fetchall()

# Montar relatório
relatorio = f"""📊 *RELATÓRIO DE GESTÃO — OOBA*
{datetime.date.today().strftime('%d/%m/%Y')}

*VISÃO GERAL*
├─ Total de leads: {total_leads}
├─ Novos (7d): {novos_7d}
├─ Reuniões agendadas: {reunioes}
├─ Fechados: {fechados}
├─ Frios: {frios}
└─ Taxa conversão: {(fechados/total_leads*100):.1f}%""" if total_leads > 0 else "0%"

relatorio += f"\n\n*FUNIL — TAXA POR ETAPA*"
for a in analytics:
    relatorio += f"\n{a['status']} {a['etapa'].capitalize()}: {a['taxa_real']}% (meta: {a['meta']}%) → {a['avancaram']} avançaram"

if gargalos:
    relatorio += f"\n\n🔴 *GARGALO: {gargalos[0]['etapa'].upper()}*"
    relatorio += f"\nGap de {gargalos[0]['gap']}% abaixo da meta"
    relatorio += f"\n→ Auto-patch gerado: {patches_gerados} correção(ões)"

relatorio += f"\n\n⏱️ *FOLLOW-UP*"
relatorio += f"\nIntervalo ajustado: {intervalo_followup_horas}h"
relatorio += f"\n(baseado em mediana de resposta: {mediana_resp_horas:.0f}h)"

if estagnados:
    relatorio += f"\n\n⚠️ *ESTAGNADOS (>3d sem resposta)*"
    for est in estagnados[:3]:
        nome = est[0] or est[1][-4:]
        dias = int(est[3])
        relatorio += f"\n• {nome} — {est[2]} — {dias}d"

if ab_results:
    relatorio += f"\n\n🧪 *A/B TESTS*"
    for t in ab_results:
        relatorio += f"\n{t['name'][:35]}"
        for v in t['variants']:
            ctrl = " *" if v['is_control'] else ""
            relatorio += f"\n  {v['name']}{ctrl}: {v['rate']}% ({v['converted']}/{v['assigned']})"

if ab_promotions:
    relatorio += f"\n\n🏆 *PROMOÇÕES A/B*"
    for p in ab_promotions:
        relatorio += f"\n→ {p['test'][:30]}: {p['winner']} (+{p['improvement']}%)"

relatorio += f"\n\n🧠 *APRENDIZADO*"
relatorio += f"\n├─ Patches ativos: {patches_ativos}"
relatorio += f"\n├─ Insights ativos: {insights_ativos}"
relatorio += f"\n└─ Auto-patches gerados hoje: {patches_gerados}"

print(f"\n{'='*50}")
print(relatorio)
print(f"{'='*50}")

# Enviar relatório no WhatsApp de gestão
if WAT_TOKEN:
    try:
        payload = json.dumps({
            "messaging_product": "whatsapp",
            "to": GESTAO_PHONE,
            "type": "text",
            "text": {"body": relatorio}
        }).encode()
        
        req = urllib.request.Request(
            f"https://graph.facebook.com/v20.0/{PHONE_ID}/messages",
            data=payload,
            headers={"Authorization": f"Bearer {WAT_TOKEN}", "Content-Type": "application/json"}
        )
        
        with urllib.request.urlopen(req, timeout=15) as resp_wa:
            result = json.loads(resp_wa.read())
            if result.get("messages"):
                print(f"\n✅ Relatório enviado para ({GESTAO_PHONE})")
            else:
                print(f"\n⚠️ Resposta inesperada: {result}")
    except Exception as e:
        print(f"\n❌ Erro ao enviar WhatsApp: {e}")
else:
    print("\n⚠️ WHATSAPP_TOKEN não configurado — relatório não enviado")

# Snapshot final
cur.execute("SELECT count(*) FROM aprendizado_luana")
snapshots = cur.fetchone()[0]
print(f"\n📈 Snapshots acumulados: {snapshots}")

cur.close()
conn.close()
print("\n✅ Fase 3 concluída")
