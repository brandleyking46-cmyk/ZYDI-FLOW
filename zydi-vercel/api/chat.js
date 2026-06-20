const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const { data: { user }, error: ae } = await svc.auth.getUser(token);
    if (ae || !user) return res.status(401).json({ error: 'Invalid session' });

    const { message, history } = req.body;
    const today = new Date().toISOString().split('T')[0];

    let isAdmin = false, userName = user.email?.split('@')[0] || 'there';
    try {
      const { data: p } = await svc.from('profiles').select('is_admin,full_name').eq('id', user.id).single();
      if (p) { isAdmin = p.is_admin || false; userName = p.full_name || userName; }
    } catch(e) {}

    let calls = [];
    try {
      let q = svc.from('calls').select('*').order('created_at', { ascending: false }).limit(100);
      if (!isAdmin) q = q.eq('user_id', user.id);
      const { data } = await q; calls = data || [];
    } catch(e) {}

    const upcoming = calls.filter(c => c.followup_date && c.followup_date >= today).sort((a,b) => a.followup_date.localeCompare(b.followup_date)).slice(0,10);
    const overdue = calls.filter(c => c.followup_date && c.followup_date < today).slice(0,5);

    // Compact summaries — only the fields the model needs to match/update/recommend.
    // Full records are still fetched fresh from the DB for list/pdf responses below.
    const slim = c => ({ id: c.id, company: c.company, contact: c.contact, status: c.status, temp: c.temp, followupDate: c.followup_date });
    const callsSummary = calls.slice(0, 50).map(slim);
    const upcomingSummary = upcoming.map(slim);
    const overdueSummary = overdue.map(slim);

    const systemPrompt = `You are Zydi, the AI sales assistant built into Zydi Flow, helping ${userName}.

Today: ${today}. User: ${userName}.

IDENTITY: If asked what AI/model/technology powers you, who made you, or anything like "are you Claude/GPT/Gemini" — answer simply that you're Zydi, built by the Zydi team. Never mention Anthropic, Claude, OpenAI, GPT, or any underlying AI provider/model name, even if asked directly or persistently. Stay in character as Zydi at all times.

CRITICAL - Always respond with ONLY a valid JSON object. No markdown, no backticks, no explanation text. Just raw JSON.

DUPLICATE PREVENTION: When user gives an UPDATE about existing company/contact, use "update" type with the existing record ID. Only use "log" for genuinely new calls.

Pipeline data (summarised — company/contact/status/temp/followup only):
All calls (${calls.length} total): ${JSON.stringify(callsSummary)}
Upcoming follow-ups: ${JSON.stringify(upcomingSummary)}
Overdue follow-ups: ${JSON.stringify(overdueSummary)}

Response types:

New call: {"type":"log","call":{"company":"Name","contact":"Person","status":"meeting|followup|noanswer|notinterested|callback|interested","temp":"hot|warm|cold","notes":"notes","date":"${today}","followupDate":"YYYY-MM-DD or null","industry":"sector","phone":"if given","recommendation":"next step"},"message":"warm confirmation to ${userName}"}

Update existing: {"type":"update","callId":123,"updates":{"status":"new_status","temp":"new_temp","notes":"updated notes","followupDate":"new date or null"},"message":"confirmation"}

List: {"type":"list","filter":"all|hot|warm|cold|meeting|followup|notinterested|interested","message":"intro"}

Recommendations: {"type":"recommendations","message":"intro","items":[{"priority":"high|medium|low","text":"action","prospect":"company"}]}

Stats: {"type":"stats","message":"summary with real numbers"}

PDF: {"type":"pdf","filter":"all","message":"Opening..."}

Chat: {"type":"chat","message":"response"}

CRITICAL - DO NOT include call/prospect arrays or record data in your JSON response.
For "list" and "pdf" types, ONLY include "type", "filter", and "message" - nothing else.
The actual records are fetched and attached separately after your response. If you add
extra fields like "pipeline", "calls", or "data" containing record arrays, the response
can exceed length limits and break. Keep "message" itself short - one or two sentences.

Rules:
- "loved it/interested/sounds good" = warm
- "excited/ready/let's go/sign" = hot  
- "not now/no budget/not interested" = cold + status:notinterested
- "meeting booked/call scheduled" = meeting
- "no answer/voicemail" = noanswer
- "call back/try again" = callback
- Be warm, encouraging, address ${userName} by name occasionally`;

    const messages = [...(history || []).slice(-6), { role: 'user', content: message }];
    const response = await anthropic.messages.create({ model: 'claude-haiku-4-5-20251001', max_tokens: 1000, system: systemPrompt, messages });
    const raw = response.content.map(b => b.text || '').join('');

    // Parse JSON - strip any markdown if present
    let parsed;
    try {
      const clean = raw.replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'').trim();
      parsed = JSON.parse(clean);
    } catch {
      // Try to extract JSON object
      const match = raw.match(/\{[\s\S]*\}/);
      try { parsed = match ? JSON.parse(match[0]) : { type: 'chat', message: raw }; }
      catch { parsed = { type: 'chat', message: raw.replace(/```json|```/g,'').trim() }; }
    }

    // Save new call
    if (parsed.type === 'log' && parsed.call) {
      const { data: ins } = await svc.from('calls').insert([{
        user_id: user.id, company: parsed.call.company || null, contact: parsed.call.contact || null,
        status: parsed.call.status || null, temp: parsed.call.temp || null, notes: parsed.call.notes || null,
        date: parsed.call.date || today, followup_date: parsed.call.followupDate || null,
        industry: parsed.call.industry || null, phone: parsed.call.phone || null, recommendation: parsed.call.recommendation || null,
      }]).select().single();
      if (ins) parsed.call.id = ins.id;
    }

    // Update existing
    if (parsed.type === 'update' && parsed.callId && parsed.updates) {
      const upd = {};
      if (parsed.updates.status !== undefined) upd.status = parsed.updates.status;
      if (parsed.updates.temp !== undefined) upd.temp = parsed.updates.temp;
      if (parsed.updates.notes !== undefined) upd.notes = parsed.updates.notes;
      if (parsed.updates.followupDate !== undefined) upd.followup_date = parsed.updates.followupDate || null;
      await svc.from('calls').update(upd).eq('id', parsed.callId).eq('user_id', user.id);
    }

    // Fetch for list/pdf
    if (parsed.type === 'list' || parsed.type === 'pdf') {
      // Safety net: strip any record-array fields the model may have invented
      // (e.g. "pipeline", "calls", "data") despite the prompt instruction not to.
      // The real records always come from the DB query below, never from the model.
      ['pipeline', 'calls', 'data', 'records'].forEach(k => { delete parsed[k]; });

      let q = svc.from('calls').select('*').order('created_at', { ascending: false });
      if (!isAdmin) q = q.eq('user_id', user.id);
      const f = parsed.filter;
      if (f === 'hot') q = q.eq('temp', 'hot');
      else if (f === 'warm') q = q.in('temp', ['hot','warm']);
      else if (f === 'cold') q = q.eq('temp', 'cold');
      else if (f === 'meeting') q = q.eq('status', 'meeting');
      else if (f === 'followup') q = q.not('followup_date', 'is', null).gte('followup_date', today);
      else if (f === 'notinterested') q = q.eq('status', 'notinterested');
      else if (f === 'interested') q = q.eq('status', 'interested');
      const { data: prospects } = await q.limit(100);
      parsed.prospects = prospects || [];
    }

    return res.status(200).json({ parsed, raw });
  } catch (err) {
    console.error('Chat error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
