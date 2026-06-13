import { createClientFromRequest } from "npm:@base44/sdk@0.8.31";

Deno.serve(async (req: Request): Promise<Response> => {
  const base44 = createClientFromRequest(req);
  const body = await req.json();

  const { email, data, hora, nome, telefone } = body;

  if (!email || !data || !hora) {
    return Response.json({ error: "Parâmetros obrigatórios: email, data, hora" }, { status: 400 });
  }

  // === 1. CRIAR EVENTO NO GOOGLE CALENDAR COM MEET ===
  const { accessToken: calToken } = await base44.asServiceRole.connectors.getConnection("googlecalendar");

  const parseDateTime = (dataStr: string, horaStr: string): { start: string; end: string } => {
    const horaClean = horaStr.replace(/h/i, ":").replace(/(\d+):?$/, "$1:00").padEnd(5, "0");
    const parts = horaClean.split(":");
    const h = parseInt(parts[0]) || 10;
    const m = parseInt(parts[1]) || 0;

    let dateObj: Date;
    const matchDMY = dataStr.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (matchDMY) {
      const day = parseInt(matchDMY[1]);
      const month = parseInt(matchDMY[2]) - 1;
      const year = parseInt(matchDMY[3]) < 100 ? 2000 + parseInt(matchDMY[3]) : parseInt(matchDMY[3]);
      dateObj = new Date(year, month, day, h, m, 0);
    } else {
      dateObj = new Date();
      dateObj.setDate(dateObj.getDate() + 1);
      dateObj.setHours(h, m, 0, 0);
    }

    const endObj = new Date(dateObj.getTime() + 60 * 60 * 1000);

    const fmt = (d: Date) => {
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00-03:00`;
    };

    return { start: fmt(dateObj), end: fmt(endObj) };
  };

  const { start, end } = parseDateTime(data, hora);

  const eventPayload = {
    summary: `Reunião OOBA Mídia Indoor${nome ? " — " + nome : ""}`,
    description: `Apresentação da OOBA Mídia Indoor\n\nLead: ${nome || "Interessado"}\nTelefone: ${telefone || "N/A"}\nE-mail: ${email}\n\nAgendado pela consultora Luana via WhatsApp.`,
    start: { dateTime: start, timeZone: "America/Sao_Paulo" },
    end: { dateTime: end, timeZone: "America/Sao_Paulo" },
    attendees: [
      { email: "paulo.ferrari@ooba.com.br" },
      { email }
    ],
    conferenceData: {
      createRequest: {
        requestId: `ooba-${Date.now()}`,
        conferenceSolutionKey: { type: "hangoutsMeet" }
      }
    },
    reminders: {
      useDefault: false,
      overrides: [
        { method: "email", minutes: 1440 },
        { method: "popup", minutes: 30 }
      ]
    }
  };

  const calRes = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${calToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(eventPayload)
    }
  );

  if (!calRes.ok) {
    const err = await calRes.text();
    console.error("Calendar error:", err);
    return Response.json({ error: "Erro ao criar evento no Calendar", details: err }, { status: 500 });
  }

  const calData = await calRes.json();
  const meetLink = calData?.conferenceData?.entryPoints?.find((e: any) => e.entryPointType === "video")?.uri || "";

  console.log("Evento criado:", calData.id, "Meet:", meetLink);

  // === 2. ENVIAR E-MAIL PARA O PAULO ===
  const { accessToken: gmailToken } = await base44.asServiceRole.connectors.getConnection("gmail");

  const emailPauloHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #1a1a2e; padding: 20px; border-radius: 8px 8px 0 0;">
        <h2 style="color: #fff; margin: 0;">🗓️ Nova Reunião Agendada — OOBA</h2>
      </div>
      <div style="background: #f9f9f9; padding: 24px; border-radius: 0 0 8px 8px; border: 1px solid #eee;">
        <p style="font-size: 16px;">Olá, <strong>Paulo</strong>! 👋</p>
        <p>A Luana agendou uma reunião via WhatsApp. Aqui estão os detalhes:</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr style="background: #fff; border-bottom: 1px solid #eee;">
            <td style="padding: 10px; font-weight: bold; color: #555; width: 40%;">👤 Lead</td>
            <td style="padding: 10px;">${nome || "Não informado"}</td>
          </tr>
          <tr style="background: #f5f5f5; border-bottom: 1px solid #eee;">
            <td style="padding: 10px; font-weight: bold; color: #555;">📞 Telefone</td>
            <td style="padding: 10px;">${telefone || "N/A"}</td>
          </tr>
          <tr style="background: #fff; border-bottom: 1px solid #eee;">
            <td style="padding: 10px; font-weight: bold; color: #555;">📧 E-mail</td>
            <td style="padding: 10px;">${email}</td>
          </tr>
          <tr style="background: #f5f5f5; border-bottom: 1px solid #eee;">
            <td style="padding: 10px; font-weight: bold; color: #555;">📅 Data e Hora</td>
            <td style="padding: 10px;"><strong>${data} às ${hora}</strong></td>
          </tr>
          ${meetLink ? `
          <tr style="background: #fff;">
            <td style="padding: 10px; font-weight: bold; color: #555;">🎥 Google Meet</td>
            <td style="padding: 10px;"><a href="${meetLink}" style="color: #4285f4;">${meetLink}</a></td>
          </tr>` : ""}
        </table>
        ${meetLink ? `
        <div style="text-align: center; margin: 24px 0;">
          <a href="${meetLink}" style="background: #4285f4; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-size: 16px;">🎥 Entrar na Reunião</a>
        </div>` : ""}
        <p style="color: #888; font-size: 13px; margin-top: 24px;">
          Um convite foi enviado ao e-mail do lead com o link do Meet.<br>
          Este e-mail foi gerado automaticamente pela consultora Luana.
        </p>
      </div>
    </div>
  `;

  const sendEmail = async (to: string, subject: string, htmlBody: string) => {
    const boundary = "ooba_boundary_" + Date.now();
    const mimeMsg = [
      `From: Luana - OOBA <me>`,
      `To: ${to}`,
      `Subject: ${subject}`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      ``,
      `--${boundary}`,
      `Content-Type: text/html; charset=UTF-8`,
      ``,
      htmlBody,
      `--${boundary}--`
    ].join("\r\n");

    const encoded = btoa(unescape(encodeURIComponent(mimeMsg)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${gmailToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ raw: encoded })
    });

    if (!r.ok) {
      console.error("Gmail error to", to, ":", await r.text());
      return false;
    }
    console.log("Email enviado para:", to);
    return true;
  };

  await sendEmail(
    "paulo.ferrari@ooba.com.br",
    `🗓️ Nova Reunião: ${nome || email} — ${data} às ${hora}`,
    emailPauloHtml
  );

  // === 3. SALVAR LEAD NA BASE44 ===
  try {
    const leads = await base44.asServiceRole.entities.Lead.filter({ telefone });
    if (leads.length > 0) {
      await base44.asServiceRole.entities.Lead.update(leads[0].id, {
        email,
        status: "reuniao_agendada",
        data_ultimo_contato: new Date().toISOString().split("T")[0],
        observacoes: `Reunião agendada para ${data} às ${hora}. Meet: ${meetLink}`
      });
    } else {
      await base44.asServiceRole.entities.Lead.create({
        nome: nome || "",
        telefone: telefone || "",
        email,
        status: "reuniao_agendada",
        data_ultimo_contato: new Date().toISOString().split("T")[0],
        observacoes: `Reunião agendada para ${data} às ${hora}. Meet: ${meetLink}`
      });
    }
    console.log("Lead salvo na Base44");
  } catch (e: any) {
    console.error("Erro ao salvar lead:", e.message);
  }

  return Response.json({
    success: true,
    meetLink,
    message: `Reunião criada para ${data} às ${hora}. Meet: ${meetLink}`
  });
});
